// ============================================================
// OrgsLedger API — Audit Log Queue
// Async queue for audit logging
// Ensures audit logs are captured even under high load
// ============================================================

import { Queue, QueueOptions } from 'bullmq';
import { getRedisClient } from '../infrastructure/redisClient';
import { logger } from '../logger';

export interface AuditJobData {
  organizationId?: string;
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  previousValue?: Record<string, unknown>;
  newValue?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

class AuditQueueManager {
  private queue: Queue<AuditJobData> | null = null;
  private initialized = false;

  async initialize(): Promise<Queue<AuditJobData>> {
    if (this.queue) {
      return this.queue;
    }

    try {
      const redis = await getRedisClient();

      const queueOptions: QueueOptions = {
        connection: redis,
        defaultJobOptions: {
          removeOnComplete: {
            age: 259200, // Keep for 3 days
          },
          attempts: parseInt(process.env.AUDIT_JOB_RETRIES || '5', 10),
          backoff: {
            type: 'exponential',
            delay: 500, // Fast backoff for audits
          },
        },
      };

      this.queue = new Queue<AuditJobData>('audit-logs', queueOptions);
      this.initialized = true;

      logger.info('Audit queue initialized');

      return this.queue;
    } catch (err) {
      logger.error('Failed to initialize audit queue', err);
      throw err;
    }
  }

  getQueue(): Queue<AuditJobData> | null {
    return this.queue;
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}

const auditQueueManager = new AuditQueueManager();

export async function initializeAuditQueue(): Promise<Queue<AuditJobData>> {
  return auditQueueManager.initialize();
}

export async function submitAuditJob(data: AuditJobData): Promise<void> {
  const queue = auditQueueManager.getQueue();
  if (!queue) {
    logger.warn('Audit queue not initialized, falling back to direct write');
    return;
  }

  try {
    await queue.add(
      'write-audit-log',
      data,
      {
        jobId: `audit:${data.userId}:${data.action}:${Date.now()}`,
      }
    );
  } catch (err) {
    logger.error('Failed to submit audit job', {
      userId: data.userId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function getAuditQueueManager() {
  return auditQueueManager;
}
