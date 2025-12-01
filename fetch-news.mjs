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

// Ρυθμίζουμε το parser να κρατά και extra πεδία για εικόνες/HTML
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

  if (html) {
    const iframeMatch = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
    if (iframeMatch) return iframeMatch[1];

    const videoMatch = html.match(/<video[^>]+src=["']([^"']+)["']/i);
    if (videoMatch) return videoMatch[1];
  }

  return null;
}

// Κλήση στο AI για απλοποίηση + κατηγοριοποίηση
async function simplifyAndClassifyText(title, text) {
  const input = `Τίτλος: ${title}\n\nΚείμενο:\n${text}\n\n---\n\n` +
    "1) Ξαναγράψε το κείμενο σε πολύ απλά ελληνικά, σαν να μιλάς σε άτομο με ήπια νοητική υστέρηση.\n" +
    "2) Μετά, αποφάσισε κατηγορία και αν είναι «βαριά» είδηση.\n";

  const response = await client.responses.create({
    model: "gpt-4o-mini",
    instructions:
      "Γράφεις πολύ απλά ελληνικά για άτομα με νοητική υστέρηση.\n" +
      "Πρέπει να παράγεις ΜΟΝΟ ένα έγκυρο JSON αντικείμενο, χωρίς άλλο κείμενο γύρω του.\n" +
      "Το JSON να έχει τα πεδία:\n" +
      "- simplifiedText: string (το κείμενο σε απλή μορφή, μέχρι 10–12 σύντομες προτάσεις)\n" +
      '- category: μία από: "greece", "world", "politics", "economy", "society", "sports", "culture", "other"\n' +
      "- isSensitive: true ή false.\n" +
      "Βάλε isSensitive = true αν το άρθρο μιλά κυρίως για πόλεμο, εγκλήματα, βία, σοβαρά ατυχήματα, θανάτους ή σεξουαλική κακοποίηση.\n" +
      "Μην χρησιμοποιείς markdown, μην γράφεις τίποτα έξω από το JSON.",
    input,
  });

  const textOut = response.output_text;
  try {
    const parsed = JSON.parse(textOut);
    return {
      simplifiedText: parsed.simplifiedText || "",
      category: parsed.category || "other",
      isSensitive: Boolean(parsed.isSensitive),
    };
  } catch (err) {
    console.error("JSON parse error από το μοντέλο, fallback σε απλό κείμενο:", err);
    // Fallback: όλο το κείμενο ως simplifiedText, non-sensitive, other
    return {
      simplifiedText: textOut,
      category: "other",
      isSensitive: false,
    };
  }
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

      // HTML για εικόνες/βίντεο + κείμενο
      const htmlContent =
        item.contentEncoded ||
        item.content ||
        item.summary ||
        item.contentSnippet ||
        "";

      const raw = stripHtml(htmlContent);
      if (!raw) continue;

      const textForModel = raw.slice(0, 2000);

      console.log("Απλοποιώ & ταξινομώ:", title);
      const result = await simplifyAndClassifyText(title, textForModel);

      if (!result || !result.simplifiedText) continue;

      // 🔴 Φιλτράρουμε «βαριές» ειδήσεις (πόλεμοι, εγκλήματα, βία, θάνατοι)
      if (result.isSensitive) {
        console.log("Παραλείπω ευαίσθητη είδηση:", title);
        continue;
      }

      const imageUrl = extractImageUrl(item, htmlContent);
      const videoUrl = extractVideoUrl(item, htmlContent);

      articles.push({
        title,
        simpleText: result.simplifiedText,
        sourceUrl: link,
        sourceName: feed.sourceName,
        category: result.category || "other",
        isSensitive: false, // αφού τις φιλτράρουμε, ό,τι μένει το θεωρούμε ασφαλές
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
