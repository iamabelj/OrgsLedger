"use strict";
// ============================================================
// OrgsLedger API — Meeting Transcript Handler
// Integrates Deepgram, translation pipeline, and Socket.IO
// Maintains backward compatibility with existing events
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.meetingTranscriptHandler = void 0;
const db_1 = require("../db");
const logger_1 = require("../logger");
const livekitAudioBridge_service_1 = require("./livekitAudioBridge.service");
const multilingualTranslation_service_1 = require("./multilingualTranslation.service");
const deepgramRealtime_service_1 = require("./deepgramRealtime.service");
class MeetingTranscriptHandler {
    contexts = new Map();
    pendingTranscripts = new Map(); // For batching finals
    /**
     * Initialize transcript handling for a participant in a meeting
     */
    async initializeParticipantTranscript(context) {
        try {
            const contextId = `${context.meetingId}:${context.participantId}`;
            // Start audio stream from LiveKit
            const streamId = await livekitAudioBridge_service_1.liveKitAudioBridgeService.startParticipantAudioStream({
                meetingId: context.meetingId,
                participantId: context.participantId,
                participantName: context.participantName,
                roomName: context.meetingId, // LiveKit room name
            }, {
                onInterimTranscript: (segment) => this.handleInterimTranscript(contextId, segment, context),
                onFinalTranscript: (segment) => this.handleFinalTranscript(contextId, segment, context),
                onLanguageDetected: (lang) => this.handleLanguageDetected(contextId, lang, context),
                onError: (err) => this.handleStreamError(contextId, err, context),
            });
            if (streamId) {
                this.contexts.set(contextId, context);
                logger_1.logger.info(`Initialized transcript handling for participant: ${context.participantId}`, {
                    meetingId: context.meetingId,
                    streamId,
                });
                return contextId;
            }
            return null;
        }
        catch (err) {
            logger_1.logger.error(`Failed to initialize participant transcript: ${context.participantId}`, err);
            return null;
        }
    }
    /**
     * Handle interim (real-time) transcript
     * Broadcast for live subtitles - KEEP EXISTING EVENT NAME
     */
    async handleInterimTranscript(contextId, segment, context) {
        try {
            // Update detected language
            if (segment.language) {
                const contextData = this.contexts.get(contextId);
                if (contextData) {
                    contextData.currentLanguage = segment.language;
                }
            }
            // Get translations for interim
            const translations = await multilingualTranslation_service_1.multilingualTranslationPipeline.translateToParticipants(segment.text, segment.language, context.meetingId);
            // Build broadcast payload - USING EXISTING EVENT STRUCTURE
            const payload = {
                speakerId: segment.speakerId,
                speakerName: segment.speakerName,
                originalText: segment.text,
                sourceLanguage: segment.language,
                translations: translations.translations,
                timestamp: segment.timestamp,
            };
            // Emit existing event name to maintain backward compatibility
            context.io.to(context.meetingId).emit('translation:interim', payload);
            logger_1.logger.debug(`Broadcast interim transcript: ${segment.speakerId}`, {
                textLength: segment.text.length,
                targetLanguages: Object.keys(payload.translations).length,
            });
        }
        catch (err) {
            logger_1.logger.error(`Failed to handle interim transcript for: ${contextId}`, err);
        }
    }
    /**
     * Handle final transcript
     * Store in DB and broadcast - KEEP EXISTING EVENT NAMES
     */
    async handleFinalTranscript(contextId, segment, context) {
        try {
            // Skip empty transcripts
            if (!segment.text || segment.text.trim().length === 0) {
                return;
            }
            // Get translations
            const translations = await multilingualTranslation_service_1.multilingualTranslationPipeline.translateToParticipants(segment.text, segment.language, context.meetingId);
            const payload = {
                speakerId: segment.speakerId,
                speakerName: segment.speakerName,
                originalText: segment.text,
                sourceLanguage: segment.language,
                translations: translations.translations,
                timestamp: segment.timestamp,
            };
            // Step 1: Broadcast final transcript - EXISTING EVENT
            context.io.to(context.meetingId).emit('translation:result', payload);
            // Step 2: Store transcript in database
            // Fetch organization_id from meeting
            const meeting = await (0, db_1.db)('meetings').where({ id: context.meetingId }).select('organization_id').first();
            if (meeting) {
                await (0, db_1.db)('meeting_transcripts').insert({
                    meeting_id: context.meetingId,
                    organization_id: meeting.organization_id,
                    speaker_id: segment.speakerId,
                    speaker_name: segment.speakerName,
                    original_text: segment.text,
                    source_lang: segment.language,
                    translations: translations.translations,
                    spoken_at: Math.floor(segment.timestamp.getTime?.() || Date.now()),
                });
            }
            // Step 3: Emit stored event - EXISTING EVENT
            context.io.to(context.meetingId).emit('transcript:stored', {
                meetingId: context.meetingId,
                speakerId: segment.speakerId,
                timestamp: segment.timestamp,
            });
            logger_1.logger.info(`Stored final transcript for: ${segment.speakerId}`, {
                meetingId: context.meetingId,
                textLength: segment.text.length,
            });
            // Track for batch minutes generation
            this.pendingTranscripts.set(contextId, segment.text);
        }
        catch (err) {
            logger_1.logger.error(`Failed to handle final transcript for: ${contextId}`, err);
        }
    }
    /**
     * Handle language detection
     */
    handleLanguageDetected(contextId, language, context) {
        try {
            const contextData = this.contexts.get(contextId);
            if (contextData) {
                contextData.currentLanguage = language;
            }
            logger_1.logger.info(`Detected language for ${contextId}: ${language}`);
            // Optionally emit language detection event (for UI feedback)
            context.io.to(context.meetingId).emit('transcript:language-detected', {
                speakerId: context.participantId,
                language,
                timestamp: new Date(),
            });
        }
        catch (err) {
            logger_1.logger.error(`Failed to handle language detection for: ${contextId}`, err);
        }
    }
    /**
     * Handle stream errors with fallback
     */
    async handleStreamError(contextId, error, context) {
        logger_1.logger.error(`Stream error for ${contextId}:`, error);
        // Notify client of error (non-blocking)
        context.io.to(context.meetingId).emit('transcript:error', {
            speakerId: context.participantId,
            error: error.message,
            timestamp: new Date(),
        });
        // Attempt to recover by recreating stream
        try {
            await this.reinitializeStream(contextId);
        }
        catch (recoveryErr) {
            logger_1.logger.error(`Failed to recover stream for ${contextId}:`, recoveryErr);
        }
    }
    /**
     * Reinitialize a failed stream
     */
    async reinitializeStream(contextId) {
        try {
            const context = this.contexts.get(contextId);
            if (!context) {
                return false;
            }
            // Close the old stream
            const [meetingId, participantId] = contextId.split(':');
            await livekitAudioBridge_service_1.liveKitAudioBridgeService.stopParticipantAudioStream(participantId);
            // Create new stream
            const newStreamId = await livekitAudioBridge_service_1.liveKitAudioBridgeService.startParticipantAudioStream({
                meetingId: context.meetingId,
                participantId: context.participantId,
                participantName: context.participantName,
                roomName: context.meetingId,
            }, {
                onInterimTranscript: (segment) => this.handleInterimTranscript(contextId, segment, context),
                onFinalTranscript: (segment) => this.handleFinalTranscript(contextId, segment, context),
                onLanguageDetected: (lang) => this.handleLanguageDetected(contextId, lang, context),
                onError: (err) => this.handleStreamError(contextId, err, context),
            });
            logger_1.logger.info(`Reinitialized stream for ${contextId}`, { newStreamId });
            return !!newStreamId;
        }
        catch (err) {
            logger_1.logger.error(`Failed to reinitialize stream for ${contextId}:`, err);
            return false;
        }
    }
    /**
     * Stop transcript handling for a participant
     */
    async stopParticipantTranscript(contextId) {
        try {
            const context = this.contexts.get(contextId);
            if (!context) {
                return true; // Already stopped
            }
            // Stop audio stream
            await livekitAudioBridge_service_1.liveKitAudioBridgeService.stopParticipantAudioStream(context.participantId);
            // Cleanup
            this.contexts.delete(contextId);
            this.pendingTranscripts.delete(contextId);
            logger_1.logger.info(`Stopped transcript handling for: ${contextId}`);
            return true;
        }
        catch (err) {
            logger_1.logger.error(`Failed to stop transcript handling for: ${contextId}`, err);
            return false;
        }
    }
    /**
     * Stop all transcripts for a meeting
     */
    async stopMeetingTranscripts(meetingId) {
        try {
            const contextIds = Array.from(this.contexts.keys()).filter((id) => id.startsWith(`${meetingId}:`));
            for (const contextId of contextIds) {
                await this.stopParticipantTranscript(contextId);
            }
            // Stop audio streams
            await livekitAudioBridge_service_1.liveKitAudioBridgeService.stopMeetingAudioStreams(meetingId);
            logger_1.logger.info(`Stopped all transcripts for meeting: ${meetingId}`);
        }
        catch (err) {
            logger_1.logger.error(`Failed to stop meeting transcripts: ${meetingId}`, err);
        }
    }
    /**
     * Get pending transcripts for a meeting (for minutes generation)
     */
    getPendingMeetingTranscripts(meetingId) {
        const transcripts = [];
        for (const [contextId, text] of this.pendingTranscripts.entries()) {
            const [ctxMeetingId] = contextId.split(':');
            if (ctxMeetingId === meetingId) {
                transcripts.push(text);
            }
        }
        return transcripts;
    }
    /**
     * Clear pending transcripts after processing
     */
    clearPendingTranscripts(meetingId) {
        const contextIds = Array.from(this.pendingTranscripts.keys()).filter((id) => id.startsWith(`${meetingId}:`));
        for (const contextId of contextIds) {
            this.pendingTranscripts.delete(contextId);
        }
        logger_1.logger.debug(`Cleared pending transcripts for meeting: ${meetingId}`);
    }
    /**
     * Get active transcripts in the system
     */
    getActiveTranscriptCount() {
        return this.contexts.size;
    }
    /**
     * Get transcripts for a specific meeting
     */
    getActiveMeetingTranscriptCount(meetingId) {
        let count = 0;
        for (const id of this.contexts.keys()) {
            if (id.startsWith(`${meetingId}:`)) {
                count++;
            }
        }
        return count;
    }
    /**
     * Get health status
     */
    getStatus() {
        const deepgramStatus = deepgramRealtime_service_1.deepgramRealtimeService.getStatus();
        const livekitStatus = livekitAudioBridge_service_1.liveKitAudioBridgeService.getStatus();
        return {
            isHealthy: deepgramStatus.isHealthy && livekitStatus.isHealthy,
            activeTranscripts: this.contexts.size,
            deepgramConfigured: deepgramStatus.configured,
            liveKitConfigured: livekitStatus.liveKitConfigured,
        };
    }
}
// Export singleton instance
exports.meetingTranscriptHandler = new MeetingTranscriptHandler();
//# sourceMappingURL=meetingTranscript.handler.js.map