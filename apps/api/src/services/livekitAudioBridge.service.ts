// ============================================================
// OrgsLedger API — LiveKit Audio Bridge Service
// Subscribe to participant audio tracks and pipe to Deepgram
// ============================================================

import {
  AccessToken,
  TrackInfo,
  ParticipantInfo,
  RoomServiceClient,
} from 'livekit-server-sdk';
import { deepgramRealtimeService, TranscriptSegment } from './deepgramRealtime.service';
import { logger } from '../logger';

interface AudioBridgeConfig {
  meetingId: string;
  participantId: string;
  participantName: string;
  roomName: string;
}

interface AudioBridgeCallbacks {
  onInterimTranscript?: (segment: TranscriptSegment) => void;
  onFinalTranscript?: (segment: TranscriptSegment) => void;
  onLanguageDetected?: (language: string) => void;
  onError?: (error: Error) => void;
}

class LiveKitAudioBridgeService {
  private activeParticipants: Map<string, any> = new Map();
  private streamIds: Map<string, string> = new Map(); // participantId -> streamId mapping
  private roomClient: RoomServiceClient | null = null;

  constructor() {
    const url = process.env.LIVEKIT_URL;
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;

    if (url && apiKey && apiSecret) {
      this.roomClient = new RoomServiceClient(url, apiKey, apiSecret);
      logger.info('LiveKit audio bridge initialized');
    } else {
      logger.warn('LiveKit credentials not fully configured for audio bridge');
    }
  }

  /**
   * Start audio streaming for a participant
   */
  async startParticipantAudioStream(
    config: AudioBridgeConfig,
    callbacks?: AudioBridgeCallbacks
  ): Promise<string | null> {
    try {
      if (!this.roomClient) {
        logger.warn('LiveKit audio bridge not initialized');
        return null;
      }

      const streamId = `${config.meetingId}:${config.participantId}`;

      // Create Deepgram stream for this participant
      const streamCreated = await deepgramRealtimeService.createStream(
        streamId,
        {
          meetingId: config.meetingId,
          speakerId: config.participantId,
          speakerName: config.participantName,
        },
        {
          onInterim: callbacks?.onInterimTranscript,
          onFinal: callbacks?.onFinalTranscript,
          onLanguageDetected: callbacks?.onLanguageDetected,
          onError: callbacks?.onError,
        }
      );

      if (!streamCreated) {
        logger.error(`Failed to create Deepgram stream for participant: ${config.participantId}`);
        return null;
      }

      // Store mapping
      this.streamIds.set(config.participantId, streamId);
      this.activeParticipants.set(config.participantId, config);

      logger.info(`Started audio streaming for participant: ${config.participantId}`, {
        meetingId: config.meetingId,
        streamId,
      });

      return streamId;
    } catch (err) {
      logger.error(`Failed to start audio streaming for participant: ${config.participantId}`, err);
      return null;
    }
  }

  /**
   * Stop audio streaming for a participant
   */
  async stopParticipantAudioStream(participantId: string): Promise<boolean> {
    try {
      const streamId = this.streamIds.get(participantId);
      if (!streamId) {
        return true; // Already stopped
      }

      await deepgramRealtimeService.closeStream(streamId);
      this.streamIds.delete(participantId);
      this.activeParticipants.delete(participantId);

      logger.info(`Stopped audio streaming for participant: ${participantId}`);
      return true;
    } catch (err) {
      logger.error(`Failed to stop audio streaming for participant: ${participantId}`, err);
      return false;
    }
  }

  /**
   * Send audio chunk from participant
   */
  async sendAudioChunk(participantId: string, audioBuffer: Buffer): Promise<boolean> {
    try {
      const streamId = this.streamIds.get(participantId);
      if (!streamId) {
        logger.debug(`No active stream for participant: ${participantId}`);
        return false;
      }

      return await deepgramRealtimeService.handleAudioChunk(streamId, audioBuffer);
    } catch (err) {
      logger.error(`Failed to send audio chunk for participant: ${participantId}`, err);
      return false;
    }
  }

  /**
   * Stop all audio streams for a meeting
   */
  async stopMeetingAudioStreams(meetingId: string): Promise<void> {
    try {
      // Close all streams for this meeting
      for (const [participantId, config] of this.activeParticipants.entries()) {
        if (config.meetingId === meetingId) {
          await this.stopParticipantAudioStream(participantId);
        }
      }

      // Also close Deepgram streams
      await deepgramRealtimeService.closeMeetingStreams(meetingId);

      logger.info(`Stopped all audio streams for meeting: ${meetingId}`);
    } catch (err) {
      logger.error(`Failed to stop meeting audio streams: ${meetingId}`, err);
    }
  }

  /**
   * Get active participant count for a meeting
   */
  getActiveParticipantCount(meetingId: string): number {
    let count = 0;
    for (const config of this.activeParticipants.values()) {
      if (config.meetingId === meetingId) {
        count++;
      }
    }
    return count;
  }

  /**
   * Get all active participants for a meeting
   */
  getActiveMeetingParticipants(meetingId: string): Array<{
    participantId: string;
    participantName: string;
  }> {
    const participants: Array<{ participantId: string; participantName: string }> = [];
    for (const [participantId, config] of this.activeParticipants.entries()) {
      if (config.meetingId === meetingId) {
        participants.push({
          participantId,
          participantName: config.participantName,
        });
      }
    }
    return participants;
  }

  /**
   * Get health status
   */
  getStatus(): {
    isHealthy: boolean;
    activeParticipants: number;
    liveKitConfigured: boolean;
  } {
    return {
      isHealthy: this.roomClient !== null,
      activeParticipants: this.activeParticipants.size,
      liveKitConfigured: this.roomClient !== null,
    };
  }
}

// Export singleton instance
export const liveKitAudioBridgeService = new LiveKitAudioBridgeService();
export type { AudioBridgeConfig, AudioBridgeCallbacks };
