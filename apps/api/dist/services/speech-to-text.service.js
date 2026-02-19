"use strict";
// ============================================================
// OrgsLedger — Google Cloud Speech-to-Text Streaming Service
// Per-user streaming recognition session. Receives audio chunks
// from the client via Socket.IO and returns transcripts.
// Supports WEBM_OPUS (browser MediaRecorder) and LINEAR16 (raw PCM).
// Works for both web and mobile clients.
// ============================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpeechSession = void 0;
const speech_1 = require("@google-cloud/speech");
const path_1 = __importDefault(require("path"));
const logger_1 = require("../logger");
// ── Constants ────────────────────────────────────────────
const STREAMING_LIMIT_MS = 4 * 60 * 1000; // Google STT streams max ~5min; restart at 4min
const RESTART_DELAY_MS = 300;
// Shared client singleton (reuse across sessions for efficiency)
let sharedClient = null;
function getClient() {
    if (!sharedClient) {
        const credPath = path_1.default.resolve(__dirname, '../../google-credentials.json');
        sharedClient = new speech_1.SpeechClient({ keyFilename: credPath });
        logger_1.logger.info(`[STT] Google Speech client initialized (credentials: ${credPath})`);
    }
    return sharedClient;
}
// ── Session Class ────────────────────────────────────────
class SpeechSession {
    client;
    recognizeStream = null;
    closed = false;
    restartTimer = null;
    restartCounter = 0;
    streamStartTime = 0;
    bytesSent = 0;
    meetingId;
    userId;
    speakerName;
    languageCode;
    encoding;
    sampleRateHertz;
    onTranscript;
    onError;
    constructor(opts) {
        this.meetingId = opts.meetingId;
        this.userId = opts.userId;
        this.speakerName = opts.speakerName;
        this.languageCode = opts.languageCode || 'en-US';
        this.encoding = opts.encoding || 'WEBM_OPUS';
        this.sampleRateHertz = opts.sampleRateHertz || (this.encoding === 'WEBM_OPUS' ? 48000 : 16000);
        this.onTranscript = opts.onTranscript;
        this.onError = opts.onError;
        this.client = getClient();
        logger_1.logger.info(`[STT] Session created: speaker=${this.speakerName}, meeting=${this.meetingId}, lang=${this.languageCode}, encoding=${this.encoding}, rate=${this.sampleRateHertz}`);
    }
    // ── Public API ──────────────────────────────────────────
    /** Start the streaming recognition. */
    start() {
        if (this.closed)
            return;
        this.createStream();
    }
    /** Push an audio chunk (Buffer, ArrayBuffer, or base64 string). */
    pushAudio(data) {
        if (this.closed || !this.recognizeStream)
            return;
        let buf;
        if (typeof data === 'string') {
            buf = Buffer.from(data, 'base64');
        }
        else if (data instanceof ArrayBuffer) {
            buf = Buffer.from(data);
        }
        else {
            buf = data;
        }
        this.bytesSent += buf.length;
        try {
            this.recognizeStream.write(buf);
        }
        catch (err) {
            logger_1.logger.debug(`[STT] Write failed for ${this.speakerName}, restarting stream`);
            this.restartStream();
        }
        // Auto-restart before Google's streaming limit
        if (Date.now() - this.streamStartTime > STREAMING_LIMIT_MS) {
            logger_1.logger.info(`[STT] Approaching stream limit, restarting: speaker=${this.speakerName}, bytes=${this.bytesSent}`);
            this.restartStream();
        }
    }
    /** Gracefully close the session. */
    close() {
        if (this.closed)
            return;
        this.closed = true;
        logger_1.logger.info(`[STT] Closing session: speaker=${this.speakerName}, meeting=${this.meetingId}, totalBytes=${this.bytesSent}, restarts=${this.restartCounter}`);
        if (this.restartTimer) {
            clearTimeout(this.restartTimer);
            this.restartTimer = null;
        }
        if (this.recognizeStream) {
            try {
                this.recognizeStream.end();
            }
            catch (_) { }
            this.recognizeStream = null;
        }
        // Don't close the shared client
    }
    get isClosed() {
        return this.closed;
    }
    // ── Internals ──────────────────────────────────────────
    createStream() {
        if (this.closed)
            return;
        const config = {
            encoding: this.encoding,
            languageCode: this.languageCode,
            enableAutomaticPunctuation: true,
            model: 'latest_long',
            useEnhanced: true,
            speechContexts: [{
                    phrases: ['meeting', 'agenda', 'motion', 'resolution', 'vote', 'minutes'],
                    boost: 5,
                }],
        };
        // For LINEAR16, set sampleRateHertz explicitly
        // For WEBM_OPUS, Google auto-detects from the container header
        if (this.encoding === 'LINEAR16') {
            config.sampleRateHertz = this.sampleRateHertz;
        }
        const request = {
            config,
            interimResults: true,
        };
        this.recognizeStream = this.client.streamingRecognize(request)
            .on('data', (response) => {
            if (this.closed)
                return;
            const result = response.results?.[0];
            if (!result?.alternatives?.[0])
                return;
            const transcript = result.alternatives[0].transcript?.trim();
            const isFinal = result.isFinal === true;
            if (!transcript)
                return;
            if (isFinal) {
                logger_1.logger.info(`[STT] Final: speaker=${this.speakerName}, text="${transcript.slice(0, 80)}${transcript.length > 80 ? '...' : ''}" (len=${transcript.length})`);
            }
            this.onTranscript(transcript, isFinal);
        })
            .on('error', (err) => {
            if (this.closed)
                return;
            // Code 11 = UNAVAILABLE, 4 = DEADLINE_EXCEEDED — normal stream timeout
            if (err.code === 11 || err.code === 4) {
                logger_1.logger.debug(`[STT] Stream ended (code=${err.code}), restarting: speaker=${this.speakerName}`);
                this.restartStream();
                return;
            }
            logger_1.logger.error(`[STT] Error for ${this.speakerName}: code=${err.code}, message=${err.message}`);
            this.onError?.(err);
            // Try to restart on transient errors
            if (err.code !== 3 && err.code !== 7) { // Not INVALID_ARGUMENT or PERMISSION_DENIED
                this.restartStream();
            }
        })
            .on('end', () => {
            if (!this.closed) {
                logger_1.logger.debug(`[STT] Stream ended normally, restarting: speaker=${this.speakerName}`);
                this.restartStream();
            }
        });
        this.streamStartTime = Date.now();
        logger_1.logger.debug(`[STT] Stream created: speaker=${this.speakerName}, lang=${this.languageCode}, encoding=${this.encoding}, restart#=${this.restartCounter}`);
    }
    restartStream() {
        if (this.closed)
            return;
        if (this.recognizeStream) {
            try {
                this.recognizeStream.end();
            }
            catch (_) { }
            this.recognizeStream = null;
        }
        if (this.restartTimer)
            return;
        this.restartTimer = setTimeout(() => {
            this.restartTimer = null;
            if (!this.closed) {
                this.restartCounter++;
                this.createStream();
            }
        }, RESTART_DELAY_MS);
    }
}
exports.SpeechSession = SpeechSession;
//# sourceMappingURL=speech-to-text.service.js.map