import { EditorialRules } from "../config/editorialRules.js";
import {
  ExtractorOutput,
  OpenAIResponsesLike,
  SupportedCategory,
  SupportedCategorySchema,
  TokenUsage,
  TopicGateResult,
  TopicGateReviewSchema,
} from "../types/schemas.js";
import { callStructuredJson } from "../utils/json.js";
import { Logger } from "../utils/logger.js";

export interface TopicGateParams {
  extractorJson: ExtractorOutput;
  editorialRules: EditorialRules;
  logger: Logger;
  client?: OpenAIResponsesLike;
  model?: string;
  enableModelFallback?: boolean;
  maxJsonRetries?: number;
}

export interface TopicGateExecutionResult {
  gate: TopicGateResult;
  attempts: number;
  usage?: TokenUsage;
}

function normalizeCategory(candidate: string): SupportedCategory {
  const normalized = candidate.trim().toLowerCase();
  const parsed = SupportedCategorySchema.safeParse(normalized);
  return parsed.success ? parsed.data : "other";
}

function isOverlyVague(mainTopic: string, summaryFacts: string[]): boolean {
  const wordCount = mainTopic.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount < 2) {
    return true;
  }

  if (summaryFacts.length === 0) {
    return true;
  }

  const genericPatterns = [/news update/i, /latest/i, /various/i, /mixed/i];
  return genericPatterns.some((pattern) => pattern.test(mainTopic));
}

const TOPIC_GATE_DEVELOPER_PROMPT = `
You are an editorial scope gate. Output strict JSON only.
You receive extractor JSON and allowed categories.
Decide if the item should pass editorial gate.
Do not add any facts.
Keep reason_short concise.
`.trim();

export async function topicGate(params: TopicGateParams): Promise<TopicGateExecutionResult> {
  const reasons: string[] = [];
  const flags: string[] = [];
  let accepted = true;
  let category = normalizeCategory(params.extractorJson.category_candidate);
  let usedModelFallback = false;

  if (!params.extractorJson.should_publish_candidate) {
    accepted = false;
    reasons.push("Extractor marked as not publishable");
    flags.push("UNCLEAR_FACTUAL_BASIS");
  }

  if (params.extractorJson.summary_facts.length < 2) {
    accepted = false;
    reasons.push("Too little information in summary facts");
    flags.push("LOW_INFORMATION");
  }

  if (params.extractorJson.sensitive_or_disturbing_content_flag) {
    accepted = false;
    reasons.push("Sensitive or disturbing content");
    flags.push("SENSITIVE_CONTENT");
  }

  if (params.extractorJson.uncertainty_flags.length >= 3) {
    flags.push("HIGH_UNCERTAINTY");
    if (params.extractorJson.summary_facts.length < 3) {
      accepted = false;
      reasons.push("Uncertainty too high for short item");
    }
  }

  if (isOverlyVague(params.extractorJson.main_topic, params.extractorJson.summary_facts)) {
    accepted = false;
    reasons.push("Topic is too vague");
    flags.push("OVERLY_VAGUE");
  }

  if (!params.editorialRules.allowedCategories.includes(category)) {
    accepted = false;
    reasons.push("Outside editorial category scope");
    flags.push("OUTSIDE_SCOPE");
  }

  const needsModelFallback =
    Boolean(params.enableModelFallback) &&
    Boolean(params.client) &&
    Boolean(params.model) &&
    (category === "other" || flags.includes("HIGH_UNCERTAINTY"));

  let usage: TokenUsage | undefined;
  let attempts = 0;

  if (needsModelFallback && params.client && params.model) {
    usedModelFallback = true;
    const fallback = await callStructuredJson({
      client: params.client,
      model: params.model,
      schema: TopicGateReviewSchema,
      schemaName: "topic_gate_review",
      developerPrompt: TOPIC_GATE_DEVELOPER_PROMPT,
      userPrompt: `Allowed categories: ${params.editorialRules.allowedCategories.join(", ")}\n\nExtractor JSON:\n${JSON.stringify(
        params.extractorJson,
      )}`,
      logger: params.logger,
      maxRetries: params.maxJsonRetries ?? 1,
      maxOutputTokens: 500,
    });

    attempts = fallback.attempts;
    usage = fallback.usage;
    accepted = accepted && fallback.data.allow;
    category = fallback.data.category;
    reasons.push(fallback.data.reason_short);
    for (const flag of fallback.data.flags) {
      if (!flags.includes(flag)) {
        flags.push(flag);
      }
    }
  }

  if (reasons.length === 0) {
    reasons.push("Passed deterministic topic gate checks");
  }

  const gate: TopicGateResult = {
    accepted,
    category,
    reasons,
    flags,
    used_model_fallback: usedModelFallback,
  };

  params.logger.info("Topic gate completed", gate);

  return {
    gate,
    attempts,
    usage,
  };
}
