// ============================================================
// OrgsLedger API — Language Normalization Helper
// Normalize language codes (e.g. "en-US" → "en") for consistent
// cache keys and comparison throughout the translation pipeline.
// ============================================================

/**
 * Normalize a language code to its base ISO-639-1 form.
 *  "en-US" → "en"
 *  "zh-Hans" → "zh"
 *  "EN"     → "en"
 *  null     → "en"
 */
export function normalizeLang(lang: string | undefined | null): string {
  if (!lang) return 'en';
  return lang.split(/[-_]/)[0].toLowerCase().trim() || 'en';
}

/**
 * Check if two language codes refer to the same language.
 */
export function isSameLang(a: string | undefined | null, b: string | undefined | null): boolean {
  return normalizeLang(a) === normalizeLang(b);
}
