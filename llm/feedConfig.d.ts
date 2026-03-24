export interface FeedConfig {
  url: string;
  sourceName: string;
  categoryHints?: string[];
  itemLimit?: number;
}

export declare const PRIMARY_GREEK_FEEDS: FeedConfig[];
export declare const APPROVED_FALLBACK_FEEDS: FeedConfig[];
export declare const APPROVED_FALLBACK_CATEGORIES: string[];

export declare function hasApprovedFallbackGap(
  counts: Record<string, number>,
  minTargetForCategory: (category: string) => number
): boolean;
