"use strict";
// ============================================================
// OrgsLedger API — Deepgram Streaming Connection Pool
//
// Production-grade WebSocket pool for Deepgram real-time
// transcription. Manages up to 1 000 concurrent streams per
// worker through a configurable pool of persistent connections,
// with circuit-breaker protection, auto-reconnect, and
// Prometheus observability.
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deepgramPool = void 0;
exports.openDeepgramStream = openDeepgramStream;
exports.deepgramHealthCheck = deepgramHealthCheck;
exports.getDeepgramPoolStatus = getDeepgramPoolStatus;
exports.shutdownDeepgramPool = shutdownDeepgramPool;
const ws_1 = __importDefault(require("ws"));
const events_1 = require("events");
const client = __importStar(require("prom-client"));
const config_1 = require("../config");
const logger_1 = require("../logger");
const circuit_breaker_1 = require("../services/circuit-breaker");
// ── Configuration ───────────────────────────────────────────
function envInt(key, fallback) {
    const v = process.env[key];
    if (!v)
        return fallback;
    const n = parseInt(v, 10);
    return Number.isNaN(n) ? fallback : n;
}
const POOL_CONFIG = {
    /** Max WebSocket connections in the pool */
    poolSize: envInt('DEEPGRAM_POOL_SIZE', 50),
    /** Maximum concurrent streams a single connection can carry */
    streamsPerConnection: envInt('DEEPGRAM_STREAMS_PER_CONN', 20),
    /** Hard ceiling per worker (poolSize × streamsPerConnection also caps this) */
    maxConcurrentStreams: envInt('DEEPGRAM_MAX_STREAMS', 1000),
    /** Seconds between keep-alive pings */
    keepAliveIntervalMs: envInt('DEEPGRAM_KEEPALIVE_MS', 10_000),
    /** Connection timeout */
    connectTimeoutMs: envInt('DEEPGRAM_CONNECT_TIMEOUT_MS', 10_000),
    /** Max reconnect attempts per slot before marking it dead */
    maxReconnectAttempts: envInt('DEEPGRAM_MAX_RECONNECT', 10),
    /** Circuit breaker: failures before tripping */
    cbFailureThreshold: envInt('DEEPGRAM_CB_FAILURE_THRESHOLD', 5),
    /** Circuit breaker: reset timeout (ms) */
    cbResetTimeoutMs: envInt('DEEPGRAM_CB_RESET_TIMEOUT_MS', 30_000),
};
// ── Deepgram WebSocket URL ──────────────────────────────────
const DEEPGRAM_WS_URL = 'wss://api.deepgram.com/v1/listen';
// ── Audio constants for duration estimates ──────────────────
const BYTES_PER_SECOND = 2 * 16_000 * 1; // 16-bit PCM, 16 kHz, mono
// ── Prometheus Metrics ──────────────────────────────────────
const METRICS_PREFIX = 'orgsledger_deepgram_';
const poolActiveConnections = new client.Gauge({
    name: `${METRICS_PREFIX}pool_active_connections`,
    help: 'Number of active WebSocket connections in the Deepgram pool',
});
const poolActiveStreams = new client.Gauge({
    name: `${METRICS_PREFIX}pool_active_streams`,
    help: 'Total active audio streams across the pool',
});
const poolTotalStreamsCreated = new client.Counter({
    name: `${METRICS_PREFIX}pool_streams_created_total`,
    help: 'Total streams created since process start',
});
const poolStreamErrors = new client.Counter({
    name: `${METRICS_PREFIX}pool_stream_errors_total`,
    help: 'Total stream-level errors',
    labelNames: ['type'], // 'connect' | 'send' | 'parse'
});
const poolConnectionErrors = new client.Counter({
    name: `${METRICS_PREFIX}pool_connection_errors_total`,
    help: 'Total connection-level errors (reconnects, timeouts)',
});
const poolCircuitState = new client.Gauge({
    name: `${METRICS_PREFIX}pool_circuit_state`,
    help: 'Circuit breaker state: 0=closed, 1=half_open, 2=open',
});
const transcriptionLatency = new client.Histogram({
    name: `${METRICS_PREFIX}transcription_latency_ms`,
    help: 'Latency from audio send to transcript receipt (ms)',
    buckets: [50, 100, 200, 500, 1000, 2000, 5000],
});
const poolErrorRate = new client.Gauge({
    name: `${METRICS_PREFIX}pool_error_rate`,
    help: 'Rolling error rate (0-1) over the last 60 s',
});
// ── Internal: Single Pooled Connection ──────────────────────
var SlotState;
(function (SlotState) {
    SlotState[SlotState["IDLE"] = 0] = "IDLE";
    SlotState[SlotState["CONNECTING"] = 1] = "CONNECTING";
    SlotState[SlotState["READY"] = 2] = "READY";
    SlotState[SlotState["CLOSING"] = 3] = "CLOSING";
    SlotState[SlotState["DEAD"] = 4] = "DEAD";
})(SlotState || (SlotState = {}));
// ── Connection Pool ─────────────────────────────────────────
class DeepgramConnectionPool extends events_1.EventEmitter {
    slots = [];
    streams = new Map();
    circuitBreaker;
    streamCounter = 0;
    initialized = false;
    // Error-rate tracking: rolling window (60 s)
    errorTimestamps = [];
    successTimestamps = [];
    errorWindowMs = 60_000;
    constructor() {
        super();
        this.circuitBreaker = new circuit_breaker_1.CircuitBreaker({
            name: 'Deepgram',
            failureThreshold: POOL_CONFIG.cbFailureThreshold,
            resetTimeout: POOL_CONFIG.cbResetTimeoutMs,
            failureWindow: 60_000,
        });
        for (let i = 0; i < POOL_CONFIG.poolSize; i++) {
            this.slots.push({
                id: i,
                ws: null,
                state: SlotState.IDLE,
                streams: new Set(),
                reconnectAttempts: 0,
                keepAliveTimer: null,
            });
        }
        logger_1.logger.info('[DEEPGRAM_POOL] Initialized', {
            poolSize: POOL_CONFIG.poolSize,
            streamsPerConn: POOL_CONFIG.streamsPerConnection,
            maxStreams: POOL_CONFIG.maxConcurrentStreams,
        });
    }
    // ── Public: Acquire a Stream ────────────────────────────────
    /**
     * Open a new streaming transcription session.
     * Returns a `StreamHandle` that the caller uses to send audio and
     * receive transcript events.
     *
     * Throws if the circuit is open or no capacity is available.
     */
    async openStream(opts) {
        // ── Guard: capacity ──
        if (this.streams.size >= POOL_CONFIG.maxConcurrentStreams) {
            poolStreamErrors.inc({ type: 'connect' });
            throw new Error(`[DEEPGRAM_POOL] Max concurrent streams reached (${POOL_CONFIG.maxConcurrentStreams})`);
        }
        // ── Guard: circuit breaker ──
        const cbState = this.circuitBreaker.getState();
        this.syncCircuitMetric();
        if (cbState === circuit_breaker_1.CircuitState.OPEN) {
            poolStreamErrors.inc({ type: 'connect' });
            throw new Error('[DEEPGRAM_POOL] Circuit breaker OPEN — Deepgram unavailable');
        }
        // ── Find or create a connection slot ──
        const slot = await this.acquireSlot(opts);
        // ── Register stream ──
        const streamId = this.nextStreamId(opts.meetingId);
        const emitter = new events_1.EventEmitter();
        const stream = {
            streamId,
            meetingId: opts.meetingId,
            slotId: slot.id,
            emitter,
            totalAudioBytes: 0,
            lastSendTs: 0,
        };
        this.streams.set(streamId, stream);
        slot.streams.add(streamId);
        poolActiveStreams.set(this.streams.size);
        poolTotalStreamsCreated.inc();
        logger_1.logger.debug('[DEEPGRAM_POOL] Stream opened', {
            streamId,
            meetingId: opts.meetingId,
            slotId: slot.id,
            slotStreams: slot.streams.size,
            totalStreams: this.streams.size,
        });
        // ── Build handle ──
        const handle = this.buildHandle(stream, slot, opts);
        return handle;
    }
    // ── Public: Pool Status / Health ────────────────────────────
    getStatus() {
        const readySlots = this.slots.filter(s => s.state === SlotState.READY);
        return {
            activeConnections: readySlots.length,
            activeStreams: this.streams.size,
            circuitState: this.circuitBreaker.getState(),
            errorRate: this.computeErrorRate(),
            capacity: POOL_CONFIG.maxConcurrentStreams - this.streams.size,
            poolSlots: this.slots.map(s => ({
                id: s.id,
                state: SlotState[s.state],
                streams: s.streams.size,
            })),
        };
    }
    async healthCheck() {
        const state = this.circuitBreaker.getState();
        const errRate = this.computeErrorRate();
        return {
            healthy: state !== circuit_breaker_1.CircuitState.OPEN && errRate < 0.5,
            activeConnections: this.slots.filter(s => s.state === SlotState.READY).length,
            activeStreams: this.streams.size,
            circuitState: state,
            errorRate: errRate,
        };
    }
    // ── Public: Graceful Shutdown ───────────────────────────────
    async shutdown() {
        logger_1.logger.info('[DEEPGRAM_POOL] Shutting down…');
        // Close all active streams first
        const closePromises = [];
        for (const [, stream] of this.streams) {
            closePromises.push(this.releaseStream(stream.streamId));
        }
        await Promise.allSettled(closePromises);
        // Close all WebSocket connections
        for (const slot of this.slots) {
            this.closeSlot(slot);
        }
        poolActiveConnections.set(0);
        poolActiveStreams.set(0);
        logger_1.logger.info('[DEEPGRAM_POOL] Shutdown complete');
    }
    // ── Internals: Slot Management ──────────────────────────────
    /**
     * Find a READY slot with spare stream capacity, or lazily open a
     * new connection in an IDLE slot.
     */
    async acquireSlot(opts) {
        // Prefer existing READY slot with capacity
        const readySlot = this.slots.find(s => s.state === SlotState.READY && s.streams.size < POOL_CONFIG.streamsPerConnection);
        if (readySlot)
            return readySlot;
        // Find an IDLE slot and connect
        const idleSlot = this.slots.find(s => s.state === SlotState.IDLE);
        if (!idleSlot) {
            // All slots busy — try any slot that still has capacity
            const anyCapacity = this.slots.find(s => s.state === SlotState.READY && s.streams.size < POOL_CONFIG.streamsPerConnection);
            if (anyCapacity)
                return anyCapacity;
            throw new Error('[DEEPGRAM_POOL] No available connection slots');
        }
        await this.connectSlot(idleSlot, opts);
        return idleSlot;
    }
    /**
     * Open a WebSocket on a given slot, wrapped in the circuit breaker.
     */
    async connectSlot(slot, opts) {
        slot.state = SlotState.CONNECTING;
        await this.circuitBreaker.execute(async () => {
            await this.rawConnect(slot, opts);
        });
    }
    rawConnect(slot, opts) {
        return new Promise((resolve, reject) => {
            const apiKey = config_1.config.deepgram?.apiKey;
            if (!apiKey) {
                slot.state = SlotState.DEAD;
                reject(new Error('[DEEPGRAM_POOL] Deepgram API key not configured'));
                return;
            }
            const params = new URLSearchParams({
                model: opts.model || config_1.config.deepgram?.model || 'nova-2',
                language: opts.language || config_1.config.deepgram?.language || 'en-US',
                punctuate: String(opts.punctuate ?? true),
                diarize: String(opts.diarize ?? true),
                smart_format: String(opts.smartFormat ?? true),
                interim_results: 'true',
                utterance_end_ms: '1000',
                vad_events: 'true',
                encoding: 'linear16',
                sample_rate: '16000',
                channels: '1',
            });
            const url = `${DEEPGRAM_WS_URL}?${params.toString()}`;
            const ws = new ws_1.default(url, {
                headers: { Authorization: `Token ${apiKey}` },
            });
            const timeout = setTimeout(() => {
                ws.terminate();
                slot.state = SlotState.IDLE;
                poolConnectionErrors.inc();
                this.recordError();
                reject(new Error(`[DEEPGRAM_POOL] Slot ${slot.id} connection timeout`));
            }, POOL_CONFIG.connectTimeoutMs);
            ws.on('open', () => {
                clearTimeout(timeout);
                slot.ws = ws;
                slot.state = SlotState.READY;
                slot.reconnectAttempts = 0;
                this.startKeepAlive(slot);
                this.recordSuccess();
                poolActiveConnections.set(this.slots.filter(s => s.state === SlotState.READY).length);
                logger_1.logger.info('[DEEPGRAM_POOL] Slot connected', { slotId: slot.id });
                resolve();
            });
            ws.on('message', (raw) => {
                this.dispatchMessage(slot, raw);
            });
            ws.on('error', (err) => {
                clearTimeout(timeout);
                logger_1.logger.error('[DEEPGRAM_POOL] WS error', { slotId: slot.id, error: err.message });
                poolConnectionErrors.inc();
                this.recordError();
            });
            ws.on('close', (code, reason) => {
                clearTimeout(timeout);
                const wasReady = slot.state === SlotState.READY;
                this.stopKeepAlive(slot);
                slot.ws = null;
                if (slot.state === SlotState.CLOSING) {
                    slot.state = SlotState.IDLE;
                    return;
                }
                slot.state = SlotState.IDLE;
                poolActiveConnections.set(this.slots.filter(s => s.state === SlotState.READY).length);
                logger_1.logger.warn('[DEEPGRAM_POOL] Slot disconnected', {
                    slotId: slot.id,
                    code,
                    reason: reason.toString(),
                    hadStreams: slot.streams.size,
                });
                // Notify all streams on this connection
                if (wasReady && slot.streams.size > 0) {
                    this.handleSlotDisconnect(slot, code, reason.toString());
                }
            });
        });
    }
    /**
     * When a slot disconnects unexpectedly, attempt to reconnect and
     * re-attach active streams. Streams receive an error event so they
     * can buffer audio in the meantime.
     */
    handleSlotDisconnect(slot, code, reason) {
        // Notify every stream on this slot
        for (const streamId of slot.streams) {
            const stream = this.streams.get(streamId);
            if (stream) {
                stream.emitter.emit('error', new Error(`Connection lost (code=${code}, reason=${reason})`));
            }
        }
        // Auto-reconnect if still below threshold
        if (slot.reconnectAttempts < POOL_CONFIG.maxReconnectAttempts && code !== 1000) {
            this.reconnectSlot(slot);
        }
        else {
            // Mark dead — streams need to be migrated or closed
            slot.state = SlotState.DEAD;
            this.evictSlotStreams(slot);
        }
    }
    reconnectSlot(slot) {
        slot.reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, slot.reconnectAttempts - 1), 30_000);
        logger_1.logger.info('[DEEPGRAM_POOL] Reconnecting slot', {
            slotId: slot.id,
            attempt: slot.reconnectAttempts,
            delayMs: delay,
        });
        setTimeout(() => {
            // Build options from one of the attached streams (or defaults)
            const firstStreamId = [...slot.streams][0];
            const firstStream = firstStreamId ? this.streams.get(firstStreamId) : undefined;
            const opts = {
                meetingId: firstStream?.meetingId || 'reconnect',
            };
            this.connectSlot(slot, opts).catch((err) => {
                logger_1.logger.error('[DEEPGRAM_POOL] Reconnect failed', {
                    slotId: slot.id,
                    error: err.message,
                });
                if (slot.reconnectAttempts >= POOL_CONFIG.maxReconnectAttempts) {
                    slot.state = SlotState.DEAD;
                    this.evictSlotStreams(slot);
                }
            });
        }, delay);
    }
    evictSlotStreams(slot) {
        for (const streamId of slot.streams) {
            const stream = this.streams.get(streamId);
            if (stream) {
                stream.emitter.emit('error', new Error('Connection permanently lost'));
                stream.emitter.emit('closed');
                this.streams.delete(streamId);
            }
        }
        slot.streams.clear();
        poolActiveStreams.set(this.streams.size);
    }
    // ── Internals: Keep-Alive ─────────────────────────────────
    startKeepAlive(slot) {
        this.stopKeepAlive(slot);
        slot.keepAliveTimer = setInterval(() => {
            if (slot.state === SlotState.READY && slot.ws) {
                try {
                    slot.ws.send(JSON.stringify({ type: 'KeepAlive' }));
                }
                catch {
                    // handled by ws error event
                }
            }
        }, POOL_CONFIG.keepAliveIntervalMs);
    }
    stopKeepAlive(slot) {
        if (slot.keepAliveTimer) {
            clearInterval(slot.keepAliveTimer);
            slot.keepAliveTimer = null;
        }
    }
    // ── Internals: Message Dispatch ───────────────────────────
    /**
     * Deepgram sends one message stream per connection, so we
     * broadcast to all streams attached to the slot, filtering by
     * active meeting context on the client side.
     */
    dispatchMessage(slot, raw) {
        let message;
        try {
            message = JSON.parse(raw.toString());
        }
        catch {
            poolStreamErrors.inc({ type: 'parse' });
            return;
        }
        for (const streamId of slot.streams) {
            const stream = this.streams.get(streamId);
            if (!stream)
                continue;
            if (message.type === 'Results') {
                const result = this.parseTranscriptResult(message);
                if (result) {
                    // Latency: time since last audio send
                    if (stream.lastSendTs > 0) {
                        const latency = Date.now() - stream.lastSendTs;
                        transcriptionLatency.observe(latency);
                    }
                    stream.emitter.emit('transcript', result);
                    this.recordSuccess();
                }
            }
            else if (message.type === 'UtteranceEnd') {
                stream.emitter.emit('utteranceEnd');
            }
            else if (message.type === 'SpeechStarted') {
                stream.emitter.emit('speechStarted');
            }
        }
    }
    parseTranscriptResult(message) {
        const alt = message.channel?.alternatives;
        if (!alt || alt.length === 0)
            return null;
        const best = alt[0];
        const transcript = best.transcript?.trim();
        if (!transcript)
            return null;
        return {
            transcript,
            speaker: this.extractSpeaker(best),
            timestamp: Date.now(),
            duration: message.duration || 0,
            isFinal: message.is_final === true,
            confidence: best.confidence || 0,
            words: best.words,
        };
    }
    extractSpeaker(alt) {
        if (alt.words && alt.words.length > 0) {
            const counts = new Map();
            for (const w of alt.words) {
                if (w.speaker !== undefined) {
                    counts.set(w.speaker, (counts.get(w.speaker) || 0) + 1);
                }
            }
            if (counts.size > 0) {
                let best = 0, max = 0;
                for (const [s, c] of counts) {
                    if (c > max) {
                        best = s;
                        max = c;
                    }
                }
                return `Speaker ${best + 1}`;
            }
        }
        return 'Unknown';
    }
    // ── Internals: Stream Handle Builder ──────────────────────
    buildHandle(stream, slot, _opts) {
        const self = this;
        const handle = Object.assign(stream.emitter, {
            streamId: stream.streamId,
            sendAudio(data) {
                if (slot.state !== SlotState.READY || !slot.ws) {
                    poolStreamErrors.inc({ type: 'send' });
                    return;
                }
                try {
                    slot.ws.send(data);
                    stream.totalAudioBytes += data.length;
                    stream.lastSendTs = Date.now();
                }
                catch (err) {
                    poolStreamErrors.inc({ type: 'send' });
                    logger_1.logger.error('[DEEPGRAM_POOL] Audio send error', {
                        streamId: stream.streamId,
                        error: err.message,
                    });
                }
            },
            async close() {
                await self.releaseStream(stream.streamId);
            },
        });
        return handle;
    }
    // ── Internals: Release a Stream ───────────────────────────
    async releaseStream(streamId) {
        const stream = this.streams.get(streamId);
        if (!stream)
            return;
        const slot = this.slots[stream.slotId];
        // Log audio usage for cost tracking
        if (stream.totalAudioBytes > 0) {
            const durationSec = stream.totalAudioBytes / BYTES_PER_SECOND;
            logger_1.logger.debug('[DEEPGRAM_POOL] Stream audio usage', {
                streamId,
                meetingId: stream.meetingId,
                durationSeconds: durationSec.toFixed(2),
            });
        }
        this.streams.delete(streamId);
        if (slot) {
            slot.streams.delete(streamId);
            // If a connection has no more streams, optionally close it
            // to free resources. We keep it warm for reuse for a short period.
        }
        stream.emitter.emit('closed');
        stream.emitter.removeAllListeners();
        poolActiveStreams.set(this.streams.size);
        logger_1.logger.debug('[DEEPGRAM_POOL] Stream released', {
            streamId,
            meetingId: stream.meetingId,
            remaining: this.streams.size,
        });
    }
    // ── Internals: Close a Slot ───────────────────────────────
    closeSlot(slot) {
        this.stopKeepAlive(slot);
        if (slot.ws) {
            try {
                slot.state = SlotState.CLOSING;
                slot.ws.send(JSON.stringify({ type: 'CloseStream' }));
                slot.ws.close(1000, 'Pool shutdown');
            }
            catch {
                slot.ws.terminate();
            }
            slot.ws = null;
        }
        slot.state = SlotState.IDLE;
        slot.streams.clear();
    }
    // ── Internals: Error-Rate Tracking ────────────────────────
    recordError() {
        this.errorTimestamps.push(Date.now());
        this.pruneRateWindow();
        poolErrorRate.set(this.computeErrorRate());
    }
    recordSuccess() {
        this.successTimestamps.push(Date.now());
        this.pruneRateWindow();
        poolErrorRate.set(this.computeErrorRate());
    }
    pruneRateWindow() {
        const cutoff = Date.now() - this.errorWindowMs;
        this.errorTimestamps = this.errorTimestamps.filter(t => t > cutoff);
        this.successTimestamps = this.successTimestamps.filter(t => t > cutoff);
    }
    computeErrorRate() {
        this.pruneRateWindow();
        const total = this.errorTimestamps.length + this.successTimestamps.length;
        if (total === 0)
            return 0;
        return this.errorTimestamps.length / total;
    }
    // ── Internals: Circuit Metric Sync ────────────────────────
    syncCircuitMetric() {
        const s = this.circuitBreaker.getState();
        const val = s === circuit_breaker_1.CircuitState.CLOSED ? 0 : s === circuit_breaker_1.CircuitState.HALF_OPEN ? 1 : 2;
        poolCircuitState.set(val);
    }
    // ── Internals: ID Generator ───────────────────────────────
    nextStreamId(meetingId) {
        this.streamCounter++;
        return `dg-${meetingId}-${this.streamCounter}`;
    }
}
// ── Singleton ───────────────────────────────────────────────
exports.deepgramPool = new DeepgramConnectionPool();
// ── Convenience Exports ─────────────────────────────────────
async function openDeepgramStream(opts) {
    return exports.deepgramPool.openStream(opts);
}
async function deepgramHealthCheck() {
    return exports.deepgramPool.healthCheck();
}
function getDeepgramPoolStatus() {
    return exports.deepgramPool.getStatus();
}
async function shutdownDeepgramPool() {
    return exports.deepgramPool.shutdown();
}
//# sourceMappingURL=deepgramClient.js.map