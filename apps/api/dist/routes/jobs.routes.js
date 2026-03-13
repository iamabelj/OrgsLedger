"use strict";
// ============================================================
// OrgsLedger API — Job Tracking Routes
// Query job status and dead letter queue
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const logger_1 = require("../logger");
const middleware_1 = require("../middleware");
const email_queue_1 = require("../queues/email.queue");
const notification_queue_1 = require("../queues/notification.queue");
const dlq_queue_1 = require("../queues/dlq.queue");
const router = (0, express_1.Router)();
/**
 * GET /api/jobs/:jobId
 * Get status of a specific job across all queues
 */
router.get('/jobs/:jobId', middleware_1.authenticate, async (req, res) => {
    try {
        const { jobId } = req.params;
        const queues = [
            { name: 'email', manager: (0, email_queue_1.getEmailQueueManager)() },
            { name: 'notification', manager: (0, notification_queue_1.getNotificationQueueManager)() },
        ];
        for (const { name, manager } of queues) {
            const queue = manager?.getQueue?.();
            if (!queue)
                continue;
            try {
                const job = await queue.getJob(jobId);
                if (job) {
                    const state = await job.getState();
                    const progress = job.progress();
                    return res.json({
                        jobId,
                        queue: name,
                        status: state,
                        progress,
                        data: job.data,
                        attemptsMade: job.attemptsMade,
                        maxAttempts: job.opts.attempts,
                        failedReason: job.failedReason,
                        createdAt: new Date(job.createdTimestamp).toISOString(),
                        processedAt: job.processedTimestamp ? new Date(job.processedTimestamp).toISOString() : null,
                    });
                }
            }
            catch (queueErr) {
                logger_1.logger.debug(`Checking job in ${name} queue failed`, queueErr);
            }
        }
        // Check DLQ
        const dlqJobs = await (0, dlq_queue_1.getDeadLetterJobs)();
        const dlqJob = dlqJobs.find(j => j.jobId === jobId);
        if (dlqJob) {
            return res.json({
                jobId,
                queue: 'dlq (dead-letter)',
                status: 'failed',
                failedReason: dlqJob.lastError,
                data: dlqJob.data,
                attemptsMade: dlqJob.attempts,
                maxAttempts: dlqJob.maxAttempts,
                failedAt: dlqJob.failedAt,
            });
        }
        res.status(404).json({ error: 'Job not found' });
    }
    catch (err) {
        logger_1.logger.error('Error getting job status', err);
        res.status(500).json({ error: 'Failed to get job status' });
    }
});
/**
 * GET /api/jobs/queue/:queueName
 * Get stats for a specific queue
 */
router.get('/jobs/queue/:queueName', middleware_1.authenticate, async (req, res) => {
    try {
        const { queueName } = req.params;
        const queues = {
            email: (0, email_queue_1.getEmailQueueManager)(),
            notification: (0, notification_queue_1.getNotificationQueueManager)(),
        };
        const manager = queues[queueName];
        if (!manager) {
            return res.status(404).json({ error: 'Queue not found' });
        }
        const queue = manager?.getQueue?.();
        if (!queue) {
            return res.status(503).json({ error: 'Queue not initialized' });
        }
        const counts = await queue.getJobCounts();
        const failed = await queue.getFailed(0, 10);
        res.json({
            queue: queueName,
            counts: {
                waiting: counts.waiting,
                active: counts.active,
                completed: counts.completed,
                failed: counts.failed,
                delayed: counts.delayed,
                paused: counts.paused,
            },
            recentFailures: failed.map((job) => ({
                jobId: job.id,
                failedReason: job.failedReason,
                attemptsMade: job.attemptsMade,
                failedAt: new Date(job.finishedOn).toISOString(),
            })),
        });
    }
    catch (err) {
        logger_1.logger.error('Error getting queue stats', err);
        res.status(500).json({ error: 'Failed to get queue stats' });
    }
});
/**
 * GET /api/jobs/dlq
 * Get dead letter queue contents
 */
router.get('/jobs/dlq', middleware_1.authenticate, requireRole('admin'), async (req, res) => {
    try {
        const { queue: filterQueue } = req.query;
        const dlqJobs = await (0, dlq_queue_1.getDeadLetterJobs)(filterQueue);
        res.json({
            totalDeadLetters: dlqJobs.length,
            jobs: dlqJobs.map(job => ({
                jobId: job.jobId,
                originalQueue: job.originalQueue,
                lastError: job.lastError,
                failedAt: job.failedAt,
                attempts: job.attempts,
                maxAttempts: job.maxAttempts,
            })),
        });
    }
    catch (err) {
        logger_1.logger.error('Error getting DLQ contents', err);
        res.status(500).json({ error: 'Failed to get DLQ contents' });
    }
});
/**
 * POST /api/jobs/dlq/:jobId/replay
 * Replay a dead letter job
 */
router.post('/jobs/dlq/:jobId/replay', middleware_1.authenticate, requireRole('admin'), async (req, res) => {
    try {
        const { jobId } = req.params;
        const dlqJobs = await (0, dlq_queue_1.getDeadLetterJobs)();
        const dlqJob = dlqJobs.find(j => j.jobId === jobId);
        if (!dlqJob) {
            return res.status(404).json({ error: 'Dead letter job not found' });
        }
        const queues = {
            email: (0, email_queue_1.getEmailQueueManager)(),
            notification: (0, notification_queue_1.getNotificationQueueManager)(),
        };
        const targetManager = queues[dlqJob.originalQueue];
        if (!targetManager) {
            return res.status(400).json({ error: `Queue ${dlqJob.originalQueue} not supported for replay` });
        }
        const targetQueue = targetManager?.getQueue?.();
        if (!targetQueue) {
            return res.status(503).json({ error: 'Target queue not initialized' });
        }
        const dlqQueue = (0, dlq_queue_1.getDeadLetterQueueManager)().getQueue();
        if (!dlqQueue) {
            return res.status(503).json({ error: 'DLQ not initialized' });
        }
        const success = await (0, dlq_queue_1.replayDeadLetterJob)(jobId, targetQueue);
        if (success) {
            res.json({ success: true, message: `Job ${jobId} replayed to ${dlqJob.originalQueue} queue` });
        }
        else {
            res.status(500).json({ error: 'Failed to replay job' });
        }
    }
    catch (err) {
        logger_1.logger.error('Error replaying DLQ job', err);
        res.status(500).json({ error: 'Failed to replay job' });
    }
});
// Helper to validate admin role
function requireRole(role) {
    return (req, res, next) => {
        const userRole = req.user?.globalRole;
        if (userRole !== role) {
            return res.status(403).json({ error: `Requires ${role} role` });
        }
        next();
    };
}
exports.default = router;
//# sourceMappingURL=jobs.routes.js.map