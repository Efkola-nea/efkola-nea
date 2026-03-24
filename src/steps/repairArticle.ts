import { EditorialRules } from "../config/editorialRules.js";
import {
  ExtractorOutput,
  OpenAIResponsesLike,
  SupportedCategory,
  TokenUsage,
  ValidatorOutput,
  WriterDraft,
  WriterDraftSchema,
} from "../types/schemas.js";
import { callStructuredJson } from "../utils/json.js";
import { Logger } from "../utils/logger.js";

export interface RepairArticleParams {
  client?: OpenAIResponsesLike;
  model?: string;
  currentDraft: WriterDraft;
  validatorJson: ValidatorOutput;
  extractorJson: ExtractorOutput;
  category: SupportedCategory;
  editorialRules: EditorialRules;
  logger: Logger;
  maxJsonRetries?: number;
}

export interface RepairArticleResult {
  draft: WriterDraft;
  usedModel: boolean;
  attempts: number;
  usage?: TokenUsage;
  rawText: string;
}

const REPAIR_DEVELOPER_PROMPT = `
You are a targeted repair editor.
You receive:
- previous draft JSON
- validator JSON
- extractor JSON
- category and editorial constraints

Rules:
- Fix only the issues listed in validator violations/repair_instructions.
- Preserve valid content and structure.
- Keep factual fidelity to extractor JSON.
- Keep Greek simple and neutral.
- Do not regenerate from scratch.
- Return strict JSON matching schema only.
`.trim();

function splitSentenceByComma(sentence: string, maxChars: number): string[] {
  if (sentence.length <= maxChars) {
    return [sentence.trim()];
  }

  const parts = sentence
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length <= 1) {
    return [sentence.trim()];
  }

  const rebuilt: string[] = [];
  let buffer = "";

  for (const part of parts) {
    const candidate = buffer ? `${buffer}, ${part}` : part;
    if (candidate.length <= maxChars) {
      buffer = candidate;
      continue;
    }

    if (buffer) {
      rebuilt.push(buffer.trim());
    }
    buffer = part;
  }

  if (buffer) {
    rebuilt.push(buffer.trim());
  }

  if (rebuilt.length === 0) {
    return [sentence.trim()];
  }

  const finalChunks: string[] = [];
  for (const chunk of rebuilt) {
    if (chunk.length <= maxChars) {
      finalChunks.push(chunk);
      continue;
    }

    const words = chunk.split(/\s+/).filter(Boolean);
    let wordBuffer = "";
    for (const word of words) {
      const candidate = wordBuffer ? `${wordBuffer} ${word}` : word;
      if (candidate.length <= maxChars) {
        wordBuffer = candidate;
        continue;
      }

      if (wordBuffer) {
        finalChunks.push(wordBuffer.trim());
      }
      wordBuffer = word;
    }

    if (wordBuffer) {
      finalChunks.push(wordBuffer.trim());
    }
  }

  return finalChunks.length > 0 ? finalChunks : [sentence.trim()];
}

function splitLongSentences(text: string, maxChars: number): string {
  const terminateSentence = (chunk: string): string => {
    const trimmed = chunk.trim();
    if (/[.!;]$/.test(trimmed)) {
      return trimmed;
    }
    if (trimmed.length >= maxChars) {
      return `${trimmed.slice(0, maxChars - 1)}.`;
    }
    return `${trimmed}.`;
  };

  const sentences = text
    .split(/(?<=[.!;])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  const normalized: string[] = [];
  for (const sentence of sentences) {
    if (sentence.length <= maxChars) {
      normalized.push(sentence);
      continue;
    }

    const chunks = splitSentenceByComma(sentence, maxChars);
    for (const chunk of chunks) {
      normalized.push(terminateSentence(chunk));
    }
  }

  return normalized.join(" ");
}

function splitLongParagraph(paragraph: string, maxChars: number): string[] {
  if (paragraph.length <= maxChars) {
    return [paragraph.trim()];
  }

  const sentences = paragraph
    .split(/(?<=[.!;])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }

    if (current) {
      chunks.push(current.trim());
    }
    current = sentence;
  }

  if (current) {
    chunks.push(current.trim());
  }

  return chunks.length > 0 ? chunks : [paragraph.trim()];
}

function simplifyGreekStyle(text: string): string {
  const replacements: Array<[RegExp, string]> = [
    [/συνεπώς/gi, "έτσι"],
    [/ωστόσο/gi, "όμως"],
    [/προκειμένου να/gi, "για να"],
    [/ως εκ τούτου/gi, "για αυτό"],
  ];

  let output = text;
  for (const [pattern, replacement] of replacements) {
    output = output.replace(pattern, replacement);
  }
  return output;
}

function addMissingTermExplanations(draft: WriterDraft, extractorJson: ExtractorOutput): WriterDraft {
  const allText = [draft.lead, ...draft.paragraphs, draft.what_it_means ?? ""].join(" ");
  let paragraphList = [...draft.paragraphs];

  for (const term of extractorJson.difficult_terms) {
    const termPattern = new RegExp(`\\b${term.term}\\b`, "i");
    if (!termPattern.test(allText)) {
      continue;
    }

    const explanationPattern = new RegExp(term.simple_explanation, "i");
    if (explanationPattern.test(allText)) {
      continue;
    }

    const firstParagraphIndex = paragraphList.findIndex((paragraph) => termPattern.test(paragraph));
    if (firstParagraphIndex >= 0) {
      paragraphList[firstParagraphIndex] = paragraphList[firstParagraphIndex].replace(
        termPattern,
        `${term.term} (${term.simple_explanation})`,
      );
    }
  }

  return {
    ...draft,
    paragraphs: paragraphList,
  };
}

function applyRuleBasedRepair(params: RepairArticleParams): WriterDraft {
  const violations = new Set(params.validatorJson.violations);
  let repaired: WriterDraft = {
    ...params.currentDraft,
    paragraphs: [...params.currentDraft.paragraphs],
  };

  if (violations.has("LOW_SIMPLICITY")) {
    repaired = {
      ...repaired,
      lead: simplifyGreekStyle(repaired.lead),
      paragraphs: repaired.paragraphs.map(simplifyGreekStyle),
      what_it_means: repaired.what_it_means ? simplifyGreekStyle(repaired.what_it_means) : undefined,
    };
  }

  if (violations.has("SENTENCE_TOO_LONG")) {
    repaired = {
      ...repaired,
      lead: splitLongSentences(repaired.lead, params.editorialRules.maxSentenceLengthChars),
      paragraphs: repaired.paragraphs.map((paragraph) =>
        splitLongSentences(paragraph, params.editorialRules.maxSentenceLengthChars),
      ),
      what_it_means: repaired.what_it_means
        ? splitLongSentences(repaired.what_it_means, params.editorialRules.maxSentenceLengthChars)
        : undefined,
    };
  }

  if (violations.has("PARAGRAPH_TOO_LONG")) {
    const expandedParagraphs: string[] = [];
    for (const paragraph of repaired.paragraphs) {
      expandedParagraphs.push(...splitLongParagraph(paragraph, params.editorialRules.maxParagraphLengthChars));
    }
    repaired = {
      ...repaired,
      paragraphs: expandedParagraphs.slice(0, 5),
    };
  }

  if (violations.has("UNEXPLAINED_TERM")) {
    repaired = addMissingTermExplanations(repaired, params.extractorJson);
  }

  return WriterDraftSchema.parse(repaired);
}

function needsModelRepair(violations: string[]): boolean {
  const modelOnlyIssues = new Set([
    "FACT_MISMATCH",
    "HALLUCINATED_FACT",
    "CATEGORY_MISMATCH",
    "NON_NEUTRAL_TONE",
    "SENSATIONALISM",
  ]);

  return violations.some((issue) => modelOnlyIssues.has(issue));
}

export async function repairArticle(params: RepairArticleParams): Promise<RepairArticleResult> {
  params.logger.info("Repair stage started", {
    violations: params.validatorJson.violations,
  });

  const ruleBasedDraft = applyRuleBasedRepair(params);
  const shouldUseModel = Boolean(params.client && params.model && needsModelRepair(params.validatorJson.violations));

  if (!shouldUseModel || !params.client || !params.model) {
    params.logger.info("Repair stage completed with rule-based fixes only");
    return {
      draft: ruleBasedDraft,
      usedModel: false,
      attempts: 0,
      rawText: JSON.stringify(ruleBasedDraft),
      usage: undefined,
    };
  }

  const modelResult = await callStructuredJson({
    client: params.client,
    model: params.model,
    schema: WriterDraftSchema,
    schemaName: "repair_writer_draft",
    developerPrompt: REPAIR_DEVELOPER_PROMPT,
    userPrompt: `
Category: ${params.category}
Editorial rules:
- max_sentence_length_chars: ${params.editorialRules.maxSentenceLengthChars}
- max_paragraph_length_chars: ${params.editorialRules.maxParagraphLengthChars}
- reading_simplicity_target: ${params.editorialRules.readingSimplicityTarget}

Extractor JSON:
${JSON.stringify(params.extractorJson)}

Validator JSON:
${JSON.stringify(params.validatorJson)}

Current draft JSON:
${JSON.stringify(ruleBasedDraft)}
`.trim(),
    logger: params.logger,
    maxRetries: params.maxJsonRetries ?? 1,
    maxOutputTokens: 1200,
    temperature: 0.1,
  });

  params.logger.info("Repair stage completed with model pass", {
    attempts: modelResult.attempts,
  });

  return {
    draft: modelResult.data,
    usedModel: true,
    attempts: modelResult.attempts,
    usage: modelResult.usage,
    rawText: modelResult.rawText,
  };
}
