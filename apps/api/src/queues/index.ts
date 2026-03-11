// ============================================================
// OrgsLedger API — Queues Module Index
// Export all queue-related functionality
//
// Primary system: Sharded Queue Manager (50k+ concurrent meetings)
// Legacy API preserved for backward compatibility
// ============================================================

// ── Sharded Queue Manager (Primary) ─────────────────────────
export {
  // Singleton instance
  queueManager,
  
  // Initialization & Lifecycle
  initializeQueueManager,
  shutdownQueueManager,
  
  // Configuration Constants
  QUEUE_SHARDS,
  QUEUE_SHARD_COUNTS,
  SHARDED_QUEUE_TYPES,
  DLQ_NAMES,
  
  // Shard Routing Utilities
  getShardIndex,
  getShardQueueName,
  getShardCount,
  getDLQName,
  
  // Queue Factory Methods (requires meetingId for routing)
  getQueue,
  getTranscriptQueue,
  getTranslationQueue,
  getBroadcastQueue,
  getMinutesQueue,
  
  // Worker Discovery (all shards)
  getAllQueues,
  
  // Job Submission (Primary API)
  submitTranscript,
  submitTranslation,
  submitBroadcast,
  submitMinutes,
  
  // Dead Letter Queue Functions
  getDLQ,
  moveToDeadLetter,
  getDLQStats,
  replayDLQJobs,
  
  // Monitoring & Stats
  getShardStats,
} from './queue-manager';

// ── Type Exports ────────────────────────────────────────────
export type {
  ShardedQueueType,
  TranscriptEventData,
  TranslationJobData,
  BroadcastEventData,
  MinutesJobData,
  ShardStats,
  QueueManagerStats,
  ShardDistribution,
  Queue,
  Job,
} from './queue-manager';

// ── Legacy Queue Exports (for backward compatibility) ───────
// These delegate to the sharded queue manager internally
export {
  QUEUE_NAMES,
  initializeTranscriptQueues,
  submitTranscriptEvent,
  submitTranslationJob,
  submitBroadcastEvent,
  submitMinutesJob,
  getTranscriptQueues,
} from './transcript.queue';

// ── DLQ Module ──────────────────────────────────────────────
export {
  initializeDeadLetterQueue,
  sendToDeadLetterQueue,
  getDeadLetterJobs,
  replayDeadLetterJob,
  getDeadLetterQueueManager,
} from './dlq.queue';

export type { DeadLetterJobData } from './dlq.queue';
