export interface ModelConfig {
  extractorModel: string;
  writerModel: string;
  validatorModel: string;
  topicGateModel: string;
  maxJsonRetries: number;
  maxRepairRetries: number;
}

const DEFAULT_MAX_JSON_RETRIES = 2;
const DEFAULT_MAX_REPAIR_RETRIES = 1;

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

export function loadModelConfig(env: NodeJS.ProcessEnv = process.env): ModelConfig {
  const extractorModel = env.EXTRACTOR_MODEL ?? "gpt-5.4-mini";
  const writerModel = env.WRITER_MODEL ?? "gpt-5.4";
  const validatorModel = env.VALIDATOR_MODEL ?? "gpt-5.4-mini";

  return {
    extractorModel,
    writerModel,
    validatorModel,
    topicGateModel: env.TOPIC_GATE_MODEL ?? validatorModel,
    maxJsonRetries: parseNumber(env.MAX_JSON_RETRIES, DEFAULT_MAX_JSON_RETRIES),
    maxRepairRetries: parseNumber(env.MAX_REPAIR_RETRIES, DEFAULT_MAX_REPAIR_RETRIES),
  };
}
