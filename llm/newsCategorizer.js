import { openai } from "./openaiClient.js";
import { NEWS_CATEGORY_SYSTEM_PROMPT } from "./newsPrompts.js";
import { CATEGORY_KEYS } from "./newsCategories.js";

const CATEGORY_SET = new Set(CATEGORY_KEYS);
const FALLBACK_CATEGORY = CATEGORY_KEYS.includes("fun")
  ? "fun"
  : CATEGORY_KEYS[0];

function extractText(response) {
  if (typeof response.output_text === "string") {
    return response.output_text;
  }

  const first = response.output?.[0]?.content?.[0]?.text;
  if (typeof first === "string") return first;
  if (first?.text) return first.text;
  if (first?.value) return first.value;

  throw new Error("Δεν βρέθηκε text στο response του μοντέλου");
}

async function classifyNewsArticle({ title, simpleText, rawText }) {
  const safeTitle = title || "Είδηση";
  const safeSimpleText = simpleText || "";
  const safeRawText = rawText || "";

  const userContent = `Τίτλος: ${safeTitle}\n\nΑπλοποιημένο κείμενο:\n${safeSimpleText}\n\nΑρχικό κείμενο (προαιρετικά):\n${safeRawText}`;

  const response = await openai.responses.create({
    model: "gpt-4o-mini",
    instructions: NEWS_CATEGORY_SYSTEM_PROMPT,
    input: userContent,
    text: {
      format: {
        type: "json_schema",
        name: "news_category",
        schema: {
          type: "object",
          properties: {
            category: { type: "string", enum: CATEGORY_KEYS },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            brief_reason: { type: "string" },
          },
          required: ["category", "confidence", "brief_reason"],
          additionalProperties: false,
        },
        strict: true,
      },
    },
  });

  const text = extractText(response).trim();

  try {
    const parsed = JSON.parse(text);
    const category = typeof parsed.category === "string" ? parsed.category : "";
    const confidence = Number.isFinite(parsed.confidence)
      ? Math.max(0, Math.min(1, Number(parsed.confidence)))
      : 0;
    const briefReason =
      typeof parsed.brief_reason === "string" ? parsed.brief_reason.trim() : "";

    if (CATEGORY_SET.has(category)) {
      return {
        category,
        confidence,
        briefReason: briefReason || "",
        // Backward-compatible alias for existing callers.
        reason: briefReason || "",
      };
    }
  } catch (err) {
    // fall through to fallback
  }

  return {
    category: FALLBACK_CATEGORY,
    confidence: 0,
    briefReason: "JSON parse fallback",
    reason: "JSON parse fallback",
  };
}

export { classifyNewsArticle };
