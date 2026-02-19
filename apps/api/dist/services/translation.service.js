"use strict";
// ============================================================
// OrgsLedger API — Translation Service (GPT-powered)
// Supports 100+ languages via OpenAI GPT-4o-mini.
// Falls back to AI proxy → Google Translate → passthrough.
// ============================================================
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAllCodes = exports.isRtl = exports.getBcp47 = exports.getLanguageFlag = exports.getLanguageName = exports.getLanguage = exports.ALL_LANGUAGES = exports.isTtsSupported = exports.TTS_SUPPORTED = exports.SPEECH_CODES = exports.LANG_FLAGS = exports.LANGUAGES = void 0;
exports.translateText = translateText;
exports.translateToMultiple = translateToMultiple;
const config_1 = require("../config");
const logger_1 = require("../logger");
const shared_1 = require("@orgsledger/shared");
// Re-export the shared language registry so existing imports still work
var shared_2 = require("@orgsledger/shared");
Object.defineProperty(exports, "LANGUAGES", { enumerable: true, get: function () { return shared_2.LANGUAGES; } });
Object.defineProperty(exports, "LANG_FLAGS", { enumerable: true, get: function () { return shared_2.LANG_FLAGS; } });
Object.defineProperty(exports, "SPEECH_CODES", { enumerable: true, get: function () { return shared_2.SPEECH_CODES; } });
Object.defineProperty(exports, "TTS_SUPPORTED", { enumerable: true, get: function () { return shared_2.TTS_SUPPORTED; } });
Object.defineProperty(exports, "isTtsSupported", { enumerable: true, get: function () { return shared_2.isTtsSupported; } });
Object.defineProperty(exports, "ALL_LANGUAGES", { enumerable: true, get: function () { return shared_2.ALL_LANGUAGES; } });
Object.defineProperty(exports, "getLanguage", { enumerable: true, get: function () { return shared_2.getLanguage; } });
Object.defineProperty(exports, "getLanguageName", { enumerable: true, get: function () { return shared_2.getLanguageName; } });
Object.defineProperty(exports, "getLanguageFlag", { enumerable: true, get: function () { return shared_2.getLanguageFlag; } });
Object.defineProperty(exports, "getBcp47", { enumerable: true, get: function () { return shared_2.getBcp47; } });
Object.defineProperty(exports, "isRtl", { enumerable: true, get: function () { return shared_2.isRtl; } });
Object.defineProperty(exports, "getAllCodes", { enumerable: true, get: function () { return shared_2.getAllCodes; } });
// ── Simple translation cache (per-process, auto-evicts) ────
const translationCache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const CACHE_MAX = 2000;
function getCached(key) {
    const entry = translationCache.get(key);
    if (!entry)
        return null;
    if (Date.now() - entry.ts > CACHE_TTL_MS) {
        translationCache.delete(key);
        return null;
    }
    return entry.text;
}
function setCache(key, text) {
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
let openaiClient = null;
function getOpenAIClient() {
    if (!openaiClient && config_1.config.ai.openaiApiKey) {
        const OpenAI = require('openai').default;
        openaiClient = new OpenAI({ apiKey: config_1.config.ai.openaiApiKey });
    }
    return openaiClient;
}
// ── Singleton Google Auth client ──
let googleAuthClient = null;
async function getGoogleAuthClient() {
    if (!googleAuthClient) {
        const credentialsPath = config_1.config.ai.googleCredentials;
        if (!credentialsPath)
            return null;
        const { GoogleAuth } = await Promise.resolve().then(() => __importStar(require('google-auth-library')));
        const auth = new GoogleAuth({
            keyFilename: credentialsPath,
            scopes: ['https://www.googleapis.com/auth/cloud-translation'],
        });
        googleAuthClient = await auth.getClient();
    }
    return googleAuthClient;
}
// Fetch with timeout helper
function fetchWithTimeout(url, options, timeoutMs = 10000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}
/**
 * Translate text using GPT-4o-mini (primary) or fallback chain.
 * Accepts ANY ISO language code — no pre-defined list required.
 */
async function translateText(text, targetLang, sourceLang) {
    if (!text.trim()) {
        return { translatedText: '' };
    }
    // Same language → passthrough
    if (sourceLang && sourceLang === targetLang) {
        return { translatedText: text, detectedSourceLanguage: sourceLang };
    }
    // ── Check cache ─────────────────────────────────────────
    // Use full text in cache key (hashed for long strings)
    const textKey = text.length > 300 ? text.slice(0, 150) + '|' + text.length + '|' + text.slice(-100) : text;
    const cacheKey = `${sourceLang || 'auto'}:${targetLang}:${textKey}`;
    const cached = getCached(cacheKey);
    if (cached) {
        logger_1.logger.debug(`[TRANSLATION] Cache hit: ${sourceLang || 'auto'} → ${targetLang}`);
        return { translatedText: cached, detectedSourceLanguage: sourceLang };
    }
    // Resolve human-readable language name for the GPT prompt
    const targetName = (0, shared_1.getLanguageName)(targetLang);
    const sourceName = sourceLang ? (0, shared_1.getLanguageName)(sourceLang) : null;
    logger_1.logger.debug(`[TRANSLATION] Translating: "${text.slice(0, 60)}" from ${sourceName || 'auto'} (${sourceLang || 'auto'}) → ${targetName} (${targetLang})`);
    // ── Try AI Proxy first ────────────────────────────────
    if (config_1.config.aiProxy.url && config_1.config.aiProxy.apiKey) {
        try {
            const res = await fetchWithTimeout(`${config_1.config.aiProxy.url}/api/ai/translate`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': config_1.config.aiProxy.apiKey,
                },
                body: JSON.stringify({ text, targetLang, sourceLang }),
            }, 8000);
            if (res.ok) {
                const data = (await res.json());
                const translated = data.translatedText || text;
                setCache(cacheKey, translated);
                return {
                    translatedText: translated,
                    detectedSourceLanguage: data.detectedSourceLanguage || sourceLang,
                };
            }
        }
        catch (err) {
            logger_1.logger.warn('AI proxy translation failed, falling back to GPT', err);
        }
    }
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
            logger_1.logger.debug(`[TRANSLATION] GPT result: "${text.slice(0, 60)}" → "${translated.slice(0, 60)}" (${sourceLang || 'auto'} → ${targetLang})`);
            setCache(cacheKey, translated);
            return { translatedText: translated, detectedSourceLanguage: sourceLang };
        }
        catch (err) {
            logger_1.logger.warn('GPT translation failed, falling back to Google Translate', err);
        }
    }
    // ── Google Cloud Translation API v2 (fallback) ────────
    try {
        const client = await getGoogleAuthClient();
        if (!client) {
            logger_1.logger.warn('No Google credentials configured for translation');
            return { translatedText: text };
        }
        const accessToken = (await client.getAccessToken()).token;
        const url = 'https://translation.googleapis.com/language/translate/v2';
        const body = {
            q: text,
            target: targetLang,
            format: 'text',
        };
        if (sourceLang) {
            body.source = sourceLang;
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
        const data = (await res.json());
        const translation = data.data?.translations?.[0];
        const translated = translation?.translatedText || text;
        setCache(cacheKey, translated);
        return {
            translatedText: translated,
            detectedSourceLanguage: translation?.detectedSourceLanguage || sourceLang,
        };
    }
    catch (err) {
        logger_1.logger.error('Google Translate API also failed', err);
        return { translatedText: text };
    }
}
/**
 * Translate text to multiple target languages in one batch.
 * Routes each language through translateText (with cache).
 * Returns a map of langCode → translatedText.
 */
async function translateToMultiple(text, targetLangs, sourceLang) {
    // Deduplicate and filter out source language
    const uniqueLangs = [...new Set(targetLangs)].filter((l) => l !== sourceLang);
    const results = {};
    // If source lang is in targets, just copy
    if (sourceLang && targetLangs.includes(sourceLang)) {
        results[sourceLang] = text;
    }
    // Translate in parallel (batches of 5 to avoid rate limits)
    const batchSize = 5;
    for (let i = 0; i < uniqueLangs.length; i += batchSize) {
        const batch = uniqueLangs.slice(i, i + batchSize);
        const translations = await Promise.all(batch.map((lang) => translateText(text, lang, sourceLang)));
        batch.forEach((lang, idx) => {
            results[lang] = translations[idx].translatedText;
        });
    }
    return results;
}
//# sourceMappingURL=translation.service.js.map