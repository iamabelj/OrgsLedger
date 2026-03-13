"use strict";
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
exports.eventQueueBridge = void 0;
exports.initializeEventBridge = initializeEventBridge;
exports.durableSubmitTranscript = durableSubmitTranscript;
exports.durableSubmitTranslation = durableSubmitTranslation;
exports.durableSubmitBroadcast = durableSubmitBroadcast;
exports.durableSubmitMinutes = durableSubmitMinutes;
exports.durableSubmitMeetingEnded = durableSubmitMeetingEnded;
exports.replayEvent = replayEvent;
const client = __importStar(require("prom-client"));
const uuid_1 = require("uuid");
const logger_1 = require("../logger");
const event_store_1 = require("./event-store");
const queue_manager_1 = require("../queues/queue-manager");
// ── Prometheus Metrics ──────────────────────────────────────
const bridgeSubmitTotal = new client.Counter({
    name: 'orgsledger_event_bridge_submit_total',
    help: 'Total events submitted through the event bridge',
    labelNames: ['event_type', 'status'],
});
const bridgeQueueFailures = new client.Counter({
    name: 'orgsledger_event_bridge_queue_failures_total',
    help: 'Number of queue submission failures (events still persisted)',
    labelNames: ['event_type'],
});
const bridgeLatency = new client.Histogram({
    name: 'orgsledger_event_bridge_latency_ms',
    help: 'End-to-end latency of the event bridge (store + queue)',
    labelNames: ['event_type'],
    buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500],
});
// ── Event Queue Bridge Class ────────────────────────────────
class EventQueueBridge {
    initialized = false;
    initPromise = null;
    // ── Initialization ──────────────────────────────────────────
    /**
     * Initialize both the event store and queue manager.
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
        try {
            // Initialize both stores in parallel
            await Promise.all([
                (0, event_store_1.initializeEventStore)(),
                (0, queue_manager_1.initializeQueueManager)(),
            ]);
            this.initialized = true;
            logger_1.logger.info('[EVENT_BRIDGE] Initialized successfully');
        }
        catch (err) {
            logger_1.logger.error('[EVENT_BRIDGE] Initialization failed', { error: err });
            this.initPromise = null;
            throw err;
        }
    }
    async ensureInitialized() {
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
    async submitTranscript(input) {
        const startTime = Date.now();
        const eventId = input.eventId || (0, uuid_1.v4)();
        try {
            await this.ensureInitialized();
            // Step 1: Persist to event store
            const storeInput = {
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
            await event_store_1.eventStore.storeEvent(storeInput);
            // Step 2: Submit to BullMQ queue
            let job = null;
            let queued = false;
            let error;
            try {
                const queueData = {
                    meetingId: input.meetingId,
                    speaker: input.speaker,
                    speakerId: input.speakerId,
                    text: input.text,
                    timestamp: input.timestamp,
                    isFinal: input.isFinal,
                    confidence: input.confidence,
                    language: input.language,
                };
                job = await queue_manager_1.queueManager.submitTranscript(queueData, { priority: 1 });
                queued = true;
                // Step 3: Mark as processed since queue accepted it
                await event_store_1.eventStore.markEventProcessed(eventId);
                bridgeSubmitTotal.inc({ event_type: 'transcript', status: 'success' });
            }
            catch (queueErr) {
                // Queue failed but event is persisted — replay worker will retry
                error = queueErr.message || 'Queue submission failed';
                queued = false;
                bridgeQueueFailures.inc({ event_type: 'transcript' });
                bridgeSubmitTotal.inc({ event_type: 'transcript', status: 'queue_failed' });
                logger_1.logger.warn('[EVENT_BRIDGE] Queue submission failed, event persisted for replay', {
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
        }
        catch (err) {
            const duration = Date.now() - startTime;
            bridgeLatency.observe({ event_type: 'transcript' }, duration);
            bridgeSubmitTotal.inc({ event_type: 'transcript', status: 'error' });
            logger_1.logger.error('[EVENT_BRIDGE] Failed to submit transcript event', {
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
    async submitTranslation(input) {
        const startTime = Date.now();
        const eventId = input.eventId || (0, uuid_1.v4)();
        try {
            await this.ensureInitialized();
            // Step 1: Persist to event store
            const storeInput = {
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
            await event_store_1.eventStore.storeEvent(storeInput);
            // Step 2: Submit to BullMQ queue
            let job = null;
            let queued = false;
            let error;
            try {
                const queueData = {
                    meetingId: input.meetingId,
                    speaker: input.speaker,
                    speakerId: input.speakerId,
                    text: input.text,
                    timestamp: input.timestamp,
                    sourceLanguage: input.sourceLanguage,
                    targetLanguages: input.targetLanguages,
                };
                job = await queue_manager_1.queueManager.submitTranslation(queueData);
                queued = true;
                await event_store_1.eventStore.markEventProcessed(eventId);
                bridgeSubmitTotal.inc({ event_type: 'translation', status: 'success' });
            }
            catch (queueErr) {
                error = queueErr.message || 'Queue submission failed';
                queued = false;
                bridgeQueueFailures.inc({ event_type: 'translation' });
                bridgeSubmitTotal.inc({ event_type: 'translation', status: 'queue_failed' });
                logger_1.logger.warn('[EVENT_BRIDGE] Queue submission failed, event persisted for replay', {
                    eventId,
                    eventType: 'translation',
                    meetingId: input.meetingId,
                    error,
                });
            }
            const duration = Date.now() - startTime;
            bridgeLatency.observe({ event_type: 'translation' }, duration);
            return { eventId, jobId: job?.id, queued, error };
        }
        catch (err) {
            const duration = Date.now() - startTime;
            bridgeLatency.observe({ event_type: 'translation' }, duration);
            bridgeSubmitTotal.inc({ event_type: 'translation', status: 'error' });
            logger_1.logger.error('[EVENT_BRIDGE] Failed to submit translation event', {
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
    async submitBroadcast(input) {
        const startTime = Date.now();
        const eventId = input.eventId || (0, uuid_1.v4)();
        try {
            await this.ensureInitialized();
            // Step 1: Persist to event store
            const storeInput = {
                eventId,
                meetingId: input.meetingId,
                eventType: 'caption_broadcast',
                payload: {
                    eventType: input.eventType,
                    data: input.data,
                },
            };
            await event_store_1.eventStore.storeEvent(storeInput);
            // Step 2: Submit to BullMQ queue
            let job = null;
            let queued = false;
            let error;
            try {
                const queueData = {
                    meetingId: input.meetingId,
                    eventType: input.eventType,
                    data: input.data,
                };
                job = await queue_manager_1.queueManager.submitBroadcast(queueData);
                queued = true;
                await event_store_1.eventStore.markEventProcessed(eventId);
                bridgeSubmitTotal.inc({ event_type: 'broadcast', status: 'success' });
            }
            catch (queueErr) {
                error = queueErr.message || 'Queue submission failed';
                queued = false;
                bridgeQueueFailures.inc({ event_type: 'broadcast' });
                bridgeSubmitTotal.inc({ event_type: 'broadcast', status: 'queue_failed' });
                logger_1.logger.warn('[EVENT_BRIDGE] Queue submission failed, event persisted for replay', {
                    eventId,
                    eventType: 'broadcast',
                    meetingId: input.meetingId,
                    error,
                });
            }
            const duration = Date.now() - startTime;
            bridgeLatency.observe({ event_type: 'broadcast' }, duration);
            return { eventId, jobId: job?.id, queued, error };
        }
        catch (err) {
            const duration = Date.now() - startTime;
            bridgeLatency.observe({ event_type: 'broadcast' }, duration);
            bridgeSubmitTotal.inc({ event_type: 'broadcast', status: 'error' });
            logger_1.logger.error('[EVENT_BRIDGE] Failed to submit broadcast event', {
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
    async submitMinutes(input) {
        const startTime = Date.now();
        const eventId = input.eventId || (0, uuid_1.v4)();
        try {
            await this.ensureInitialized();
            // Step 1: Persist to event store
            const storeInput = {
                eventId,
                meetingId: input.meetingId,
                eventType: 'minutes_generated',
                payload: {
                    organizationId: input.organizationId,
                },
            };
            await event_store_1.eventStore.storeEvent(storeInput);
            // Step 2: Submit to BullMQ queue
            let job = null;
            let queued = false;
            let error;
            try {
                const queueData = {
                    meetingId: input.meetingId,
                    organizationId: input.organizationId,
                };
                job = await queue_manager_1.queueManager.submitMinutes(queueData);
                queued = true;
                await event_store_1.eventStore.markEventProcessed(eventId);
                bridgeSubmitTotal.inc({ event_type: 'minutes', status: 'success' });
            }
            catch (queueErr) {
                error = queueErr.message || 'Queue submission failed';
                queued = false;
                bridgeQueueFailures.inc({ event_type: 'minutes' });
                bridgeSubmitTotal.inc({ event_type: 'minutes', status: 'queue_failed' });
                logger_1.logger.warn('[EVENT_BRIDGE] Queue submission failed, event persisted for replay', {
                    eventId,
                    eventType: 'minutes',
                    meetingId: input.meetingId,
                    error,
                });
            }
            const duration = Date.now() - startTime;
            bridgeLatency.observe({ event_type: 'minutes' }, duration);
            return { eventId, jobId: job?.id, queued, error };
        }
        catch (err) {
            const duration = Date.now() - startTime;
            bridgeLatency.observe({ event_type: 'minutes' }, duration);
            bridgeSubmitTotal.inc({ event_type: 'minutes', status: 'error' });
            logger_1.logger.error('[EVENT_BRIDGE] Failed to submit minutes event', {
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
    async submitMeetingEnded(meetingId, organizationId, eventId) {
        const startTime = Date.now();
        const finalEventId = eventId || (0, uuid_1.v4)();
        try {
            await this.ensureInitialized();
            // Store the meeting ended event
            await event_store_1.eventStore.storeEvent({
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
            await event_store_1.eventStore.markEventProcessed(finalEventId);
            return {
                eventId: finalEventId,
                jobId: result.jobId,
                queued: result.queued,
                error: result.error,
            };
        }
        catch (err) {
            const duration = Date.now() - startTime;
            bridgeLatency.observe({ event_type: 'meeting_ended' }, duration);
            bridgeSubmitTotal.inc({ event_type: 'meeting_ended', status: 'error' });
            logger_1.logger.error('[EVENT_BRIDGE] Failed to submit meeting ended event', {
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
    async replayEvent(eventId) {
        try {
            await this.ensureInitialized();
            const event = await event_store_1.eventStore.getEvent(eventId);
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
                    logger_1.logger.warn('[EVENT_BRIDGE] Unknown event type for replay', {
                        eventId,
                        eventType: event.eventType,
                    });
                    return { eventId, queued: false, error: `Unknown event type: ${event.eventType}` };
            }
        }
        catch (err) {
            logger_1.logger.error('[EVENT_BRIDGE] Failed to replay event', {
                eventId,
                error: err.message,
            });
            throw err;
        }
    }
    async replayTranscript(event) {
        const data = {
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
            const job = await queue_manager_1.queueManager.submitTranscript(data);
            await event_store_1.eventStore.markEventProcessed(event.id);
            return { eventId: event.id, jobId: job.id, queued: true };
        }
        catch (err) {
            await event_store_1.eventStore.markEventFailed(event.id, err.message);
            return { eventId: event.id, queued: false, error: err.message };
        }
    }
    async replayTranslation(event) {
        const data = {
            meetingId: event.meetingId,
            speaker: event.payload.speaker,
            speakerId: event.payload.speakerId,
            text: event.payload.text,
            timestamp: event.payload.timestamp,
            sourceLanguage: event.payload.sourceLanguage,
            targetLanguages: event.payload.targetLanguages,
        };
        try {
            const job = await queue_manager_1.queueManager.submitTranslation(data);
            await event_store_1.eventStore.markEventProcessed(event.id);
            return { eventId: event.id, jobId: job.id, queued: true };
        }
        catch (err) {
            await event_store_1.eventStore.markEventFailed(event.id, err.message);
            return { eventId: event.id, queued: false, error: err.message };
        }
    }
    async replayBroadcast(event) {
        const data = {
            meetingId: event.meetingId,
            eventType: event.payload.eventType,
            data: event.payload.data,
        };
        try {
            const job = await queue_manager_1.queueManager.submitBroadcast(data);
            await event_store_1.eventStore.markEventProcessed(event.id);
            return { eventId: event.id, jobId: job.id, queued: true };
        }
        catch (err) {
            await event_store_1.eventStore.markEventFailed(event.id, err.message);
            return { eventId: event.id, queued: false, error: err.message };
        }
    }
    async replayMinutes(event) {
        const data = {
            meetingId: event.meetingId,
            organizationId: event.payload.organizationId,
        };
        try {
            const job = await queue_manager_1.queueManager.submitMinutes(data);
            await event_store_1.eventStore.markEventProcessed(event.id);
            return { eventId: event.id, jobId: job.id, queued: true };
        }
        catch (err) {
            await event_store_1.eventStore.markEventFailed(event.id, err.message);
            return { eventId: event.id, queued: false, error: err.message };
        }
    }
}
// ── Singleton Instance ──────────────────────────────────────
exports.eventQueueBridge = new EventQueueBridge();
// ── Convenience Functions ───────────────────────────────────
async function initializeEventBridge() {
    return exports.eventQueueBridge.initialize();
}
async function durableSubmitTranscript(input) {
    return exports.eventQueueBridge.submitTranscript(input);
}
async function durableSubmitTranslation(input) {
    return exports.eventQueueBridge.submitTranslation(input);
}
async function durableSubmitBroadcast(input) {
    return exports.eventQueueBridge.submitBroadcast(input);
}
async function durableSubmitMinutes(input) {
    return exports.eventQueueBridge.submitMinutes(input);
}
async function durableSubmitMeetingEnded(meetingId, organizationId, eventId) {
    return exports.eventQueueBridge.submitMeetingEnded(meetingId, organizationId, eventId);
}
async function replayEvent(eventId) {
    return exports.eventQueueBridge.replayEvent(eventId);
}
exports.default = exports.eventQueueBridge;
//# sourceMappingURL=event-queue-bridge.js.map