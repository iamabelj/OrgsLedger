// ============================================================
// OrgsLedger API — AI Meeting Pipeline Orchestrator
// Central coordinator for audio → transcription → translation
// → summarization → minutes pipeline
// Supports horizontal scaling to 10K+ concurrent meetings
// ============================================================

import { logger } from '../../logger';
import { transcriptQueueManager, TranscriptJobData } from '../../queues/transcript.queue';
import { processingQueueManager, ProcessingJobData } from '../../queues/processing.queue';
import { getMinutesQueueManager, MinutesJobData, submitMinutesJob, initializeMinutesQueue } from '../../queues/minutes.queue';
import { broadcastQueueManager, BroadcastJobData } from '../../queues/broadcast.queue';
import { sendToDeadLetterQueue } from '../../queues/dlq.queue';
import { getMeetingState, setMeetingState, getTargetLanguages } from '../meetingState';
import { getRedisClient } from '../../infrastructure/redisClient';

// ── Types (inline to avoid circular imports) ──────────────────

interface ChunkedTranscript {
  index: number;
  text: string;
  tokenEstimate: number;
  startOffset: number;
  endOffset: number;
}

interface ChunkOptions {
  maxTokens?: number;
  overlap?: number;
  preserveSentences?: boolean;
}

// ── Inline metrics tracker (avoid circular imports) ───────────

const inlineMetrics = {
  transcripts: { count: 0, errors: 0 },
  translations: { count: 0, errors: 0 },
  minutes: { count: 0, errors: 0 },
  events: { count: 0 },
  activeMeetings: new Set<string>(),

  recordTranscript(meetingId: string, status: string, chunkCount?: number) {
    this.activeMeetings.add(meetingId);
    if (status === 'error') this.transcripts.errors++;
    else this.transcripts.count += chunkCount || 1;
  },

  recordTranslation(meetingId: string, status: string) {
    if (status === 'error') this.translations.errors++;
    else this.translations.count++;
  },

  recordMinutes(meetingId: string, status: string) {
    this.activeMeetings.delete(meetingId);
    if (status === 'error') this.minutes.errors++;
    else this.minutes.count++;
  },

  recordEvent(stage: string, meetingId: string) {
    this.events.count++;
    this.activeMeetings.add(meetingId);
  },

  recordError(stage: string, meetingId: string, error: string) {
    logger.warn(`[METRICS] Pipeline error at ${stage}`, { meetingId, error });
  },

  getMetrics() {
    return {
      transcripts: this.transcripts,
      translations: this.translations,
      minutes: this.minutes,
      activeMeetings: this.activeMeetings.size,
    };
  },
};

// ── Inline chunking (avoid circular imports) ──────────────────

function chunkTranscript(text: string, options: ChunkOptions = {}): ChunkedTranscript[] {
  const { maxTokens = 2000, overlap = 50, preserveSentences = true } = options;
  const maxChars = maxTokens * 4; // ~4 chars per token

  // Estimate tokens
  const totalTokens = Math.ceil(text.length / 4);
  if (totalTokens <= maxTokens) {
    return [{
      index: 0,
      text,
      tokenEstimate: totalTokens,
      startOffset: 0,
      endOffset: text.length,
    }];
  }

  const chunks: ChunkedTranscript[] = [];
  const sentences = preserveSentences
    ? text.split(/(?<=[.!?])\s+/)
    : [text];

  let currentChunk = '';
  let currentStartOffset = 0;
  let currentOffset = 0;

  for (const sentence of sentences) {
    const sentenceTokens = Math.ceil(sentence.length / 4);

    if (Math.ceil((currentChunk + sentence).length / 4) > maxTokens) {
      if (currentChunk.trim()) {
        chunks.push({
          index: chunks.length,
          text: currentChunk.trim(),
          tokenEstimate: Math.ceil(currentChunk.length / 4),
          startOffset: currentStartOffset,
          endOffset: currentOffset,
        });
      }

      currentChunk = sentence;
      currentStartOffset = currentOffset;
    } else {
      currentChunk += sentence;
    }

    currentOffset += sentence.length;
  }

  if (currentChunk.trim()) {
    chunks.push({
      index: chunks.length,
      text: currentChunk.trim(),
      tokenEstimate: Math.ceil(currentChunk.length / 4),
      startOffset: currentStartOffset,
      endOffset: text.length,
    });
  }

  return chunks;
}

// ── Pipeline Stage Definitions ────────────────────────────────

export type PipelineStage =
  | 'audio_received'
  | 'transcription_started'
  | 'transcription_completed'
  | 'translation_started'
  | 'translation_completed'
  | 'broadcast_started'
  | 'broadcast_completed'
  | 'minutes_requested'
  | 'minutes_completed'
  | 'failed';

export interface PipelineEvent {
  meetingId: string;
  stage: PipelineStage;
  timestamp: Date;
  data?: Record<string, any>;
  error?: string;
}

export interface TranscriptInput {
  meetingId: string;
  speakerId: string;
  speakerName: string;
  text: string;
  language: string;
  confidence: number;
  isFinal: boolean;
  organizationId?: string;
}

export interface TranslationOutput {
  meetingId: string;
  speakerId: string;
  speakerName: string;
  originalText: string;
  sourceLanguage: string;
  translations: Record<string, string>;
  timestamp: string;
  isFinal: boolean;
}

// ── Redis Pub/Sub Channels ────────────────────────────────────

const PIPELINE_EVENTS_CHANNEL = 'pipeline:events';
const PIPELINE_METRICS_CHANNEL = 'pipeline:metrics';

// ── Pipeline Orchestrator ─────────────────────────────────────

class PipelineOrchestrator {
  private isInitialized = false;

  /**
   * Initialize the pipeline orchestrator.
   * Sets up event listeners and prepares queues.
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      // Ensure all queues are initialized
      await Promise.all([
        transcriptQueueManager.initialize(),
        processingQueueManager.initialize(),
        initializeMinutesQueue(),
        broadcastQueueManager.initialize(),
      ]);

      // Subscribe to pipeline events for metrics/monitoring
      const redis = await getRedisClient();
      const subscriber = redis.duplicate();
      await subscriber.subscribe(PIPELINE_EVENTS_CHANNEL);

      subscriber.on('message', (_channel: string, message: string) => {
        try {
          const event: PipelineEvent = JSON.parse(message);
          this.handlePipelineEvent(event);
        } catch (err) {
          logger.warn('[ORCHESTRATOR] Failed to parse pipeline event', err);
        }
      });

      this.isInitialized = true;
      logger.info('[ORCHESTRATOR] Pipeline orchestrator initialized');
    } catch (err) {
      logger.error('[ORCHESTRATOR] Failed to initialize', err);
      throw err;
    }
  }

  /**
   * Submit a transcript for processing through the pipeline.
   * Entry point for real-time transcription → translation flow.
   */
  async submitTranscript(input: TranscriptInput): Promise<string> {
    const startTime = Date.now();

    try {
      // Validate input
      if (!input.text || input.text.trim().length === 0) {
        throw new Error('Empty transcript text');
      }

      // Get target languages for this meeting
      const targetLanguages = await getTargetLanguages(
        input.meetingId,
        input.language
      );

      if (targetLanguages.length === 0) {
        // No translation needed — just broadcast original
        const jobId = await this.submitBroadcastOnly(input);
        inlineMetrics.recordTranscript(input.meetingId, 'skip_no_targets');
        return jobId;
      }

      // Check if text needs chunking (for very long utterances)
      const textLength = input.text.length;
      const tokenEstimate = Math.ceil(textLength / 4); // ~4 chars per token

      if (tokenEstimate > 2000) {
        // Large transcript — chunk it
        return this.submitChunkedTranscript(input, targetLanguages);
      }

      // Submit to processing queue with target languages
      const jobData: ProcessingJobData = {
        meetingId: input.meetingId,
        speakerId: input.speakerId,
        originalText: input.text,
        sourceLanguage: input.language,
        targetLanguages,
        isFinal: input.isFinal,
        organizationId: input.organizationId,
      };

      const jobId = await processingQueueManager.add(jobData);

      // Publish event
      await this.publishEvent({
        meetingId: input.meetingId,
        stage: 'transcription_completed',
        timestamp: new Date(),
        data: {
          jobId,
          textLength,
          targetLanguages: targetLanguages.length,
          latencyMs: Date.now() - startTime,
        },
      });

      inlineMetrics.recordTranscript(input.meetingId, 'submitted');
      logger.debug('[ORCHESTRATOR] Transcript submitted', {
        jobId,
        meetingId: input.meetingId,
        textLength,
        targets: targetLanguages.length,
      });

      return jobId;
    } catch (err) {
      inlineMetrics.recordTranscript(input.meetingId, 'error');
      logger.error('[ORCHESTRATOR] Failed to submit transcript', err);

      // Send to DLQ
      await sendToDeadLetterQueue(
        'pipeline-orchestrator',
        `transcript:${input.meetingId}:${Date.now()}`,
        input,
        err instanceof Error ? err.message : String(err),
        0,
        1
      );

      throw err;
    }
  }

  /**
   * Submit chunked transcript for large texts.
   * Splits text into manageable chunks and processes in parallel.
   */
  private async submitChunkedTranscript(
    input: TranscriptInput,
    targetLanguages: string[]
  ): Promise<string> {
    const chunks = chunkTranscript(input.text, {
      maxTokens: 2000,
      overlap: 50, // Character overlap between chunks
      preserveSentences: true,
    });

    logger.info('[ORCHESTRATOR] Chunking large transcript', {
      meetingId: input.meetingId,
      originalLength: input.text.length,
      chunkCount: chunks.length,
    });

    const jobs: ProcessingJobData[] = chunks.map((chunk, index) => ({
      meetingId: input.meetingId,
      speakerId: input.speakerId,
      originalText: chunk.text,
      sourceLanguage: input.language,
      targetLanguages,
      isFinal: input.isFinal && index === chunks.length - 1, // Only last chunk is final
      organizationId: input.organizationId,
      chunkIndex: index,
    }));

    const jobIds = await processingQueueManager.addBulk(jobs);

    inlineMetrics.recordTranscript(input.meetingId, 'chunked', chunks.length);

    return jobIds[0]; // Return first job ID as reference
  }

  /**
   * Submit broadcast-only job (no translation needed).
   */
  private async submitBroadcastOnly(input: TranscriptInput): Promise<string> {
    const broadcastData: BroadcastJobData = {
      meetingId: input.meetingId,
      speakerId: input.speakerId,
      speakerName: input.speakerName,
      originalText: input.text,
      sourceLanguage: input.language,
      translations: { [input.language]: input.text },
      timestamp: new Date().toISOString(),
      isFinal: input.isFinal,
    };

    await broadcastQueueManager.add(broadcastData);

    return `broadcast:${input.meetingId}:${Date.now()}`;
  }

  /**
   * Request AI minutes generation for a meeting.
   * Queues the meeting for async processing.
   */
  async requestMinutes(meetingId: string, organizationId: string): Promise<string> {
    const startTime = Date.now();

    try {
      const jobData: MinutesJobData = {
        meetingId,
        organizationId,
      };

      const jobId = await submitMinutesJob(jobData);

      await this.publishEvent({
        meetingId,
        stage: 'minutes_requested',
        timestamp: new Date(),
        data: { jobId, organizationId },
      });

      inlineMetrics.recordMinutes(meetingId, 'requested');

      logger.info('[ORCHESTRATOR] Minutes request queued', {
        jobId,
        meetingId,
        organizationId,
        latencyMs: Date.now() - startTime,
      });

      return jobId;
    } catch (err) {
      inlineMetrics.recordMinutes(meetingId, 'error');
      logger.error('[ORCHESTRATOR] Failed to queue minutes request', err);
      throw err;
    }
  }

  /**
   * Handle translation completion and enqueue broadcast.
   * Called by translation worker after successful translation.
   */
  async handleTranslationComplete(output: TranslationOutput): Promise<void> {
    const startTime = Date.now();

    try {
      const broadcastData: BroadcastJobData = {
        meetingId: output.meetingId,
        speakerId: output.speakerId,
        speakerName: output.speakerName,
        originalText: output.originalText,
        sourceLanguage: output.sourceLanguage,
        translations: output.translations,
        timestamp: output.timestamp,
        isFinal: output.isFinal,
      };

      await broadcastQueueManager.add(broadcastData);

      await this.publishEvent({
        meetingId: output.meetingId,
        stage: 'translation_completed',
        timestamp: new Date(),
        data: {
          languageCount: Object.keys(output.translations).length,
          isFinal: output.isFinal,
          latencyMs: Date.now() - startTime,
        },
      });

      inlineMetrics.recordTranslation(output.meetingId, 'completed');
    } catch (err) {
      inlineMetrics.recordTranslation(output.meetingId, 'error');
      logger.error('[ORCHESTRATOR] Failed to handle translation completion', err);
      throw err;
    }
  }

  /**
   * Mark meeting as active in pipeline.
   */
  async startMeeting(
    meetingId: string,
    orgId: string,
    title?: string
  ): Promise<void> {
    await setMeetingState(meetingId, {
      status: 'active',
      orgId,
      title,
      participantCount: 0,
      createdAt: new Date().toISOString(),
    });

    await this.publishEvent({
      meetingId,
      stage: 'audio_received',
      timestamp: new Date(),
      data: { orgId, title },
    });

    logger.info('[ORCHESTRATOR] Meeting started in pipeline', {
      meetingId,
      orgId,
    });
  }

  /**
   * End meeting and trigger minutes generation if enabled.
   */
  async endMeeting(
    meetingId: string,
    organizationId: string,
    autoGenerateMinutes = true
  ): Promise<void> {
    const state = await getMeetingState(meetingId);
    if (state) {
      await setMeetingState(meetingId, {
        ...state,
        status: 'ended',
      });
    }

    if (autoGenerateMinutes) {
      await this.requestMinutes(meetingId, organizationId);
    }

    logger.info('[ORCHESTRATOR] Meeting ended', {
      meetingId,
      organizationId,
      autoMinutes: autoGenerateMinutes,
    });
  }

  /**
   * Publish pipeline event for monitoring/metrics.
   */
  private async publishEvent(event: PipelineEvent): Promise<void> {
    try {
      const redis = await getRedisClient();
      await redis.publish(PIPELINE_EVENTS_CHANNEL, JSON.stringify(event));
    } catch (err) {
      logger.debug('[ORCHESTRATOR] Failed to publish event', err);
    }
  }

  /**
   * Handle incoming pipeline events for metrics.
   */
  private handlePipelineEvent(event: PipelineEvent): void {
    inlineMetrics.recordEvent(event.stage, event.meetingId);

    if (event.error) {
      inlineMetrics.recordError(event.stage, event.meetingId, event.error);
    }
  }

  /**
   * Get pipeline status across all queues.
   */
  async getStatus(): Promise<{
    healthy: boolean;
    queues: {
      transcript: Awaited<ReturnType<typeof transcriptQueueManager.getStatus>>;
      processing: Awaited<ReturnType<typeof processingQueueManager.getStatus>>;
      broadcast: Awaited<ReturnType<typeof broadcastQueueManager.getStatus>>;
      minutes: { size: number; activeCount: number; waitingCount: number; failedCount: number; delayedCount: number };
    };
    metrics: ReturnType<typeof inlineMetrics.getMetrics>;
  }> {
    const minutesManager = getMinutesQueueManager();
    const [transcript, processing, broadcast, minutes] = await Promise.all([
      transcriptQueueManager.getStatus(),
      processingQueueManager.getStatus(),
      broadcastQueueManager.getStatus(),
      minutesManager.getStatus(),
    ]);

    const healthy =
      transcript.failedCount < 100 &&
      processing.failedCount < 100 &&
      broadcast.failedCount < 100 &&
      minutes.failedCount < 10;

    return {
      healthy,
      queues: { transcript, processing, broadcast, minutes },
      metrics: inlineMetrics.getMetrics(),
    };
  }
}

// Export singleton instance
export const pipelineOrchestrator = new PipelineOrchestrator();
