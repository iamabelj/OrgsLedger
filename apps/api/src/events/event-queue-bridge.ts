// ============================================================
// OrgsLedger API — Event Queue Bridge
// Durable event persistence before queue submission
// ============================================================
//
// Architecture:
//   1. Events are FIRST persisted to PostgreSQL (event store)
//   2. THEN submitted to BullMQ queues
//   3. If queue submission fails, event remains unprocessed
//   4. Event replay worker will retry failed submissions
//
// This guarantees NO event is ever lost due to:
//   - Redis crashes
//   - Network partitions
//   - Queue manager failures
//   - Server restarts
//
// ============================================================

import { Job } from 'bullmq';
import * as client from 'prom-client';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../logger';
import {
  eventStore,
  MeetingEventType,
  StoreEventInput,
  initializeEventStore,
} from './event-store';
import {
  queueManager,
  initializeQueueManager,
  TranscriptEventData,
  TranslationJobData,
  BroadcastEventData,
  MinutesJobData,
  SHARDED_QUEUE_TYPES,
} from '../queues/queue-manager';

// ── Types ───────────────────────────────────────────────────

export interface DurableEventResult {
  eventId: string;
  jobId?: string;
  queued: boolean;
  error?: string;
}

export interface TranscriptEventInput extends TranscriptEventData {
  eventId?: string;
}

export interface TranslationEventInput extends TranslationJobData {
  eventId?: string;
}

export interface BroadcastEventInput extends BroadcastEventData {
  eventId?: string;
}

export interface MinutesEventInput extends MinutesJobData {
  eventId?: string;
}

// ── Prometheus Metrics ──────────────────────────────────────

const bridgeSubmitTotal = new client.Counter({
  name: 'orgsledger_event_bridge_submit_total',
  help: 'Total events submitted through the event bridge',
  labelNames: ['event_type', 'status'] as const,
});

const bridgeQueueFailures = new client.Counter({
  name: 'orgsledger_event_bridge_queue_failures_total',
  help: 'Number of queue submission failures (events still persisted)',
  labelNames: ['event_type'] as const,
});

const bridgeLatency = new client.Histogram({
  name: 'orgsledger_event_bridge_latency_ms',
  help: 'End-to-end latency of the event bridge (store + queue)',
  labelNames: ['event_type'] as const,
  buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500],
});

// ── Event Queue Bridge Class ────────────────────────────────

class EventQueueBridge {
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  
  // ── Initialization ──────────────────────────────────────────
  
  /**
   * Initialize both the event store and queue manager.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    if (this.initPromise) {
      return this.initPromise;
    }
    
    this.initPromise = this._initialize();
    return this.initPromise;
  }
  
  private async _initialize(): Promise<void> {
    try {
      // Initialize both stores in parallel
      await Promise.all([
        initializeEventStore(),
        initializeQueueManager(),
      ]);
      
      this.initialized = true;
      logger.info('[EVENT_BRIDGE] Initialized successfully');
    } catch (err) {
      logger.error('[EVENT_BRIDGE] Initialization failed', { error: err });
      this.initPromise = null;
      throw err;
    }
  }
  
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }
  
  // ── Transcript Events ───────────────────────────────────────
  
  /**
   * Durably submit a transcript event.
   * 1. Persist to event store
   * 2. Submit to BullMQ queue
   * 3. Mark processed on queue success
   */
  async submitTranscript(input: TranscriptEventInput): Promise<DurableEventResult> {
    const startTime = Date.now();
    const eventId = input.eventId || uuidv4();
    
    try {
      await this.ensureInitialized();
      
      // Step 1: Persist to event store
      const storeInput: StoreEventInput = {
        eventId,
        meetingId: input.meetingId,
        eventType: 'transcript_received',
        payload: {
          speaker: input.speaker,
          speakerId: input.speakerId,
          text: input.text,
          timestamp: input.timestamp,
          isFinal: input.isFinal,
          confidence: input.confidence,
          language: input.language,
        },
      };
      
      await eventStore.storeEvent(storeInput);
      
      // Step 2: Submit to BullMQ queue
      let job: Job<TranscriptEventData> | null = null;
      let queued = false;
      let error: string | undefined;
      
      try {
        const queueData: TranscriptEventData = {
          meetingId: input.meetingId,
          speaker: input.speaker,
          speakerId: input.speakerId,
          text: input.text,
          timestamp: input.timestamp,
          isFinal: input.isFinal,
          confidence: input.confidence,
          language: input.language,
        };
        
        job = await queueManager.submitTranscript(queueData, { priority: 1 });
        queued = true;
        
        // Step 3: Mark as processed since queue accepted it
        await eventStore.markEventProcessed(eventId);
        
        bridgeSubmitTotal.inc({ event_type: 'transcript', status: 'success' });
      } catch (queueErr: any) {
        // Queue failed but event is persisted — replay worker will retry
        error = queueErr.message || 'Queue submission failed';
        queued = false;
        
        bridgeQueueFailures.inc({ event_type: 'transcript' });
        bridgeSubmitTotal.inc({ event_type: 'transcript', status: 'queue_failed' });
        
        logger.warn('[EVENT_BRIDGE] Queue submission failed, event persisted for replay', {
          eventId,
          eventType: 'transcript',
          meetingId: input.meetingId,
          error,
        });
      }
      
      const duration = Date.now() - startTime;
      bridgeLatency.observe({ event_type: 'transcript' }, duration);
      
      return {
        eventId,
        jobId: job?.id,
        queued,
        error,
      };
    } catch (err: any) {
      const duration = Date.now() - startTime;
      bridgeLatency.observe({ event_type: 'transcript' }, duration);
      bridgeSubmitTotal.inc({ event_type: 'transcript', status: 'error' });
      
      logger.error('[EVENT_BRIDGE] Failed to submit transcript event', {
        meetingId: input.meetingId,
        error: err.message,
      });
      
      throw err;
    }
  }
  
  // ── Translation Events ──────────────────────────────────────
  
  /**
   * Durably submit a translation job.
   */
  async submitTranslation(input: TranslationEventInput): Promise<DurableEventResult> {
    const startTime = Date.now();
    const eventId = input.eventId || uuidv4();
    
    try {
      await this.ensureInitialized();
      
      // Step 1: Persist to event store
      const storeInput: StoreEventInput = {
        eventId,
        meetingId: input.meetingId,
        eventType: 'translation_completed',
        payload: {
          speaker: input.speaker,
          speakerId: input.speakerId,
          text: input.text,
          timestamp: input.timestamp,
          sourceLanguage: input.sourceLanguage,
          targetLanguages: input.targetLanguages,
        },
      };
      
      await eventStore.storeEvent(storeInput);
      
      // Step 2: Submit to BullMQ queue
      let job: Job<TranslationJobData> | null = null;
      let queued = false;
      let error: string | undefined;
      
      try {
        const queueData: TranslationJobData = {
          meetingId: input.meetingId,
          speaker: input.speaker,
          speakerId: input.speakerId,
          text: input.text,
          timestamp: input.timestamp,
          sourceLanguage: input.sourceLanguage,
          targetLanguages: input.targetLanguages,
        };
        
        job = await queueManager.submitTranslation(queueData);
        queued = true;
        
        await eventStore.markEventProcessed(eventId);
        
        bridgeSubmitTotal.inc({ event_type: 'translation', status: 'success' });
      } catch (queueErr: any) {
        error = queueErr.message || 'Queue submission failed';
        queued = false;
        
        bridgeQueueFailures.inc({ event_type: 'translation' });
        bridgeSubmitTotal.inc({ event_type: 'translation', status: 'queue_failed' });
        
        logger.warn('[EVENT_BRIDGE] Queue submission failed, event persisted for replay', {
          eventId,
          eventType: 'translation',
          meetingId: input.meetingId,
          error,
        });
      }
      
      const duration = Date.now() - startTime;
      bridgeLatency.observe({ event_type: 'translation' }, duration);
      
      return { eventId, jobId: job?.id, queued, error };
    } catch (err: any) {
      const duration = Date.now() - startTime;
      bridgeLatency.observe({ event_type: 'translation' }, duration);
      bridgeSubmitTotal.inc({ event_type: 'translation', status: 'error' });
      
      logger.error('[EVENT_BRIDGE] Failed to submit translation event', {
        meetingId: input.meetingId,
        error: err.message,
      });
      
      throw err;
    }
  }
  
  // ── Broadcast Events ────────────────────────────────────────
  
  /**
   * Durably submit a broadcast event.
   */
  async submitBroadcast(input: BroadcastEventInput): Promise<DurableEventResult> {
    const startTime = Date.now();
    const eventId = input.eventId || uuidv4();
    
    try {
      await this.ensureInitialized();
      
      // Step 1: Persist to event store
      const storeInput: StoreEventInput = {
        eventId,
        meetingId: input.meetingId,
        eventType: 'caption_broadcast',
        payload: {
          eventType: input.eventType,
          data: input.data,
        },
      };
      
      await eventStore.storeEvent(storeInput);
      
      // Step 2: Submit to BullMQ queue
      let job: Job<BroadcastEventData> | null = null;
      let queued = false;
      let error: string | undefined;
      
      try {
        const queueData: BroadcastEventData = {
          meetingId: input.meetingId,
          eventType: input.eventType,
          data: input.data,
        };
        
        job = await queueManager.submitBroadcast(queueData);
        queued = true;
        
        await eventStore.markEventProcessed(eventId);
        
        bridgeSubmitTotal.inc({ event_type: 'broadcast', status: 'success' });
      } catch (queueErr: any) {
        error = queueErr.message || 'Queue submission failed';
        queued = false;
        
        bridgeQueueFailures.inc({ event_type: 'broadcast' });
        bridgeSubmitTotal.inc({ event_type: 'broadcast', status: 'queue_failed' });
        
        logger.warn('[EVENT_BRIDGE] Queue submission failed, event persisted for replay', {
          eventId,
          eventType: 'broadcast',
          meetingId: input.meetingId,
          error,
        });
      }
      
      const duration = Date.now() - startTime;
      bridgeLatency.observe({ event_type: 'broadcast' }, duration);
      
      return { eventId, jobId: job?.id, queued, error };
    } catch (err: any) {
      const duration = Date.now() - startTime;
      bridgeLatency.observe({ event_type: 'broadcast' }, duration);
      bridgeSubmitTotal.inc({ event_type: 'broadcast', status: 'error' });
      
      logger.error('[EVENT_BRIDGE] Failed to submit broadcast event', {
        meetingId: input.meetingId,
        error: err.message,
      });
      
      throw err;
    }
  }
  
  // ── Minutes Events ──────────────────────────────────────────
  
  /**
   * Durably submit a minutes generation job.
   */
  async submitMinutes(input: MinutesEventInput): Promise<DurableEventResult> {
    const startTime = Date.now();
    const eventId = input.eventId || uuidv4();
    
    try {
      await this.ensureInitialized();
      
      // Step 1: Persist to event store
      const storeInput: StoreEventInput = {
        eventId,
        meetingId: input.meetingId,
        eventType: 'minutes_generated',
        payload: {
          organizationId: input.organizationId,
        },
      };
      
      await eventStore.storeEvent(storeInput);
      
      // Step 2: Submit to BullMQ queue
      let job: Job<MinutesJobData> | null = null;
      let queued = false;
      let error: string | undefined;
      
      try {
        const queueData: MinutesJobData = {
          meetingId: input.meetingId,
          organizationId: input.organizationId,
        };
        
        job = await queueManager.submitMinutes(queueData);
        queued = true;
        
        await eventStore.markEventProcessed(eventId);
        
        bridgeSubmitTotal.inc({ event_type: 'minutes', status: 'success' });
      } catch (queueErr: any) {
        error = queueErr.message || 'Queue submission failed';
        queued = false;
        
        bridgeQueueFailures.inc({ event_type: 'minutes' });
        bridgeSubmitTotal.inc({ event_type: 'minutes', status: 'queue_failed' });
        
        logger.warn('[EVENT_BRIDGE] Queue submission failed, event persisted for replay', {
          eventId,
          eventType: 'minutes',
          meetingId: input.meetingId,
          error,
        });
      }
      
      const duration = Date.now() - startTime;
      bridgeLatency.observe({ event_type: 'minutes' }, duration);
      
      return { eventId, jobId: job?.id, queued, error };
    } catch (err: any) {
      const duration = Date.now() - startTime;
      bridgeLatency.observe({ event_type: 'minutes' }, duration);
      bridgeSubmitTotal.inc({ event_type: 'minutes', status: 'error' });
      
      logger.error('[EVENT_BRIDGE] Failed to submit minutes event', {
        meetingId: input.meetingId,
        error: err.message,
      });
      
      throw err;
    }
  }
  
  // ── Meeting Ended Event ─────────────────────────────────────
  
  /**
   * Store a meeting ended event (triggers minutes generation).
   */
  async submitMeetingEnded(
    meetingId: string,
    organizationId: string,
    eventId?: string
  ): Promise<DurableEventResult> {
    const startTime = Date.now();
    const finalEventId = eventId || uuidv4();
    
    try {
      await this.ensureInitialized();
      
      // Store the meeting ended event
      await eventStore.storeEvent({
        eventId: finalEventId,
        meetingId,
        eventType: 'meeting_ended',
        payload: { organizationId },
      });
      
      // Submit minutes generation job
      const result = await this.submitMinutes({
        meetingId,
        organizationId,
        eventId: `minutes-${finalEventId}`,
      });
      
      const duration = Date.now() - startTime;
      bridgeLatency.observe({ event_type: 'meeting_ended' }, duration);
      bridgeSubmitTotal.inc({ event_type: 'meeting_ended', status: 'success' });
      
      // Mark meeting_ended as processed
      await eventStore.markEventProcessed(finalEventId);
      
      return {
        eventId: finalEventId,
        jobId: result.jobId,
        queued: result.queued,
        error: result.error,
      };
    } catch (err: any) {
      const duration = Date.now() - startTime;
      bridgeLatency.observe({ event_type: 'meeting_ended' }, duration);
      bridgeSubmitTotal.inc({ event_type: 'meeting_ended', status: 'error' });
      
      logger.error('[EVENT_BRIDGE] Failed to submit meeting ended event', {
        meetingId,
        error: err.message,
      });
      
      throw err;
    }
  }
  
  // ── Replay Support ──────────────────────────────────────────
  
  /**
   * Replay a single event from the event store to the queue.
   * Used by the replay worker.
   */
  async replayEvent(eventId: string): Promise<DurableEventResult> {
    try {
      await this.ensureInitialized();
      
      const event = await eventStore.getEvent(eventId);
      
      if (!event) {
        throw new Error(`Event not found: ${eventId}`);
      }
      
      if (event.processed) {
        return { eventId, queued: false, error: 'Already processed' };
      }
      
      // Replay based on event type
      switch (event.eventType) {
        case 'transcript_received':
          return this.replayTranscript(event);
        
        case 'translation_completed':
          return this.replayTranslation(event);
        
        case 'caption_broadcast':
          return this.replayBroadcast(event);
        
        case 'minutes_generated':
          return this.replayMinutes(event);
        
        case 'meeting_ended':
          // Meeting ended events trigger minutes generation
          return this.replayMinutes({
            ...event,
            eventType: 'minutes_generated',
          });
        
        default:
          logger.warn('[EVENT_BRIDGE] Unknown event type for replay', {
            eventId,
            eventType: event.eventType,
          });
          return { eventId, queued: false, error: `Unknown event type: ${event.eventType}` };
      }
    } catch (err: any) {
      logger.error('[EVENT_BRIDGE] Failed to replay event', {
        eventId,
        error: err.message,
      });
      throw err;
    }
  }
  
  private async replayTranscript(event: any): Promise<DurableEventResult> {
    const data: TranscriptEventData = {
      meetingId: event.meetingId,
      speaker: event.payload.speaker,
      speakerId: event.payload.speakerId,
      text: event.payload.text,
      timestamp: event.payload.timestamp,
      isFinal: event.payload.isFinal,
      confidence: event.payload.confidence,
      language: event.payload.language,
    };
    
    try {
      const job = await queueManager.submitTranscript(data);
      await eventStore.markEventProcessed(event.id);
      return { eventId: event.id, jobId: job.id, queued: true };
    } catch (err: any) {
      await eventStore.markEventFailed(event.id, err.message);
      return { eventId: event.id, queued: false, error: err.message };
    }
  }
  
  private async replayTranslation(event: any): Promise<DurableEventResult> {
    const data: TranslationJobData = {
      meetingId: event.meetingId,
      speaker: event.payload.speaker,
      speakerId: event.payload.speakerId,
      text: event.payload.text,
      timestamp: event.payload.timestamp,
      sourceLanguage: event.payload.sourceLanguage,
      targetLanguages: event.payload.targetLanguages,
    };
    
    try {
      const job = await queueManager.submitTranslation(data);
      await eventStore.markEventProcessed(event.id);
      return { eventId: event.id, jobId: job.id, queued: true };
    } catch (err: any) {
      await eventStore.markEventFailed(event.id, err.message);
      return { eventId: event.id, queued: false, error: err.message };
    }
  }
  
  private async replayBroadcast(event: any): Promise<DurableEventResult> {
    const data: BroadcastEventData = {
      meetingId: event.meetingId,
      eventType: event.payload.eventType,
      data: event.payload.data,
    };
    
    try {
      const job = await queueManager.submitBroadcast(data);
      await eventStore.markEventProcessed(event.id);
      return { eventId: event.id, jobId: job.id, queued: true };
    } catch (err: any) {
      await eventStore.markEventFailed(event.id, err.message);
      return { eventId: event.id, queued: false, error: err.message };
    }
  }
  
  private async replayMinutes(event: any): Promise<DurableEventResult> {
    const data: MinutesJobData = {
      meetingId: event.meetingId,
      organizationId: event.payload.organizationId,
    };
    
    try {
      const job = await queueManager.submitMinutes(data);
      await eventStore.markEventProcessed(event.id);
      return { eventId: event.id, jobId: job.id, queued: true };
    } catch (err: any) {
      await eventStore.markEventFailed(event.id, err.message);
      return { eventId: event.id, queued: false, error: err.message };
    }
  }
}

// ── Singleton Instance ──────────────────────────────────────

export const eventQueueBridge = new EventQueueBridge();

// ── Convenience Functions ───────────────────────────────────

export async function initializeEventBridge(): Promise<void> {
  return eventQueueBridge.initialize();
}

export async function durableSubmitTranscript(
  input: TranscriptEventInput
): Promise<DurableEventResult> {
  return eventQueueBridge.submitTranscript(input);
}

export async function durableSubmitTranslation(
  input: TranslationEventInput
): Promise<DurableEventResult> {
  return eventQueueBridge.submitTranslation(input);
}

export async function durableSubmitBroadcast(
  input: BroadcastEventInput
): Promise<DurableEventResult> {
  return eventQueueBridge.submitBroadcast(input);
}

export async function durableSubmitMinutes(
  input: MinutesEventInput
): Promise<DurableEventResult> {
  return eventQueueBridge.submitMinutes(input);
}

export async function durableSubmitMeetingEnded(
  meetingId: string,
  organizationId: string,
  eventId?: string
): Promise<DurableEventResult> {
  return eventQueueBridge.submitMeetingEnded(meetingId, organizationId, eventId);
}

export async function replayEvent(eventId: string): Promise<DurableEventResult> {
  return eventQueueBridge.replayEvent(eventId);
}

export default eventQueueBridge;
