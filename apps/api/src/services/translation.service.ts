// ============================================================
// OrgsLedger API — Translation Service (GPT-powered)
// Supports 100+ languages via OpenAI GPT-4o-mini.
// Falls back to AI proxy → Google Translate → passthrough.
// ============================================================

import { config } from '../config';
import { logger } from '../logger';
import {
  getLanguageName,
} from '@orgsledger/shared';
import { getCachedTranslation, setCachedTranslation } from './translationCache';
import { normalizeLang, isSameLang } from '../utils/langNormalize';

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
} from '@orgsledger/shared';
export type { Language, UserLanguagePreference } from '@orgsledger/shared';

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

// ── Singleton OpenAI client (avoid re-instantiating per call) ──
let openaiClient: any = null;
function getOpenAIClient() {
  if (!openaiClient && config.ai.openaiApiKey) {
    const OpenAI = require('openai').default;
    openaiClient = new OpenAI({ apiKey: config.ai.openaiApiKey });
  }
  return openaiClient;
}

// ── Singleton Google Auth client ──
let googleAuthClient: any = null;
async function getGoogleAuthClient() {
  if (!googleAuthClient) {
    const credentialsPath = config.ai.googleCredentials;
    if (!credentialsPath) return null;
    const { GoogleAuth } = await import('google-auth-library');
    const auth = new GoogleAuth({
      keyFilename: credentialsPath,
      scopes: ['https://www.googleapis.com/auth/cloud-translation'],
    });
    googleAuthClient = await auth.getClient();
  }
  return googleAuthClient;
}

// Fetch with timeout helper
function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 10000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
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

  const src = normalizeLang(sourceLang);
  const tgt = normalizeLang(targetLang);

  // Same language → passthrough
  if (isSameLang(src, tgt)) {
    return { translatedText: text, detectedSourceLanguage: src };
  }

  // ── Check L1 in-process cache ──────────────────────────
  const textKey = text.length > 300 ? text.slice(0, 150) + '|' + text.length + '|' + text.slice(-100) : text;
  const cacheKey = `${src}:${tgt}:${textKey}`;
  const cached = getCached(cacheKey);
  if (cached) {
    logger.debug(`[TRANSLATION] L1 cache hit: ${src} → ${tgt}`);
    return { translatedText: cached, detectedSourceLanguage: src };
  }

  // ── Check Redis cache (L2) ─────────────────────────────
  try {
    const redisCached = await getCachedTranslation(text, src, tgt);
    if (redisCached) {
      setCache(cacheKey, redisCached); // Promote to L1
      logger.debug(`[TRANSLATION] Redis cache hit: ${src} → ${tgt}`);
      return { translatedText: redisCached, detectedSourceLanguage: src };
    }
  } catch {
    // Redis down — proceed without it
  }

  // Resolve human-readable language name for the GPT prompt
  const targetName = getLanguageName(tgt);
  const sourceName = src ? getLanguageName(src) : null;

  logger.debug(`[TRANSLATION] Translating: "${text.slice(0, 60)}" from ${sourceName || 'auto'} (${src}) → ${targetName} (${tgt})`);

  // NOTE: AI proxy does not have a /translate endpoint — skip it.
  // Translation goes directly through GPT-4o-mini (primary) or Google Translate (fallback).

  // ── GPT-4o-mini translation (100+ languages) ──────────
  const openai = getOpenAIClient();
  if (openai) {
    try {
      const systemPrompt = sourceName
        ? `You are a professional translator. Translate the following text from ${sourceName} to ${targetName}. Output ONLY the translated text, nothing else. Translate exactly. Do not summarize. Do not paraphrase. Do not add commentary. Preserve tone, formality, and meaning strictly.`
        : `You are a professional translator. Detect the source language and translate the following text to ${targetName}. Output ONLY the translated text, nothing else. Translate exactly. Do not summarize. Do not paraphrase. Do not add commentary. Preserve tone, formality, and meaning strictly.`;

      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text },
        ],
        temperature: 0,
        max_tokens: Math.min(4096, Math.max(256, text.length * 3)),
      });

      const translated = response.choices[0]?.message?.content?.trim() || text;
      logger.debug(`[TRANSLATION] GPT result: "${text.slice(0, 60)}" → "${translated.slice(0, 60)}" (${src} → ${tgt})`);
      setCache(cacheKey, translated);
      // Also store in Redis (fire-and-forget)
      setCachedTranslation(text, src, tgt, translated).catch(() => {});
      return { translatedText: translated, detectedSourceLanguage: src };
    } catch (err) {
      logger.warn('GPT translation failed, falling back to Google Translate', err);
    }
  }

  // ── Google Cloud Translation API v2 (fallback) ────────
  try {
    const client = await getGoogleAuthClient();
    if (!client) {
      logger.warn('No Google credentials configured for translation');
      return { translatedText: text };
    }

    const accessToken = (await client.getAccessToken()).token;

    const url = 'https://translation.googleapis.com/language/translate/v2';
    const body: any = {
      q: text,
      target: tgt,
      format: 'text',
    };
    if (src && src !== 'en') {
      body.source = src;
    }

    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }, 10000);

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Google Translate API error: ${res.status} — ${err}`);
    }

    const data = (await res.json()) as any;
    const translation = data.data?.translations?.[0];
    const translated = translation?.translatedText || text;
    setCache(cacheKey, translated);
    // Also store in Redis (fire-and-forget)
    setCachedTranslation(text, src, tgt, translated).catch(() => {});

    return {
      translatedText: translated,
      detectedSourceLanguage: translation?.detectedSourceLanguage || src,
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
