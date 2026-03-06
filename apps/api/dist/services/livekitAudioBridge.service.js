"use strict";
// ============================================================
// OrgsLedger API — LiveKit Audio Bridge Service
// Subscribe to participant audio tracks and pipe to Deepgram
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.liveKitAudioBridgeService = void 0;
const livekit_server_sdk_1 = require("livekit-server-sdk");
const deepgramRealtime_service_1 = require("./deepgramRealtime.service");
const logger_1 = require("../logger");
class LiveKitAudioBridgeService {
    activeParticipants = new Map();
    streamIds = new Map(); // participantId -> streamId mapping
    roomClient = null;
    constructor() {
        const url = process.env.LIVEKIT_URL;
        const apiKey = process.env.LIVEKIT_API_KEY;
        const apiSecret = process.env.LIVEKIT_API_SECRET;
        if (url && apiKey && apiSecret) {
            this.roomClient = new livekit_server_sdk_1.RoomServiceClient(url, apiKey, apiSecret);
            logger_1.logger.info('LiveKit audio bridge initialized');
        }
        else {
            logger_1.logger.warn('LiveKit credentials not fully configured for audio bridge');
        }
    }
    /**
     * Start audio streaming for a participant
     */
    async startParticipantAudioStream(config, callbacks) {
        try {
            if (!this.roomClient) {
                logger_1.logger.warn('LiveKit audio bridge not initialized');
                return null;
            }
            const streamId = `${config.meetingId}:${config.participantId}`;
            // Create Deepgram stream for this participant
            const streamCreated = await deepgramRealtime_service_1.deepgramRealtimeService.createStream(streamId, {
                meetingId: config.meetingId,
                speakerId: config.participantId,
                speakerName: config.participantName,
            }, {
                onInterim: callbacks?.onInterimTranscript,
                onFinal: callbacks?.onFinalTranscript,
                onLanguageDetected: callbacks?.onLanguageDetected,
                onError: callbacks?.onError,
            });
            if (!streamCreated) {
                logger_1.logger.error(`Failed to create Deepgram stream for participant: ${config.participantId}`);
                return null;
            }
            // Store mapping
            this.streamIds.set(config.participantId, streamId);
            this.activeParticipants.set(config.participantId, config);
            logger_1.logger.info(`Started audio streaming for participant: ${config.participantId}`, {
                meetingId: config.meetingId,
                streamId,
            });
            return streamId;
        }
        catch (err) {
            logger_1.logger.error(`Failed to start audio streaming for participant: ${config.participantId}`, err);
            return null;
        }
    }
    /**
     * Stop audio streaming for a participant
     */
    async stopParticipantAudioStream(participantId) {
        try {
            const streamId = this.streamIds.get(participantId);
            if (!streamId) {
                return true; // Already stopped
            }
            await deepgramRealtime_service_1.deepgramRealtimeService.closeStream(streamId);
            this.streamIds.delete(participantId);
            this.activeParticipants.delete(participantId);
            logger_1.logger.info(`Stopped audio streaming for participant: ${participantId}`);
            return true;
        }
        catch (err) {
            logger_1.logger.error(`Failed to stop audio streaming for participant: ${participantId}`, err);
            return false;
        }
    }
    /**
     * Send audio chunk from participant
     */
    async sendAudioChunk(participantId, audioBuffer) {
        try {
            const streamId = this.streamIds.get(participantId);
            if (!streamId) {
                logger_1.logger.debug(`No active stream for participant: ${participantId}`);
                return false;
            }
            return await deepgramRealtime_service_1.deepgramRealtimeService.handleAudioChunk(streamId, audioBuffer);
        }
        catch (err) {
            logger_1.logger.error(`Failed to send audio chunk for participant: ${participantId}`, err);
            return false;
        }
    }
    /**
     * Stop all audio streams for a meeting
     */
    async stopMeetingAudioStreams(meetingId) {
        try {
            // Close all streams for this meeting
            for (const [participantId, config] of this.activeParticipants.entries()) {
                if (config.meetingId === meetingId) {
                    await this.stopParticipantAudioStream(participantId);
                }
            }
            // Also close Deepgram streams
            await deepgramRealtime_service_1.deepgramRealtimeService.closeMeetingStreams(meetingId);
            logger_1.logger.info(`Stopped all audio streams for meeting: ${meetingId}`);
        }
        catch (err) {
            logger_1.logger.error(`Failed to stop meeting audio streams: ${meetingId}`, err);
        }
    }
    /**
     * Get active participant count for a meeting
     */
    getActiveParticipantCount(meetingId) {
        let count = 0;
        for (const config of this.activeParticipants.values()) {
            if (config.meetingId === meetingId) {
                count++;
            }
        }
        return count;
    }
    /**
     * Get all active participants for a meeting
     */
    getActiveMeetingParticipants(meetingId) {
        const participants = [];
        for (const [participantId, config] of this.activeParticipants.entries()) {
            if (config.meetingId === meetingId) {
                participants.push({
                    participantId,
                    participantName: config.participantName,
                });
            }
        }
        return participants;
    }
    /**
     * Get health status
     */
    getStatus() {
        return {
            isHealthy: this.roomClient !== null,
            activeParticipants: this.activeParticipants.size,
            liveKitConfigured: this.roomClient !== null,
        };
    }
}
// Export singleton instance
exports.liveKitAudioBridgeService = new LiveKitAudioBridgeService();
//# sourceMappingURL=livekitAudioBridge.service.js.map