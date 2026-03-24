const NOISE_PATTERNS: RegExp[] = [
  /^(home|news|world|sports|menu)$/i,
  /subscribe/i,
  /newsletter/i,
  /cookie/i,
  /privacy policy/i,
  /terms of service/i,
  /follow us/i,
  /share (this|article)/i,
  /read more/i,
  /related articles?/i,
  /advertisement/i,
  /all rights reserved/i,
  /click here/i,
  /sign in/i,
  /log in/i,
];

export interface CleanSourceResult {
  cleanedText: string;
  originalLength: number;
  cleanedLength: number;
  removedLineCount: number;
}

function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

export function cleanSource(rawSource: string): CleanSourceResult {
  const originalLength = rawSource.length;

  // TODO(production): replace regex HTML stripping with a robust parser for malformed markup.
  const textWithoutHtml = rawSource
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");

  const lines = textWithoutHtml
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .filter((line) => line.length > 0);

  const seen = new Set<string>();
  const kept: string[] = [];
  let removedLineCount = 0;

  for (const line of lines) {
    if (line.length < 3) {
      removedLineCount += 1;
      continue;
    }

    if (NOISE_PATTERNS.some((pattern) => pattern.test(line))) {
      removedLineCount += 1;
      continue;
    }

    const dedupeKey = line.toLowerCase();
    if (seen.has(dedupeKey)) {
      removedLineCount += 1;
      continue;
    }

    seen.add(dedupeKey);
    kept.push(line);
  }

  const cleanedText = normalizeWhitespace(kept.join("\n"));

  return {
    cleanedText,
    originalLength,
    cleanedLength: cleanedText.length,
    removedLineCount,
  };
}
