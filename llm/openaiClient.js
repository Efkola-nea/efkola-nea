import OpenAI from "openai";

const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || "45000");
const OPENAI_MAX_RETRIES = Number(process.env.OPENAI_MAX_RETRIES || "1");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: OPENAI_TIMEOUT_MS,
  maxRetries: OPENAI_MAX_RETRIES,
});

export { openai, OPENAI_TIMEOUT_MS, OPENAI_MAX_RETRIES };
