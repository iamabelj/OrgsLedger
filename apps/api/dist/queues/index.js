"use strict";
// ============================================================
// OrgsLedger API — Queues Module Index
// Export all queue-related functionality
//
// Primary system: Sharded Queue Manager (50k+ concurrent meetings)
// Legacy API preserved for backward compatibility
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDeadLetterQueueManager = exports.replayDeadLetterJob = exports.getDeadLetterJobs = exports.sendToDeadLetterQueue = exports.initializeDeadLetterQueue = exports.getTranscriptQueues = exports.submitMinutesJob = exports.submitBroadcastEvent = exports.submitTranslationJob = exports.submitTranscriptEvent = exports.initializeTranscriptQueues = exports.QUEUE_NAMES = exports.getShardStats = exports.replayDLQJobs = exports.getDLQStats = exports.moveToDeadLetter = exports.getDLQ = exports.submitMinutes = exports.submitBroadcast = exports.submitTranslation = exports.submitTranscript = exports.getAllQueues = exports.getMinutesQueue = exports.getBroadcastQueue = exports.getTranslationQueue = exports.getTranscriptQueue = exports.getQueue = exports.getDLQName = exports.getShardCount = exports.getShardQueueName = exports.getShardIndex = exports.DLQ_NAMES = exports.SHARDED_QUEUE_TYPES = exports.QUEUE_SHARD_COUNTS = exports.QUEUE_SHARDS = exports.shutdownQueueManager = exports.initializeQueueManager = exports.queueManager = void 0;
// ── Sharded Queue Manager (Primary) ─────────────────────────
var queue_manager_1 = require("./queue-manager");
// Singleton instance
Object.defineProperty(exports, "queueManager", { enumerable: true, get: function () { return queue_manager_1.queueManager; } });
// Initialization & Lifecycle
Object.defineProperty(exports, "initializeQueueManager", { enumerable: true, get: function () { return queue_manager_1.initializeQueueManager; } });
Object.defineProperty(exports, "shutdownQueueManager", { enumerable: true, get: function () { return queue_manager_1.shutdownQueueManager; } });
// Configuration Constants
Object.defineProperty(exports, "QUEUE_SHARDS", { enumerable: true, get: function () { return queue_manager_1.QUEUE_SHARDS; } });
Object.defineProperty(exports, "QUEUE_SHARD_COUNTS", { enumerable: true, get: function () { return queue_manager_1.QUEUE_SHARD_COUNTS; } });
Object.defineProperty(exports, "SHARDED_QUEUE_TYPES", { enumerable: true, get: function () { return queue_manager_1.SHARDED_QUEUE_TYPES; } });
Object.defineProperty(exports, "DLQ_NAMES", { enumerable: true, get: function () { return queue_manager_1.DLQ_NAMES; } });
// Shard Routing Utilities
Object.defineProperty(exports, "getShardIndex", { enumerable: true, get: function () { return queue_manager_1.getShardIndex; } });
Object.defineProperty(exports, "getShardQueueName", { enumerable: true, get: function () { return queue_manager_1.getShardQueueName; } });
Object.defineProperty(exports, "getShardCount", { enumerable: true, get: function () { return queue_manager_1.getShardCount; } });
Object.defineProperty(exports, "getDLQName", { enumerable: true, get: function () { return queue_manager_1.getDLQName; } });
// Queue Factory Methods (requires meetingId for routing)
Object.defineProperty(exports, "getQueue", { enumerable: true, get: function () { return queue_manager_1.getQueue; } });
Object.defineProperty(exports, "getTranscriptQueue", { enumerable: true, get: function () { return queue_manager_1.getTranscriptQueue; } });
Object.defineProperty(exports, "getTranslationQueue", { enumerable: true, get: function () { return queue_manager_1.getTranslationQueue; } });
Object.defineProperty(exports, "getBroadcastQueue", { enumerable: true, get: function () { return queue_manager_1.getBroadcastQueue; } });
Object.defineProperty(exports, "getMinutesQueue", { enumerable: true, get: function () { return queue_manager_1.getMinutesQueue; } });
// Worker Discovery (all shards)
Object.defineProperty(exports, "getAllQueues", { enumerable: true, get: function () { return queue_manager_1.getAllQueues; } });
// Job Submission (Primary API)
Object.defineProperty(exports, "submitTranscript", { enumerable: true, get: function () { return queue_manager_1.submitTranscript; } });
Object.defineProperty(exports, "submitTranslation", { enumerable: true, get: function () { return queue_manager_1.submitTranslation; } });
Object.defineProperty(exports, "submitBroadcast", { enumerable: true, get: function () { return queue_manager_1.submitBroadcast; } });
Object.defineProperty(exports, "submitMinutes", { enumerable: true, get: function () { return queue_manager_1.submitMinutes; } });
// Dead Letter Queue Functions
Object.defineProperty(exports, "getDLQ", { enumerable: true, get: function () { return queue_manager_1.getDLQ; } });
Object.defineProperty(exports, "moveToDeadLetter", { enumerable: true, get: function () { return queue_manager_1.moveToDeadLetter; } });
Object.defineProperty(exports, "getDLQStats", { enumerable: true, get: function () { return queue_manager_1.getDLQStats; } });
Object.defineProperty(exports, "replayDLQJobs", { enumerable: true, get: function () { return queue_manager_1.replayDLQJobs; } });
// Monitoring & Stats
Object.defineProperty(exports, "getShardStats", { enumerable: true, get: function () { return queue_manager_1.getShardStats; } });
// ── Legacy Queue Exports (for backward compatibility) ───────
// These delegate to the sharded queue manager internally
var transcript_queue_1 = require("./transcript.queue");
Object.defineProperty(exports, "QUEUE_NAMES", { enumerable: true, get: function () { return transcript_queue_1.QUEUE_NAMES; } });
Object.defineProperty(exports, "initializeTranscriptQueues", { enumerable: true, get: function () { return transcript_queue_1.initializeTranscriptQueues; } });
Object.defineProperty(exports, "submitTranscriptEvent", { enumerable: true, get: function () { return transcript_queue_1.submitTranscriptEvent; } });
Object.defineProperty(exports, "submitTranslationJob", { enumerable: true, get: function () { return transcript_queue_1.submitTranslationJob; } });
Object.defineProperty(exports, "submitBroadcastEvent", { enumerable: true, get: function () { return transcript_queue_1.submitBroadcastEvent; } });
Object.defineProperty(exports, "submitMinutesJob", { enumerable: true, get: function () { return transcript_queue_1.submitMinutesJob; } });
Object.defineProperty(exports, "getTranscriptQueues", { enumerable: true, get: function () { return transcript_queue_1.getTranscriptQueues; } });
// ── DLQ Module ──────────────────────────────────────────────
var dlq_queue_1 = require("./dlq.queue");
Object.defineProperty(exports, "initializeDeadLetterQueue", { enumerable: true, get: function () { return dlq_queue_1.initializeDeadLetterQueue; } });
Object.defineProperty(exports, "sendToDeadLetterQueue", { enumerable: true, get: function () { return dlq_queue_1.sendToDeadLetterQueue; } });
Object.defineProperty(exports, "getDeadLetterJobs", { enumerable: true, get: function () { return dlq_queue_1.getDeadLetterJobs; } });
Object.defineProperty(exports, "replayDeadLetterJob", { enumerable: true, get: function () { return dlq_queue_1.replayDeadLetterJob; } });
Object.defineProperty(exports, "getDeadLetterQueueManager", { enumerable: true, get: function () { return dlq_queue_1.getDeadLetterQueueManager; } });
//# sourceMappingURL=index.js.map