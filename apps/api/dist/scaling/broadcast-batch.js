"use strict";
// ============================================================
// OrgsLedger API — Broadcast Batch System
// Batches caption events to reduce Redis PubSub pressure
// ============================================================
//
// At 50k meetings with 5 captions/second each = 250k events/sec.
// Individual Redis PUBLISH calls would overwhelm the system.
// 
// Solution: Batch events per meeting, flush every 50ms.
// Reduces PUBLISH calls by ~50x while maintaining <100ms latency.
//
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.broadcastBatchManager = void 0;
exports.initializeBroadcastBatching = initializeBroadcastBatching;
exports.queueCaptionForBroadcast = queueCaptionForBroadcast;
exports.queueTranscriptForBroadcast = queueTranscriptForBroadcast;
exports.getBroadcastBatchStats = getBroadcastBatchStats;
exports.shutdownBroadcastBatching = shutdownBroadcastBatching;
exports.cleanupMeetingBroadcastBatch = cleanupMeetingBroadcastBatch;
const logger_1 = require("../logger");
// ── Configuration ───────────────────────────────────────────
const BATCH_CONFIG = {
    /** Flush interval in milliseconds (default: 50ms) */
    flushIntervalMs: parseInt(process.env.BROADCAST_BATCH_INTERVAL_MS || '50', 10),
    /** Maximum events per batch before forcing flush (default: 100) */
    maxBatchSize: parseInt(process.env.BROADCAST_MAX_BATCH_SIZE || '100', 10),
    /** Maximum meetings to track (memory protection) */
    maxMeetings: parseInt(process.env.BROADCAST_MAX_MEETINGS || '100000', 10),
};
// ── Batch Manager Class ─────────────────────────────────────
class BroadcastBatchManager {
    /** Pending caption events per meeting: Map<meetingId, CaptionEvent[]> */
    captionBatches = new Map();
    /** Pending transcript events per meeting: Map<meetingId, TranscriptEvent[]> */
    transcriptBatches = new Map();
    /** Organization ID cache: Map<meetingId, organizationId> */
    orgCache = new Map();
    /** Flush timer */
    flushTimer = null;
    /** Callback for publishing batched events */
    publishCallback = null;
    /** Statistics */
    stats = {
        captionsQueued: 0,
        transcriptsQueued: 0,
        batchesFlushed: 0,
        eventsPublished: 0,
        lastFlushAt: 0,
    };
    /**
     * Initialize the batch manager with a publish callback.
     */
    initialize(publishCallback) {
        this.publishCallback = publishCallback;
        this.startFlushTimer();
        logger_1.logger.info('[BROADCAST_BATCH] Initialized', {
            flushIntervalMs: BATCH_CONFIG.flushIntervalMs,
            maxBatchSize: BATCH_CONFIG.maxBatchSize,
        });
    }
    /**
     * Queue a caption event for batching.
     */
    queueCaption(event) {
        const { meetingId, organizationId } = event;
        // Store org ID for batch payload
        if (organizationId) {
            this.orgCache.set(meetingId, organizationId);
        }
        // Get or create batch for this meeting
        let batch = this.captionBatches.get(meetingId);
        if (!batch) {
            // Memory protection: limit tracked meetings
            if (this.captionBatches.size >= BATCH_CONFIG.maxMeetings) {
                logger_1.logger.warn('[BROADCAST_BATCH] Max meetings reached, flushing all');
                this.flushAll();
            }
            batch = [];
            this.captionBatches.set(meetingId, batch);
        }
        batch.push(event);
        this.stats.captionsQueued++;
        // Force flush if batch is too large
        if (batch.length >= BATCH_CONFIG.maxBatchSize) {
            this.flushMeeting(meetingId, 'caption');
        }
    }
    /**
     * Queue a transcript event for batching.
     */
    queueTranscript(event) {
        const { meetingId, organizationId } = event;
        if (organizationId) {
            this.orgCache.set(meetingId, organizationId);
        }
        let batch = this.transcriptBatches.get(meetingId);
        if (!batch) {
            if (this.transcriptBatches.size >= BATCH_CONFIG.maxMeetings) {
                logger_1.logger.warn('[BROADCAST_BATCH] Max meetings reached, flushing all');
                this.flushAll();
            }
            batch = [];
            this.transcriptBatches.set(meetingId, batch);
        }
        batch.push(event);
        this.stats.transcriptsQueued++;
        if (batch.length >= BATCH_CONFIG.maxBatchSize) {
            this.flushMeeting(meetingId, 'transcript');
        }
    }
    /**
     * Flush all pending batches for a specific meeting.
     */
    async flushMeeting(meetingId, type) {
        if (!this.publishCallback)
            return;
        const organizationId = this.orgCache.get(meetingId);
        if (type === 'caption') {
            const captions = this.captionBatches.get(meetingId);
            if (captions && captions.length > 0) {
                const payload = {
                    type: 'meeting:captions',
                    meetingId,
                    organizationId,
                    timestamp: Date.now(),
                    captions,
                };
                try {
                    await this.publishCallback(payload);
                    this.stats.eventsPublished += captions.length;
                    this.stats.batchesFlushed++;
                }
                catch (err) {
                    logger_1.logger.error('[BROADCAST_BATCH] Failed to publish captions', {
                        meetingId,
                        count: captions.length,
                        error: err,
                    });
                }
                this.captionBatches.delete(meetingId);
            }
        }
        else {
            const transcripts = this.transcriptBatches.get(meetingId);
            if (transcripts && transcripts.length > 0) {
                const payload = {
                    type: 'meeting:transcripts',
                    meetingId,
                    organizationId,
                    timestamp: Date.now(),
                    transcripts,
                };
                try {
                    await this.publishCallback(payload);
                    this.stats.eventsPublished += transcripts.length;
                    this.stats.batchesFlushed++;
                }
                catch (err) {
                    logger_1.logger.error('[BROADCAST_BATCH] Failed to publish transcripts', {
                        meetingId,
                        count: transcripts.length,
                        error: err,
                    });
                }
                this.transcriptBatches.delete(meetingId);
            }
        }
    }
    /**
     * Flush all pending batches.
     */
    async flushAll() {
        if (!this.publishCallback)
            return;
        const captionMeetings = Array.from(this.captionBatches.keys());
        const transcriptMeetings = Array.from(this.transcriptBatches.keys());
        // Flush all in parallel
        const promises = [];
        for (const meetingId of captionMeetings) {
            promises.push(this.flushMeeting(meetingId, 'caption'));
        }
        for (const meetingId of transcriptMeetings) {
            promises.push(this.flushMeeting(meetingId, 'transcript'));
        }
        await Promise.allSettled(promises);
        this.stats.lastFlushAt = Date.now();
    }
    /**
     * Start the periodic flush timer.
     */
    startFlushTimer() {
        if (this.flushTimer)
            return;
        this.flushTimer = setInterval(() => {
            this.flushAll().catch((err) => {
                logger_1.logger.error('[BROADCAST_BATCH] Flush timer error', { error: err });
            });
        }, BATCH_CONFIG.flushIntervalMs);
        // Unref to not prevent process exit
        this.flushTimer.unref();
    }
    /**
     * Stop the batch manager.
     */
    async shutdown() {
        if (this.flushTimer) {
            clearInterval(this.flushTimer);
            this.flushTimer = null;
        }
        // Final flush
        await this.flushAll();
        this.captionBatches.clear();
        this.transcriptBatches.clear();
        this.orgCache.clear();
        logger_1.logger.info('[BROADCAST_BATCH] Shutdown complete', this.stats);
    }
    /**
     * Get current statistics.
     */
    getStats() {
        return {
            ...this.stats,
            pendingCaptionMeetings: this.captionBatches.size,
            pendingTranscriptMeetings: this.transcriptBatches.size,
            pendingCaptions: Array.from(this.captionBatches.values())
                .reduce((sum, batch) => sum + batch.length, 0),
            pendingTranscripts: Array.from(this.transcriptBatches.values())
                .reduce((sum, batch) => sum + batch.length, 0),
        };
    }
    /**
     * Clean up data for a specific meeting (call on meeting end).
     */
    cleanupMeeting(meetingId) {
        this.captionBatches.delete(meetingId);
        this.transcriptBatches.delete(meetingId);
        this.orgCache.delete(meetingId);
    }
}
// ── Singleton Instance ──────────────────────────────────────
exports.broadcastBatchManager = new BroadcastBatchManager();
// ── Exported Helper Functions ───────────────────────────────
function initializeBroadcastBatching(publishCallback) {
    exports.broadcastBatchManager.initialize(publishCallback);
}
function queueCaptionForBroadcast(event) {
    exports.broadcastBatchManager.queueCaption(event);
}
function queueTranscriptForBroadcast(event) {
    exports.broadcastBatchManager.queueTranscript(event);
}
function getBroadcastBatchStats() {
    return exports.broadcastBatchManager.getStats();
}
async function shutdownBroadcastBatching() {
    await exports.broadcastBatchManager.shutdown();
}
function cleanupMeetingBroadcastBatch(meetingId) {
    exports.broadcastBatchManager.cleanupMeeting(meetingId);
}
//# sourceMappingURL=broadcast-batch.js.map