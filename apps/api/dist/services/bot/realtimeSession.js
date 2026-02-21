"use strict";
// ============================================================
// OrgsLedger — Realtime Session (per-speaker)
// Clean rewrite: connects to OpenAI Realtime API via WebSocket,
// streams PCM16 audio, uses ONLY Whisper transcription.
// Model responses are actively cancelled — the bot is a
// completely silent member that only transcribes.
// ============================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RealtimeSession = void 0;
const ws_1 = __importDefault(require("ws"));
const logger_1 = require("../../logger");
const db_1 = __importDefault(require("../../db"));
const config_1 = require("../../config");
const audioProcessor_1 = require("./audioProcessor");
// ── Constants ────────────────────────────────────────────────
const OPENAI_REALTIME_URL = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17';
const SILENCE_TIMEOUT_MS = 10 * 60 * 1000; // 10 min — close if no transcript
const MAX_SESSION_DURATION_MS = 2 * 60 * 60 * 1000; // 2 hours hard cap
const MAX_RECONNECT_ATTEMPTS = 2;
const CONNECT_TIMEOUT_MS = 15_000;
// ── Realtime Session ─────────────────────────────────────────
class RealtimeSession {
    ws = null;
    audioProcessor;
    closed = false;
    reconnectAttempts = 0;
    silenceTimer = null;
    maxDurationTimer = null;
    lastTranscriptAt = Date.now();
    // Stats
    audioChunksSent = 0;
    transcriptsReceived = 0;
    transcriptsPersisted = 0;
    sessionOpenedAt = 0;
    // Config
    meetingId;
    organizationId;
    speakerId;
    speakerName;
    sourceLang;
    onTranscript;
    constructor(opts) {
        this.meetingId = opts.meetingId;
        this.organizationId = opts.organizationId;
        this.speakerId = opts.speakerId;
        this.speakerName = opts.speakerName;
        this.sourceLang = opts.sourceLang || 'en';
        this.onTranscript = opts.onTranscript;
        // AudioProcessor flushes 50ms PCM16 batches → send to OpenAI
        this.audioProcessor = new audioProcessor_1.AudioProcessor((pcm16Base64) => {
            this.sendAudio(pcm16Base64);
        });
        logger_1.logger.info(`[RealtimeSession] Created: speaker=${this.speakerName} (${this.speakerId}), meeting=${this.meetingId}`);
    }
    // ── Public API ──────────────────────────────────────────
    /** Open WebSocket to OpenAI Realtime and configure the session. */
    async connect() {
        if (this.closed)
            return;
        const apiKey = config_1.config.ai.openaiApiKey;
        if (!apiKey) {
            logger_1.logger.error('[RealtimeSession] OPENAI_API_KEY not set — cannot start transcription');
            return;
        }
        return new Promise((resolve, reject) => {
            this.ws = new ws_1.default(OPENAI_REALTIME_URL, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'OpenAI-Beta': 'realtime=v1',
                },
            });
            this.ws.on('open', () => {
                this.sessionOpenedAt = Date.now();
                logger_1.logger.info(`[RealtimeSession] Connected: speaker=${this.speakerName}, meeting=${this.meetingId}`);
                this.configureSession();
                this.startTimers();
                resolve();
            });
            this.ws.on('message', (data) => this.handleMessage(data));
            this.ws.on('error', (err) => {
                logger_1.logger.error(`[RealtimeSession] WS error: speaker=${this.speakerId}, err=${err?.message || err}`);
                this.handleDisconnect();
            });
            this.ws.on('close', (code, reason) => {
                logger_1.logger.warn(`[RealtimeSession] WS closed: speaker=${this.speakerId}, code=${code}, reason=${reason?.toString() || 'none'}`);
                this.handleDisconnect();
            });
            // Timeout guard
            setTimeout(() => {
                if (this.ws?.readyState !== ws_1.default.OPEN) {
                    reject(new Error('OpenAI Realtime connection timeout'));
                    this.close();
                }
            }, CONNECT_TIMEOUT_MS);
        });
    }
    /**
     * Feed audio data from LiveKit track into this session.
     * Accepts Float32 (standard LiveKit) or raw PCM16 Buffer.
     */
    pushAudio(audio) {
        if (this.closed)
            return;
        if (audio instanceof Float32Array) {
            this.audioProcessor.pushFloat32(audio);
        }
        else {
            this.audioProcessor.pushPcm16(audio);
        }
    }
    /** Gracefully close the session and free all resources. */
    close() {
        if (this.closed)
            return;
        this.closed = true;
        const dur = this.sessionOpenedAt ? ((Date.now() - this.sessionOpenedAt) / 1000).toFixed(1) : '0';
        logger_1.logger.info(`[RealtimeSession] Closing: speaker=${this.speakerId}, chunks=${this.audioChunksSent}, transcripts=${this.transcriptsReceived}, persisted=${this.transcriptsPersisted}, duration=${dur}s`);
        this.audioProcessor.close();
        if (this.silenceTimer)
            clearTimeout(this.silenceTimer);
        if (this.maxDurationTimer)
            clearTimeout(this.maxDurationTimer);
        if (this.ws) {
            try {
                if (this.ws.readyState === ws_1.default.OPEN) {
                    this.send({ type: 'input_audio_buffer.commit' });
                }
                this.ws.close(1000, 'session_end');
            }
            catch (_) { /* ignore */ }
            this.ws = null;
        }
    }
    get isClosed() {
        return this.closed;
    }
    // ── Session Configuration ───────────────────────────────
    /**
     * Configure OpenAI Realtime for transcription-only mode.
     * Key design decisions:
     *  - modalities: ['text'] — no audio output
     *  - instructions: stay silent, never respond
     *  - input_audio_transcription: whisper-1 (the ONLY transcript source)
     *  - turn_detection: server_vad for automatic speech segmentation
     *  - max_response_output_tokens: 1 — minimise wasted model tokens
     */
    configureSession() {
        this.send({
            type: 'session.update',
            session: {
                modalities: ['text'],
                instructions: 'Do not respond. Do not output any text. You are used solely for audio transcription via the input_audio_transcription feature. Stay completely silent. Output nothing.',
                input_audio_format: 'pcm16',
                input_audio_transcription: { model: 'whisper-1' },
                turn_detection: {
                    type: 'server_vad',
                    threshold: 0.5,
                    prefix_padding_ms: 300,
                    silence_duration_ms: 500,
                },
                temperature: 0.0,
                max_response_output_tokens: 1,
            },
        });
        logger_1.logger.info(`[RealtimeSession] Session configured: speaker=${this.speakerId}, whisper-1, server_vad`);
    }
    // ── Audio Sending ───────────────────────────────────────
    sendAudio(pcm16Base64) {
        if (this.closed || !this.ws || this.ws.readyState !== ws_1.default.OPEN)
            return;
        this.send({ type: 'input_audio_buffer.append', audio: pcm16Base64 });
        this.audioChunksSent++;
        if (this.audioChunksSent === 1) {
            logger_1.logger.info(`[RealtimeSession] First audio chunk sent: speaker=${this.speakerId}`);
        }
        else if (this.audioChunksSent % 200 === 0) {
            logger_1.logger.debug(`[RealtimeSession] Audio chunks: ${this.audioChunksSent}, speaker=${this.speakerId}`);
        }
    }
    // ── Message Handling ────────────────────────────────────
    handleMessage(raw) {
        try {
            const event = JSON.parse(raw.toString());
            switch (event.type) {
                // ─── Session lifecycle ───────────────────────
                case 'session.created':
                    logger_1.logger.info(`[RealtimeSession] OpenAI session created: speaker=${this.speakerId}`);
                    break;
                case 'session.updated':
                    logger_1.logger.info(`[RealtimeSession] Session updated: speaker=${this.speakerId}`);
                    break;
                // ─── Whisper transcription (ONLY transcript source) ──
                case 'conversation.item.input_audio_transcription.completed':
                    this.transcriptsReceived++;
                    if (event.transcript?.trim()) {
                        const text = event.transcript.trim();
                        if (text.length < 3) {
                            logger_1.logger.debug(`[RealtimeSession] Short transcript filtered (<3 chars): speaker=${this.speakerId}`);
                            break;
                        }
                        logger_1.logger.info(`[RealtimeSession] Transcript: speaker=${this.speakerName}, text="${text.slice(0, 80)}${text.length > 80 ? '...' : ''}"`);
                        this.persistAndBroadcast(text);
                    }
                    break;
                case 'conversation.item.input_audio_transcription.failed':
                    logger_1.logger.error(`[RealtimeSession] Whisper FAILED: speaker=${this.speakerId}, error=${JSON.stringify(event.error || {})}`);
                    break;
                // ─── VAD events (debug only) ────────────────
                case 'input_audio_buffer.speech_started':
                case 'input_audio_buffer.speech_stopped':
                case 'input_audio_buffer.committed':
                    break;
                // ─── Model response events — CANCEL immediately ──
                // The bot is a silent member. We actively cancel every
                // model response to prevent any AI-generated output.
                case 'response.created':
                    if (event.response?.id) {
                        this.send({ type: 'response.cancel' });
                    }
                    break;
                // All other model response lifecycle events — silently ignore
                case 'response.done':
                case 'response.output_item.added':
                case 'response.content_part.added':
                case 'response.output_item.done':
                case 'response.text.delta':
                case 'response.text.done':
                case 'response.cancelled':
                case 'conversation.item.created':
                    break;
                case 'error':
                    logger_1.logger.error(`[RealtimeSession] OpenAI error: speaker=${this.speakerId}, code=${event.error?.code}, msg=${event.error?.message}`);
                    break;
                default:
                    break;
            }
        }
        catch (err) {
            logger_1.logger.warn(`[RealtimeSession] Parse error: speaker=${this.speakerName}`, err);
        }
    }
    // ── Transcript Persistence ──────────────────────────────
    async persistAndBroadcast(text) {
        const now = Date.now();
        this.lastTranscriptAt = now;
        this.resetSilenceTimer();
        // Persist to DB
        try {
            const inserted = await (0, db_1.default)('meeting_transcripts').insert({
                meeting_id: this.meetingId,
                organization_id: this.organizationId,
                speaker_id: this.speakerId,
                speaker_name: this.speakerName,
                original_text: text,
                source_lang: this.sourceLang,
                translations: JSON.stringify({}),
                spoken_at: now,
            });
            this.transcriptsPersisted++;
            logger_1.logger.info(`[RealtimeSession] Saved: id=${inserted?.[0] || '?'}, speaker=${this.speakerName}, total=${this.transcriptsPersisted}`);
        }
        catch (dbErr) {
            logger_1.logger.error(`[RealtimeSession] DB insert failed: speaker=${this.speakerName}, err=${dbErr?.message}`);
        }
        // Trigger translation + broadcast callback
        const row = {
            meetingId: this.meetingId,
            organizationId: this.organizationId,
            speakerId: this.speakerId,
            speakerName: this.speakerName,
            text,
            sourceLang: this.sourceLang,
            timestamp: now,
        };
        if (this.onTranscript) {
            try {
                await this.onTranscript(row);
            }
            catch (cbErr) {
                logger_1.logger.error(`[RealtimeSession] onTranscript callback failed`, cbErr);
            }
        }
    }
    // ── Reconnection ────────────────────────────────────────
    handleDisconnect() {
        if (this.closed)
            return;
        if (this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            this.reconnectAttempts++;
            const delay = 2000 * this.reconnectAttempts; // 2s, 4s
            logger_1.logger.info(`[RealtimeSession] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}): speaker=${this.speakerName}`);
            setTimeout(() => {
                if (!this.closed) {
                    this.connect().catch((err) => {
                        logger_1.logger.error(`[RealtimeSession] Reconnect failed: speaker=${this.speakerName}`, err);
                        this.close();
                    });
                }
            }, delay);
        }
        else {
            logger_1.logger.warn(`[RealtimeSession] Max reconnects reached, closing: speaker=${this.speakerName}`);
            this.close();
        }
    }
    // ── Timers ──────────────────────────────────────────────
    startTimers() {
        this.resetSilenceTimer();
        this.maxDurationTimer = setTimeout(() => {
            logger_1.logger.warn(`[RealtimeSession] Max duration (2h) reached, closing: speaker=${this.speakerName}`);
            this.close();
        }, MAX_SESSION_DURATION_MS);
    }
    resetSilenceTimer() {
        if (this.silenceTimer)
            clearTimeout(this.silenceTimer);
        this.silenceTimer = setTimeout(() => {
            logger_1.logger.warn(`[RealtimeSession] Silence timeout (10 min), closing: speaker=${this.speakerName}`);
            this.close();
        }, SILENCE_TIMEOUT_MS);
    }
    // ── Helpers ─────────────────────────────────────────────
    send(event) {
        if (this.ws && this.ws.readyState === ws_1.default.OPEN) {
            this.ws.send(JSON.stringify(event));
        }
    }
}
exports.RealtimeSession = RealtimeSession;
//# sourceMappingURL=realtimeSession.js.map