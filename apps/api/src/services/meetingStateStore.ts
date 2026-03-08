// ============================================================
// OrgsLedger — Redis Meeting State Store
// Replaces in-memory meetingLanguages Map with Redis-backed
// state so multiple API instances can share meeting data.
//
// Drop-in replacement: same read/write interface, but state
// survives restarts and is visible to all pods.
// ============================================================

import { logger } from '../logger';
import { getRedisClient } from '../infrastructure/redisClient';

const MEETING_STATE_PREFIX = 'meeting:state:';
const MEETING_LANGS_PREFIX = 'meeting:langs:';
const MEETING_TTL = 86400; // 24 hours

// ── Meeting State ────────────────────────────────────────

interface MeetingState {
  status: 'active' | 'ended';
  orgId: string;
  title?: string;
  participantCount: number;
  createdAt: string;
}

export async function setMeetingState(meetingId: string, state: MeetingState): Promise<void> {
  try {
    const redis = await getRedisClient();
    const key = `${MEETING_STATE_PREFIX}${meetingId}`;
    await redis.hmset(key, {
      status: state.status,
      orgId: state.orgId,
      title: state.title || '',
      participantCount: String(state.participantCount),
      createdAt: state.createdAt,
    });
    await redis.expire(key, MEETING_TTL);
  } catch (err) {
    logger.warn('[MEETING_STATE] Failed to set meeting state', err);
  }
}

export async function getMeetingState(meetingId: string): Promise<MeetingState | null> {
  try {
    const redis = await getRedisClient();
    const data = await redis.hgetall(`${MEETING_STATE_PREFIX}${meetingId}`);
    if (!data || !data.status) return null;
    return {
      status: data.status as 'active' | 'ended',
      orgId: data.orgId,
      title: data.title || undefined,
      participantCount: parseInt(data.participantCount || '0', 10),
      createdAt: data.createdAt,
    };
  } catch (err) {
    logger.warn('[MEETING_STATE] Failed to get meeting state', err);
    return null;
  }
}

// ── Participant Languages ────────────────────────────────

interface ParticipantPref {
  language: string;
  name: string;
  receiveVoice: boolean;
}

/**
 * Set a participant's language preference for a meeting.
 * Compatible with existing meetingLanguages Map interface.
 */
export async function setParticipantLanguage(
  meetingId: string,
  userId: string,
  pref: ParticipantPref,
): Promise<void> {
  try {
    const redis = await getRedisClient();
    const key = `${MEETING_LANGS_PREFIX}${meetingId}`;
    await redis.hset(key, userId, JSON.stringify(pref));
    await redis.expire(key, MEETING_TTL);
  } catch (err) {
    logger.warn('[MEETING_STATE] Failed to set participant language', err);
  }
}

/**
 * Remove a participant from a meeting.
 */
export async function removeParticipant(meetingId: string, userId: string): Promise<void> {
  try {
    const redis = await getRedisClient();
    await redis.hdel(`${MEETING_LANGS_PREFIX}${meetingId}`, userId);
  } catch (err) {
    logger.warn('[MEETING_STATE] Failed to remove participant', err);
  }
}

/**
 * Get all participant language preferences for a meeting.
 * Returns a Map compatible with the existing meetingLanguages structure.
 */
export async function getMeetingParticipants(
  meetingId: string,
): Promise<Map<string, ParticipantPref>> {
  const result = new Map<string, ParticipantPref>();
  try {
    const redis = await getRedisClient();
    const data = await redis.hgetall(`${MEETING_LANGS_PREFIX}${meetingId}`);
    if (data) {
      for (const [userId, json] of Object.entries(data)) {
        try {
          result.set(userId, JSON.parse(json));
        } catch {
          // Skip malformed entries
        }
      }
    }
  } catch (err) {
    logger.warn('[MEETING_STATE] Failed to get participants', err);
  }
  return result;
}

/**
 * Get unique target languages for a meeting (excluding source language).
 * Replaces getTargetLanguagesFast() in multilingualTranslation.service.ts
 */
export async function getTargetLanguages(meetingId: string, sourceLang: string): Promise<string[]> {
  const participants = await getMeetingParticipants(meetingId);
  const langs = new Set<string>();
  for (const [, pref] of participants) {
    const norm = pref.language.split('-')[0].toLowerCase();
    const src = sourceLang.split('-')[0].toLowerCase();
    if (norm !== src) {
      langs.add(norm);
    }
  }
  return Array.from(langs);
}

/**
 * Get count of active meetings (for metrics).
 */
export async function getActiveMeetingCount(): Promise<number> {
  try {
    const redis = await getRedisClient();
    const keys = await redis.keys(`${MEETING_STATE_PREFIX}*`);
    return keys.length;
  } catch {
    return 0;
  }
}

/**
 * Clean up meeting state when a meeting ends.
 */
export async function cleanupMeeting(meetingId: string): Promise<void> {
  try {
    const redis = await getRedisClient();
    await redis.del(
      `${MEETING_STATE_PREFIX}${meetingId}`,
      `${MEETING_LANGS_PREFIX}${meetingId}`,
    );
    logger.debug(`[MEETING_STATE] Cleaned up state for meeting ${meetingId}`);
  } catch (err) {
    logger.warn('[MEETING_STATE] Failed to cleanup', err);
  }
}
