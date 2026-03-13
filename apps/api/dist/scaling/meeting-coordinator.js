"use strict";
// ============================================================
// OrgsLedger API — Global Meeting Coordinator
// Cluster-wide meeting state coordination via Redis
// ============================================================
//
// Responsibilities:
//   1. Track active meetings across all workers
//   2. Prevent duplicate meeting processing
//   3. Detect stuck/orphaned meetings
//   4. Enable graceful worker failover
//   5. Provide cluster health visibility
//
// How It Works:
//   - Each meeting has a Redis key with worker ownership
//   - Workers send heartbeats to prove liveness
//   - Coordinator detects missing heartbeats → triggers recovery
//   - Atomic operations prevent race conditions
//
// Redis Keys:
//   meeting:{id}:owner       → worker ID
//   meeting:{id}:heartbeat   → timestamp
//   meeting:{id}:state       → active/ending/ended
//   worker:{id}:meetings     → SET of meeting IDs
//   worker:{id}:heartbeat    → timestamp
//   global:active_meetings   → SET of all active meeting IDs
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
exports.globalMeetingCoordinator = exports.GlobalMeetingCoordinator = exports.coordinatorErrorsCounter = exports.workerFailuresCounter = exports.meetingRecoveriesCounter = exports.orphanedMeetingsGauge = exports.stuckMeetingsGauge = exports.activeWorkersGauge = exports.activeMeetingsGauge = void 0;
exports.startMeetingCoordinator = startMeetingCoordinator;
exports.stopMeetingCoordinator = stopMeetingCoordinator;
exports.claimMeeting = claimMeeting;
exports.releaseMeeting = releaseMeeting;
exports.sendMeetingHeartbeat = sendMeetingHeartbeat;
exports.getMeetingInfo = getMeetingInfo;
exports.getClusterHealth = getClusterHealth;
exports.onCoordinatorEvent = onCoordinatorEvent;
const client = __importStar(require("prom-client"));
const events_1 = require("events");
const redisClient_1 = require("../infrastructure/redisClient");
const logger_1 = require("../logger");
const DEFAULT_CONFIG = {
    heartbeatIntervalMs: parseInt(process.env.COORDINATOR_HEARTBEAT_MS || '5000', 10),
    meetingHeartbeatIntervalMs: parseInt(process.env.MEETING_HEARTBEAT_MS || '10000', 10),
    workerTimeoutMs: parseInt(process.env.COORDINATOR_WORKER_TIMEOUT_MS || '30000', 10),
    meetingTimeoutMs: parseInt(process.env.COORDINATOR_MEETING_TIMEOUT_MS || '60000', 10),
    healthCheckIntervalMs: parseInt(process.env.COORDINATOR_HEALTH_CHECK_MS || '10000', 10),
    maxMeetingsPerWorker: parseInt(process.env.MAX_MEETINGS_PER_WORKER || '500', 10),
    autoRecovery: process.env.COORDINATOR_AUTO_RECOVERY !== 'false',
};
// ── Prometheus Metrics ──────────────────────────────────────
const PREFIX = 'orgsledger_coordinator_';
exports.activeMeetingsGauge = new client.Gauge({
    name: `${PREFIX}active_meetings`,
    help: 'Number of active meetings in cluster',
});
exports.activeWorkersGauge = new client.Gauge({
    name: `${PREFIX}active_workers`,
    help: 'Number of active workers in cluster',
});
exports.stuckMeetingsGauge = new client.Gauge({
    name: `${PREFIX}stuck_meetings`,
    help: 'Number of stuck meetings (no heartbeat)',
});
exports.orphanedMeetingsGauge = new client.Gauge({
    name: `${PREFIX}orphaned_meetings`,
    help: 'Number of orphaned meetings (worker dead)',
});
exports.meetingRecoveriesCounter = new client.Counter({
    name: `${PREFIX}meeting_recoveries_total`,
    help: 'Total meeting recovery operations',
});
exports.workerFailuresCounter = new client.Counter({
    name: `${PREFIX}worker_failures_total`,
    help: 'Total worker failures detected',
});
exports.coordinatorErrorsCounter = new client.Counter({
    name: `${PREFIX}errors_total`,
    help: 'Total coordinator errors',
    labelNames: ['operation'],
});
// ── Lua Scripts ─────────────────────────────────────────────
// Atomically claim a meeting for a worker
const CLAIM_MEETING_SCRIPT = `
local meetingKey = KEYS[1]
local globalSetKey = KEYS[2]
local workerSetKey = KEYS[3]
local workerId = ARGV[1]
local meetingId = ARGV[2]
local now = ARGV[3]
local ttlMs = ARGV[4]

-- Check if meeting already has an owner
local currentOwner = redis.call('GET', meetingKey .. ':owner')
if currentOwner and currentOwner ~= workerId then
  -- Check if current owner is still alive
  local ownerHeartbeat = redis.call('GET', 'worker:' .. currentOwner .. ':heartbeat')
  if ownerHeartbeat then
    local lastBeat = tonumber(ownerHeartbeat) or 0
    if (tonumber(now) - lastBeat) < tonumber(ttlMs) then
      return 0  -- Meeting is owned by a healthy worker
    end
  end
end

-- Claim the meeting
redis.call('SET', meetingKey .. ':owner', workerId)
redis.call('SET', meetingKey .. ':heartbeat', now)
redis.call('SET', meetingKey .. ':state', 'active')
redis.call('SADD', globalSetKey, meetingId)
redis.call('SADD', workerSetKey, meetingId)

return 1
`;
// Release a meeting from a worker
const RELEASE_MEETING_SCRIPT = `
local meetingKey = KEYS[1]
local globalSetKey = KEYS[2]
local workerSetKey = KEYS[3]
local workerId = ARGV[1]
local meetingId = ARGV[2]

-- Only release if we own it
local currentOwner = redis.call('GET', meetingKey .. ':owner')
if currentOwner ~= workerId then
  return 0
end

-- Clean up
redis.call('DEL', meetingKey .. ':owner')
redis.call('DEL', meetingKey .. ':heartbeat')
redis.call('DEL', meetingKey .. ':state')
redis.call('DEL', meetingKey .. ':participants')
redis.call('SREM', globalSetKey, meetingId)
redis.call('SREM', workerSetKey, meetingId)

return 1
`;
// ── Global Meeting Coordinator Class ────────────────────────
class GlobalMeetingCoordinator extends events_1.EventEmitter {
    config;
    redis = null;
    workerId;
    heartbeatInterval = null;
    healthCheckInterval = null;
    isRunning = false;
    claimMeetingSha = null;
    releaseMeetingSha = null;
    constructor(workerId, config = {}) {
        super();
        this.workerId = workerId || this.generateWorkerId();
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    /**
     * Generate a unique worker ID.
     */
    generateWorkerId() {
        const hostname = process.env.HOSTNAME || 'local';
        const pid = process.pid;
        const random = Math.random().toString(36).substring(2, 8);
        return `worker-${hostname}-${pid}-${random}`;
    }
    /**
     * Initialize and start the coordinator.
     */
    async start() {
        if (this.isRunning) {
            logger_1.logger.warn('[COORDINATOR] Already running');
            return;
        }
        try {
            this.redis = (0, redisClient_1.createBullMQConnection)();
            // Load Lua scripts
            this.claimMeetingSha = await this.redis.script('LOAD', CLAIM_MEETING_SCRIPT);
            this.releaseMeetingSha = await this.redis.script('LOAD', RELEASE_MEETING_SCRIPT);
            this.isRunning = true;
            // Start heartbeat
            await this.sendWorkerHeartbeat();
            this.heartbeatInterval = setInterval(async () => {
                try {
                    await this.sendWorkerHeartbeat();
                }
                catch (err) {
                    logger_1.logger.error('[COORDINATOR] Heartbeat failed', {
                        error: err instanceof Error ? err.message : String(err),
                    });
                    exports.coordinatorErrorsCounter.inc({ operation: 'heartbeat' });
                }
            }, this.config.heartbeatIntervalMs);
            this.heartbeatInterval.unref();
            // Start health checks
            this.healthCheckInterval = setInterval(async () => {
                try {
                    await this.runHealthCheck();
                }
                catch (err) {
                    logger_1.logger.error('[COORDINATOR] Health check failed', {
                        error: err instanceof Error ? err.message : String(err),
                    });
                    exports.coordinatorErrorsCounter.inc({ operation: 'health_check' });
                }
            }, this.config.healthCheckIntervalMs);
            this.healthCheckInterval.unref();
            logger_1.logger.info('[COORDINATOR] Started', {
                workerId: this.workerId,
                heartbeatMs: this.config.heartbeatIntervalMs,
                healthCheckMs: this.config.healthCheckIntervalMs,
            });
        }
        catch (err) {
            logger_1.logger.error('[COORDINATOR] Failed to start', {
                error: err instanceof Error ? err.message : String(err),
            });
            throw err;
        }
    }
    /**
     * Stop the coordinator.
     */
    async stop() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
        }
        // Release all our meetings
        if (this.redis) {
            const meetings = await this.getWorkerMeetings(this.workerId);
            for (const meetingId of meetings) {
                await this.releaseMeeting(meetingId);
            }
            // Remove worker registration
            await this.redis.del(`worker:${this.workerId}:heartbeat`);
            await this.redis.del(`worker:${this.workerId}:meetings`);
        }
        this.isRunning = false;
        logger_1.logger.info('[COORDINATOR] Stopped', { workerId: this.workerId });
    }
    /**
     * Claim ownership of a meeting.
     */
    async claimMeeting(meetingId) {
        if (!this.redis || !this.claimMeetingSha) {
            throw new Error('Coordinator not initialized');
        }
        const meetingKey = `meeting:${meetingId}`;
        const globalSetKey = 'global:active_meetings';
        const workerSetKey = `worker:${this.workerId}:meetings`;
        const now = Date.now().toString();
        const ttlMs = this.config.workerTimeoutMs.toString();
        const result = await this.redis.evalsha(this.claimMeetingSha, 3, meetingKey, globalSetKey, workerSetKey, this.workerId, meetingId, now, ttlMs);
        const claimed = result === 1;
        if (claimed) {
            logger_1.logger.debug('[COORDINATOR] Claimed meeting', {
                meetingId,
                workerId: this.workerId,
            });
            exports.activeMeetingsGauge.inc();
        }
        return claimed;
    }
    /**
     * Release ownership of a meeting.
     */
    async releaseMeeting(meetingId) {
        if (!this.redis || !this.releaseMeetingSha) {
            throw new Error('Coordinator not initialized');
        }
        const meetingKey = `meeting:${meetingId}`;
        const globalSetKey = 'global:active_meetings';
        const workerSetKey = `worker:${this.workerId}:meetings`;
        const result = await this.redis.evalsha(this.releaseMeetingSha, 3, meetingKey, globalSetKey, workerSetKey, this.workerId, meetingId);
        const released = result === 1;
        if (released) {
            logger_1.logger.debug('[COORDINATOR] Released meeting', {
                meetingId,
                workerId: this.workerId,
            });
            exports.activeMeetingsGauge.dec();
        }
        return released;
    }
    /**
     * Send heartbeat for a specific meeting.
     */
    async sendMeetingHeartbeat(meetingId, participantCount = 0) {
        if (!this.redis)
            return;
        const meetingKey = `meeting:${meetingId}`;
        const now = Date.now();
        await this.redis.mset(`${meetingKey}:heartbeat`, now.toString(), `${meetingKey}:participants`, participantCount.toString());
    }
    /**
     * Send worker heartbeat.
     */
    async sendWorkerHeartbeat() {
        if (!this.redis)
            return;
        const now = Date.now();
        await this.redis.set(`worker:${this.workerId}:heartbeat`, now.toString());
    }
    /**
     * Run health check and detect issues.
     */
    async runHealthCheck() {
        if (!this.redis)
            return;
        const now = Date.now();
        // Get all active meetings
        const activeMeetings = await this.redis.smembers('global:active_meetings');
        exports.activeMeetingsGauge.set(activeMeetings.length);
        let stuckCount = 0;
        let orphanedCount = 0;
        for (const meetingId of activeMeetings) {
            const meetingKey = `meeting:${meetingId}`;
            const [ownerIdRaw, lastHeartbeatRaw] = await this.redis.mget(`${meetingKey}:owner`, `${meetingKey}:heartbeat`);
            const ownerId = ownerIdRaw ?? undefined;
            const lastHeartbeat = parseInt(lastHeartbeatRaw || '0', 10);
            // Check if meeting is stuck (no heartbeat)
            if (now - lastHeartbeat > this.config.meetingTimeoutMs) {
                stuckCount++;
                const event = {
                    type: 'meeting_stuck',
                    meetingId,
                    workerId: ownerId,
                    timestamp: new Date(),
                    details: { lastHeartbeat, ageMs: now - lastHeartbeat },
                };
                this.emit('event', event);
                if (this.config.autoRecovery) {
                    await this.recoverMeeting(meetingId, 'stuck');
                }
            }
            // Check if owner is dead
            if (ownerId) {
                const workerHeartbeat = await this.redis.get(`worker:${ownerId}:heartbeat`);
                const workerLastBeat = parseInt(workerHeartbeat || '0', 10);
                if (now - workerLastBeat > this.config.workerTimeoutMs) {
                    orphanedCount++;
                    const event = {
                        type: 'meeting_orphaned',
                        meetingId,
                        workerId: ownerId,
                        timestamp: new Date(),
                        details: { workerLastBeat, ageMs: now - workerLastBeat },
                    };
                    this.emit('event', event);
                    if (this.config.autoRecovery) {
                        await this.recoverMeeting(meetingId, 'orphaned');
                    }
                }
            }
        }
        exports.stuckMeetingsGauge.set(stuckCount);
        exports.orphanedMeetingsGauge.set(orphanedCount);
        // Count active workers
        const workerKeys = await this.redis.keys('worker:*:heartbeat');
        let activeWorkerCount = 0;
        let deadWorkerCount = 0;
        for (const key of workerKeys) {
            const heartbeat = await this.redis.get(key);
            const lastBeat = parseInt(heartbeat || '0', 10);
            if (now - lastBeat < this.config.workerTimeoutMs) {
                activeWorkerCount++;
            }
            else {
                deadWorkerCount++;
                const workerId = key.replace('worker:', '').replace(':heartbeat', '');
                const event = {
                    type: 'worker_dead',
                    workerId,
                    timestamp: new Date(),
                    details: { lastBeat, ageMs: now - lastBeat },
                };
                this.emit('event', event);
                exports.workerFailuresCounter.inc();
            }
        }
        exports.activeWorkersGauge.set(activeWorkerCount);
    }
    /**
     * Recover an orphaned or stuck meeting.
     */
    async recoverMeeting(meetingId, reason) {
        if (!this.redis)
            return;
        logger_1.logger.warn('[COORDINATOR] Recovering meeting', {
            meetingId,
            reason,
            newOwner: this.workerId,
        });
        const meetingKey = `meeting:${meetingId}`;
        // Force update ownership to this worker
        await this.redis.set(`${meetingKey}:owner`, this.workerId);
        await this.redis.set(`${meetingKey}:heartbeat`, Date.now().toString());
        await this.redis.set(`${meetingKey}:state`, 'active');
        await this.redis.sadd(`worker:${this.workerId}:meetings`, meetingId);
        exports.meetingRecoveriesCounter.inc();
        const event = {
            type: 'meeting_recovered',
            meetingId,
            workerId: this.workerId,
            timestamp: new Date(),
            details: { reason },
        };
        this.emit('event', event);
    }
    /**
     * Get meetings owned by a specific worker.
     */
    async getWorkerMeetings(workerId) {
        if (!this.redis)
            return [];
        return this.redis.smembers(`worker:${workerId}:meetings`);
    }
    /**
     * Get info about a specific meeting.
     */
    async getMeetingInfo(meetingId) {
        if (!this.redis)
            return null;
        const meetingKey = `meeting:${meetingId}`;
        const [ownerIdRaw, stateRaw, lastHeartbeatRaw, participantsRaw] = await this.redis.mget(`${meetingKey}:owner`, `${meetingKey}:state`, `${meetingKey}:heartbeat`, `${meetingKey}:participants`);
        const ownerId = ownerIdRaw ?? undefined;
        const state = stateRaw ?? undefined;
        const lastHeartbeat = parseInt(lastHeartbeatRaw || '0', 10);
        const participantCount = parseInt(participantsRaw || '0', 10);
        if (!ownerId)
            return null;
        return {
            meetingId,
            ownerId,
            state: state || 'active',
            startedAt: lastHeartbeat, // We don't track start time separately
            lastHeartbeat,
            participantCount,
        };
    }
    /**
     * Get full cluster health report.
     */
    async getClusterHealth() {
        if (!this.redis) {
            throw new Error('Coordinator not initialized');
        }
        const now = Date.now();
        const activeMeetings = await this.redis.smembers('global:active_meetings');
        const workerKeys = await this.redis.keys('worker:*:heartbeat');
        const workers = [];
        let deadWorkers = 0;
        let stuckMeetings = 0;
        let orphanedMeetings = 0;
        let totalParticipants = 0;
        // Process workers
        for (const key of workerKeys) {
            const workerId = key.replace('worker:', '').replace(':heartbeat', '');
            const heartbeat = await this.redis.get(key);
            const lastBeat = parseInt(heartbeat || '0', 10);
            const isHealthy = now - lastBeat < this.config.workerTimeoutMs;
            const meetings = await this.getWorkerMeetings(workerId);
            if (!isHealthy)
                deadWorkers++;
            workers.push({
                workerId,
                meetingCount: meetings.length,
                lastHeartbeat: lastBeat,
                isHealthy,
                meetings,
            });
        }
        // Check meetings
        for (const meetingId of activeMeetings) {
            const info = await this.getMeetingInfo(meetingId);
            if (info) {
                totalParticipants += info.participantCount;
                if (now - info.lastHeartbeat > this.config.meetingTimeoutMs) {
                    stuckMeetings++;
                }
                // Check if owner is dead
                const workerInfo = workers.find(w => w.workerId === info.ownerId);
                if (!workerInfo || !workerInfo.isHealthy) {
                    orphanedMeetings++;
                }
            }
        }
        return {
            timestamp: new Date(),
            activeWorkers: workers.filter(w => w.isHealthy).length,
            deadWorkers,
            activeMeetings: activeMeetings.length,
            stuckMeetings,
            orphanedMeetings,
            totalParticipants,
            workers,
        };
    }
    /**
     * Get current worker ID.
     */
    getWorkerId() {
        return this.workerId;
    }
    /**
     * Check if coordinator is running.
     */
    isCoordinatorRunning() {
        return this.isRunning;
    }
}
exports.GlobalMeetingCoordinator = GlobalMeetingCoordinator;
// ── Singleton ───────────────────────────────────────────────
exports.globalMeetingCoordinator = new GlobalMeetingCoordinator();
// ── Exports ─────────────────────────────────────────────────
async function startMeetingCoordinator() {
    await exports.globalMeetingCoordinator.start();
}
async function stopMeetingCoordinator() {
    await exports.globalMeetingCoordinator.stop();
}
async function claimMeeting(meetingId) {
    return exports.globalMeetingCoordinator.claimMeeting(meetingId);
}
async function releaseMeeting(meetingId) {
    return exports.globalMeetingCoordinator.releaseMeeting(meetingId);
}
async function sendMeetingHeartbeat(meetingId, participantCount) {
    return exports.globalMeetingCoordinator.sendMeetingHeartbeat(meetingId, participantCount);
}
async function getMeetingInfo(meetingId) {
    return exports.globalMeetingCoordinator.getMeetingInfo(meetingId);
}
async function getClusterHealth() {
    return exports.globalMeetingCoordinator.getClusterHealth();
}
function onCoordinatorEvent(callback) {
    exports.globalMeetingCoordinator.on('event', callback);
    return () => exports.globalMeetingCoordinator.off('event', callback);
}
//# sourceMappingURL=meeting-coordinator.js.map