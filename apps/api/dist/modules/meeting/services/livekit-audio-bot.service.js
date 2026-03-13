"use strict";
// ============================================================
// OrgsLedger API — LiveKit Audio Bot
// Joins LiveKit rooms as hidden participant
// Streams audio to Deepgram for transcription
// Runs as separate process to avoid blocking API
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.LiveKitAudioBot = void 0;
exports.startAudioBot = startAudioBot;
exports.stopAudioBot = stopAudioBot;
exports.getAudioBot = getAudioBot;
exports.getActiveBotCount = getActiveBotCount;
exports.stopAllBots = stopAllBots;
const events_1 = require("events");
const logger_1 = require("../../../logger");
const transcription_service_1 = require("./transcription.service");
const livekit_token_service_1 = require("./livekit-token.service");
// Note: This is a simplified implementation that works without 
// the full @livekit/rtc-node SDK. For production, you would use
// the livekit-server-sdk for Egress API to capture audio streams.
// ── Audio Bot Class ─────────────────────────────────────────
class LiveKitAudioBot extends events_1.EventEmitter {
    transcriptionSession = null;
    config;
    isRunning = false;
    ws = null;
    constructor(cfg) {
        super();
        this.config = cfg;
    }
    /**
     * Start the audio bot
     * Note: In production, use LiveKit Egress API for reliable audio capture
     */
    async start() {
        if (this.isRunning) {
            logger_1.logger.warn('[AUDIO_BOT] Already running', {
                meetingId: this.config.meetingId,
            });
            return;
        }
        try {
            // Generate bot token for potential future use
            const tokenResponse = await (0, livekit_token_service_1.generateParticipantToken)({
                meetingId: this.config.meetingId,
                userId: `bot-transcription-${this.config.meetingId}`,
                name: 'Transcription Bot',
                role: 'bot',
            });
            // Start transcription session (ready to receive audio)
            this.transcriptionSession = await (0, transcription_service_1.createTranscriptionSession)({
                meetingId: this.config.meetingId,
                language: this.config.language,
                diarize: true,
                punctuate: true,
                smartFormat: true,
            });
            // Set up transcription event forwarding
            this.setupTranscriptionEvents();
            this.isRunning = true;
            logger_1.logger.info('[AUDIO_BOT] Started', {
                meetingId: this.config.meetingId,
                roomName: tokenResponse.roomName,
            });
            this.emit('started');
            // Note: Actual audio streaming from LiveKit would be done via:
            // 1. LiveKit Egress API (recommended for production)
            // 2. Client-side audio capture and server relay
            // 3. @livekit/rtc-node with proper audio frame handling
        }
        catch (err) {
            logger_1.logger.error('[AUDIO_BOT] Failed to start', {
                meetingId: this.config.meetingId,
                error: err.message,
            });
            throw err;
        }
    }
    /**
     * Set up transcription event forwarding
     */
    setupTranscriptionEvents() {
        if (!this.transcriptionSession)
            return;
        this.transcriptionSession.on('transcript', (result) => {
            this.emit('transcript', {
                meetingId: this.config.meetingId,
                ...result,
            });
        });
        this.transcriptionSession.on('error', (error) => {
            logger_1.logger.error('[AUDIO_BOT] Transcription error', {
                meetingId: this.config.meetingId,
                error: error.message,
            });
            this.emit('transcriptionError', error);
        });
        this.transcriptionSession.on('disconnected', () => {
            logger_1.logger.warn('[AUDIO_BOT] Transcription disconnected', {
                meetingId: this.config.meetingId,
            });
        });
    }
    /**
     * Send audio data to transcription service
     * Called by external audio stream handler
     */
    sendAudio(audioData) {
        if (!this.transcriptionSession?.isActive()) {
            return;
        }
        this.transcriptionSession.sendAudio(audioData);
    }
    /**
     * Stop the audio bot
     */
    async stop() {
        if (!this.isRunning)
            return;
        logger_1.logger.info('[AUDIO_BOT] Stopping', {
            meetingId: this.config.meetingId,
        });
        // Close transcription session
        if (this.transcriptionSession) {
            await (0, transcription_service_1.closeTranscriptionSession)(this.config.meetingId);
            this.transcriptionSession = null;
        }
        // Close WebSocket if any
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.isRunning = false;
        logger_1.logger.info('[AUDIO_BOT] Stopped', {
            meetingId: this.config.meetingId,
        });
        this.emit('stopped');
    }
    /**
     * Check if bot is running
     */
    getIsRunning() {
        return this.isRunning;
    }
}
exports.LiveKitAudioBot = LiveKitAudioBot;
// ── Bot Manager ─────────────────────────────────────────────
const activeBots = new Map();
/**
 * Start an audio bot for a meeting
 */
async function startAudioBot(cfg) {
    // Stop existing bot if any
    const existing = activeBots.get(cfg.meetingId);
    if (existing) {
        await existing.stop();
        activeBots.delete(cfg.meetingId);
    }
    const bot = new LiveKitAudioBot(cfg);
    await bot.start();
    activeBots.set(cfg.meetingId, bot);
    return bot;
}
/**
 * Stop an audio bot
 */
async function stopAudioBot(meetingId) {
    const bot = activeBots.get(meetingId);
    if (bot) {
        await bot.stop();
        activeBots.delete(meetingId);
    }
}
/**
 * Get active bot for a meeting
 */
function getAudioBot(meetingId) {
    return activeBots.get(meetingId);
}
/**
 * Get count of active bots
 */
function getActiveBotCount() {
    return activeBots.size;
}
/**
 * Stop all active bots (for graceful shutdown)
 */
async function stopAllBots() {
    const stopPromises = Array.from(activeBots.values()).map(bot => bot.stop());
    await Promise.all(stopPromises);
    activeBots.clear();
}
//# sourceMappingURL=livekit-audio-bot.service.js.map