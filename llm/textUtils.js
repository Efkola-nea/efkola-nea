// llm/textUtils.js
// Common text helpers for simplifying, sources formatting, and web-search source ranking.

const SOURCE_LABEL_BY_DOMAIN = {
  "ertnews.gr": "ERT News",
  "tanea.gr": "TA NEA",
  "tovima.gr": "TO BHMA",
  "news.gr": "News.gr",
  "902.gr": "902.gr",
  "newsbomb.gr": "Newsbomb.gr",
  "protagon.gr": "Protagon",
  "greekreporter.com": "Greek Reporter",
  "thehappynews.gr": "The Happy News",

  "sport24.gr": "Sport24",
  "gazzetta.gr": "Gazzetta",
  "in.gr": "in.gr",
  "kathimerini.gr": "Kathimerini",
  "cnn.gr": "CNN Greece",
  "amna.gr": "ΑΠΕ-ΜΠΕ",
  "reuters.com": "Reuters",
  "uefa.com": "UEFA",
};

function cleanSimplifiedText(text) {
  return (text || "")
    // Αφαίρεση markdown links [κείμενο](url)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, "$1")
    // Αφαίρεση σκέτων URLs
    .replace(/https?:\/\/\S+/g, "")
    // Καθάρισμα πολλών κενών
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function extractHostname(url) {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    // Αν ήδη δίνεις domain χωρίς scheme
    return String(url).replace(/^www\./i, "").toLowerCase().trim();
  }
}

function extractSourceDomains(urls) {
  if (!Array.isArray(urls)) return [];

  const domains = urls
    .map((u) => {
      try {
        const hostname = new URL(u).hostname || "";
        return hostname.replace(/^www\./, "");
      } catch {
        // Αν είναι ήδη domain
        const raw = String(u || "").trim();
        if (!raw) return null;
        return raw.replace(/^www\./, "");
      }
    })
    .filter(Boolean);

  return [...new Set(domains)];
}

function sourceLabelFromDomain(domain) {
  const host = extractHostname(domain);
  return SOURCE_LABEL_BY_DOMAIN[host] || host || "Πηγή";
}

/**
 * Footer πηγών χωρίς URLs, σε bullets + 🌍
 * Δέχεται είτε domains είτε URLs.
 */
function buildSourcesFooter(domainsOrUrls, options = {}) {
  if (!domainsOrUrls || domainsOrUrls.length === 0) return "";

  const emoji = options.emoji ?? "🌍";
  const title = options.title ?? "Πηγές";

  // Αν πέρασαν URLs, τα κάνουμε domains
  const domains = extractSourceDomains(domainsOrUrls);

  const labels = domains
    .map((d) => sourceLabelFromDomain(d))
    .filter(Boolean);

  const uniq = [...new Set(labels)];
  if (uniq.length === 0) return "";

  const lines = uniq.map((l) => `- ${l}`).join("\n");
  return `\n\n${emoji} ${title}\n${lines}`;
}

function getWebSearchDateContext(baseDate = new Date()) {
  const today = new Date(baseDate);
  today.setHours(0, 0, 0, 0);

  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  const formatter = new Intl.DateTimeFormat("el-GR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return {
    today,
    yesterday,
    tomorrow,
    todayLabel: formatter.format(today),
    yesterdayLabel: formatter.format(yesterday),
    tomorrowLabel: formatter.format(tomorrow),
  };
}

function normalizeTitle(title) {
  return (title || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[«»"“”']/g, "")
    .trim();
}

function dedupeArticlesByUrlOrTitle(articles) {
  const seenUrls = new Set();
  const seenTitles = new Set();

  const result = [];

  for (const art of articles || []) {
    const url = (art.url || art.link || art.sourceUrl || "").trim();
    const normTitle = normalizeTitle(art.title || "");

    const urlKey = url.toLowerCase();
    const titleKey = normTitle;

    const isDuplicateByUrl = urlKey && seenUrls.has(urlKey);
    const isDuplicateByTitle = titleKey && seenTitles.has(titleKey);

    if (isDuplicateByUrl || isDuplicateByTitle) {
      continue;
    }

    if (urlKey) seenUrls.add(urlKey);
    if (titleKey) seenTitles.add(titleKey);

    result.push(art);
  }

  return result;
}

// Normalize greek/latin text: lowercase, strip accents, trim extra spaces
function normalizeText(text) {
  return (text || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function pickKeywords(text, limit = 6) {
  const stop = new Set([
    "και",
    "στις",
    "στο",
    "στη",
    "στην",
    "στον",
    "των",
    "με",
    "για",
    "σε",
    "του",
    "της",
    "το",
    "η",
    "οι",
    "τα",
    "ένα",
    "μια",
    "ενός",
    "μία",
  ]);

  const words = normalizeText(text)
    .split(/[^a-zα-ωάέίόύήώ0-9]+/i)
    .filter((w) => w && w.length > 2 && !stop.has(w));

  const uniq = [];
  for (const w of words) {
    if (!uniq.includes(w)) uniq.push(w);
    if (uniq.length >= limit) break;
  }
  return uniq;
}

function buildSearchQuery(article) {
  const headline =
    article?.title || article?.simpleTitle || article?.headline || "Είδηση";

  const summary = article?.summary || article?.simpleText || "";
  const combined = `${headline}\n${summary}`;
  const keywords = pickKeywords(combined, 6);

  let eventDate = article?.publishedAt || article?.date || article?.eventDate;
  if (eventDate) {
    try {
      eventDate = new Date(eventDate).toISOString().slice(0, 10);
    } catch {
      eventDate = undefined;
    }
  }

  const query = `${headline} ${keywords.join(" ")} ${eventDate || ""}`.trim();

  return { query, entities: keywords, eventDate };
}

function filterSearchResults(results, articleEntities, eventDate, options = {}) {
  const blocklist = (options.blocklist || [
    "inside track",
    "opinion",
    "column",
    "gallery",
  ]).map((w) => normalizeText(w));

  const normalizedEntities = (articleEntities || [])
    .map((e) => normalizeText(e))
    .filter((e) => e && e.length > 2);

  const windowDaysPrimary = options.windowDays || 7;
  const windowDaysFallback = options.windowDaysFallback || 14;

  const accepted = [];
  const rejected = [];

  const checkWindow = (published, windowDays) => {
    if (!eventDate || !published) return { ok: true, diffDays: null };
    const event = new Date(eventDate);
    const pub = new Date(published);
    if (Number.isNaN(event) || Number.isNaN(pub))
      return { ok: true, diffDays: null };
    const diffDays = Math.abs((pub - event) / (1000 * 60 * 60 * 24));
    return { ok: diffDays <= windowDays, diffDays };
  };

  const evaluate = (windowLimit, subset) => {
    const list = subset ?? results ?? [];
    for (const res of list) {
      const title = res?.title || res?.name || "";
      const snippet = res?.snippet || res?.description || res?.summary || "";
      const url = res?.url || res?.link || res?.sourceUrl || "";
      const publishedAt = res?.publishedAt || res?.published_date || res?.date;
      const text = normalizeText(`${title} ${snippet}`);

      const blocklisted = blocklist.some((b) => b && text.includes(b));
      if (blocklisted) {
        rejected.push({ url, reason: "blocklist" });
        continue;
      }

      let matches = 0;
      for (const ent of normalizedEntities) {
        if (ent && text.includes(ent)) matches += 1;
      }

      if (matches === 0) {
        rejected.push({ url, reason: "no_entity" });
        continue;
      }

      if (matches < 2) {
        rejected.push({ url, reason: "low_match" });
        continue;
      }

      const { ok, diffDays } = checkWindow(publishedAt, windowLimit);
      if (!ok) {
        rejected.push({ url, reason: "date_window" });
        continue;
      }

      accepted.push({
        title: title || url || "Πηγή",
        snippet,
        url,
        publishedAt,
        matchCount: matches,
        diffDays,
        host: extractHostname(url),
      });
    }
  };

  evaluate(windowDaysPrimary);

  if (accepted.length < 2 && eventDate) {
    // Δοκίμασε πιο χαλαρό χρονικό παράθυρο
    const dateRejectedUrls = new Set(
      rejected.filter((r) => r.reason === "date_window").map((r) => r.url)
    );

    const relaxed = (results || []).filter((res) => {
      const url = res?.url || res?.link || res?.sourceUrl || "";
      return dateRejectedUrls.has(url);
    });

    evaluate(windowDaysFallback, relaxed);
  }

  return { accepted, rejected };
}

function rankAndDedupe(results, options = {}) {
  const whitelist = new Set(options.whitelistDomains || []);
  const max = options.max || 4;
  const seen = new Set();

  const scored = (results || []).map((r) => {
    const host = extractHostname(r.url) || r.host || "";
    const whitelistBonus = whitelist.has(host) ? 5 : 0;
    const matchScore = (r.matchCount || 0) * 10;
    const recencyScore = Number.isFinite(r.diffDays)
      ? Math.max(0, 14 - Math.abs(r.diffDays))
      : 0;

    return {
      ...r,
      host,
      score: matchScore + recencyScore + whitelistBonus,
    };
  });

  const sorted = scored.sort((a, b) => b.score - a.score);

  const deduped = [];
  for (const r of sorted) {
    const key = r.host || r.url || r.title;
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(r);
    if (deduped.length >= max) break;
  }

  return deduped;
}

// Extract web search sources from a Responses API payload
function extractWebSearchSources(response) {
  const items = [];

  if (Array.isArray(response?.output_items)) {
    items.push(...response.output_items);
  }

  if (Array.isArray(response?.output)) {
    for (const out of response.output) {
      if (!out) continue;
      if (out.type === "web_search_call") {
        items.push(out);
      }
      if (Array.isArray(out.content)) {
        items.push(...out.content);
      }
    }
  }

  const calls = items.filter((item) => item?.type === "web_search_call");

  const mapped = calls
    .flatMap((call) => call?.action?.sources || [])
    .filter(Boolean)
    .map((src) => {
      const url = src.url || src.link || src.sourceUrl || "";
      const title =
        src.publisher ||
        src.title ||
        src.name ||
        (url ? url : "Πηγή");
      const snippet = src.snippet || src.description || src.summary || "";
      const publishedAt = src.publishedAt || src.published_date || src.date;

      return {
        title,
        url,
        snippet,
        publishedAt,
        host: extractHostname(url),
      };
    });

  const seen = new Set();
  const unique = [];

  for (const src of mapped) {
    const key = (src.url || src.title || "").toLowerCase();
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    unique.push(src);
  }

  return unique;
}

export {
  cleanSimplifiedText,
  extractSourceDomains,
  buildSourcesFooter,
  getWebSearchDateContext,
  normalizeTitle,
  dedupeArticlesByUrlOrTitle,
  normalizeText,
  extractHostname,
  buildSearchQuery,
  filterSearchResults,
  rankAndDedupe,
  extractWebSearchSources,
};
