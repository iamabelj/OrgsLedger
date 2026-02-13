"use strict";
// ============================================================
// OrgsLedger API — Translation Service
// Google Cloud Translation API for real-time meeting translation
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
exports.SPEECH_RECOGNITION_CODES = exports.SUPPORTED_LANGUAGES = void 0;
exports.translateText = translateText;
exports.translateToMultiple = translateToMultiple;
const config_1 = require("../config");
const logger_1 = require("../logger");
// Supported languages with display names
exports.SUPPORTED_LANGUAGES = {
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
exports.SPEECH_RECOGNITION_CODES = {
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
/**
 * Translate text using Google Cloud Translation API v2.
 * Falls back to the AI proxy if configured, then to Google directly.
 */
async function translateText(text, targetLang, sourceLang) {
    if (!text.trim()) {
        return { translatedText: '' };
    }
    // If source and target are the same, return as-is
    if (sourceLang && sourceLang === targetLang) {
        return { translatedText: text, detectedSourceLanguage: sourceLang };
    }
    // ── Try AI Proxy first ────────────────────────────────
    if (config_1.config.aiProxy.url && config_1.config.aiProxy.apiKey) {
        try {
            const res = await fetch(`${config_1.config.aiProxy.url}/api/ai/translate`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': config_1.config.aiProxy.apiKey,
                },
                body: JSON.stringify({ text, targetLang, sourceLang }),
            });
            if (res.ok) {
                const data = (await res.json());
                return {
                    translatedText: data.translatedText || text,
                    detectedSourceLanguage: data.detectedSourceLanguage || sourceLang,
                };
            }
        }
        catch (err) {
            logger_1.logger.warn('AI proxy translation failed, falling back to Google direct', err);
        }
    }
    // ── Google Cloud Translation API v2 (REST, no SDK needed) ──
    try {
        const credentialsPath = config_1.config.ai.googleCredentials;
        if (!credentialsPath) {
            logger_1.logger.warn('No Google credentials configured for translation');
            return { translatedText: text };
        }
        // Use the Google Auth Library to get an access token
        const { GoogleAuth } = await Promise.resolve().then(() => __importStar(require('google-auth-library')));
        const auth = new GoogleAuth({
            keyFilename: credentialsPath,
            scopes: ['https://www.googleapis.com/auth/cloud-translation'],
        });
        const client = await auth.getClient();
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
        const data = (await res.json());
        const translation = data.data?.translations?.[0];
        return {
            translatedText: translation?.translatedText || text,
            detectedSourceLanguage: translation?.detectedSourceLanguage || sourceLang,
        };
    }
    catch (err) {
        logger_1.logger.error('Google Translate API failed', err);
        return { translatedText: text };
    }
}
/**
 * Translate text to multiple target languages in one batch.
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