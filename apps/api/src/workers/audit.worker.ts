// ============================================================
// OrgsLedger API — Audit Worker
// Processes audit log jobs from queue
// ============================================================

import { Worker, Job } from 'bullmq';
import { getRedisClient } from '../infrastructure/redisClient';
import { logger } from '../logger';
import { AuditJobData } from '../queues/audit.queue';
import db from '../db';

class AuditWorker {
  private worker: Worker<AuditJobData> | null = null;
  private isRunning = false;
  private processedCount = 0;
  private failedCount = 0;

  async initialize(): Promise<void> {
    try {
      const redis = await getRedisClient();

      this.worker = new Worker<AuditJobData>(
        'audit-logs',
        async (job: Job<AuditJobData>) => {
          return this.processAuditJob(job);
        },
        {
          connection: redis as any,
          concurrency: parseInt(process.env.AUDIT_WORKER_CONCURRENCY || '10', 10),
          maxStalledCount: 3,
          stalledInterval: 2000,
          lockDuration: 10000,
          lockRenewTime: 2000,
        }
      );

      this.worker.on('ready', () => {
        logger.info('Audit worker ready');
        this.isRunning = true;
      });

      this.worker.on('error', (err: Error) => {
        logger.error('Audit worker error', err);
      });

      this.worker.on('failed', (job: Job<AuditJobData> | undefined, err: Error) => {
        this.failedCount++;
        logger.error(`Audit job ${job?.id} permanently failed after retries`, {
          jobId: job?.id,
          userId: job?.data.userId,
          action: job?.data.action,
          error: err.message,
        });
      });

      this.worker.on('completed', (job: Job<AuditJobData>) => {
        this.processedCount++;
      });

      logger.info('Audit worker initialized');
    } catch (err) {
      logger.error('Failed to initialize audit worker', err);
      throw err;
    }
  }

  private async processAuditJob(job: Job<AuditJobData>): Promise<{ success: boolean }> {
    const { organizationId, userId, action, entityType, entityId, previousValue, newValue, ipAddress, userAgent } = job.data;

    try {
      await db('audit_logs').insert({
        organization_id: organizationId || null,
        user_id: userId,
        action,
        entity_type: entityType,
        entity_id: entityId,
        previous_value: previousValue ? JSON.stringify(previousValue) : null,
        new_value: newValue ? JSON.stringify(newValue) : null,
        ip_address: ipAddress || null,
        user_agent: userAgent || null,
      });

      return { success: true };
    } catch (err) {
      logger.error(`Audit job ${job.id} error`, {
        jobId: job.id,
        userId,
        error: err instanceof Error ? err.message : String(err),
      });

      throw err;
    }
  }

  async stop(): Promise<void> {
    try {
      if (this.worker) {
        await this.worker.close();
        this.isRunning = false;
        logger.info('Audit worker stopped');
      }
    } catch (err) {
      logger.error('Error stopping audit worker', err);
    }
  }

  async pause(): Promise<void> {
    try {
      if (this.worker) {
        await (this.worker as any).pause();
      }
    } catch (err) {
      logger.error('Error pausing audit worker', err);
    }
  }

  async resume(): Promise<void> {
    try {
      if (this.worker) {
        await (this.worker as any).resume();
      }
    } catch (err) {
      logger.error('Error resuming audit worker', err);
    }
  }

  async getStatus(): Promise<{
    running: boolean;
    processed: number;
    failed: number;
  }> {
    return {
      running: this.isRunning,
      processed: this.processedCount,
      failed: this.failedCount,
    };
  }

  isHealthy(): boolean {
    return this.isRunning && this.worker !== null;
  }
}

const auditWorkerInstance = new AuditWorker();

export async function startAuditWorker(): Promise<void> {
  await auditWorkerInstance.initialize();
}

export async function stopAuditWorker(): Promise<void> {
  await auditWorkerInstance.stop();
}

export function getAuditWorker() {
  return auditWorkerInstance;
}
