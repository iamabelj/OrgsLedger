// ============================================================
// OrgsLedger API — Translation Service
// Google Cloud Translation API for real-time meeting translation
// ============================================================

import { config } from '../config';
import { logger } from '../logger';

// Supported languages with display names
export const SUPPORTED_LANGUAGES: Record<string, string> = {
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  pt: 'Portuguese',
  ar: 'Arabic',
  zh: 'Chinese (Simplified)',
  hi: 'Hindi',
  sw: 'Swahili',
  yo: 'Yoruba',
  ha: 'Hausa',
  ig: 'Igbo',
  am: 'Amharic',
  de: 'German',
  it: 'Italian',
  ja: 'Japanese',
  ko: 'Korean',
  ru: 'Russian',
  tr: 'Turkish',
  id: 'Indonesian',
  ms: 'Malay',
  th: 'Thai',
  vi: 'Vietnamese',
  nl: 'Dutch',
  pl: 'Polish',
  uk: 'Ukrainian',
  tw: 'Twi (Akan)',
};

// BCP-47 codes for Web Speech API recognition (more specific)
export const SPEECH_RECOGNITION_CODES: Record<string, string> = {
  en: 'en-US',
  es: 'es-ES',
  fr: 'fr-FR',
  pt: 'pt-BR',
  ar: 'ar-SA',
  zh: 'zh-CN',
  hi: 'hi-IN',
  sw: 'sw-KE',
  yo: 'yo-NG',
  ha: 'ha-NG',
  ig: 'ig-NG',
  am: 'am-ET',
  de: 'de-DE',
  it: 'it-IT',
  ja: 'ja-JP',
  ko: 'ko-KR',
  ru: 'ru-RU',
  tr: 'tr-TR',
  id: 'id-ID',
  ms: 'ms-MY',
  th: 'th-TH',
  vi: 'vi-VN',
  nl: 'nl-NL',
  pl: 'pl-PL',
  uk: 'uk-UA',
  tw: 'ak-GH',
};

interface TranslationResult {
  translatedText: string;
  detectedSourceLanguage?: string;
}

/**
 * Translate text using Google Cloud Translation API v2.
 * Falls back to the AI proxy if configured, then to Google directly.
 */
export async function translateText(
  text: string,
  targetLang: string,
  sourceLang?: string
): Promise<TranslationResult> {
  if (!text.trim()) {
    return { translatedText: '' };
  }

  // If source and target are the same, return as-is
  if (sourceLang && sourceLang === targetLang) {
    return { translatedText: text, detectedSourceLanguage: sourceLang };
  }

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
        return {
          translatedText: data.translatedText || text,
          detectedSourceLanguage: data.detectedSourceLanguage || sourceLang,
        };
      }
    } catch (err) {
      logger.warn('AI proxy translation failed, falling back to Google direct', err);
    }
  }

  // ── Google Cloud Translation API v2 (REST, no SDK needed) ──
  try {
    const credentialsPath = config.ai.googleCredentials;
    if (!credentialsPath) {
      logger.warn('No Google credentials configured for translation');
      return { translatedText: text };
    }

    // Use the Google Auth Library to get an access token
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

    return {
      translatedText: translation?.translatedText || text,
      detectedSourceLanguage: translation?.detectedSourceLanguage || sourceLang,
    };
  } catch (err) {
    logger.error('Google Translate API failed', err);
    return { translatedText: text };
  }
}

/**
 * Translate text to multiple target languages in one batch.
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
