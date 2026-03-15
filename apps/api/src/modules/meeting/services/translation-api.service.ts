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
 * Comprehensive list of 150+ world languages with display names and flag emojis.
 * Sorted alphabetically by language name.
 */
export const SUPPORTED_LANGUAGES: LanguageInfo[] = [
  // Major World Languages
  { code: 'en', name: 'English', flag: '🇬🇧' },
  { code: 'zh', name: 'Chinese (Simplified)', flag: '🇨🇳' },
  { code: 'zh-TW', name: 'Chinese (Traditional)', flag: '🇹🇼' },
  { code: 'es', name: 'Spanish', flag: '🇪🇸' },
  { code: 'hi', name: 'Hindi', flag: '🇮🇳' },
  { code: 'ar', name: 'Arabic', flag: '🇸🇦' },
  { code: 'pt', name: 'Portuguese', flag: '🇧🇷' },
  { code: 'bn', name: 'Bengali', flag: '🇧🇩' },
  { code: 'ru', name: 'Russian', flag: '🇷🇺' },
  { code: 'ja', name: 'Japanese', flag: '🇯🇵' },
  { code: 'pa', name: 'Punjabi', flag: '🇮🇳' },
  { code: 'de', name: 'German', flag: '🇩🇪' },
  { code: 'ko', name: 'Korean', flag: '🇰🇷' },
  { code: 'fr', name: 'French', flag: '🇫🇷' },
  { code: 'vi', name: 'Vietnamese', flag: '🇻🇳' },
  { code: 'te', name: 'Telugu', flag: '🇮🇳' },
  { code: 'mr', name: 'Marathi', flag: '🇮🇳' },
  { code: 'ta', name: 'Tamil', flag: '🇮🇳' },
  { code: 'tr', name: 'Turkish', flag: '🇹🇷' },
  { code: 'it', name: 'Italian', flag: '🇮🇹' },
  { code: 'th', name: 'Thai', flag: '🇹🇭' },
  { code: 'gu', name: 'Gujarati', flag: '🇮🇳' },
  { code: 'pl', name: 'Polish', flag: '🇵🇱' },
  { code: 'uk', name: 'Ukrainian', flag: '🇺🇦' },
  { code: 'ml', name: 'Malayalam', flag: '🇮🇳' },
  { code: 'kn', name: 'Kannada', flag: '🇮🇳' },
  { code: 'or', name: 'Odia (Oriya)', flag: '🇮🇳' },
  { code: 'my', name: 'Burmese', flag: '🇲🇲' },
  
  // African Languages
  { code: 'sw', name: 'Swahili', flag: '🇰🇪' },
  { code: 'am', name: 'Amharic', flag: '🇪🇹' },
  { code: 'ha', name: 'Hausa', flag: '🇳🇬' },
  { code: 'ig', name: 'Igbo', flag: '🇳🇬' },
  { code: 'yo', name: 'Yoruba', flag: '🇳🇬' },
  { code: 'zu', name: 'Zulu', flag: '🇿🇦' },
  { code: 'xh', name: 'Xhosa', flag: '🇿🇦' },
  { code: 'af', name: 'Afrikaans', flag: '🇿🇦' },
  { code: 'st', name: 'Sesotho', flag: '🇱🇸' },
  { code: 'sn', name: 'Shona', flag: '🇿🇼' },
  { code: 'so', name: 'Somali', flag: '🇸🇴' },
  { code: 'rw', name: 'Kinyarwanda', flag: '🇷🇼' },
  { code: 'lg', name: 'Luganda', flag: '🇺🇬' },
  { code: 'ny', name: 'Chichewa', flag: '🇲🇼' },
  { code: 'mg', name: 'Malagasy', flag: '🇲🇬' },
  { code: 'ti', name: 'Tigrinya', flag: '🇪🇷' },
  { code: 'om', name: 'Oromo', flag: '🇪🇹' },
  { code: 'wo', name: 'Wolof', flag: '🇸🇳' },
  { code: 'ee', name: 'Ewe', flag: '🇬🇭' },
  { code: 'ak', name: 'Akan (Twi)', flag: '🇬🇭' },
  { code: 'bm', name: 'Bambara', flag: '🇲🇱' },
  { code: 'ln', name: 'Lingala', flag: '🇨🇩' },
  
  // European Languages
  { code: 'nl', name: 'Dutch', flag: '🇳🇱' },
  { code: 'sv', name: 'Swedish', flag: '🇸🇪' },
  { code: 'da', name: 'Danish', flag: '🇩🇰' },
  { code: 'fi', name: 'Finnish', flag: '🇫🇮' },
  { code: 'no', name: 'Norwegian', flag: '🇳🇴' },
  { code: 'cs', name: 'Czech', flag: '🇨🇿' },
  { code: 'sk', name: 'Slovak', flag: '🇸🇰' },
  { code: 'hu', name: 'Hungarian', flag: '🇭🇺' },
  { code: 'ro', name: 'Romanian', flag: '🇷🇴' },
  { code: 'el', name: 'Greek', flag: '🇬🇷' },
  { code: 'bg', name: 'Bulgarian', flag: '🇧🇬' },
  { code: 'hr', name: 'Croatian', flag: '🇭🇷' },
  { code: 'sr', name: 'Serbian', flag: '🇷🇸' },
  { code: 'sl', name: 'Slovenian', flag: '🇸🇮' },
  { code: 'lt', name: 'Lithuanian', flag: '🇱🇹' },
  { code: 'lv', name: 'Latvian', flag: '🇱🇻' },
  { code: 'et', name: 'Estonian', flag: '🇪🇪' },
  { code: 'is', name: 'Icelandic', flag: '🇮🇸' },
  { code: 'ga', name: 'Irish', flag: '🇮🇪' },
  { code: 'cy', name: 'Welsh', flag: '🏴󠁧󠁢󠁷󠁬󠁳󠁿' },
  { code: 'gd', name: 'Scottish Gaelic', flag: '🏴󠁧󠁢󠁳󠁣󠁴󠁿' },
  { code: 'mt', name: 'Maltese', flag: '🇲🇹' },
  { code: 'sq', name: 'Albanian', flag: '🇦🇱' },
  { code: 'mk', name: 'Macedonian', flag: '🇲🇰' },
  { code: 'bs', name: 'Bosnian', flag: '🇧🇦' },
  { code: 'eu', name: 'Basque', flag: '🇪🇸' },
  { code: 'ca', name: 'Catalan', flag: '🇪🇸' },
  { code: 'gl', name: 'Galician', flag: '🇪🇸' },
  { code: 'lb', name: 'Luxembourgish', flag: '🇱🇺' },
  { code: 'be', name: 'Belarusian', flag: '🇧🇾' },
  
  // Middle Eastern & Central Asian Languages
  { code: 'he', name: 'Hebrew', flag: '🇮🇱' },
  { code: 'fa', name: 'Persian (Farsi)', flag: '🇮🇷' },
  { code: 'ur', name: 'Urdu', flag: '🇵🇰' },
  { code: 'ps', name: 'Pashto', flag: '🇦🇫' },
  { code: 'ku', name: 'Kurdish', flag: '🇮🇶' },
  { code: 'az', name: 'Azerbaijani', flag: '🇦🇿' },
  { code: 'ka', name: 'Georgian', flag: '🇬🇪' },
  { code: 'hy', name: 'Armenian', flag: '🇦🇲' },
  { code: 'kk', name: 'Kazakh', flag: '🇰🇿' },
  { code: 'uz', name: 'Uzbek', flag: '🇺🇿' },
  { code: 'tg', name: 'Tajik', flag: '🇹🇯' },
  { code: 'ky', name: 'Kyrgyz', flag: '🇰🇬' },
  { code: 'tk', name: 'Turkmen', flag: '🇹🇲' },
  { code: 'mn', name: 'Mongolian', flag: '🇲🇳' },
  
  // South & Southeast Asian Languages
  { code: 'id', name: 'Indonesian', flag: '🇮🇩' },
  { code: 'ms', name: 'Malay', flag: '🇲🇾' },
  { code: 'tl', name: 'Filipino (Tagalog)', flag: '🇵🇭' },
  { code: 'ceb', name: 'Cebuano', flag: '🇵🇭' },
  { code: 'jv', name: 'Javanese', flag: '🇮🇩' },
  { code: 'su', name: 'Sundanese', flag: '🇮🇩' },
  { code: 'km', name: 'Khmer', flag: '🇰🇭' },
  { code: 'lo', name: 'Lao', flag: '🇱🇦' },
  { code: 'ne', name: 'Nepali', flag: '🇳🇵' },
  { code: 'si', name: 'Sinhala', flag: '🇱🇰' },
  { code: 'as', name: 'Assamese', flag: '🇮🇳' },
  { code: 'mai', name: 'Maithili', flag: '🇮🇳' },
  { code: 'sd', name: 'Sindhi', flag: '🇵🇰' },
  { code: 'ks', name: 'Kashmiri', flag: '🇮🇳' },
  { code: 'dv', name: 'Dhivehi', flag: '🇲🇻' },
  
  // East Asian Languages
  { code: 'yue', name: 'Cantonese', flag: '🇭🇰' },
  
  // Pacific Languages
  { code: 'mi', name: 'Maori', flag: '🇳🇿' },
  { code: 'haw', name: 'Hawaiian', flag: '🇺🇸' },
  { code: 'sm', name: 'Samoan', flag: '🇼🇸' },
  { code: 'fj', name: 'Fijian', flag: '🇫🇯' },
  { code: 'to', name: 'Tongan', flag: '🇹🇴' },
  
  // Americas Indigenous Languages
  { code: 'qu', name: 'Quechua', flag: '🇵🇪' },
  { code: 'ay', name: 'Aymara', flag: '🇧🇴' },
  { code: 'gn', name: 'Guarani', flag: '🇵🇾' },
  { code: 'nah', name: 'Nahuatl', flag: '🇲🇽' },
  { code: 'ht', name: 'Haitian Creole', flag: '🇭🇹' },
  
  // Additional Indian Languages
  { code: 'sa', name: 'Sanskrit', flag: '🇮🇳' },
  { code: 'bho', name: 'Bhojpuri', flag: '🇮🇳' },
  { code: 'raj', name: 'Rajasthani', flag: '🇮🇳' },
  { code: 'doi', name: 'Dogri', flag: '🇮🇳' },
  { code: 'kok', name: 'Konkani', flag: '🇮🇳' },
  { code: 'mni', name: 'Manipuri', flag: '🇮🇳' },
  { code: 'sat', name: 'Santali', flag: '🇮🇳' },
  
  // Additional African Languages
  { code: 'ff', name: 'Fulah (Fula)', flag: '🇸🇳' },
  { code: 'tn', name: 'Tswana', flag: '🇧🇼' },
  { code: 'ts', name: 'Tsonga', flag: '🇿🇦' },
  { code: 've', name: 'Venda', flag: '🇿🇦' },
  { code: 'ss', name: 'Swazi', flag: '🇸🇿' },
  { code: 'nd', name: 'Northern Ndebele', flag: '🇿🇼' },
  { code: 'nr', name: 'Southern Ndebele', flag: '🇿🇦' },
  { code: 'nso', name: 'Northern Sotho', flag: '🇿🇦' },
  { code: 'rn', name: 'Kirundi', flag: '🇧🇮' },
  { code: 'lua', name: 'Luba-Kasai', flag: '🇨🇩' },
  { code: 'kg', name: 'Kongo', flag: '🇨🇩' },
  
  // Constructed & Classical Languages
  { code: 'eo', name: 'Esperanto', flag: '🌍' },
  { code: 'la', name: 'Latin', flag: '🇻🇦' },
  
  // Additional Southeast Asian
  { code: 'hmn', name: 'Hmong', flag: '🇱🇦' },
  { code: 'ilo', name: 'Ilocano', flag: '🇵🇭' },
  
  // Additional Middle Eastern
  { code: 'yi', name: 'Yiddish', flag: '🇮🇱' },
  
  // Caucasian Languages
  { code: 'ce', name: 'Chechen', flag: '🇷🇺' },
  { code: 'ab', name: 'Abkhaz', flag: '🇬🇪' },
  
  // Nordic/Baltic
  { code: 'fo', name: 'Faroese', flag: '🇫🇴' },
  { code: 'kl', name: 'Greenlandic', flag: '🇬🇱' },
  
  // Additional European
  { code: 'fy', name: 'Frisian', flag: '🇳🇱' },
  { code: 'br', name: 'Breton', flag: '🇫🇷' },
  { code: 'co', name: 'Corsican', flag: '🇫🇷' },
  { code: 'oc', name: 'Occitan', flag: '🇫🇷' },
  { code: 'rm', name: 'Romansh', flag: '🇨🇭' },
  
  // Turkic Languages
  { code: 'tt', name: 'Tatar', flag: '🇷🇺' },
  { code: 'ba', name: 'Bashkir', flag: '🇷🇺' },
  { code: 'cv', name: 'Chuvash', flag: '🇷🇺' },
  { code: 'ug', name: 'Uyghur', flag: '🇨🇳' },
  
  // Uralic Languages
  { code: 'kv', name: 'Komi', flag: '🇷🇺' },
  { code: 'udm', name: 'Udmurt', flag: '🇷🇺' },
  { code: 'sah', name: 'Sakha (Yakut)', flag: '🇷🇺' },
  
  // Additional South Asian
  { code: 'bo', name: 'Tibetan', flag: '🇨🇳' },
  { code: 'dz', name: 'Dzongkha', flag: '🇧🇹' },
  
  // Additional Languages
  { code: 'war', name: 'Waray', flag: '🇵🇭' },
  { code: 'pag', name: 'Pangasinan', flag: '🇵🇭' },
  { code: 'bcl', name: 'Bikol', flag: '🇵🇭' },
  { code: 'hil', name: 'Hiligaynon', flag: '🇵🇭' },
  { code: 'ban', name: 'Balinese', flag: '🇮🇩' },
  { code: 'ace', name: 'Acehnese', flag: '🇮🇩' },
  { code: 'min', name: 'Minangkabau', flag: '🇮🇩' },
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
  ): Promise<{ translatedText: string; sourceLang: string; targetLang: string; provider: string; confidence: number }> {
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
      return { translatedText: text, sourceLang: srcLang, targetLang: tgtLang, provider: 'none', confidence: 1.0 };
    }

    // Check cache
    const cacheKey = getCacheKey(text, srcLang, tgtLang);
    const cached = getFromCache(cacheKey);
    if (cached) {
      logger.debug('[TRANSLATION_API] Cache hit', { srcLang, tgtLang, textLength: text.length });
      return { translatedText: cached, sourceLang: srcLang, targetLang: tgtLang, provider: 'cache', confidence: 0.85 };
    }

    // Get provider from config
    const provider = config.translation?.provider || 'free';
    let translatedText: string;
    let confidence = 0.7; // Default confidence for free API

    try {
      switch (provider) {
        case 'google':
          translatedText = await this.translateWithGoogle(text, srcLang, tgtLang);
          confidence = 0.95;
          break;
        case 'deepl':
          translatedText = await this.translateWithDeepL(text, srcLang, tgtLang);
          confidence = 0.95;
          break;
        case 'mock':
          // Mock translation for offline development
          translatedText = `[${tgtLang.toUpperCase()}] ${text}`;
          confidence = 0.0;
          break;
        default:
          // Default: use free MyMemory API (no API key required)
          translatedText = await this.translateWithFreeApi(text, srcLang, tgtLang);
          confidence = 0.7;
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

      return { translatedText, sourceLang: srcLang, targetLang: tgtLang, provider, confidence };
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
