// ============================================================
// OrgsLedger — Google Cloud Speech-to-Text Streaming Service
// Per-user streaming recognition session. Receives audio chunks
// from the client via Socket.IO and returns transcripts.
// Supports WEBM_OPUS (browser MediaRecorder) and LINEAR16 (raw PCM).
// Works for both web and mobile clients.
// ============================================================

import { SpeechClient } from '@google-cloud/speech';
import path from 'path';
import { logger } from '../logger';

// ── Types ────────────────────────────────────────────────

export type AudioEncoding = 'WEBM_OPUS' | 'LINEAR16';

export interface SpeechSessionOptions {
  meetingId: string;
  userId: string;
  speakerName: string;
  languageCode?: string; // BCP-47, e.g. 'en-US'
  encoding?: AudioEncoding; // Default: WEBM_OPUS
  sampleRateHertz?: number; // Default: 48000 for WEBM_OPUS, 16000 for LINEAR16
  onTranscript: (text: string, isFinal: boolean) => void;
  onError?: (err: Error) => void;
}

// ── Constants ────────────────────────────────────────────

const STREAMING_LIMIT_MS = 4 * 60 * 1000; // Google STT streams max ~5min; restart at 4min
const RESTART_DELAY_MS = 300;

// Shared client singleton (reuse across sessions for efficiency)
let sharedClient: SpeechClient | null = null;

function getClient(): SpeechClient {
  if (!sharedClient) {
    const credPath = path.resolve(__dirname, '../../google-credentials.json');
    sharedClient = new SpeechClient({ keyFilename: credPath });
    logger.info(`[STT] Google Speech client initialized (credentials: ${credPath})`);
  }
  return sharedClient;
}

// ── Session Class ────────────────────────────────────────

export class SpeechSession {
  private client: SpeechClient;
  private recognizeStream: any = null;
  private closed = false;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private restartCounter = 0;
  private streamStartTime = 0;
  private bytesSent = 0;

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
    this.languageCode = opts.languageCode || 'en-US';
    this.encoding = opts.encoding || 'WEBM_OPUS';
    this.sampleRateHertz = opts.sampleRateHertz || (this.encoding === 'WEBM_OPUS' ? 48000 : 16000);
    this.onTranscript = opts.onTranscript;
    this.onError = opts.onError;

    this.client = getClient();

    logger.info(`[STT] Session created: speaker=${this.speakerName}, meeting=${this.meetingId}, lang=${this.languageCode}, encoding=${this.encoding}, rate=${this.sampleRateHertz}`);
  }

  // ── Public API ──────────────────────────────────────────

  /** Start the streaming recognition. */
  start(): void {
    if (this.closed) return;
    this.createStream();
  }

  /** Push an audio chunk (Buffer, ArrayBuffer, or base64 string). */
  pushAudio(data: Buffer | ArrayBuffer | string): void {
    if (this.closed || !this.recognizeStream) return;

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
      this.recognizeStream.write(buf);
    } catch (err) {
      logger.debug(`[STT] Write failed for ${this.speakerName}, restarting stream`);
      this.restartStream();
    }

    // Auto-restart before Google's streaming limit
    if (Date.now() - this.streamStartTime > STREAMING_LIMIT_MS) {
      logger.info(`[STT] Approaching stream limit, restarting: speaker=${this.speakerName}, bytes=${this.bytesSent}`);
      this.restartStream();
    }
  }

  /** Gracefully close the session. */
  close(): void {
    if (this.closed) return;
    this.closed = true;

    logger.info(`[STT] Closing session: speaker=${this.speakerName}, meeting=${this.meetingId}, totalBytes=${this.bytesSent}, restarts=${this.restartCounter}`);

    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }

    if (this.recognizeStream) {
      try { this.recognizeStream.end(); } catch (_) {}
      this.recognizeStream = null;
    }
    // Don't close the shared client
  }

  get isClosed(): boolean {
    return this.closed;
  }

  // ── Internals ──────────────────────────────────────────

  private createStream(): void {
    if (this.closed) return;

    const config: any = {
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
      .on('data', (response: any) => {
        if (this.closed) return;
        const result = response.results?.[0];
        if (!result?.alternatives?.[0]) return;

        const transcript = result.alternatives[0].transcript?.trim();
        const isFinal = result.isFinal === true;

        if (!transcript) return;

        if (isFinal) {
          logger.info(`[STT] Final: speaker=${this.speakerName}, text="${transcript.slice(0, 80)}${transcript.length > 80 ? '...' : ''}" (len=${transcript.length})`);
        }

        this.onTranscript(transcript, isFinal);
      })
      .on('error', (err: any) => {
        if (this.closed) return;

        // Code 11 = UNAVAILABLE, 4 = DEADLINE_EXCEEDED — normal stream timeout
        if (err.code === 11 || err.code === 4) {
          logger.debug(`[STT] Stream ended (code=${err.code}), restarting: speaker=${this.speakerName}`);
          this.restartStream();
          return;
        }

        logger.error(`[STT] Error for ${this.speakerName}: code=${err.code}, message=${err.message}`);
        this.onError?.(err);

        // Try to restart on transient errors
        if (err.code !== 3 && err.code !== 7) { // Not INVALID_ARGUMENT or PERMISSION_DENIED
          this.restartStream();
        }
      })
      .on('end', () => {
        if (!this.closed) {
          logger.debug(`[STT] Stream ended normally, restarting: speaker=${this.speakerName}`);
          this.restartStream();
        }
      });

    this.streamStartTime = Date.now();
    logger.debug(`[STT] Stream created: speaker=${this.speakerName}, lang=${this.languageCode}, encoding=${this.encoding}, restart#=${this.restartCounter}`);
  }

  private restartStream(): void {
    if (this.closed) return;

    if (this.recognizeStream) {
      try { this.recognizeStream.end(); } catch (_) {}
      this.recognizeStream = null;
    }

    if (this.restartTimer) return;

    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (!this.closed) {
        this.restartCounter++;
        this.createStream();
      }
    }, RESTART_DELAY_MS);
  }
}
