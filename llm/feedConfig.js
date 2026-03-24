const PRIMARY_GREEK_FEEDS = [
  { url: "https://www.ertnews.gr/feed", sourceName: "ERT News" },
  { url: "https://www.kathimerini.gr/infeeds/rss/nx-rss-feed.xml", sourceName: "Kathimerini" },
  { url: "https://www.tanea.gr/feed", sourceName: "TA NEA" },
  { url: "https://www.tovima.gr/feed", sourceName: "TO BHMA" },
  { url: "https://www.news.gr/rss.ashx", sourceName: "News.gr" },
  { url: "https://www.902.gr/feed/featured", sourceName: "902.gr – Επιλεγμένα" },
  { url: "https://www.protagon.gr/feed", sourceName: "Protagon" },
  {
    url: "https://thehappynews.gr/feed/",
    sourceName: "The Happy News",
    categoryHints: ["happy"],
    itemLimit: 12,
  },
  {
    url: "https://www.culturenow.gr/feed/",
    sourceName: "CultureNow",
    categoryHints: ["culture"],
    itemLimit: 14,
  },
  {
    url: "https://www.newsbeast.gr/media/feed",
    sourceName: "Newsbeast Media",
    categoryHints: ["screen"],
    itemLimit: 12,
  },
  {
    url: "https://www.newsbeast.gr/entertainment/feed",
    sourceName: "Newsbeast Entertainment",
    categoryHints: ["fun", "screen"],
    itemLimit: 12,
  },
  {
    url: "https://www.newsbeast.gr/lifestyle/feed",
    sourceName: "Newsbeast Lifestyle",
    categoryHints: ["fun", "happy"],
    itemLimit: 12,
  },
  {
    url: "https://www.newsbeast.gr/travel/feed",
    sourceName: "Newsbeast Travel",
    categoryHints: ["fun"],
    itemLimit: 10,
  },
];

const APPROVED_FALLBACK_FEEDS = [
  { url: "https://www.nme.com/feed/", sourceName: "NME", categoryHints: ["culture"], itemLimit: 12 },
  { url: "https://pitchfork.com/feed/feed-news/rss", sourceName: "Pitchfork", categoryHints: ["culture"], itemLimit: 12 },
  {
    url: "https://www.rollingstone.com/music/music-news/feed/",
    sourceName: "Rolling Stone Music",
    categoryHints: ["culture"],
    itemLimit: 12,
  },
  { url: "https://www.billboard.com/feed/", sourceName: "Billboard", categoryHints: ["culture"], itemLimit: 12 },
  { url: "https://deadline.com/feed/", sourceName: "Deadline", categoryHints: ["screen"], itemLimit: 12 },
  { url: "https://variety.com/feed/", sourceName: "Variety", categoryHints: ["screen"], itemLimit: 12 },
  {
    url: "https://www.hollywoodreporter.com/feed/",
    sourceName: "Hollywood Reporter",
    categoryHints: ["screen"],
    itemLimit: 12,
  },
  {
    url: "https://www.cinemablend.com/rss",
    sourceName: "CinemaBlend",
    categoryHints: ["screen"],
    itemLimit: 12,
  },
  {
    url: "https://www.goodnewsnetwork.org/feed/",
    sourceName: "Good News Network",
    categoryHints: ["happy"],
  },
  {
    url: "https://www.positive.news/feed/",
    sourceName: "Positive News UK",
    categoryHints: ["happy"],
    itemLimit: 14,
  },
];

const APPROVED_FALLBACK_CATEGORIES = ["happy", "screen", "culture", "fun"];

function hasApprovedFallbackGap(counts, minTargetForCategory) {
  return APPROVED_FALLBACK_CATEGORIES.some(
    (category) => (counts[category] || 0) < minTargetForCategory(category)
  );
}

export {
  APPROVED_FALLBACK_CATEGORIES,
  APPROVED_FALLBACK_FEEDS,
  PRIMARY_GREEK_FEEDS,
  hasApprovedFallbackGap,
};
