"use strict";
// ============================================================
// OrgsLedger — Realtime Session (per-speaker)
// Connects to OpenAI Realtime API via WebSocket, streams
// buffered PCM16 audio, and persists final transcripts to DB.
// After each DB insert it triggers translateAndBroadcast so
// other meeting participants receive the translated text.
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
const SILENCE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes — close if no transcript
const MAX_SESSION_DURATION_MS = 2 * 60 * 60 * 1000; // 2 hours hard cap
const MAX_RECONNECT_ATTEMPTS = 1; // One reconnect attempt max
// ── Realtime Session ─────────────────────────────────────────
class RealtimeSession {
    ws = null;
    audioProcessor;
    closed = false;
    reconnectAttempts = 0;
    silenceTimer = null;
    maxDurationTimer = null;
    lastTranscriptAt = Date.now();
    // ── LAYER 3.3 / 4.1 / 8 — Counters for debugging & cost control
    audioChunksSent = 0;
    transcriptsReceived = 0;
    transcriptsPersisted = 0;
    sessionOpenedAt = 0;
    AUDIO_LOG_INTERVAL = 200; // Log every N chunks
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
        logger_1.logger.info(`[RealtimeSession] Created for speaker=${this.speakerName} (${this.speakerId}) meeting=${this.meetingId}`);
    }
    // ── Public API ──────────────────────────────────────────
    /** Open WebSocket to OpenAI Realtime and configure the session. */
    async connect() {
        if (this.closed)
            return;
        const apiKey = config_1.config.ai.openaiApiKey;
        if (!apiKey) {
            logger_1.logger.error('[RealtimeSession] OPENAI_API_KEY not configured — cannot start transcription');
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
                // ── LAYER 3.1 — WebSocket successfully opens ────
                this.sessionOpenedAt = Date.now();
                logger_1.logger.info(`[Realtime] Session opened for speaker ${this.speakerId} (name=${this.speakerName}, meeting=${this.meetingId})`);
                this.configureSession();
                this.startTimers();
                resolve();
            });
            this.ws.on('message', (data) => {
                this.handleMessage(data);
            });
            this.ws.on('error', (err) => {
                logger_1.logger.error(`[Realtime] WebSocket ERROR for speaker ${this.speakerId}: meeting=${this.meetingId}, error=${err?.message || err}`);
                this.handleDisconnect();
            });
            this.ws.on('close', (code, reason) => {
                logger_1.logger.warn(`[Realtime] WebSocket CLOSED for speaker ${this.speakerId}: meeting=${this.meetingId}, code=${code}, reason=${reason?.toString() || 'none'}`);
                this.handleDisconnect();
            });
            // Reject after 10s if connection hangs
            setTimeout(() => {
                if (this.ws?.readyState !== ws_1.default.OPEN) {
                    reject(new Error('OpenAI Realtime connection timeout'));
                    this.close();
                }
            }, 10_000);
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
        // ── LAYER 7.1 + 8 — Session lifecycle summary ─────
        const sessionDurationSec = this.sessionOpenedAt ? ((Date.now() - this.sessionOpenedAt) / 1000).toFixed(1) : '0';
        logger_1.logger.info(`[Realtime] Closing session for ${this.speakerId}: meeting=${this.meetingId}, audioChunksSent=${this.audioChunksSent}, transcriptsReceived=${this.transcriptsReceived}, transcriptsPersisted=${this.transcriptsPersisted}, sessionDuration=${sessionDurationSec}s`);
        // Flush remaining audio
        this.audioProcessor.close();
        // Clear timers
        if (this.silenceTimer)
            clearTimeout(this.silenceTimer);
        if (this.maxDurationTimer)
            clearTimeout(this.maxDurationTimer);
        // Close WebSocket
        if (this.ws) {
            try {
                if (this.ws.readyState === ws_1.default.OPEN) {
                    // Commit any buffered audio before closing
                    this.sendEvent({
                        type: 'input_audio_buffer.commit',
                    });
                }
                this.ws.close(1000, 'session_end');
            }
            catch (e) {
                // Ignore close errors
            }
            this.ws = null;
        }
    }
    get isClosed() {
        return this.closed;
    }
    // ── Session Configuration ───────────────────────────────
    /**
     * Send session.update to configure OpenAI Realtime for
     * transcription-only mode with server-side VAD.
     */
    configureSession() {
        this.sendEvent({
            type: 'session.update',
            session: {
                // We only want transcription — no AI response audio
                modalities: ['text'],
                instructions: 'You are a transcription assistant. Transcribe exactly what the speaker says. Do not add commentary, do not translate, do not correct. Output verbatim text only.',
                input_audio_format: 'pcm16',
                input_audio_transcription: {
                    model: 'whisper-1',
                },
                // Server-side VAD for silence detection
                turn_detection: {
                    type: 'server_vad',
                    threshold: 0.5,
                    prefix_padding_ms: 300,
                    silence_duration_ms: 500,
                },
                // Minimal temperature for faithful transcription
                temperature: 0.0,
                max_response_output_tokens: 1,
            },
        });
        // ── LAYER 3.2 — Confirm session.update sent ────────
        logger_1.logger.info(`[Realtime] Session configured for speaker ${this.speakerId}: format=pcm16, sampleRate=24kHz, vad=server_vad(threshold=0.5, silence=500ms), model=whisper-1`);
    }
    // ── Audio Sending ───────────────────────────────────────
    /** Send a base64-encoded PCM16 audio chunk to OpenAI. */
    sendAudio(pcm16Base64) {
        if (this.closed || !this.ws || this.ws.readyState !== ws_1.default.OPEN)
            return;
        this.sendEvent({
            type: 'input_audio_buffer.append',
            audio: pcm16Base64,
        });
        // ── LAYER 3.3 — Audio chunk send counter ──────────
        this.audioChunksSent++;
        if (this.audioChunksSent === 1) {
            logger_1.logger.info(`[Realtime] First audio chunk sent for speaker ${this.speakerId} (bytes=${Buffer.from(pcm16Base64, 'base64').length})`);
        }
        if (this.audioChunksSent % this.AUDIO_LOG_INTERVAL === 0) {
            logger_1.logger.info(`[Realtime] Sent ${this.audioChunksSent} audio chunks for speaker ${this.speakerId}`);
        }
    }
    // ── Message Handling ────────────────────────────────────
    /** Parse incoming OpenAI Realtime events. */
    handleMessage(raw) {
        try {
            const data = JSON.parse(raw.toString());
            if (data.type !== 'response.completed')
                return;
            let transcript = '';
            if (data.response?.output?.length) {
                for (const item of data.response.output) {
                    if (item.content?.length) {
                        for (const content of item.content) {
                            if (content.type === 'output_text' && content.text) {
                                transcript += content.text;
                            }
                        }
                    }
                }
            }
            transcript = transcript.trim();
            if (!transcript || transcript.length < 3) {
                logger_1.logger.debug(`[Realtime] Ignored empty transcript for speaker=${this.speakerId}`);
                return;
            }
            this.transcriptsReceived++;
            logger_1.logger.info(`[Realtime] Final transcript for ${this.speakerId}: "${transcript.slice(0, 80)}${transcript.length > 80 ? '...' : ''}" (len=${transcript.length}, totalReceived=${this.transcriptsReceived})`);
            this.handleTranscript(transcript);
        }
        catch (err) {
            logger_1.logger.warn(`[RealtimeSession] Failed to parse message: speaker=${this.speakerName}`, err);
        }
    }
    // ── Transcript Persistence ──────────────────────────────
    /**
     * Save a final transcript segment to DB and trigger the
     * translation/broadcast callback.
     */
    async handleTranscript(text) {
        const now = Date.now();
        this.lastTranscriptAt = now;
        this.resetSilenceTimer();
        logger_1.logger.info(`[STT_PIPELINE] Transcript persisting: speaker=${this.speakerName}, meeting=${this.meetingId}, text="${text.slice(0, 80)}..."`);
        // ── LAYER 5.1 — Persist to meeting_transcripts table ─
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
            logger_1.logger.info(`[DB] Transcript saved: id=${inserted?.[0] || 'unknown'}, meeting=${this.meetingId}, speaker=${this.speakerName}, totalPersisted=${this.transcriptsPersisted}`);
        }
        catch (dbErr) {
            logger_1.logger.error(`[DB] Transcript insert FAILED: speaker=${this.speakerName}, meeting=${this.meetingId}, error=${dbErr?.message}`);
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
            logger_1.logger.info(`[RealtimeSession] Reconnecting (attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}): speaker=${this.speakerName}`);
            // Wait 2 seconds before reconnecting
            setTimeout(() => {
                if (!this.closed) {
                    this.connect().catch((err) => {
                        logger_1.logger.error(`[RealtimeSession] Reconnect failed: speaker=${this.speakerName}`, err);
                        this.close();
                    });
                }
            }, 2000);
        }
        else {
            logger_1.logger.warn(`[RealtimeSession] Max reconnect attempts reached, closing: speaker=${this.speakerName}`);
            this.close();
        }
    }
    // ── Safety Timers ───────────────────────────────────────
    startTimers() {
        // Silence timer: close session if no transcript for 10 minutes
        this.resetSilenceTimer();
        // Hard limit: close session after 2 hours regardless
        this.maxDurationTimer = setTimeout(() => {
            logger_1.logger.warn(`[RealtimeSession] Max session duration reached (2h), closing: speaker=${this.speakerName}`);
            this.close();
        }, MAX_SESSION_DURATION_MS);
    }
    resetSilenceTimer() {
        if (this.silenceTimer)
            clearTimeout(this.silenceTimer);
        this.silenceTimer = setTimeout(() => {
            logger_1.logger.warn(`[RealtimeSession] No transcript for 10 minutes, closing: speaker=${this.speakerName}`);
            this.close();
        }, SILENCE_TIMEOUT_MS);
    }
    // ── Helpers ─────────────────────────────────────────────
    sendEvent(event) {
        if (this.ws && this.ws.readyState === ws_1.default.OPEN) {
            this.ws.send(JSON.stringify(event));
        }
    }
}
exports.RealtimeSession = RealtimeSession;
//# sourceMappingURL=realtimeSession.js.map