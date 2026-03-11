// ============================================================
// OrgsLedger API — WebSocket Reconnect Throttling
// Prevents reconnect storms during deploys and outages
// ============================================================
//
// Problem:
//   When a server restarts or a network blip occurs, all clients
//   reconnect simultaneously, overwhelming the server.
//
// Solution:
//   - Exponential backoff with jitter
//   - Server-side connection rate limiting
//   - Graceful disconnect before restart
//
// Client Configuration (recommended):
//   reconnectionDelay: 1000,
//   reconnectionDelayMax: 5000,
//   randomizationFactor: 0.5,
//   timeout: 20000
//
// ============================================================

import * as client from 'prom-client';
import { EventEmitter } from 'events';
import { logger } from '../logger';

// ── Configuration ───────────────────────────────────────────

interface ReconnectThrottleConfig {
  /** Max connections per second per IP */
  maxConnectionsPerSecond: number;
  /** Max connections per second globally */
  maxGlobalConnectionsPerSecond: number;
  /** Window size in milliseconds */
  windowMs: number;
  /** Block duration when rate exceeded */
  blockDurationMs: number;
  /** Enable graceful shutdown support */
  gracefulShutdown: boolean;
}

const DEFAULT_CONFIG: ReconnectThrottleConfig = {
  maxConnectionsPerSecond: parseInt(process.env.WS_MAX_CONN_PER_SEC_IP || '5', 10),
  maxGlobalConnectionsPerSecond: parseInt(process.env.WS_MAX_GLOBAL_CONN_PER_SEC || '1000', 10),
  windowMs: parseInt(process.env.WS_THROTTLE_WINDOW_MS || '1000', 10),
  blockDurationMs: parseInt(process.env.WS_BLOCK_DURATION_MS || '5000', 10),
  gracefulShutdown: process.env.WS_GRACEFUL_SHUTDOWN !== 'false',
};

// ── Prometheus Metrics ──────────────────────────────────────

const PREFIX = 'orgsledger_ws_';

export const wsConnectionAttemptsCounter = new client.Counter({
  name: `${PREFIX}connection_attempts_total`,
  help: 'Total WebSocket connection attempts',
});

export const wsConnectionsAcceptedCounter = new client.Counter({
  name: `${PREFIX}connections_accepted_total`,
  help: 'Total WebSocket connections accepted',
});

export const wsConnectionsThrottledCounter = new client.Counter({
  name: `${PREFIX}connections_throttled_total`,
  help: 'Total WebSocket connections throttled',
  labelNames: ['reason'],
});

export const wsConnectionRateGauge = new client.Gauge({
  name: `${PREFIX}connection_rate_per_sec`,
  help: 'Current connection rate per second',
});

export const wsActiveConnectionsGauge = new client.Gauge({
  name: `${PREFIX}active_connections`,
  help: 'Current number of active WebSocket connections',
});

export const wsGracefulDisconnectCounter = new client.Counter({
  name: `${PREFIX}graceful_disconnects_total`,
  help: 'Total graceful disconnects sent',
});

// ── Types ───────────────────────────────────────────────────

export interface ThrottleResult {
  allowed: boolean;
  reason?: 'ip_rate_limit' | 'global_rate_limit' | 'ip_blocked' | 'server_draining';
  retryAfterMs?: number;
}

interface ConnectionWindow {
  timestamps: number[];
  blockedUntil: number;
}

// ── Reconnect Throttle Class ────────────────────────────────

class ReconnectThrottle extends EventEmitter {
  private config: ReconnectThrottleConfig;
  private ipWindows: Map<string, ConnectionWindow> = new Map();
  private globalTimestamps: number[] = [];
  private isDraining = false;
  private activeConnections = 0;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(config: Partial<ReconnectThrottleConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start the throttle cleanup loop.
   */
  start(): void {
    if (this.cleanupInterval) return;

    // Clean up old entries every 10 seconds
    this.cleanupInterval = setInterval(() => this.cleanup(), 10000);
    this.cleanupInterval.unref();

    logger.info('[WS_THROTTLE] Started', {
      maxPerIP: this.config.maxConnectionsPerSecond,
      maxGlobal: this.config.maxGlobalConnectionsPerSecond,
    });
  }

  /**
   * Stop the throttle.
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Check if a connection from the given IP should be allowed.
   */
  checkConnection(ip: string): ThrottleResult {
    wsConnectionAttemptsCounter.inc();
    const now = Date.now();

    // Check if server is draining
    if (this.isDraining) {
      wsConnectionsThrottledCounter.inc({ reason: 'server_draining' });
      return {
        allowed: false,
        reason: 'server_draining',
        retryAfterMs: this.config.blockDurationMs,
      };
    }

    // Get or create IP window
    let ipWindow = this.ipWindows.get(ip);
    if (!ipWindow) {
      ipWindow = { timestamps: [], blockedUntil: 0 };
      this.ipWindows.set(ip, ipWindow);
    }

    // Check if IP is blocked
    if (ipWindow.blockedUntil > now) {
      wsConnectionsThrottledCounter.inc({ reason: 'ip_blocked' });
      return {
        allowed: false,
        reason: 'ip_blocked',
        retryAfterMs: ipWindow.blockedUntil - now,
      };
    }

    // Clean old timestamps from windows
    const windowStart = now - this.config.windowMs;
    ipWindow.timestamps = ipWindow.timestamps.filter(t => t > windowStart);
    this.globalTimestamps = this.globalTimestamps.filter(t => t > windowStart);

    // Check global rate limit
    if (this.globalTimestamps.length >= this.config.maxGlobalConnectionsPerSecond) {
      wsConnectionsThrottledCounter.inc({ reason: 'global_rate_limit' });
      return {
        allowed: false,
        reason: 'global_rate_limit',
        retryAfterMs: this.config.windowMs,
      };
    }

    // Check IP rate limit
    if (ipWindow.timestamps.length >= this.config.maxConnectionsPerSecond) {
      // Block this IP for a while
      ipWindow.blockedUntil = now + this.config.blockDurationMs;
      wsConnectionsThrottledCounter.inc({ reason: 'ip_rate_limit' });
      return {
        allowed: false,
        reason: 'ip_rate_limit',
        retryAfterMs: this.config.blockDurationMs,
      };
    }

    // Allow connection
    ipWindow.timestamps.push(now);
    this.globalTimestamps.push(now);

    wsConnectionsAcceptedCounter.inc();
    wsConnectionRateGauge.set(this.globalTimestamps.length);

    return { allowed: true };
  }

  /**
   * Record a connection being established.
   */
  connectionEstablished(): void {
    this.activeConnections++;
    wsActiveConnectionsGauge.set(this.activeConnections);
  }

  /**
   * Record a connection being closed.
   */
  connectionClosed(): void {
    this.activeConnections = Math.max(0, this.activeConnections - 1);
    wsActiveConnectionsGauge.set(this.activeConnections);
  }

  /**
   * Start graceful drain (for server shutdown).
   * Sends disconnect messages to all clients with retry hints.
   */
  startDrain(io: any): Promise<void> {
    if (!this.config.gracefulShutdown) {
      return Promise.resolve();
    }

    this.isDraining = true;
    logger.info('[WS_THROTTLE] Starting graceful drain', {
      activeConnections: this.activeConnections,
    });

    // Emit graceful disconnect to all clients
    // Clients should reconnect with exponential backoff
    io.emit('server:draining', {
      message: 'Server is restarting, please reconnect',
      retryAfterMs: 2000 + Math.random() * 3000, // 2-5 seconds
    });

    wsGracefulDisconnectCounter.inc();

    // Wait for connections to drain
    return new Promise((resolve) => {
      const checkDrained = () => {
        if (this.activeConnections === 0) {
          logger.info('[WS_THROTTLE] All connections drained');
          resolve();
        } else {
          logger.info('[WS_THROTTLE] Waiting for connections to drain', {
            remaining: this.activeConnections,
          });
          // Force disconnect after timeout
          setTimeout(() => {
            io.disconnectSockets(true);
            resolve();
          }, 5000);
        }
      };

      // Give clients 3 seconds to disconnect gracefully
      setTimeout(checkDrained, 3000);
    });
  }

  /**
   * Stop draining.
   */
  stopDrain(): void {
    this.isDraining = false;
  }

  /**
   * Clean up old entries.
   */
  private cleanup(): void {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    // Clean IP windows
    for (const [ip, window] of this.ipWindows.entries()) {
      window.timestamps = window.timestamps.filter(t => t > windowStart);

      // Remove empty windows that aren't blocked
      if (window.timestamps.length === 0 && window.blockedUntil < now) {
        this.ipWindows.delete(ip);
      }
    }

    // Clean global timestamps
    this.globalTimestamps = this.globalTimestamps.filter(t => t > windowStart);
    wsConnectionRateGauge.set(this.globalTimestamps.length);
  }

  /**
   * Get current stats.
   */
  getStats(): {
    activeConnections: number;
    connectionRate: number;
    blockedIPs: number;
    isDraining: boolean;
  } {
    const now = Date.now();
    let blockedIPs = 0;

    for (const window of this.ipWindows.values()) {
      if (window.blockedUntil > now) {
        blockedIPs++;
      }
    }

    return {
      activeConnections: this.activeConnections,
      connectionRate: this.globalTimestamps.length,
      blockedIPs,
      isDraining: this.isDraining,
    };
  }
}

// ── Singleton ───────────────────────────────────────────────

export const reconnectThrottle = new ReconnectThrottle();

// ── Socket.IO Middleware ────────────────────────────────────

/**
 * Socket.IO middleware to throttle connections.
 *
 * Usage:
 * ```ts
 * import { createThrottleMiddleware } from './scaling/ws-reconnect-throttle';
 * io.use(createThrottleMiddleware());
 * ```
 */
export function createThrottleMiddleware() {
  return (socket: any, next: (err?: Error) => void) => {
    const ip = socket.handshake.headers['x-forwarded-for']?.split(',')[0]?.trim()
      || socket.handshake.address
      || 'unknown';

    const result = reconnectThrottle.checkConnection(ip);

    if (!result.allowed) {
      const error: any = new Error(`Connection throttled: ${result.reason}`);
      error.data = {
        reason: result.reason,
        retryAfterMs: result.retryAfterMs,
      };
      logger.debug('[WS_THROTTLE] Connection rejected', {
        ip,
        reason: result.reason,
        retryAfterMs: result.retryAfterMs,
      });
      return next(error);
    }

    // Track connection lifecycle
    reconnectThrottle.connectionEstablished();
    socket.on('disconnect', () => {
      reconnectThrottle.connectionClosed();
    });

    next();
  };
}

// ── Client Configuration ────────────────────────────────────

/**
 * Recommended client Socket.IO configuration.
 * Export this for documentation or client-side usage.
 */
export const RECOMMENDED_CLIENT_CONFIG = {
  // Start with 1 second delay
  reconnectionDelay: 1000,
  // Max out at 5 seconds
  reconnectionDelayMax: 5000,
  // Add randomization to prevent thundering herd
  randomizationFactor: 0.5,
  // Connection timeout
  timeout: 20000,
  // Retry forever (with backoff)
  reconnectionAttempts: Infinity,
  // Use websocket transport only for better reconnection
  transports: ['websocket'],
};

// ── Exports ─────────────────────────────────────────────────

export function startReconnectThrottle(): void {
  reconnectThrottle.start();
}

export function stopReconnectThrottle(): void {
  reconnectThrottle.stop();
}

export function checkConnection(ip: string): ThrottleResult {
  return reconnectThrottle.checkConnection(ip);
}

export function startGracefulDrain(io: any): Promise<void> {
  return reconnectThrottle.startDrain(io);
}

export function getReconnectThrottleStats() {
  return reconnectThrottle.getStats();
}
