// generate-lifestyle.mjs
import fs from "fs/promises";
import crypto from "crypto";
import { openai } from "./llm/openaiClient.js";
import { LIFESTYLE_AGENT_SYSTEM_PROMPT } from "./llm/lifestyleAgentPrompts.js";
import {
  cleanSimplifiedText,
  extractSourceDomains,
  extractHostname,
} from "./llm/textUtils.js";

if (process.env.ENABLE_DIGESTS !== "true") {
  console.log(
    "ℹ️ Τα lifestyle digests είναι απενεργοποιημένα. Χρησιμοποίησε το news.json ανά κατηγορία."
  );
  process.exit(0);
}

// Κατηγορίες που θα αντιμετωπίζονται ως lifestyle
const LIFESTYLE_CATEGORIES = ["sports", "screen", "culture", "fun"];

// Μέχρι πόσα άρθρα θα τρώει ο agent ανά κατηγορία
const MAX_ITEMS_PER_CATEGORY = 10;

// Paths – προσαρμόσ’ τα αν χρειάζεται
const NEWS_PATH = new URL("./static/news.json", import.meta.url);
const LIFESTYLE_PATH = new URL("./static/lifestyle.json", import.meta.url);

// Helper: βγάζουμε text από το Responses API
function extractTextFromResponse(response) {
  if (typeof response.output_text === "string") return response.output_text;

  const first = response.output?.[0]?.content?.[0]?.text;
  if (typeof first === "string") return first;
  if (first?.text) return first.text;
  if (first?.value) return first.value;

  throw new Error("Δεν βρέθηκε text στο response του μοντέλου");
}

// Αφαιρεί ενότητα "Πηγές:" (αν την έγραψε το LLM) + inline markdown links
function stripSourcesAndInlineLinks(text) {
  if (!text) return "";

  const idx = text.search(/(^|\n)Πηγές:/);
  let body = idx === -1 ? text : text.slice(0, idx);

  body = body.replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, "$1");
  body = body.replace(/^\s*#{1,6}\s+.+?(?:\n+|$)/, "");
  body = body.replace(/^\s*Τίτλος\s*:\s*.+?(?:\n+|$)/i, "");

  return body.trimEnd();
}

function normalizeUrl(u) {
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;
  return `https://${u}`;
}

function collectSourceUrls(article) {
  if (!article) return [];
  const urls = [];

  if (article.sourceUrl) urls.push(article.sourceUrl);
  if (article.url) urls.push(article.url);

  if (Array.isArray(article.sources)) {
    for (const s of article.sources) {
      if (typeof s === "string") {
        urls.push(normalizeUrl(s));
        continue;
      }
      const u = s?.sourceUrl || s?.url;
      if (u) urls.push(normalizeUrl(u));
    }
  }

  return urls.filter(Boolean);
}

// Πηγές ΜΟΝΟ από RSS mainItem
function buildSourcesFromMainItem(mainItem, { max = 4 } = {}) {
  if (!mainItem) return { sources: [], sourceDomains: [] };

  /** @type {{title: string, url: string}[]} */
  const out = [];
  const seen = new Set();

  // 1) structured sources
  if (Array.isArray(mainItem.sources) && mainItem.sources.length) {
    for (const s of mainItem.sources) {
      const title = s?.title || s?.sourceName || mainItem.sourceName || "Πηγή";
      const url = normalizeUrl(s?.url || s?.sourceUrl || "");
      if (!url) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      out.push({ title, url });
      if (out.length >= max) break;
    }
  }

  // 2) fallback url fields
  if (out.length < max) {
    const fallbackUrls = collectSourceUrls(mainItem);
    for (const urlRaw of fallbackUrls) {
      const url = normalizeUrl(urlRaw);
      if (!url) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      out.push({
        title: mainItem.sourceName || extractHostname(url) || "Πηγή",
        url,
      });
      if (out.length >= max) break;
    }
  }

  const sourceDomains = extractSourceDomains(out.map((s) => s.url).filter(Boolean));
  return { sources: out, sourceDomains };
}

// Τίτλοι ανά κατηγορία για το lifestyle άρθρο
function lifestyleTitleForCategory(category) {
  switch (category) {
    case "sports":
      return "Τα αθλητικά της ημέρας με απλά λόγια";
    case "screen":
      return "Τηλεόραση και σινεμά σε απλά λόγια";
    case "culture":
      return "Πολιτισμός, θέατρο και μουσική σε απλά λόγια";
    case "fun":
      return "Ιδέες για βόλτες και διασκέδαση";
    default:
      return "Ενημέρωση σε απλά λόγια";
  }
}

// Βαθμολογία: πόσα sites (sources.length) + πόσο πρόσφατο
function scoreLifestyleArticle(article) {
  const sourcesCount = Array.isArray(article.sources) ? article.sources.length : 1;
  const timeMs = article.publishedAt ? new Date(article.publishedAt).getTime() : 0;
  return sourcesCount * 1_000_000_000_000 + timeMs;
}

// Ετοιμάζουμε τις πρώτες Ν ειδήσεις ανά κατηγορία
function groupLifestyleArticlesByCategory(allArticles) {
  /** @type {Record<string, any[]>} */
  const grouped = {};
  for (const cat of LIFESTYLE_CATEGORIES) grouped[cat] = [];

  for (const article of allArticles) {
    const cat = article.category;
    if (!LIFESTYLE_CATEGORIES.includes(cat)) continue;
    if (article.isSensitive) continue;
    grouped[cat].push(article);
  }

  for (const cat of LIFESTYLE_CATEGORIES) {
    const items = grouped[cat];
    items.sort((a, b) => scoreLifestyleArticle(b) - scoreLifestyleArticle(a));
    grouped[cat] = items.slice(0, MAX_ITEMS_PER_CATEGORY);
  }

  return grouped;
}

// Διαβάζει JSON αν υπάρχει
async function readJsonIfExists(urlPath) {
  try {
    const raw = await fs.readFile(urlPath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Αν υπήρχε παλιότερα placeholder στο lifestyle.json, δεν θέλουμε να το “κλειδώσουμε”
function isNoNewsPlaceholderArticle(article) {
  const t = article?.simpleText || "";
  return /Σήμερα δεν βρέθηκαν κατάλληλες ειδήσεις/i.test(t);
}

// Κλήση στο OpenAI για μία κατηγορία (RSS-only, χωρίς web search)
async function generateLifestyleArticleForCategory(category, items) {
  const today = new Date().toISOString().slice(0, 10);
  const title = lifestyleTitleForCategory(category);

  // Αν δεν υπάρχει τίποτα από RSS: ΔΕΝ δημιουργούμε placeholder εδώ.
  // Θα γίνει "keep last good article" στο main().
  if (!items || items.length === 0) {
    return null;
  }

  // 👉 mainItem είναι το #1 (είναι ήδη ταξινομημένα)
  const [mainItem, ...restItems] = items;

  const payload = {
    date: today,
    category,
    mainItem: {
      id: mainItem.id,
      title: mainItem.simpleTitle || mainItem.title,
      summary: mainItem.simpleText || "",
      sourceName: mainItem.sourceName || null,
      sourceUrl: mainItem.sourceUrl || null,
      sourcesCount: Array.isArray(mainItem.sources) ? mainItem.sources.length : 1,
      publishedAt: mainItem.publishedAt || null,
    },
    contextItems: restItems.map((a) => ({
      id: a.id,
      title: a.simpleTitle || a.title,
      summary: a.simpleText || "",
      sourceName: a.sourceName || null,
      sourceUrl: a.sourceUrl || null,
      sourcesCount: Array.isArray(a.sources) ? a.sources.length : 1,
      publishedAt: a.publishedAt || null,
    })),
  };

  const userContent = `
Κατηγορία (lifestyle): ${category}
Ημερομηνία: ${today}

Παρακάτω είναι τα δεδομένα σε JSON.

Το ΚΥΡΙΟ γεγονός που πρέπει να περιγράψεις στο άρθρο σου είναι το "mainItem".

Τα "contextItems" μπορείς να τα χρησιμοποιήσεις ΜΟΝΟ αν μιλούν για το ίδιο γεγονός,
για να συμπληρώσεις μικρές λεπτομέρειες.

Αν κάποιο contextItem είναι άσχετο γεγονός, αγνόησέ το.

Θέλω:

- Να γράψεις ΕΝΑ άρθρο μόνο για το "mainItem".
- Να ΜΗΝ γράψεις πολλές διαφορετικές μικρές ειδήσεις.
- Να ΜΗΝ γράφεις πηγές, links ή ονόματα ιστοσελίδων μέσα στο κείμενο.
- Να ακολουθήσεις ΠΙΣΤΑ τις οδηγίες του system prompt.

Δεδομένα (JSON):
${JSON.stringify(payload, null, 2)}
`;

  const response = await openai.responses.create({
    model: "gpt-4o-mini",
    instructions: LIFESTYLE_AGENT_SYSTEM_PROMPT,
    input: userContent,
    max_output_tokens: 1600,
  });

  let rawText = extractTextFromResponse(response).trim();
  if (rawText.toUpperCase() === "SKIP") {
    return null;
  }
  rawText = stripSourcesAndInlineLinks(rawText);
  const simpleText = cleanSimplifiedText(rawText);

  if (!simpleText) {
    return null;
  }

  // Πηγές ΜΟΝΟ από mainItem (RSS)
  const { sources, sourceDomains } = buildSourcesFromMainItem(mainItem, { max: 4 });

  const hosts = sources
    .map((s) => extractHostname(s.url))
    .filter(Boolean)
    .join(", ");

  console.log(`🧭 sources lifestyle:${category} | rss_sources=${sources.length} hosts=${hosts}`);

  return {
    id: crypto.randomUUID(),
    contentType: "agent_lifestyle",
    category,
    date: today,
    title,
    simpleText,
    sourceDomains,
    sources,
    createdAt: new Date().toISOString(),
  };
}

async function main() {
  // 0) Διαβάζουμε το προηγούμενο lifestyle.json (για “keep last good content”)
  const prevLifestyle = await readJsonIfExists(LIFESTYLE_PATH);
  const prevByCategory = new Map(
    (prevLifestyle?.articles || [])
      .filter((a) => a && a.category)
      .map((a) => [a.category, a])
  );

  // 1. Διαβάζουμε news.json
  let json;
  try {
    const raw = await fs.readFile(NEWS_PATH, "utf-8");
    json = JSON.parse(raw);
  } catch (err) {
    console.error("❌ Πρόβλημα στο διάβασμα του news.json – έλεγξε path/format.");
    console.error(err);
    process.exit(1);
  }

  const allArticles = Array.isArray(json.articles) ? json.articles : [];
  if (!allArticles.length) {
    console.log("ℹ️ Δεν υπάρχουν άρθρα στο news.json");
    return;
  }

  // 2. Φιλτράρουμε μόνο τις lifestyle κατηγορίες και ταξινομούμε με score
  const grouped = groupLifestyleArticlesByCategory(allArticles);

  const lifestyleArticles = [];

  for (const category of LIFESTYLE_CATEGORIES) {
    const items = grouped[category] || [];
    const count = items.length;

    if (count > 0) {
      console.log(
        `🧠 Δημιουργία lifestyle άρθρου (RSS-only) για "${category}" με ${count} items...`
      );

      const fresh = await generateLifestyleArticleForCategory(category, items);
      if (fresh) {
        lifestyleArticles.push(fresh);
        continue;
      }
    }

    // 🔒 Δεν υπάρχει νέο υλικό: κράτα το προηγούμενο (αν υπάρχει και δεν είναι placeholder)
    const prev = prevByCategory.get(category);
    if (prev && !isNoNewsPlaceholderArticle(prev)) {
      console.log(
        `ℹ️ Δεν υπάρχουν νέα RSS items για "${category}". Κρατάω το προηγούμενο άρθρο.`
      );
      lifestyleArticles.push(prev);
    } else {
      console.log(
        `ℹ️ Δεν υπάρχουν νέα RSS items για "${category}" και δεν υπάρχει προηγούμενο άρθρο. Παραλείπεται.`
      );
    }
  }

  if (!lifestyleArticles.length) {
    console.log("ℹ️ Δεν δημιουργήθηκε/διατηρήθηκε κανένα lifestyle άρθρο.");
    return;
  }

  const output = {
    generatedAt: new Date().toISOString(),
    articles: lifestyleArticles,
  };

  await fs.writeFile(LIFESTYLE_PATH, JSON.stringify(output, null, 2), "utf-8");

  console.log(
    `✅ lifestyle.json έτοιμο. Κατηγορίες: ${lifestyleArticles.map((a) => a.category).join(", ")}`
  );
}

// Εκτέλεση script
main()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error("❌ Σφάλμα στο generate-lifestyle:", err);
    process.exit(1);
  });
