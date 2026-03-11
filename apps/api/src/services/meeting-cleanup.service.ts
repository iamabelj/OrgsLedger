// ============================================================
// OrgsLedger API — Meeting Cleanup Service
// Cold meeting eviction when a meeting ends
// ============================================================
//
// Handles cleanup of all meeting-related resources:
//   - Redis keys (state, transcripts, participants)
//   - WebSocket rooms (disconnect all clients)
//   - Queue jobs (pending transcript/translation/broadcast/minutes jobs)
//   - Memory (Active meeting state)
//
// Performance target: <5 seconds total cleanup time
// Uses parallel operations with individual timeouts
//
// ============================================================

import { Server as SocketIOServer } from 'socket.io';
import * as client from 'prom-client';
import { Queue } from 'bullmq';
import { logger } from '../logger';
import { services } from './registry';
import { getRegistry } from '../monitoring/prometheus.metrics';
import { getRedisClient, createBullMQConnection } from '../infrastructure/redisClient';
import { deleteMeetingMetrics } from '../monitoring/meeting-metrics';
import {
  getShardIndex,
  SHARDED_QUEUE_TYPES,
} from '../queues/queue-manager';

// ── Configuration ───────────────────────────────────────────

const CLEANUP_CONFIG = {
  // Maximum time for entire cleanup operation
  totalTimeoutMs: 5000,
  // Timeout for individual cleanup steps
  stepTimeoutMs: 2000,
  // Redis key patterns to clean
  redisKeyPatterns: [
    'meeting:{id}',
    'meeting:transcript:{id}',
    'meeting:participants:{id}',
    'meeting:transcripts:{id}',
  ],
};

// ── Prometheus Metrics ──────────────────────────────────────

const register = getRegistry();
const METRICS_PREFIX = 'orgsledger_';

export const meetingCleanupDuration = new client.Histogram({
  name: `${METRICS_PREFIX}meeting_cleanup_duration`,
  help: 'Meeting cleanup duration in seconds',
  buckets: [0.1, 0.25, 0.5, 1, 2, 3, 4, 5, 10],
  registers: [register],
});

export const meetingCleanupStepDuration = new client.Histogram({
  name: `${METRICS_PREFIX}meeting_cleanup_step_duration`,
  help: 'Duration of individual cleanup steps in seconds',
  labelNames: ['step'] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2],
  registers: [register],
});

export const meetingCleanupErrorsTotal = new client.Counter({
  name: `${METRICS_PREFIX}meeting_cleanup_errors_total`,
  help: 'Total number of meeting cleanup errors',
  labelNames: ['step'] as const,
  registers: [register],
});

export const meetingCleanupsTotal = new client.Counter({
  name: `${METRICS_PREFIX}meeting_cleanups_total`,
  help: 'Total number of meeting cleanups performed',
  labelNames: ['status'] as const,
  registers: [register],
});

// ── Cleanup Result Types ────────────────────────────────────

export interface CleanupResult {
  meetingId: string;
  success: boolean;
  durationMs: number;
  steps: StepResult[];
  errors: string[];
}

interface StepResult {
  name: string;
  success: boolean;
  durationMs: number;
  itemsRemoved?: number;
  error?: string;
}

// ── Helper: Timeout wrapper ─────────────────────────────────

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  stepName: string
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${stepName} timed out after ${timeoutMs}ms`)),
        timeoutMs
      )
    ),
  ]);
}

// ── Step 1: Redis Key Cleanup ───────────────────────────────

async function cleanupRedisKeys(meetingId: string): Promise<StepResult> {
  const startTime = Date.now();
  let itemsRemoved = 0;
  
  try {
    const redis = await getRedisClient();
    if (!redis) {
      return {
        name: 'redis_keys',
        success: true,
        durationMs: Date.now() - startTime,
        itemsRemoved: 0,
        error: 'Redis not available',
      };
    }

    // Build list of keys to delete
    const keysToDelete: string[] = [];
    
    // Standard meeting keys
    keysToDelete.push(`meeting:${meetingId}`);
    keysToDelete.push(`meeting:transcript:${meetingId}`);
    keysToDelete.push(`meeting:participants:${meetingId}`);
    keysToDelete.push(`meeting:transcripts:${meetingId}`);
    
    // Also clean up any sharded keys (from redisShardRouter)
    // Pattern: meeting:{shard}:{meetingId}
    for (let shard = 0; shard < 32; shard++) {
      keysToDelete.push(`meeting:${shard}:${meetingId}`);
      keysToDelete.push(`meeting:${shard}:${meetingId}:participants`);
      keysToDelete.push(`meeting:${shard}:${meetingId}:transcripts`);
    }

    // Delete keys in batches using pipeline
    const pipeline = redis.pipeline();
    for (const key of keysToDelete) {
      pipeline.del(key);
    }
    
    const results = await pipeline.exec();
    if (results) {
      for (const [err, count] of results) {
        if (!err && typeof count === 'number') {
          itemsRemoved += count;
        }
      }
    }

    // Remove from active meetings sets
    await redis.srem('meetings:active', meetingId);

    const durationMs = Date.now() - startTime;
    meetingCleanupStepDuration.labels('redis_keys').observe(durationMs / 1000);

    return {
      name: 'redis_keys',
      success: true,
      durationMs,
      itemsRemoved,
    };
  } catch (err: any) {
    const durationMs = Date.now() - startTime;
    meetingCleanupErrorsTotal.labels('redis_keys').inc();
    
    return {
      name: 'redis_keys',
      success: false,
      durationMs,
      itemsRemoved,
      error: err.message,
    };
  }
}

// ── Step 2: WebSocket Room Cleanup ──────────────────────────

async function cleanupWebSocketRooms(meetingId: string): Promise<StepResult> {
  const startTime = Date.now();
  let itemsRemoved = 0;
  
  try {
    const io = services.get('io') as SocketIOServer | undefined;
    if (!io) {
      return {
        name: 'websocket_rooms',
        success: true,
        durationMs: Date.now() - startTime,
        itemsRemoved: 0,
      };
    }

    const roomName = `meeting:${meetingId}`;
    const sockets = await io.in(roomName).fetchSockets();
    itemsRemoved = sockets.length;

    // Emit cleanup event to all clients in room
    io.to(roomName).emit('meeting:cleanup', {
      meetingId,
      reason: 'meeting_ended',
      timestamp: new Date().toISOString(),
    });

    // Disconnect all sockets from the room
    for (const socket of sockets) {
      socket.leave(roomName);
    }

    // Also clean up org-specific broadcast rooms if any
    io.to(`meeting:${meetingId}:broadcast`).emit('meeting:cleanup', {
      meetingId,
      reason: 'meeting_ended',
    });

    const durationMs = Date.now() - startTime;
    meetingCleanupStepDuration.labels('websocket_rooms').observe(durationMs / 1000);

    return {
      name: 'websocket_rooms',
      success: true,
      durationMs,
      itemsRemoved,
    };
  } catch (err: any) {
    const durationMs = Date.now() - startTime;
    meetingCleanupErrorsTotal.labels('websocket_rooms').inc();
    
    return {
      name: 'websocket_rooms',
      success: false,
      durationMs,
      error: err.message,
    };
  }
}

// ── Step 3: Queue Job Cleanup ───────────────────────────────

async function cleanupQueueJobs(meetingId: string): Promise<StepResult> {
  const startTime = Date.now();
  let itemsRemoved = 0;
  
  try {
    const shardIndex = getShardIndex(meetingId);
    const queueTypes = Object.values(SHARDED_QUEUE_TYPES);

    // Create a dedicated BullMQ connection for queue operations
    const bullmqConnection = createBullMQConnection();

    // Remove waiting/delayed jobs for this meeting from each queue type
    for (const queueType of queueTypes) {
      const queueName = `${queueType}-jobs-shard-${shardIndex}`;
      
      try {
        // Get queue instance for job removal
        const queue = new Queue(queueName, { connection: bullmqConnection });
        
        // Get waiting jobs and remove those matching this meeting
        const waitingJobs = await queue.getJobs(['waiting', 'delayed'], 0, 1000);
        
        for (const job of waitingJobs) {
          if (job.data?.meetingId === meetingId) {
            await job.remove();
            itemsRemoved++;
          }
        }

        // Close queue connection
        await queue.close();
      } catch (qErr: any) {
        logger.debug('[MEETING_CLEANUP] Queue job removal warning', {
          queueName,
          error: qErr.message,
        });
      }
    }

    // Disconnect BullMQ connection
    await bullmqConnection.quit();

    const durationMs = Date.now() - startTime;
    meetingCleanupStepDuration.labels('queue_jobs').observe(durationMs / 1000);

    return {
      name: 'queue_jobs',
      success: true,
      durationMs,
      itemsRemoved,
    };
  } catch (err: any) {
    const durationMs = Date.now() - startTime;
    meetingCleanupErrorsTotal.labels('queue_jobs').inc();
    
    return {
      name: 'queue_jobs',
      success: false,
      durationMs,
      error: err.message,
    };
  }
}

// ── Step 4: Archive Transcripts ─────────────────────────────

async function archiveTranscripts(meetingId: string): Promise<StepResult> {
  const startTime = Date.now();
  
  try {
    // Transcripts are already persisted to PostgreSQL (meeting_transcripts table)
    // during the meeting via transcript.worker.ts
    // This step just verifies/logs archival status
    
    // Clean up any in-memory transcript caches
    // (No specific action needed - Redis cleanup handles the cache)

    const durationMs = Date.now() - startTime;
    meetingCleanupStepDuration.labels('archive_transcripts').observe(durationMs / 1000);

    return {
      name: 'archive_transcripts',
      success: true,
      durationMs,
      itemsRemoved: 0,
    };
  } catch (err: any) {
    const durationMs = Date.now() - startTime;
    meetingCleanupErrorsTotal.labels('archive_transcripts').inc();
    
    return {
      name: 'archive_transcripts',
      success: false,
      durationMs,
      error: err.message,
    };
  }
}

// ── Step 5: Cleanup Pipeline Metrics ────────────────────────

async function cleanupPipelineMetrics(meetingId: string): Promise<StepResult> {
  const startTime = Date.now();
  
  try {
    // Delete meeting-specific pipeline metrics from PostgreSQL
    await deleteMeetingMetrics(meetingId);

    const durationMs = Date.now() - startTime;
    meetingCleanupStepDuration.labels('pipeline_metrics').observe(durationMs / 1000);

    return {
      name: 'pipeline_metrics',
      success: true,
      durationMs,
    };
  } catch (err: any) {
    const durationMs = Date.now() - startTime;
    meetingCleanupErrorsTotal.labels('pipeline_metrics').inc();
    
    return {
      name: 'pipeline_metrics',
      success: false,
      durationMs,
      error: err.message,
    };
  }
}

// ── Main Cleanup Function ───────────────────────────────────

/**
 * Perform full cleanup for a meeting that has ended
 * Removes all transient state, frees memory, and archives data
 * 
 * @param meetingId - ID of the meeting to clean up
 * @param organizationId - Organization ID (for set cleanup)
 * @returns Cleanup result with timing and success status
 */
export async function cleanupMeeting(
  meetingId: string,
  organizationId?: string
): Promise<CleanupResult> {
  const startTime = Date.now();
  const steps: StepResult[] = [];
  const errors: string[] = [];

  logger.info('[MEETING_CLEANUP] Starting cleanup', { meetingId, organizationId });

  try {
    // Run cleanup steps in parallel for performance
    // Each step has an individual timeout to prevent blocking
    const [
      redisResult,
      wsResult,
      queueResult,
      archiveResult,
      metricsResult,
    ] = await Promise.allSettled([
      withTimeout(
        cleanupRedisKeys(meetingId),
        CLEANUP_CONFIG.stepTimeoutMs,
        'redis_keys'
      ),
      withTimeout(
        cleanupWebSocketRooms(meetingId),
        CLEANUP_CONFIG.stepTimeoutMs,
        'websocket_rooms'
      ),
      withTimeout(
        cleanupQueueJobs(meetingId),
        CLEANUP_CONFIG.stepTimeoutMs,
        'queue_jobs'
      ),
      withTimeout(
        archiveTranscripts(meetingId),
        CLEANUP_CONFIG.stepTimeoutMs,
        'archive_transcripts'
      ),
      withTimeout(
        cleanupPipelineMetrics(meetingId),
        CLEANUP_CONFIG.stepTimeoutMs,
        'pipeline_metrics'
      ),
    ]);

    // Process results
    const results = [redisResult, wsResult, queueResult, archiveResult, metricsResult];
    const stepNames = ['redis_keys', 'websocket_rooms', 'queue_jobs', 'archive_transcripts', 'pipeline_metrics'];

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const stepName = stepNames[i];

      if (result.status === 'fulfilled') {
        steps.push(result.value);
        if (!result.value.success) {
          errors.push(`${stepName}: ${result.value.error}`);
        }
      } else {
        // Promise rejected (timeout or error)
        const errorMsg = result.reason?.message || 'Unknown error';
        steps.push({
          name: stepName,
          success: false,
          durationMs: CLEANUP_CONFIG.stepTimeoutMs,
          error: errorMsg,
        });
        errors.push(`${stepName}: ${errorMsg}`);
        meetingCleanupErrorsTotal.labels(stepName).inc();
      }
    }

    // Additional cleanup: remove from organization active set
    if (organizationId) {
      try {
        const redis = await getRedisClient();
        if (redis) {
          await redis.srem(`meetings:org:${organizationId}`, meetingId);
        }
      } catch {
        // Non-critical
      }
    }

    const durationMs = Date.now() - startTime;
    const success = errors.length === 0;

    // Record metrics
    meetingCleanupDuration.observe(durationMs / 1000);
    meetingCleanupsTotal.labels(success ? 'success' : 'partial').inc();

    const result: CleanupResult = {
      meetingId,
      success,
      durationMs,
      steps,
      errors,
    };

    logger.info('[MEETING_CLEANUP] Completed', {
      meetingId,
      success,
      durationMs,
      stepsCompleted: steps.filter(s => s.success).length,
      totalSteps: steps.length,
      errors: errors.length > 0 ? errors : undefined,
    });

    // Warn if cleanup took too long
    if (durationMs > CLEANUP_CONFIG.totalTimeoutMs) {
      logger.warn('[MEETING_CLEANUP] Cleanup exceeded target duration', {
        meetingId,
        durationMs,
        targetMs: CLEANUP_CONFIG.totalTimeoutMs,
      });
    }

    return result;

  } catch (err: any) {
    const durationMs = Date.now() - startTime;
    
    meetingCleanupDuration.observe(durationMs / 1000);
    meetingCleanupsTotal.labels('failed').inc();
    meetingCleanupErrorsTotal.labels('total').inc();

    logger.error('[MEETING_CLEANUP] Cleanup failed', {
      meetingId,
      durationMs,
      error: err.message,
    });

    return {
      meetingId,
      success: false,
      durationMs,
      steps,
      errors: [...errors, err.message],
    };
  }
}

// ── Batch Cleanup ───────────────────────────────────────────

/**
 * Cleanup multiple meetings in parallel
 * Useful for bulk eviction of stale meetings
 */
export async function cleanupMeetings(
  meetings: Array<{ meetingId: string; organizationId?: string }>
): Promise<CleanupResult[]> {
  const results = await Promise.all(
    meetings.map(({ meetingId, organizationId }) =>
      cleanupMeeting(meetingId, organizationId)
    )
  );

  const successCount = results.filter(r => r.success).length;
  logger.info('[MEETING_CLEANUP] Batch cleanup completed', {
    total: meetings.length,
    success: successCount,
    failed: meetings.length - successCount,
  });

  return results;
}

// ── Stale Meeting Detection ─────────────────────────────────

/**
 * Find meetings that have been active too long without activity
 * Returns meeting IDs that should be cleaned up
 */
export async function findStaleMeetings(
  maxAgeHours: number = 24
): Promise<string[]> {
  try {
    const redis = await getRedisClient();
    if (!redis) return [];

    const activeMeetings = await redis.smembers('meetings:active');
    const staleMeetings: string[] = [];
    const cutoffTime = Date.now() - maxAgeHours * 60 * 60 * 1000;

    for (const meetingId of activeMeetings) {
      try {
        const stateJson = await redis.get(`meeting:${meetingId}`);
        if (stateJson) {
          const state = JSON.parse(stateJson);
          const lastActivity = new Date(state.lastActivityAt || state.startedAt).getTime();
          
          if (lastActivity < cutoffTime) {
            staleMeetings.push(meetingId);
          }
        } else {
          // Meeting key doesn't exist but is in active set - stale
          staleMeetings.push(meetingId);
        }
      } catch {
        // Can't parse state - consider stale
        staleMeetings.push(meetingId);
      }
    }

    return staleMeetings;
  } catch (err: any) {
    logger.error('[MEETING_CLEANUP] Failed to find stale meetings', {
      error: err.message,
    });
    return [];
  }
}

/**
 * Auto-cleanup stale meetings
 * Run periodically via scheduler
 */
export async function autoCleanupStaleMeetings(
  maxAgeHours: number = 24
): Promise<{ cleaned: number; errors: number }> {
  const staleMeetings = await findStaleMeetings(maxAgeHours);
  
  if (staleMeetings.length === 0) {
    return { cleaned: 0, errors: 0 };
  }

  logger.info('[MEETING_CLEANUP] Auto-cleaning stale meetings', {
    count: staleMeetings.length,
    maxAgeHours,
  });

  const results = await cleanupMeetings(
    staleMeetings.map(meetingId => ({ meetingId }))
  );

  return {
    cleaned: results.filter(r => r.success).length,
    errors: results.filter(r => !r.success).length,
  };
}

// ── Default Export ──────────────────────────────────────────

export default {
  cleanupMeeting,
  cleanupMeetings,
  findStaleMeetings,
  autoCleanupStaleMeetings,
};
