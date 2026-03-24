import { EditorialRules } from "../config/editorialRules.js";
import {
  ExtractorOutput,
  OpenAIResponsesLike,
  SupportedCategory,
  TokenUsage,
  WriterDraft,
  WriterDraftSchema,
} from "../types/schemas.js";
import { callStructuredJson } from "../utils/json.js";
import { Logger } from "../utils/logger.js";

export interface WriteArticleParams {
  client: OpenAIResponsesLike;
  model: string;
  extractorJson: ExtractorOutput;
  category: SupportedCategory;
  editorialRules: EditorialRules;
  logger: Logger;
  maxJsonRetries?: number;
}

export interface WriteArticleResult {
  draft: WriterDraft;
  attempts: number;
  usage?: TokenUsage;
  rawText: string;
}

const WRITER_DEVELOPER_PROMPT = `
You are a Greek news writer for an easy-to-read information site.
Output strict JSON only and follow schema.

Writing requirements:
- Greek language.
- Short sentences.
- Simple vocabulary.
- One idea per sentence when possible.
- Neutral and calm tone.
- No clickbait, no dramatic framing.
- No unsupported claims.
- Keep fidelity to extractor JSON only.
- Explain difficult terms in plain language only when needed.
- Avoid robotic repetition and bureaucratic phrasing.

Structure:
- title
- lead: 1-2 short sentences
- paragraphs: 3 to 5 short paragraphs
- optional what_it_means section only when useful

Do not mention that an AI wrote this.
Do not include markdown.
Return JSON only.
`.trim();

function lengthBandHint(lengthBand: EditorialRules["articleLengthBand"]): string {
  if (lengthBand === "short") {
    return "Aim for roughly 120-180 words total.";
  }
  return "Aim for roughly 180-320 words total.";
}

export function renderArticle(draft: WriterDraft): string {
  const sections = [draft.lead, ...draft.paragraphs];

  if (draft.what_it_means) {
    sections.push(`Τι σημαίνει αυτό;\\n${draft.what_it_means}`);
  }

  return sections.join("\\n\\n");
}

export async function writeArticle(params: WriteArticleParams): Promise<WriteArticleResult> {
  params.logger.info("Writer stage started", {
    model: params.model,
    category: params.category,
  });

  const result = await callStructuredJson({
    client: params.client,
    model: params.model,
    schema: WriterDraftSchema,
    schemaName: "writer_article_draft",
    developerPrompt: WRITER_DEVELOPER_PROMPT,
    userPrompt: `
Category: ${params.category}
Editorial rules:
- reading_simplicity_target: ${params.editorialRules.readingSimplicityTarget}
- max_sentence_length_chars: ${params.editorialRules.maxSentenceLengthChars}
- max_paragraph_length_chars: ${params.editorialRules.maxParagraphLengthChars}
- article_length_band: ${params.editorialRules.articleLengthBand}
- tone: ${params.editorialRules.tone}
- no_clickbait: ${params.editorialRules.noClickbait}
- no_sensationalism: ${params.editorialRules.noSensationalism}
- one_idea_per_sentence_preferred: ${params.editorialRules.oneIdeaPerSentencePreferred}

Length guidance: ${lengthBandHint(params.editorialRules.articleLengthBand)}

Extractor JSON:
${JSON.stringify(params.extractorJson)}
`.trim(),
    logger: params.logger,
    maxRetries: params.maxJsonRetries ?? 2,
    maxOutputTokens: 1400,
    temperature: 0.2,
  });

  params.logger.info("Writer stage completed", {
    attempts: result.attempts,
    paragraphs: result.data.paragraphs.length,
  });

  return {
    draft: result.data,
    attempts: result.attempts,
    usage: result.usage,
    rawText: result.rawText,
  };
}
