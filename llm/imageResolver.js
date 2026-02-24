function isPixabayUrl(url) {
  return /(^|\/\/)(cdn\.)?pixabay\.com/i.test(String(url || ""));
}

/**
 * Returns: imageUrl string or null
 * Πολιτική:
 * - Χρησιμοποιούμε μόνο εικόνα που ήρθε από το original άρθρο/feed.
 * - Δεν επιτρέπουμε Pixabay URLs.
 */
export async function resolveArticleImage(article) {
  const originalImageUrl = String(article?.imageUrl || "").trim();
  if (!originalImageUrl) return null;
  if (isPixabayUrl(originalImageUrl)) return null;
  return originalImageUrl;
}
