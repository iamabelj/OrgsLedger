"use strict";
// ============================================================
// OrgsLedger API — Usage Analytics Service
// Tracks business-level usage patterns for reporting & billing.
// Stores rolling windows in-memory with periodic DB snapshots.
// ============================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.trackEvent = trackEvent;
exports.getRecentEvents = getRecentEvents;
exports.getOrgUsageSummary = getOrgUsageSummary;
exports.getAllOrgUsage = getAllOrgUsage;
exports.getDailyTrends = getDailyTrends;
exports.getAnalyticsSnapshot = getAnalyticsSnapshot;
exports.persistDailySnapshot = persistDailySnapshot;
const logger_1 = require("../logger");
const db_1 = __importDefault(require("../db"));
const analyticsLogger = (0, logger_1.createServiceLogger)('analytics');
// ── Rolling Buffer ────────────────────────────────────────
const BUFFER_SIZE = 10000;
const eventBuffer = [];
// Aggregate counters per org (for billing/usage dashboards)
const orgUsage = new Map();
// Daily aggregates (keyed by date string YYYY-MM-DD)
const dailyAggregates = new Map();
// ── Track Event ───────────────────────────────────────────
function trackEvent(event, opts = {}) {
    const entry = {
        event,
        timestamp: new Date().toISOString(),
        orgId: opts.orgId,
        userId: opts.userId,
        metadata: opts.metadata,
    };
    // Buffer
    eventBuffer.push(entry);
    if (eventBuffer.length > BUFFER_SIZE) {
        eventBuffer.shift();
    }
    // Org-level aggregation
    if (opts.orgId) {
        let usage = orgUsage.get(opts.orgId);
        if (!usage) {
            // Cap org usage tracking to 1000 most recent orgs
            if (orgUsage.size >= 1000) {
                const oldestKey = orgUsage.keys().next().value;
                if (oldestKey)
                    orgUsage.delete(oldestKey);
            }
            usage = {
                meetingsCreated: 0,
                aiMinutesUsed: 0,
                membersAdded: 0,
                paymentsCompleted: 0,
                walletFunded: 0,
                walletDeducted: 0,
                messagesSent: 0,
                documentsUploaded: 0,
                lastActivity: entry.timestamp,
            };
            orgUsage.set(opts.orgId, usage);
        }
        usage.lastActivity = entry.timestamp;
        switch (event) {
            case 'member.joined':
                usage.membersAdded++;
                break;
            case 'payment.completed':
                usage.paymentsCompleted++;
                break;
            case 'wallet.funded':
                usage.walletFunded++;
                break;
            case 'wallet.deducted':
                usage.walletDeducted++;
                break;
            case 'chat.message_sent':
                usage.messagesSent++;
                break;
            case 'document.uploaded':
                usage.documentsUploaded++;
                break;
        }
    }
    // Daily aggregation
    const day = entry.timestamp.slice(0, 10); // YYYY-MM-DD
    let dayMap = dailyAggregates.get(day);
    if (!dayMap) {
        dayMap = new Map();
        dailyAggregates.set(day, dayMap);
    }
    dayMap.set(event, (dayMap.get(event) || 0) + 1);
    // Keep only last 30 days of aggregates
    if (dailyAggregates.size > 30) {
        const oldestKey = dailyAggregates.keys().next().value;
        if (oldestKey)
            dailyAggregates.delete(oldestKey);
    }
    analyticsLogger.debug(`Event: ${event}`, { orgId: opts.orgId, userId: opts.userId });
}
// ── Query Functions ───────────────────────────────────────
/** Get recent events (for live feed) */
function getRecentEvents(limit = 100, eventFilter) {
    let results = eventBuffer.slice(-limit * 2); // over-fetch then filter
    if (eventFilter) {
        results = results.filter((e) => e.event === eventFilter);
    }
    return results.slice(-limit).reverse();
}
/** Get org usage summary (for org admin dashboard) */
function getOrgUsageSummary(orgId) {
    return orgUsage.get(orgId) || null;
}
/** Get all org usage (for super admin) */
function getAllOrgUsage() {
    const result = [];
    orgUsage.forEach((usage, orgId) => {
        result.push({ orgId, ...usage });
    });
    return result.sort((a, b) => (b?.lastActivity || '').localeCompare(a?.lastActivity || ''));
}
/** Get daily trends (for graphs) */
function getDailyTrends(days = 7) {
    const result = [];
    const sortedDays = Array.from(dailyAggregates.keys()).sort().slice(-days);
    for (const day of sortedDays) {
        const dayMap = dailyAggregates.get(day);
        const events = {};
        let total = 0;
        dayMap.forEach((count, event) => {
            events[event] = count;
            total += count;
        });
        result.push({ date: day, events, total });
    }
    return result;
}
/** Get platform-wide analytics snapshot */
function getAnalyticsSnapshot() {
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const last1h = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const eventsLast24h = eventBuffer.filter((e) => e.timestamp >= last24h);
    const eventsLast1h = eventBuffer.filter((e) => e.timestamp >= last1h);
    // Count by event type
    const eventCounts = {};
    for (const e of eventsLast24h) {
        eventCounts[e.event] = (eventCounts[e.event] || 0) + 1;
    }
    // Unique active orgs / users
    const activeOrgs24h = new Set(eventsLast24h.filter((e) => e.orgId).map((e) => e.orgId));
    const activeUsers24h = new Set(eventsLast24h.filter((e) => e.userId).map((e) => e.userId));
    return {
        period: {
            last1h: eventsLast1h.length,
            last24h: eventsLast24h.length,
            bufferSize: eventBuffer.length,
        },
        activeOrgs: activeOrgs24h.size,
        activeUsers: activeUsers24h.size,
        eventCounts,
        dailyTrends: getDailyTrends(7),
        topOrgs: getAllOrgUsage().slice(0, 10),
    };
}
// ── Periodic DB Snapshot (optional) ───────────────────────
// Call this from a scheduler to persist daily analytics to the DB.
async function persistDailySnapshot() {
    try {
        const today = new Date().toISOString().slice(0, 10);
        const dayMap = dailyAggregates.get(today);
        if (!dayMap || dayMap.size === 0)
            return;
        const events = {};
        dayMap.forEach((count, event) => {
            events[event] = count;
        });
        // Upsert into analytics_snapshots table (if it exists)
        const tableExists = await db_1.default.schema.hasTable('analytics_snapshots');
        if (tableExists) {
            await (0, db_1.default)('analytics_snapshots')
                .insert({
                snapshot_date: today,
                event_counts: JSON.stringify(events),
                active_orgs: new Set(eventBuffer.filter((e) => e.timestamp.startsWith(today) && e.orgId).map((e) => e.orgId)).size,
                active_users: new Set(eventBuffer.filter((e) => e.timestamp.startsWith(today) && e.userId).map((e) => e.userId)).size,
                created_at: new Date(),
            })
                .onConflict('snapshot_date')
                .merge();
            analyticsLogger.info(`Persisted daily snapshot for ${today}`);
        }
    }
    catch (err) {
        analyticsLogger.warn('Failed to persist daily snapshot', { error: err.message });
        // Non-critical — analytics continues to work in-memory
    }
}
//# sourceMappingURL=analytics.service.js.map