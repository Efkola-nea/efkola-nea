import fs from "fs/promises";
import Parser from "rss-parser";
import OpenAI from "openai";

// Χρησιμοποιούμε το κλειδί από τα GitHub Secrets
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// RSS feeds που θα διαβάζουμε (βάζουμε 1 για αρχή)
const FEEDS = [
  {
    url: "https://www.ertnews.gr/feed", // αργότερα μπορούμε να προσθέσουμε κι άλλα
    sourceName: "ERT News",
  },
];

// Ρυθμίζουμε το parser να κρατά και κάποια extra πεδία για εικόνες/HTML
const parser = new Parser({
  customFields: {
    item: [
      ["content:encoded", "contentEncoded"],
      ["media:content", "mediaContent", { keepArray: true }],
      ["media:thumbnail", "mediaThumbnail", { keepArray: true }],
    ],
  },
});

// Πολύ απλό καθάρισμα HTML -> απλό κείμενο
function stripHtml(html) {
  if (!html) return "";
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

// Προσπαθούμε να βρούμε μια εικόνα από το item ή το HTML
function extractImageUrl(item, html = "") {
  // 1) mediaContent (Media RSS)
  if (Array.isArray(item.mediaContent)) {
    for (const m of item.mediaContent) {
      const url = m?.$?.url || m?.url;
      const medium = m?.$?.medium || "";
      const type = m?.$?.type || "";
      if (
        url &&
        (medium.toLowerCase() === "image" || (type && type.startsWith("image/")))
      ) {
        return url;
      }
    }
  }

  // 2) mediaThumbnail
  if (Array.isArray(item.mediaThumbnail)) {
    for (const t of item.mediaThumbnail) {
      const url = t?.$?.url || t?.url;
      if (url) return url;
    }
  }

  // 3) enclosure με τύπο εικόνας
  const enclosure = item.enclosure;
  if (enclosure && enclosure.url && /^image\//.test(enclosure.type || "")) {
    return enclosure.url;
  }

  // 4) Πρώτο <img ... src="..."> μέσα στο HTML (αν υπάρχει)
  if (html) {
    const imgMatch = html.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (imgMatch) return imgMatch[1];
  }

  return null;
}

// Προσπαθούμε να βρούμε video url
function extractVideoUrl(item, html = "") {
  const enclosure = item.enclosure;
  if (enclosure && enclosure.url && /^video\//.test(enclosure.type || "")) {
    return enclosure.url;
  }

  // iframe (π.χ. embedded player, YouTube κλπ.)
  if (html) {
    const iframeMatch = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
    if (iframeMatch) return iframeMatch[1];

    const videoMatch = html.match(/<video[^>]+src=["']([^"']+)["']/i);
    if (videoMatch) return videoMatch[1];
  }

  return null;
}

// Κλήση στο AI για απλοποίηση κειμένου
async function simplifyText(title, text) {
  const input = `Τίτλος: ${title}\n\nΚείμενο:\n${text}`;

  const response = await client.responses.create({
    model: "gpt-4o-mini",
    instructions:
      "Είσαι δημοσιογράφος που γράφει πολύ απλά ελληνικά για άτομα με νοητική υστέρηση. " +
      "Ξαναγράψε το κείμενο με: " +
      "1) πολύ απλές, σύντομες προτάσεις, " +
      "2) χωρίς δύσκολες λέξεις αν γίνεται, " +
      "3) εξήγηση των δύσκολων εννοιών με απλά παραδείγματα, " +
      "4) συνολικό μήκος έως περίπου 10-12 προτάσεις.",
    input,
  });

  return response.output_text;
}

async function run() {
  const articles = [];

  for (const feed of FEEDS) {
    console.log("Διαβάζω feed:", feed.url);
    const rss = await parser.parseURL(feed.url);

    // Παίρνουμε π.χ. τις 5 πιο πρόσφατες ειδήσεις
    const items = (rss.items || []).slice(0, 5);

    for (const item of items) {
      const title = item.title || "";
      const link = item.link || "";

      // Κρατάμε HTML (για εικόνες/βίντεο) και ταυτόχρονα βγάζουμε απλό κείμενο
      const htmlContent =
        item.contentEncoded ||
        item.content ||
        item.summary ||
        item.contentSnippet ||
        "";

      const raw = stripHtml(htmlContent);

      if (!raw) continue;

      // Κόβουμε το κείμενο για να μην είναι τεράστιο (λιγότερο κόστος)
      const textForModel = raw.slice(0, 2000);

      console.log("Απλοποιώ:", title);
      const simple = await simplifyText(title, textForModel);

      if (!simple) continue;

      const imageUrl = extractImageUrl(item, htmlContent);
      const videoUrl = extractVideoUrl(item, htmlContent);

      articles.push({
        title,
        simpleText: simple,
        sourceUrl: link,
        sourceName: feed.sourceName,
        imageUrl: imageUrl || null,
        videoUrl: videoUrl || null,
      });
    }
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    articles,
  };

  await fs.writeFile("news.json", JSON.stringify(payload, null, 2), "utf8");
  console.log("Έγραψα news.json με", articles.length, "άρθρα");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

