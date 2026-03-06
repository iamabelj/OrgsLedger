"use strict";
// ============================================================
// OrgsLedger API — Socket.IO Multilingual Meeting Integration
// Integrates Deepgram STT, translation, and transcript storage
// Maintains full backward compatibility with existing events
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerMultilingualMeetingHandlers = registerMultilingualMeetingHandlers;
exports.getMeetingTranscriptStats = getMeetingTranscriptStats;
exports.generateMeetingMinutesFromTranscripts = generateMeetingMinutesFromTranscripts;
const db_1 = require("../db");
const logger_1 = require("../logger");
const meetingTranscript_handler_1 = require("./meetingTranscript.handler");
const deepgramRealtime_service_1 = require("./deepgramRealtime.service");
/**
 * Register multilingual meeting transcript handlers
 * Call this function in socket.ts after Socket.IO setup
 *
 * @param io Socket.IO server instance
 * @param socket Individual socket connection
 */
function registerMultilingualMeetingHandlers(io, socket) {
    // Event: Client indicates they want to start audio streaming
    // NEW EVENT - safe to add without breaking existing code
    socket.on('meeting:transcript:start', async (data) => {
        try {
            const { meetingId, participantId, participantName } = data;
            if (!meetingId || !participantId || !participantName) {
                socket.emit('error', { message: 'Missing required meeting data' });
                return;
            }
            // Verify meeting membership (security check)
            const isMember = await (0, db_1.db)('meeting_participants')
                .where({ meeting_id: meetingId, user_id: participantId })
                .first();
            if (!isMember) {
                socket.emit('error', { message: 'Not a member of this meeting' });
                return;
            }
            // Get user's language preference
            const userLangPref = await (0, db_1.db)('user_language_preferences')
                .where({ user_id: participantId })
                .first();
            const userLanguage = userLangPref?.language || 'en';
            // Initialize transcript handler
            const contextId = await meetingTranscript_handler_1.meetingTranscriptHandler.initializeParticipantTranscript({
                meetingId,
                participantId,
                participantName,
                io,
                currentLanguage: userLanguage,
            });
            if (contextId) {
                // Store contextId on socket for later cleanup
                socket.data.transcriptContextId = contextId;
                socket.emit('meeting:transcript:started', { contextId });
                logger_1.logger.info(`Participant started transcript: ${participantId}`, { meetingId });
            }
            else {
                socket.emit('error', { message: 'Failed to start transcript' });
            }
        }
        catch (err) {
            logger_1.logger.error('Error starting meeting transcript:', err);
            socket.emit('error', { message: 'Failed to start transcript' });
        }
    });
    // Event: Client sends audio chunk to server
    // NEW EVENT - safe to add
    socket.on('meeting:transcript:audio-chunk', async (data) => {
        try {
            const { participantId, audioBuffer } = data;
            const contextId = socket.data.transcriptContextId;
            if (!contextId || !participantId) {
                return; // Silently ignore if transcript not started
            }
            // Audio data should be a Buffer/Uint8Array
            const buffer = Buffer.isBuffer(audioBuffer)
                ? audioBuffer
                : Buffer.from(audioBuffer);
            // Send to Deepgram using the context ID as stream ID
            await deepgramRealtime_service_1.deepgramRealtimeService.handleAudioChunk(contextId, buffer);
        }
        catch (err) {
            logger_1.logger.error('Error processing audio chunk:', err);
        }
    });
    // Event: Client stops audio streaming
    // NEW EVENT - safe to add
    socket.on('meeting:transcript:stop', async () => {
        try {
            const contextId = socket.data.transcriptContextId;
            if (contextId) {
                await meetingTranscript_handler_1.meetingTranscriptHandler.stopParticipantTranscript(contextId);
                delete socket.data.transcriptContextId;
                logger_1.logger.info(`Participant stopped transcript: ${contextId}`);
            }
        }
        catch (err) {
            logger_1.logger.error('Error stopping meeting transcript:', err);
        }
    });
    // Automatic cleanup on disconnect
    socket.on('disconnect', async () => {
        try {
            const contextId = socket.data.transcriptContextId;
            if (contextId) {
                await meetingTranscript_handler_1.meetingTranscriptHandler.stopParticipantTranscript(contextId);
                logger_1.logger.info(`Cleaned up transcript on disconnect: ${contextId}`);
            }
        }
        catch (err) {
            logger_1.logger.error('Error cleaning up transcript on disconnect:', err);
        }
    });
}
/**
 * Integration function to retrieve transcript stats for a meeting
 * Useful for admin panels and meeting dashboards
 */
async function getMeetingTranscriptStats(meetingId) {
    try {
        const handlerStatus = meetingTranscript_handler_1.meetingTranscriptHandler.getStatus();
        // Get total transcripts for this meeting
        const transcripts = await (0, db_1.db)('meeting_transcripts')
            .where({ meeting_id: meetingId })
            .select(db_1.db.raw('DISTINCT language as language'), db_1.db.raw('COUNT(*) as count'))
            .groupBy('language');
        const languages = transcripts.map((t) => ({
            language: t.language || 'unknown',
            count: parseInt(t.count, 10),
        }));
        return {
            activeStreams: meetingTranscript_handler_1.meetingTranscriptHandler.getActiveMeetingTranscriptCount(meetingId),
            totalTranscripts: transcripts.reduce((sum, t) => sum + t.count, 0),
            languages,
            status: handlerStatus.isHealthy ? 'healthy' : 'degraded',
        };
    }
    catch (err) {
        logger_1.logger.error(`Failed to get transcript stats for meeting: ${meetingId}`, err);
        return {
            activeStreams: 0,
            totalTranscripts: 0,
            languages: [],
            status: 'offline',
        };
    }
}
/**
 * Generate meeting minutes from accumulated transcripts
 * Call this after meeting ends or on demand
 * Integrates with existing AIService
 */
async function generateMeetingMinutesFromTranscripts(meetingId) {
    try {
        // Get all transcripts for this meeting
        const transcripts = await (0, db_1.db)('meeting_transcripts')
            .where({ meeting_id: meetingId })
            .orderBy('created_at', 'asc')
            .select('*');
        if (transcripts.length === 0) {
            logger_1.logger.warn(`No transcripts found for meeting: ${meetingId}`);
            return false;
        }
        // Build full meeting transcript
        const fullTranscript = transcripts
            .map((t) => `${new Date(t.created_at).toLocaleTimeString()}\n[${t.speaker_name}]: ${t.original_text}`)
            .join('\n\n');
        // Import AIService here to avoid circular dependencies
        const { AIService } = require('./ai.service');
        // Generate minutes using existing AIService
        const minutes = await AIService.generateMeetingMinutes(meetingId, fullTranscript);
        // Store minutes in database (using existing table structure)
        await (0, db_1.db)('meeting_minutes').insert({
            meeting_id: meetingId,
            summary: minutes.summary,
            action_items: JSON.stringify(minutes.actionItems),
            key_decisions: JSON.stringify(minutes.keyDecisions),
            participants: JSON.stringify(Array.from(new Set(transcripts.map((t) => t.speaker_name)))),
            generated_at: new Date(),
        });
        logger_1.logger.info(`Generated minutes for meeting: ${meetingId}`, {
            transcriptCount: transcripts.length,
        });
        return true;
    }
    catch (err) {
        logger_1.logger.error(`Failed to generate minutes for meeting: ${meetingId}`, err);
        return false;
    }
}
//# sourceMappingURL=multilingualMeeting.socket.js.map