// ============================================================
// OrgsLedger API — Socket.IO Multilingual Meeting Integration
// Integrates Deepgram STT, translation, and transcript storage
// Maintains full backward compatibility with existing events
// ============================================================

import { Socket, Server } from 'socket.io';
import { db } from '../db';
import { logger } from '../logger';
import { meetingTranscriptHandler, MeetingTranscriptContext } from './meetingTranscript.handler';

/**
 * Register multilingual meeting transcript handlers
 * Call this function in socket.ts after Socket.IO setup
 *
 * @param io Socket.IO server instance
 * @param socket Individual socket connection
 */
export function registerMultilingualMeetingHandlers(io: Server, socket: Socket): void {
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
      const isMember = await db('meeting_participants')
        .where({ meeting_id: meetingId, user_id: participantId })
        .first();

      if (!isMember) {
        socket.emit('error', { message: 'Not a member of this meeting' });
        return;
      }

      // Get user's language preference
      const userLangPref = await db('user_language_preferences')
        .where({ user_id: participantId })
        .first();
      const userLanguage = userLangPref?.language || 'en';

      // Initialize transcript handler
      const contextId = await meetingTranscriptHandler.initializeParticipantTranscript({
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

        logger.info(`Participant started transcript: ${participantId}`, { meetingId });
      } else {
        socket.emit('error', { message: 'Failed to start transcript' });
      }
    } catch (err) {
      logger.error('Error starting meeting transcript:', err);
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

      // Send to Deepgram
      await meetingTranscriptHandler.sendAudioChunk(participantId, buffer);
    } catch (err) {
      logger.error('Error processing audio chunk:', err);
    }
  });

  // Event: Client stops audio streaming
  // NEW EVENT - safe to add
  socket.on('meeting:transcript:stop', async () => {
    try {
      const contextId = socket.data.transcriptContextId;
      if (contextId) {
        await meetingTranscriptHandler.stopParticipantTranscript(contextId);
        delete socket.data.transcriptContextId;

        logger.info(`Participant stopped transcript: ${contextId}`);
      }
    } catch (err) {
      logger.error('Error stopping meeting transcript:', err);
    }
  });

  // Automatic cleanup on disconnect
  socket.on('disconnect', async () => {
    try {
      const contextId = socket.data.transcriptContextId;
      if (contextId) {
        await meetingTranscriptHandler.stopParticipantTranscript(contextId);
        logger.info(`Cleaned up transcript on disconnect: ${contextId}`);
      }
    } catch (err) {
      logger.error('Error cleaning up transcript on disconnect:', err);
    }
  });
}

/**
 * Integration function to retrieve transcript stats for a meeting
 * Useful for admin panels and meeting dashboards
 */
export async function getMeetingTranscriptStats(meetingId: string): Promise<{
  activeStreams: number;
  totalTranscripts: number;
  languages: Array<{ language: string; count: number }>;
  status: 'healthy' | 'degraded' | 'offline';
}> {
  try {
    const handlerStatus = meetingTranscriptHandler.getStatus();

    // Get total transcripts for this meeting
    const transcripts = await db('meeting_transcripts')
      .where({ meeting_id: meetingId })
      .select(db.raw('DISTINCT language as language'), db.raw('COUNT(*) as count'))
      .groupBy('language');

    const languages = transcripts.map((t: any) => ({
      language: t.language || 'unknown',
      count: parseInt(t.count, 10),
    }));

    return {
      activeStreams: meetingTranscriptHandler.getActiveMeetingTranscriptCount(meetingId),
      totalTranscripts: transcripts.reduce((sum: number, t: any) => sum + t.count, 0),
      languages,
      status: handlerStatus.isHealthy ? 'healthy' : 'degraded',
    };
  } catch (err) {
    logger.error(`Failed to get transcript stats for meeting: ${meetingId}`, err);
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
export async function generateMeetingMinutesFromTranscripts(meetingId: string): Promise<boolean> {
  try {
    // Get all transcripts for this meeting
    const transcripts = await db('meeting_transcripts')
      .where({ meeting_id: meetingId })
      .orderBy('created_at', 'asc')
      .select('*');

    if (transcripts.length === 0) {
      logger.warn(`No transcripts found for meeting: ${meetingId}`);
      return false;
    }

    // Build full meeting transcript
    const fullTranscript = transcripts
      .map(
        (t: any) =>
          `${new Date(t.created_at).toLocaleTimeString()}\n[${t.speaker_name}]: ${t.original_text}`
      )
      .join('\n\n');

    // Import AIService here to avoid circular dependencies
    const { AIService } = require('./ai.service');

    // Generate minutes using existing AIService
    const minutes = await AIService.generateMeetingMinutes(meetingId, fullTranscript);

    // Store minutes in database (using existing table structure)
    await db('meeting_minutes').insert({
      meeting_id: meetingId,
      summary: minutes.summary,
      action_items: JSON.stringify(minutes.actionItems),
      key_decisions: JSON.stringify(minutes.keyDecisions),
      participants: JSON.stringify(
        Array.from(new Set(transcripts.map((t: any) => t.speaker_name)))
      ),
      generated_at: new Date(),
    });

    logger.info(`Generated minutes for meeting: ${meetingId}`, {
      transcriptCount: transcripts.length,
    });

    return true;
  } catch (err) {
    logger.error(`Failed to generate minutes for meeting: ${meetingId}`, err);
    return false;
  }
}

/**
 * Export useful utility types and helpers
 */
export type { MeetingTranscriptContext } from './meetingTranscript.handler';
