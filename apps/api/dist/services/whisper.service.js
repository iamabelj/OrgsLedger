"use strict";
// ============================================================
// OrgsLedger — OpenAI Whisper STT + Google Cloud TTS Service
// Whisper for STT, Google Cloud for TTS.
//
// Whisper: Excellent at 50+ languages, $0.006/min
// Google TTS: WaveNet/Standard voices, reliable, many languages
// ============================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isWhisperAvailable = isWhisperAvailable;
exports.getWhisperDiagnostics = getWhisperDiagnostics;
exports.transcribeAudio = transcribeAudio;
exports.generateTTSAudio = generateTTSAudio;
const config_1 = require("../config");
const logger_1 = require("../logger");
const path_1 = __importDefault(require("path"));
// ── Singleton OpenAI client ─────────────────────────────
let openaiClient = null;
function getClient() {
    if (!openaiClient) {
        if (!config_1.config.ai.openaiApiKey) {
            throw new Error('OpenAI API key not configured — Whisper and TTS will not work');
        }
        const OpenAI = require('openai').default;
        openaiClient = new OpenAI({ apiKey: config_1.config.ai.openaiApiKey });
        logger_1.logger.info('[WHISPER] OpenAI client initialized for STT + TTS');
    }
    return openaiClient;
}
// ── Availability Check ──────────────────────────────────
function isWhisperAvailable() {
    return !!config_1.config.ai.openaiApiKey;
}
function getWhisperDiagnostics() {
    return {
        openaiKeyConfigured: !!config_1.config.ai.openaiApiKey,
        openaiKeyPrefix: config_1.config.ai.openaiApiKey
            ? config_1.config.ai.openaiApiKey.slice(0, 10) + '...'
            : '(not set)',
        engine: 'openai-whisper-1',
        ttsEngine: 'google-cloud-tts',
    };
}
// ── Whisper Speech-to-Text ──────────────────────────────
/**
 * Transcribe an audio segment using OpenAI Whisper.
 * Accepts a Buffer of complete audio (webm, mp3, wav, etc.)
 * Returns the transcript text.
 *
 * @param audioBuffer - Complete audio segment as a Buffer
 * @param options.language - ISO-639-1 hint (e.g., 'en', 'es', 'fr')
 * @param options.prompt - Previous context for better continuity
 */
async function transcribeAudio(audioBuffer, options = {}) {
    const client = getClient();
    const { toFile } = require('openai');
    // Convert Buffer to a file-like object the SDK can upload
    const file = await toFile(audioBuffer, 'segment.webm', { type: 'audio/webm' });
    const params = {
        model: 'whisper-1',
        file,
        response_format: 'json',
    };
    // Language hint improves accuracy — Whisper ISO-639-1 codes match ours
    if (options.language && options.language !== 'auto') {
        params.language = options.language;
    }
    // Prompt provides context from previous segments for continuity
    if (options.prompt) {
        params.prompt = options.prompt.slice(-200); // Whisper prompt max ~224 tokens
    }
    const startMs = Date.now();
    const result = await client.audio.transcriptions.create(params);
    const elapsed = Date.now() - startMs;
    const text = result.text?.trim() || '';
    logger_1.logger.info(`[WHISPER] Transcribed: "${text.slice(0, 80)}${text.length > 80 ? '...' : ''}" (lang=${options.language || 'auto'}, ${elapsed}ms, ${(audioBuffer.length / 1024).toFixed(1)}KB)`);
    return { text };
}
// ── Google Cloud Text-to-Speech ─────────────────────────
// Map ISO-639-1 language codes to Google Cloud TTS language codes + voice names
// Google TTS uses BCP-47 codes (e.g., 'en-US', 'es-ES', 'fr-FR')
const GOOGLE_TTS_VOICES = {
    en: { languageCode: 'en-US', voiceName: 'en-US-Neural2-F' },
    es: { languageCode: 'es-ES', voiceName: 'es-ES-Neural2-A' },
    fr: { languageCode: 'fr-FR', voiceName: 'fr-FR-Neural2-A' },
    de: { languageCode: 'de-DE', voiceName: 'de-DE-Neural2-A' },
    it: { languageCode: 'it-IT', voiceName: 'it-IT-Neural2-A' },
    pt: { languageCode: 'pt-BR', voiceName: 'pt-BR-Neural2-A' },
    ja: { languageCode: 'ja-JP', voiceName: 'ja-JP-Neural2-B' },
    ko: { languageCode: 'ko-KR', voiceName: 'ko-KR-Neural2-A' },
    zh: { languageCode: 'cmn-CN', voiceName: 'cmn-CN-Wavenet-A' },
    ar: { languageCode: 'ar-XA', voiceName: 'ar-XA-Wavenet-A' },
    hi: { languageCode: 'hi-IN', voiceName: 'hi-IN-Neural2-A' },
    ru: { languageCode: 'ru-RU', voiceName: 'ru-RU-Wavenet-A' },
    nl: { languageCode: 'nl-NL', voiceName: 'nl-NL-Wavenet-A' },
    pl: { languageCode: 'pl-PL', voiceName: 'pl-PL-Wavenet-A' },
    tr: { languageCode: 'tr-TR', voiceName: 'tr-TR-Wavenet-A' },
    sv: { languageCode: 'sv-SE', voiceName: 'sv-SE-Wavenet-A' },
    da: { languageCode: 'da-DK', voiceName: 'da-DK-Wavenet-A' },
    no: { languageCode: 'nb-NO', voiceName: 'nb-NO-Wavenet-A' },
    fi: { languageCode: 'fi-FI', voiceName: 'fi-FI-Wavenet-A' },
    el: { languageCode: 'el-GR', voiceName: 'el-GR-Wavenet-A' },
    cs: { languageCode: 'cs-CZ', voiceName: 'cs-CZ-Wavenet-A' },
    ro: { languageCode: 'ro-RO', voiceName: 'ro-RO-Wavenet-A' },
    hu: { languageCode: 'hu-HU', voiceName: 'hu-HU-Wavenet-A' },
    uk: { languageCode: 'uk-UA', voiceName: 'uk-UA-Wavenet-A' },
    id: { languageCode: 'id-ID', voiceName: 'id-ID-Wavenet-A' },
    ms: { languageCode: 'ms-MY', voiceName: 'ms-MY-Wavenet-A' },
    th: { languageCode: 'th-TH', voiceName: 'th-TH-Standard-A' },
    vi: { languageCode: 'vi-VN', voiceName: 'vi-VN-Wavenet-A' },
    bg: { languageCode: 'bg-BG', voiceName: 'bg-BG-Standard-A' },
    sk: { languageCode: 'sk-SK', voiceName: 'sk-SK-Wavenet-A' },
    fil: { languageCode: 'fil-PH', voiceName: 'fil-PH-Wavenet-A' },
    he: { languageCode: 'he-IL', voiceName: 'he-IL-Wavenet-A' },
    bn: { languageCode: 'bn-IN', voiceName: 'bn-IN-Wavenet-A' },
    ta: { languageCode: 'ta-IN', voiceName: 'ta-IN-Wavenet-A' },
    te: { languageCode: 'te-IN', voiceName: 'te-IN-Standard-A' },
    mr: { languageCode: 'mr-IN', voiceName: 'mr-IN-Wavenet-A' },
    gu: { languageCode: 'gu-IN', voiceName: 'gu-IN-Wavenet-A' },
    kn: { languageCode: 'kn-IN', voiceName: 'kn-IN-Wavenet-A' },
    ml: { languageCode: 'ml-IN', voiceName: 'ml-IN-Wavenet-A' },
    pa: { languageCode: 'pa-IN', voiceName: 'pa-IN-Wavenet-A' },
    af: { languageCode: 'af-ZA', voiceName: 'af-ZA-Standard-A' },
    ca: { languageCode: 'ca-ES', voiceName: 'ca-ES-Standard-A' },
    eu: { languageCode: 'eu-ES', voiceName: 'eu-ES-Standard-A' },
    gl: { languageCode: 'gl-ES', voiceName: 'gl-ES-Standard-A' },
    is: { languageCode: 'is-IS', voiceName: 'is-IS-Standard-A' },
    lv: { languageCode: 'lv-LV', voiceName: 'lv-LV-Standard-A' },
    lt: { languageCode: 'lt-LT', voiceName: 'lt-LT-Standard-A' },
    sr: { languageCode: 'sr-RS', voiceName: 'sr-RS-Standard-A' },
    cy: { languageCode: 'cy-GB', voiceName: 'cy-GB-Standard-A' },
    yue: { languageCode: 'yue-HK', voiceName: 'yue-HK-Standard-A' },
};
/**
 * Get the Google TTS language config for an ISO code.
 * Falls back to Standard voice if no mapping exists.
 */
function getGoogleTTSVoice(langCode) {
    if (GOOGLE_TTS_VOICES[langCode])
        return GOOGLE_TTS_VOICES[langCode];
    // For unknown languages, return null — Google TTS may not support it
    return null;
}
let googleTTSClient = null;
function getGoogleTTSClient() {
    if (!googleTTSClient) {
        const credentialsPath = config_1.config.ai.googleCredentials ||
            path_1.default.resolve(__dirname, '../../google-credentials.json');
        try {
            const tts = require('@google-cloud/text-to-speech');
            googleTTSClient = new tts.TextToSpeechClient({
                keyFilename: credentialsPath,
            });
            logger_1.logger.info('[TTS] Google Cloud TTS client initialized');
        }
        catch (e) {
            logger_1.logger.error('[TTS] Failed to initialize Google Cloud TTS:', e.message);
            throw e;
        }
    }
    return googleTTSClient;
}
/**
 * Generate speech audio from text using Google Cloud TTS.
 * Returns mp3 audio as a Buffer.
 *
 * @param text - Text to speak
 * @param options.language - ISO-639-1 language code (default: 'en')
 * @param options.speed - Playback speed 0.25–4.0 (default: 1.0)
 */
async function generateTTSAudio(text, options = {}) {
    const client = getGoogleTTSClient();
    const langCode = options.language || 'en';
    // Truncate very long text to prevent excessive TTS costs
    const truncated = text.length > 500 ? text.slice(0, 500) : text;
    // Resolve voice config for requested language
    const voiceConfig = getGoogleTTSVoice(langCode);
    const languageCode = voiceConfig?.languageCode || `${langCode}-${langCode.toUpperCase()}`;
    const voiceName = voiceConfig?.voiceName || undefined; // Let Google pick default
    const startMs = Date.now();
    const request = {
        input: { text: truncated },
        voice: {
            languageCode,
            ...(voiceName ? { name: voiceName } : {}),
        },
        audioConfig: {
            audioEncoding: 'MP3',
            speakingRate: options.speed || 1.0,
            pitch: 0,
        },
    };
    try {
        const [response] = await client.synthesizeSpeech(request);
        const audioContent = response.audioContent;
        if (!audioContent) {
            throw new Error('Google TTS returned empty audio content');
        }
        const buffer = Buffer.isBuffer(audioContent)
            ? audioContent
            : Buffer.from(audioContent);
        const elapsed = Date.now() - startMs;
        logger_1.logger.debug(`[TTS] Google TTS generated: "${truncated.slice(0, 40)}..." (lang=${languageCode}, ${elapsed}ms, ${(buffer.length / 1024).toFixed(1)}KB)`);
        return buffer;
    }
    catch (err) {
        logger_1.logger.error(`[TTS] Google Cloud TTS failed for lang=${languageCode}: ${err.message}`);
        throw err;
    }
}
//# sourceMappingURL=whisper.service.js.map