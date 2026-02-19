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
        logger.info(`[STT_PIPELINE] WebSocket CONNECTED: speaker=${this.speakerName}, meeting=${this.meetingId}`);
        this.configureSession();
        this.startTimers();
        resolve();
      });

      this.ws.on('message', (data) => {
        this.handleMessage(data);
      });

      this.ws.on('error', (err) => {
        logger.error(`[STT_PIPELINE] WebSocket ERROR: speaker=${this.speakerName}, meeting=${this.meetingId}`, err);
        this.handleDisconnect();
      });

      this.ws.on('close', (code, reason) => {
        logger.warn(`[STT_PIPELINE] WebSocket CLOSED: speaker=${this.speakerName}, meeting=${this.meetingId}, code=${code}, reason=${reason?.toString()}`);
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

    logger.info(`[RealtimeSession] Closing: speaker=${this.speakerName}, meeting=${this.meetingId}`);

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

    logger.debug(`[RealtimeSession] Session configured: speaker=${this.speakerName}`);
  }

  // ── Audio Sending ───────────────────────────────────────

  /** Send a base64-encoded PCM16 audio chunk to OpenAI. */
  private sendAudio(pcm16Base64: string): void {
    if (this.closed || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    this.sendEvent({
      type: 'input_audio_buffer.append',
      audio: pcm16Base64,
    });
  }

  // ── Message Handling ────────────────────────────────────

  /** Parse incoming OpenAI Realtime events. */
  private handleMessage(raw: WebSocket.Data): void {
    try {
      const event = JSON.parse(raw.toString());

      switch (event.type) {
        case 'session.created':
          logger.debug(`[RealtimeSession] Session created by OpenAI: speaker=${this.speakerName}`);
          break;

        case 'session.updated':
          logger.debug(`[RealtimeSession] Session updated: speaker=${this.speakerName}`);
          break;

        case 'conversation.item.input_audio_transcription.completed':
          // This is the primary transcript event from Whisper
          if (event.transcript?.trim()) {
            logger.info(`[STT_PIPELINE] Whisper transcript received: speaker=${this.speakerName}, meeting=${this.meetingId}, length=${event.transcript.trim().length}`);
            this.handleTranscript(event.transcript.trim());
          } else {
            logger.debug(`[STT_PIPELINE] Empty transcript from Whisper: speaker=${this.speakerName}, meeting=${this.meetingId}`);
          }
          break;

        case 'response.done':
          // Response cycle completed — we don't need the AI text response
          // but this confirms a VAD turn was processed
          logger.debug(`[RealtimeSession] Response done: speaker=${this.speakerName}`);
          break;

        case 'error':
          logger.error(`[RealtimeSession] OpenAI error: speaker=${this.speakerName}`, event.error);
          break;

        // Ignore other event types (response.audio.delta, etc.)
        default:
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

    // Persist to meeting_transcripts table
    try {
      await db('meeting_transcripts').insert({
        meeting_id: this.meetingId,
        organization_id: this.organizationId,
        speaker_id: this.speakerId,
        speaker_name: this.speakerName,
        original_text: text,
        source_lang: this.sourceLang,
        translations: JSON.stringify({}),
        spoken_at: now,
      });

      logger.info(`[STT_PIPELINE] Transcript SAVED to DB: meeting=${this.meetingId}, speaker=${this.speakerName}`);
    } catch (dbErr) {
      logger.error(`[STT_PIPELINE] DB insert FAILED: speaker=${this.speakerName}, meeting=${this.meetingId}`, dbErr);
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
