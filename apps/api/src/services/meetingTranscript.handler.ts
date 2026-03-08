// ============================================================
// OrgsLedger API — Meeting Transcript Handler  (v3)
// Integrates Deepgram, new meeting pipeline, and Socket.IO
// Pipeline handles: broadcast, translation, storage, summary
// ============================================================

import { db } from '../db';
import { logger } from '../logger';
import { liveKitAudioBridgeService } from './livekitAudioBridge.service';
import { deepgramRealtimeService, TranscriptSegment } from './deepgramRealtime.service';
import { normalizeLang } from '../utils/langNormalize';
import { meetingPipeline } from '../meeting-pipeline';

interface MeetingTranscriptContext {
  meetingId: string;
  participantId: string;
  participantName: string;
  io: any; // Socket.IO server instance
  currentLanguage: string;
}

interface BroadcastPayload {
  speakerId: string;
  speakerName: string;
  originalText: string;
  sourceLanguage: string;
  translations: Record<string, string>;
  timestamp: Date;
}

class MeetingTranscriptHandler {
  private contexts: Map<string, MeetingTranscriptContext> = new Map();
  private pendingTranscripts: Map<string, string> = new Map(); // For batching finals

  // ── Debounce: coalesce rapid interim transcripts ────────
  private interimTimers: Map<string, NodeJS.Timeout> = new Map();
  private interimBuffers: Map<string, { segment: TranscriptSegment; context: MeetingTranscriptContext }> = new Map();
  private readonly INTERIM_DEBOUNCE_MS = 200; // 200ms window

  // ── Org-ID cache (avoid DB hit per final transcript) ────
  private orgIdCache: Map<string, string> = new Map();

  /**
   * Initialize transcript handling for a participant in a meeting
   */
  async initializeParticipantTranscript(
    context: MeetingTranscriptContext
  ): Promise<string | null> {
    try {
      const contextId = `${context.meetingId}:${context.participantId}`;

      // Start audio stream from LiveKit
      const streamId = await liveKitAudioBridgeService.startParticipantAudioStream(
        {
          meetingId: context.meetingId,
          participantId: context.participantId,
          participantName: context.participantName,
          roomName: context.meetingId, // LiveKit room name
        },
        {
          onInterimTranscript: (segment) =>
            this.handleInterimTranscript(contextId, segment, context),
          onFinalTranscript: (segment) =>
            this.handleFinalTranscript(contextId, segment, context),
          onLanguageDetected: (lang) => this.handleLanguageDetected(contextId, lang, context),
          onError: (err) => this.handleStreamError(contextId, err, context),
        }
      );

      if (streamId) {
        this.contexts.set(contextId, context);
        logger.info(`Initialized transcript handling for participant: ${context.participantId}`, {
          meetingId: context.meetingId,
          streamId,
        });
        return contextId;
      }

      return null;
    } catch (err) {
      logger.error(`Failed to initialize participant transcript: ${context.participantId}`, err);
      return null;
    }
  }

  /**
   * Handle interim (real-time) transcript
   * Debounced: coalesces rapid updates within INTERIM_DEBOUNCE_MS window
   */
  private async handleInterimTranscript(
    contextId: string,
    segment: TranscriptSegment,
    context: MeetingTranscriptContext
  ): Promise<void> {
    try {
      // Update detected language
      if (segment.language) {
        const contextData = this.contexts.get(contextId);
        if (contextData) {
          contextData.currentLanguage = segment.language;
        }
      }

      // Buffer this segment — if another arrives within INTERIM_DEBOUNCE_MS, we skip this one
      this.interimBuffers.set(contextId, { segment, context });

      // Clear existing timer for this speaker
      const existingTimer = this.interimTimers.get(contextId);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }

      // Set debounce timer
      this.interimTimers.set(
        contextId,
        setTimeout(() => this.flushInterim(contextId), this.INTERIM_DEBOUNCE_MS)
      );
    } catch (err) {
      logger.error(`Failed to handle interim transcript for: ${contextId}`, err);
    }
  }

  /**
   * Flush the debounced interim transcript — submit to pipeline
   */
  private async flushInterim(contextId: string): Promise<void> {
    const entry = this.interimBuffers.get(contextId);
    if (!entry) return;
    this.interimBuffers.delete(contextId);
    this.interimTimers.delete(contextId);

    const { segment, context } = entry;

    try {
      // Submit interim transcript to pipeline (isFinal: false)
      // Pipeline broadcast worker will emit 'caption:interim' event
      await meetingPipeline.submitTranscript({
        meetingId: context.meetingId,
        segmentIndex: -1, // Negative index indicates interim
        text: segment.text,
        speakerId: segment.speakerId,
        speakerName: segment.speakerName,
        timestamp: segment.timestamp instanceof Date
          ? segment.timestamp.toISOString()
          : new Date().toISOString(),
        isFinal: false,
        language: segment.language,
        confidence: segment.confidence,
      });

      logger.debug(`Submitted interim transcript to pipeline: ${segment.speakerId}`, {
        textLength: segment.text.length,
      });
    } catch (err) {
      logger.error(`Failed to flush interim for: ${contextId}`, err);
    }
  }

  /**
   * Handle final transcript
   * Submit to meeting pipeline for processing
   * Pipeline handles: broadcast, translation, storage, summary
   */
  private async handleFinalTranscript(
    contextId: string,
    segment: TranscriptSegment,
    context: MeetingTranscriptContext
  ): Promise<void> {
    try {
      // Skip empty transcripts
      if (!segment.text || segment.text.trim().length === 0) {
        return;
      }

      // Cancel any pending interim debounce — final supersedes it
      const pendingTimer = this.interimTimers.get(contextId);
      if (pendingTimer) {
        clearTimeout(pendingTimer);
        this.interimTimers.delete(contextId);
        this.interimBuffers.delete(contextId);
      }

      // Get segment index
      const segmentIndex = this.getNextSegmentIndex(context.meetingId);

      // Submit to the new meeting pipeline
      // Pipeline workers handle: broadcast, translation, storage, summary
      await meetingPipeline.submitTranscript({
        meetingId: context.meetingId,
        segmentIndex,
        text: segment.text,
        speakerId: segment.speakerId,
        speakerName: segment.speakerName,
        timestamp: segment.timestamp instanceof Date
          ? segment.timestamp.toISOString()
          : new Date().toISOString(),
        isFinal: true,
        language: segment.language,
        confidence: segment.confidence,
      });

      logger.debug(`Submitted final transcript to pipeline: ${segment.speakerId}`, {
        meetingId: context.meetingId,
        segmentIndex,
        textLength: segment.text.length,
      });

      // Track for batch minutes generation
      this.pendingTranscripts.set(contextId, segment.text);
    } catch (err) {
      logger.error(`Failed to handle final transcript for: ${contextId}`, err);
    }
  }

  // Segment index counters per meeting
  private segmentCounters: Map<string, number> = new Map();

  private getNextSegmentIndex(meetingId: string): number {
    const current = this.segmentCounters.get(meetingId) || 0;
    const next = current + 1;
    this.segmentCounters.set(meetingId, next);
    return next;
  }

  /**
   * Cached org_id lookup — avoids DB query on every final transcript
   */
  private async getOrgId(meetingId: string): Promise<string | null> {
    const cached = this.orgIdCache.get(meetingId);
    if (cached) return cached;

    try {
      const meeting = await db('meetings').where({ id: meetingId }).select('organization_id').first();
      if (meeting?.organization_id) {
        this.orgIdCache.set(meetingId, meeting.organization_id);
        return meeting.organization_id;
      }
    } catch (err) {
      logger.error('Failed to fetch org_id for meeting', err);
    }
    return null;
  }

  /**
   * Handle language detection
   */
  private handleLanguageDetected(
    contextId: string,
    language: string,
    context: MeetingTranscriptContext
  ): void {
    try {
      const contextData = this.contexts.get(contextId);
      if (contextData) {
        contextData.currentLanguage = language;
      }

      logger.info(`Detected language for ${contextId}: ${language}`);

      // Optionally emit language detection event (for UI feedback)
      context.io.to(`meeting:${context.meetingId}`).emit('transcript:language-detected', {
        speakerId: context.participantId,
        language,
        timestamp: new Date(),
      });
    } catch (err) {
      logger.error(`Failed to handle language detection for: ${contextId}`, err);
    }
  }

  /**
   * Handle stream errors with fallback
   */
  private async handleStreamError(
    contextId: string,
    error: Error,
    context: MeetingTranscriptContext
  ): Promise<void> {
    logger.error(`Stream error for ${contextId}:`, error);

    // Notify client of error (non-blocking)
    context.io.to(`meeting:${context.meetingId}`).emit('transcript:error', {
      speakerId: context.participantId,
      error: error.message,
      timestamp: new Date(),
    });

    // Attempt to recover by recreating stream
    try {
      await this.reinitializeStream(contextId);
    } catch (recoveryErr) {
      logger.error(`Failed to recover stream for ${contextId}:`, recoveryErr);
    }
  }

  /**
   * Reinitialize a failed stream
   */
  private async reinitializeStream(contextId: string): Promise<boolean> {
    try {
      const context = this.contexts.get(contextId);
      if (!context) {
        return false;
      }

      // Close the old stream
      const [meetingId, participantId] = contextId.split(':');
      await liveKitAudioBridgeService.stopParticipantAudioStream(participantId);

      // Create new stream
      const newStreamId = await liveKitAudioBridgeService.startParticipantAudioStream(
        {
          meetingId: context.meetingId,
          participantId: context.participantId,
          participantName: context.participantName,
          roomName: context.meetingId,
        },
        {
          onInterimTranscript: (segment) =>
            this.handleInterimTranscript(contextId, segment, context),
          onFinalTranscript: (segment) =>
            this.handleFinalTranscript(contextId, segment, context),
          onLanguageDetected: (lang) => this.handleLanguageDetected(contextId, lang, context),
          onError: (err) => this.handleStreamError(contextId, err, context),
        }
      );

      logger.info(`Reinitialized stream for ${contextId}`, { newStreamId });
      return !!newStreamId;
    } catch (err) {
      logger.error(`Failed to reinitialize stream for ${contextId}:`, err);
      return false;
    }
  }

  /**
   * Stop transcript handling for a participant
   */
  async stopParticipantTranscript(contextId: string): Promise<boolean> {
    try {
      const context = this.contexts.get(contextId);
      if (!context) {
        return true; // Already stopped
      }

      // Stop audio stream
      await liveKitAudioBridgeService.stopParticipantAudioStream(context.participantId);

      // Cleanup
      this.contexts.delete(contextId);
      this.pendingTranscripts.delete(contextId);
      // Clean up debounce state
      const timer = this.interimTimers.get(contextId);
      if (timer) clearTimeout(timer);
      this.interimTimers.delete(contextId);
      this.interimBuffers.delete(contextId);

      logger.info(`Stopped transcript handling for: ${contextId}`);
      return true;
    } catch (err) {
      logger.error(`Failed to stop transcript handling for: ${contextId}`, err);
      return false;
    }
  }

  /**
   * Stop all transcripts for a meeting
   */
  async stopMeetingTranscripts(meetingId: string): Promise<void> {
    try {
      const contextIds = Array.from(this.contexts.keys()).filter((id) =>
        id.startsWith(`${meetingId}:`)
      );

      for (const contextId of contextIds) {
        await this.stopParticipantTranscript(contextId);
      }

      // Stop audio streams
      await liveKitAudioBridgeService.stopMeetingAudioStreams(meetingId);

      logger.info(`Stopped all transcripts for meeting: ${meetingId}`);
    } catch (err) {
      logger.error(`Failed to stop meeting transcripts: ${meetingId}`, err);
    }
  }

  /**
   * Get pending transcripts for a meeting (for minutes generation)
   */
  getPendingMeetingTranscripts(meetingId: string): string[] {
    const transcripts: string[] = [];
    for (const [contextId, text] of this.pendingTranscripts.entries()) {
      const [ctxMeetingId] = contextId.split(':');
      if (ctxMeetingId === meetingId) {
        transcripts.push(text);
      }
    }
    return transcripts;
  }

  /**
   * Clear pending transcripts after processing
   */
  clearPendingTranscripts(meetingId: string): void {
    const contextIds = Array.from(this.pendingTranscripts.keys()).filter((id) =>
      id.startsWith(`${meetingId}:`)
    );

    for (const contextId of contextIds) {
      this.pendingTranscripts.delete(contextId);
    }

    logger.debug(`Cleared pending transcripts for meeting: ${meetingId}`);
  }

  /**
   * Get active transcripts in the system
   */
  getActiveTranscriptCount(): number {
    return this.contexts.size;
  }

  /**
   * Get transcripts for a specific meeting
   */
  getActiveMeetingTranscriptCount(meetingId: string): number {
    let count = 0;
    for (const id of this.contexts.keys()) {
      if (id.startsWith(`${meetingId}:`)) {
        count++;
      }
    }
    return count;
  }

  /**
   * Get health status
   */
  getStatus(): {
    isHealthy: boolean;
    activeTranscripts: number;
    deepgramConfigured: boolean;
    liveKitConfigured: boolean;
  } {
    const deepgramStatus = deepgramRealtimeService.getStatus();
    const livekitStatus = liveKitAudioBridgeService.getStatus();

    return {
      isHealthy: deepgramStatus.isHealthy && livekitStatus.isHealthy,
      activeTranscripts: this.contexts.size,
      deepgramConfigured: deepgramStatus.configured,
      liveKitConfigured: livekitStatus.liveKitConfigured,
    };
  }
}

// Export singleton instance
export const meetingTranscriptHandler = new MeetingTranscriptHandler();
export type { MeetingTranscriptContext, BroadcastPayload };
