// ============================================================
// OrgsLedger API — Event Replay Worker
// Background job to retry failed queue submissions
// ============================================================
//
// Architecture:
//   - Runs every 30 seconds (configurable)
//   - Fetches unprocessed events from PostgreSQL
//   - Attempts to re-submit to BullMQ queues
//   - Marks events as processed on success
//   - Uses exponential backoff via retry_count
//
// Protections:
//   - Duplicate prevention using event IDs
//   - Max retry limit (default: 5)
//   - Batch processing to avoid overwhelming queues
//   - Leader election for distributed deployments
//
// Environment Variables:
//   EVENT_REPLAY_INTERVAL_MS=30000
//   EVENT_REPLAY_BATCH_SIZE=100
//   EVENT_REPLAY_MAX_RETRIES=5
//
// ============================================================

import * as client from 'prom-client';
import { createBullMQConnection } from '../infrastructure/redisClient';
import { logger } from '../logger';
import {
  eventStore,
  getUnprocessedEvents,
  MeetingEvent,
  initializeEventStore,
} from '../events/event-store';
import { eventQueueBridge, initializeEventBridge } from '../events/event-queue-bridge';
import { WORKER_ID, logWorkerIdentity } from '../scaling/worker-identity';

// ── Configuration ───────────────────────────────────────────

const REPLAY_CONFIG = {
  /** Interval between replay cycles (default: 30 seconds) */
  intervalMs: parseInt(process.env.EVENT_REPLAY_INTERVAL_MS || '30000', 10),
  
  /** Maximum events to process per cycle */
  batchSize: parseInt(process.env.EVENT_REPLAY_BATCH_SIZE || '100', 10),
  
  /** Maximum retry attempts before giving up */
  maxRetries: parseInt(process.env.EVENT_REPLAY_MAX_RETRIES || '5', 10),
  
  /** Minimum delay between retries for same event (exponential backoff base) */
  baseBackoffMs: 5000,
  
  /** Leader election key for distributed deployments */
  leaderKey: 'event-replay:leader',
  
  /** Leader lock TTL in seconds */
  leaderTtlSeconds: 60,
};

// ── Prometheus Metrics ──────────────────────────────────────

const replayAttemptsTotal = new client.Counter({
  name: 'orgsledger_event_replay_attempts_total',
  help: 'Total number of event replay attempts',
  labelNames: ['event_type'] as const,
});

const replaySuccessTotal = new client.Counter({
  name: 'orgsledger_event_replay_success_total',
  help: 'Total number of successful event replays',
  labelNames: ['event_type'] as const,
});

const replayFailuresTotal = new client.Counter({
  name: 'orgsledger_event_replay_failures_total',
  help: 'Total number of failed event replays',
  labelNames: ['event_type'] as const,
});

const replayCycleLatency = new client.Histogram({
  name: 'orgsledger_event_replay_cycle_latency_ms',
  help: 'Latency of event replay cycles in milliseconds',
  buckets: [100, 250, 500, 1000, 2500, 5000, 10000, 30000],
});

const replayPendingGauge = new client.Gauge({
  name: 'orgsledger_event_replay_pending',
  help: 'Number of events pending replay',
});

const replayLastCycleTimestamp = new client.Gauge({
  name: 'orgsledger_event_replay_last_cycle_timestamp',
  help: 'Unix timestamp of the last replay cycle',
});

// ── Event Replay Worker Class ───────────────────────────────

class EventReplayWorker {
  private isRunning = false;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private redis: any = null;
  private isLeader = false;
  private leaderCheckInterval: ReturnType<typeof setInterval> | null = null;
  
  // Stats
  private cycleCount = 0;
  private totalReplayed = 0;
  private totalFailed = 0;
  
  // ── Initialization ──────────────────────────────────────────
  
  /**
   * Initialize and start the replay worker.
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('[EVENT_REPLAY] Worker already running');
      return;
    }
    
    try {
      // Initialize dependencies
      await initializeEventBridge();
      
      // Get Redis connection for leader election
      this.redis = createBullMQConnection();
      
      logWorkerIdentity('EVENT_REPLAY_WORKER');
      
      logger.info('[EVENT_REPLAY] Starting worker', {
        workerId: WORKER_ID,
        intervalMs: REPLAY_CONFIG.intervalMs,
        batchSize: REPLAY_CONFIG.batchSize,
        maxRetries: REPLAY_CONFIG.maxRetries,
      });
      
      this.isRunning = true;
      
      // Start leader election
      await this.startLeaderElection();
      
      // Run immediately on start
      await this.runReplayCycle();
      
      // Schedule periodic runs
      this.intervalHandle = setInterval(async () => {
        if (this.isLeader) {
          await this.runReplayCycle();
        }
      }, REPLAY_CONFIG.intervalMs);
      
      // Don't block process exit
      if (this.intervalHandle.unref) {
        this.intervalHandle.unref();
      }
      
      logger.info('[EVENT_REPLAY] Worker started successfully');
    } catch (err) {
      logger.error('[EVENT_REPLAY] Failed to start worker', { error: err });
      this.isRunning = false;
      throw err;
    }
  }
  
  /**
   * Stop the replay worker.
   */
  async stop(): Promise<void> {
    logger.info('[EVENT_REPLAY] Stopping worker');
    
    this.isRunning = false;
    
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    
    if (this.leaderCheckInterval) {
      clearInterval(this.leaderCheckInterval);
      this.leaderCheckInterval = null;
    }
    
    // Release leader lock
    if (this.isLeader && this.redis) {
      try {
        await this.redis.del(REPLAY_CONFIG.leaderKey);
      } catch (err) {
        logger.warn('[EVENT_REPLAY] Failed to release leader lock', { error: err });
      }
    }
    
    logger.info('[EVENT_REPLAY] Worker stopped', {
      cycleCount: this.cycleCount,
      totalReplayed: this.totalReplayed,
      totalFailed: this.totalFailed,
    });
  }
  
  // ── Leader Election ─────────────────────────────────────────
  
  /**
   * Start leader election for distributed deployments.
   * Only the leader instance processes replay events.
   */
  private async startLeaderElection(): Promise<void> {
    // Try to become leader immediately
    await this.tryBecomeLeader();
    
    // Periodically try to become leader (in case current leader fails)
    this.leaderCheckInterval = setInterval(async () => {
      await this.tryBecomeLeader();
    }, REPLAY_CONFIG.leaderTtlSeconds * 1000 / 2);
    
    if (this.leaderCheckInterval.unref) {
      this.leaderCheckInterval.unref();
    }
  }
  
  private async tryBecomeLeader(): Promise<void> {
    if (!this.redis) return;
    
    try {
      // Try to acquire the leader lock
      const acquired = await this.redis.set(
        REPLAY_CONFIG.leaderKey,
        WORKER_ID,
        'NX', // Only set if not exists
        'EX', // Set expiry
        REPLAY_CONFIG.leaderTtlSeconds
      );
      
      if (acquired) {
        if (!this.isLeader) {
          logger.info('[EVENT_REPLAY] Acquired leader lock', { workerId: WORKER_ID });
        }
        this.isLeader = true;
      } else {
        // Check if we're still the leader (refresh TTL)
        const currentLeader = await this.redis.get(REPLAY_CONFIG.leaderKey);
        
        if (currentLeader === WORKER_ID) {
          // Refresh TTL
          await this.redis.expire(REPLAY_CONFIG.leaderKey, REPLAY_CONFIG.leaderTtlSeconds);
          this.isLeader = true;
        } else {
          if (this.isLeader) {
            logger.info('[EVENT_REPLAY] Lost leader lock', {
              workerId: WORKER_ID,
              newLeader: currentLeader,
            });
          }
          this.isLeader = false;
        }
      }
    } catch (err) {
      logger.error('[EVENT_REPLAY] Leader election error', { error: err });
      // Assume we're not the leader on errors
      this.isLeader = false;
    }
  }
  
  // ── Replay Cycle ────────────────────────────────────────────
  
  /**
   * Run a single replay cycle.
   */
  private async runReplayCycle(): Promise<void> {
    const startTime = Date.now();
    
    try {
      this.cycleCount++;
      
      // Fetch unprocessed events
      const events = await getUnprocessedEvents(
        REPLAY_CONFIG.batchSize,
        REPLAY_CONFIG.maxRetries
      );
      
      replayPendingGauge.set(events.length);
      
      if (events.length === 0) {
        logger.debug('[EVENT_REPLAY] No events to replay');
        replayCycleLatency.observe(Date.now() - startTime);
        replayLastCycleTimestamp.set(Date.now() / 1000);
        return;
      }
      
      logger.info('[EVENT_REPLAY] Processing replay cycle', {
        eventCount: events.length,
        cycleNumber: this.cycleCount,
      });
      
      let replayed = 0;
      let failed = 0;
      
      // Process events with backoff consideration
      for (const event of events) {
        // Check if event is eligible for retry (exponential backoff)
        if (!this.isEligibleForRetry(event)) {
          continue;
        }
        
        const result = await this.replayEvent(event);
        
        if (result.success) {
          replayed++;
          this.totalReplayed++;
          replaySuccessTotal.inc({ event_type: event.eventType });
        } else {
          failed++;
          this.totalFailed++;
          replayFailuresTotal.inc({ event_type: event.eventType });
        }
        
        replayAttemptsTotal.inc({ event_type: event.eventType });
      }
      
      const duration = Date.now() - startTime;
      replayCycleLatency.observe(duration);
      replayLastCycleTimestamp.set(Date.now() / 1000);
      
      logger.info('[EVENT_REPLAY] Replay cycle complete', {
        cycleNumber: this.cycleCount,
        processed: events.length,
        replayed,
        failed,
        durationMs: duration,
      });
    } catch (err) {
      const duration = Date.now() - startTime;
      replayCycleLatency.observe(duration);
      
      logger.error('[EVENT_REPLAY] Replay cycle failed', {
        cycleNumber: this.cycleCount,
        error: err,
        durationMs: duration,
      });
    }
  }
  
  /**
   * Check if an event is eligible for retry based on exponential backoff.
   */
  private isEligibleForRetry(event: MeetingEvent): boolean {
    if (event.retryCount === 0) {
      return true;
    }
    
    // Calculate backoff delay: baseBackoff * 2^retryCount
    const backoffMs = REPLAY_CONFIG.baseBackoffMs * Math.pow(2, event.retryCount - 1);
    const eligibleTime = event.createdAt.getTime() + backoffMs;
    
    return Date.now() >= eligibleTime;
  }
  
  /**
   * Replay a single event.
   */
  private async replayEvent(event: MeetingEvent): Promise<{ success: boolean; error?: string }> {
    try {
      logger.debug('[EVENT_REPLAY] Replaying event', {
        eventId: event.id,
        eventType: event.eventType,
        meetingId: event.meetingId,
        retryCount: event.retryCount,
      });
      
      const result = await eventQueueBridge.replayEvent(event.id);
      
      if (result.queued) {
        logger.debug('[EVENT_REPLAY] Event replayed successfully', {
          eventId: event.id,
          jobId: result.jobId,
        });
        return { success: true };
      } else {
        logger.warn('[EVENT_REPLAY] Event replay failed', {
          eventId: event.id,
          error: result.error,
        });
        return { success: false, error: result.error };
      }
    } catch (err: any) {
      logger.error('[EVENT_REPLAY] Unexpected error during replay', {
        eventId: event.id,
        error: err.message,
      });
      
      // Mark as failed
      try {
        await eventStore.markEventFailed(event.id, err.message);
      } catch (markErr) {
        logger.error('[EVENT_REPLAY] Failed to mark event as failed', {
          eventId: event.id,
          error: markErr,
        });
      }
      
      return { success: false, error: err.message };
    }
  }
  
  // ── Status ──────────────────────────────────────────────────
  
  /**
   * Get worker status.
   */
  getStatus(): {
    isRunning: boolean;
    isLeader: boolean;
    cycleCount: number;
    totalReplayed: number;
    totalFailed: number;
  } {
    return {
      isRunning: this.isRunning,
      isLeader: this.isLeader,
      cycleCount: this.cycleCount,
      totalReplayed: this.totalReplayed,
      totalFailed: this.totalFailed,
    };
  }
}

// ── Singleton Instance ──────────────────────────────────────

const eventReplayWorker = new EventReplayWorker();

// ── Exports ─────────────────────────────────────────────────

export {
  eventReplayWorker,
  EventReplayWorker,
  REPLAY_CONFIG,
};

// ── Main Entry Point ────────────────────────────────────────

/**
 * Start the event replay worker when running as a standalone process.
 */
async function main(): Promise<void> {
  logger.info('[EVENT_REPLAY] Starting as standalone process');
  
  // Handle graceful shutdown
  const shutdown = async () => {
    logger.info('[EVENT_REPLAY] Received shutdown signal');
    await eventReplayWorker.stop();
    process.exit(0);
  };
  
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  
  try {
    await eventReplayWorker.start();
  } catch (err) {
    logger.error('[EVENT_REPLAY] Failed to start', { error: err });
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

export default eventReplayWorker;
