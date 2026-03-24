export declare const HARD_BLOCK_KEYWORDS: string[];
export declare const HEAVY_ABSTRACT_KEYWORDS: string[];
export declare const LIGHT_EDITORIAL_KEYWORDS: string[];
export declare const PRACTICAL_SERIOUS_KEYWORDS: string[];

export declare function normalizeForKeywordMatch(text: string): string;
export declare function uniqueKeywordMatches(text: string, keywords: string[]): string[];
export declare function hasKeywordMatch(text: string, keywords: string[]): boolean;
export declare function shouldSkipArticle(title: string, description: string): boolean;
export declare function editorialPriorityScoreText(
  text: string,
  options?: { categoryHints?: string[] }
): number;
export declare function isUsefulSeriousText(title: string, text?: string): boolean;
