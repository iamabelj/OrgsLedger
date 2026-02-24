"use strict";
// ============================================================
// OrgsLedger — Bot Manager
// Singleton manager that orchestrates LivekitBot instances
// across multiple concurrent meetings. Each meeting gets
// one bot that subscribes to all participant audio tracks
// and creates per-speaker OpenAI Realtime transcription sessions.
// ============================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BotManager = void 0;
exports.initBotManager = initBotManager;
exports.getBotManager = getBotManager;
const logger_1 = require("../../logger");
const db_1 = __importDefault(require("../../db"));
const livekit_service_1 = require("../livekit.service");
const livekitBot_1 = require("./livekitBot");
// ── Bot Manager ──────────────────────────────────────────────
class BotManager {
    bots = new Map();
    io;
    meetingLanguages;
    constructor(deps) {
        this.io = deps.io;
        this.meetingLanguages = deps.meetingLanguages;
        logger_1.logger.info('[BotManager] Initialized');
    }
    // ── Public API ──────────────────────────────────────────
    /**
     * Start a transcription bot for a meeting.
     * Looks up the meeting's organization and room name, then
     * creates and connects a LivekitBot.
     *
     * Idempotent — calling this for a meeting that already has
     * a bot does nothing.
     */
    async startMeetingBot(meetingId) {
        // Already running?
        if (this.bots.has(meetingId)) {
            logger_1.logger.info(`[BotManager] Bot already running for meeting=${meetingId}`);
            return;
        }
        // Look up meeting details
        const meeting = await (0, db_1.default)('meetings')
            .where({ id: meetingId })
            .select('id', 'organization_id', 'title')
            .first();
        if (!meeting) {
            logger_1.logger.error(`[BotManager] Meeting not found: ${meetingId}`);
            throw new Error(`Meeting ${meetingId} not found`);
        }
        const organizationId = meeting.organization_id;
        if (!organizationId) {
            logger_1.logger.error(`[BotManager] Meeting ${meetingId} has no organization_id`);
            throw new Error(`Meeting ${meetingId} has no organization`);
        }
        // Generate deterministic room name (same logic as livekit.service.ts)
        const roomName = (0, livekit_service_1.generateRoomName)(organizationId, meetingId);
        logger_1.logger.info(`[BotManager] Starting bot: meeting=${meetingId} (${meeting.title}), room=${roomName}`);
        const bot = new livekitBot_1.LivekitBot({
            meetingId,
            organizationId,
            roomName,
            io: this.io,
            meetingLanguages: this.meetingLanguages,
        });
        this.bots.set(meetingId, bot);
        try {
            await bot.connect();
            // ── LAYER 8 — Verify concurrent session count ───
            logger_1.logger.info(`[BotManager] Bot connected: meeting=${meetingId}, room=${roomName}, totalActiveBots=${this.bots.size}`);
        }
        catch (err) {
            logger_1.logger.error(`[BotManager] Bot failed to connect: meeting=${meetingId}`, err);
            this.bots.delete(meetingId);
            throw err;
        }
    }
    /**
     * Stop and disconnect the bot for a meeting.
     * Cleans up all RealtimeSessions and the LiveKit connection.
     */
    async stopMeetingBot(meetingId) {
        const bot = this.bots.get(meetingId);
        if (!bot) {
            logger_1.logger.debug(`[BotManager] No bot running for meeting=${meetingId}`);
            return;
        }
        // ── LAYER 7.2 — Meeting end closes everything ─────
        logger_1.logger.info(`[Bot] Stopping bot for meeting ${meetingId} (activeSessions=${bot.activeSessionCount})`);
        await bot.disconnect();
        this.bots.delete(meetingId);
        // ── LAYER 8 — Verify no ghost sessions remain ────
        logger_1.logger.info(`[Bot] Bot stopped for meeting ${meetingId}, remainingBots=${this.bots.size}`);
    }
    /**
     * Get the bot instance for a meeting (if running).
     */
    getBot(meetingId) {
        return this.bots.get(meetingId);
    }
    /**
     * Check if a bot is running for a meeting.
     */
    hasBot(meetingId) {
        return this.bots.has(meetingId);
    }
    /**
     * Get status info for all running bots.
     */
    getStatus() {
        const result = [];
        for (const [meetingId, bot] of this.bots) {
            result.push({
                meetingId,
                activeSessions: bot.activeSessionCount,
            });
        }
        return result;
    }
    /**
     * Stop all bots. Called during graceful shutdown.
     */
    async shutdownAll() {
        // ── LAYER 8 — Cost control: confirm all sessions close ─
        logger_1.logger.info(`[BotManager] Shutting down ALL bots (${this.bots.size} active)`);
        const botIds = [...this.bots.keys()];
        const promises = [];
        for (const meetingId of botIds) {
            promises.push(this.stopMeetingBot(meetingId));
        }
        await Promise.allSettled(promises);
        logger_1.logger.info(`[BotManager] Shutdown complete — no WebSocket connections should remain (bots.size=${this.bots.size})`);
    }
}
exports.BotManager = BotManager;
// ── Singleton ─────────────────────────────────────────────
let managerInstance = null;
/**
 * Initialize the BotManager singleton.
 * Call once during server startup (index.ts).
 */
function initBotManager(deps) {
    if (managerInstance) {
        logger_1.logger.warn('[BotManager] Already initialized, returning existing instance');
        return managerInstance;
    }
    managerInstance = new BotManager(deps);
    return managerInstance;
}
/**
 * Get the BotManager singleton.
 * Throws if not yet initialized.
 */
function getBotManager() {
    if (!managerInstance) {
        throw new Error('BotManager not initialized — call initBotManager() first');
    }
    return managerInstance;
}
//# sourceMappingURL=botManager.js.map