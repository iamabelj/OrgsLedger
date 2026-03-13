"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.RECOMMENDED_CLIENT_CONFIG = exports.reconnectThrottle = exports.wsGracefulDisconnectCounter = exports.wsActiveConnectionsGauge = exports.wsConnectionRateGauge = exports.wsConnectionsThrottledCounter = exports.wsConnectionsAcceptedCounter = exports.wsConnectionAttemptsCounter = void 0;
exports.createThrottleMiddleware = createThrottleMiddleware;
exports.startReconnectThrottle = startReconnectThrottle;
exports.stopReconnectThrottle = stopReconnectThrottle;
exports.checkConnection = checkConnection;
exports.startGracefulDrain = startGracefulDrain;
exports.getReconnectThrottleStats = getReconnectThrottleStats;
const client = __importStar(require("prom-client"));
const events_1 = require("events");
const logger_1 = require("../logger");
const DEFAULT_CONFIG = {
    maxConnectionsPerSecond: parseInt(process.env.WS_MAX_CONN_PER_SEC_IP || '5', 10),
    maxGlobalConnectionsPerSecond: parseInt(process.env.WS_MAX_GLOBAL_CONN_PER_SEC || '1000', 10),
    windowMs: parseInt(process.env.WS_THROTTLE_WINDOW_MS || '1000', 10),
    blockDurationMs: parseInt(process.env.WS_BLOCK_DURATION_MS || '5000', 10),
    gracefulShutdown: process.env.WS_GRACEFUL_SHUTDOWN !== 'false',
};
// ── Prometheus Metrics ──────────────────────────────────────
const PREFIX = 'orgsledger_ws_';
exports.wsConnectionAttemptsCounter = new client.Counter({
    name: `${PREFIX}connection_attempts_total`,
    help: 'Total WebSocket connection attempts',
});
exports.wsConnectionsAcceptedCounter = new client.Counter({
    name: `${PREFIX}connections_accepted_total`,
    help: 'Total WebSocket connections accepted',
});
exports.wsConnectionsThrottledCounter = new client.Counter({
    name: `${PREFIX}connections_throttled_total`,
    help: 'Total WebSocket connections throttled',
    labelNames: ['reason'],
});
exports.wsConnectionRateGauge = new client.Gauge({
    name: `${PREFIX}connection_rate_per_sec`,
    help: 'Current connection rate per second',
});
exports.wsActiveConnectionsGauge = new client.Gauge({
    name: `${PREFIX}active_connections`,
    help: 'Current number of active WebSocket connections',
});
exports.wsGracefulDisconnectCounter = new client.Counter({
    name: `${PREFIX}graceful_disconnects_total`,
    help: 'Total graceful disconnects sent',
});
// ── Reconnect Throttle Class ────────────────────────────────
class ReconnectThrottle extends events_1.EventEmitter {
    config;
    ipWindows = new Map();
    globalTimestamps = [];
    isDraining = false;
    activeConnections = 0;
    cleanupInterval = null;
    constructor(config = {}) {
        super();
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    /**
     * Start the throttle cleanup loop.
     */
    start() {
        if (this.cleanupInterval)
            return;
        // Clean up old entries every 10 seconds
        this.cleanupInterval = setInterval(() => this.cleanup(), 10000);
        this.cleanupInterval.unref();
        logger_1.logger.info('[WS_THROTTLE] Started', {
            maxPerIP: this.config.maxConnectionsPerSecond,
            maxGlobal: this.config.maxGlobalConnectionsPerSecond,
        });
    }
    /**
     * Stop the throttle.
     */
    stop() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    }
    /**
     * Check if a connection from the given IP should be allowed.
     */
    checkConnection(ip) {
        exports.wsConnectionAttemptsCounter.inc();
        const now = Date.now();
        // Check if server is draining
        if (this.isDraining) {
            exports.wsConnectionsThrottledCounter.inc({ reason: 'server_draining' });
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
            exports.wsConnectionsThrottledCounter.inc({ reason: 'ip_blocked' });
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
            exports.wsConnectionsThrottledCounter.inc({ reason: 'global_rate_limit' });
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
            exports.wsConnectionsThrottledCounter.inc({ reason: 'ip_rate_limit' });
            return {
                allowed: false,
                reason: 'ip_rate_limit',
                retryAfterMs: this.config.blockDurationMs,
            };
        }
        // Allow connection
        ipWindow.timestamps.push(now);
        this.globalTimestamps.push(now);
        exports.wsConnectionsAcceptedCounter.inc();
        exports.wsConnectionRateGauge.set(this.globalTimestamps.length);
        return { allowed: true };
    }
    /**
     * Record a connection being established.
     */
    connectionEstablished() {
        this.activeConnections++;
        exports.wsActiveConnectionsGauge.set(this.activeConnections);
    }
    /**
     * Record a connection being closed.
     */
    connectionClosed() {
        this.activeConnections = Math.max(0, this.activeConnections - 1);
        exports.wsActiveConnectionsGauge.set(this.activeConnections);
    }
    /**
     * Start graceful drain (for server shutdown).
     * Sends disconnect messages to all clients with retry hints.
     */
    startDrain(io) {
        if (!this.config.gracefulShutdown) {
            return Promise.resolve();
        }
        this.isDraining = true;
        logger_1.logger.info('[WS_THROTTLE] Starting graceful drain', {
            activeConnections: this.activeConnections,
        });
        // Emit graceful disconnect to all clients
        // Clients should reconnect with exponential backoff
        io.emit('server:draining', {
            message: 'Server is restarting, please reconnect',
            retryAfterMs: 2000 + Math.random() * 3000, // 2-5 seconds
        });
        exports.wsGracefulDisconnectCounter.inc();
        // Wait for connections to drain
        return new Promise((resolve) => {
            const checkDrained = () => {
                if (this.activeConnections === 0) {
                    logger_1.logger.info('[WS_THROTTLE] All connections drained');
                    resolve();
                }
                else {
                    logger_1.logger.info('[WS_THROTTLE] Waiting for connections to drain', {
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
    stopDrain() {
        this.isDraining = false;
    }
    /**
     * Clean up old entries.
     */
    cleanup() {
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
        exports.wsConnectionRateGauge.set(this.globalTimestamps.length);
    }
    /**
     * Get current stats.
     */
    getStats() {
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
exports.reconnectThrottle = new ReconnectThrottle();
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
function createThrottleMiddleware() {
    return (socket, next) => {
        const ip = socket.handshake.headers['x-forwarded-for']?.split(',')[0]?.trim()
            || socket.handshake.address
            || 'unknown';
        const result = exports.reconnectThrottle.checkConnection(ip);
        if (!result.allowed) {
            const error = new Error(`Connection throttled: ${result.reason}`);
            error.data = {
                reason: result.reason,
                retryAfterMs: result.retryAfterMs,
            };
            logger_1.logger.debug('[WS_THROTTLE] Connection rejected', {
                ip,
                reason: result.reason,
                retryAfterMs: result.retryAfterMs,
            });
            return next(error);
        }
        // Track connection lifecycle
        exports.reconnectThrottle.connectionEstablished();
        socket.on('disconnect', () => {
            exports.reconnectThrottle.connectionClosed();
        });
        next();
    };
}
// ── Client Configuration ────────────────────────────────────
/**
 * Recommended client Socket.IO configuration.
 * Export this for documentation or client-side usage.
 */
exports.RECOMMENDED_CLIENT_CONFIG = {
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
function startReconnectThrottle() {
    exports.reconnectThrottle.start();
}
function stopReconnectThrottle() {
    exports.reconnectThrottle.stop();
}
function checkConnection(ip) {
    return exports.reconnectThrottle.checkConnection(ip);
}
function startGracefulDrain(io) {
    return exports.reconnectThrottle.startDrain(io);
}
function getReconnectThrottleStats() {
    return exports.reconnectThrottle.getStats();
}
//# sourceMappingURL=ws-reconnect-throttle.js.map