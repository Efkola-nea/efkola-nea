import { openai } from "./openaiClient.js";
import { NEWS_FILTER_PROMPT } from "./newsPrompts.js";

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

function normalizeVerdict(text) {
  const t = String(text || "")
    .trim()
    .toUpperCase()
    .replace(/["'`]/g, "");
  if (/^ACCEPT\b/.test(t)) return "ACCEPT";
  if (/^REJECT\b/.test(t)) return "REJECT";
  return null;
}

async function gatekeepNewsArticle({ title, rawText }) {
  const safeTitle = title || "Είδηση";
  const safeText = rawText || "";

  const userContent = `Τίτλος: ${safeTitle}\n\nΚείμενο:\n${safeText}`;

  const response = await openai.responses.create({
    model: "gpt-4o-mini",
    instructions: NEWS_FILTER_PROMPT,
    input: userContent,
    max_output_tokens: 20,
  });

  const verdict = normalizeVerdict(extractText(response));
  if (verdict === "ACCEPT") {
    return { accepted: true, verdict };
  }
  if (verdict === "REJECT") {
    return { accepted: false, verdict };
  }

  // Ασφαλές fallback: όταν η απάντηση δεν είναι parseable, απορρίπτουμε.
  return { accepted: false, verdict: "REJECT" };
}

export { gatekeepNewsArticle };
