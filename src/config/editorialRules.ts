import { SupportedCategory } from "../types/schemas.js";

export type ArticleLengthBand = "short" | "medium";
export type ReadingSimplicityTarget = "very_simple" | "simple" | "plain";

export interface EditorialRules {
  language: "el";
  tone: "neutral_calm";
  noClickbait: boolean;
  noSensationalism: boolean;
  oneIdeaPerSentencePreferred: boolean;
  readingSimplicityTarget: ReadingSimplicityTarget;
  maxParagraphLengthChars: number;
  maxSentenceLengthChars: number;
  articleLengthBand: ArticleLengthBand;
  allowedCategories: SupportedCategory[];
}

const DEFAULT_ALLOWED_CATEGORIES: SupportedCategory[] = [
  "politics",
  "world",
  "economy",
  "science",
  "technology",
  "health",
  "environment",
  "culture",
  "sports",
  "local",
  "other",
];

const defaultRules: EditorialRules = {
  language: "el",
  tone: "neutral_calm",
  noClickbait: true,
  noSensationalism: true,
  oneIdeaPerSentencePreferred: true,
  readingSimplicityTarget: "simple",
  maxParagraphLengthChars: 320,
  maxSentenceLengthChars: 150,
  articleLengthBand: "medium",
  allowedCategories: DEFAULT_ALLOWED_CATEGORIES,
};

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

function parseLengthBand(value: string | undefined): ArticleLengthBand | undefined {
  if (!value) {
    return undefined;
  }

  if (value === "short" || value === "medium") {
    return value;
  }

  return undefined;
}

function parseSimplicity(value: string | undefined): ReadingSimplicityTarget | undefined {
  if (!value) {
    return undefined;
  }

  if (value === "very_simple" || value === "simple" || value === "plain") {
    return value;
  }

  return undefined;
}

export function loadEditorialRules(env: NodeJS.ProcessEnv = process.env): EditorialRules {
  return {
    ...defaultRules,
    readingSimplicityTarget: parseSimplicity(env.READING_SIMPLICITY_TARGET) ?? defaultRules.readingSimplicityTarget,
    maxParagraphLengthChars: parsePositiveInt(env.MAX_PARAGRAPH_CHARS, defaultRules.maxParagraphLengthChars),
    maxSentenceLengthChars: parsePositiveInt(env.MAX_SENTENCE_CHARS, defaultRules.maxSentenceLengthChars),
    articleLengthBand: parseLengthBand(env.ARTICLE_LENGTH_BAND) ?? defaultRules.articleLengthBand,
  };
}

export function mergeEditorialRules(base: EditorialRules, overrides?: Partial<EditorialRules>): EditorialRules {
  if (!overrides) {
    return base;
  }

  return {
    ...base,
    ...overrides,
    allowedCategories: overrides.allowedCategories ?? base.allowedCategories,
  };
}

export const DefaultEditorialRules = defaultRules;
