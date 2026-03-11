// ============================================================
// OrgsLedger API — Redis Health Monitor
// Monitors Redis memory pressure and connection health
// ============================================================
//
// Metrics Monitored:
//   - used_memory / maxmemory
//   - evicted_keys (CRITICAL if > 0)
//   - mem_fragmentation_ratio
//   - connected_clients
//   - blocked_clients
//   - keyspace_hits / keyspace_misses
//
// Alerts:
//   - Memory usage > 80%: WARNING
//   - Memory usage > 95%: CRITICAL
//   - Evicted keys > 0: CRITICAL
//   - Fragmentation ratio > 1.5: WARNING
//
// ============================================================

import * as client from 'prom-client';
import { EventEmitter } from 'events';
import { createBullMQConnection } from '../infrastructure/redisClient';
import { logger } from '../logger';
import type Redis from 'ioredis';

// ── Configuration ───────────────────────────────────────────

interface RedisHealthConfig {
  /** Check interval in milliseconds */
  checkIntervalMs: number;
  /** Memory usage warning threshold (0-1) */
  memoryWarningThreshold: number;
  /** Memory usage critical threshold (0-1) */
  memoryCriticalThreshold: number;
  /** Fragmentation ratio warning threshold */
  fragmentationWarningThreshold: number;
  /** Enable eviction alerts */
  alertOnEviction: boolean;
}

const DEFAULT_CONFIG: RedisHealthConfig = {
  checkIntervalMs: parseInt(process.env.REDIS_HEALTH_CHECK_INTERVAL_MS || '30000', 10),
  memoryWarningThreshold: parseFloat(process.env.REDIS_MEMORY_WARNING_THRESHOLD || '0.80'),
  memoryCriticalThreshold: parseFloat(process.env.REDIS_MEMORY_CRITICAL_THRESHOLD || '0.95'),
  fragmentationWarningThreshold: parseFloat(process.env.REDIS_FRAGMENTATION_WARNING || '1.5'),
  alertOnEviction: process.env.REDIS_ALERT_ON_EVICTION !== 'false',
};

// ── Types ───────────────────────────────────────────────────

export interface RedisMemoryInfo {
  usedMemory: number;
  usedMemoryHuman: string;
  usedMemoryPeak: number;
  usedMemoryPeakHuman: string;
  maxMemory: number;
  maxMemoryHuman: string;
  memoryUsagePercent: number;
  fragmentationRatio: number;
  evictedKeys: number;
}

export interface RedisClientInfo {
  connectedClients: number;
  blockedClients: number;
  clientRecentMaxInputBuffer: number;
  clientRecentMaxOutputBuffer: number;
}

export interface RedisStatsInfo {
  totalConnectionsReceived: number;
  totalCommandsProcessed: number;
  instantaneousOpsPerSec: number;
  keyspaceHits: number;
  keyspaceMisses: number;
  hitRate: number;
}

export interface RedisHealthReport {
  timestamp: Date;
  status: 'healthy' | 'warning' | 'critical';
  memory: RedisMemoryInfo;
  clients: RedisClientInfo;
  stats: RedisStatsInfo;
  alerts: RedisHealthAlert[];
}

export interface RedisHealthAlert {
  level: 'warning' | 'critical';
  type: 'memory_pressure' | 'eviction' | 'fragmentation' | 'blocked_clients';
  message: string;
  value: number;
  threshold: number;
}

// ── Prometheus Metrics ──────────────────────────────────────

const PREFIX = 'orgsledger_redis_';

export const redisMemoryUsedGauge = new client.Gauge({
  name: `${PREFIX}memory_used_bytes`,
  help: 'Redis used memory in bytes',
});

export const redisMemoryMaxGauge = new client.Gauge({
  name: `${PREFIX}memory_max_bytes`,
  help: 'Redis max memory in bytes',
});

export const redisMemoryUsageGauge = new client.Gauge({
  name: `${PREFIX}memory_usage_percent`,
  help: 'Redis memory usage percentage',
});

export const redisEvictedKeysGauge = new client.Gauge({
  name: `${PREFIX}evicted_keys_total`,
  help: 'Total number of evicted keys',
});

export const redisFragmentationGauge = new client.Gauge({
  name: `${PREFIX}memory_fragmentation_ratio`,
  help: 'Redis memory fragmentation ratio',
});

export const redisConnectedClientsGauge = new client.Gauge({
  name: `${PREFIX}connected_clients`,
  help: 'Number of connected Redis clients',
});

export const redisBlockedClientsGauge = new client.Gauge({
  name: `${PREFIX}blocked_clients`,
  help: 'Number of blocked Redis clients',
});

export const redisOpsPerSecGauge = new client.Gauge({
  name: `${PREFIX}ops_per_sec`,
  help: 'Redis instantaneous operations per second',
});

export const redisHitRateGauge = new client.Gauge({
  name: `${PREFIX}hit_rate`,
  help: 'Redis keyspace hit rate (0-1)',
});

export const redisHealthAlertsCounter = new client.Counter({
  name: `${PREFIX}health_alerts_total`,
  help: 'Total Redis health alerts',
  labelNames: ['level', 'type'],
});

// ── Redis Health Monitor Class ──────────────────────────────

class RedisHealthMonitor extends EventEmitter {
  private config: RedisHealthConfig;
  private redis: Redis | null = null;
  private checkInterval: NodeJS.Timeout | null = null;
  private lastReport: RedisHealthReport | null = null;
  private previousEvictedKeys = 0;
  private isRunning = false;

  constructor(config: Partial<RedisHealthConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize and start monitoring.
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('[REDIS_HEALTH] Monitor already running');
      return;
    }

    try {
      this.redis = createBullMQConnection() as unknown as Redis;
      this.isRunning = true;

      logger.info('[REDIS_HEALTH] Starting Redis health monitor', {
        intervalMs: this.config.checkIntervalMs,
        memoryWarning: `${this.config.memoryWarningThreshold * 100}%`,
        memoryCritical: `${this.config.memoryCriticalThreshold * 100}%`,
      });

      // Run initial check
      await this.runHealthCheck();

      // Start periodic checks
      this.checkInterval = setInterval(async () => {
        try {
          await this.runHealthCheck();
        } catch (err) {
          logger.error('[REDIS_HEALTH] Health check failed', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }, this.config.checkIntervalMs);

      this.checkInterval.unref();

    } catch (err) {
      logger.error('[REDIS_HEALTH] Failed to start monitor', {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /**
   * Stop monitoring.
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.isRunning = false;
    logger.info('[REDIS_HEALTH] Monitor stopped');
  }

  /**
   * Run a single health check.
   */
  async runHealthCheck(): Promise<RedisHealthReport> {
    if (!this.redis) {
      throw new Error('Redis not initialized');
    }

    const [memoryInfo, clientsInfo, statsInfo] = await Promise.all([
      this.getMemoryInfo(),
      this.getClientsInfo(),
      this.getStatsInfo(),
    ]);

    const alerts = this.evaluateAlerts(memoryInfo, clientsInfo);

    // Determine overall status
    let status: 'healthy' | 'warning' | 'critical' = 'healthy';
    if (alerts.some(a => a.level === 'critical')) {
      status = 'critical';
    } else if (alerts.some(a => a.level === 'warning')) {
      status = 'warning';
    }

    const report: RedisHealthReport = {
      timestamp: new Date(),
      status,
      memory: memoryInfo,
      clients: clientsInfo,
      stats: statsInfo,
      alerts,
    };

    // Update Prometheus metrics
    this.updateMetrics(report);

    // Log alerts
    for (const alert of alerts) {
      const message = `[REDIS_HEALTH] ${alert.message}`;
      const meta = {
        type: alert.type,
        value: alert.value,
        threshold: alert.threshold,
      };

      if (alert.level === 'critical') {
        logger.error(message, meta);
      } else {
        logger.warn(message, meta);
      }

      redisHealthAlertsCounter.inc({ level: alert.level, type: alert.type });
      this.emit('alert', alert);
    }

    this.lastReport = report;
    this.emit('health', report);

    return report;
  }

  /**
   * Get memory information from Redis INFO.
   */
  private async getMemoryInfo(): Promise<RedisMemoryInfo> {
    const info = await this.redis!.info('memory');
    const parsed = this.parseRedisInfo(info);

    const usedMemory = parseInt(parsed.used_memory || '0', 10);
    const usedMemoryPeak = parseInt(parsed.used_memory_peak || '0', 10);
    const maxMemory = parseInt(parsed.maxmemory || '0', 10);
    const fragmentationRatio = parseFloat(parsed.mem_fragmentation_ratio || '1');
    const evictedKeys = parseInt(parsed.evicted_keys || '0', 10);

    // Calculate usage percentage
    const memoryUsagePercent = maxMemory > 0 ? usedMemory / maxMemory : 0;

    return {
      usedMemory,
      usedMemoryHuman: parsed.used_memory_human || this.formatBytes(usedMemory),
      usedMemoryPeak,
      usedMemoryPeakHuman: parsed.used_memory_peak_human || this.formatBytes(usedMemoryPeak),
      maxMemory,
      maxMemoryHuman: parsed.maxmemory_human || this.formatBytes(maxMemory),
      memoryUsagePercent,
      fragmentationRatio,
      evictedKeys,
    };
  }

  /**
   * Get client information from Redis INFO.
   */
  private async getClientsInfo(): Promise<RedisClientInfo> {
    const info = await this.redis!.info('clients');
    const parsed = this.parseRedisInfo(info);

    return {
      connectedClients: parseInt(parsed.connected_clients || '0', 10),
      blockedClients: parseInt(parsed.blocked_clients || '0', 10),
      clientRecentMaxInputBuffer: parseInt(parsed.client_recent_max_input_buffer || '0', 10),
      clientRecentMaxOutputBuffer: parseInt(parsed.client_recent_max_output_buffer || '0', 10),
    };
  }

  /**
   * Get stats information from Redis INFO.
   */
  private async getStatsInfo(): Promise<RedisStatsInfo> {
    const info = await this.redis!.info('stats');
    const parsed = this.parseRedisInfo(info);

    const keyspaceHits = parseInt(parsed.keyspace_hits || '0', 10);
    const keyspaceMisses = parseInt(parsed.keyspace_misses || '0', 10);
    const totalRequests = keyspaceHits + keyspaceMisses;
    const hitRate = totalRequests > 0 ? keyspaceHits / totalRequests : 1;

    return {
      totalConnectionsReceived: parseInt(parsed.total_connections_received || '0', 10),
      totalCommandsProcessed: parseInt(parsed.total_commands_processed || '0', 10),
      instantaneousOpsPerSec: parseInt(parsed.instantaneous_ops_per_sec || '0', 10),
      keyspaceHits,
      keyspaceMisses,
      hitRate,
    };
  }

  /**
   * Evaluate alerts based on metrics.
   */
  private evaluateAlerts(
    memory: RedisMemoryInfo,
    clients: RedisClientInfo
  ): RedisHealthAlert[] {
    const alerts: RedisHealthAlert[] = [];

    // Memory pressure check
    if (memory.memoryUsagePercent >= this.config.memoryCriticalThreshold) {
      alerts.push({
        level: 'critical',
        type: 'memory_pressure',
        message: `CRITICAL: Redis memory at ${(memory.memoryUsagePercent * 100).toFixed(1)}%`,
        value: memory.memoryUsagePercent,
        threshold: this.config.memoryCriticalThreshold,
      });
    } else if (memory.memoryUsagePercent >= this.config.memoryWarningThreshold) {
      alerts.push({
        level: 'warning',
        type: 'memory_pressure',
        message: `WARNING: Redis memory at ${(memory.memoryUsagePercent * 100).toFixed(1)}%`,
        value: memory.memoryUsagePercent,
        threshold: this.config.memoryWarningThreshold,
      });
    }

    // Eviction check (CRITICAL if any keys evicted since last check)
    if (this.config.alertOnEviction && memory.evictedKeys > this.previousEvictedKeys) {
      const newEvictions = memory.evictedKeys - this.previousEvictedKeys;
      alerts.push({
        level: 'critical',
        type: 'eviction',
        message: `CRITICAL: Redis evicted ${newEvictions} keys - memory pressure!`,
        value: newEvictions,
        threshold: 0,
      });
    }
    this.previousEvictedKeys = memory.evictedKeys;

    // Fragmentation check
    if (memory.fragmentationRatio > this.config.fragmentationWarningThreshold) {
      alerts.push({
        level: 'warning',
        type: 'fragmentation',
        message: `WARNING: Redis fragmentation ratio ${memory.fragmentationRatio.toFixed(2)} (threshold: ${this.config.fragmentationWarningThreshold})`,
        value: memory.fragmentationRatio,
        threshold: this.config.fragmentationWarningThreshold,
      });
    }

    // Blocked clients check
    if (clients.blockedClients > 10) {
      alerts.push({
        level: 'warning',
        type: 'blocked_clients',
        message: `WARNING: ${clients.blockedClients} blocked Redis clients`,
        value: clients.blockedClients,
        threshold: 10,
      });
    }

    return alerts;
  }

  /**
   * Update Prometheus metrics.
   */
  private updateMetrics(report: RedisHealthReport): void {
    redisMemoryUsedGauge.set(report.memory.usedMemory);
    redisMemoryMaxGauge.set(report.memory.maxMemory);
    redisMemoryUsageGauge.set(report.memory.memoryUsagePercent);
    redisEvictedKeysGauge.set(report.memory.evictedKeys);
    redisFragmentationGauge.set(report.memory.fragmentationRatio);
    redisConnectedClientsGauge.set(report.clients.connectedClients);
    redisBlockedClientsGauge.set(report.clients.blockedClients);
    redisOpsPerSecGauge.set(report.stats.instantaneousOpsPerSec);
    redisHitRateGauge.set(report.stats.hitRate);
  }

  /**
   * Parse Redis INFO response into key-value object.
   */
  private parseRedisInfo(info: string): Record<string, string> {
    const result: Record<string, string> = {};
    const lines = info.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const colonIndex = trimmed.indexOf(':');
      if (colonIndex > 0) {
        const key = trimmed.substring(0, colonIndex);
        const value = trimmed.substring(colonIndex + 1);
        result[key] = value;
      }
    }

    return result;
  }

  /**
   * Format bytes to human-readable string.
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Get the last health report.
   */
  getLastReport(): RedisHealthReport | null {
    return this.lastReport;
  }

  /**
   * Check if monitor is running.
   */
  isMonitorRunning(): boolean {
    return this.isRunning;
  }
}

// ── Singleton ───────────────────────────────────────────────

export const redisHealthMonitor = new RedisHealthMonitor();

// ── Exports ─────────────────────────────────────────────────

export async function startRedisHealthMonitor(): Promise<void> {
  await redisHealthMonitor.start();
}

export function stopRedisHealthMonitor(): void {
  redisHealthMonitor.stop();
}

export async function getRedisHealthReport(): Promise<RedisHealthReport> {
  return redisHealthMonitor.runHealthCheck();
}

export function getLastRedisHealthReport(): RedisHealthReport | null {
  return redisHealthMonitor.getLastReport();
}

export function onRedisHealthAlert(
  callback: (alert: RedisHealthAlert) => void
): () => void {
  redisHealthMonitor.on('alert', callback);
  return () => redisHealthMonitor.off('alert', callback);
}
