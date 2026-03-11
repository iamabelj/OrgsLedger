// ============================================================
// OrgsLedger API — Transcript Queue
// Redis queue for realtime transcription events
// 
// IMPORTANT: This module now delegates to the sharded queue-manager
// for horizontal scaling support (50k+ concurrent meetings).
// The legacy API is preserved for backward compatibility.
// ============================================================

import { logger } from '../logger';
import {
  queueManager,
  initializeQueueManager,
  SHARDED_QUEUE_TYPES,
  QUEUE_SHARD_COUNTS,
  getShardIndex,
  TranscriptEventData as ShardedTranscriptEventData,
  TranslationJobData as ShardedTranslationJobData,
  BroadcastEventData as ShardedBroadcastEventData,
  MinutesJobData as ShardedMinutesJobData,
} from './queue-manager';

// ── Re-export Types for Backward Compatibility ──────────────

export type TranscriptEventData = ShardedTranscriptEventData;
export type TranslationJobData = ShardedTranslationJobData;
export type BroadcastEventData = ShardedBroadcastEventData;
export type MinutesJobData = ShardedMinutesJobData;

// ── Legacy Queue Names (for reference only) ─────────────────
// Note: Actual queues now use sharded names like "transcript-jobs-shard-0"

export const QUEUE_NAMES = {
  TRANSCRIPT_EVENTS: 'transcript-events',
  TRANSLATION_JOBS: 'translation-jobs',
  BROADCAST_EVENTS: 'broadcast-events',
  MINUTES_GENERATION: 'minutes-generation',
} as const;

// ── Initialization ──────────────────────────────────────────

let initialized = false;

/**
 * Initialize transcript queues (delegates to sharded queue-manager)
 */
export async function initializeTranscriptQueues(): Promise<void> {
  if (initialized) return;
  
  await initializeQueueManager();
  
  initialized = true;
  logger.info('[TRANSCRIPT_QUEUE] Delegating to sharded queue-manager', {
    shardCounts: QUEUE_SHARD_COUNTS,
    queueTypes: Object.values(SHARDED_QUEUE_TYPES),
  });
}

// ── Job Submission Functions ────────────────────────────────
// These functions maintain the legacy API but route to sharded queues

/**
 * Submit a transcript event to the sharded queue
 * Deterministically routes to a shard based on meetingId
 */
export async function submitTranscriptEvent(
  data: TranscriptEventData
): Promise<string> {
  // Ensure queue manager is initialized
  if (!queueManager.isInitialized()) {
    await initializeQueueManager();
    initialized = true;
  }

  const job = await queueManager.submitTranscript(data, { priority: 1 });
  
  const shardIndex = getShardIndex(data.meetingId, SHARDED_QUEUE_TYPES.TRANSCRIPT_EVENTS);
  logger.debug('[TRANSCRIPT_QUEUE] Transcript event submitted to shard', {
    meetingId: data.meetingId,
    shard: shardIndex,
    jobId: job.id,
  });

  return job.id!;
}

/**
 * Submit a translation job to the sharded queue
 * Deterministically routes to a shard based on meetingId
 */
export async function submitTranslationJob(
  data: TranslationJobData
): Promise<string> {
  if (!queueManager.isInitialized()) {
    await initializeQueueManager();
    initialized = true;
  }

  const job = await queueManager.submitTranslation(data);
  
  const shardIndex = getShardIndex(data.meetingId, SHARDED_QUEUE_TYPES.TRANSLATION_JOBS);
  logger.debug('[TRANSCRIPT_QUEUE] Translation job submitted to shard', {
    meetingId: data.meetingId,
    shard: shardIndex,
    jobId: job.id,
  });

  return job.id!;
}

/**
 * Submit a broadcast event to the sharded queue
 * Deterministically routes to a shard based on meetingId
 */
export async function submitBroadcastEvent(
  data: BroadcastEventData
): Promise<string> {
  if (!queueManager.isInitialized()) {
    await initializeQueueManager();
    initialized = true;
  }

  const job = await queueManager.submitBroadcast(data);
  
  const shardIndex = getShardIndex(data.meetingId, SHARDED_QUEUE_TYPES.BROADCAST_EVENTS);
  logger.debug('[TRANSCRIPT_QUEUE] Broadcast event submitted to shard', {
    meetingId: data.meetingId,
    shard: shardIndex,
    jobId: job.id,
  });

  return job.id!;
}

/**
 * Submit a minutes generation job to the sharded queue
 * Deterministically routes to a shard based on meetingId
 */
export async function submitMinutesJob(
  data: MinutesJobData,
  options?: { delay?: number }
): Promise<string> {
  if (!queueManager.isInitialized()) {
    await initializeQueueManager();
    initialized = true;
  }

  const job = await queueManager.submitMinutes(data, options);
  
  const shardIndex = getShardIndex(data.meetingId, SHARDED_QUEUE_TYPES.MINUTES_GENERATION);
  logger.debug('[TRANSCRIPT_QUEUE] Minutes job submitted to shard', {
    meetingId: data.meetingId,
    shard: shardIndex,
    jobId: job.id,
  });

  return job.id!;
}

/**
 * Get queue accessors for external use
 * Each accessor requires meetingId for deterministic shard routing
 */
export function getTranscriptQueues(): {
  getTranscriptQueue: (meetingId: string) => ReturnType<typeof queueManager.getTranscriptQueue>;
  getTranslationQueue: (meetingId: string) => ReturnType<typeof queueManager.getTranslationQueue>;
  getBroadcastQueue: (meetingId: string) => ReturnType<typeof queueManager.getBroadcastQueue>;
  getMinutesQueue: (meetingId: string) => ReturnType<typeof queueManager.getMinutesQueue>;
} {
  return {
    getTranscriptQueue: (meetingId: string) => queueManager.getTranscriptQueue(meetingId),
    getTranslationQueue: (meetingId: string) => queueManager.getTranslationQueue(meetingId),
    getBroadcastQueue: (meetingId: string) => queueManager.getBroadcastQueue(meetingId),
    getMinutesQueue: (meetingId: string) => queueManager.getMinutesQueue(meetingId),
  };
}
