// ============================================================
// OrgsLedger API — Multilingual Translation Pipeline  (v2)
// Translate once per language, two-tier cache (L1 + Redis),
// parallel translations, fast in-memory language lookups.
// ============================================================

import { db } from '../db';
import { logger } from '../logger';
import { translateText } from './translation.service';
import { meetingLanguages } from '../socket';
import { normalizeLang, isSameLang } from '../utils/langNormalize';
import {
  getCachedTranslation,
  setCachedTranslation,
  getCacheMetrics,
} from './translationCache';
import { recordTranslationLatency } from './translationMetrics';

interface TranslationCacheEntry {
  text: string;
  targetLanguage: string;
  translation: string;
  timestamp: Date;
}

interface ParticipantLanguagePreference {
  userId: string;
  language: string;
}

class MultilingualTranslationPipeline {
  /**
   * Translate text to all required participant languages.
   * v2: parallel translations, Redis cache, in-memory lang lookup.
   */
  async translateToParticipants(
    text: string,
    sourceLang: string,
    meetingId: string
  ): Promise<{
    originalText: string;
    sourceLanguage: string;
    translations: Record<string, string>;
    targetLanguages: string[];
  }> {
    const t0 = Date.now();
    const src = normalizeLang(sourceLang);

    try {
      // Step 1: Resolve target languages (fast in-memory, DB fallback)
      const targetLanguages = this.getTargetLanguagesFast(meetingId, src);

      if (targetLanguages.length === 0) {
        return { originalText: text, sourceLanguage: src, translations: {}, targetLanguages: [] };
      }

      // Step 2: Parallel translate with Redis cache
      const translations: Record<string, string> = {};
      const misses: string[] = [];

      // 2a — Check cache for all languages concurrently
      const cacheResults = await Promise.all(
        targetLanguages.map(async (tl) => ({
          lang: tl,
          cached: await getCachedTranslation(text, src, tl),
        }))
      );

      for (const { lang, cached } of cacheResults) {
        if (cached !== null) {
          translations[lang] = cached;
        } else {
          misses.push(lang);
        }
      }

      // 2b — Translate cache misses in parallel (batch of 5)
      if (misses.length > 0) {
        const batchSize = 5;
        for (let i = 0; i < misses.length; i += batchSize) {
          const batch = misses.slice(i, i + batchSize);
          const results = await Promise.all(
            batch.map(async (tl) => {
              try {
                // FIXED arg order: translateText(text, targetLang, sourceLang)
                const result = await translateText(text, tl, src);
                // Store in Redis cache (fire-and-forget)
                setCachedTranslation(text, src, tl, result.translatedText).catch(() => {});
                return { lang: tl, text: result.translatedText };
              } catch (err) {
                logger.warn(`Translation ${src}->${tl} failed`, err);
                return { lang: tl, text };
              }
            })
          );

          for (const r of results) {
            translations[r.lang] = r.text;
          }
        }
      }

      const elapsed = Date.now() - t0;
      recordTranslationLatency(elapsed);
      logger.info(`[MULTILINGUAL] ${targetLanguages.length} langs, ${misses.length} misses, ${elapsed}ms`, {
        meetingId,
        cacheHits: targetLanguages.length - misses.length,
      });

      return { originalText: text, sourceLanguage: src, translations, targetLanguages };
    } catch (err) {
      logger.error('Failed to translate to participants', err);
      return { originalText: text, sourceLanguage: src, translations: {}, targetLanguages: [] };
    }
  }

  /**
   * Fast in-memory language lookup from the meetingLanguages map.
   * Falls back to DB query if no participants registered yet.
   */
  private getTargetLanguagesFast(meetingId: string, sourceLang: string): string[] {
    const participants = meetingLanguages.get(meetingId);
    if (participants && participants.size > 0) {
      const langs = new Set<string>();
      for (const [, pref] of participants) {
        const norm = normalizeLang(pref.language);
        if (!isSameLang(norm, sourceLang)) {
          langs.add(norm);
        }
      }
      return Array.from(langs);
    }
    // If no in-memory data, return empty — the transcript handler layer will populate
    return [];
  }

  /**
   * DB-based fallback for participant languages when in-memory map is empty.
   * Used only during initial meeting setup or cold starts.
   */
  async getUniqueParticipantLanguagesFromDB(
    meetingId: string,
    sourceLang: string
  ): Promise<string[]> {
    try {
      const participants = await db('meeting_participants as mp')
        .select('u.id', 'ulp.language')
        .join('users as u', 'mp.user_id', 'u.id')
        .leftJoin('user_language_preferences as ulp', 'u.id', 'ulp.user_id')
        .where('mp.meeting_id', meetingId)
        .where('mp.status', 'in');

      const languageSet = new Set<string>();
      for (const p of participants) {
        const norm = normalizeLang(p.language);
        if (!isSameLang(norm, sourceLang)) {
          languageSet.add(norm);
        }
      }
      return Array.from(languageSet);
    } catch (err) {
      logger.error('Failed to get participant languages from DB', err);
      return [];
    }
  }

  /**
   * Clear caches
   */
  clearCache(): void {
    logger.info('Translation pipeline caches cleared');
  }

  /**
   * Get cache statistics (Redis-backed now)
   */
  getCacheStats() {
    return getCacheMetrics();
  }

  /**
   * Get list of commonly spoken languages in a meeting
   */
  async getMeetingLanguageStatistics(meetingId: string): Promise<
    Array<{ language: string; speakerCount: number }>
  > {
    // Fast path: use in-memory meetingLanguages
    const participants = meetingLanguages.get(meetingId);
    if (participants && participants.size > 0) {
      const counts = new Map<string, number>();
      for (const [, pref] of participants) {
        const lang = normalizeLang(pref.language);
        counts.set(lang, (counts.get(lang) || 0) + 1);
      }
      return Array.from(counts.entries())
        .map(([language, speakerCount]) => ({ language, speakerCount }))
        .sort((a, b) => b.speakerCount - a.speakerCount);
    }

    // Fallback: DB query
    try {
      const result = await db('meeting_participants as mp')
        .select('ulp.language', db.raw('COUNT(DISTINCT mp.user_id) as speaker_count'))
        .join('users as u', 'mp.user_id', 'u.id')
        .leftJoin('user_language_preferences as ulp', 'u.id', 'ulp.user_id')
        .where('mp.meeting_id', meetingId)
        .where('mp.status', 'in')
        .groupBy('ulp.language')
        .orderBy('speaker_count', 'desc');

      return result.map((row: any) => ({
        language: row.language || 'en',
        speakerCount: parseInt(row.speaker_count, 10),
      }));
    } catch (err) {
      logger.error('Failed to get meeting language statistics', err);
      return [];
    }
  }
}

// Export singleton instance
export const multilingualTranslationPipeline = new MultilingualTranslationPipeline();
export type { TranslationCacheEntry, ParticipantLanguagePreference };
