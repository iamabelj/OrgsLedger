"use strict";
// ============================================================
// OrgsLedger API — Durable Event Store
// PostgreSQL-backed persistence for meeting events
// Ensures NO events are lost during failures
// ============================================================
//
// Architecture:
//   - All meeting events persisted to PostgreSQL before BullMQ
//   - Unprocessed events can be replayed after failures
//   - Transaction-safe writes with proper indexing
//   - Prometheus metrics for observability
//
// Supported events:
//   - transcript_received
//   - translation_completed
//   - caption_broadcast
//   - meeting_ended
//   - minutes_generated
//
// ============================================================
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.eventStore = void 0;
exports.initializeEventStore = initializeEventStore;
exports.storeEvent = storeEvent;
exports.markEventProcessed = markEventProcessed;
exports.getUnprocessedEvents = getUnprocessedEvents;
exports.isEventProcessed = isEventProcessed;
const uuid_1 = require("uuid");
const client = __importStar(require("prom-client"));
const db_1 = require("../db");
const logger_1 = require("../logger");
// ── Prometheus Metrics ──────────────────────────────────────
const eventStoreTotal = new client.Counter({
    name: 'orgsledger_event_store_total',
    help: 'Total number of events stored in the event store',
    labelNames: ['event_type', 'status'],
});
const eventStoreLatency = new client.Histogram({
    name: 'orgsledger_event_store_latency_ms',
    help: 'Latency of event store operations in milliseconds',
    labelNames: ['operation'],
    buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000],
});
const eventStorePendingGauge = new client.Gauge({
    name: 'orgsledger_event_store_pending',
    help: 'Number of unprocessed events in the event store',
    labelNames: ['event_type'],
});
// ── Table Schema ────────────────────────────────────────────
const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS meeting_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id VARCHAR(255) NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed BOOLEAN NOT NULL DEFAULT FALSE,
  processed_at TIMESTAMPTZ,
  processing_error TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  
  -- Indexes for efficient queries
  CONSTRAINT meeting_events_event_type_check 
    CHECK (event_type IN (
      'transcript_received',
      'translation_completed', 
      'caption_broadcast',
      'meeting_ended',
      'minutes_generated'
    ))
);

-- Index for fetching unprocessed events (replay worker)
CREATE INDEX IF NOT EXISTS idx_meeting_events_unprocessed 
  ON meeting_events (processed, created_at) 
  WHERE processed = FALSE;

-- Index for meeting history queries
CREATE INDEX IF NOT EXISTS idx_meeting_events_meeting_id_created 
  ON meeting_events (meeting_id, created_at);

-- Index for processed flag queries
CREATE INDEX IF NOT EXISTS idx_meeting_events_processed 
  ON meeting_events (processed);

-- Index for event type filtering
CREATE INDEX IF NOT EXISTS idx_meeting_events_event_type 
  ON meeting_events (event_type);

-- Partial index for active replay candidates (unprocessed with low retry count)
CREATE INDEX IF NOT EXISTS idx_meeting_events_replay_candidates 
  ON meeting_events (created_at, retry_count) 
  WHERE processed = FALSE AND retry_count < 5;
`;
// ── Event Store Class ───────────────────────────────────────
class EventStore {
    initialized = false;
    initPromise = null;
    metricsInterval = null;
    // ── Initialization ──────────────────────────────────────────
    /**
     * Initialize the event store (create table if not exists).
     * Safe to call multiple times — uses singleton pattern.
     */
    async initialize() {
        if (this.initialized)
            return;
        if (this.initPromise) {
            return this.initPromise;
        }
        this.initPromise = this._initialize();
        return this.initPromise;
    }
    async _initialize() {
        const startTime = Date.now();
        try {
            // Create table and indexes
            await db_1.db.raw(CREATE_TABLE_SQL);
            this.initialized = true;
            this.startMetricsCollection();
            const duration = Date.now() - startTime;
            logger_1.logger.info('[EVENT_STORE] Initialized successfully', {
                durationMs: duration,
            });
        }
        catch (err) {
            logger_1.logger.error('[EVENT_STORE] Initialization failed', { error: err });
            this.initPromise = null;
            throw err;
        }
    }
    // ── Core Operations ─────────────────────────────────────────
    /**
     * Store a single event in the PostgreSQL event store.
     * Returns the event ID for tracking.
     */
    async storeEvent(input) {
        const startTime = Date.now();
        const eventId = input.eventId || (0, uuid_1.v4)();
        try {
            await this.ensureInitialized();
            // Check for duplicate event ID (idempotency)
            if (input.eventId) {
                const existing = await (0, db_1.db)('meeting_events')
                    .where('id', input.eventId)
                    .first();
                if (existing) {
                    logger_1.logger.debug('[EVENT_STORE] Duplicate event skipped', {
                        eventId: input.eventId,
                        eventType: input.eventType,
                    });
                    return input.eventId;
                }
            }
            await (0, db_1.db)('meeting_events').insert({
                id: eventId,
                meeting_id: input.meetingId,
                event_type: input.eventType,
                payload: JSON.stringify(input.payload),
                created_at: new Date(),
                processed: false,
                retry_count: 0,
            });
            const duration = Date.now() - startTime;
            eventStoreLatency.observe({ operation: 'store' }, duration);
            eventStoreTotal.inc({ event_type: input.eventType, status: 'success' });
            logger_1.logger.debug('[EVENT_STORE] Event stored', {
                eventId,
                eventType: input.eventType,
                meetingId: input.meetingId,
                durationMs: duration,
            });
            return eventId;
        }
        catch (err) {
            const duration = Date.now() - startTime;
            eventStoreLatency.observe({ operation: 'store' }, duration);
            eventStoreTotal.inc({ event_type: input.eventType, status: 'error' });
            logger_1.logger.error('[EVENT_STORE] Failed to store event', {
                eventType: input.eventType,
                meetingId: input.meetingId,
                error: err,
            });
            throw err;
        }
    }
    /**
     * Store multiple events in a single transaction.
     * More efficient for batch operations.
     */
    async storeEventsBatch(inputs) {
        const startTime = Date.now();
        const eventIds = [];
        let failed = 0;
        try {
            await this.ensureInitialized();
            await db_1.db.transaction(async (trx) => {
                for (const input of inputs) {
                    const eventId = input.eventId || (0, uuid_1.v4)();
                    try {
                        // Check for duplicates
                        if (input.eventId) {
                            const existing = await trx('meeting_events')
                                .where('id', input.eventId)
                                .first();
                            if (existing) {
                                eventIds.push(input.eventId);
                                continue;
                            }
                        }
                        await trx('meeting_events').insert({
                            id: eventId,
                            meeting_id: input.meetingId,
                            event_type: input.eventType,
                            payload: JSON.stringify(input.payload),
                            created_at: new Date(),
                            processed: false,
                            retry_count: 0,
                        });
                        eventIds.push(eventId);
                        eventStoreTotal.inc({ event_type: input.eventType, status: 'success' });
                    }
                    catch (err) {
                        failed++;
                        eventStoreTotal.inc({ event_type: input.eventType, status: 'error' });
                        logger_1.logger.error('[EVENT_STORE] Failed to store event in batch', {
                            eventType: input.eventType,
                            meetingId: input.meetingId,
                            error: err,
                        });
                    }
                }
            });
            const duration = Date.now() - startTime;
            eventStoreLatency.observe({ operation: 'store_batch' }, duration);
            logger_1.logger.info('[EVENT_STORE] Batch stored', {
                stored: eventIds.length,
                failed,
                durationMs: duration,
            });
            return { stored: eventIds.length, failed, eventIds };
        }
        catch (err) {
            logger_1.logger.error('[EVENT_STORE] Batch store failed', { error: err });
            throw err;
        }
    }
    /**
     * Mark an event as successfully processed.
     */
    async markEventProcessed(eventId) {
        const startTime = Date.now();
        try {
            await this.ensureInitialized();
            const updated = await (0, db_1.db)('meeting_events')
                .where('id', eventId)
                .update({
                processed: true,
                processed_at: new Date(),
                processing_error: null,
            });
            const duration = Date.now() - startTime;
            eventStoreLatency.observe({ operation: 'mark_processed' }, duration);
            if (updated === 0) {
                logger_1.logger.warn('[EVENT_STORE] Event not found for marking processed', { eventId });
            }
            else {
                logger_1.logger.debug('[EVENT_STORE] Event marked processed', { eventId, durationMs: duration });
            }
        }
        catch (err) {
            logger_1.logger.error('[EVENT_STORE] Failed to mark event processed', {
                eventId,
                error: err,
            });
            throw err;
        }
    }
    /**
     * Mark multiple events as processed in a single transaction.
     */
    async markEventsProcessed(eventIds) {
        if (eventIds.length === 0)
            return 0;
        const startTime = Date.now();
        try {
            await this.ensureInitialized();
            const updated = await (0, db_1.db)('meeting_events')
                .whereIn('id', eventIds)
                .update({
                processed: true,
                processed_at: new Date(),
                processing_error: null,
            });
            const duration = Date.now() - startTime;
            eventStoreLatency.observe({ operation: 'mark_processed_batch' }, duration);
            logger_1.logger.info('[EVENT_STORE] Events marked processed', {
                count: updated,
                requested: eventIds.length,
                durationMs: duration,
            });
            return updated;
        }
        catch (err) {
            logger_1.logger.error('[EVENT_STORE] Failed to mark events processed', {
                eventIds: eventIds.slice(0, 5),
                error: err,
            });
            throw err;
        }
    }
    /**
     * Mark an event as failed with error message.
     * Increments retry count for backoff.
     */
    async markEventFailed(eventId, error) {
        const startTime = Date.now();
        try {
            await this.ensureInitialized();
            await (0, db_1.db)('meeting_events')
                .where('id', eventId)
                .update({
                processing_error: error,
                retry_count: db_1.db.raw('retry_count + 1'),
            });
            const duration = Date.now() - startTime;
            eventStoreLatency.observe({ operation: 'mark_failed' }, duration);
            logger_1.logger.debug('[EVENT_STORE] Event marked failed', { eventId, error, durationMs: duration });
        }
        catch (err) {
            logger_1.logger.error('[EVENT_STORE] Failed to mark event failed', {
                eventId,
                error: err,
            });
            throw err;
        }
    }
    /**
     * Get unprocessed events for replay.
     * Returns oldest events first, with retry count < maxRetries.
     */
    async getUnprocessedEvents(limit = 100, maxRetries = 5) {
        const startTime = Date.now();
        try {
            await this.ensureInitialized();
            const rows = await (0, db_1.db)('meeting_events')
                .where('processed', false)
                .where('retry_count', '<', maxRetries)
                .orderBy('created_at', 'asc')
                .limit(limit)
                .select('*');
            const duration = Date.now() - startTime;
            eventStoreLatency.observe({ operation: 'get_unprocessed' }, duration);
            const events = rows.map((row) => ({
                id: row.id,
                meetingId: row.meeting_id,
                eventType: row.event_type,
                payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
                createdAt: new Date(row.created_at),
                processed: row.processed,
                processedAt: row.processed_at ? new Date(row.processed_at) : undefined,
                processingError: row.processing_error,
                retryCount: row.retry_count,
            }));
            logger_1.logger.debug('[EVENT_STORE] Fetched unprocessed events', {
                count: events.length,
                limit,
                maxRetries,
                durationMs: duration,
            });
            return events;
        }
        catch (err) {
            logger_1.logger.error('[EVENT_STORE] Failed to fetch unprocessed events', { error: err });
            throw err;
        }
    }
    /**
     * Get unprocessed events for a specific meeting.
     */
    async getUnprocessedEventsForMeeting(meetingId, limit = 100) {
        const startTime = Date.now();
        try {
            await this.ensureInitialized();
            const rows = await (0, db_1.db)('meeting_events')
                .where('meeting_id', meetingId)
                .where('processed', false)
                .orderBy('created_at', 'asc')
                .limit(limit)
                .select('*');
            const duration = Date.now() - startTime;
            eventStoreLatency.observe({ operation: 'get_unprocessed_meeting' }, duration);
            return rows.map((row) => ({
                id: row.id,
                meetingId: row.meeting_id,
                eventType: row.event_type,
                payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
                createdAt: new Date(row.created_at),
                processed: row.processed,
                processedAt: row.processed_at ? new Date(row.processed_at) : undefined,
                processingError: row.processing_error,
                retryCount: row.retry_count,
            }));
        }
        catch (err) {
            logger_1.logger.error('[EVENT_STORE] Failed to fetch meeting events', {
                meetingId,
                error: err,
            });
            throw err;
        }
    }
    /**
     * Get event by ID.
     */
    async getEvent(eventId) {
        try {
            await this.ensureInitialized();
            const row = await (0, db_1.db)('meeting_events')
                .where('id', eventId)
                .first();
            if (!row)
                return null;
            return {
                id: row.id,
                meetingId: row.meeting_id,
                eventType: row.event_type,
                payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
                createdAt: new Date(row.created_at),
                processed: row.processed,
                processedAt: row.processed_at ? new Date(row.processed_at) : undefined,
                processingError: row.processing_error,
                retryCount: row.retry_count,
            };
        }
        catch (err) {
            logger_1.logger.error('[EVENT_STORE] Failed to get event', { eventId, error: err });
            throw err;
        }
    }
    /**
     * Check if an event has already been processed (for idempotency).
     */
    async isEventProcessed(eventId) {
        try {
            await this.ensureInitialized();
            const row = await (0, db_1.db)('meeting_events')
                .where('id', eventId)
                .select('processed')
                .first();
            return row?.processed ?? false;
        }
        catch (err) {
            logger_1.logger.error('[EVENT_STORE] Failed to check event status', { eventId, error: err });
            return false;
        }
    }
    // ── Statistics ──────────────────────────────────────────────
    /**
     * Get event store statistics.
     */
    async getStats() {
        try {
            await this.ensureInitialized();
            // Get overall counts
            const overall = await (0, db_1.db)('meeting_events')
                .select(db_1.db.raw('COUNT(*) as total'), db_1.db.raw('SUM(CASE WHEN processed = true THEN 1 ELSE 0 END) as processed'), db_1.db.raw('SUM(CASE WHEN processed = false THEN 1 ELSE 0 END) as pending'), db_1.db.raw('SUM(CASE WHEN retry_count >= 5 THEN 1 ELSE 0 END) as failed'))
                .first();
            // Get counts by event type
            const byType = await (0, db_1.db)('meeting_events')
                .select('event_type')
                .count('* as total')
                .sum(db_1.db.raw('CASE WHEN processed = false THEN 1 ELSE 0 END as pending'))
                .groupBy('event_type');
            const byEventType = {};
            for (const row of byType) {
                byEventType[row.event_type] = {
                    total: parseInt(row.total, 10),
                    pending: parseInt(row.pending, 10) || 0,
                };
            }
            return {
                total: parseInt(overall?.total || '0', 10),
                processed: parseInt(overall?.processed || '0', 10),
                pending: parseInt(overall?.pending || '0', 10),
                failed: parseInt(overall?.failed || '0', 10),
                byEventType,
            };
        }
        catch (err) {
            logger_1.logger.error('[EVENT_STORE] Failed to get stats', { error: err });
            throw err;
        }
    }
    /**
     * Delete old processed events (cleanup job).
     * Keeps events for specified retention period.
     */
    async cleanupOldEvents(retentionDays = 30) {
        const startTime = Date.now();
        try {
            await this.ensureInitialized();
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
            const deleted = await (0, db_1.db)('meeting_events')
                .where('processed', true)
                .where('created_at', '<', cutoffDate)
                .delete();
            const duration = Date.now() - startTime;
            logger_1.logger.info('[EVENT_STORE] Cleaned up old events', {
                deleted,
                retentionDays,
                cutoffDate: cutoffDate.toISOString(),
                durationMs: duration,
            });
            return deleted;
        }
        catch (err) {
            logger_1.logger.error('[EVENT_STORE] Failed to cleanup old events', { error: err });
            throw err;
        }
    }
    // ── Helpers ─────────────────────────────────────────────────
    async ensureInitialized() {
        if (!this.initialized) {
            await this.initialize();
        }
    }
    startMetricsCollection() {
        // Update pending event count every 30 seconds
        this.metricsInterval = setInterval(async () => {
            try {
                const stats = await this.getStats();
                for (const [eventType, counts] of Object.entries(stats.byEventType)) {
                    eventStorePendingGauge.set({ event_type: eventType }, counts.pending);
                }
            }
            catch (err) {
                logger_1.logger.error('[EVENT_STORE] Failed to collect metrics', { error: err });
            }
        }, 30000);
        // Don't block process exit
        if (this.metricsInterval.unref) {
            this.metricsInterval.unref();
        }
    }
    /**
     * Shutdown the event store (stop metrics collection).
     */
    shutdown() {
        if (this.metricsInterval) {
            clearInterval(this.metricsInterval);
            this.metricsInterval = null;
        }
        logger_1.logger.info('[EVENT_STORE] Shutdown complete');
    }
}
// ── Singleton Instance ──────────────────────────────────────
exports.eventStore = new EventStore();
// ── Convenience Functions ───────────────────────────────────
async function initializeEventStore() {
    return exports.eventStore.initialize();
}
async function storeEvent(input) {
    return exports.eventStore.storeEvent(input);
}
async function markEventProcessed(eventId) {
    return exports.eventStore.markEventProcessed(eventId);
}
async function getUnprocessedEvents(limit, maxRetries) {
    return exports.eventStore.getUnprocessedEvents(limit, maxRetries);
}
async function isEventProcessed(eventId) {
    return exports.eventStore.isEventProcessed(eventId);
}
exports.default = exports.eventStore;
//# sourceMappingURL=event-store.js.map