// ============================================================
// OrgsLedger — Bot Manager
// Singleton manager that orchestrates LivekitBot instances
// across multiple concurrent meetings. Each meeting gets
// one bot that subscribes to all participant audio tracks
// and creates per-speaker Deepgram transcription streams.
// ============================================================

import { logger } from '../../logger';
import db from '../../db';
import { generateRoomName } from '../livekit.service';
import { LivekitBot, LivekitBotOptions } from './livekitBot';

// ── Types ────────────────────────────────────────────────────

export interface BotManagerDeps {
  /** Socket.IO server instance for broadcasting */
  io: any;
}

// ── Bot Manager ──────────────────────────────────────────────

export class BotManager {
  private bots = new Map<string, LivekitBot>();
  private readonly io: any;

  constructor(deps: BotManagerDeps) {
    this.io = deps.io;
    logger.info('[BotManager] Initialized');
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
  async startMeetingBot(meetingId: string): Promise<void> {
    // Already running?
    if (this.bots.has(meetingId)) {
      logger.info(`[BotManager] Bot already running for meeting=${meetingId}`);
      return;
    }

    // Look up meeting details
    const meeting = await db('meetings')
      .where({ id: meetingId })
      .select('id', 'organization_id', 'title')
      .first();

    if (!meeting) {
      logger.error(`[BotManager] Meeting not found: ${meetingId}`);
      throw new Error(`Meeting ${meetingId} not found`);
    }

    const organizationId = meeting.organization_id;
    if (!organizationId) {
      logger.error(`[BotManager] Meeting ${meetingId} has no organization_id`);
      throw new Error(`Meeting ${meetingId} has no organization`);
    }

    // Generate deterministic room name (same logic as livekit.service.ts)
    const roomName = generateRoomName(organizationId, meetingId);

    logger.info(`[BotManager] Starting bot: meeting=${meetingId} (${meeting.title}), room=${roomName}`);

    const bot = new LivekitBot({
      meetingId,
      organizationId,
      roomName,
      io: this.io,
    });

    this.bots.set(meetingId, bot);

    try {
      await bot.connect();
      // ── LAYER 8 — Verify concurrent session count ───
      logger.info(`[BotManager] Bot connected: meeting=${meetingId}, room=${roomName}, totalActiveBots=${this.bots.size}`);
    } catch (err) {
      logger.error(`[BotManager] Bot failed to connect: meeting=${meetingId}`, err);
      this.bots.delete(meetingId);
      throw err;
    }
  }

  /**
   * Stop and disconnect the bot for a meeting.
    * Cleans up all per-speaker Deepgram streams and the LiveKit connection.
   */
  async stopMeetingBot(meetingId: string): Promise<void> {
    const bot = this.bots.get(meetingId);
    if (!bot) {
      logger.debug(`[BotManager] No bot running for meeting=${meetingId}`);
      return;
    }

    // ── LAYER 7.2 — Meeting end closes everything ─────
    logger.info(`[Bot] Stopping bot for meeting ${meetingId} (activeSessions=${bot.activeSessionCount})`);
    await bot.disconnect();
    this.bots.delete(meetingId);
    // ── LAYER 8 — Verify no ghost sessions remain ────
    logger.info(`[Bot] Bot stopped for meeting ${meetingId}, remainingBots=${this.bots.size}`);
  }

  /**
   * Get the bot instance for a meeting (if running).
   */
  getBot(meetingId: string): LivekitBot | undefined {
    return this.bots.get(meetingId);
  }

  /**
   * Check if a bot is running for a meeting.
   */
  hasBot(meetingId: string): boolean {
    return this.bots.has(meetingId);
  }

  /**
   * Get status info for all running bots.
   */
  getStatus(): Array<{ meetingId: string; activeSessions: number }> {
    const result: Array<{ meetingId: string; activeSessions: number }> = [];
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
  async shutdownAll(): Promise<void> {
    // ── LAYER 8 — Cost control: confirm all sessions close ─
    logger.info(`[BotManager] Shutting down ALL bots (${this.bots.size} active)`);
    const botIds = [...this.bots.keys()];
    const promises: Promise<void>[] = [];
    for (const meetingId of botIds) {
      promises.push(this.stopMeetingBot(meetingId));
    }
    await Promise.allSettled(promises);
    logger.info(`[BotManager] Shutdown complete — no WebSocket connections should remain (bots.size=${this.bots.size})`);
  }
}

// ── Singleton ─────────────────────────────────────────────

let managerInstance: BotManager | null = null;

/**
 * Initialize the BotManager singleton.
 * Call once during server startup (index.ts).
 */
export function initBotManager(deps: BotManagerDeps): BotManager {
  if (managerInstance) {
    logger.warn('[BotManager] Already initialized, returning existing instance');
    return managerInstance;
  }
  managerInstance = new BotManager(deps);
  return managerInstance;
}

/**
 * Get the BotManager singleton.
 * Throws if not yet initialized.
 */
export function getBotManager(): BotManager {
  if (!managerInstance) {
    throw new Error('BotManager not initialized — call initBotManager() first');
  }
  return managerInstance;
}
