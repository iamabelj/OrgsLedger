// ============================================================
// OrgsLedger API — Job Tracking Routes
// Query job status and dead letter queue
// ============================================================

import { Router, Request, Response } from 'express';
import { logger } from '../logger';
import { authenticate, validate } from '../middleware';
import { z } from 'zod';
import { getEmailQueueManager } from '../queues/email.queue';
import { getNotificationQueueManager } from '../queues/notification.queue';
import { getDeadLetterJobs, replayDeadLetterJob, getDeadLetterQueueManager } from '../queues/dlq.queue';

const router = Router();

/**
 * GET /api/jobs/:jobId
 * Get status of a specific job across all queues
 */
router.get('/jobs/:jobId', authenticate, async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;

    const queues = [
      { name: 'email', manager: getEmailQueueManager() },
      { name: 'notification', manager: getNotificationQueueManager() },
    ];

    for (const { name, manager } of queues) {
      const queue = manager?.getQueue?.();
      if (!queue) continue;

      try {
        const job = await (queue as any).getJob(jobId);
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
      } catch (queueErr) {
        logger.debug(`Checking job in ${name} queue failed`, queueErr);
      }
    }

    // Check DLQ
    const dlqJobs = await getDeadLetterJobs();
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
  } catch (err) {
    logger.error('Error getting job status', err);
    res.status(500).json({ error: 'Failed to get job status' });
  }
});

/**
 * GET /api/jobs/queue/:queueName
 * Get stats for a specific queue
 */
router.get('/jobs/queue/:queueName', authenticate, async (req: Request, res: Response) => {
  try {
    const { queueName } = req.params;

    // Meeting pipeline status — reserved for future rebuild
    if (queueName === 'meeting-pipeline') {
      return res.status(404).json({ error: 'Meeting pipeline not yet implemented' });
    }

    const queues: Record<string, any> = {
      email: getEmailQueueManager(),
      notification: getNotificationQueueManager(),
    };

    const manager = queues[queueName];
    if (!manager) {
      return res.status(404).json({ error: 'Queue not found' });
    }

    const queue = manager?.getQueue?.();
    if (!queue) {
      return res.status(503).json({ error: 'Queue not initialized' });
    }

    const counts = await (queue as any).getJobCounts();
    const failed = await (queue as any).getFailed(0, 10);

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
      recentFailures: failed.map((job: any) => ({
        jobId: job.id,
        failedReason: job.failedReason,
        attemptsMade: job.attemptsMade,
        failedAt: new Date(job.finishedOn).toISOString(),
      })),
    });
  } catch (err) {
    logger.error('Error getting queue stats', err);
    res.status(500).json({ error: 'Failed to get queue stats' });
  }
});

/**
 * GET /api/jobs/dlq
 * Get dead letter queue contents
 */
router.get('/jobs/dlq', authenticate, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const { queue: filterQueue } = req.query;

    const dlqJobs = await getDeadLetterJobs(filterQueue as string | undefined);

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
  } catch (err) {
    logger.error('Error getting DLQ contents', err);
    res.status(500).json({ error: 'Failed to get DLQ contents' });
  }
});

/**
 * POST /api/jobs/dlq/:jobId/replay
 * Replay a dead letter job
 */
router.post('/jobs/dlq/:jobId/replay', authenticate, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;

    const dlqJobs = await getDeadLetterJobs();
    const dlqJob = dlqJobs.find(j => j.jobId === jobId);

    if (!dlqJob) {
      return res.status(404).json({ error: 'Dead letter job not found' });
    }

    const queues: Record<string, any> = {
      email: getEmailQueueManager(),
      notification: getNotificationQueueManager(),
    };

    const targetManager = queues[dlqJob.originalQueue];
    if (!targetManager) {
      return res.status(400).json({ error: `Queue ${dlqJob.originalQueue} not supported for replay` });
    }

    const targetQueue = targetManager?.getQueue?.();
    if (!targetQueue) {
      return res.status(503).json({ error: 'Target queue not initialized' });
    }

    const dlqQueue = getDeadLetterQueueManager().getQueue();
    if (!dlqQueue) {
      return res.status(503).json({ error: 'DLQ not initialized' });
    }

    const success = await replayDeadLetterJob(jobId, targetQueue);

    if (success) {
      res.json({ success: true, message: `Job ${jobId} replayed to ${dlqJob.originalQueue} queue` });
    } else {
      res.status(500).json({ error: 'Failed to replay job' });
    }
  } catch (err) {
    logger.error('Error replaying DLQ job', err);
    res.status(500).json({ error: 'Failed to replay job' });
  }
});

// Helper to validate admin role
function requireRole(role: string) {
  return (req: Request, res: Response, next: any) => {
    const userRole = (req as any).user?.globalRole;
    if (userRole !== role) {
      return res.status(403).json({ error: `Requires ${role} role` });
    }
    next();
  };
}

export default router;
