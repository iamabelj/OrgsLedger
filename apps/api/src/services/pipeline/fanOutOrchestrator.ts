// ============================================================
// OrgsLedger API — Pipeline Fan-Out Orchestrator
// Entry point for transcript events from Deepgram STT
// Fans out to: Broadcast, Translation, Storage, Summary
// Maintains separation: Real-time UX path ≠ AI processing path
// Target: 50-120ms caption latency, 50K+ concurrent meetings
// ============================================================

import { logger } from '../../logger';
import { getRedisClient } from '../../infrastructure/redisClient';
import {
  transcriptEventsQueue,
  TranscriptEventData,
  initializeTranscriptEventsQueue,
} from '../../queues/transcriptEvents.queue';
import {
  translationQueue,
  TranslationJobData,
  initializeTranslationQueue,
} from '../../queues/translation.queue';
import {
  summaryEventsQueue,
  SummaryEventData,
  initializeSummaryEventsQueue,
} from '../../queues/summaryEvents.queue';
import {
  broadcastQueueManager,
  BroadcastJobData,
} from '../../queues/broadcast.queue';
import {
  getMinutesQueueManager,
  MinutesJobData,
  submitMinutesJob,
  initializeMinutesQueue,
} from '../../queues/minutes.queue';
import { getTargetLanguages } from '../meetingState';

// ── Configuration ─────────────────────────────────────────────

const ENABLE_SUMMARY = process.env.ENABLE_INCREMENTAL_SUMMARY !== 'false';
const SUMMARY_SEGMENT_INTERVAL = parseInt(process.env.SUMMARY_SEGMENT_INTERVAL || '10', 10);

// ── Metrics Tracking ──────────────────────────────────────────

interface FanOutMetrics {
  transcriptsReceived: number;
  broadcastsQueued: number;
  translationsQueued: number;
  summariesQueued: number;
  minutesQueued: number;
  errors: number;
  avgFanOutLatencyMs: number;
  latencySum: number;
  latencyCount: number;
}

const metrics: FanOutMetrics = {
  transcriptsReceived: 0,
  broadcastsQueued: 0,
  translationsQueued: 0,
  summariesQueued: 0,
  minutesQueued: 0,
  errors: 0,
  avgFanOutLatencyMs: 0,
  latencySum: 0,
  latencyCount: 0,
};

// ── Meeting State Cache ───────────────────────────────────────

interface MeetingContext {
  segmentCount: number;
  lastSummarySegment: number;
  summaryVersion: number;
  startedAt: string;
}

const meetingContexts = new Map<string, MeetingContext>();

// ── Fan-Out Orchestrator Class ────────────────────────────────

class FanOutOrchestrator {
  private isInitialized = false;

  /**
   * Initialize all queues for fan-out
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      // Initialize all 5 queues in parallel
      await Promise.all([
        initializeTranscriptEventsQueue(),
        initializeTranslationQueue(),
        initializeSummaryEventsQueue(),
        broadcastQueueManager.initialize(),
        initializeMinutesQueue(),
      ]);

      this.isInitialized = true;

      logger.info('[FAN_OUT] Orchestrator initialized', {
        queues: 5,
        summaryEnabled: ENABLE_SUMMARY,
        summaryInterval: SUMMARY_SEGMENT_INTERVAL,
      });
    } catch (err) {
      logger.error('[FAN_OUT] Failed to initialize', err);
      throw err;
    }
  }

  /**
   * Submit transcript from Deepgram STT.
   * This is the MAIN ENTRY POINT for all transcripts.
   * Fans out to all downstream workers.
   */
  async submitTranscript(
    meetingId: string,
    organizationId: string,
    speakerId: string,
    speakerName: string,
    text: string,
    language: string,
    confidence: number,
    isFinal: boolean,
    startTime?: number,
    endTime?: number
  ): Promise<{
    eventId: string;
    fanOutLatencyMs: number;
  }> {
    const submitStart = Date.now();

    try {
      // Get or create meeting context
      let ctx = meetingContexts.get(meetingId);
      if (!ctx) {
        ctx = {
          segmentCount: 0,
          lastSummarySegment: 0,
          summaryVersion: 0,
          startedAt: new Date().toISOString(),
        };
        meetingContexts.set(meetingId, ctx);
      }

      ctx.segmentCount++;
      const segmentIndex = ctx.segmentCount;

      // Get target languages for translation
      const targetLanguages = await getTargetLanguages(meetingId, language);
      const requiresTranslation = targetLanguages.length > 0;
      const requiresSummary = ENABLE_SUMMARY && (
        isFinal &&
        (segmentIndex - ctx.lastSummarySegment >= SUMMARY_SEGMENT_INTERVAL)
      );

      // Build transcript event
      const transcriptEvent: TranscriptEventData = {
        meetingId,
        organizationId,
        speakerId,
        speakerName,
        text,
        language,
        confidence,
        timestamp: new Date().toISOString(),
        startTime: startTime || 0,
        endTime: endTime || 0,
        isFinal,
        segmentIndex,
        targetLanguages,
        requiresTranslation,
        requiresSummary,
      };

      // ═══════════════════════════════════════════════════════════
      // FAN-OUT: Submit to all queues in PARALLEL
      // Real-time path (broadcast) is NOT blocked by AI paths
      // ═══════════════════════════════════════════════════════════

      const fanOutPromises: Promise<unknown>[] = [];

      // 1. Transcript Events Queue (consumed by Broadcast Worker directly)
      //    This ensures captions appear in 50-120ms
      fanOutPromises.push(
        transcriptEventsQueue.submit(transcriptEvent)
      );

      // 2. Translation Queue (AI processing path - async)
      if (requiresTranslation) {
        const translationJob: TranslationJobData = {
          meetingId,
          organizationId,
          speakerId,
          speakerName,
          originalText: text,
          sourceLanguage: language,
          targetLanguages,
          timestamp: transcriptEvent.timestamp,
          segmentIndex,
          isFinal,
          priority: isFinal ? 'realtime' : 'async',
        };
        fanOutPromises.push(
          translationQueue.submit(translationJob).then(() => {
            metrics.translationsQueued++;
          })
        );
      }

      // 3. Summary Events Queue (AI processing path - batched)
      if (requiresSummary) {
        ctx.lastSummarySegment = segmentIndex;
        ctx.summaryVersion++;

        const summaryEvent: SummaryEventData = {
          meetingId,
          organizationId,
          text,
          speakerId,
          speakerName,
          timestamp: transcriptEvent.timestamp,
          segmentIndex,
          currentSummaryVersion: ctx.summaryVersion,
          totalSegments: ctx.segmentCount,
          priority: 'normal',
          forceUpdate: false,
        };
        fanOutPromises.push(
          summaryEventsQueue.submit(summaryEvent).then((result) => {
            if (result) metrics.summariesQueued++;
          })
        );
      }

      // Execute fan-out in parallel
      const results = await Promise.allSettled(fanOutPromises);

      // Extract event ID from first result (transcript queue)
      const eventId = results[0].status === 'fulfilled'
        ? (results[0].value as string)
        : `err-${Date.now()}`;

      // Track metrics
      const fanOutLatencyMs = Date.now() - submitStart;
      metrics.transcriptsReceived++;
      metrics.broadcastsQueued++; // Transcript events go to broadcast
      metrics.latencySum += fanOutLatencyMs;
      metrics.latencyCount++;
      metrics.avgFanOutLatencyMs = Math.round(
        metrics.latencySum / metrics.latencyCount
      );

      // Check for fan-out errors
      const errors = results.filter((r) => r.status === 'rejected');
      if (errors.length > 0) {
        metrics.errors += errors.length;
        logger.warn('[FAN_OUT] Some fan-out operations failed', {
          meetingId,
          errorCount: errors.length,
          errors: errors.map((e) =>
            e.status === 'rejected' ? (e.reason as Error).message : ''
          ),
        });
      }

      // Warn if fan-out is slow (target: <10ms)
      if (fanOutLatencyMs > 20) {
        logger.warn('[FAN_OUT] Fan-out latency high', {
          meetingId,
          latencyMs: fanOutLatencyMs,
          target: 20,
        });
      }

      logger.debug('[FAN_OUT] Transcript distributed', {
        eventId,
        meetingId,
        segmentIndex,
        fanOutLatencyMs,
        translation: requiresTranslation,
        summary: requiresSummary,
      });

      return { eventId, fanOutLatencyMs };
    } catch (err) {
      metrics.errors++;
      logger.error('[FAN_OUT] Failed to submit transcript', {
        meetingId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /**
   * Handle meeting end - trigger final minutes generation
   */
  async endMeeting(meetingId: string, organizationId: string): Promise<string> {
    try {
      // Submit minutes generation job
      const jobData: MinutesJobData = {
        meetingId,
        organizationId,
      };

      const jobId = await submitMinutesJob(jobData);
      metrics.minutesQueued++;

      // Clean up meeting context
      meetingContexts.delete(meetingId);

      logger.info('[FAN_OUT] Meeting ended, minutes queued', {
        meetingId,
        jobId,
      });

      return jobId;
    } catch (err) {
      logger.error('[FAN_OUT] Failed to queue minutes', {
        meetingId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /**
   * Broadcast translation result to clients (called by Translation Worker)
   */
  async broadcastTranslation(
    meetingId: string,
    speakerId: string,
    speakerName: string,
    originalText: string,
    sourceLanguage: string,
    translations: Record<string, string>,
    timestamp: string,
    isFinal: boolean
  ): Promise<void> {
    const broadcastData: BroadcastJobData = {
      meetingId,
      speakerId,
      speakerName,
      originalText,
      sourceLanguage,
      translations,
      timestamp,
      isFinal,
    };

    await broadcastQueueManager.add(broadcastData);
  }

  /**
   * Get orchestrator metrics
   */
  getMetrics(): FanOutMetrics {
    return { ...metrics };
  }

  /**
   * Get status of all queues
   */
  async getQueueStatus(): Promise<{
    transcriptEvents: Awaited<ReturnType<typeof transcriptEventsQueue.getStatus>>;
    translation: Awaited<ReturnType<typeof translationQueue.getStatus>>;
    summary: Awaited<ReturnType<typeof summaryEventsQueue.getStatus>>;
    broadcast: Awaited<ReturnType<typeof broadcastQueueManager.getStatus>>;
    minutes: { size: number; activeCount: number; waitingCount: number; failedCount: number; delayedCount: number };
  }> {
    const minutesManager = getMinutesQueueManager();

    const [transcriptEvents, translation, summary, broadcast, minutes] = await Promise.all([
      transcriptEventsQueue.getStatus(),
      translationQueue.getStatus(),
      summaryEventsQueue.getStatus(),
      broadcastQueueManager.getStatus(),
      minutesManager.getStatus(),
    ]);

    return { transcriptEvents, translation, summary, broadcast, minutes };
  }

  /**
   * Check if orchestrator is healthy
   */
  isHealthy(): boolean {
    return this.isInitialized;
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    await Promise.all([
      transcriptEventsQueue.shutdown(),
      translationQueue.shutdown(),
      summaryEventsQueue.shutdown(),
    ]);
    logger.info('[FAN_OUT] Orchestrator shut down');
  }
}

// ── Singleton Export ──────────────────────────────────────────

export const fanOutOrchestrator = new FanOutOrchestrator();

export async function initializeFanOutOrchestrator(): Promise<void> {
  return fanOutOrchestrator.initialize();
}

export function getFanOutOrchestrator(): FanOutOrchestrator {
  return fanOutOrchestrator;
}
