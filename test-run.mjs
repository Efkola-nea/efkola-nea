#!/usr/bin/env node
// Dry-run script: runs the real pipeline with reduced scope.
// Usage: OPENAI_API_KEY=<key> node test-run.mjs
//
// Options (via env vars):
//   TEST_MAX_FEEDS=2          Number of feeds to use (default: 2)
//   TEST_MAX_ITEMS=5          Max items per feed (default: 5)
//   TEST_MAX_TOPICS=3         Max important topics to process (default: 3)
//   TEST_OUTPUT=stdout        "stdout" to print, or a file path (default: static/news-test.json)

import { run, FEEDS } from "./fetch-news.mjs";

const maxFeeds = Number(process.env.TEST_MAX_FEEDS || "2");
const maxItems = Number(process.env.TEST_MAX_ITEMS || "5");
const maxTopics = Number(process.env.TEST_MAX_TOPICS || "3");
const output = process.env.TEST_OUTPUT || "static/news-test.json";

const selectedFeeds = FEEDS.slice(0, maxFeeds);

console.log(`🧪 Test run: ${selectedFeeds.length} feeds, ${maxItems} items/feed, ${maxTopics} topics max`);
console.log(`   Feeds: ${selectedFeeds.map((f) => f.sourceName).join(", ")}`);
console.log(`   Output: ${output}\n`);

run({
  feeds: selectedFeeds,
  maxItemsPerFeed: maxItems,
  maxImportantTopics: maxTopics,
  skipBackfill: true,
  skipImages: true,
  outputPath: output === "stdout" ? undefined : new URL(`./${output}`, import.meta.url),
  dryRun: output === "stdout",
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
