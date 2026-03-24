import { mergeEditorialRules, loadEditorialRules, EditorialRules } from "../config/editorialRules.js";
import { loadModelConfig, ModelConfig } from "../config/models.js";
import { cleanSource } from "../steps/cleanSource.js";
import { extractFacts } from "../steps/extractFacts.js";
import { repairArticle } from "../steps/repairArticle.js";
import { topicGate } from "../steps/topicGate.js";
import { validateArticle } from "../steps/validateArticle.js";
import { renderArticle, writeArticle } from "../steps/writeArticle.js";
import {
  FinalPipelineOutput,
  FinalPipelineOutputSchema,
  OpenAIResponsesLike,
  SupportedCategory,
  ValidatorOutput,
} from "../types/schemas.js";
import { Logger, createLogger } from "../utils/logger.js";

export interface PipelineFeatureFlags {
  enableValidator: boolean;
  enableRepair: boolean;
  enableTopicGateModelFallback: boolean;
}

export interface RunPipelineParams {
  client: OpenAIResponsesLike;
  sourceArticle: string;
  preferredCategory?: SupportedCategory;
  editorialRules?: Partial<EditorialRules>;
  modelConfig?: Partial<ModelConfig>;
  featureFlags?: Partial<PipelineFeatureFlags>;
  logger?: Logger;
}

const DEFAULT_FEATURE_FLAGS: PipelineFeatureFlags = {
  enableValidator: true,
  enableRepair: true,
  enableTopicGateModelFallback: true,
};

function resolveFeatureFlags(overrides?: Partial<PipelineFeatureFlags>): PipelineFeatureFlags {
  return {
    ...DEFAULT_FEATURE_FLAGS,
    ...(overrides ?? {}),
  };
}

function resolveModelConfig(overrides?: Partial<ModelConfig>): ModelConfig {
  return {
    ...loadModelConfig(),
    ...(overrides ?? {}),
  };
}

export async function runPipeline(params: RunPipelineParams): Promise<FinalPipelineOutput> {
  const logger = params.logger ?? createLogger("runPipeline", (process.env.LOG_LEVEL as any) ?? "info");
  const startedAt = new Date();
  // TODO(production): attach a request trace ID and propagate it across all stage logs.
  const featureFlags = resolveFeatureFlags(params.featureFlags);
  const modelConfig = resolveModelConfig(params.modelConfig);
  const editorialRules = mergeEditorialRules(loadEditorialRules(), params.editorialRules);

  const stageTimingsMs: Record<string, number> = {};
  const stageUsage: Record<
    string,
    { input_tokens?: number; output_tokens?: number; total_tokens?: number } | undefined
  > = {};

  const stageStart = (stage: string): number => {
    logger.info(`${stage} started`);
    return Date.now();
  };

  const stageEnd = (stage: string, started: number): void => {
    const duration = Date.now() - started;
    stageTimingsMs[stage] = duration;
    logger.info(`${stage} completed`, { duration_ms: duration });
  };

  const cleanStart = stageStart("clean_source");
  const cleaned = cleanSource(params.sourceArticle);
  stageEnd("clean_source", cleanStart);

  const extractStart = stageStart("extract_facts");
  const extracted = await extractFacts({
    client: params.client,
    model: modelConfig.extractorModel,
    cleanedSource: cleaned.cleanedText,
    logger: logger.child("extractFacts"),
    maxJsonRetries: modelConfig.maxJsonRetries,
  });
  stageUsage.extract_facts = extracted.usage;
  stageEnd("extract_facts", extractStart);

  const gateStart = stageStart("topic_gate");
  const gateResult = await topicGate({
    extractorJson: extracted.extractorJson,
    editorialRules,
    logger: logger.child("topicGate"),
    enableModelFallback: featureFlags.enableTopicGateModelFallback,
    client: params.client,
    model: modelConfig.topicGateModel,
    maxJsonRetries: modelConfig.maxJsonRetries,
  });
  if (gateResult.usage) {
    stageUsage.topic_gate = gateResult.usage;
  }
  stageEnd("topic_gate", gateStart);

  const chosenCategory = params.preferredCategory ?? gateResult.gate.category;
  if (!gateResult.gate.accepted) {
    const completedAt = new Date();
    const output: FinalPipelineOutput = {
      final_article: "",
      final_title: extracted.extractorJson.headline_from_source,
      category: chosenCategory,
      extractor_json: extracted.extractorJson,
      validator_json: null,
      retry_count: 0,
      publishability_flag: false,
      pipeline_metadata: {
        started_at: startedAt.toISOString(),
        completed_at: completedAt.toISOString(),
        duration_ms: completedAt.getTime() - startedAt.getTime(),
        models: {
          extractor: modelConfig.extractorModel,
          writer: modelConfig.writerModel,
          validator: modelConfig.validatorModel,
        },
        stage_timings_ms: stageTimingsMs,
        stage_usage: stageUsage,
        feature_flags: {
          enable_validator: featureFlags.enableValidator,
          enable_repair: featureFlags.enableRepair,
          enable_topic_gate_model_fallback: featureFlags.enableTopicGateModelFallback,
        },
      },
    };

    return FinalPipelineOutputSchema.parse(output);
  }

  const writeStart = stageStart("write_article");
  let writerResult = await writeArticle({
    client: params.client,
    model: modelConfig.writerModel,
    extractorJson: extracted.extractorJson,
    category: chosenCategory,
    editorialRules,
    logger: logger.child("writeArticle"),
    maxJsonRetries: modelConfig.maxJsonRetries,
  });
  stageUsage.write_article = writerResult.usage;
  stageEnd("write_article", writeStart);

  let validatorJson: ValidatorOutput | null = null;
  let retryCount = 0;

  if (featureFlags.enableValidator) {
    const validateStart = stageStart("validate_article");
    const validationResult = await validateArticle({
      client: params.client,
      model: modelConfig.validatorModel,
      extractorJson: extracted.extractorJson,
      draft: writerResult.draft,
      category: chosenCategory,
      editorialRules,
      logger: logger.child("validateArticle"),
      maxJsonRetries: modelConfig.maxJsonRetries,
    });
    validatorJson = validationResult.validatorJson;
    stageUsage.validate_article = validationResult.usage;
    stageEnd("validate_article", validateStart);

    while (
      featureFlags.enableRepair &&
      validatorJson &&
      !validatorJson.pass &&
      validatorJson.must_retry_writer &&
      retryCount < modelConfig.maxRepairRetries
    ) {
      retryCount += 1;

      const repairStart = stageStart(`repair_article_${retryCount}`);
      const repairResult = await repairArticle({
        client: params.client,
        model: modelConfig.writerModel,
        currentDraft: writerResult.draft,
        validatorJson,
        extractorJson: extracted.extractorJson,
        category: chosenCategory,
        editorialRules,
        logger: logger.child(`repairArticle#${retryCount}`),
        maxJsonRetries: modelConfig.maxJsonRetries,
      });
      writerResult = {
        ...writerResult,
        draft: repairResult.draft,
        usage: repairResult.usage ?? writerResult.usage,
      };
      stageUsage[`repair_article_${retryCount}`] = repairResult.usage;
      stageEnd(`repair_article_${retryCount}`, repairStart);

      const revalidateStart = stageStart(`validate_article_${retryCount}`);
      const revalidation = await validateArticle({
        client: params.client,
        model: modelConfig.validatorModel,
        extractorJson: extracted.extractorJson,
        draft: writerResult.draft,
        category: chosenCategory,
        editorialRules,
        logger: logger.child(`validateArticle#${retryCount}`),
        maxJsonRetries: modelConfig.maxJsonRetries,
      });
      validatorJson = revalidation.validatorJson;
      stageUsage[`validate_article_${retryCount}`] = revalidation.usage;
      stageEnd(`validate_article_${retryCount}`, revalidateStart);
    }
  }

  const finalArticle = renderArticle(writerResult.draft);
  const publishabilityFlag = gateResult.gate.accepted && (validatorJson ? validatorJson.pass : true);
  const completedAt = new Date();

  const output: FinalPipelineOutput = {
    final_article: finalArticle,
    final_title: writerResult.draft.title,
    category: chosenCategory,
    extractor_json: extracted.extractorJson,
    validator_json: validatorJson,
    retry_count: retryCount,
    publishability_flag: publishabilityFlag,
    pipeline_metadata: {
      started_at: startedAt.toISOString(),
      completed_at: completedAt.toISOString(),
      duration_ms: completedAt.getTime() - startedAt.getTime(),
      models: {
        extractor: modelConfig.extractorModel,
        writer: modelConfig.writerModel,
        validator: modelConfig.validatorModel,
      },
      stage_timings_ms: stageTimingsMs,
      stage_usage: stageUsage,
      feature_flags: {
        enable_validator: featureFlags.enableValidator,
        enable_repair: featureFlags.enableRepair,
        enable_topic_gate_model_fallback: featureFlags.enableTopicGateModelFallback,
      },
    },
  };

  logger.info("Pipeline finished", {
    publishability: output.publishability_flag,
    retries: output.retry_count,
  });

  return FinalPipelineOutputSchema.parse(output);
}
