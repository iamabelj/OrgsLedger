// ============================================================
// OrgsLedger API — Meeting Queue Integration Service
// Centralized job submission for meeting lifecycle events
// ============================================================

import { logger } from '../logger';
import { submitMinutesJob } from '../queues/minutes.queue';
import db from '../db';
import { services } from './registry';

/**
 * When a meeting is created, trigger initial setup
 */
export async function onMeetingCreated(meetingId: string, orgId: string, meetingData: any) {
  try {
    logger.info('[MEETING_QUEUE] Meeting created — scheduling initialization', {
      meetingId,
      orgId,
      title: meetingData.title,
    });

    // Emit socket.io event so all connected clients get instant update
    const io = services.get('io');
    if (io) {
      io.to(`org:${orgId}`).emit('meeting:created', {
        meetingId,
        title: meetingData.title,
        status: 'scheduled',
      });
    }

    // Additional setup can be added here as needed
    // (e.g., thumbnail generation, document processing, etc.)
  } catch (err: any) {
    logger.error('[MEETING_QUEUE] Error in onMeetingCreated', {
      meetingId,
      error: err.message,
    });
    // Don't throw — this is best-effort async work
  }
}

/**
 * When a meeting is updated, determine what jobs to trigger
 */
export async function onMeetingUpdated(
  meetingId: string,
  orgId: string,
  oldData: any,
  newData: any
) {
  try {
    logger.info('[MEETING_QUEUE] Meeting updated — analyzing changes', { meetingId, orgId });

    const io = services.get('io');

    // If title or description changed, notify members
    if (oldData.title !== newData.title || oldData.description !== newData.description) {
      if (io) {
        io.to(`org:${orgId}`).emit('meeting:updated', {
          meetingId,
          title: newData.title,
          description: newData.description,
        });
      }
    }

    // If schedule changed, notify members of time conflicts
    if (oldData.scheduled_start !== newData.scheduled_start) {
      if (io) {
        io.to(`org:${orgId}`).emit('meeting:rescheduled', {
          meetingId,
          newStart: newData.scheduled_start,
          oldStart: oldData.scheduled_start,
        });
      }
    }
  } catch (err: any) {
    logger.error('[MEETING_QUEUE] Error in onMeetingUpdated', {
      meetingId,
      error: err.message,
    });
  }
}

/**
 * When a meeting starts, trigger initialization
 */
export async function onMeetingStarted(meetingId: string, orgId: string, meeting: any) {
  try {
    logger.info('[MEETING_QUEUE] Meeting started — initializing live session', {
      meetingId,
      orgId,
    });

    const io = services.get('io');
    if (io) {
      io.to(`org:${orgId}`).emit('meeting:started', {
        meetingId,
        title: meeting.title,
        status: 'live',
      });
    }

    // Additional start-time initialization can be added here
  } catch (err: any) {
    logger.error('[MEETING_QUEUE] Error in onMeetingStarted', {
      meetingId,
      error: err.message,
    });
  }
}

/**
 * When a meeting ends, trigger:
 * - Broadcast notification
 * - AI minute generation
 * - Transcript finalization
 */
export async function onMeetingEnded(meetingId: string, orgId: string, meeting: any) {
  try {
    logger.info('[MEETING_QUEUE] Meeting ended — triggering completion pipeline', {
      meetingId,
      orgId,
      title: meeting.title,
    });

    const io = services.get('io');

    // Broadcast meeting:ended to org
    if (io) {
      io.to(`org:${orgId}`).emit('meeting:ended', {
        meetingId,
        title: meeting.title,
        status: 'ended',
      });
    }

    // Check if we should generate minutes
    const hasAudio = !!meeting.audio_storage_url;
    let hasLiveTranscripts = false;

    try {
      const transcriptCount = await db('meeting_transcripts')
        .where({ meeting_id: meetingId })
        .count('id as count')
        .first();
      hasLiveTranscripts = parseInt(transcriptCount?.count as string) > 0;
    } catch {
      // Table may not exist yet — that's fine
      hasLiveTranscripts = false;
    }

    logger.info('[MEETING_QUEUE] Minutes eligibility check', {
      meetingId,
      hasAudio,
      hasLiveTranscripts,
    });

    if (hasAudio || hasLiveTranscripts) {
      // Create or update pending minutes record
      let skipProcessing = false;
      try {
        const existing = await db('meeting_minutes').where({ meeting_id: meetingId }).first();
        if (!existing) {
          await db('meeting_minutes').insert({
            meeting_id: meetingId,
            organization_id: orgId,
            status: 'processing',
          });
        } else if (existing.status !== 'completed') {
          await db('meeting_minutes')
            .where({ meeting_id: meetingId })
            .update({ status: 'processing', error_message: null });
        } else {
          logger.info('[MEETING_QUEUE] Minutes already completed — skipping regeneration', {
            meetingId,
          });
          skipProcessing = true;
        }
      } catch (dbErr) {
        logger.warn('[MEETING_QUEUE] Failed to update minutes record', {
          meetingId,
          error: dbErr,
        });
      }

      // Notify clients that processing is starting
      if (io && !skipProcessing) {
        io.to(`org:${orgId}`).emit('meeting:minutes:processing', { meetingId });
        io.to(`meeting:${meetingId}`).emit('meeting:minutes:processing', { meetingId });
      }

      // Queue AI minutes job
      if (!skipProcessing) {
        try {
          logger.info('[MEETING_QUEUE] Submitting AI minutes job', { meetingId, orgId });
          await submitMinutesJob({
            meetingId,
            organizationId: orgId,
          });
        } catch (jobErr: any) {
          logger.error('[MEETING_QUEUE] Failed to submit minutes job', {
            meetingId,
            error: jobErr.message,
          });
          // Update minutes status to failed
          try {
            await db('meeting_minutes')
              .where({ meeting_id: meetingId })
              .update({
                status: 'failed',
                error_message: 'Failed to queue minutes processing: ' + jobErr.message,
              });
          } catch {}
        }
      }
    } else {
      logger.info('[MEETING_QUEUE] No audio or transcripts — skipping minutes generation', {
        meetingId,
      });
    }
  } catch (err: any) {
    logger.error('[MEETING_QUEUE] Error in onMeetingEnded', {
      meetingId,
      error: err.message,
    });
  }
}

/**
 * When attendees are added to a meeting, notify them
 */
export async function onAttendeesAdded(
  meetingId: string,
  orgId: string,
  attendeeUserIds: string[]
) {
  try {
    logger.info('[MEETING_QUEUE] Attendees added — triggering notifications', {
      meetingId,
      count: attendeeUserIds.length,
    });

    const io = services.get('io');
    if (io) {
      io.to(`meeting:${meetingId}`).emit('meeting:attendees:added', {
        attendeeUserIds,
      });
    }
  } catch (err: any) {
    logger.error('[MEETING_QUEUE] Error in onAttendeesAdded', {
      meetingId,
      error: err.message,
    });
  }
}

/**
 * When a transcript is received, it's already being handled by the transcript queue
 * This is a hook for future extensions
 */
export async function onTranscriptReceived(
  meetingId: string,
  orgId: string,
  transcriptData: any
) {
  try {
    logger.info('[MEETING_QUEUE] Transcript received', {
      meetingId,
      orgId,
      speakerId: transcriptData.speaker_id,
    });

    // Transcript processing is already handled by the transcript queue system
    // This hook can be extended for additional processing if needed
  } catch (err: any) {
    logger.error('[MEETING_QUEUE] Error in onTranscriptReceived', {
      meetingId,
      error: err.message,
    });
  }
}

export default {
  onMeetingCreated,
  onMeetingUpdated,
  onMeetingStarted,
  onMeetingEnded,
  onAttendeesAdded,
  onTranscriptReceived,
};
