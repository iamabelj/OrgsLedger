// ============================================================
// OrgsLedger API — Transcription Service
// Deepgram real-time transcription via WebSocket
// Handles audio streaming and transcript events
// ============================================================

import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { config } from '../../../config';
import { logger } from '../../../logger';
import { submitTranscriptEvent } from '../../../queues/transcript.queue';
import { 
  checkTranscriptBackpressure, 
  isBackpressureError,
} from '../../../scaling/backpressure';
import { recordDeepgramUsage } from '../../../monitoring/ai-cost.monitor';
import { guardDeepgramRequest } from '../../../monitoring/ai-rate-limit.guard';

// ── Types ───────────────────────────────────────────────────

export interface TranscriptionConfig {
  meetingId: string;
  language?: string;
  model?: string;
  punctuate?: boolean;
  diarize?: boolean;
  smartFormat?: boolean;
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

// ── Deepgram WebSocket URL ──────────────────────────────────

const DEEPGRAM_WS_URL = 'wss://api.deepgram.com/v1/listen';

// ── Audio format constants (for duration calculation) ───────
// Deepgram receives: 16-bit PCM, 16kHz sample rate, mono
const BYTES_PER_SAMPLE = 2; // 16-bit = 2 bytes
const SAMPLE_RATE = 16000;
const CHANNELS = 1;
const BYTES_PER_SECOND = BYTES_PER_SAMPLE * SAMPLE_RATE * CHANNELS; // 32000

// ── Transcription Session Class ─────────────────────────────

export class TranscriptionSession extends EventEmitter {
  private ws: WebSocket | null = null;
  private config: TranscriptionConfig;
  private isConnected = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private keepAliveInterval: NodeJS.Timeout | null = null;
  private speakerMap = new Map<number, string>();
  
  // Track audio duration for cost monitoring
  private totalAudioBytes = 0;

  constructor(cfg: TranscriptionConfig) {
    super();
    this.config = cfg;
  }

  /**
   * Connect to Deepgram WebSocket
   */
  async connect(): Promise<void> {
    if (!config.deepgram?.apiKey) {
      throw new Error('Deepgram API key not configured');
    }

    const params = new URLSearchParams({
      model: this.config.model || config.deepgram?.model || 'nova-2',
      language: this.config.language || config.deepgram?.language || 'en-US',
      punctuate: String(this.config.punctuate ?? true),
      diarize: String(this.config.diarize ?? true),
      smart_format: String(this.config.smartFormat ?? true),
      interim_results: 'true',
      utterance_end_ms: '1000',
      vad_events: 'true',
      encoding: 'linear16',
      sample_rate: '16000',
      channels: '1',
    });

    const url = `${DEEPGRAM_WS_URL}?${params.toString()}`;

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url, {
        headers: {
          Authorization: `Token ${config.deepgram?.apiKey || ''}`,
        },
      });

      this.ws.on('open', () => {
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.startKeepAlive();
        
        logger.info('[TRANSCRIPTION] Connected to Deepgram', {
          meetingId: this.config.meetingId,
        });
        
        this.emit('connected');
        resolve();
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        this.handleMessage(data);
      });

      this.ws.on('error', (error: Error) => {
        logger.error('[TRANSCRIPTION] WebSocket error', {
          meetingId: this.config.meetingId,
          error: error.message,
        });
        this.emit('error', error);
        reject(error);
      });

      this.ws.on('close', (code: number, reason: Buffer) => {
        this.isConnected = false;
        this.stopKeepAlive();
        
        logger.warn('[TRANSCRIPTION] WebSocket closed', {
          meetingId: this.config.meetingId,
          code,
          reason: reason.toString(),
        });

        this.emit('disconnected', { code, reason: reason.toString() });

        // Attempt reconnection if not intentionally closed
        if (code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.handleReconnect();
        }
      });

      // Timeout connection attempt
      setTimeout(() => {
        if (!this.isConnected) {
          reject(new Error('Connection timeout'));
        }
      }, 10000);
    });
  }

  /**
   * Handle incoming Deepgram message
   */
  private handleMessage(data: WebSocket.Data): void {
    try {
      const message = JSON.parse(data.toString());

      // Handle different message types
      if (message.type === 'Results') {
        this.handleTranscriptResult(message);
      } else if (message.type === 'UtteranceEnd') {
        this.emit('utteranceEnd', {
          meetingId: this.config.meetingId,
          timestamp: Date.now(),
        });
      } else if (message.type === 'SpeechStarted') {
        this.emit('speechStarted', {
          meetingId: this.config.meetingId,
        });
      } else if (message.type === 'Metadata') {
        logger.debug('[TRANSCRIPTION] Metadata received', {
          meetingId: this.config.meetingId,
          requestId: message.request_id,
        });
      }
    } catch (err: any) {
      logger.warn('[TRANSCRIPTION] Failed to parse message', {
        meetingId: this.config.meetingId,
        error: err.message,
      });
    }
  }

  /**
   * Handle transcript result from Deepgram
   */
  private async handleTranscriptResult(message: any): Promise<void> {
    const channel = message.channel;
    const alternatives = channel?.alternatives;

    if (!alternatives || alternatives.length === 0) return;

    const best = alternatives[0];
    const transcript = best.transcript?.trim();

    if (!transcript) return;

    // Extract speaker info from diarization
    const speaker = this.extractSpeaker(best);
    const isFinal = message.is_final === true;

    const result: TranscriptResult = {
      transcript,
      speaker,
      timestamp: Date.now(),
      duration: message.duration || 0,
      isFinal,
      confidence: best.confidence || 0,
      words: best.words,
    };

    // Emit event
    this.emit('transcript', result);

    // Queue final transcripts for processing
    if (isFinal) {
      try {
        // Check AI rate limit first (Deepgram)
        const rateLimitGuard = await guardDeepgramRequest(isFinal);
        if (!rateLimitGuard.proceed) {
          logger.warn('[TRANSCRIPTION] Deepgram rate limit triggered, skipping', {
            meetingId: this.config.meetingId,
            reason: rateLimitGuard.skipReason,
          });
          this.emit('rateLimited', {
            meetingId: this.config.meetingId,
            service: 'deepgram',
            reason: rateLimitGuard.skipReason,
          });
          return;
        }

        // Check backpressure before submitting
        const backpressureStatus = await checkTranscriptBackpressure();
        if (!backpressureStatus.allowed) {
          logger.warn('[TRANSCRIPTION] Backpressure triggered, dropping transcript', {
            meetingId: this.config.meetingId,
            queueUtilization: backpressureStatus.utilizationPercent.toFixed(1) + '%',
            retryAfter: backpressureStatus.retryAfter,
          });
          this.emit('backpressure', {
            meetingId: this.config.meetingId,
            droppedTranscript: true,
            retryAfter: backpressureStatus.retryAfter,
          });
          return;
        }

        await submitTranscriptEvent({
          meetingId: this.config.meetingId,
          speaker: String(speaker),
          text: transcript,
          timestamp: new Date().toISOString(),
          isFinal: true,
          confidence: result.confidence,
          language: this.config.language || config.deepgram?.language || 'en-US',
        });
      } catch (err: any) {
        if (isBackpressureError(err)) {
          logger.warn('[TRANSCRIPTION] Backpressure error, dropping transcript', {
            meetingId: this.config.meetingId,
            retryAfter: err.retryAfter,
          });
          return;
        }
        logger.warn('[TRANSCRIPTION] Failed to queue transcript', {
          meetingId: this.config.meetingId,
          error: err.message,
        });
      }
    }
  }

  /**
   * Extract speaker identifier from Deepgram response
   */
  private extractSpeaker(alternative: any): string {
    // If words have speaker info, use the most common speaker
    if (alternative.words && alternative.words.length > 0) {
      const speakerCounts = new Map<number, number>();
      
      for (const word of alternative.words) {
        if (word.speaker !== undefined) {
          speakerCounts.set(
            word.speaker,
            (speakerCounts.get(word.speaker) || 0) + 1
          );
        }
      }

      if (speakerCounts.size > 0) {
        let maxSpeaker = 0;
        let maxCount = 0;
        for (const [speaker, count] of speakerCounts) {
          if (count > maxCount) {
            maxSpeaker = speaker;
            maxCount = count;
          }
        }
        return `Speaker ${maxSpeaker + 1}`;
      }
    }

    return 'Unknown';
  }

  /**
   * Send audio data to Deepgram
   */
  sendAudio(audioData: Buffer): void {
    if (!this.isConnected || !this.ws) {
      logger.warn('[TRANSCRIPTION] Cannot send audio - not connected');
      return;
    }

    try {
      this.ws.send(audioData);
      // Track audio bytes for cost monitoring
      this.totalAudioBytes += audioData.length;
    } catch (err: any) {
      logger.error('[TRANSCRIPTION] Failed to send audio', {
        meetingId: this.config.meetingId,
        error: err.message,
      });
    }
  }

  /**
   * Start keep-alive heartbeat
   */
  private startKeepAlive(): void {
    this.keepAliveInterval = setInterval(() => {
      if (this.isConnected && this.ws) {
        try {
          // Send keep-alive message
          this.ws.send(JSON.stringify({ type: 'KeepAlive' }));
        } catch {
          // Ignore errors
        }
      }
    }, 10000); // Every 10 seconds
  }

  /**
   * Stop keep-alive heartbeat
   */
  private stopKeepAlive(): void {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
  }

  /**
   * Handle reconnection with exponential backoff
   */
  private handleReconnect(): void {
    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);

    logger.info('[TRANSCRIPTION] Attempting reconnection', {
      meetingId: this.config.meetingId,
      attempt: this.reconnectAttempts,
      delayMs: delay,
    });

    setTimeout(() => {
      this.connect().catch((err) => {
        logger.error('[TRANSCRIPTION] Reconnection failed', {
          meetingId: this.config.meetingId,
          error: err.message,
        });
      });
    }, delay);
  }

  /**
   * Gracefully close the connection
   */
  async close(): Promise<void> {
    this.stopKeepAlive();
    
    // Record Deepgram usage for cost monitoring before closing
    if (this.totalAudioBytes > 0) {
      try {
        const durationSeconds = this.totalAudioBytes / BYTES_PER_SECOND;
        recordDeepgramUsage(durationSeconds, this.config.meetingId);
        logger.debug('[TRANSCRIPTION] Deepgram usage recorded', {
          meetingId: this.config.meetingId,
          durationSeconds: durationSeconds.toFixed(2),
          audioBytes: this.totalAudioBytes,
        });
      } catch (costErr) {
        logger.warn('[TRANSCRIPTION] Failed to record Deepgram cost', {
          meetingId: this.config.meetingId,
          error: costErr,
        });
      }
    }
    
    if (this.ws) {
      // Send close frame
      try {
        this.ws.send(JSON.stringify({ type: 'CloseStream' }));
      } catch {
        // Ignore
      }

      this.ws.close(1000, 'Session ended');
      this.ws = null;
    }

    this.isConnected = false;
    
    logger.info('[TRANSCRIPTION] Session closed', {
      meetingId: this.config.meetingId,
    });
  }

  /**
   * Check if connected
   */
  isActive(): boolean {
    return this.isConnected;
  }

  /**
   * Map speaker number to user ID
   */
  setSpeakerMapping(speakerNum: number, userId: string): void {
    this.speakerMap.set(speakerNum, userId);
  }
}

// ── Session Manager ─────────────────────────────────────────

const activeSessions = new Map<string, TranscriptionSession>();

/**
 * Create a new transcription session for a meeting
 */
export async function createTranscriptionSession(
  cfg: TranscriptionConfig
): Promise<TranscriptionSession> {
  // Close existing session if any
  const existing = activeSessions.get(cfg.meetingId);
  if (existing) {
    await existing.close();
    activeSessions.delete(cfg.meetingId);
  }

  const session = new TranscriptionSession(cfg);
  await session.connect();
  
  activeSessions.set(cfg.meetingId, session);
  
  return session;
}

/**
 * Get existing transcription session
 */
export function getTranscriptionSession(
  meetingId: string
): TranscriptionSession | undefined {
  return activeSessions.get(meetingId);
}

/**
 * Close and remove transcription session
 */
export async function closeTranscriptionSession(
  meetingId: string
): Promise<void> {
  const session = activeSessions.get(meetingId);
  if (session) {
    await session.close();
    activeSessions.delete(meetingId);
  }
}

/**
 * Get count of active sessions
 */
export function getActiveSessionCount(): number {
  return activeSessions.size;
}
