"use strict";
// ============================================================
// OrgsLedger — OpenAI Whisper STT + TTS Service
// Replaces Google Cloud Speech-to-Text with Whisper for better
// multilingual accuracy. Adds server-side TTS via OpenAI.
//
// Whisper: Excellent at 50+ languages, $0.006/min
// TTS: tts-1 model, server-generated mp3, consistent cross-platform
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.isWhisperAvailable = isWhisperAvailable;
exports.getWhisperDiagnostics = getWhisperDiagnostics;
exports.transcribeAudio = transcribeAudio;
exports.generateTTSAudio = generateTTSAudio;
const config_1 = require("../config");
const logger_1 = require("../logger");
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
        ttsModel: 'tts-1',
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
// ── OpenAI Text-to-Speech ───────────────────────────────
/**
 * Generate speech audio from text using OpenAI TTS.
 * Returns mp3 audio as a Buffer.
 *
 * @param text - Text to speak
 * @param options.voice - Voice selection (default: 'nova' — warm, natural)
 * @param options.speed - Playback speed 0.25–4.0 (default: 1.0)
 */
async function generateTTSAudio(text, options = {}) {
    const client = getClient();
    // Truncate very long text to prevent excessive TTS costs
    const truncated = text.length > 500 ? text.slice(0, 500) : text;
    const startMs = Date.now();
    const response = await client.audio.speech.create({
        model: 'tts-1',
        input: truncated,
        voice: options.voice || 'nova',
        response_format: 'mp3',
        speed: options.speed || 1.0,
    });
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const elapsed = Date.now() - startMs;
    logger_1.logger.debug(`[TTS] Generated: "${truncated.slice(0, 40)}..." (voice=${options.voice || 'nova'}, ${elapsed}ms, ${(buffer.length / 1024).toFixed(1)}KB)`);
    return buffer;
}
//# sourceMappingURL=whisper.service.js.map