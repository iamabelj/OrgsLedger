// ============================================================
// OrgsLedger — Deepgram Speech-to-Text Streaming Service
// Per-user streaming recognition session. Receives audio chunks
// from the client via Socket.IO and returns transcripts.
// Supports WEBM_OPUS (browser MediaRecorder) and LINEAR16 (raw PCM).
// Works for both web and mobile clients.
// ============================================================

import { DeepgramClient } from '@deepgram/sdk';
import { logger } from '../logger';

// ── Credential Validation ────────────────────────────────

const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;
let credentialsValid = !!DEEPGRAM_API_KEY;

if (credentialsValid) {
  logger.info(`[STT] Deepgram API key configured (key=${DEEPGRAM_API_KEY?.slice(0, 8)}...)`);
} else {
  logger.error(`[STT] ❌ DEEPGRAM_API_KEY not configured — Speech-to-Text will NOT work!`);
}

/** Check if STT credentials are available */
export function isSttAvailable(): boolean {
  return credentialsValid;
}

/** Get credential diagnostic info */
export function getSttDiagnostics() {
  return {
    provider: 'deepgram',
    apiKeyConfigured: credentialsValid,
    apiKeyPrefix: DEEPGRAM_API_KEY ? DEEPGRAM_API_KEY.slice(0, 8) + '...' : 'NOT SET',
  };
}

// ── Types ────────────────────────────────────────────────

export type AudioEncoding = 'WEBM_OPUS' | 'LINEAR16';

export interface SpeechSessionOptions {
  meetingId: string;
  userId: string;
  speakerName: string;
  languageCode?: string; // BCP-47, e.g. 'en-US' or short code 'en'
  encoding?: AudioEncoding; // Default: WEBM_OPUS
  sampleRateHertz?: number; // Default: 48000 for WEBM_OPUS, 16000 for LINEAR16
  onTranscript: (text: string, isFinal: boolean) => void;
  onError?: (err: Error) => void;
}

// ── Session Class ────────────────────────────────────────

export class SpeechSession {
  private connection: any = null;
  private closed = false;
  private bytesSent = 0;
  private keepAliveInterval: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  private readonly meetingId: string;
  private readonly userId: string;
  private readonly speakerName: string;
  private readonly languageCode: string;
  private readonly encoding: AudioEncoding;
  private readonly sampleRateHertz: number;
  private readonly onTranscript: (text: string, isFinal: boolean) => void;
  private readonly onError?: (err: Error) => void;

  constructor(opts: SpeechSessionOptions) {
    this.meetingId = opts.meetingId;
    this.userId = opts.userId;
    this.speakerName = opts.speakerName;
    // Convert BCP-47 to Deepgram language code (e.g., 'en-US' -> 'en')
    this.languageCode = opts.languageCode?.split('-')[0] || 'en';
    this.encoding = opts.encoding || 'WEBM_OPUS';
    this.sampleRateHertz = opts.sampleRateHertz || (this.encoding === 'WEBM_OPUS' ? 48000 : 16000);
    this.onTranscript = opts.onTranscript;
    this.onError = opts.onError;

    logger.info(`[STT] Deepgram session created: speaker=${this.speakerName}, meeting=${this.meetingId}, lang=${this.languageCode}, encoding=${this.encoding}, rate=${this.sampleRateHertz}`);
  }

  // ── Public API ──────────────────────────────────────────

  /** Start the streaming recognition. */
  start(): void {
    if (this.closed) return;
    // Fire and forget - connection runs async
    this.createConnection().catch((err) => {
      logger.error(`[STT] Failed to start connection: ${err.message}`);
      this.onError?.(err);
    });
  }

  /** Push an audio chunk (Buffer, ArrayBuffer, or base64 string). */
  pushAudio(data: Buffer | ArrayBuffer | string): void {
    if (this.closed || !this.connection) return;

    let buf: Buffer;
    if (typeof data === 'string') {
      buf = Buffer.from(data, 'base64');
    } else if (data instanceof ArrayBuffer) {
      buf = Buffer.from(data);
    } else {
      buf = data;
    }

    this.bytesSent += buf.length;

    try {
      // Send audio data via the connection's socket
      if (this.connection.socket) {
        this.connection.socket.send(buf);
      } else {
        this.connection.send(buf);
      }
    } catch (err: any) {
      logger.debug(`[STT] Send failed for ${this.speakerName}: ${err.message}`);
      if (!this.reconnectTimer) {
        this.reconnectStream();
      }
    }
  }

  /** Gracefully close the session. */
  close(): void {
    if (this.closed) return;
    this.closed = true;

    logger.info(`[STT] Closing Deepgram session: speaker=${this.speakerName}, meeting=${this.meetingId}, totalBytes=${this.bytesSent}`);

    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.connection) {
      try {
        this.connection.finalize();
      } catch (_) {}
      this.connection = null;
    }
  }

  get isClosed(): boolean {
    return this.closed;
  }

  // ── Internals ──────────────────────────────────────────

  private async createConnection(): Promise<void> {
    if (this.closed) return;

    if (!DEEPGRAM_API_KEY) {
      const err = new Error('DEEPGRAM_API_KEY not configured');
      logger.error(`[STT] ${err.message}`);
      this.onError?.(err);
      return;
    }

    try {
      const deepgram = new DeepgramClient({ apiKey: DEEPGRAM_API_KEY });

      // Configure Deepgram live transcription options
      const options: any = {
        model: 'nova-2',
        punctuate: true,
        smart_format: true,
        interim_results: true,
        endpointing: 300,
        utterance_end_ms: 1500,
      };

      // Set encoding based on input
      if (this.encoding === 'WEBM_OPUS') {
        options.encoding = 'opus';
        options.sample_rate = this.sampleRateHertz;
        options.channels = 1;
      } else if (this.encoding === 'LINEAR16') {
        options.encoding = 'linear16';
        options.sample_rate = this.sampleRateHertz;
        options.channels = 1;
      }

      // Set language (use 'multi' for auto-detect, otherwise specific language)
      if (this.languageCode === 'multi' || this.languageCode === 'auto') {
        options.language = 'multi';
      } else {
        options.language = this.languageCode;
      }

      // Create live transcription connection using v1 API
      this.connection = await deepgram.listen.v1.connect(options);

      // Handle connection open
      this.connection.on('open', () => {
        logger.info(`[STT] Deepgram connection opened: speaker=${this.speakerName}`);
        this.reconnectAttempts = 0;

        // Send keep-alive every 8 seconds to prevent timeout
        this.keepAliveInterval = setInterval(() => {
          if (this.connection) {
            try {
              this.connection.keepAlive();
            } catch (_) {}
          }
        }, 8000);
      });

      // Handle transcripts via 'message' event
      this.connection.on('message', (data: any) => {
        if (this.closed) return;
        if (data.type !== 'Results') return;

        const transcript = data.channel?.alternatives?.[0];
        if (!transcript) return;

        const text = transcript.transcript?.trim();
        if (!text) return;

        const isFinal = data.is_final === true;
        const speechFinal = data.speech_final === true;

        // For Deepgram, we emit on both interim and final
        // speech_final=true means the utterance is complete
        if (isFinal || speechFinal) {
          logger.info(`[STT] Final: speaker=${this.speakerName}, text="${text.slice(0, 80)}${text.length > 80 ? '...' : ''}" (len=${text.length})`);
        }

        this.onTranscript(text, isFinal || speechFinal);
      });

      // Handle errors
      this.connection.on('error', (err: any) => {
        if (this.closed) return;

        logger.error(`[STT] Deepgram error for ${this.speakerName}: ${err.message || err}`);
        this.onError?.(err instanceof Error ? err : new Error(String(err)));
      });

      // Handle connection close
      this.connection.on('close', () => {
        logger.info(`[STT] Deepgram connection closed: speaker=${this.speakerName}`);

        if (this.keepAliveInterval) {
          clearInterval(this.keepAliveInterval);
          this.keepAliveInterval = null;
        }

        // Auto-reconnect if not intentionally closed
        if (!this.closed) {
          this.reconnectStream();
        }
      });

      // Wait for connection to be ready
      this.connection.connect();
      await this.connection.waitForOpen();

    } catch (err: any) {
      logger.error(`[STT] Failed to create Deepgram connection: ${err.message}`);
      this.onError?.(err);
      this.reconnectStream();
    }
  }

  private reconnectStream(): void {
    if (this.closed) return;
    if (this.reconnectTimer) return;

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error(`[STT] Max reconnect attempts reached for ${this.speakerName}`);
      this.onError?.(new Error('Max reconnect attempts reached'));
      return;
    }

    // Clean up old connection
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }

    if (this.connection) {
      try { this.connection.finalize(); } catch (_) {}
      this.connection = null;
    }

    // Exponential backoff: 500ms, 1s, 2s, 4s, 8s
    const delay = Math.min(500 * Math.pow(2, this.reconnectAttempts), 8000);
    this.reconnectAttempts++;

    logger.info(`[STT] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}): speaker=${this.speakerName}`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.closed) {
        this.createConnection();
      }
    }, delay);
  }
}
