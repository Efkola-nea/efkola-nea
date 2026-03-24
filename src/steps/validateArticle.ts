import { EditorialRules } from "../config/editorialRules.js";
import {
  ExtractorOutput,
  OpenAIResponsesLike,
  SupportedCategory,
  TokenUsage,
  ValidatorOutput,
  ValidatorOutputSchema,
  WriterDraft,
} from "../types/schemas.js";
import { callStructuredJson } from "../utils/json.js";
import { Logger } from "../utils/logger.js";

export interface ValidateArticleParams {
  client?: OpenAIResponsesLike;
  model?: string;
  extractorJson: ExtractorOutput;
  draft: WriterDraft;
  category: SupportedCategory;
  editorialRules: EditorialRules;
  logger: Logger;
  maxJsonRetries?: number;
}

export interface ValidateArticleResult {
  validatorJson: ValidatorOutput;
  attempts: number;
  usage?: TokenUsage;
  rawText: string;
}

const VALIDATOR_DEVELOPER_PROMPT = `
You are a strict article validator.
You must validate the draft article against extractor JSON and editorial rules.
Return strict JSON only.
Do not rewrite the full article.
Do not produce a new draft.

Validation dimensions:
- factual fidelity to extractor JSON
- simplicity of language
- sentence length and paragraph length constraints
- unexplained difficult terms
- neutral tone and no sensationalism
- no hallucinated facts
- category fit
- readability and naturalness

When you find issues, give targeted repair instructions only.
`.trim();

const SENSATIONAL_WORDS = ["σοκ", "τρομακτικό", "απίστευτο", "καταστροφή", "πανικός"];

function collectDraftText(draft: WriterDraft): string {
  return [draft.title, draft.lead, ...draft.paragraphs, draft.what_it_means ?? ""]
    .join(" ")
    .trim();
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!;])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function numbersFromText(text: string): string[] {
  return [...text.matchAll(/\d+(?:[.,]\d+)?/g)].map((match) => match[0]);
}

function deterministicChecks(params: ValidateArticleParams): {
  violations: string[];
  feedback: string[];
  repairInstructions: string[];
} {
  const violations = new Set<string>();
  const feedback: string[] = [];
  const repairInstructions: string[] = [];

  const allParagraphs = [params.draft.lead, ...params.draft.paragraphs];
  const allSentences = splitSentences(allParagraphs.join(" "));

  for (const sentence of allSentences) {
    if (sentence.length > params.editorialRules.maxSentenceLengthChars) {
      violations.add("SENTENCE_TOO_LONG");
      feedback.push("Υπάρχουν προτάσεις που είναι πολύ μεγάλες.");
      repairInstructions.push("Σπάσε τις πολύ μεγάλες προτάσεις σε πιο μικρές.");
      break;
    }
  }

  for (const paragraph of allParagraphs) {
    if (paragraph.length > params.editorialRules.maxParagraphLengthChars) {
      violations.add("PARAGRAPH_TOO_LONG");
      feedback.push("Υπάρχουν παράγραφοι που είναι πολύ μεγάλες.");
      repairInstructions.push("Σπάσε τις μεγάλες παραγράφους σε μικρότερες.");
      break;
    }
  }

  const draftText = collectDraftText(params.draft).toLowerCase();
  if (SENSATIONAL_WORDS.some((word) => draftText.includes(word))) {
    violations.add("SENSATIONALISM");
    feedback.push("Ο τόνος γίνεται δραματικός σε ορισμένα σημεία.");
    repairInstructions.push("Αντικατάστησε δραματικές λέξεις με ουδέτερες εκφράσεις.");
  }

  const extractorNumbers = new Set(
    numbersFromText(
      [
        ...params.extractorJson.summary_facts,
        ...params.extractorJson.key_numbers.map((entry) => `${entry.label} ${entry.value}`),
      ].join(" "),
    ),
  );
  const draftNumbers = numbersFromText(collectDraftText(params.draft));
  // TODO(production): use semantic claim alignment instead of literal number matching to reduce false positives.
  const unknownNumbers = draftNumbers.filter((value) => !extractorNumbers.has(value));
  if (unknownNumbers.length > 0 && extractorNumbers.size > 0) {
    violations.add("HALLUCINATED_FACT");
    feedback.push(`Βρέθηκαν αριθμοί που δεν υπάρχουν στην εξαγωγή: ${unknownNumbers.join(", ")}.`);
    repairInstructions.push("Αφαίρεσε αριθμούς που δεν υπάρχουν στο extractor JSON.");
  }

  return {
    violations: [...violations],
    feedback,
    repairInstructions,
  };
}

function buildDeterministicOnlyResult(checks: ReturnType<typeof deterministicChecks>): ValidatorOutput {
  const hasIssues = checks.violations.length > 0;
  const fallbackFeedback =
    checks.feedback.length > 0 ? checks.feedback : ["Δεν βρέθηκαν κρίσιμα ζητήματα από τους κανόνες."];
  const fallbackInstructions =
    checks.repairInstructions.length > 0
      ? checks.repairInstructions
      : ["Δεν απαιτείται στοχευμένη επιδιόρθωση."];

  return {
    pass: !hasIssues,
    scores: {
      fidelity: hasIssues ? 3 : 5,
      simplicity: hasIssues ? 3 : 5,
      readability: hasIssues ? 3 : 5,
      naturalness: hasIssues ? 4 : 5,
      policy_fit: hasIssues ? 3 : 5,
    },
    violations: hasIssues ? checks.violations : [],
    human_readable_feedback: fallbackFeedback,
    repair_instructions: fallbackInstructions,
    must_retry_writer: hasIssues,
  };
}

function mergeValidationOutputs(
  modelOutput: ValidatorOutput,
  deterministic: ReturnType<typeof deterministicChecks>,
): ValidatorOutput {
  const mergedViolations = new Set<string>(modelOutput.violations);
  for (const issue of deterministic.violations) {
    mergedViolations.add(issue);
  }

  const mergedFeedback = [...modelOutput.human_readable_feedback, ...deterministic.feedback];
  const mergedInstructions = [...modelOutput.repair_instructions, ...deterministic.repairInstructions];
  const hasIssues = mergedViolations.size > 0;

  return {
    ...modelOutput,
    pass: modelOutput.pass && !hasIssues,
    violations: [...mergedViolations],
    human_readable_feedback:
      mergedFeedback.length > 0 ? mergedFeedback : ["Δεν βρέθηκαν κρίσιμα ζητήματα."],
    repair_instructions:
      mergedInstructions.length > 0 ? mergedInstructions : ["Δεν απαιτείται επιδιόρθωση."],
    must_retry_writer: modelOutput.must_retry_writer || hasIssues,
  };
}

export async function validateArticle(params: ValidateArticleParams): Promise<ValidateArticleResult> {
  params.logger.info("Validator stage started", {
    model: params.model ?? "deterministic-only",
  });

  const deterministic = deterministicChecks(params);

  if (!params.client || !params.model) {
    const validatorJson = buildDeterministicOnlyResult(deterministic);
    params.logger.info("Validator stage completed without model", {
      violations: validatorJson.violations.length,
    });
    return {
      validatorJson,
      attempts: 0,
      rawText: JSON.stringify(validatorJson),
      usage: undefined,
    };
  }

  const modelResult = await callStructuredJson({
    client: params.client,
    model: params.model,
    schema: ValidatorOutputSchema,
    schemaName: "validator_output",
    developerPrompt: VALIDATOR_DEVELOPER_PROMPT,
    userPrompt: `
Category: ${params.category}
Rules:
- max_sentence_length_chars: ${params.editorialRules.maxSentenceLengthChars}
- max_paragraph_length_chars: ${params.editorialRules.maxParagraphLengthChars}
- reading_simplicity_target: ${params.editorialRules.readingSimplicityTarget}
- tone: ${params.editorialRules.tone}

Extractor JSON:
${JSON.stringify(params.extractorJson)}

Draft JSON:
${JSON.stringify(params.draft)}
`.trim(),
    logger: params.logger,
    maxRetries: params.maxJsonRetries ?? 2,
    maxOutputTokens: 900,
  });

  const validatorJson = mergeValidationOutputs(modelResult.data, deterministic);
  params.logger.info("Validator stage completed", {
    violations: validatorJson.violations.length,
    pass: validatorJson.pass,
  });

  return {
    validatorJson,
    attempts: modelResult.attempts,
    usage: modelResult.usage,
    rawText: modelResult.rawText,
  };
}
