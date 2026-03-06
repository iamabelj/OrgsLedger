"use strict";
// ============================================================
// OrgsLedger API — Worker Orchestrator
// Initializes and manages lifecycle of all workers
// Provides health checks and graceful shutdown
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.workerOrchestrator = void 0;
exports.initializeWorkerOrchestrator = initializeWorkerOrchestrator;
exports.shutdownWorkerOrchestrator = shutdownWorkerOrchestrator;
const logger_1 = require("../logger");
const broadcast_worker_1 = require("./broadcast.worker");
const processing_worker_1 = require("./processing.worker");
const minutes_worker_1 = require("./minutes.worker");
class WorkerOrchestrator {
    isInitialized = false;
    initialiationStartTime = null;
    /**
     * Initialize all workers
     */
    async initialize(ioServer, processingService, minutesService) {
        try {
            this.initialiationStartTime = Date.now();
            logger_1.logger.info('Starting worker orchestrator initialization', {
                workers: ['broadcast', 'processing', 'minutes'],
            });
            // Start all workers in parallel
            await Promise.all([
                (0, broadcast_worker_1.startBroadcastWorker)(ioServer),
                (0, processing_worker_1.startProcessingWorker)(processingService),
                (0, minutes_worker_1.startMinutesWorker)(minutesService),
            ]);
            this.isInitialized = true;
            const initTime = Date.now() - this.initialiationStartTime;
            logger_1.logger.info('Worker orchestrator initialized successfully', {
                initTimeMs: initTime,
                workers: 3,
            });
        }
        catch (err) {
            logger_1.logger.error('Failed to initialize worker orchestrator', err);
            throw err;
        }
    }
    /**
     * Check health of all workers
     */
    async getHealthStatus() {
        try {
            const broadcastStatus = await broadcast_worker_1.broadcastWorker.getStatus();
            const processingStatus = await processing_worker_1.processingWorker.getStatus();
            const minutesWorker = (0, minutes_worker_1.getMinutesWorker)();
            const minutesStatus = await minutesWorker.getStatus();
            return {
                orchestratorReady: this.isInitialized,
                broadcast: {
                    healthy: broadcast_worker_1.broadcastWorker.isHealthy(),
                    ...broadcastStatus,
                },
                processing: {
                    healthy: processing_worker_1.processingWorker.isHealthy(),
                    ...processingStatus,
                },
                minutes: {
                    healthy: minutesWorker.isHealthy(),
                    ...minutesStatus,
                },
            };
        }
        catch (err) {
            logger_1.logger.error('Failed to get worker health status', err);
            return {
                orchestratorReady: false,
                broadcast: {
                    healthy: false,
                    running: false,
                    processed: 0,
                    failed: 0,
                },
                processing: {
                    healthy: false,
                    running: false,
                    processed: 0,
                    failed: 0,
                },
                minutes: {
                    healthy: false,
                    running: false,
                    processed: 0,
                    failed: 0,
                },
            };
        }
    }
    /**
     * Pause all workers
     */
    async pauseAll() {
        try {
            logger_1.logger.info('Pausing all workers');
            const minutesWorker = (0, minutes_worker_1.getMinutesWorker)();
            await Promise.all([broadcast_worker_1.broadcastWorker.pause(), processing_worker_1.processingWorker.pause(), minutesWorker.pause()]);
            logger_1.logger.info('All workers paused');
        }
        catch (err) {
            logger_1.logger.error('Failed to pause all workers', err);
        }
    }
    /**
     * Resume all workers
     */
    async resumeAll() {
        try {
            logger_1.logger.info('Resuming all workers');
            const minutesWorker = (0, minutes_worker_1.getMinutesWorker)();
            await Promise.all([broadcast_worker_1.broadcastWorker.resume(), processing_worker_1.processingWorker.resume(), minutesWorker.resume()]);
            logger_1.logger.info('All workers resumed');
        }
        catch (err) {
            logger_1.logger.error('Failed to resume all workers', err);
        }
    }
    /**
     * Gracefully shutdown all workers
     */
    async shutdown() {
        try {
            logger_1.logger.info('Starting worker orchestrator shutdown');
            // Pause workers to stop accepting new jobs
            await this.pauseAll();
            // Give workers time to finish current jobs
            await new Promise((resolve) => setTimeout(resolve, 2000));
            // Close workers
            await Promise.all([(0, broadcast_worker_1.stopBroadcastWorker)(), (0, processing_worker_1.stopProcessingWorker)(), (0, minutes_worker_1.stopMinutesWorker)()]);
            this.isInitialized = false;
            logger_1.logger.info('Worker orchestrator shutdown completed');
        }
        catch (err) {
            logger_1.logger.error('Error during worker orchestrator shutdown', err);
        }
    }
    /**
     * Check if orchestrator is initialized and healthy
     */
    isHealthy() {
        const minutesWorker = (0, minutes_worker_1.getMinutesWorker)();
        return this.isInitialized && broadcast_worker_1.broadcastWorker.isHealthy() && processing_worker_1.processingWorker.isHealthy() && minutesWorker.isHealthy();
    }
}
// Export singleton instance
exports.workerOrchestrator = new WorkerOrchestrator();
/**
 * Initialize worker orchestrator
 */
async function initializeWorkerOrchestrator(ioServer, processingService, minutesService) {
    await exports.workerOrchestrator.initialize(ioServer, processingService, minutesService);
}
/**
 * Shutdown worker orchestrator gracefully
 */
async function shutdownWorkerOrchestrator() {
    await exports.workerOrchestrator.shutdown();
}
//# sourceMappingURL=orchestrator.js.map