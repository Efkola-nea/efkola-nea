import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { OpenAIResponsesLike, TokenUsage } from "../types/schemas.js";
import { Logger } from "./logger.js";

export interface StructuredJsonRequest<TSchema extends z.ZodTypeAny> {
  client: OpenAIResponsesLike;
  model: string;
  schema: TSchema;
  schemaName: string;
  developerPrompt: string;
  userPrompt: string;
  logger: Logger;
  maxRetries?: number;
  maxOutputTokens?: number;
  temperature?: number;
}

export interface StructuredJsonResult<T> {
  data: T;
  rawText: string;
  attempts: number;
  responseId?: string;
  usage?: TokenUsage;
}

function extractJsonCandidate(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    return trimmed;
  }

  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (codeBlockMatch?.[1]) {
    return codeBlockMatch[1].trim();
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return null;
}

export function parseJsonWithSchema<TSchema extends z.ZodTypeAny>(
  raw: string,
  schema: TSchema,
): z.infer<TSchema> {
  const candidate = extractJsonCandidate(raw);
  if (!candidate) {
    throw new Error("No JSON candidate in model output");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch (error) {
    throw new Error(
      `JSON parse failed: ${error instanceof Error ? error.message : "unknown parse error"}`,
    );
  }

  const validated = schema.safeParse(parsed);
  if (!validated.success) {
    const details = validated.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Schema validation failed: ${details}`);
  }

  return validated.data;
}

export function toCompactJson(value: unknown): string {
  return JSON.stringify(value);
}

export async function callStructuredJson<TSchema extends z.ZodTypeAny>(
  request: StructuredJsonRequest<TSchema>,
): Promise<StructuredJsonResult<z.infer<TSchema>>> {
  const attempts = Math.max(1, (request.maxRetries ?? 2) + 1);
  let lastError: Error | undefined;
  let lastOutput = "";

  for (let index = 0; index < attempts; index += 1) {
    const attemptNumber = index + 1;
    const isRetry = attemptNumber > 1;
    request.logger.debug("Structured JSON call attempt", {
      model: request.model,
      schema: request.schemaName,
      attempt: attemptNumber,
    });

    const retrySuffix = isRetry
      ? `\n\nPrevious output was invalid. Return valid JSON only.\nPrevious output:\n${lastOutput}\nValidation error:\n${lastError?.message ?? "unknown"}`
      : "";

    const response = await request.client.responses.create({
      model: request.model,
      input: [
        { role: "developer", content: request.developerPrompt },
        { role: "user", content: `${request.userPrompt}${retrySuffix}` },
      ],
      text: {
        format: zodTextFormat(request.schema, request.schemaName),
      },
      temperature: request.temperature ?? 0,
      max_output_tokens: request.maxOutputTokens,
    });

    const rawText = response.output_text ?? "";
    lastOutput = rawText;

    try {
      const data = parseJsonWithSchema(rawText, request.schema);
      const usage = response.usage
        ? {
            input_tokens: response.usage.input_tokens,
            output_tokens: response.usage.output_tokens,
            total_tokens: response.usage.total_tokens,
          }
        : undefined;

      return {
        data,
        rawText,
        attempts: attemptNumber,
        responseId: response.id,
        usage,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Unknown JSON parsing error");
      request.logger.warn("Structured JSON parse failed", {
        attempt: attemptNumber,
        error: lastError.message,
      });
    }
  }

  throw new Error(
    `Failed to produce valid JSON after ${attempts} attempts. Last error: ${lastError?.message ?? "unknown"}`,
  );
}
