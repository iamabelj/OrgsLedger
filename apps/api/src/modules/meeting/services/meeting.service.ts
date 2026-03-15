// ============================================================
// OrgsLedger API — Meeting Service
// Core business logic for meeting operations
// Event-driven architecture with Redis state management
// Supports role-segmented meetings with visibility types
// ============================================================

import db from '../../../db';
import { logger } from '../../../logger';
import {
  Meeting,
  MeetingRow,
  MeetingParticipant,
  MeetingStatus,
  MeetingSettings,
  ActiveMeetingState,
  CreateMeetingRequest,
  UpdateMeetingRequest,
  meetingFromRow,
  MeetingVisibilityType,
  CreateMeetingWithVisibilityRequest,
  MeetingWithVisibility,
} from '../models';
import {
  setActiveMeetingState,
  getActiveMeetingState,
  removeActiveMeetingState,
  updateMeetingParticipants,
  isMeetingActive,
} from './meeting-cache.service';
import { publishEvent, EVENT_CHANNELS } from './event-bus.service';
import { startAudioBot, stopAudioBot } from './livekit-audio-bot.service';
import { createRoomIfNotExists, deleteRoom } from './livekit-token.service';
import { meetingInviteService } from './meeting-invite.service';
import { transcriptPersistenceService } from './transcript-persistence.service';
import { submitMinutesJob } from '../../../queues/transcript.queue';
import { 
  checkMinutesBackpressure, 
  isBackpressureError,
} from '../../../scaling/backpressure';
import { cleanupMeeting } from '../../../services/meeting-cleanup.service';
import { AppError } from '../../../middleware/error-handler';
import {
  generateMeetingMinutes,
  TranscriptEntry as AITranscriptEntry,
} from '../../../services/minutes-ai.service';

// ── Constants ───────────────────────────────────────────────
const MAX_PARTICIPANTS_DEFAULT = 100;

// ── Event Types ─────────────────────────────────────────────
export type MeetingEventType =
  | 'meeting:created'
  | 'meeting:started'
  | 'meeting:ended'
  | 'meeting:cancelled'
  | 'meeting:participant:joined'
  | 'meeting:participant:left';

export interface MeetingEvent {
  type: MeetingEventType;
  meetingId: string;
  organizationId: string;
  timestamp: string;
  data: Record<string, any>;
}

/**
 * Emit a meeting event via Redis PubSub event bus
 * WebSocket gateway subscribes and broadcasts to Socket.IO
 */
async function emitMeetingEvent(event: MeetingEvent): Promise<void> {
  try {
    await publishEvent(EVENT_CHANNELS.MEETING_EVENTS, {
      type: event.type,
      timestamp: event.timestamp,
      data: {
        meetingId: event.meetingId,
        organizationId: event.organizationId,
        ...event.data,
      },
    });
  } catch (err: any) {
    logger.warn('[MEETING] Failed to publish event', { 
      type: event.type, 
      error: err.message 
    });
  }
}

// ── Service Class ───────────────────────────────────────────

export class MeetingService {
  /**
   * Create a new meeting
   */
  async create(
    hostId: string,
    request: CreateMeetingRequest
  ): Promise<Meeting> {
    const settings: MeetingSettings = {
      maxParticipants: MAX_PARTICIPANTS_DEFAULT,
      allowRecording: false,
      waitingRoom: false,
      muteOnEntry: true,
      allowScreenShare: true,
      ...request.settings,
      ...(request.agenda && request.agenda.length > 0 ? { agenda: request.agenda } : {}),
    };

    const hostParticipant: MeetingParticipant = {
      userId: hostId,
      role: 'host',
      joinedAt: new Date().toISOString(),
    };

    let row: any;
    try {
      // scheduled_start and created_by are legacy NOT NULL columns from original schema
      // We populate both legacy and new columns for compatibility
      const scheduledTime = request.scheduledAt ? new Date(request.scheduledAt) : new Date();
      const [result] = await db('meetings')
        .insert({
          organization_id: request.organizationId,
          host_id: hostId,
          created_by: hostId, // legacy required column
          title: request.title || 'Untitled Meeting',
          description: request.description || null,
          status: 'scheduled' as MeetingStatus,
          participants: JSON.stringify([hostParticipant]),
          settings: JSON.stringify(settings),
          scheduled_at: scheduledTime,
          scheduled_start: scheduledTime, // legacy required column
        })
        .returning('*');
      row = result;
    } catch (err: any) {
      logger.error('[MEETING] DB insert failed', {
        error: err.message,
        code: err.code,
        orgId: request.organizationId,
        hostId,
      });
      // 23503 = foreign_key_violation, 42P01 = undefined_table
      if (err.code === '42P01') {
        throw new AppError('Meeting system is initializing. Please try again in a moment.', 503);
      }
      if (err.code === '23503') {
        throw new AppError('Invalid organization or user reference.', 400);
      }
      throw new AppError('Failed to create meeting. Please try again.', 500);
    }

    const meeting = meetingFromRow(row as MeetingRow);

    logger.info('[MEETING] Created', {
      meetingId: meeting.id,
      orgId: meeting.organizationId,
      hostId: meeting.hostId,
    });

    // Emit event
    await emitMeetingEvent({
      type: 'meeting:created',
      meetingId: meeting.id,
      organizationId: meeting.organizationId,
      timestamp: meeting.createdAt,
      data: { hostId, title: meeting.title },
    });

    return meeting;
  }

  /**
   * Create a new meeting with role-segmented visibility.
   * Auto-populates meeting_invites based on visibility type.
   */
  async createWithVisibility(
    hostId: string,
    request: CreateMeetingWithVisibilityRequest
  ): Promise<MeetingWithVisibility> {
    const settings: MeetingSettings = {
      maxParticipants: MAX_PARTICIPANTS_DEFAULT,
      allowRecording: false,
      waitingRoom: false,
      muteOnEntry: true,
      allowScreenShare: true,
      enableTranscription: true,
      ...request.settings,
      ...(request.agenda && request.agenda.length > 0 ? { agenda: request.agenda } : {}),
    };

    const hostParticipant: MeetingParticipant = {
      userId: hostId,
      role: 'host',
      joinedAt: new Date().toISOString(),
    };

    const visibilityType = request.visibilityType || 'ALL_MEMBERS';

    let row: any;
    try {
      const scheduledTime = request.scheduledAt ? new Date(request.scheduledAt) : new Date();
      const [result] = await db('meetings')
        .insert({
          organization_id: request.organizationId,
          host_id: hostId,
          created_by: hostId,
          title: request.title || 'Untitled Meeting',
          description: request.description || null,
          status: 'scheduled' as MeetingStatus,
          participants: JSON.stringify([hostParticipant]),
          settings: JSON.stringify(settings),
          scheduled_at: scheduledTime,
          scheduled_start: scheduledTime,
          visibility_type: visibilityType,
          target_role_id: request.committeeId || null,
        })
        .returning('*');
      row = result;
    } catch (err: any) {
      logger.error('[MEETING] DB insert failed', {
        error: err.message,
        code: err.code,
        orgId: request.organizationId,
        hostId,
      });
      if (err.code === '42P01') {
        throw new AppError('Meeting system is initializing. Please try again in a moment.', 503);
      }
      if (err.code === '23503') {
        throw new AppError('Invalid organization or user reference.', 400);
      }
      throw new AppError('Failed to create meeting. Please try again.', 500);
    }

    const meeting = meetingFromRow(row as MeetingRow);

    // Auto-populate invites based on visibility type
    let inviteCount = 0;
    try {
      inviteCount = await meetingInviteService.populateInvitesForVisibility(
        meeting.id,
        meeting.organizationId,
        hostId,
        visibilityType,
        {
          committeeId: request.committeeId,
          customParticipants: request.participants,
        }
      );
    } catch (err: any) {
      logger.warn('[MEETING] Failed to populate invites', {
        meetingId: meeting.id,
        error: err.message,
      });
      // Don't fail meeting creation - invites can be added later
    }

    logger.info('[MEETING] Created with visibility', {
      meetingId: meeting.id,
      orgId: meeting.organizationId,
      hostId: meeting.hostId,
      visibilityType,
      inviteCount,
    });

    // Emit event
    await emitMeetingEvent({
      type: 'meeting:created',
      meetingId: meeting.id,
      organizationId: meeting.organizationId,
      timestamp: meeting.createdAt,
      data: {
        hostId,
        title: meeting.title,
        visibilityType,
        inviteCount,
      },
    });

    // Return extended meeting with visibility info
    return {
      ...meeting,
      visibilityType,
      targetRoleId: request.committeeId,
      inviteCount,
    } as MeetingWithVisibility;
  }

  /**
   * Update a scheduled meeting (host only)
   */
  async update(
    meetingId: string,
    userId: string,
    request: UpdateMeetingRequest
  ): Promise<Meeting> {
    const meeting = await this.getById(meetingId);

    if (!meeting) {
      throw AppError.notFound('Meeting not found');
    }

    if (meeting.hostId !== userId) {
      throw AppError.forbidden('Only the host can update the meeting');
    }

    if (meeting.status !== 'scheduled') {
      throw AppError.badRequest('Can only update scheduled meetings');
    }

    const updates: Record<string, any> = {};

    if (request.title !== undefined) {
      updates.title = request.title || null;
    }
    if (request.description !== undefined) {
      updates.description = request.description || null;
    }
    if (request.scheduledAt !== undefined) {
      updates.scheduled_at = request.scheduledAt || null;
    }
    if (request.settings || request.agenda !== undefined) {
      const mergedSettings = { ...meeting.settings };
      if (request.settings) {
        Object.assign(mergedSettings, request.settings);
      }
      if (request.agenda !== undefined) {
        mergedSettings.agenda = request.agenda;
      }
      updates.settings = JSON.stringify(mergedSettings);
    }

    if (Object.keys(updates).length === 0) {
      return meeting;
    }

    const [row] = await db('meetings')
      .where({ id: meetingId })
      .update(updates)
      .returning('*');

    const updatedMeeting = meetingFromRow(row as MeetingRow);

    logger.info('[MEETING] Updated', {
      meetingId,
      fields: Object.keys(updates),
    });

    return updatedMeeting;
  }

  /**
   * Get meeting by ID
   */
  async getById(meetingId: string): Promise<Meeting | null> {
    const row = await db('meetings')
      .where({ id: meetingId })
      .first() as MeetingRow | undefined;

    if (!row) return null;
    return meetingFromRow(row);
  }

  /**
   * Get meeting by ID with active state from Redis
   * Returns fresh participant list from cache if meeting is active
   */
  async getByIdWithState(meetingId: string): Promise<Meeting | null> {
    const meeting = await this.getById(meetingId);
    if (!meeting) return null;

    // If meeting is active, overlay real-time state from Redis
    if (meeting.status === 'active') {
      const activeState = await getActiveMeetingState(meetingId);
      if (activeState) {
        meeting.participants = activeState.participants;
      }
    }

    return meeting;
  }

  /**
   * List meetings for an organization
   */
  async listByOrganization(
    organizationId: string,
    options: {
      status?: MeetingStatus;
      page?: number;
      limit?: number;
    } = {}
  ): Promise<{ meetings: Meeting[]; total: number }> {
    const { status, page = 1, limit = 20 } = options;
    const offset = (page - 1) * limit;

    let query = db('meetings').where({ organization_id: organizationId });
    
    if (status) {
      query = query.where({ status });
    }

    // Safe count query pattern
    const countResult = await query.clone().count({ count: '*' }).first();
    const total = parseInt(String(countResult?.count ?? '0'), 10);
    
    const rows = await query
      .orderBy('created_at', 'desc')
      .offset(offset)
      .limit(limit) as MeetingRow[];

    return {
      meetings: rows.map(meetingFromRow),
      total,
    };
  }

  /**
   * Start a meeting (transition from scheduled to active)
   */
  async start(meetingId: string, userId: string): Promise<Meeting> {
    const meeting = await this.getById(meetingId);
    
    if (!meeting) {
      throw AppError.notFound('Meeting not found');
    }

    if (meeting.hostId !== userId) {
      throw AppError.forbidden('Only the host can start the meeting');
    }

    if (meeting.status !== 'scheduled') {
      throw AppError.badRequest(`Cannot start meeting with status: ${meeting.status}`);
    }

    const now = new Date().toISOString();

    // Update in database
    const [row] = await db('meetings')
      .where({ id: meetingId })
      .update({
        status: 'active',
        started_at: now,
      })
      .returning('*');

    const updatedMeeting = meetingFromRow(row as MeetingRow);

    // Store active state in Redis for real-time access
    const activeState: ActiveMeetingState = {
      meetingId: updatedMeeting.id,
      organizationId: updatedMeeting.organizationId,
      hostId: updatedMeeting.hostId,
      status: 'active',
      participants: updatedMeeting.participants,
      startedAt: now,
      lastActivityAt: now,
    };
    await setActiveMeetingState(activeState);

    logger.info('[MEETING] Started', {
      meetingId,
      orgId: updatedMeeting.organizationId,
    });

    // Emit event
    await emitMeetingEvent({
      type: 'meeting:started',
      meetingId,
      organizationId: updatedMeeting.organizationId,
      timestamp: now,
      data: { startedBy: userId },
    });

    // Start LiveKit room and audio bot (async, don't block)
    this.initializeLiveMedia(meetingId, updatedMeeting.organizationId).catch(
      (err) => {
        logger.warn('[MEETING] Failed to initialize live media', {
          meetingId,
          error: err.message,
        });
      }
    );

    return updatedMeeting;
  }

  /**
   * Initialize LiveKit room and audio bot for transcription
   */
  private async initializeLiveMedia(
    meetingId: string,
    organizationId: string
  ): Promise<void> {
    try {
      // Create LiveKit room if credentials are configured
      await createRoomIfNotExists(meetingId);

      // Start audio bot for transcription
      await startAudioBot({
        meetingId,
        organizationId,
      });

      logger.info('[MEETING] Live media initialized', { meetingId });
    } catch (err: any) {
      logger.warn('[MEETING] Live media init failed (optional)', {
        meetingId,
        error: err.message,
      });
      // Don't throw - live media is optional
    }
  }

  /**
   * Join an active meeting
   */
  async join(
    meetingId: string,
    userId: string,
    displayName?: string
  ): Promise<Meeting> {
    const meeting = await this.getByIdWithState(meetingId);
    
    if (!meeting) {
      throw AppError.notFound('Meeting not found');
    }

    // If meeting is scheduled and user is host, auto-start it
    if (meeting.status === 'scheduled' && meeting.hostId === userId) {
      const startedMeeting = await this.start(meetingId, userId);
      return startedMeeting;
    }

    if (meeting.status !== 'active') {
      throw AppError.badRequest(`Cannot join meeting with status: ${meeting.status}`);
    }

    // Check if user is already in meeting
    const existingParticipant = meeting.participants.find(p => p.userId === userId);
    if (existingParticipant && !existingParticipant.leftAt) {
      // Already in meeting, just return current state
      return meeting;
    }

    // Check max participants
    const activeParticipants = meeting.participants.filter(p => !p.leftAt);
    const maxParticipants = meeting.settings.maxParticipants || MAX_PARTICIPANTS_DEFAULT;
    if (activeParticipants.length >= maxParticipants) {
      throw AppError.badRequest('Meeting is at capacity');
    }

    const now = new Date().toISOString();

    // Add or update participant
    let participants: MeetingParticipant[];
    if (existingParticipant) {
      // User rejoining - update their record
      participants = meeting.participants.map(p =>
        p.userId === userId
          ? { ...p, joinedAt: now, leftAt: undefined, displayName }
          : p
      );
    } else {
      // New participant
      const newParticipant: MeetingParticipant = {
        userId,
        role: 'participant',
        joinedAt: now,
        displayName,
      };
      participants = [...meeting.participants, newParticipant];
    }

    // Update Redis state only (no database write during active meeting)
    await updateMeetingParticipants(meetingId, participants);

    // Update meeting object with new participants for response
    const updatedMeeting: Meeting = {
      ...meeting,
      participants,
    };

    logger.info('[MEETING] Participant joined', {
      meetingId,
      userId,
      participantCount: participants.filter(p => !p.leftAt).length,
    });

    // Emit event via Redis PubSub
    await emitMeetingEvent({
      type: 'meeting:participant:joined',
      meetingId,
      organizationId: updatedMeeting.organizationId,
      timestamp: now,
      data: { userId, displayName },
    });

    return updatedMeeting;
  }

  /**
   * Leave a meeting
   */
  async leave(meetingId: string, userId: string): Promise<Meeting> {
    const meeting = await this.getByIdWithState(meetingId);
    
    if (!meeting) {
      throw AppError.notFound('Meeting not found');
    }

    if (meeting.status !== 'active') {
      throw AppError.badRequest(`Cannot leave meeting with status: ${meeting.status}`);
    }

    const now = new Date().toISOString();

    // Mark participant as left
    const participants = meeting.participants.map(p =>
      p.userId === userId ? { ...p, leftAt: now } : p
    );

    // Update Redis state only (no database write during active meeting)
    await updateMeetingParticipants(meetingId, participants);

    // Check if all participants have left (auto-end meeting)
    const activeParticipants = participants.filter(p => !p.leftAt);
    
    if (activeParticipants.length === 0) {
      // End meeting if everyone left
      return this.end(meetingId, userId);
    }

    // If host left, the meeting continues but could transfer host
    // For now, meeting continues until ended explicitly

    // Update meeting object with new participants for response
    const updatedMeeting: Meeting = {
      ...meeting,
      participants,
    };

    logger.info('[MEETING] Participant left', {
      meetingId,
      userId,
      remainingParticipants: activeParticipants.length,
    });

    // Emit event via Redis PubSub
    await emitMeetingEvent({
      type: 'meeting:participant:left',
      meetingId,
      organizationId: updatedMeeting.organizationId,
      timestamp: now,
      data: { userId, remainingCount: activeParticipants.length },
    });

    return updatedMeeting;
  }

  /**
   * End a meeting
   * Persists participants from Redis to meeting_participants table
   */
  async end(meetingId: string, userId: string): Promise<Meeting> {
    const meeting = await this.getById(meetingId);
    
    if (!meeting) {
      throw AppError.notFound('Meeting not found');
    }

    if (meeting.status === 'ended' || meeting.status === 'cancelled') {
      throw AppError.badRequest(`Meeting already ${meeting.status}`);
    }

    // Only host can end a meeting
    if (meeting.hostId !== userId) {
      throw AppError.forbidden('Only the host can end the meeting');
    }

    const now = new Date().toISOString();

    // Get final participant state from Redis (source of truth during active meeting)
    const activeState = await getActiveMeetingState(meetingId);
    const participants = activeState?.participants || meeting.participants;

    // Mark all participants as left
    const finalParticipants = participants.map(p =>
      p.leftAt ? p : { ...p, leftAt: now }
    );

    // Bulk insert participants to relational table
    await this.persistParticipants(meetingId, finalParticipants);

    // Update meeting status in database (no longer storing participants JSON)
    const [row] = await db('meetings')
      .where({ id: meetingId })
      .update({
        status: 'ended',
        ended_at: now,
        // Keep JSON for backward compatibility but mark as archived
        participants: JSON.stringify(finalParticipants),
      })
      .returning('*');

    // Remove from Redis active state
    await removeActiveMeetingState(meetingId, meeting.organizationId);

    const updatedMeeting = meetingFromRow(row as MeetingRow);

    logger.info('[MEETING] Ended', {
      meetingId,
      orgId: meeting.organizationId,
      participantCount: finalParticipants.length,
      duration: meeting.startedAt 
        ? (new Date(now).getTime() - new Date(meeting.startedAt).getTime()) / 1000
        : 0,
    });

    // Emit event via Redis PubSub
    await emitMeetingEvent({
      type: 'meeting:ended',
      meetingId,
      organizationId: updatedMeeting.organizationId,
      timestamp: now,
      data: { endedBy: userId, participantCount: finalParticipants.length },
    });

    // Cleanup live media and trigger minutes generation (async, don't block)
    this.finalizeLiveMedia(meetingId, meeting.organizationId).catch((err) => {
      logger.warn('[MEETING] Failed to finalize live media', {
        meetingId,
        error: err.message,
      });
    });

    return updatedMeeting;
  }

  /**
   * Finalize live media: stop audio bot, delete room, generate minutes, cleanup
   */
  private async finalizeLiveMedia(
    meetingId: string,
    organizationId: string
  ): Promise<void> {
    try {
      // Stop audio bot
      await stopAudioBot(meetingId);

      // Delete LiveKit room
      await deleteRoom(meetingId);

      // Persist transcripts from Redis to PostgreSQL
      try {
        const transcriptResult = await transcriptPersistenceService.persistMeetingTranscript(
          meetingId,
          organizationId
        );
        logger.info('[MEETING] Transcripts persisted', {
          meetingId,
          wordCount: transcriptResult.wordCount,
          speakerCount: transcriptResult.speakerCount,
        });
      } catch (transcriptErr: any) {
        // Log warning but don't fail - minutes can still generate from Redis
        logger.warn('[MEETING] Failed to persist transcripts', {
          meetingId,
          error: transcriptErr.message,
        });
      }

      // Check backpressure before queueing minutes
      let minutesQueued = false;
      try {
        const backpressureStatus = await checkMinutesBackpressure();
        if (!backpressureStatus.allowed) {
          logger.warn('[MEETING] Backpressure triggered, delaying minutes generation', {
            meetingId,
            queueUtilization: backpressureStatus.utilizationPercent.toFixed(1) + '%',
            retryAfter: backpressureStatus.retryAfter,
          });
          // Still queue with a delay based on retry hint
          await submitMinutesJob({
            meetingId,
            organizationId,
          }, { delay: (backpressureStatus.retryAfter || 30) * 1000 });
          minutesQueued = true;
          
          // Perform cold meeting eviction (cleanup Redis, WebSocket rooms, queue jobs)
          await cleanupMeeting(meetingId, organizationId);
          return;
        }

        // Queue minutes generation
        await submitMinutesJob({
          meetingId,
          organizationId,
        });
        minutesQueued = true;
      } catch (queueErr: any) {
        logger.warn('[MEETING] Queue submission failed, will generate minutes directly', {
          meetingId,
          error: queueErr.message,
        });
      }

      // Fallback: generate minutes synchronously if queue submission failed
      if (!minutesQueued) {
        await this.generateMinutesDirect(meetingId, organizationId);
      }

      // Perform cold meeting eviction (cleanup Redis, WebSocket rooms, queue jobs)
      const cleanupResult = await cleanupMeeting(meetingId, organizationId);
      if (!cleanupResult.success) {
        logger.warn('[MEETING] Partial cleanup', {
          meetingId,
          errors: cleanupResult.errors,
          durationMs: cleanupResult.durationMs,
        });
      }

      logger.info('[MEETING] Live media finalized', { meetingId });
    } catch (err: any) {
      if (isBackpressureError(err)) {
        logger.warn('[MEETING] Backpressure error during finalization', {
          meetingId,
          retryAfter: err.retryAfter,
        });
        // Attempt delayed submission, fall back to direct generation
        try {
          await submitMinutesJob({
            meetingId,
            organizationId,
          }, { delay: err.retryAfter * 1000 });
        } catch {
          await this.generateMinutesDirect(meetingId, organizationId);
        }
        
        // Still perform cleanup even on backpressure
        await cleanupMeeting(meetingId, organizationId).catch(() => {});
        return;
      }
      logger.warn('[MEETING] Live media finalization failed', {
        meetingId,
        error: err.message,
      });
      
      // Attempt direct minutes generation even on general failure
      await this.generateMinutesDirect(meetingId, organizationId);

      // Still attempt cleanup even if finalization failed
      await cleanupMeeting(meetingId, organizationId).catch(() => {});
      // Don't throw - finalization errors shouldn't affect meeting end
    }
  }

  /**
   * Generate minutes directly (synchronous fallback when BullMQ/Redis is unavailable).
   * Reads persisted transcripts from PostgreSQL and calls AI service directly.
   */
  private async generateMinutesDirect(
    meetingId: string,
    organizationId: string
  ): Promise<void> {
    try {
      // Check if minutes already exist (idempotency)
      const existing = await db('meeting_minutes')
        .where('meeting_id', meetingId)
        .select('id')
        .first()
        .catch(() => null);

      if (existing) {
        logger.info('[MEETING] Minutes already exist, skipping direct generation', { meetingId });
        return;
      }

      // Get transcripts from PostgreSQL (persisted earlier in finalizeLiveMedia)
      const persisted = await transcriptPersistenceService.getPersistedTranscript(meetingId);
      const entries = persisted?.entries || [];

      if (entries.length === 0) {
        logger.warn('[MEETING] No persisted transcripts for direct minutes generation', { meetingId });
        // Store a basic placeholder so user knows minutes couldn't be generated
        await db('meeting_minutes')
          .insert({
            meeting_id: meetingId,
            organization_id: organizationId,
            summary: 'No transcript data was available to generate minutes for this meeting.',
            decisions: JSON.stringify([]),
            action_items: JSON.stringify([]),
            transcript: JSON.stringify([]),
            motions: JSON.stringify([]),
            contributions: JSON.stringify([]),
            ai_credits_used: 0,
            status: 'completed',
            generated_at: new Date().toISOString(),
          })
          .onConflict('meeting_id')
          .ignore();
        return;
      }

      // Convert persisted TranscriptEntry format to AI service format
      const aiTranscripts: AITranscriptEntry[] = entries.map(e => ({
        speaker: e.speakerName || 'Unknown',
        speakerId: e.speakerId,
        text: e.text,
        timestamp: e.timestamp,
        confidence: e.confidence,
        language: e.language,
      }));

      // Generate minutes using AI service
      const result = await generateMeetingMinutes({
        meetingId,
        transcripts: aiTranscripts,
      });

      // Store in database (same pattern as minutes.worker.ts)
      await db('meeting_minutes')
        .insert({
          meeting_id: meetingId,
          organization_id: organizationId,
          summary: result.minutes.summary,
          decisions: JSON.stringify(result.minutes.decisions),
          action_items: JSON.stringify(result.minutes.actionItems),
          transcript: JSON.stringify([]),
          motions: JSON.stringify([]),
          contributions: JSON.stringify(
            result.minutes.participants.map(p => ({ speaker: p }))
          ),
          ai_credits_used: 1,
          status: 'completed',
          generated_at: result.generatedAt,
        })
        .onConflict('meeting_id')
        .ignore();

      logger.info('[MEETING] Minutes generated directly (fallback)', {
        meetingId,
        wordCount: result.wordCount,
        chunksProcessed: result.chunksProcessed,
      });
    } catch (err: any) {
      logger.warn('[MEETING] Direct minutes generation failed', {
        meetingId,
        error: err.message,
      });
      // Non-fatal — don't throw
    }
  }

  /**
   * Persist participants to relational table (called when meeting ends)
   */
  private async persistParticipants(
    meetingId: string,
    participants: MeetingParticipant[]
  ): Promise<void> {
    if (participants.length === 0) return;

    const records = participants.map(p => ({
      meeting_id: meetingId,
      user_id: p.userId,
      role: p.role,
      display_name: p.displayName || null,
      joined_at: p.joinedAt,
      left_at: p.leftAt || null,
    }));

    try {
      // Bulk insert for efficiency
      await db('meeting_participants').insert(records);
      logger.info('[MEETING] Persisted participants', {
        meetingId,
        count: records.length,
      });
    } catch (err: any) {
      logger.error('[MEETING] Failed to persist participants', {
        meetingId,
        error: err.message,
      });
      // Don't throw - meeting should still end even if persistence fails
      // Participants are still in JSON column as backup
    }
  }

  /**
   * Cancel a scheduled meeting
   */
  async cancel(meetingId: string, userId: string): Promise<Meeting> {
    const meeting = await this.getById(meetingId);
    
    if (!meeting) {
      throw AppError.notFound('Meeting not found');
    }

    if (meeting.status !== 'scheduled') {
      throw AppError.badRequest('Can only cancel scheduled meetings');
    }

    if (meeting.hostId !== userId) {
      throw AppError.forbidden('Only the host can cancel the meeting');
    }

    const now = new Date().toISOString();

    const [row] = await db('meetings')
      .where({ id: meetingId })
      .update({
        status: 'cancelled',
        ended_at: now,
      })
      .returning('*');

    const updatedMeeting = meetingFromRow(row as MeetingRow);

    logger.info('[MEETING] Cancelled', { meetingId });

    // Emit event
    await emitMeetingEvent({
      type: 'meeting:cancelled',
      meetingId,
      organizationId: updatedMeeting.organizationId,
      timestamp: now,
      data: { cancelledBy: userId },
    });

    return updatedMeeting;
  }

  /**
   * Get active participant count for a meeting
   */
  async getParticipantCount(meetingId: string): Promise<number> {
    const meeting = await this.getByIdWithState(meetingId);
    if (!meeting) return 0;
    return meeting.participants.filter(p => !p.leftAt).length;
  }

  /**
   * Check if user is participant in meeting
   */
  async isParticipant(meetingId: string, userId: string): Promise<boolean> {
    const meeting = await this.getByIdWithState(meetingId);
    if (!meeting) return false;
    const participant = meeting.participants.find(p => p.userId === userId);
    return !!participant && !participant.leftAt;
  }

  /**
   * Get meeting minutes
   * Returns null if minutes haven't been generated yet
   */
  async getMinutes(meetingId: string): Promise<{
    summary: string;
    keyTopics: string[];
    decisions: string[];
    actionItems: Array<{ task: string; owner?: string; deadline?: string }>;
    participants: string[];
    wordCount: number;
    generatedAt: string;
  } | null> {
    try {
      // Use actual DB schema columns:
      // summary, decisions, action_items, contributions, generated_at
      const row = await db('meeting_minutes')
        .where('meeting_id', meetingId)
        .select(
          'summary',
          'decisions',
          'action_items',
          'contributions',
          'generated_at'
        )
        .first();

      if (!row) {
        return null;
      }

      // Parse contributions to extract participant names
      const contributions = typeof row.contributions === 'string'
        ? JSON.parse(row.contributions)
        : (row.contributions || []);
      
      const participants = contributions.map((c: any) => c.speaker || c.name).filter(Boolean);

      return {
        summary: row.summary,
        keyTopics: [], // Not stored in current schema
        decisions: typeof row.decisions === 'string'
          ? JSON.parse(row.decisions)
          : (row.decisions || []),
        actionItems: typeof row.action_items === 'string'
          ? JSON.parse(row.action_items)
          : (row.action_items || []),
        participants,
        wordCount: 0, // Not stored in current schema
        generatedAt: row.generated_at,
      };
    } catch (err: any) {
      // Table might not exist yet
      if (err.message?.includes('does not exist') || err.message?.includes('no such table')) {
        logger.warn('[MEETING] meeting_minutes table not found');
        return null;
      }
      throw err;
    }
  }

  /**
   * Resubmit a minutes generation job
   * Deletes existing minutes first for regeneration
   */
  async resubmitMinutesJob(meetingId: string, organizationId: string): Promise<void> {
    // Check backpressure first - for manual resubmission, we want to fail early
    const backpressureStatus = await checkMinutesBackpressure();
    if (!backpressureStatus.allowed) {
      const error = new Error(
        `System overloaded. Please retry after ${backpressureStatus.retryAfter} seconds.`
      );
      (error as any).code = 'SYSTEM_OVERLOADED';
      (error as any).retryAfter = backpressureStatus.retryAfter;
      throw error;
    }

    try {
      // Delete existing minutes
      await db('meeting_minutes')
        .where('meeting_id', meetingId)
        .del();

      logger.info('[MEETING] Deleted existing minutes for regeneration', { meetingId });
    } catch (err: any) {
      // Table might not exist - that's fine
      if (!err.message?.includes('does not exist') && !err.message?.includes('no such table')) {
        throw err;
      }
    }

    // Submit new job
    await submitMinutesJob({
      meetingId,
      organizationId,
    });

    logger.info('[MEETING] Resubmitted minutes generation job', { meetingId });
  }
}

// Export singleton instance
export const meetingService = new MeetingService();
