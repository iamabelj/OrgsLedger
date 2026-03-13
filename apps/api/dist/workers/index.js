"use strict";
// ============================================================
// OrgsLedger API — Worker Initialization Module
// Centralized startup/shutdown for BullMQ workers
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.autoscalerQueueLagGauge = exports.autoscalerQueueDepthGauge = exports.autoscalerScaleEventsCounter = exports.autoscalerWorkersGauge = exports.getWorkerCounts = exports.getAutoscalerStatus = exports.stopAutoscaler = exports.startAutoscaler = exports.initializeAutoscaler = exports.workerAutoscaler = exports.workerManager = void 0;
const logger_1 = require("../logger");
const notification_worker_1 = require("./notification.worker");
const email_worker_1 = require("./email.worker");
const audit_worker_1 = require("./audit.worker");
const dlq_queue_1 = require("../queues/dlq.queue");
const transcript_worker_1 = require("./transcript.worker");
const translation_worker_1 = require("./translation.worker");
const broadcast_worker_1 = require("./broadcast.worker");
const minutes_worker_1 = require("./minutes.worker");
const transcript_queue_1 = require("../queues/transcript.queue");
const event_replay_worker_1 = require("./event-replay.worker");
// ── Worker Manager ────────────────────────────────────────────
class WorkerManager {
    isInitialized = false;
    shutdownPromise = null;
    /**
     * Initialize all workers and queues.
     */
    async initialize() {
        if (this.isInitialized) {
            logger_1.logger.warn('[WORKER_MANAGER] Already initialized');
            return;
        }
        const startTime = Date.now();
        logger_1.logger.info('[WORKER_MANAGER] Initializing workers...');
        try {
            // Initialize DLQ
            await (0, dlq_queue_1.initializeDeadLetterQueue)();
            logger_1.logger.info('[WORKER_MANAGER] DLQ initialized');
            // Initialize transcript queues
            await (0, transcript_queue_1.initializeTranscriptQueues)();
            logger_1.logger.info('[WORKER_MANAGER] Transcript queues initialized');
            // Initialize workers
            await Promise.all([
                (0, notification_worker_1.startNotificationWorker)(),
                (0, email_worker_1.startEmailWorker)(),
                (0, audit_worker_1.startAuditWorker)(),
                (0, transcript_worker_1.startTranscriptWorker)(),
                (0, translation_worker_1.startTranslationWorker)(),
                (0, broadcast_worker_1.startBroadcastWorker)(),
                (0, minutes_worker_1.startMinutesWorker)(),
            ]);
            // Start the event replay worker (background job)
            await event_replay_worker_1.eventReplayWorker.start();
            logger_1.logger.info('[WORKER_MANAGER] Event replay worker started');
            this.isInitialized = true;
            const elapsed = Date.now() - startTime;
            logger_1.logger.info('[WORKER_MANAGER] Workers initialized', {
                elapsedMs: elapsed,
                workers: ['notification', 'email', 'audit', 'transcript', 'translation', 'broadcast', 'minutes'],
            });
        }
        catch (err) {
            logger_1.logger.error('[WORKER_MANAGER] Failed to initialize', err);
            throw err;
        }
    }
    /**
     * Get status of all workers.
     */
    async getStatus() {
        if (!this.isInitialized) {
            return {
                initialized: false,
                workers: [],
            };
        }
        const [notificationStatus, emailStatus, auditStatus] = await Promise.all([
            (0, notification_worker_1.getNotificationWorker)().getStatus(),
            (0, email_worker_1.getEmailWorker)().getStatus(),
            (0, audit_worker_1.getAuditWorker)().getStatus(),
        ]);
        const transcriptStatus = (0, transcript_worker_1.getTranscriptWorker)()?.getStats() || { running: false, processed: 0, failed: 0 };
        const translationStatus = (0, translation_worker_1.getTranslationWorker)()?.getStats() || { running: false, processed: 0, failed: 0 };
        const broadcastStatus = (0, broadcast_worker_1.getBroadcastWorker)()?.getStats() || { running: false, processed: 0, failed: 0 };
        const minutesStatus = (0, minutes_worker_1.getMinutesWorker)()?.getStats() || { running: false, processed: 0, failed: 0 };
        const workers = [
            {
                name: 'notification',
                running: notificationStatus.running,
                processed: notificationStatus.processed,
                failed: notificationStatus.failed,
                paused: notificationStatus.paused ?? false,
                healthy: notificationStatus.running,
            },
            {
                name: 'email',
                running: emailStatus.running,
                processed: emailStatus.processed,
                failed: emailStatus.failed,
                paused: emailStatus.paused ?? false,
                healthy: emailStatus.running,
            },
            {
                name: 'audit',
                running: auditStatus.running,
                processed: auditStatus.processed,
                failed: auditStatus.failed,
                paused: auditStatus.paused ?? false,
                healthy: auditStatus.running,
            },
            {
                name: 'transcript',
                running: transcriptStatus.running,
                processed: transcriptStatus.processed,
                failed: transcriptStatus.failed,
                paused: false,
                healthy: transcriptStatus.running,
            },
            {
                name: 'translation',
                running: translationStatus.running,
                processed: translationStatus.processed,
                failed: translationStatus.failed,
                paused: false,
                healthy: translationStatus.running,
            },
            {
                name: 'broadcast',
                running: broadcastStatus.running,
                processed: broadcastStatus.processed,
                failed: broadcastStatus.failed,
                paused: false,
                healthy: broadcastStatus.running,
            },
            {
                name: 'minutes',
                running: minutesStatus.running,
                processed: minutesStatus.processed,
                failed: minutesStatus.failed,
                paused: false,
                healthy: minutesStatus.running,
            },
        ];
        return {
            initialized: this.isInitialized,
            workers,
        };
    }
    /**
     * Check if all workers are healthy.
     */
    async isHealthy() {
        if (!this.isInitialized)
            return false;
        const status = await this.getStatus();
        const unhealthyWorkers = status.workers.filter((w) => !w.healthy);
        if (unhealthyWorkers.length > 0) {
            logger_1.logger.warn('[WORKER_MANAGER] Unhealthy workers detected', {
                unhealthy: unhealthyWorkers.map((w) => w.name),
            });
            return false;
        }
        return true;
    }
    /**
     * Gracefully shutdown all workers.
     */
    async shutdown() {
        if (this.shutdownPromise) {
            return this.shutdownPromise;
        }
        this.shutdownPromise = this.doShutdown();
        return this.shutdownPromise;
    }
    async doShutdown() {
        if (!this.isInitialized) {
            return;
        }
        logger_1.logger.info('[WORKER_MANAGER] Shutting down workers...');
        const startTime = Date.now();
        try {
            await Promise.all([
                (0, notification_worker_1.stopNotificationWorker)(),
                (0, email_worker_1.stopEmailWorker)(),
                (0, audit_worker_1.stopAuditWorker)(),
                (0, transcript_worker_1.stopTranscriptWorker)(),
                (0, translation_worker_1.stopTranslationWorker)(),
                (0, broadcast_worker_1.stopBroadcastWorker)(),
                (0, minutes_worker_1.stopMinutesWorker)(),
                event_replay_worker_1.eventReplayWorker.stop(),
            ]);
            this.isInitialized = false;
            const elapsed = Date.now() - startTime;
            logger_1.logger.info('[WORKER_MANAGER] Shutdown complete', { elapsedMs: elapsed });
        }
        catch (err) {
            logger_1.logger.error('[WORKER_MANAGER] Error during shutdown', err);
            throw err;
        }
    }
}
// Export singleton instance
exports.workerManager = new WorkerManager();
// Worker Autoscaler exports
var worker_autoscaler_1 = require("./worker-autoscaler");
Object.defineProperty(exports, "workerAutoscaler", { enumerable: true, get: function () { return worker_autoscaler_1.workerAutoscaler; } });
Object.defineProperty(exports, "initializeAutoscaler", { enumerable: true, get: function () { return worker_autoscaler_1.initializeAutoscaler; } });
Object.defineProperty(exports, "startAutoscaler", { enumerable: true, get: function () { return worker_autoscaler_1.startAutoscaler; } });
Object.defineProperty(exports, "stopAutoscaler", { enumerable: true, get: function () { return worker_autoscaler_1.stopAutoscaler; } });
Object.defineProperty(exports, "getAutoscalerStatus", { enumerable: true, get: function () { return worker_autoscaler_1.getAutoscalerStatus; } });
Object.defineProperty(exports, "getWorkerCounts", { enumerable: true, get: function () { return worker_autoscaler_1.getWorkerCounts; } });
Object.defineProperty(exports, "autoscalerWorkersGauge", { enumerable: true, get: function () { return worker_autoscaler_1.autoscalerWorkersGauge; } });
Object.defineProperty(exports, "autoscalerScaleEventsCounter", { enumerable: true, get: function () { return worker_autoscaler_1.autoscalerScaleEventsCounter; } });
Object.defineProperty(exports, "autoscalerQueueDepthGauge", { enumerable: true, get: function () { return worker_autoscaler_1.autoscalerQueueDepthGauge; } });
Object.defineProperty(exports, "autoscalerQueueLagGauge", { enumerable: true, get: function () { return worker_autoscaler_1.autoscalerQueueLagGauge; } });
//# sourceMappingURL=index.js.map