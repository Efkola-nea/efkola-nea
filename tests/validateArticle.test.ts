import { describe, expect, it } from "vitest";
import { loadEditorialRules } from "../src/config/editorialRules.js";
import { validateArticle } from "../src/steps/validateArticle.js";
import { createLogger } from "../src/utils/logger.js";
import { baseExtractorOutput, baseWriterDraft } from "./fixtures.js";

describe("validateArticle", () => {
  it("catches a hallucinated numeric fact", async () => {
    const draftWithHallucination = {
      ...baseWriterDraft,
      paragraphs: [
        ...baseWriterDraft.paragraphs.slice(0, 2),
        "Το σχέδιο, σύμφωνα με το άρθρο, θα καλύψει 999 κτίρια σε όλη την πόλη.",
      ],
    };

    const result = await validateArticle({
      extractorJson: baseExtractorOutput,
      draft: draftWithHallucination,
      category: "local",
      editorialRules: loadEditorialRules(),
      logger: createLogger("test", "error"),
    });

    expect(result.validatorJson.pass).toBe(false);
    expect(result.validatorJson.violations).toContain("HALLUCINATED_FACT");
    expect(result.validatorJson.must_retry_writer).toBe(true);
  });
});
