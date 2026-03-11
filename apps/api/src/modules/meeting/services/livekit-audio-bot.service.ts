// ============================================================
// OrgsLedger API — LiveKit Audio Bot
// Joins LiveKit rooms as hidden participant
// Streams audio to Deepgram for transcription
// Runs as separate process to avoid blocking API
// ============================================================

import { EventEmitter } from 'events';
import { config } from '../../../config';
import { logger } from '../../../logger';
import {
  TranscriptionSession,
  createTranscriptionSession,
  closeTranscriptionSession,
} from './transcription.service';
import { generateParticipantToken } from './livekit-token.service';

// ── Types ───────────────────────────────────────────────────

export interface AudioBotConfig {
  meetingId: string;
  organizationId: string;
  language?: string;
}

// Note: This is a simplified implementation that works without 
// the full @livekit/rtc-node SDK. For production, you would use
// the livekit-server-sdk for Egress API to capture audio streams.

// ── Audio Bot Class ─────────────────────────────────────────

export class LiveKitAudioBot extends EventEmitter {
  private transcriptionSession: TranscriptionSession | null = null;
  private config: AudioBotConfig;
  private isRunning = false;
  private ws: WebSocket | null = null;

  constructor(cfg: AudioBotConfig) {
    super();
    this.config = cfg;
  }

  /**
   * Start the audio bot
   * Note: In production, use LiveKit Egress API for reliable audio capture
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('[AUDIO_BOT] Already running', {
        meetingId: this.config.meetingId,
      });
      return;
    }

    try {
      // Generate bot token for potential future use
      const tokenResponse = await generateParticipantToken({
        meetingId: this.config.meetingId,
        userId: `bot-transcription-${this.config.meetingId}`,
        name: 'Transcription Bot',
        role: 'bot',
      });

      // Start transcription session (ready to receive audio)
      this.transcriptionSession = await createTranscriptionSession({
        meetingId: this.config.meetingId,
        language: this.config.language,
        diarize: true,
        punctuate: true,
        smartFormat: true,
      });

      // Set up transcription event forwarding
      this.setupTranscriptionEvents();

      this.isRunning = true;

      logger.info('[AUDIO_BOT] Started', {
        meetingId: this.config.meetingId,
        roomName: tokenResponse.roomName,
      });

      this.emit('started');

      // Note: Actual audio streaming from LiveKit would be done via:
      // 1. LiveKit Egress API (recommended for production)
      // 2. Client-side audio capture and server relay
      // 3. @livekit/rtc-node with proper audio frame handling
      
    } catch (err: any) {
      logger.error('[AUDIO_BOT] Failed to start', {
        meetingId: this.config.meetingId,
        error: err.message,
      });
      throw err;
    }
  }

  /**
   * Set up transcription event forwarding
   */
  private setupTranscriptionEvents(): void {
    if (!this.transcriptionSession) return;

    this.transcriptionSession.on('transcript', (result) => {
      this.emit('transcript', {
        meetingId: this.config.meetingId,
        ...result,
      });
    });

    this.transcriptionSession.on('error', (error) => {
      logger.error('[AUDIO_BOT] Transcription error', {
        meetingId: this.config.meetingId,
        error: error.message,
      });
      this.emit('transcriptionError', error);
    });

    this.transcriptionSession.on('disconnected', () => {
      logger.warn('[AUDIO_BOT] Transcription disconnected', {
        meetingId: this.config.meetingId,
      });
    });
  }

  /**
   * Send audio data to transcription service
   * Called by external audio stream handler
   */
  sendAudio(audioData: Buffer): void {
    if (!this.transcriptionSession?.isActive()) {
      return;
    }
    this.transcriptionSession.sendAudio(audioData);
  }

  /**
   * Stop the audio bot
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    logger.info('[AUDIO_BOT] Stopping', {
      meetingId: this.config.meetingId,
    });

    // Close transcription session
    if (this.transcriptionSession) {
      await closeTranscriptionSession(this.config.meetingId);
      this.transcriptionSession = null;
    }

    // Close WebSocket if any
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.isRunning = false;

    logger.info('[AUDIO_BOT] Stopped', {
      meetingId: this.config.meetingId,
    });

    this.emit('stopped');
  }

  /**
   * Check if bot is running
   */
  getIsRunning(): boolean {
    return this.isRunning;
  }
}

// ── Bot Manager ─────────────────────────────────────────────

const activeBots = new Map<string, LiveKitAudioBot>();

/**
 * Start an audio bot for a meeting
 */
export async function startAudioBot(
  cfg: AudioBotConfig
): Promise<LiveKitAudioBot> {
  // Stop existing bot if any
  const existing = activeBots.get(cfg.meetingId);
  if (existing) {
    await existing.stop();
    activeBots.delete(cfg.meetingId);
  }

  const bot = new LiveKitAudioBot(cfg);
  await bot.start();
  
  activeBots.set(cfg.meetingId, bot);
  
  return bot;
}

/**
 * Stop an audio bot
 */
export async function stopAudioBot(meetingId: string): Promise<void> {
  const bot = activeBots.get(meetingId);
  if (bot) {
    await bot.stop();
    activeBots.delete(meetingId);
  }
}

/**
 * Get active bot for a meeting
 */
export function getAudioBot(meetingId: string): LiveKitAudioBot | undefined {
  return activeBots.get(meetingId);
}

/**
 * Get count of active bots
 */
export function getActiveBotCount(): number {
  return activeBots.size;
}

/**
 * Stop all active bots (for graceful shutdown)
 */
export async function stopAllBots(): Promise<void> {
  const stopPromises = Array.from(activeBots.values()).map(bot => bot.stop());
  await Promise.all(stopPromises);
  activeBots.clear();
}
