import { describe, expect, it } from "vitest";
import { loadEditorialRules } from "../src/config/editorialRules.js";
import { repairArticle } from "../src/steps/repairArticle.js";
import { createLogger } from "../src/utils/logger.js";
import { baseExtractorOutput, baseWriterDraft, baseValidatorOutput } from "./fixtures.js";

function maxSentenceLength(text: string): number {
  const sentences = text
    .split(/(?<=[.!;])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  return sentences.reduce((max, sentence) => Math.max(max, sentence.length), 0);
}

describe("repairArticle", () => {
  it("fixes simplicity and long sentence violations with targeted edits", async () => {
    const problematicDraft = {
      ...baseWriterDraft,
      lead: "Το νέο πρόγραμμα, το οποίο σχεδιάστηκε από πολλές υπηρεσίες και περιλαμβάνει αρκετές τεχνικές λεπτομέρειες, θα εφαρμοστεί σύντομα και συνεπώς αναμένεται να έχει σημαντική επίδραση στους λογαριασμούς του δήμου.",
    };

    const validatorJson = {
      ...baseValidatorOutput,
      pass: false,
      must_retry_writer: true,
      violations: ["SENTENCE_TOO_LONG", "LOW_SIMPLICITY"],
      human_readable_feedback: ["Η πρώτη πρόταση είναι πολύ μεγάλη και σύνθετη."],
      repair_instructions: ["Σπάσε τη μεγάλη πρόταση και απλοποίησε το ύφος."],
    };

    const editorialRules = {
      ...loadEditorialRules(),
      maxSentenceLengthChars: 90,
    };

    const result = await repairArticle({
      currentDraft: problematicDraft,
      validatorJson,
      extractorJson: baseExtractorOutput,
      category: "local",
      editorialRules,
      logger: createLogger("test", "error"),
    });

    expect(result.usedModel).toBe(false);
    expect(maxSentenceLength(result.draft.lead)).toBeLessThanOrEqual(editorialRules.maxSentenceLengthChars);
    expect(result.draft.lead.toLowerCase()).not.toContain("συνεπώς");
  });
});
