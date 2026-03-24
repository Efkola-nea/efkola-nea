import fs from "fs/promises";
import Parser from "rss-parser";
import crypto from "crypto";
import { CATEGORY_KEYS } from "./llm/newsCategories.js";
import { simplifyNewsArticle } from "./llm/newsSimplifier.js";
import { classifyNewsArticle } from "./llm/newsCategorizer.js";
import { gatekeepNewsArticle } from "./llm/newsFilter.js";
import { resolveArticleImage } from "./llm/imageResolver.js";
import {
  APPROVED_FALLBACK_CATEGORIES,
  APPROVED_FALLBACK_FEEDS,
  PRIMARY_GREEK_FEEDS,
  hasApprovedFallbackGap,
} from "./llm/feedConfig.js";
import {
  editorialPriorityScoreText,
  isUsefulSeriousText,
  shouldSkipArticle,
} from "./llm/editorialPolicy.js";
import {
  cleanSimplifiedText,
  extractSourceDomains,
  dedupeArticlesByUrlOrTitle,
} from "./llm/textUtils.js";

export { CATEGORY_KEYS };

const TARGET_CATEGORIES = CATEGORY_KEYS.filter((key) => key !== "other");

const MIN_ARTICLES_PER_CATEGORY = 2;
const MAX_ARTICLES_PER_CATEGORY = 6;
const RSS_FEED_TIMEOUT_MS = Number(process.env.RSS_FEED_TIMEOUT_MS || "20000");
const FEED_ITEM_LIMIT = Math.max(1, Number(process.env.FEED_ITEM_LIMIT || "24"));
const GATEKEEPER_PROGRESS_EVERY = Math.max(
  1,
  Number(process.env.GATEKEEPER_PROGRESS_EVERY || "10")
);
const TOPIC_PROGRESS_EVERY = Math.max(1, Number(process.env.TOPIC_PROGRESS_EVERY || "5"));
const BACKFILL_MAX_ATTEMPTS_PER_CATEGORY = Math.max(
  1,
  Number(process.env.BACKFILL_MAX_ATTEMPTS_PER_CATEGORY || "12")
);
const BACKFILL_ALLOW_BROAD_PASS = process.env.BACKFILL_ALLOW_BROAD_PASS === "true";
const PRIORITY_BACKFILL_MAX_ATTEMPTS = Math.max(
  BACKFILL_MAX_ATTEMPTS_PER_CATEGORY,
  Number(process.env.PRIORITY_BACKFILL_MAX_ATTEMPTS || "24")
);
const CATEGORY_HINT_CONFIDENCE_FLOOR = Number(
  process.env.CATEGORY_HINT_CONFIDENCE_FLOOR || "0.62"
);
const PRIORITY_CATEGORY_MIN_TARGETS = {
  screen: Math.max(MIN_ARTICLES_PER_CATEGORY, Number(process.env.MIN_ARTICLES_SCREEN || "3")),
  culture: Math.max(MIN_ARTICLES_PER_CATEGORY, Number(process.env.MIN_ARTICLES_CULTURE || "3")),
  fun: Math.max(MIN_ARTICLES_PER_CATEGORY, Number(process.env.MIN_ARTICLES_FUN || "3")),
};
const PRIORITY_LIFESTYLE_CATEGORIES = new Set(["happy", "screen", "culture", "fun"]);

// 👉 Θα γράφουμε το news.json δίπλα στο αρχείο αυτό
const NEWS_JSON_PATH = new URL("./static/news.json", import.meta.url);

function minTargetForCategory(category) {
  return PRIORITY_CATEGORY_MIN_TARGETS[category] || MIN_ARTICLES_PER_CATEGORY;
}

// 🔹 Πηγές με πιο "ελαστικό" copyright (open data)
// Δεν τις καλούμε ακόμη, απλά τις δηλώνουμε για μελλοντική χρήση.
const OPEN_DATA_SOURCES = {
  moviesAndSeries: "TMDB",
  music: "MusicBrainz",
  cultureGR: "SearchCulture.gr",
  cultureEU: "Europeana",
};

// Ρυθμίζουμε το parser να κρατά και extra πεδία για εικόνες/HTML
const parser = new Parser({
  timeout: RSS_FEED_TIMEOUT_MS,
  headers: {
    "User-Agent":
      process.env.RSS_USER_AGENT ||
      "Mozilla/5.0 (compatible; efkola-nea-bot/1.0; +https://github.com)",
    Accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
  },
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

function isPixabayUrl(url) {
  return /(^|\/\/)(cdn\.)?pixabay\.com/i.test(String(url || ""));
}

function sanitizeSourceImageUrl(url) {
  const v = String(url || "").trim();
  if (!v) return null;
  if (isPixabayUrl(v)) return null;
  return v;
}

// Σταθερό id άρθρου με βάση guid/link κτλ. (για raw άρθρα ανά feed)
function makeArticleId(feedUrl, item) {
  const base =
    item.guid ||
    item.id ||
    item.link ||
    `${feedUrl}:${item.title || ""}:${item.pubDate || ""}`;

  return crypto.createHash("sha1").update(base).digest("hex").slice(0, 12);
}

// Προσπαθούμε να βρούμε μια εικόνα από το item ή το HTML
function extractImageUrl(item, html = "") {
  // 1) mediaContent (Media RSS)
  if (Array.isArray(item.mediaContent)) {
    for (const m of item.mediaContent) {
      const url = m?.$?.url || m?.url;
      const medium = (m?.$?.medium || "").toLowerCase();
      const type = m?.$?.type || "";
      if (url && (medium === "image" || (type && type.startsWith("image/")))) {
        const safeUrl = sanitizeSourceImageUrl(url);
        if (safeUrl) return safeUrl;
      }
    }
  }

  // 2) mediaThumbnail
  if (Array.isArray(item.mediaThumbnail)) {
    for (const t of item.mediaThumbnail) {
      const url = t?.$?.url || t?.url;
      if (url) {
        const safeUrl = sanitizeSourceImageUrl(url);
        if (safeUrl) return safeUrl;
      }
    }
  }

  // 3) enclosure με τύπο εικόνας
  const enclosure = item.enclosure;
  if (enclosure && enclosure.url && /^image\//.test(enclosure.type || "")) {
    const safeUrl = sanitizeSourceImageUrl(enclosure.url);
    if (safeUrl) return safeUrl;
  }

  // 4) Πρώτο <img ... src="..."> μέσα στο HTML (αν υπάρχει)
  if (html) {
    const imgMatch = html.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (imgMatch) {
      const safeUrl = sanitizeSourceImageUrl(imgMatch[1]);
      if (safeUrl) return safeUrl;
    }
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

// Κόβει τυχόν ενότητες "Πηγές" που μπορεί να μπουν μέσα στο κείμενο (LLM ή παλιά footer).
function stripSourcesBlock(text) {
  if (!text) return "";
  let t = String(text);

  // Από "🌍 Πηγές" μέχρι τέλος
  t = t.replace(/\n?\s*🌍\s*Πηγές[\s\S]*$/i, "");

  // Από "Πηγές" (χωρίς emoji) μέχρι τέλος
  t = t.replace(/\n?\s*Πηγές\s*\n[\s\S]*$/i, "");

  // Αν υπάρχουν “ορφανά” site names στο τέλος (σπάνιο), κόψ’ τα όταν μοιάζουν με λίστα
  // (κρατάμε συντηρητικό κανόνα: 2+ γραμμές με 1–4 λέξεις η καθεμία)
  t = t.replace(/\n(?:[A-Za-zΑ-Ωα-ω0-9.\- ]{2,40}\n){2,}$/m, "\n");

  return t.replace(/\n{3,}/g, "\n\n").trim();
}

// 🚩 Κανονικοποίηση κατηγορίας από το LLM
function normalizeCategory(rawCategory) {
  if (!rawCategory) return "fun";
  const c = rawCategory.toString().toLowerCase().trim();

  // Σοβαρές ειδήσεις
  if (
    [
      "serious",
      "serious_news",
      "σοβαρες ειδησεις",
      "σοβαρές ειδήσεις",
      "politics",
      "economy",
      "πολιτικη",
      "πολιτική",
      "οικονομια",
      "οικονομία",
    ].includes(c)
  ) {
    return "serious";
  }

  // Χαρούμενες ειδήσεις
  if (
    [
      "happy",
      "goodnews",
      "good news",
      "positive",
      "feelgood",
      "χαρουμενες",
      "χαρούμενες",
      "χαρουμενες ειδησεις",
      "χαρούμενες ειδήσεις",
      "θετικα νεα",
      "θετικά νέα",
      "καλες ειδησεις",
      "καλές ειδήσεις",
    ].includes(c)
  ) {
    return "happy";
  }

  // Αθλητισμός
  if (["sports", "sport", "αθλητισμος", "αθλητισμός"].includes(c)) {
    return "sports";
  }

  // Τηλεόραση και σινεμά
  if (
    [
      "movies",
      "movie",
      "ταινιες",
      "ταινίες",
      "cinema",
      "σινεμα",
      "σινεμά",
      "series",
      "σειρες",
      "σειρές",
      "tv",
      "τηλεοραση",
      "τηλεόραση",
    ].includes(c)
  ) {
    return "screen";
  }

  // Πολιτισμός (μουσική + θέατρο)
  if (
    [
      "music",
      "μουσικη",
      "μουσική",
      "theatre",
      "theater",
      "θεατρο",
      "θέατρο",
      "culture",
      "πολιτισμος",
      "πολιτισμός",
    ].includes(c)
  ) {
    return "culture";
  }

  // Διασκέδαση (fun)
  if (
    [
      "fun",
      "entertainment",
      "διασκεδαση",
      "διασκέδαση",
      "ψυχαγωγια",
      "ψυχαγωγία",
      "nightlife",
      "bars",
      "εξοδοι",
      "έξοδοι",
    ].includes(c)
  ) {
    return "fun";
  }

  return "fun"; // ασφαλής προεπιλογή εντός επιτρεπόμενων κατηγοριών
}

// 🧠 Ομαλοποίηση τίτλου για ομαδοποίηση σε "θέματα"
function normalizeTitleForGrouping(title) {
  if (!title) return "";
  return title
    .toLowerCase()
    .replace(/[«»"“”'’.,!?;:()[\]]+/g, " ")
    .replace(/\blive\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ⚙️ Ρυθμίσεις για πιο "χαλαρή" ομαδοποίηση τίτλων
const TITLE_SIMILARITY_THRESHOLD = 0.35;

const TITLE_STOPWORDS = new Set([
  "στην",
  "στον",
  "στη",
  "στο",
  "για",
  "και",
  "με",
  "κατά",
  "κατα",
  "από",
  "απο",
  "επί",
  "εις",
  "των",
  "στοιχεία",
  "έκτακτο",
  "εκτακτο",
  "ειδηση",
  "είδηση",
  "ειδήσεις",
  "νεα",
  "νέα",
  "σημερα",
  "σήμερα",
]);

// Κλήση στο AI για απλοποίηση + κατηγοριοποίηση
async function simplifyAndClassifyText(topicGroup) {
  const { articles } = topicGroup;
  if (!articles || articles.length === 0) return null;

  const parts = [];
  parts.push(
    "Παρακάτω είναι πληροφορίες για ΜΙΑ είδηση από ΕΝΑ ή ΠΕΡΙΣΣΟΤΕΡΑ άρθρα.\n" +
      "Όλα μιλούν για το ίδιο γεγονός. Χρησιμοποίησε τα όλα μαζί σαν υλικό."
  );

  articles.forEach((article, index) => {
    const src = article.sourceName || "Άγνωστη πηγή";
    const truncatedText = article.rawText.slice(0, 4000);
    parts.push(
      `\n\nΆρθρο ${index + 1}:\n` +
        `Πηγή: ${src}\n` +
        `Τίτλος: ${article.title}\n` +
        `Κείμενο:\n${truncatedText}\n`
    );
  });

  const combinedRawText = parts.join("\n");
  const baseTitle = topicGroup.title || articles[0]?.title || "Είδηση";
  const primarySourceUrl = articles[0]?.sourceUrl;

  // 4️⃣ Simplify + translate σε Easy-to-Read Ελληνικά
  const { text: simplifiedText, title: simplifiedTitle } = await simplifyNewsArticle({
    title: baseTitle,
    rawText: combinedRawText,
    sourceUrl: primarySourceUrl,
  });

  const { category, reason, confidence } = await classifyNewsArticle({
    title: baseTitle,
    simpleText: simplifiedText || "",
    rawText: combinedRawText,
  });

  const hintedCategoryRaw =
    (topicGroup.categoryHints || []).find((c) => c && normalizeCategory(c) !== "other") || null;
  const hintedCategory = hintedCategoryRaw ? normalizeCategory(hintedCategoryRaw) : null;

  const normalizedClassified = normalizeCategory(category);
  const numericConfidence = Number.isFinite(confidence) ? Number(confidence) : 0;
  const shouldPreferHint =
    hintedCategory &&
    numericConfidence < CATEGORY_HINT_CONFIDENCE_FLOOR &&
    PRIORITY_LIFESTYLE_CATEGORIES.has(hintedCategory);

  const finalCategory =
    shouldPreferHint
      ? hintedCategory
      : normalizedClassified !== "other"
      ? normalizedClassified
      : hintedCategory || "other";

  const categoryReason =
    shouldPreferHint
      ? `${reason || ""}${reason ? " | " : ""}hint_override:${hintedCategory}@${numericConfidence.toFixed(2)}`
      : normalizedClassified !== "other"
      ? reason || ""
      : hintedCategory
      ? `${reason || "Κατηγορία από hints feed"} (hint: ${hintedCategory})`
      : reason || "";

  return {
    simplifiedText,
    simplifiedTitle: simplifiedTitle || baseTitle,
    rawCategory: category,
    normalizedCategory: finalCategory,
    categoryReason,
    isSensitive: false,
  };
}

// helper: είναι η είδηση μέσα στο τελευταίο 24ωρο;
function isWithinLast24Hours(date, now = new Date()) {
  const diffMs = now.getTime() - date.getTime();
  const oneDayMs = 24 * 60 * 60 * 1000;
  return diffMs >= 0 && diffMs <= oneDayMs;
}

// 💡 επιλέγουμε μέχρι MAX_ARTICLES_PER_CATEGORY άρθρα ανά κατηγορία για "ειδήσεις της ημέρας"
function buildArticlesByCategory(allArticles) {
  const now = new Date();
  const fallbackCategory = CATEGORY_KEYS[0] || "serious";

  /** @type {Record<string, any[]>} */
  const byCategory = {};
  for (const key of CATEGORY_KEYS) byCategory[key] = [];

  for (const article of allArticles) {
    const cat = article.category || "other";
    const targetKey = byCategory[cat] ? cat : fallbackCategory;
    byCategory[targetKey].push(article);
  }

  const result = {};

  for (const key of CATEGORY_KEYS) {
    const items = byCategory[key] || [];

    items.sort((a, b) => {
      const da = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
      const db = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
      return db - da;
    });

    const todayItems = items.filter((i) =>
      isWithinLast24Hours(new Date(i.publishedAt || now), now)
    );

    let selected = todayItems.slice(0, MAX_ARTICLES_PER_CATEGORY);

    if (selected.length < MAX_ARTICLES_PER_CATEGORY) {
      const remaining = items.filter((i) => !todayItems.includes(i));
      selected = selected.concat(
        remaining.slice(0, MAX_ARTICLES_PER_CATEGORY - selected.length)
      );
    }

    result[key] = selected;
  }

  return result;
}

function countByCategory(articles) {
  const counts = {};
  for (const key of TARGET_CATEGORIES) counts[key] = 0;
  for (const a of articles) {
    if (a?.category && counts[a.category] !== undefined) counts[a.category] += 1;
  }
  return counts;
}

function hasMissingCategoryMinimum(articles) {
  const counts = countByCategory(articles);
  return TARGET_CATEGORIES.some((category) => (counts[category] || 0) < minTargetForCategory(category));
}

function topicPriorityScore(topic) {
  const text = [
    topic?.title || "",
    ...(topic?.categoryHints || []),
    ...(topic?.articles || []).flatMap((article) => [article?.title || "", article?.rawText || ""]),
  ]
    .filter(Boolean)
    .join("\n");

  return editorialPriorityScoreText(text, {
    categoryHints: topic?.categoryHints || [],
  });
}

function compareTopicsByPriority(a, b) {
  const editorial = topicPriorityScore(b) - topicPriorityScore(a);
  if (editorial !== 0) return editorial;

  const sourceCount = (b?.totalSourcesCount || 0) - (a?.totalSourcesCount || 0);
  if (sourceCount !== 0) return sourceCount;

  const da = a?.publishedAt ? new Date(a.publishedAt).getTime() : 0;
  const db = b?.publishedAt ? new Date(b.publishedAt).getTime() : 0;
  return db - da;
}

function createIngestStats() {
  return {
    totalFetched: 0,
    skippedByKeyword: 0,
    skippedByGatekeeper: 0,
    skippedEmptyText: 0,
    gatekeeperErrors: 0,
    accepted: 0,
  };
}

async function ingestFeeds(feeds, ingestStats, label) {
  const rawArticles = [];

  for (const feed of feeds) {
    console.log(`Διαβάζω feed [${label}]:`, feed.url);
    const feedStartedAt = Date.now();
    let rss;
    try {
      rss = await parser.parseURL(feed.url);
    } catch (err) {
      console.error(
        "Σφάλμα στο feed",
        feed.url,
        `(${Date.now() - feedStartedAt}ms)`,
        err?.message || err
      );
      continue;
    }

    const feedItemLimit = Math.max(1, Number(feed.itemLimit || FEED_ITEM_LIMIT));
    const items = (rss.items || []).slice(0, feedItemLimit);
    console.log(`🧾 ${feed.sourceName} [${label}]: ${items.length} items για έλεγχο`);
    let feedProcessed = 0;

    for (const item of items) {
      feedProcessed += 1;
      ingestStats.totalFetched += 1;

      if (feedProcessed % GATEKEEPER_PROGRESS_EVERY === 0 || feedProcessed === items.length) {
        console.log(
          `⏱️ ${feed.sourceName} [${label}]: ${feedProcessed}/${items.length} items (accepted συνολικά: ${ingestStats.accepted})`
        );
      }

      const title = item.title || "";
      const link = item.link || "";
      const descriptionForFilter = stripHtml(
        item.contentSnippet || item.summary || item.content || item.contentEncoded || ""
      );

      if (shouldSkipArticle(title, descriptionForFilter)) {
        ingestStats.skippedByKeyword += 1;
        continue;
      }

      const htmlContent =
        item.contentEncoded ||
        item.content ||
        item.summary ||
        item.contentSnippet ||
        "";

      const rawText = stripHtml(htmlContent);
      if (!rawText) {
        ingestStats.skippedEmptyText += 1;
        continue;
      }

      let gate;
      try {
        gate = await gatekeepNewsArticle({
          title,
          rawText: rawText.slice(0, 4000),
        });
      } catch (err) {
        ingestStats.gatekeeperErrors += 1;
        console.error(
          "❌ Gatekeeper error:",
          title || link || "(χωρίς τίτλο)",
          err?.message || err
        );
        continue;
      }

      if (!gate?.accepted) {
        ingestStats.skippedByGatekeeper += 1;
        continue;
      }

      const publishedAtDate =
        (item.isoDate && new Date(item.isoDate)) ||
        (item.pubDate && new Date(item.pubDate)) ||
        new Date();

      rawArticles.push({
        id: makeArticleId(feed.url, item),
        sourceName: feed.sourceName,
        sourceUrl: link,
        title,
        rawText,
        htmlContent,
        imageUrl: extractImageUrl(item, htmlContent) || null,
        videoUrl: extractVideoUrl(item, htmlContent) || null,
        publishedAt: publishedAtDate.toISOString(),
        categoryHints: Array.isArray(feed.categoryHints) ? feed.categoryHints : [],
      });

      ingestStats.accepted += 1;
    }

    console.log(
      `✅ Ολοκληρώθηκε feed ${feed.sourceName} [${label}] σε ${Date.now() - feedStartedAt}ms`
    );
  }

  return rawArticles;
}

function dedupeAllArticlesInPlace(allArticles) {
  const deduped = dedupeArticlesByUrlOrTitle(allArticles);
  allArticles.length = 0;
  allArticles.push(...deduped);
}

// “φθηνό” guess για να μειώσουμε LLM calls στο backfill
function guessCategoryFromTopic(topic) {
  const hinted =
    (topic.categoryHints || []).find((h) => normalizeCategory(h) !== "other") ||
    null;
  if (hinted) return normalizeCategory(hinted);

  const t = (topic.title || "").toLowerCase();

  // happy
  if (
    /χαρ(ο|ού)μεν|θετικ|καλ(ό|ο) ν(έ|ε)ο|συγκιν|δωρε(ά|α)|εθελον|βραβ(ε|εύ)/i.test(
      t
    )
  )
    return "happy";

  // sports
  if (
    /(αεκ|παοκ|ολυμπιακ|παναθηναϊκ|super league|champions league|europa|conference|γκολ|νικη|ήττα|αγ(ώ|ω)νας|μπασκετ|nba)/i.test(
      t
    )
  )
    return "sports";

  // screen
  if (
    /(ταιν(ί|ι)α|σινεμ(ά|α)|κινηματογρ|box office|netflix|σειρ(ά|α)|streaming|hbo|disney|prime video|apple tv|trailer|ηθοποι|σκηνοθετ|oscar|emmy|cannes|venice|hollywood|marvel)/i.test(
      t
    )
  )
    return "screen";

  // culture
  if (
    /(συναυλ(ί|ι)α|τραγο(ύ|υ)δι|άλμπουμ|μουσικ(ή|η)|θέατρ|παρ(ά|α)σταση|φεστιβ(ά|α)λ|πολιτισμ|μουσε(ί|ι)ο|εκθεσ|βιβλ(ί|ι)ο|λογοτεχν|ποίηση|χορ(ό|ο)|τζαζ|rock|art|gallery)/i.test(
      t
    )
  )
    return "culture";

  // serious = χρήσιμα νέα της καθημερινότητας
  if (
    /(καιρ|κακοκαιρ|δρομολογ|μετρο|λεωφορει|κυκλοφορ|κινηση|μετακινησ|σχολ|πανεπιστη|υγει|νοσοκομ|επιδομ|πληρωμ|συνταξ|εφκα|δυπα|δημοτ|υπηρεσι|πλατφορμ|προθεσμι|λογαριασμ|ενεργει|προγραμμα)/i.test(
      t
    )
  )
    return "serious";

  // fun
  if (
    /(εκδ(ή|η)λωση|β(ό|ο)λτα|εστιατ(ό|ο)ριο|bar|π(ά|a)ρτι|nightlife|διασκ(έ|ε)δαση|festival|club|cocktail|travel|weekend|viral|χορο|party)/i.test(
      t
    )
  )
    return "fun";

  return null;
}

// Ενιαία κατασκευή “final article” από ένα topic (χρησιμοποιείται και στο main και στο backfill)
async function buildFinalArticleFromTopic(topic, { tag = "" } = {}) {
  const result = await simplifyAndClassifyText(topic);
  if (!result || !result.simplifiedText) return null;

  const isSensitive = Boolean(result.isSensitive);
  if (isSensitive) return null;

  const categoryKey =
    result.normalizedCategory || normalizeCategory(result.rawCategory);

  if (!TARGET_CATEGORIES.includes(categoryKey)) return null;

  // 🧹 Αφαιρούμε διπλότυπες πηγές (ίδιο όνομα & link)
  const sourcesMap = new Map();
  for (const a of topic.articles || []) {
    const name = a.sourceName || "Άγνωστη πηγή";
    const url = a.sourceUrl || "";
    const key = name + "|" + url;
    if (!sourcesMap.has(key)) sourcesMap.set(key, { sourceName: name, sourceUrl: url });
  }

  const sourceLinks = Array.from(sourcesMap.values()).map((s) => ({
    title: s.sourceName || "Πηγή",
    url: s.sourceUrl || "",
  }));

  const primary = topic.articles?.[0] || {};

  let mainSourceName = primary.sourceName || "Πηγή";
  let mainSourceUrl = primary.sourceUrl || "";

  if (sourceLinks.length === 1) {
    mainSourceName = sourceLinks[0].title;
    mainSourceUrl = sourceLinks[0].url;
  } else if (sourceLinks.length > 1) {
    mainSourceName = sourceLinks
      .map((s) => s.title)
      .filter(Boolean)
      .join(", ");
    const firstUrl = sourceLinks.find((s) => s.url)?.url || "";
    mainSourceUrl = firstUrl || primary.sourceUrl || "";
  }

  const sourceUrls = sourceLinks.map((s) => s.url).filter(Boolean);
  let sourceDomains = extractSourceDomains(sourceUrls);

  if (!sourceDomains.length && primary.sourceUrl) {
    sourceDomains = extractSourceDomains([primary.sourceUrl]);
  }

  if (!sourceDomains.length) {
    const nameFallbacks = sourceLinks.map((s) => s.title).filter(Boolean);
    if (nameFallbacks.length) sourceDomains = [...new Set(nameFallbacks)];
  }

  // ✅ Κείμενο ΜΟΝΟ της είδησης (χωρίς "Πηγές" μέσα στο text)
  const cleanedText = stripSourcesBlock(cleanSimplifiedText(result.simplifiedText || ""));
  const simpleText = cleanedText;

  if (categoryKey === "serious" && !isUsefulSeriousText(result.simplifiedTitle || topic.title, simpleText)) {
    return null;
  }

  const reason = (result.categoryReason || "").trim();
  const categoryReason = tag ? `${reason}${reason ? " | " : ""}${tag}` : reason;

  return {
    id: topic.id,
    title: topic.title,
    simpleTitle: result.simplifiedTitle || topic.title,
    simpleText,

    sourceName: mainSourceName,
    sourceUrl: mainSourceUrl,
    sourceDomains,
    sources: sourceLinks,

    category: categoryKey,
    categoryReason,
    isSensitive,

    imageUrl: topic.imageUrl || null,
    videoUrl: topic.videoUrl || null,
    publishedAt: topic.publishedAt || null,
  };
}

// RSS-only backfill: συμπληρώνουμε κατηγορίες από single-source topics (χωρίς web search)
async function backfillMissingCategoriesFromTopics(
  allArticles,
  topics,
  usedTopicIds,
  { targetCategories = TARGET_CATEGORIES, tag = "rss_backfill" } = {}
) {
  if (!Array.isArray(topics) || topics.length === 0) {
    console.log("ℹ️ RSS backfill παραλείπεται: δεν υπάρχουν fallback topics.");
    return;
  }

  const counts = countByCategory(allArticles);

  for (const category of targetCategories) {
    const current = counts[category] || 0;
    const minTarget = minTargetForCategory(category);
    const missing = Math.max(0, minTarget - current);
    const availableSlots = Math.max(0, MAX_ARTICLES_PER_CATEGORY - current);
    const toGenerate = Math.min(missing, availableSlots);
    const maxAttemptsForCategory = PRIORITY_LIFESTYLE_CATEGORIES.has(category)
      ? PRIORITY_BACKFILL_MAX_ATTEMPTS
      : BACKFILL_MAX_ATTEMPTS_PER_CATEGORY;
    const useBroadPass = BACKFILL_ALLOW_BROAD_PASS || PRIORITY_LIFESTYLE_CATEGORIES.has(category);

    if (toGenerate <= 0) continue;

    console.log(
      `ℹ️ RSS backfill για την κατηγορία ${category} (λείπουν ${missing} άρθρα για target=${minTarget}).`
    );

    let added = 0;
    let attempts = 0;

    const candidates = [...topics].sort(compareTopicsByPriority);

    const hintCandidates = candidates.filter((t) =>
      (t.categoryHints || []).some((h) => normalizeCategory(h) === category)
    );
    const guessCandidates = candidates.filter((t) => guessCategoryFromTopic(t) === category);
    const likelyCandidatesCount = new Set(
      [...hintCandidates, ...guessCandidates].map((t) => t.id)
    ).size;

    console.log(
      `🧪 Backfill ${category}: πιθανές υποψήφιες=${likelyCandidatesCount}, maxAttempts=${maxAttemptsForCategory}, broadPass=${useBroadPass}`
    );

    // 2 ή 3 περάσματα: hints -> guess -> (προαιρετικά) οποιοδήποτε
    const passes = [
      (t) => (t.categoryHints || []).some((h) => normalizeCategory(h) === category),
      (t) => guessCategoryFromTopic(t) === category,
    ];
    if (useBroadPass) passes.push(() => true);

    for (const pass of passes) {
      for (const topic of candidates) {
        if (added >= toGenerate) break;
        if (attempts >= maxAttemptsForCategory) break;
        if (usedTopicIds.has(topic.id)) continue;
        if (!pass(topic)) continue;

        attempts += 1;
        if (attempts % 3 === 0) {
          console.log(
            `⏱️ Backfill ${category}: προσπάθειες ${attempts}/${maxAttemptsForCategory}`
          );
        }

        try {
          const built = await buildFinalArticleFromTopic(topic, { tag });
          usedTopicIds.add(topic.id);

          if (!built) continue;
          if (built.category !== category) continue; // μπορεί το LLM να το βγάλει αλλού

          allArticles.push(built);
          counts[category] = (counts[category] || 0) + 1;
          added += 1;

          console.log(`✅ Backfill άρθρο για ${category}: ${built.simpleTitle}`);
        } catch (err) {
          console.error(`❌ Αποτυχία RSS backfill για ${category}:`, err?.message || err);
        }
      }
      if (attempts >= maxAttemptsForCategory) {
        console.log(
          `⏹️ Backfill ${category}: έφτασε το όριο προσπαθειών (${maxAttemptsForCategory}).`
        );
        break;
      }
      if (added >= toGenerate) break;
    }
  }
}

// 🧱 Ομαδοποίηση raw άρθρων σε "θέματα" με βάση ΟΜΟΙΟΤΗΤΑ τίτλου
function groupArticlesByTopic(rawArticles) {
  const groups = [];

  function getTitleWordSet(title) {
    const norm = normalizeTitleForGrouping(title);
    if (!norm) return new Set();
    return new Set(
      norm.split(" ").filter((w) => {
        const word = w.trim();
        if (word.length <= 3) return false;
        if (TITLE_STOPWORDS.has(word)) return false;
        return true;
      })
    );
  }

  function similarity(setA, setB) {
    if (setA.size === 0 || setB.size === 0) return 0;
    let intersection = 0;
    for (const w of setA) if (setB.has(w)) intersection++;
    const union = setA.size + setB.size - intersection;
    if (union === 0) return 0;
    return intersection / union;
  }

  for (const article of rawArticles) {
    const titleWords = getTitleWordSet(article.title);
    let bestGroup = null;
    let bestScore = 0;

    for (const group of groups) {
      const score = similarity(titleWords, group.titleWords);
      if (score > bestScore) {
        bestScore = score;
        bestGroup = group;
      }
    }

    if (bestGroup && bestScore >= TITLE_SIMILARITY_THRESHOLD) {
      bestGroup.articles.push(article);
      for (const w of titleWords) bestGroup.titleWords.add(w);
    } else {
      groups.push({
        idSeed: article.id,
        title: article.title,
        titleWords,
        articles: [article],
      });
    }
  }

  const topicGroups = [];

  for (const group of groups) {
    const primary = group.articles[0];

    let latestPublishedAt = primary.publishedAt || null;
    for (const a of group.articles) {
      if (!a.publishedAt) continue;
      if (!latestPublishedAt || new Date(a.publishedAt) > new Date(latestPublishedAt)) {
        latestPublishedAt = a.publishedAt;
      }
    }

    const imageUrl = group.articles.find((a) => a.imageUrl)?.imageUrl || null;
    const videoUrl = group.articles.find((a) => a.videoUrl)?.videoUrl || null;

    const groupId = crypto
      .createHash("sha1")
      .update(group.articles.map((a) => a.id).sort().join("-"))
      .digest("hex")
      .slice(0, 12);

    const hintSet = new Set();
    for (const a of group.articles) {
      if (Array.isArray(a.categoryHints)) {
        for (const h of a.categoryHints) {
          const normalized = normalizeCategory(h);
          if (normalized && normalized !== "other") hintSet.add(normalized);
        }
      }
    }

    const uniqueSources = new Set(
      group.articles
        .map((a) => a.sourceName || a.sourceUrl || "")
        .filter(Boolean)
        .map((s) => s.toLowerCase())
    );

    const totalSourcesCount = uniqueSources.size || 1;
    const isImportant = totalSourcesCount >= 2 || hintSet.size > 0;

    topicGroups.push({
      id: groupId,
      key: group.title,
      title: primary.title,
      articles: group.articles,
      imageUrl,
      videoUrl,
      publishedAt: latestPublishedAt,
      totalSourcesCount,
      isImportant,
      categoryHints: [...hintSet],
    });
  }

  return topicGroups;
}

async function run() {
  const runStartedAt = Date.now();
  const ingestStats = createIngestStats();

  // 1️⃣ Primary Greek pass
  const primaryRawArticles = await ingestFeeds(PRIMARY_GREEK_FEEDS, ingestStats, "primaryGreek");

  if (primaryRawArticles.length === 0) {
    console.warn("Δεν βρέθηκαν raw άρθρα από τα primary Greek feeds.");
  }

  console.log("📊 Ingest stats μετά το primaryGreek:", ingestStats);

  // Μετά τα local + AI filters, ομαδοποιούμε σε "θέματα"
  const topicGroups = groupArticlesByTopic(primaryRawArticles);
  const importantTopicGroups = topicGroups.filter((g) => g.isImportant);
  const fallbackTopicGroups = topicGroups.filter((g) => !g.isImportant);

  console.log(`Βρέθηκαν ${topicGroups.length} θεματικές ομάδες άρθρων.`);
  console.log(
    `Θέματα με ΠΟΛΛΕΣ πηγές: ${importantTopicGroups.length} από ${topicGroups.length}`
  );

  const allArticles = [];
  const usedTopicIds = new Set();

  // 3️⃣ Πρώτα παράγουμε άρθρα από τα “important” topics (πολλαπλές πηγές ή hints)
  const importantSorted = [...importantTopicGroups].sort(compareTopicsByPriority);

  for (const [idx, topic] of importantSorted.entries()) {
    console.log(
      "Απλοποιώ & συνθέτω για θέμα:",
      topic.title,
      `(${idx + 1}/${importantSorted.length})`,
      "| άρθρα στο θέμα:",
      topic.articles.length
    );

    let built = null;
    try {
      built = await buildFinalArticleFromTopic(topic);
    } catch (err) {
      console.error(
        "❌ Αποτυχία σύνθεσης θέματος:",
        topic.title,
        err?.message || err
      );
    }
    usedTopicIds.add(topic.id);
    if (!built) continue;

    allArticles.push(built);
    console.log(`✅ Προστέθηκε άρθρο κατηγορίας ${built.category} στο news.json`);

    if ((idx + 1) % TOPIC_PROGRESS_EVERY === 0 || idx + 1 === importantSorted.length) {
      console.log(`📈 Πρόοδος σύνθεσης: ${idx + 1}/${importantSorted.length} θέματα`);
    }
  }

  // 4️⃣ Dedupe
  dedupeAllArticlesInPlace(allArticles);

  // 5️⃣ RSS-only backfill: συμπληρώνουμε κατηγορίες από single-source topics (χωρίς web search)
  await backfillMissingCategoriesFromTopics(allArticles, fallbackTopicGroups, usedTopicIds, {
    tag: "rss_backfill_primary",
  });

  // 6️⃣ Dedupe ξανά (σε περίπτωση που το backfill έφερε κάτι πολύ κοντινό)
  dedupeAllArticlesInPlace(allArticles);

  // 7️⃣ Αν μετά το dedupe ξαναλείπει κάτι, κάνε ένα ακόμα πέρασμα backfill (χωρίς να “κάψεις” τα ίδια topics)
  if (fallbackTopicGroups.length > 0 && hasMissingCategoryMinimum(allArticles)) {
    await backfillMissingCategoriesFromTopics(allArticles, fallbackTopicGroups, usedTopicIds, {
      tag: "rss_backfill_primary_second_pass",
    });
  } else {
    console.log(
      "ℹ️ Παραλείπεται 2ο backfill pass: δεν χρειάζεται ή δεν υπάρχουν διαθέσιμα fallback topics."
    );
  }

  dedupeAllArticlesInPlace(allArticles);

  const countsAfterPrimary = countByCategory(allArticles);
  console.log("📊 Κατανομή μετά το Greek-first pass:", countsAfterPrimary);

  // 8️⃣ Approved fallback μόνο αν λείπουν lighter κατηγορίες
  if (hasApprovedFallbackGap(countsAfterPrimary, minTargetForCategory)) {
    console.log(
      "🟡 Λείπει υλικό σε happy/screen/culture/fun. Ενεργοποιώ approved fallback feeds."
    );

    const approvedFallbackRawArticles = await ingestFeeds(
      APPROVED_FALLBACK_FEEDS,
      ingestStats,
      "approvedFallback"
    );

    console.log("📊 Ingest stats μετά το approvedFallback:", ingestStats);

    const approvedFallbackTopicGroups = groupArticlesByTopic(approvedFallbackRawArticles);
    if (approvedFallbackTopicGroups.length > 0) {
      await backfillMissingCategoriesFromTopics(
        allArticles,
        approvedFallbackTopicGroups,
        usedTopicIds,
        {
          targetCategories: APPROVED_FALLBACK_CATEGORIES,
          tag: "approved_fallback",
        }
      );

      dedupeAllArticlesInPlace(allArticles);

      const countsAfterFallback = countByCategory(allArticles);
      if (hasApprovedFallbackGap(countsAfterFallback, minTargetForCategory)) {
        await backfillMissingCategoriesFromTopics(
          allArticles,
          approvedFallbackTopicGroups,
          usedTopicIds,
          {
            targetCategories: APPROVED_FALLBACK_CATEGORIES,
            tag: "approved_fallback_second_pass",
          }
        );
        dedupeAllArticlesInPlace(allArticles);
      } else {
        console.log("ℹ️ Το approved fallback γέμισε τις lighter κατηγορίες όσο χρειαζόταν.");
      }
    } else {
      console.log("ℹ️ Δεν προέκυψαν κατάλληλα approved fallback topics.");
    }
  } else {
    console.log("ℹ️ Δεν χρειάστηκε approved fallback. Το Greek-first pass κάλυψε τις κατηγορίες.");
  }

  const finalArticles = [];

  for (const [idx, article] of allArticles.entries()) {
    const base = { ...article };

    base.imageUrl = await resolveArticleImage(base);

    finalArticles.push(base);

    if ((idx + 1) % 10 === 0 || idx + 1 === allArticles.length) {
      console.log(`🖼️ Πρόοδος εικόνων: ${idx + 1}/${allArticles.length}`);
    }
  }

  // ✅ Φτιάχνουμε αντικείμενο με μέχρι MAX_ARTICLES_PER_CATEGORY άρθρα ανά κατηγορία
  const articlesByCategory = buildArticlesByCategory(finalArticles);

  const payload = {
    generatedAt: new Date().toISOString(),
    articles: finalArticles,
    articlesByCategory,
  };

  if (finalArticles.length === 0) {
    try {
      const existingRaw = await fs.readFile(NEWS_JSON_PATH, "utf8");
      const existingPayload = JSON.parse(existingRaw);
      const existingCount = Array.isArray(existingPayload?.articles)
        ? existingPayload.articles.length
        : 0;

      if (existingCount > 0) {
        console.warn(
          `⚠️ Δεν παρήχθησαν άρθρα σε αυτό το run. Κρατάω το υπάρχον news.json (${existingCount} άρθρα).`
        );
        console.log(`🏁 Συνολικός χρόνος run: ${Date.now() - runStartedAt}ms`);
        return;
      }
    } catch {
      // Αν δεν υπάρχει παλιό αρχείο/parseable JSON, συνεχίζουμε και γράφουμε κανονικά.
    }
  }

  await fs.writeFile(NEWS_JSON_PATH, JSON.stringify(payload, null, 2), "utf8");
  console.log(
    "Έγραψα news.json με",
    finalArticles.length,
    "άρθρα συνολικά. Ανά κατηγορία:",
    Object.fromEntries(Object.entries(articlesByCategory).map(([k, v]) => [k, v.length]))
  );
  console.log(`🏁 Συνολικός χρόνος run: ${Date.now() - runStartedAt}ms`);
}

run()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
