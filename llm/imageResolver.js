import { TOPIC_IMAGE_RULES } from "./imageRules.js";
import { pickKeywords } from "./textUtils.js";

const PIXABAY_SCORE_THRESHOLD = 3;
const DEFAULT_MAX_PIXABAY_CALLS = 25;

const pixabayQueryCache = new Map();
let pixabayCallCount = 0;
let hasWarnedPixabayDisabled = false;

function isPixabayEnabled() {
  const apiKey = process.env.PIXABAY_API_KEY;
  const enabledFlag = process.env.ENABLE_PIXABAY_IMAGES === "true";
  if (!apiKey || !enabledFlag) {
    if (!hasWarnedPixabayDisabled) {
      console.warn("Pixabay image fetching is disabled (missing key or flag).");
      hasWarnedPixabayDisabled = true;
    }
    return false;
  }
  return true;
}

function applyTopicRules(text) {
  if (!text) return null;
  for (const rule of TOPIC_IMAGE_RULES) {
    if (rule?.pattern?.test(text)) {
      return rule.topicKey;
    }
  }
  return null;
}

function buildPixabayKeywords(article) {
  const baseText =
    article?.simpleTitle || article?.title || article?.simpleText || "";
  const keywords = pickKeywords(baseText, 8);
  return keywords;
}

function buildPixabayUrl(query) {
  const url = new URL("https://pixabay.com/api/");
  url.searchParams.set("key", process.env.PIXABAY_API_KEY || "");
  url.searchParams.set("q", query);
  url.searchParams.set("image_type", "photo");
  url.searchParams.set("orientation", "horizontal");
  url.searchParams.set("safesearch", "true");
  url.searchParams.set("per_page", "100");
  return url.toString();
}

async function fetchPixabayHits(query) {
  const url = buildPixabayUrl(query);
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn("Pixabay API error", res.status, await res.text());
      return [];
    }

    const data = await res.json();
    return Array.isArray(data?.hits) ? data.hits : [];
  } catch (err) {
    console.error("Pixabay fetch failed", err);
    return [];
  }
}

function scoreHit(hit, keywords) {
  const tagsText = String(hit?.tags || "").toLowerCase();
  let score = 0;
  for (const kw of keywords) {
    const k = kw.toLowerCase();
    if (k && tagsText.includes(k)) score += 1;
  }
  return score;
}

function pickBestHit(hits, keywords) {
  let best = null;
  for (const hit of hits) {
    const score = scoreHit(hit, keywords);
    if (!best || score > best.score) {
      best = { hit, score };
    }
  }
  if (!best) return null;

  const url =
    best.hit?.largeImageURL ||
    best.hit?.webformatURL ||
    best.hit?.previewURL ||
    null;

  return { url, score: best.score };
}

function getMaxPixabayCalls() {
  const val = Number.parseInt(process.env.MAX_PIXABAY_CALLS || "", 10);
  if (Number.isFinite(val) && val > 0) return val;
  return DEFAULT_MAX_PIXABAY_CALLS;
}

export async function resolveArticleImage(article) {
  const textForRules = `${article?.simpleTitle || article?.title || ""} ${
    article?.simpleText || ""
  }`;

  const matchedTopicKey = applyTopicRules(textForRules);
  if (matchedTopicKey) {
    // Topic-specific assets will be wired later; keep placeholder null for now.
    return null;
  }

  if (!isPixabayEnabled()) return null;

  const keywords = buildPixabayKeywords(article);
  if (!keywords.length) return null;

  const query = keywords.join(" ");
  if (pixabayQueryCache.has(query)) {
    return pixabayQueryCache.get(query);
  }

  const maxCalls = getMaxPixabayCalls();
  if (pixabayCallCount >= maxCalls) {
    return null;
  }

  pixabayCallCount += 1;
  const hits = await fetchPixabayHits(query);
  const best = pickBestHit(hits, keywords);

  if (!best || best.score < PIXABAY_SCORE_THRESHOLD) {
    pixabayQueryCache.set(query, null);
    return null;
  }

  pixabayQueryCache.set(query, best.url);
  return best.url;
}
