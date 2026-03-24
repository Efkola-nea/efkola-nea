import { describe, expect, it, vi } from "vitest";
import { extractFacts } from "../src/steps/extractFacts.js";
import { ExtractorOutputSchema, OpenAIResponsesLike } from "../src/types/schemas.js";
import { createLogger } from "../src/utils/logger.js";
import { baseExtractorOutput } from "./fixtures.js";

describe("extractFacts", () => {
  it("returns valid extractor schema", async () => {
    const fakeClient: OpenAIResponsesLike = {
      responses: {
        create: vi.fn().mockResolvedValue({
          id: "resp_test_extractor",
          output_text: JSON.stringify(baseExtractorOutput),
          usage: {
            input_tokens: 100,
            output_tokens: 120,
            total_tokens: 220,
          },
        }),
      },
    };

    const result = await extractFacts({
      client: fakeClient,
      model: "gpt-5.4-mini",
      cleanedSource: "Ο δήμος ανακοίνωσε πρόγραμμα καθαρής ενέργειας με προϋπολογισμό 5 εκατ. ευρώ.",
      logger: createLogger("test", "error"),
      maxJsonRetries: 0,
    });

    expect(ExtractorOutputSchema.parse(result.extractorJson)).toEqual(baseExtractorOutput);
    expect(result.attempts).toBe(1);
  });
});
