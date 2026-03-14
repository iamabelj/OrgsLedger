// ============================================================
// OrgsLedger API — Translation API Service
// Provides on-demand translation for meeting captions.
// Supports Google Cloud Translation and DeepL APIs.
// ============================================================

import { config } from '../../../config';
import { logger } from '../../../logger';

// ── Supported Languages ─────────────────────────────────────

interface LanguageInfo {
  code: string;
  name: string;
  flag?: string;
}

/**
 * List of supported languages with display names and flag emojis.
 */
export const SUPPORTED_LANGUAGES: LanguageInfo[] = [
  { code: 'en', name: 'English', flag: '🇬🇧' },
  { code: 'es', name: 'Spanish', flag: '🇪🇸' },
  { code: 'fr', name: 'French', flag: '🇫🇷' },
  { code: 'de', name: 'German', flag: '🇩🇪' },
  { code: 'pt', name: 'Portuguese', flag: '🇧🇷' },
  { code: 'ar', name: 'Arabic', flag: '🇸🇦' },
  { code: 'zh', name: 'Chinese', flag: '🇨🇳' },
  { code: 'ja', name: 'Japanese', flag: '🇯🇵' },
  { code: 'ko', name: 'Korean', flag: '🇰🇷' },
  { code: 'hi', name: 'Hindi', flag: '🇮🇳' },
  { code: 'ru', name: 'Russian', flag: '🇷🇺' },
  { code: 'it', name: 'Italian', flag: '🇮🇹' },
  { code: 'nl', name: 'Dutch', flag: '🇳🇱' },
  { code: 'tr', name: 'Turkish', flag: '🇹🇷' },
  { code: 'sw', name: 'Swahili', flag: '🇰🇪' },
  { code: 'pl', name: 'Polish', flag: '🇵🇱' },
  { code: 'uk', name: 'Ukrainian', flag: '🇺🇦' },
  { code: 'th', name: 'Thai', flag: '🇹🇭' },
  { code: 'vi', name: 'Vietnamese', flag: '🇻🇳' },
  { code: 'id', name: 'Indonesian', flag: '🇮🇩' },
  { code: 'cs', name: 'Czech', flag: '🇨🇿' },
  { code: 'sv', name: 'Swedish', flag: '🇸🇪' },
  { code: 'da', name: 'Danish', flag: '🇩🇰' },
  { code: 'fi', name: 'Finnish', flag: '🇫🇮' },
  { code: 'no', name: 'Norwegian', flag: '🇳🇴' },
  { code: 'hu', name: 'Hungarian', flag: '🇭🇺' },
  { code: 'ro', name: 'Romanian', flag: '🇷🇴' },
  { code: 'he', name: 'Hebrew', flag: '🇮🇱' },
  { code: 'el', name: 'Greek', flag: '🇬🇷' },
  { code: 'bg', name: 'Bulgarian', flag: '🇧🇬' },
];

// ── Simple in-memory cache ──────────────────────────────────

const translationCache = new Map<string, { text: string; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 1000;

function getCacheKey(text: string, sourceLang: string, targetLang: string): string {
  // Use first 100 chars to limit key size
  return `${sourceLang}:${targetLang}:${text.substring(0, 100)}`;
}

function getFromCache(key: string): string | null {
  const entry = translationCache.get(key);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL_MS) {
    return entry.text;
  }
  translationCache.delete(key);
  return null;
}

function setInCache(key: string, text: string): void {
  // Evict old entries if cache is full
  if (translationCache.size >= MAX_CACHE_SIZE) {
    const keysToDelete = Array.from(translationCache.keys()).slice(0, 100);
    keysToDelete.forEach(k => translationCache.delete(k));
  }
  translationCache.set(key, { text, timestamp: Date.now() });
}

// ── Translation Service ─────────────────────────────────────

class TranslationApiService {
  /**
   * Get list of supported languages.
   */
  getLanguages(): LanguageInfo[] {
    return SUPPORTED_LANGUAGES;
  }

  /**
   * Translate text from source language to target language.
   * Uses configured translation provider (Google, DeepL, or mock).
   */
  async translate(
    text: string,
    targetLang: string,
    sourceLang: string = 'en'
  ): Promise<{ translatedText: string; sourceLang: string; targetLang: string }> {
    // Validate inputs
    if (!text || text.trim().length === 0) {
      throw new Error('Text is required for translation');
    }

    if (!targetLang) {
      throw new Error('Target language is required');
    }

    // If source and target are the same, return original text
    const srcLang = sourceLang.split('-')[0].toLowerCase();
    const tgtLang = targetLang.split('-')[0].toLowerCase();

    if (srcLang === tgtLang) {
      return { translatedText: text, sourceLang: srcLang, targetLang: tgtLang };
    }

    // Check cache
    const cacheKey = getCacheKey(text, srcLang, tgtLang);
    const cached = getFromCache(cacheKey);
    if (cached) {
      logger.debug('[TRANSLATION_API] Cache hit', { srcLang, tgtLang, textLength: text.length });
      return { translatedText: cached, sourceLang: srcLang, targetLang: tgtLang };
    }

    // Get provider from config
    const provider = config.translation?.provider || 'free';
    let translatedText: string;

    try {
      switch (provider) {
        case 'google':
          translatedText = await this.translateWithGoogle(text, srcLang, tgtLang);
          break;
        case 'deepl':
          translatedText = await this.translateWithDeepL(text, srcLang, tgtLang);
          break;
        case 'mock':
          // Mock translation for offline development
          translatedText = `[${tgtLang.toUpperCase()}] ${text}`;
          break;
        default:
          // Default: use free MyMemory API (no API key required)
          translatedText = await this.translateWithFreeApi(text, srcLang, tgtLang);
      }

      // Cache the result
      setInCache(cacheKey, translatedText);

      logger.debug('[TRANSLATION_API] Translation completed', {
        provider,
        srcLang,
        tgtLang,
        textLength: text.length,
        translatedLength: translatedText.length,
      });

      return { translatedText, sourceLang: srcLang, targetLang: tgtLang };
    } catch (err: any) {
      logger.error('[TRANSLATION_API] Translation failed', {
        provider,
        srcLang,
        tgtLang,
        error: err.message,
      });
      throw err;
    }
  }

  /**
   * Translate using Google Cloud Translation API.
   */
  private async translateWithGoogle(
    text: string,
    sourceLang: string,
    targetLang: string
  ): Promise<string> {
    try {
      // Dynamic import to avoid loading if not used
      const { Translate } = await import('@google-cloud/translate').then(m => m.v2);
      const translate = new Translate();

      const [translation] = await translate.translate(text, {
        from: sourceLang,
        to: targetLang,
      });

      return translation;
    } catch (err: any) {
      logger.error('[TRANSLATION_API] Google Translate failed', {
        error: err.message,
        sourceLang,
        targetLang,
      });
      // Fall back to free API
      return this.translateWithFreeApi(text, sourceLang, targetLang);
    }
  }

  /**
   * Translate using DeepL API.
   */
  private async translateWithDeepL(
    text: string,
    sourceLang: string,
    targetLang: string
  ): Promise<string> {
    const apiKey = process.env.DEEPL_API_KEY;
    if (!apiKey) {
      logger.warn('[TRANSLATION_API] DEEPL_API_KEY not set, falling back to free API');
      return this.translateWithFreeApi(text, sourceLang, targetLang);
    }

    try {
      // Dynamic import
      const deepl = await import('deepl-node');
      const translator = new deepl.Translator(apiKey);

      // DeepL uses uppercase language codes for target
      const result = await translator.translateText(
        text,
        sourceLang.toLowerCase() as any,
        targetLang.toUpperCase() as any
      );

      return result.text;
    } catch (err: any) {
      logger.error('[TRANSLATION_API] DeepL failed', {
        error: err.message,
        sourceLang,
        targetLang,
      });
      // Fall back to free API
      return this.translateWithFreeApi(text, sourceLang, targetLang);
    }
  }

  /**
   * Translate using MyMemory free API (no API key required).
   * Rate limited to 1000 requests/day but works for development.
   */
  private async translateWithFreeApi(
    text: string,
    sourceLang: string,
    targetLang: string
  ): Promise<string> {
    try {
      const langPair = `${sourceLang}|${targetLang}`;
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(langPair)}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`MyMemory API returned ${response.status}`);
      }

      const data = await response.json() as {
        responseStatus?: number;
        responseData?: { translatedText?: string };
        matches?: Array<{ quality: number; translation: string }>;
      };

      if (data.responseStatus === 200 && data.responseData?.translatedText) {
        const translated = data.responseData.translatedText;
        // MyMemory sometimes returns "UNTRANSLATED" for errors
        if (translated !== 'UNTRANSLATED' && !translated.includes('QUERY LENGTH LIMIT')) {
          logger.debug('[TRANSLATION_API] Free API translation success', { sourceLang, targetLang });
          return translated;
        }
      }

      // If the response has matches, use the best one
      if (data.matches && data.matches.length > 0) {
        const bestMatch = data.matches.reduce((best, m) => 
          m.quality > (best?.quality || 0) ? m : best, data.matches[0]);
        if (bestMatch?.translation) {
          return bestMatch.translation;
        }
      }

      throw new Error('No valid translation returned');
    } catch (err: any) {
      logger.error('[TRANSLATION_API] Free API failed', {
        error: err.message,
        sourceLang,
        targetLang,
      });
      // Last resort: return untranslated with marker
      return `[${targetLang.toUpperCase()}] ${text}`;
    }
  }
}

// ── Singleton Export ────────────────────────────────────────

export const translationApiService = new TranslationApiService();
