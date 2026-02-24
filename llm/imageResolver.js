// llm/imageResolver.js
import crypto from "crypto";
import { TOPIC_IMAGE_RULES } from "./imageRules.js";

// Προς το παρόν δεν βάζουμε fallback εικόνες.
// Εικόνα μπαίνει ΜΟΝΟ αν υπάρχει στο original άρθρο/feed.

const STOPWORDS = new Set([
  "ο","η","το","οι","τα","του","της","των","στο","στη","στην","στον","με","και","για","από","απο",
  "σε","ως","κατά","κατα","που","πως","τι","μια","ένας","ένα","εναν","την","τον",
  "σήμερα","χθες","αύριο","τωρα","τώρα","νεα","νέα","είδηση","ειδηση","ειδήσεις",
  "δηλώνει","λέει","αναφέρει","όπως","οπως","μετά","μετα","πριν","εναντίον","κατά",
]);

const GR_TO_EN = [
  [/αθήνα|αθηνα/i, "athens"],
  [/θεσσαλονίκη|θεσσαλονικη/i, "thessaloniki"],
  [/ελλάδα|ελλαδα/i, "greece"],
  [/σεισμ/i, "earthquake"],
  [/πυρκαγι|φωτι/i, "wildfire"],
  [/κακοκαιρ|καταιγ|πλημμυρ/i, "storm"],
  [/τροχα(ι|ί)ο|σύγκρουσ/i, "accident"],
  [/αστυνομ/i, "police"],
  [/δικασ|εισαγγελ/i, "court"],
  [/νοσοκομ|υγει/i, "hospital"],
];

function normalizeWords(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[«»"“”'’.,!?;:()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stableIndex(seedStr, modulo) {
  if (!modulo || modulo <= 0) return 0;
  const h = crypto.createHash("sha1").update(String(seedStr || "seed")).digest();
  const n = h.readUInt32BE(0);
  return n % modulo;
}

function pickKeywordsFromTitle(article) {
  const title = article?.simpleTitle || article?.title || "";
  const norm = normalizeWords(title);
  const words = norm
    .split(" ")
    .map((w) => w.trim())
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));

  const top = Array.from(new Set(words)).slice(0, 6);

  const enriched = [...top];
  for (const [re, en] of GR_TO_EN) {
    if (re.test(title)) enriched.push(en);
  }

  return Array.from(new Set(enriched)).slice(0, 8);
}

function getTopicKey(article) {
  const title = article?.simpleTitle || article?.title || "";
  for (const rule of TOPIC_IMAGE_RULES) {
    if (rule?.match?.test?.(title)) return rule.topicKey || null;
  }
  return null;
}

// --- Pixabay (optional, safe) ---

let hasWarnedMissingPixabayKey = false;
let pixabayCalls = 0;
const pixabayCacheByQuery = new Map(); // queryKey -> hits[]

function pickPixabayUrl(hit) {
  return hit?.largeImageURL || hit?.webformatURL || hit?.previewURL || null;
}

function scorePixabayHit(hit, keywords) {
  const tags = normalizeWords(hit?.tags || "");
  if (!tags) return 0;

  let score = 0;
  for (const k of keywords) {
    const kk = normalizeWords(k);
    if (kk && tags.includes(kk)) score += 3;
  }

  if (hit?.imageWidth >= 1600) score += 1;
  return score;
}

async function fetchPixabayHits(query, { order = "popular", perPage = 100 } = {}) {
  const apiKey = process.env.PIXABAY_API_KEY;
  const enabled = process.env.ENABLE_PIXABAY_IMAGES === "true";

  if (!enabled) return [];
  if (!apiKey) {
    if (!hasWarnedMissingPixabayKey) {
      console.warn("⚠️ PIXABAY_API_KEY is not set. Skipping Pixabay images.");
      hasWarnedMissingPixabayKey = true;
    }
    return [];
  }

  const maxCalls = Number(process.env.MAX_PIXABAY_CALLS || "25");
  if (pixabayCalls >= maxCalls) return [];

  const q = query || "news";
  const cacheKey = `${order}|${perPage}|${q}`;
  if (pixabayCacheByQuery.has(cacheKey)) return pixabayCacheByQuery.get(cacheKey);

  const url = new URL("https://pixabay.com/api/");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("q", q);
  url.searchParams.set("image_type", "photo");
  url.searchParams.set("orientation", "horizontal");
  url.searchParams.set("safesearch", "true");
  url.searchParams.set("order", order);
  url.searchParams.set("per_page", String(perPage));

  pixabayCalls += 1;

  try {
    const res = await fetch(url.toString());
    if (!res.ok) return [];
    const data = await res.json();
    const hits = Array.isArray(data.hits) ? data.hits : [];
    pixabayCacheByQuery.set(cacheKey, hits);
    return hits;
  } catch {
    return [];
  }
}

/**
 * Returns: imageUrl string or null
 * Πολιτική:
 * - Προς το παρόν χρησιμοποιούμε ΜΟΝΟ εικόνα από το original άρθρο.
 * - Δεν χρησιμοποιούμε fallback εικόνες από Pixabay.
 */
export async function resolveArticleImage(article) {
  const originalImageUrl = String(article?.imageUrl || "").trim();
  return originalImageUrl || null;
}
