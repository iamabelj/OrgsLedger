// ============================================================
// OrgsLedger — Meeting Pipeline
// Main entry point and orchestrator
// ============================================================

export { TranscriptSegment, TranslationResult, MeetingMinutes, ActionItem, Attendee, IncrementalSummary, MeetingState, BroadcastPayload, TranscriptJobData, TranslationJobData, StorageJobData, SummaryJobData, MinutesJobData } from './types';
export { transcriptStream, TranscriptStream } from './transcriptStream';
export { meetingStateManager, MeetingStateManager } from './meetingState';
export { broadcastWorkerManager } from './workers/broadcastWorker';
export { translationWorkerManager } from './workers/translationWorker';
export { storageWorkerManager } from './workers/storageWorker';
export { summaryWorkerManager } from './workers/summaryWorker';
export { minutesWorkerManager } from './workers/minutesWorker';

import { transcriptStream } from './transcriptStream';
import { meetingStateManager } from './meetingState';
import { broadcastWorkerManager } from './workers/broadcastWorker';
import { translationWorkerManager } from './workers/translationWorker';
import { storageWorkerManager } from './workers/storageWorker';
import { summaryWorkerManager } from './workers/summaryWorker';
import { minutesWorkerManager } from './workers/minutesWorker';
import { logger } from '../logger';
import type { Server as SocketIOServer } from 'socket.io';
import { normalizeLang } from '../utils/langNormalize';

/**
 * Meeting Pipeline - Single entry point for all meeting transcript processing
 *
 * Architecture:
 *   Audio (LiveKit) → Deepgram STT → transcriptStream.submit()
 *                                          ↓
 *                              Redis Queue (transcript-events)
 *                                          ↓
 *                    ┌─────────────┬───────────────┬─────────────┐
 *                    ↓             ↓               ↓             ↓
 *              Broadcast     Translation      Storage       Summary
 *               Worker         Worker         Worker        Worker
 *                    ↓             ↓               ↓             ↓
 *              WebSocket      Redis Cache    PostgreSQL    Redis Cache
 *               Clients
 *
 *   Meeting End → minutesWorkerManager.triggerMinutesGeneration()
 *                              ↓
 *                        Minutes Worker
 *                              ↓
 *                    Final Minutes + Action Items
 */
class MeetingPipeline {
  private initialized = false;

  /**
   * Initialize all pipeline components
   * Call this once at server startup
   * @param ioServer - Socket.IO server for broadcasting (optional)
   */
  async initialize(ioServer?: SocketIOServer): Promise<void> {
    if (this.initialized) {
      logger.warn('[PIPELINE] Already initialized');
      return;
    }

    const startTime = Date.now();
    logger.info('[PIPELINE] Initializing meeting pipeline...');

    try {
      // Initialize transcript stream queues first (so submits are fast/consistent)
      await transcriptStream.initialize();

      // Initialize broadcast worker with Socket.IO server if provided
      if (ioServer) {
        await broadcastWorkerManager.initialize(ioServer);
      }

      // Initialize other components in parallel
      await Promise.all([
        translationWorkerManager.initialize(),
        storageWorkerManager.initialize(),
        summaryWorkerManager.initialize(),
        minutesWorkerManager.initialize(),
      ]);

      this.initialized = true;
      const duration = Date.now() - startTime;

      logger.info('[PIPELINE] Meeting pipeline initialized', {
        duration,
        components: [
          'transcriptStream',
          'broadcastWorker',
          'translationWorker',
          'storageWorker',
          'summaryWorker',
          'minutesWorker',
        ],
      });
    } catch (err) {
      logger.error('[PIPELINE] Failed to initialize', err);
      throw err;
    }
  }

  /**
   * Submit a transcript segment to the pipeline
   * This is the SINGLE ENTRY POINT for all transcripts
   */
  async submitTranscript(segment: {
    meetingId: string;
    organizationId?: string;
    segmentIndex: number;
    text: string;
    speakerId?: string;
    speakerName?: string;
    timestamp?: string;
    isFinal: boolean;
    language?: string;
    confidence?: number;
  }): Promise<void> {
    await transcriptStream.submit({
      meetingId: segment.meetingId,
      organizationId: segment.organizationId,
      segmentIndex: segment.segmentIndex,
      text: segment.text,
      speakerId: segment.speakerId,
      speakerName: segment.speakerName,
      timestamp: segment.timestamp || new Date().toISOString(),
      isFinal: segment.isFinal,
      language: normalizeLang(segment.language),
      confidence: segment.confidence,
    });
  }

  /**
   * Start tracking a new meeting
   */
  async startMeeting(
    meetingId: string,
    config?: {
      targetLanguages?: string[];
      enableTranslations?: boolean;
      enableSummary?: boolean;
    }
  ): Promise<void> {
    await meetingStateManager.startMeeting(meetingId, {
      targetLanguages: config?.targetLanguages || [],
      enableTranslations: config?.enableTranslations ?? true,
      enableSummary: config?.enableSummary ?? true,
    });

    logger.info('[PIPELINE] Meeting started', {
      meetingId,
      config,
    });
  }

  /**
   * End a meeting and trigger minutes generation
   */
  async endMeeting(meetingId: string): Promise<void> {
    // Mark meeting as ended
    await meetingStateManager.endMeeting(meetingId);

    // Trigger final minutes generation
    await minutesWorkerManager.triggerMinutesGeneration(meetingId);

    logger.info('[PIPELINE] Meeting ended, minutes generation triggered', {
      meetingId,
    });
  }

  /**
   * Get meeting minutes
   */
  async getMinutes(meetingId: string) {
    return minutesWorkerManager.getMinutes(meetingId);
  }

  /**
   * Get incremental summary
   */
  async getSummary(meetingId: string) {
    return summaryWorkerManager.getSummary(meetingId);
  }

  /**
   * Get pipeline status
   */
  async getStatus(): Promise<{
    initialized: boolean;
    queue: { waiting: number; active: number; completed: number; failed: number; delayed: number };
    workers: {
      broadcast: { running: boolean };
      translation: { running: boolean; cacheHits: number; cacheMisses: number };
      storage: { running: boolean };
      summary: { running: boolean; summaryCount: number };
      minutes: { running: boolean; minutesCount: number };
    };
  }> {
    return {
      initialized: this.initialized,
      queue: await transcriptStream.getStatus(),
      workers: {
        broadcast: broadcastWorkerManager.getStatus(),
        translation: translationWorkerManager.getStatus(),
        storage: storageWorkerManager.getStatus(),
        summary: summaryWorkerManager.getStatus(),
        minutes: minutesWorkerManager.getStatus(),
      },
    };
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    logger.info('[PIPELINE] Shutting down...');

    await Promise.all([
      broadcastWorkerManager.shutdown(),
      translationWorkerManager.shutdown(),
      storageWorkerManager.shutdown(),
      summaryWorkerManager.shutdown(),
      minutesWorkerManager.shutdown(),
      transcriptStream.shutdown(),
    ]);

    this.initialized = false;
    logger.info('[PIPELINE] Shut down complete');
  }
}

export const meetingPipeline = new MeetingPipeline();

// ============================================================
// Legacy Adapter Functions
// Provides backward compatibility with old queue API
// ============================================================

let segmentCounter = 0;

/**
 * Legacy adapter: submitProcessingJob
 * Maps old ProcessingJobData format to new TranscriptSegment format
 */
export async function submitProcessingJob(data: {
  meetingId: string;
  speakerId?: string;
  originalText: string;
  sourceLanguage: string;
  targetLanguages: string[];
  isFinal: boolean;
  organizationId?: string;
}): Promise<string> {
  const sourceLanguage = normalizeLang(data.sourceLanguage);
  const targetLanguages = (data.targetLanguages || []).map((l) => normalizeLang(l));

  // Ensure target languages are registered
  if (targetLanguages.length > 0) {
    await meetingStateManager.setParticipantLanguages(
      data.meetingId,
      targetLanguages
    );
  }

  const segmentIndex = ++segmentCounter;
  const segment = {
    meetingId: data.meetingId,
    organizationId: data.organizationId,
    speakerId: data.speakerId,
    text: data.originalText,
    language: sourceLanguage,
    isFinal: data.isFinal,
    timestamp: new Date().toISOString(),
    segmentIndex,
  };

  return transcriptStream.submit(segment);
}

/**
 * Legacy adapter: submitMinutesJob
 * Triggers minutes generation for a meeting
 */
export async function submitMinutesJob(data: {
  meetingId: string;
  organizationId?: string;
  generatePdf?: boolean;
}): Promise<string> {
  await minutesWorkerManager.triggerMinutesGeneration(data.meetingId);
  return `minutes:${data.meetingId}:${Date.now()}`;
}
