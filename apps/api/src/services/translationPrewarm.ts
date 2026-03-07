// ============================================================
// OrgsLedger API — Translation Prewarm
// On startup, pre-translate common phrases into Redis cache
// so the first real translations hit cache instead of GPT.
// ============================================================

import { logger } from '../logger';
import { translateText } from './translation.service';
import { batchSetTranslations } from './translationCache';
import { normalizeLang } from '../utils/langNormalize';

// Common meeting phrases worth pre-caching
const COMMON_PHRASES = [
  'Hello',
  'Yes',
  'No',
  'Thank you',
  'Good morning',
  'Can you hear me?',
  'I agree',
  'Please continue',
  'One moment please',
  'Let me share my screen',
];

// Top language pairs to prewarm (source → targets)
const PREWARM_PAIRS: Array<{ source: string; targets: string[] }> = [
  { source: 'en', targets: ['es', 'fr', 'de', 'pt', 'ar', 'zh', 'ja', 'ko', 'hi', 'ru'] },
  { source: 'es', targets: ['en'] },
  { source: 'fr', targets: ['en'] },
  { source: 'ar', targets: ['en'] },
  { source: 'zh', targets: ['en'] },
];

/**
 * Pre-translate common phrases and store in Redis cache.
 * Runs in the background — failures are non-fatal.
 */
export async function prewarmTranslationCache(): Promise<void> {
  logger.info('[PREWARM] Starting translation cache prewarm...');
  const t0 = Date.now();
  let count = 0;

  for (const { source, targets } of PREWARM_PAIRS) {
    const src = normalizeLang(source);
    const entries: Array<{ text: string; sourceLang: string; targetLang: string; translation: string }> = [];

    // Translate all phrases for this pair in parallel (batches of 5)
    for (let i = 0; i < COMMON_PHRASES.length; i += 5) {
      const batch = COMMON_PHRASES.slice(i, i + 5);
      const results = await Promise.all(
        batch.flatMap((phrase) =>
          targets.map(async (tl) => {
            const target = normalizeLang(tl);
            try {
              const result = await translateText(phrase, target, src);
              return { text: phrase, sourceLang: src, targetLang: target, translation: result.translatedText };
            } catch {
              return null;
            }
          })
        )
      );

      for (const r of results) {
        if (r) entries.push(r);
      }
    }

    // Batch-write to Redis
    if (entries.length > 0) {
      await batchSetTranslations(entries);
      count += entries.length;
    }
  }

  const elapsed = Date.now() - t0;
  logger.info(`[PREWARM] Cached ${count} translations in ${elapsed}ms`);
}
