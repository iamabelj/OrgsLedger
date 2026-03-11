// ============================================================
// OrgsLedger API — Deepgram Streaming Connection Pool
//
// Production-grade WebSocket pool for Deepgram real-time
// transcription. Manages up to 1 000 concurrent streams per
// worker through a configurable pool of persistent connections,
// with circuit-breaker protection, auto-reconnect, and
// Prometheus observability.
// ============================================================

import WebSocket from 'ws';
import { EventEmitter } from 'events';
import * as client from 'prom-client';
import { config } from '../config';
import { logger } from '../logger';
import { CircuitBreaker, CircuitState } from '../services/circuit-breaker';

// ── Configuration ───────────────────────────────────────────

function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  if (!v) return fallback;
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

// ── Types ───────────────────────────────────────────────────

export interface DeepgramStreamOptions {
  meetingId: string;
  language?: string;
  model?: string;
  punctuate?: boolean;
  diarize?: boolean;
  smartFormat?: boolean;
}

export interface StreamHandle {
  /** Unique identifier for this stream */
  readonly streamId: string;
  /** Send raw audio bytes to Deepgram */
  sendAudio(data: Buffer): void;
  /** Gracefully close the stream */
  close(): Promise<void>;
  /** Subscribe to transcript events */
  on(event: 'transcript', fn: (result: TranscriptResult) => void): this;
  on(event: 'utteranceEnd', fn: () => void): this;
  on(event: 'speechStarted', fn: () => void): this;
  on(event: 'error', fn: (err: Error) => void): this;
  on(event: 'closed', fn: () => void): this;
  on(event: string, fn: (...args: any[]) => void): this;
}

export interface TranscriptResult {
  transcript: string;
  speaker: number | string;
  timestamp: number;
  duration: number;
  isFinal: boolean;
  confidence: number;
  words?: Array<{
    word: string;
    start: number;
    end: number;
    confidence: number;
    speaker?: number;
  }>;
}

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
  labelNames: ['type'] as const, // 'connect' | 'send' | 'parse'
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

enum SlotState {
  IDLE = 0,
  CONNECTING = 1,
  READY = 2,
  CLOSING = 3,
  DEAD = 4,
}

interface ConnectionSlot {
  id: number;
  ws: WebSocket | null;
  state: SlotState;
  /** Set of streamIds currently routed through this connection */
  streams: Set<string>;
  reconnectAttempts: number;
  keepAliveTimer: NodeJS.Timeout | null;
}

// ── Internal: Active Stream State ───────────────────────────

interface ActiveStream {
  streamId: string;
  meetingId: string;
  slotId: number;
  emitter: EventEmitter;
  totalAudioBytes: number;
  /** ts of the last audio chunk sent, for latency tracking */
  lastSendTs: number;
}

// ── Connection Pool ─────────────────────────────────────────

class DeepgramConnectionPool extends EventEmitter {
  private slots: ConnectionSlot[] = [];
  private streams: Map<string, ActiveStream> = new Map();
  private circuitBreaker: CircuitBreaker;
  private streamCounter = 0;
  private initialized = false;

  // Error-rate tracking: rolling window (60 s)
  private errorTimestamps: number[] = [];
  private successTimestamps: number[] = [];
  private readonly errorWindowMs = 60_000;

  constructor() {
    super();
    this.circuitBreaker = new CircuitBreaker({
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

    logger.info('[DEEPGRAM_POOL] Initialized', {
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
  async openStream(opts: DeepgramStreamOptions): Promise<StreamHandle> {
    // ── Guard: capacity ──
    if (this.streams.size >= POOL_CONFIG.maxConcurrentStreams) {
      poolStreamErrors.inc({ type: 'connect' });
      throw new Error(
        `[DEEPGRAM_POOL] Max concurrent streams reached (${POOL_CONFIG.maxConcurrentStreams})`
      );
    }

    // ── Guard: circuit breaker ──
    const cbState = this.circuitBreaker.getState();
    this.syncCircuitMetric();
    if (cbState === CircuitState.OPEN) {
      poolStreamErrors.inc({ type: 'connect' });
      throw new Error('[DEEPGRAM_POOL] Circuit breaker OPEN — Deepgram unavailable');
    }

    // ── Find or create a connection slot ──
    const slot = await this.acquireSlot(opts);

    // ── Register stream ──
    const streamId = this.nextStreamId(opts.meetingId);
    const emitter = new EventEmitter();

    const stream: ActiveStream = {
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

    logger.debug('[DEEPGRAM_POOL] Stream opened', {
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

  getStatus(): {
    activeConnections: number;
    activeStreams: number;
    circuitState: CircuitState;
    errorRate: number;
    capacity: number;
    poolSlots: Array<{ id: number; state: string; streams: number }>;
  } {
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

  async healthCheck(): Promise<{
    healthy: boolean;
    activeConnections: number;
    activeStreams: number;
    circuitState: string;
    errorRate: number;
  }> {
    const state = this.circuitBreaker.getState();
    const errRate = this.computeErrorRate();
    return {
      healthy: state !== CircuitState.OPEN && errRate < 0.5,
      activeConnections: this.slots.filter(s => s.state === SlotState.READY).length,
      activeStreams: this.streams.size,
      circuitState: state,
      errorRate: errRate,
    };
  }

  // ── Public: Graceful Shutdown ───────────────────────────────

  async shutdown(): Promise<void> {
    logger.info('[DEEPGRAM_POOL] Shutting down…');

    // Close all active streams first
    const closePromises: Promise<void>[] = [];
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
    logger.info('[DEEPGRAM_POOL] Shutdown complete');
  }

  // ── Internals: Slot Management ──────────────────────────────

  /**
   * Find a READY slot with spare stream capacity, or lazily open a
   * new connection in an IDLE slot.
   */
  private async acquireSlot(opts: DeepgramStreamOptions): Promise<ConnectionSlot> {
    // Prefer existing READY slot with capacity
    const readySlot = this.slots.find(
      s => s.state === SlotState.READY && s.streams.size < POOL_CONFIG.streamsPerConnection
    );
    if (readySlot) return readySlot;

    // Find an IDLE slot and connect
    const idleSlot = this.slots.find(s => s.state === SlotState.IDLE);
    if (!idleSlot) {
      // All slots busy — try any slot that still has capacity
      const anyCapacity = this.slots.find(
        s => s.state === SlotState.READY && s.streams.size < POOL_CONFIG.streamsPerConnection
      );
      if (anyCapacity) return anyCapacity;
      throw new Error('[DEEPGRAM_POOL] No available connection slots');
    }

    await this.connectSlot(idleSlot, opts);
    return idleSlot;
  }

  /**
   * Open a WebSocket on a given slot, wrapped in the circuit breaker.
   */
  private async connectSlot(slot: ConnectionSlot, opts: DeepgramStreamOptions): Promise<void> {
    slot.state = SlotState.CONNECTING;

    await this.circuitBreaker.execute(async () => {
      await this.rawConnect(slot, opts);
    });
  }

  private rawConnect(slot: ConnectionSlot, opts: DeepgramStreamOptions): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const apiKey = config.deepgram?.apiKey;
      if (!apiKey) {
        slot.state = SlotState.DEAD;
        reject(new Error('[DEEPGRAM_POOL] Deepgram API key not configured'));
        return;
      }

      const params = new URLSearchParams({
        model: opts.model || config.deepgram?.model || 'nova-2',
        language: opts.language || config.deepgram?.language || 'en-US',
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

      const ws = new WebSocket(url, {
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
        poolActiveConnections.set(
          this.slots.filter(s => s.state === SlotState.READY).length
        );

        logger.info('[DEEPGRAM_POOL] Slot connected', { slotId: slot.id });
        resolve();
      });

      ws.on('message', (raw: WebSocket.Data) => {
        this.dispatchMessage(slot, raw);
      });

      ws.on('error', (err: Error) => {
        clearTimeout(timeout);
        logger.error('[DEEPGRAM_POOL] WS error', { slotId: slot.id, error: err.message });
        poolConnectionErrors.inc();
        this.recordError();
      });

      ws.on('close', (code: number, reason: Buffer) => {
        clearTimeout(timeout);
        const wasReady = slot.state === SlotState.READY;
        this.stopKeepAlive(slot);
        slot.ws = null;

        if (slot.state === SlotState.CLOSING) {
          slot.state = SlotState.IDLE;
          return;
        }

        slot.state = SlotState.IDLE;
        poolActiveConnections.set(
          this.slots.filter(s => s.state === SlotState.READY).length
        );

        logger.warn('[DEEPGRAM_POOL] Slot disconnected', {
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
  private handleSlotDisconnect(slot: ConnectionSlot, code: number, reason: string): void {
    // Notify every stream on this slot
    for (const streamId of slot.streams) {
      const stream = this.streams.get(streamId);
      if (stream) {
        stream.emitter.emit('error', new Error(
          `Connection lost (code=${code}, reason=${reason})`
        ));
      }
    }

    // Auto-reconnect if still below threshold
    if (slot.reconnectAttempts < POOL_CONFIG.maxReconnectAttempts && code !== 1000) {
      this.reconnectSlot(slot);
    } else {
      // Mark dead — streams need to be migrated or closed
      slot.state = SlotState.DEAD;
      this.evictSlotStreams(slot);
    }
  }

  private reconnectSlot(slot: ConnectionSlot): void {
    slot.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, slot.reconnectAttempts - 1), 30_000);

    logger.info('[DEEPGRAM_POOL] Reconnecting slot', {
      slotId: slot.id,
      attempt: slot.reconnectAttempts,
      delayMs: delay,
    });

    setTimeout(() => {
      // Build options from one of the attached streams (or defaults)
      const firstStreamId = [...slot.streams][0];
      const firstStream = firstStreamId ? this.streams.get(firstStreamId) : undefined;
      const opts: DeepgramStreamOptions = {
        meetingId: firstStream?.meetingId || 'reconnect',
      };

      this.connectSlot(slot, opts).catch((err) => {
        logger.error('[DEEPGRAM_POOL] Reconnect failed', {
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

  private evictSlotStreams(slot: ConnectionSlot): void {
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

  private startKeepAlive(slot: ConnectionSlot): void {
    this.stopKeepAlive(slot);
    slot.keepAliveTimer = setInterval(() => {
      if (slot.state === SlotState.READY && slot.ws) {
        try {
          slot.ws.send(JSON.stringify({ type: 'KeepAlive' }));
        } catch {
          // handled by ws error event
        }
      }
    }, POOL_CONFIG.keepAliveIntervalMs);
  }

  private stopKeepAlive(slot: ConnectionSlot): void {
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
  private dispatchMessage(slot: ConnectionSlot, raw: WebSocket.Data): void {
    let message: any;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      poolStreamErrors.inc({ type: 'parse' });
      return;
    }

    for (const streamId of slot.streams) {
      const stream = this.streams.get(streamId);
      if (!stream) continue;

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
      } else if (message.type === 'UtteranceEnd') {
        stream.emitter.emit('utteranceEnd');
      } else if (message.type === 'SpeechStarted') {
        stream.emitter.emit('speechStarted');
      }
    }
  }

  private parseTranscriptResult(message: any): TranscriptResult | null {
    const alt = message.channel?.alternatives;
    if (!alt || alt.length === 0) return null;
    const best = alt[0];
    const transcript = best.transcript?.trim();
    if (!transcript) return null;

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

  private extractSpeaker(alt: any): string {
    if (alt.words && alt.words.length > 0) {
      const counts = new Map<number, number>();
      for (const w of alt.words) {
        if (w.speaker !== undefined) {
          counts.set(w.speaker, (counts.get(w.speaker) || 0) + 1);
        }
      }
      if (counts.size > 0) {
        let best = 0, max = 0;
        for (const [s, c] of counts) {
          if (c > max) { best = s; max = c; }
        }
        return `Speaker ${best + 1}`;
      }
    }
    return 'Unknown';
  }

  // ── Internals: Stream Handle Builder ──────────────────────

  private buildHandle(
    stream: ActiveStream,
    slot: ConnectionSlot,
    _opts: DeepgramStreamOptions
  ): StreamHandle {
    const self = this;

    const handle: StreamHandle = Object.assign(stream.emitter, {
      streamId: stream.streamId,

      sendAudio(data: Buffer): void {
        if (slot.state !== SlotState.READY || !slot.ws) {
          poolStreamErrors.inc({ type: 'send' });
          return;
        }
        try {
          slot.ws.send(data);
          stream.totalAudioBytes += data.length;
          stream.lastSendTs = Date.now();
        } catch (err: any) {
          poolStreamErrors.inc({ type: 'send' });
          logger.error('[DEEPGRAM_POOL] Audio send error', {
            streamId: stream.streamId,
            error: err.message,
          });
        }
      },

      async close(): Promise<void> {
        await self.releaseStream(stream.streamId);
      },
    }) as unknown as StreamHandle;

    return handle;
  }

  // ── Internals: Release a Stream ───────────────────────────

  private async releaseStream(streamId: string): Promise<void> {
    const stream = this.streams.get(streamId);
    if (!stream) return;

    const slot = this.slots[stream.slotId];

    // Log audio usage for cost tracking
    if (stream.totalAudioBytes > 0) {
      const durationSec = stream.totalAudioBytes / BYTES_PER_SECOND;
      logger.debug('[DEEPGRAM_POOL] Stream audio usage', {
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

    logger.debug('[DEEPGRAM_POOL] Stream released', {
      streamId,
      meetingId: stream.meetingId,
      remaining: this.streams.size,
    });
  }

  // ── Internals: Close a Slot ───────────────────────────────

  private closeSlot(slot: ConnectionSlot): void {
    this.stopKeepAlive(slot);
    if (slot.ws) {
      try {
        slot.state = SlotState.CLOSING;
        slot.ws.send(JSON.stringify({ type: 'CloseStream' }));
        slot.ws.close(1000, 'Pool shutdown');
      } catch {
        slot.ws.terminate();
      }
      slot.ws = null;
    }
    slot.state = SlotState.IDLE;
    slot.streams.clear();
  }

  // ── Internals: Error-Rate Tracking ────────────────────────

  private recordError(): void {
    this.errorTimestamps.push(Date.now());
    this.pruneRateWindow();
    poolErrorRate.set(this.computeErrorRate());
  }

  private recordSuccess(): void {
    this.successTimestamps.push(Date.now());
    this.pruneRateWindow();
    poolErrorRate.set(this.computeErrorRate());
  }

  private pruneRateWindow(): void {
    const cutoff = Date.now() - this.errorWindowMs;
    this.errorTimestamps = this.errorTimestamps.filter(t => t > cutoff);
    this.successTimestamps = this.successTimestamps.filter(t => t > cutoff);
  }

  private computeErrorRate(): number {
    this.pruneRateWindow();
    const total = this.errorTimestamps.length + this.successTimestamps.length;
    if (total === 0) return 0;
    return this.errorTimestamps.length / total;
  }

  // ── Internals: Circuit Metric Sync ────────────────────────

  private syncCircuitMetric(): void {
    const s = this.circuitBreaker.getState();
    const val = s === CircuitState.CLOSED ? 0 : s === CircuitState.HALF_OPEN ? 1 : 2;
    poolCircuitState.set(val);
  }

  // ── Internals: ID Generator ───────────────────────────────

  private nextStreamId(meetingId: string): string {
    this.streamCounter++;
    return `dg-${meetingId}-${this.streamCounter}`;
  }
}

// ── Singleton ───────────────────────────────────────────────

export const deepgramPool = new DeepgramConnectionPool();

// ── Convenience Exports ─────────────────────────────────────

export async function openDeepgramStream(
  opts: DeepgramStreamOptions
): Promise<StreamHandle> {
  return deepgramPool.openStream(opts);
}

export async function deepgramHealthCheck() {
  return deepgramPool.healthCheck();
}

export function getDeepgramPoolStatus() {
  return deepgramPool.getStatus();
}

export async function shutdownDeepgramPool(): Promise<void> {
  return deepgramPool.shutdown();
}
