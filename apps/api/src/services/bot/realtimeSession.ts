// ============================================================
// OrgsLedger — Realtime Session (per-speaker)
// Connects to OpenAI Realtime API via WebSocket, streams
// buffered PCM16 audio, and persists final transcripts to DB.
// After each DB insert it triggers translateAndBroadcast so
// other meeting participants receive the translated text.
// ============================================================

import WebSocket from 'ws';
import { logger } from '../../logger';
import db from '../../db';
import { config } from '../../config';
import { AudioProcessor } from './audioProcessor';

// ── Types ─────────────────────────────────────────────────

export interface RealtimeSessionOptions {
  meetingId: string;
  organizationId: string;
  speakerId: string;
  speakerName: string;
  /** Source language BCP-47 code for transcript metadata */
  sourceLang?: string;
  /** Callback after a transcript row is saved */
  onTranscript?: (transcript: TranscriptRow) => void | Promise<void>;
}

export interface TranscriptRow {
  meetingId: string;
  organizationId: string;
  speakerId: string;
  speakerName: string;
  text: string;
  sourceLang: string;
  timestamp: number;
}

// ── Constants ────────────────────────────────────────────────

const OPENAI_REALTIME_URL = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17';
const SILENCE_TIMEOUT_MS = 10 * 60 * 1000;        // 10 minutes — close if no transcript
const MAX_SESSION_DURATION_MS = 2 * 60 * 60 * 1000; // 2 hours hard cap
const MAX_RECONNECT_ATTEMPTS = 1;                   // One reconnect attempt max

// ── Realtime Session ─────────────────────────────────────────

export class RealtimeSession {
  private ws: WebSocket | null = null;
  private audioProcessor: AudioProcessor;
  private closed = false;
  private reconnectAttempts = 0;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private maxDurationTimer: ReturnType<typeof setTimeout> | null = null;
  private lastTranscriptAt: number = Date.now();

  // ── LAYER 3.3 / 4.1 / 8 — Counters for debugging & cost control
  private audioChunksSent = 0;
  private transcriptsReceived = 0;
  private transcriptsPersisted = 0;
  private sessionOpenedAt: number = 0;
  private readonly AUDIO_LOG_INTERVAL = 200; // Log every N chunks

  private readonly meetingId: string;
  private readonly organizationId: string;
  private readonly speakerId: string;
  private readonly speakerName: string;
  private readonly sourceLang: string;
  private readonly onTranscript?: (t: TranscriptRow) => void | Promise<void>;

  constructor(opts: RealtimeSessionOptions) {
    this.meetingId = opts.meetingId;
    this.organizationId = opts.organizationId;
    this.speakerId = opts.speakerId;
    this.speakerName = opts.speakerName;
    this.sourceLang = opts.sourceLang || 'en';
    this.onTranscript = opts.onTranscript;

    // AudioProcessor flushes 50ms PCM16 batches → send to OpenAI
    this.audioProcessor = new AudioProcessor((pcm16Base64) => {
      this.sendAudio(pcm16Base64);
    });

    logger.info(`[RealtimeSession] Created for speaker=${this.speakerName} (${this.speakerId}) meeting=${this.meetingId}`);
  }

  // ── Public API ──────────────────────────────────────────

  /** Open WebSocket to OpenAI Realtime and configure the session. */
  async connect(): Promise<void> {
    if (this.closed) return;

    const apiKey = config.ai.openaiApiKey;
    if (!apiKey) {
      logger.error('[RealtimeSession] OPENAI_API_KEY not configured — cannot start transcription');
      return;
    }

    return new Promise<void>((resolve, reject) => {
      this.ws = new WebSocket(OPENAI_REALTIME_URL, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'OpenAI-Beta': 'realtime=v1',
        },
      });

      this.ws.on('open', () => {
        // ── LAYER 3.1 — WebSocket successfully opens ────
        this.sessionOpenedAt = Date.now();
        logger.info(`[Realtime] Session opened for speaker ${this.speakerId} (name=${this.speakerName}, meeting=${this.meetingId})`);
        this.configureSession();
        this.startTimers();
        resolve();
      });

      this.ws.on('message', (data) => {
        this.handleMessage(data);
      });

      this.ws.on('error', (err) => {
        logger.error(`[Realtime] WebSocket ERROR for speaker ${this.speakerId}: meeting=${this.meetingId}, error=${(err as any)?.message || err}`);
        this.handleDisconnect();
      });

      this.ws.on('close', (code, reason) => {
        logger.warn(`[Realtime] WebSocket CLOSED for speaker ${this.speakerId}: meeting=${this.meetingId}, code=${code}, reason=${reason?.toString() || 'none'}`);
        this.handleDisconnect();
      });

      // Reject after 10s if connection hangs
      setTimeout(() => {
        if (this.ws?.readyState !== WebSocket.OPEN) {
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
  pushAudio(audio: Float32Array | Buffer): void {
    if (this.closed) return;

    if (audio instanceof Float32Array) {
      this.audioProcessor.pushFloat32(audio);
    } else {
      this.audioProcessor.pushPcm16(audio);
    }
  }

  /** Gracefully close the session and free all resources. */
  close(): void {
    if (this.closed) return;
    this.closed = true;

    // ── LAYER 7.1 + 8 — Session lifecycle summary ─────
    const sessionDurationSec = this.sessionOpenedAt ? ((Date.now() - this.sessionOpenedAt) / 1000).toFixed(1) : '0';
    logger.info(`[Realtime] Closing session for ${this.speakerId}: meeting=${this.meetingId}, audioChunksSent=${this.audioChunksSent}, transcriptsReceived=${this.transcriptsReceived}, transcriptsPersisted=${this.transcriptsPersisted}, sessionDuration=${sessionDurationSec}s`);

    // Flush remaining audio
    this.audioProcessor.close();

    // Clear timers
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    if (this.maxDurationTimer) clearTimeout(this.maxDurationTimer);

    // Close WebSocket
    if (this.ws) {
      try {
        if (this.ws.readyState === WebSocket.OPEN) {
          // Commit any buffered audio before closing
          this.sendEvent({
            type: 'input_audio_buffer.commit',
          });
        }
        this.ws.close(1000, 'session_end');
      } catch (e) {
        // Ignore close errors
      }
      this.ws = null;
    }
  }

  get isClosed(): boolean {
    return this.closed;
  }

  // ── Session Configuration ───────────────────────────────

  /**
   * Send session.update to configure OpenAI Realtime for
   * transcription-only mode with server-side VAD.
   */
  private configureSession(): void {
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
    logger.info(`[Realtime] Session configured for speaker ${this.speakerId}: format=pcm16, sampleRate=24kHz, vad=server_vad(threshold=0.5, silence=500ms), model=whisper-1`);
  }

  // ── Audio Sending ───────────────────────────────────────

  /** Send a base64-encoded PCM16 audio chunk to OpenAI. */
  private sendAudio(pcm16Base64: string): void {
    if (this.closed || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    this.sendEvent({
      type: 'input_audio_buffer.append',
      audio: pcm16Base64,
    });

    // ── LAYER 3.3 — Audio chunk send counter ──────────
    this.audioChunksSent++;
    if (this.audioChunksSent === 1) {
      logger.info(`[Realtime] First audio chunk sent for speaker ${this.speakerId} (bytes=${Buffer.from(pcm16Base64, 'base64').length})`);
    }
    if (this.audioChunksSent % this.AUDIO_LOG_INTERVAL === 0) {
      logger.info(`[Realtime] Sent ${this.audioChunksSent} audio chunks for speaker ${this.speakerId}`);
    }
  }

  // ── Message Handling ────────────────────────────────────

  /** Parse incoming OpenAI Realtime events. */
  private handleMessage(raw: WebSocket.Data): void {
    try {
      const event = JSON.parse(raw.toString());

      switch (event.type) {
        case 'session.created':
          logger.info(`[Realtime] Session created by OpenAI: speaker=${this.speakerId}, sessionId=${event.session?.id || 'unknown'}`);
          break;

        case 'session.updated':
          logger.info(`[Realtime] Session updated by OpenAI: speaker=${this.speakerId}`);
          break;

        case 'conversation.item.input_audio_transcription.completed':
          // ── LAYER 4.1 — Final transcript received ────────
          this.transcriptsReceived++;
          if (event.transcript?.trim()) {
            const text = event.transcript.trim();
            // ── LAYER 4.2 — Filter short/noise transcripts ─
            if (text.length < 3) {
              logger.debug(`[Realtime] Filtered short transcript (<3 chars) for ${this.speakerId}: "${text}"`);
              break;
            }
            logger.info(`[Realtime] Final transcript received for ${this.speakerId}: "${text.slice(0, 80)}${text.length > 80 ? '...' : ''}" (len=${text.length}, totalReceived=${this.transcriptsReceived})`);
            this.handleTranscript(text);
          } else {
            logger.debug(`[STT_PIPELINE] Empty transcript from Whisper: speaker=${this.speakerName}, meeting=${this.meetingId} (totalReceived=${this.transcriptsReceived})`);
          }
          break;

        case 'response.done':
          // Response cycle completed — confirms a VAD turn was processed
          logger.debug(`[Realtime] Response done (VAD turn processed): speaker=${this.speakerId}`);
          break;

        case 'input_audio_buffer.speech_started':
          logger.debug(`[Realtime] VAD speech started: speaker=${this.speakerId}`);
          break;

        case 'input_audio_buffer.speech_stopped':
          logger.debug(`[Realtime] VAD speech stopped: speaker=${this.speakerId}`);
          break;

        case 'input_audio_buffer.committed':
          logger.debug(`[Realtime] Audio buffer committed: speaker=${this.speakerId}`);
          break;

        case 'response.created':
        case 'response.output_item.added':
        case 'response.content_part.added':
        case 'conversation.item.created':
          // Normal response lifecycle events — logged at debug
          logger.debug(`[Realtime] Event: ${event.type} for speaker=${this.speakerId}`);
          break;

        case 'error':
          logger.error(`[Realtime] OpenAI error for ${this.speakerId}: code=${event.error?.code}, message=${event.error?.message}`);
          break;

        // Catch-all for unexpected event types
        default:
          logger.debug(`[Realtime] Unhandled event: ${event.type} for speaker=${this.speakerId}`);
          break;
      }
    } catch (err) {
      logger.warn(`[RealtimeSession] Failed to parse message: speaker=${this.speakerName}`, err);
    }
  }

  // ── Transcript Persistence ──────────────────────────────

  /**
   * Save a final transcript segment to DB and trigger the
   * translation/broadcast callback.
   */
  private async handleTranscript(text: string): Promise<void> {
    const now = Date.now();
    this.lastTranscriptAt = now;
    this.resetSilenceTimer();

    logger.info(`[STT_PIPELINE] Transcript persisting: speaker=${this.speakerName}, meeting=${this.meetingId}, text="${text.slice(0, 80)}..."`);

    // ── LAYER 5.1 — Persist to meeting_transcripts table ─
    try {
      const inserted = await db('meeting_transcripts').insert({
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
      logger.info(`[DB] Transcript saved: id=${inserted?.[0] || 'unknown'}, meeting=${this.meetingId}, speaker=${this.speakerName}, totalPersisted=${this.transcriptsPersisted}`);
    } catch (dbErr) {
      logger.error(`[DB] Transcript insert FAILED: speaker=${this.speakerName}, meeting=${this.meetingId}, error=${(dbErr as any)?.message}`);
    }

    // Trigger translation + broadcast callback
    const row: TranscriptRow = {
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
      } catch (cbErr) {
        logger.error(`[RealtimeSession] onTranscript callback failed`, cbErr);
      }
    }
  }

  // ── Reconnection ────────────────────────────────────────

  private handleDisconnect(): void {
    if (this.closed) return;

    if (this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      this.reconnectAttempts++;
      logger.info(`[RealtimeSession] Reconnecting (attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}): speaker=${this.speakerName}`);

      // Wait 2 seconds before reconnecting
      setTimeout(() => {
        if (!this.closed) {
          this.connect().catch((err) => {
            logger.error(`[RealtimeSession] Reconnect failed: speaker=${this.speakerName}`, err);
            this.close();
          });
        }
      }, 2000);
    } else {
      logger.warn(`[RealtimeSession] Max reconnect attempts reached, closing: speaker=${this.speakerName}`);
      this.close();
    }
  }

  // ── Safety Timers ───────────────────────────────────────

  private startTimers(): void {
    // Silence timer: close session if no transcript for 10 minutes
    this.resetSilenceTimer();

    // Hard limit: close session after 2 hours regardless
    this.maxDurationTimer = setTimeout(() => {
      logger.warn(`[RealtimeSession] Max session duration reached (2h), closing: speaker=${this.speakerName}`);
      this.close();
    }, MAX_SESSION_DURATION_MS);
  }

  private resetSilenceTimer(): void {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = setTimeout(() => {
      logger.warn(`[RealtimeSession] No transcript for 10 minutes, closing: speaker=${this.speakerName}`);
      this.close();
    }, SILENCE_TIMEOUT_MS);
  }

  // ── Helpers ─────────────────────────────────────────────

  private sendEvent(event: Record<string, any>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(event));
    }
  }
}
