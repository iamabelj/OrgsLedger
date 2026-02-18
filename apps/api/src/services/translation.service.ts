// ============================================================
// OrgsLedger API — Translation Service (GPT-powered)
// Supports 100+ languages via OpenAI GPT-4o-mini.
// Falls back to AI proxy → Google Translate → passthrough.
// ============================================================

import { config } from '../config';
import { logger } from '../logger';
import {
  getLanguageName,
} from '../../../../packages/shared/src/languages';

// Re-export the shared language registry so existing imports still work
export {
  LANGUAGES,
  LANG_FLAGS,
  SPEECH_CODES,
  TTS_SUPPORTED,
  isTtsSupported,
  ALL_LANGUAGES,
  getLanguage,
  getLanguageName,
  getLanguageFlag,
  getBcp47,
  isRtl,
  getAllCodes,
} from '../../../../packages/shared/src/languages';
export type { Language, UserLanguagePreference } from '../../../../packages/shared/src/languages';

interface TranslationResult {
  translatedText: string;
  detectedSourceLanguage?: string;
}

// ── Simple translation cache (per-process, auto-evicts) ────
const translationCache = new Map<string, { text: string; ts: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const CACHE_MAX = 2000;

function getCached(key: string): string | null {
  const entry = translationCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    translationCache.delete(key);
    return null;
  }
  return entry.text;
}

function setCache(key: string, text: string) {
  if (translationCache.size >= CACHE_MAX) {
    // Evict oldest 25%
    const entries = [...translationCache.entries()].sort((a, b) => a[1].ts - b[1].ts);
    for (let i = 0; i < CACHE_MAX / 4; i++) {
      translationCache.delete(entries[i][0]);
    }
  }
  translationCache.set(key, { text, ts: Date.now() });
}

/**
 * Translate text using GPT-4o-mini (primary) or fallback chain.
 * Accepts ANY ISO language code — no pre-defined list required.
 */
export async function translateText(
  text: string,
  targetLang: string,
  sourceLang?: string
): Promise<TranslationResult> {
  if (!text.trim()) {
    return { translatedText: '' };
  }

  // Same language → passthrough
  if (sourceLang && sourceLang === targetLang) {
    return { translatedText: text, detectedSourceLanguage: sourceLang };
  }

  // ── Check cache ─────────────────────────────────────────
  const cacheKey = `${sourceLang || 'auto'}:${targetLang}:${text.slice(0, 200)}`;
  const cached = getCached(cacheKey);
  if (cached) {
    return { translatedText: cached, detectedSourceLanguage: sourceLang };
  }

  // Resolve human-readable language name for the GPT prompt
  const targetName = getLanguageName(targetLang);
  const sourceName = sourceLang ? getLanguageName(sourceLang) : null;

  // ── Try AI Proxy first ────────────────────────────────
  if (config.aiProxy.url && config.aiProxy.apiKey) {
    try {
      const res = await fetch(`${config.aiProxy.url}/api/ai/translate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': config.aiProxy.apiKey,
        },
        body: JSON.stringify({ text, targetLang, sourceLang }),
      });

      if (res.ok) {
        const data = (await res.json()) as any;
        const translated = data.translatedText || text;
        setCache(cacheKey, translated);
        return {
          translatedText: translated,
          detectedSourceLanguage: data.detectedSourceLanguage || sourceLang,
        };
      }
    } catch (err) {
      logger.warn('AI proxy translation failed, falling back to GPT', err);
    }
  }

  // ── GPT-4o-mini translation (100+ languages) ──────────
  if (config.ai.openaiApiKey) {
    try {
      const OpenAI = (await import('openai')).default;
      const openai = new OpenAI({ apiKey: config.ai.openaiApiKey });

      const systemPrompt = sourceName
        ? `You are a professional translator. Translate the following text from ${sourceName} to ${targetName}. Output ONLY the translated text, nothing else. Preserve tone, formality, and meaning exactly.`
        : `You are a professional translator. Detect the source language and translate the following text to ${targetName}. Output ONLY the translated text, nothing else. Preserve tone, formality, and meaning exactly.`;

      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text },
        ],
        temperature: 0,
        max_tokens: Math.max(256, text.length * 3),
      });

      const translated = response.choices[0]?.message?.content?.trim() || text;
      setCache(cacheKey, translated);
      return { translatedText: translated, detectedSourceLanguage: sourceLang };
    } catch (err) {
      logger.warn('GPT translation failed, falling back to Google Translate', err);
    }
  }

  // ── Google Cloud Translation API v2 (fallback) ────────
  try {
    const credentialsPath = config.ai.googleCredentials;
    if (!credentialsPath) {
      logger.warn('No Google credentials configured for translation');
      return { translatedText: text };
    }

    const { GoogleAuth } = await import('google-auth-library');
    const auth = new GoogleAuth({
      keyFilename: credentialsPath,
      scopes: ['https://www.googleapis.com/auth/cloud-translation'],
    });

    const client = await auth.getClient();
    const accessToken = (await client.getAccessToken()).token;

    const url = 'https://translation.googleapis.com/language/translate/v2';
    const body: any = {
      q: text,
      target: targetLang,
      format: 'text',
    };
    if (sourceLang) {
      body.source = sourceLang;
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Google Translate API error: ${res.status} — ${err}`);
    }

    const data = (await res.json()) as any;
    const translation = data.data?.translations?.[0];
    const translated = translation?.translatedText || text;
    setCache(cacheKey, translated);

    return {
      translatedText: translated,
      detectedSourceLanguage: translation?.detectedSourceLanguage || sourceLang,
    };
  } catch (err) {
    logger.error('Google Translate API also failed', err);
    return { translatedText: text };
  }
}

/**
 * Translate text to multiple target languages in one batch.
 * Routes each language through translateText (with cache).
 * Returns a map of langCode → translatedText.
 */
export async function translateToMultiple(
  text: string,
  targetLangs: string[],
  sourceLang?: string
): Promise<Record<string, string>> {
  // Deduplicate and filter out source language
  const uniqueLangs = [...new Set(targetLangs)].filter((l) => l !== sourceLang);
  const results: Record<string, string> = {};

  // If source lang is in targets, just copy
  if (sourceLang && targetLangs.includes(sourceLang)) {
    results[sourceLang] = text;
  }

  // Translate in parallel (batches of 5 to avoid rate limits)
  const batchSize = 5;
  for (let i = 0; i < uniqueLangs.length; i += batchSize) {
    const batch = uniqueLangs.slice(i, i + batchSize);
    const translations = await Promise.all(
      batch.map((lang) => translateText(text, lang, sourceLang))
    );
    batch.forEach((lang, idx) => {
      results[lang] = translations[idx].translatedText;
    });
  }

  return results;
}
