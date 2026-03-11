// ============================================================
// OrgsLedger API — WebSocket Throttling
// Token bucket rate limiter for per-meeting caption events
// ============================================================
//
// Problem: At 50k meetings, Socket.IO can be overwhelmed.
// Solution: Limit caption events to 20/second per meeting.
// 
// Uses token bucket algorithm:
//   - Each meeting has a bucket of tokens
//   - Tokens refill at constant rate (20/sec)
//   - Each emit consumes one token
//   - No tokens = event dropped
//
// ============================================================

import { logger } from '../logger';

// ── Configuration ───────────────────────────────────────────

const THROTTLE_CONFIG = {
  /** Maximum events per second per meeting (default: 20) */
  maxEventsPerSecond: parseInt(process.env.WS_MAX_EVENTS_PER_SECOND || '20', 10),
  
  /** Bucket size (burst capacity) — allows short bursts (default: 30) */
  bucketSize: parseInt(process.env.WS_BUCKET_SIZE || '30', 10),
  
  /** Token refill interval in ms (default: 50ms for smooth refill) */
  refillIntervalMs: 50,
  
  /** Cleanup interval for inactive meetings (default: 60 seconds) */
  cleanupIntervalMs: 60000,
  
  /** Maximum meetings to track (memory protection) */
  maxMeetings: parseInt(process.env.WS_MAX_MEETINGS || '100000', 10),
  
  /** Inactivity timeout before cleanup (default: 5 minutes) */
  inactivityTimeoutMs: 300000,
};

// ── Types ───────────────────────────────────────────────────

interface TokenBucket {
  tokens: number;
  lastRefillAt: number;
  droppedCount: number;
  passedCount: number;
}

interface ThrottleDecision {
  allowed: boolean;
  tokensRemaining: number;
  droppedCount: number;
}

interface ThrottleStats {
  activeMeetings: number;
  totalPassed: number;
  totalDropped: number;
  dropRate: number;
}

// ── Token Bucket Manager ────────────────────────────────────

class WebSocketThrottleManager {
  /** Token buckets per meeting: Map<meetingId, TokenBucket> */
  private buckets = new Map<string, TokenBucket>();
  
  /** Cleanup timer */
  private cleanupTimer: NodeJS.Timeout | null = null;
  
  /** Tokens added per refill interval */
  private tokensPerRefill: number;
  
  /** Global stats */
  private globalStats = {
    totalPassed: 0,
    totalDropped: 0,
  };

  constructor() {
    // Calculate tokens to add per refill
    // 20 events/sec with 50ms refill = 1 token per refill
    this.tokensPerRefill = 
      (THROTTLE_CONFIG.maxEventsPerSecond * THROTTLE_CONFIG.refillIntervalMs) / 1000;
  }

  /**
   * Initialize the throttle manager.
   */
  initialize(): void {
    this.startCleanupTimer();
    logger.info('[WS_THROTTLE] Initialized', {
      maxEventsPerSecond: THROTTLE_CONFIG.maxEventsPerSecond,
      bucketSize: THROTTLE_CONFIG.bucketSize,
      tokensPerRefill: this.tokensPerRefill,
    });
  }

  /**
   * Check if an event should be allowed for a meeting.
   * Returns true if allowed, false if throttled (dropped).
   */
  shouldAllow(meetingId: string): ThrottleDecision {
    const now = Date.now();
    let bucket = this.buckets.get(meetingId);
    
    // Create new bucket if needed
    if (!bucket) {
      // Memory protection
      if (this.buckets.size >= THROTTLE_CONFIG.maxMeetings) {
        this.cleanupOldestBuckets(this.buckets.size / 10); // Remove 10%
      }
      
      bucket = {
        tokens: THROTTLE_CONFIG.bucketSize,
        lastRefillAt: now,
        droppedCount: 0,
        passedCount: 0,
      };
      this.buckets.set(meetingId, bucket);
    }
    
    // Refill tokens based on elapsed time
    const elapsed = now - bucket.lastRefillAt;
    const refillIntervals = Math.floor(elapsed / THROTTLE_CONFIG.refillIntervalMs);
    
    if (refillIntervals > 0) {
      const tokensToAdd = refillIntervals * this.tokensPerRefill;
      bucket.tokens = Math.min(
        THROTTLE_CONFIG.bucketSize,
        bucket.tokens + tokensToAdd
      );
      bucket.lastRefillAt = now;
    }
    
    // Check if we have tokens
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      bucket.passedCount++;
      this.globalStats.totalPassed++;
      
      return {
        allowed: true,
        tokensRemaining: bucket.tokens,
        droppedCount: bucket.droppedCount,
      };
    } else {
      bucket.droppedCount++;
      this.globalStats.totalDropped++;
      
      return {
        allowed: false,
        tokensRemaining: 0,
        droppedCount: bucket.droppedCount,
      };
    }
  }

  /**
   * Quick check without consuming a token.
   */
  canAccept(meetingId: string): boolean {
    const bucket = this.buckets.get(meetingId);
    if (!bucket) return true; // New meetings always have capacity
    
    // Estimate current tokens
    const now = Date.now();
    const elapsed = now - bucket.lastRefillAt;
    const refillIntervals = Math.floor(elapsed / THROTTLE_CONFIG.refillIntervalMs);
    const estimatedTokens = Math.min(
      THROTTLE_CONFIG.bucketSize,
      bucket.tokens + refillIntervals * this.tokensPerRefill
    );
    
    return estimatedTokens >= 1;
  }

  /**
   * Remove oldest buckets to free memory.
   */
  private cleanupOldestBuckets(count: number): void {
    const entries = Array.from(this.buckets.entries());
    entries.sort((a, b) => a[1].lastRefillAt - b[1].lastRefillAt);
    
    const toRemove = entries.slice(0, count);
    for (const [meetingId] of toRemove) {
      this.buckets.delete(meetingId);
    }
    
    logger.info('[WS_THROTTLE] Cleaned up oldest buckets', { removed: count });
  }

  /**
   * Start periodic cleanup of inactive meetings.
   */
  private startCleanupTimer(): void {
    if (this.cleanupTimer) return;
    
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      let removed = 0;
      
      for (const [meetingId, bucket] of this.buckets.entries()) {
        if (now - bucket.lastRefillAt > THROTTLE_CONFIG.inactivityTimeoutMs) {
          this.buckets.delete(meetingId);
          removed++;
        }
      }
      
      if (removed > 0) {
        logger.debug('[WS_THROTTLE] Cleanup removed inactive buckets', { removed });
      }
    }, THROTTLE_CONFIG.cleanupIntervalMs);
    
    this.cleanupTimer.unref();
  }

  /**
   * Get statistics.
   */
  getStats(): ThrottleStats {
    const total = this.globalStats.totalPassed + this.globalStats.totalDropped;
    
    return {
      activeMeetings: this.buckets.size,
      totalPassed: this.globalStats.totalPassed,
      totalDropped: this.globalStats.totalDropped,
      dropRate: total > 0 ? this.globalStats.totalDropped / total : 0,
    };
  }

  /**
   * Get stats for a specific meeting.
   */
  getMeetingStats(meetingId: string) {
    const bucket = this.buckets.get(meetingId);
    if (!bucket) return null;
    
    return {
      tokensRemaining: bucket.tokens,
      passedCount: bucket.passedCount,
      droppedCount: bucket.droppedCount,
      dropRate: bucket.passedCount + bucket.droppedCount > 0
        ? bucket.droppedCount / (bucket.passedCount + bucket.droppedCount)
        : 0,
    };
  }

  /**
   * Clean up bucket for a specific meeting (call on meeting end).
   */
  cleanupMeeting(meetingId: string): void {
    this.buckets.delete(meetingId);
  }

  /**
   * Reset all throttle state (for testing).
   */
  reset(): void {
    this.buckets.clear();
    this.globalStats.totalPassed = 0;
    this.globalStats.totalDropped = 0;
  }

  /**
   * Shutdown the throttle manager.
   */
  shutdown(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    
    logger.info('[WS_THROTTLE] Shutdown complete', this.getStats());
    this.buckets.clear();
  }
}

// ── Singleton Instance ──────────────────────────────────────

export const wsThrottleManager = new WebSocketThrottleManager();

// ── Exported Helper Functions ───────────────────────────────

/**
 * Initialize WebSocket throttling.
 */
export function initializeWSThrottling(): void {
  wsThrottleManager.initialize();
}

/**
 * Check if an event should be allowed for a meeting.
 * Consumes a token if allowed.
 */
export function throttleCheck(meetingId: string): ThrottleDecision {
  return wsThrottleManager.shouldAllow(meetingId);
}

/**
 * Quick check without consuming a token.
 */
export function canAcceptEvent(meetingId: string): boolean {
  return wsThrottleManager.canAccept(meetingId);
}

/**
 * Get global throttle statistics.
 */
export function getWSThrottleStats(): ThrottleStats {
  return wsThrottleManager.getStats();
}

/**
 * Get throttle stats for a specific meeting.
 */
export function getMeetingThrottleStats(meetingId: string) {
  return wsThrottleManager.getMeetingStats(meetingId);
}

/**
 * Clean up throttle data for a meeting.
 */
export function cleanupMeetingThrottle(meetingId: string): void {
  wsThrottleManager.cleanupMeeting(meetingId);
}

/**
 * Shutdown WebSocket throttling.
 */
export function shutdownWSThrottling(): void {
  wsThrottleManager.shutdown();
}
