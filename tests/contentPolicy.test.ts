import fs from "fs";
import { describe, expect, it } from "vitest";
import {
  editorialPriorityScoreText,
  isUsefulSeriousText,
  shouldSkipArticle,
} from "../llm/editorialPolicy.js";
import {
  APPROVED_FALLBACK_FEEDS,
  PRIMARY_GREEK_FEEDS,
  hasApprovedFallbackGap,
} from "../llm/feedConfig.js";
import { LIFESTYLE_AGENT_SYSTEM_PROMPT } from "../llm/lifestyleAgentPrompts.js";
import { NEWS_CATEGORY_SYSTEM_PROMPT, NEWS_FILTER_PROMPT } from "../llm/newsPrompts.js";
import { SERIOUS_DIGEST_SYSTEM_PROMPT } from "../llm/seriousDigestPrompts.js";

describe("content policy helpers", () => {
  it("rejects violent and martyrdom topics", () => {
    expect(shouldSkipArticle("Δολοφονία σε γειτονιά της Αθήνας", "")).toBe(true);
    expect(
      shouldSkipArticle("Η ιστορία ενός αγίου με βασανιστήρια και εκτέλεση", "")
    ).toBe(true);
  });

  it("prefers practical serious topics over heavy conflict", () => {
    expect(
      isUsefulSeriousText(
        "Πληρωμές από e-ΕΦΚΑ και ΔΥΠΑ αυτή την εβδομάδα",
        "Οι δικαιούχοι θα δουν χρήματα στους λογαριασμούς τους."
      )
    ).toBe(true);

    expect(
      isUsefulSeriousText(
        "Πόλεμος και γεωπολιτική ένταση στη Μέση Ανατολή",
        "Οι δηλώσεις αφορούν στρατιωτική σύγκρουση και διεθνή ένταση."
      )
    ).toBe(false);

    expect(
      editorialPriorityScoreText("Πληρωμές ΔΥΠΑ, μετακινήσεις και καιρός για την εβδομάδα")
    ).toBeGreaterThan(
      editorialPriorityScoreText("Γεωπολιτική ένταση και δικαστική κόντρα")
    );
  });
});

describe("feed policy", () => {
  it("keeps greek-first feeds primary and foreign feeds as approved fallback", () => {
    const primaryUrls = PRIMARY_GREEK_FEEDS.map((feed) => feed.url);
    const fallbackUrls = APPROVED_FALLBACK_FEEDS.map((feed) => feed.url);

    expect(primaryUrls).toContain("https://www.newsbeast.gr/entertainment/feed");
    expect(primaryUrls).toContain("https://www.culturenow.gr/feed/");
    expect(fallbackUrls).toContain("https://deadline.com/feed/");
    expect(fallbackUrls).toContain("https://www.positive.news/feed/");
    expect(primaryUrls).not.toContain("https://deadline.com/feed/");
  });

  it("activates approved fallback only for lighter category gaps", () => {
    const minTargetForCategory = (category: string) =>
      ({
        happy: 2,
        screen: 3,
        culture: 3,
        fun: 3,
      })[category] ?? 2;

    expect(
      hasApprovedFallbackGap(
        { happy: 1, screen: 3, culture: 3, fun: 3 },
        minTargetForCategory
      )
    ).toBe(true);

    expect(
      hasApprovedFallbackGap(
        { happy: 2, screen: 3, culture: 3, fun: 3 },
        minTargetForCategory
      )
    ).toBe(false);
  });
});

describe("prompt and UI regressions", () => {
  it("removes open web-search behavior and keeps SKIP safeguards", () => {
    expect(LIFESTYLE_AGENT_SYSTEM_PROMPT).not.toMatch(/βρες με web search/i);
    expect(LIFESTYLE_AGENT_SYSTEM_PROMPT).not.toMatch(/πρέπει να χρησιμοποιήσεις ΜΟΝΟ web search/i);
    expect(SERIOUS_DIGEST_SYSTEM_PROMPT).not.toMatch(/πρέπει να χρησιμοποιήσεις ΜΟΝΟ web search/i);
    expect(LIFESTYLE_AGENT_SYSTEM_PROMPT).toContain('"SKIP"');
    expect(SERIOUS_DIGEST_SYSTEM_PROMPT).toContain('"SKIP"');
    expect(NEWS_FILTER_PROMPT).toMatch(/πόλεμο/);
    expect(NEWS_CATEGORY_SYSTEM_PROMPT).toMatch(/χρήσιμα νέα/);
  });

  it("shows the public serious label as useful news", () => {
    const indexHtml = fs.readFileSync("static/index.html", "utf8");
    const categoryHtml = fs.readFileSync("static/category.html", "utf8");

    expect(indexHtml).toContain("Χρήσιμα νέα");
    expect(categoryHtml).toContain('serious: "Χρήσιμα νέα"');
  });
});
