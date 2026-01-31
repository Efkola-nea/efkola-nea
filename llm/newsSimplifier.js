import { openai } from "./openaiClient.js";
import { NEWS_SIMPLIFY_INSTRUCTIONS } from "./newsPrompts.js";
import { cleanSimplifiedText } from "./textUtils.js";

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

function parseSimplifiedResponse(responseText, fallbackTitle) {
  const cleaned = (responseText || "").trim();

  // Αναμένουμε format:
  // Τίτλος: ...
  // Κείμενο: ...
  const match = cleaned.match(
    /Τίτλος\s*:\s*(.+?)\s*(?:\n|$)[\s\S]*?Κείμενο\s*:\s*([\s\S]+)/i
  );

  if (match) {
    const title = cleanSimplifiedText(match[1] || "") || fallbackTitle;
    const text = cleanSimplifiedText(match[2] || "");
    return { title, text };
  }

  // Fallback: πρώτο μη-κενό line ως τίτλος, υπόλοιπο ως κείμενο
  const lines = cleaned.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length >= 2) {
    const possibleTitle = lines[0].replace(/^Τίτλος\s*:\s*/i, "").trim();
    const rest = cleaned.slice(cleaned.indexOf(lines[0]) + lines[0].length).trim();
    return {
      title: cleanSimplifiedText(possibleTitle) || fallbackTitle,
      text: cleanSimplifiedText(rest),
    };
  }

  return {
    title: fallbackTitle,
    text: cleanSimplifiedText(cleaned),
  };
}

async function simplifyNewsArticle({ title, rawText, sourceUrl }) {
  const safeTitle = title || "Είδηση";
  const safeText = rawText || "";
  const sourceLine = sourceUrl ? `Πηγή: ${sourceUrl}\n` : "";

  const userContent = `Τίτλος: ${safeTitle}\n${sourceLine}Κείμενο:\n${safeText}`;

  const response = await openai.responses.create({
    model: "gpt-4o-mini",
    instructions: NEWS_SIMPLIFY_INSTRUCTIONS,
    input: userContent,
  });

  const responseText = extractText(response).trim();
  return parseSimplifiedResponse(responseText, safeTitle);
}

export { simplifyNewsArticle };
