import { ExtractorOutput, ExtractorOutputSchema, OpenAIResponsesLike, TokenUsage } from "../types/schemas.js";
import { callStructuredJson, toCompactJson } from "../utils/json.js";
import { Logger } from "../utils/logger.js";

export interface ExtractFactsParams {
  client: OpenAIResponsesLike;
  model: string;
  cleanedSource: string;
  logger: Logger;
  maxJsonRetries?: number;
}

export interface ExtractFactsResult {
  extractorJson: ExtractorOutput;
  attempts: number;
  usage?: TokenUsage;
  rawText: string;
}

const EXTRACTOR_DEVELOPER_PROMPT = `
You are an extractor. Output strict JSON only.
Do not write article prose.
Do not invent missing details.
Use only evidence from the provided source text.
When information is uncertain or missing, mark it in uncertainty_flags and keep wording explicit.

Schema intent:
- headline_from_source: source headline or closest exact headline fragment
- main_topic: one short phrase
- category_candidate: one of politics, world, economy, science, technology, health, environment, culture, sports, local, other
- summary_facts: short factual bullets, each one fact
- who/what/when/where/why: concise factual strings, use "Δεν είναι σαφές" when missing
- key_numbers: structured number facts (label, value, context or null)
- uncertainty_flags: explicit uncertainties and missing context
- sensitive_or_disturbing_content_flag: true only for clearly disturbing content
- difficult_terms: terms that may confuse average readers, with plain explanations
- source_confidence_notes: short confidence note based on source clarity
- should_publish_candidate: true when information is clear and useful
- publish_reasoning_short: short reason for publish candidate decision

Return valid JSON and nothing else.
`.trim();

export async function extractFacts(params: ExtractFactsParams): Promise<ExtractFactsResult> {
  params.logger.info("Extractor stage started", {
    model: params.model,
    sourceChars: params.cleanedSource.length,
  });

  const result = await callStructuredJson({
    client: params.client,
    model: params.model,
    schema: ExtractorOutputSchema,
    schemaName: "extractor_output",
    developerPrompt: EXTRACTOR_DEVELOPER_PROMPT,
    userPrompt: `Extract from this cleaned source article:\n\n${params.cleanedSource}`,
    logger: params.logger,
    maxRetries: params.maxJsonRetries ?? 2,
    maxOutputTokens: 1400,
  });

  params.logger.info("Extractor stage completed", {
    attempts: result.attempts,
    summaryFacts: result.data.summary_facts.length,
    publishCandidate: result.data.should_publish_candidate,
  });

  params.logger.debug("Extractor JSON", {
    extractorJson: toCompactJson(result.data),
  });

  return {
    extractorJson: result.data,
    attempts: result.attempts,
    usage: result.usage,
    rawText: result.rawText,
  };
}
