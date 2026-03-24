import { z } from "zod";

export const SupportedCategorySchema = z.enum([
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
]);

export type SupportedCategory = z.infer<typeof SupportedCategorySchema>;

export const KeyNumberSchema = z
  .object({
    label: z.string().min(1),
    value: z.string().min(1),
    context: z.string().min(1).nullable(),
  })
  .strict();

export const DifficultTermSchema = z
  .object({
    term: z.string().min(1),
    simple_explanation: z.string().min(1),
  })
  .strict();

export const ExtractorOutputSchema = z
  .object({
    headline_from_source: z.string().min(1),
    main_topic: z.string().min(1),
    category_candidate: z.string().min(1),
    summary_facts: z.array(z.string().min(1)).min(1),
    who: z.string().min(1),
    what: z.string().min(1),
    when: z.string().min(1),
    where: z.string().min(1),
    why: z.string().min(1),
    key_numbers: z.array(KeyNumberSchema),
    uncertainty_flags: z.array(z.string().min(1)),
    sensitive_or_disturbing_content_flag: z.boolean(),
    difficult_terms: z.array(DifficultTermSchema),
    source_confidence_notes: z.string().min(1),
    should_publish_candidate: z.boolean(),
    publish_reasoning_short: z.string().min(1),
  })
  .strict();

export type ExtractorOutput = z.infer<typeof ExtractorOutputSchema>;

export const WriterDraftSchema = z
  .object({
    title: z.string().min(1),
    lead: z.string().min(1),
    paragraphs: z.array(z.string().min(1)).min(3).max(5),
    what_it_means: z.string().min(1).optional(),
  })
  .strict();

export type WriterDraft = z.infer<typeof WriterDraftSchema>;

export const ValidationIssueCodeSchema = z
  .enum([
    "FACT_MISMATCH",
    "HALLUCINATED_FACT",
    "SENTENCE_TOO_LONG",
    "PARAGRAPH_TOO_LONG",
    "UNEXPLAINED_TERM",
    "NON_NEUTRAL_TONE",
    "SENSATIONALISM",
    "CATEGORY_MISMATCH",
    "LOW_READABILITY",
    "LOW_NATURALNESS",
    "LOW_SIMPLICITY",
    "LOW_INFORMATION",
    "STYLE_TOO_ACADEMIC",
    "OTHER",
  ])
  .or(z.string().min(1));

export const ValidatorScoresSchema = z
  .object({
    fidelity: z.number().int().min(1).max(5),
    simplicity: z.number().int().min(1).max(5),
    readability: z.number().int().min(1).max(5),
    naturalness: z.number().int().min(1).max(5),
    policy_fit: z.number().int().min(1).max(5),
  })
  .strict();

export const ValidatorOutputSchema = z
  .object({
    pass: z.boolean(),
    scores: ValidatorScoresSchema,
    violations: z.array(ValidationIssueCodeSchema),
    human_readable_feedback: z.array(z.string().min(1)).min(1),
    repair_instructions: z.array(z.string().min(1)).min(1),
    must_retry_writer: z.boolean(),
  })
  .strict();

export type ValidatorOutput = z.infer<typeof ValidatorOutputSchema>;

export const TopicGateReviewSchema = z
  .object({
    allow: z.boolean(),
    category: SupportedCategorySchema,
    reason_short: z.string().min(1),
    flags: z.array(z.string().min(1)),
  })
  .strict();

export type TopicGateReview = z.infer<typeof TopicGateReviewSchema>;

export const TopicGateResultSchema = z
  .object({
    accepted: z.boolean(),
    category: SupportedCategorySchema,
    reasons: z.array(z.string().min(1)),
    flags: z.array(z.string().min(1)),
    used_model_fallback: z.boolean(),
  })
  .strict();

export type TopicGateResult = z.infer<typeof TopicGateResultSchema>;

export const TokenUsageSchema = z
  .object({
    input_tokens: z.number().int().nonnegative().optional(),
    output_tokens: z.number().int().nonnegative().optional(),
    total_tokens: z.number().int().nonnegative().optional(),
  })
  .strict();

export type TokenUsage = z.infer<typeof TokenUsageSchema>;

export const StageUsageMapSchema = z.record(z.string(), TokenUsageSchema.optional());

export const PipelineMetadataSchema = z
  .object({
    started_at: z.string().min(1),
    completed_at: z.string().min(1),
    duration_ms: z.number().nonnegative(),
    models: z
      .object({
        extractor: z.string().min(1),
        writer: z.string().min(1),
        validator: z.string().min(1),
      })
      .strict(),
    stage_timings_ms: z.record(z.string(), z.number().nonnegative()),
    stage_usage: StageUsageMapSchema,
    feature_flags: z
      .object({
        enable_validator: z.boolean(),
        enable_repair: z.boolean(),
        enable_topic_gate_model_fallback: z.boolean(),
      })
      .strict(),
  })
  .strict();

export type PipelineMetadata = z.infer<typeof PipelineMetadataSchema>;

export const FinalPipelineOutputSchema = z
  .object({
    final_article: z.string(),
    final_title: z.string(),
    category: SupportedCategorySchema,
    extractor_json: ExtractorOutputSchema,
    validator_json: ValidatorOutputSchema.nullable(),
    pipeline_metadata: PipelineMetadataSchema,
    retry_count: z.number().int().nonnegative(),
    publishability_flag: z.boolean(),
  })
  .strict();

export type FinalPipelineOutput = z.infer<typeof FinalPipelineOutputSchema>;

export type ResponseLike = {
  id?: string;
  output_text?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
};

export interface OpenAIResponsesLike {
  responses: {
    create: (params: any) => Promise<ResponseLike>;
  };
}
