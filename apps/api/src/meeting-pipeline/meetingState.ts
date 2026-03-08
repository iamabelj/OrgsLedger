// ============================================================
// OrgsLedger — Meeting State Manager
// Tracks active meetings and their state in Redis
// ============================================================

import { getRedisClient } from '../infrastructure/redisClient';
import { logger } from '../logger';
import { MeetingState, TranscriptSegment } from './types';
import { normalizeLang } from '../utils/langNormalize';

const MEETING_KEY = (id: string) => `meeting:state:${id}`;
const SEGMENTS_KEY = (id: string) => `meeting:segments:${id}`;
const LANGUAGES_KEY = (id: string) => `meeting:languages:${id}`;
const PARTICIPANTS_KEY = (id: string) => `meeting:participants:${id}`;
const TTL_SECONDS = 86400; // 24 hours

export interface MeetingParticipantPrefs {
  userId: string;
  name: string;
  language: string;
  receiveVoice: boolean;
  updatedAt: string; // ISO
}

class MeetingStateManager {
  /**
   * Start or resume a meeting
   */
  async startMeeting(
    meetingId: string,
    config?: {
      organizationId?: string;
      targetLanguages?: string[];
      enableTranslations?: boolean;
      enableSummary?: boolean;
    }
  ): Promise<MeetingState> {
    const redis = await getRedisClient();
    const key = MEETING_KEY(meetingId);

    // Check if already exists
    const existing = await redis.get(key);
    if (existing) {
      const state = JSON.parse(existing) as MeetingState;
      state.status = 'active';
      await redis.setex(key, TTL_SECONDS, JSON.stringify(state));
      logger.info('[MEETING_STATE] Meeting resumed', { meetingId });
      return state;
    }

    // Create new state
    const state: MeetingState = {
      meetingId,
      organizationId: config?.organizationId || '',
      status: 'active',
      startedAt: new Date().toISOString(),
      segmentCount: 0,
      participantLanguages: (config?.targetLanguages || []).map((l) => normalizeLang(l)),
      lastSummarySegment: 0,
    };

    await redis.setex(key, TTL_SECONDS, JSON.stringify(state));

    // Set languages if provided
    if (config?.targetLanguages && config.targetLanguages.length > 0) {
      await this.setParticipantLanguages(meetingId, config.targetLanguages);
    }

    logger.info('[MEETING_STATE] Meeting started', { meetingId, config });
    return state;
  }

  /**
   * Get meeting state
   */
  async getMeeting(meetingId: string): Promise<MeetingState | null> {
    const redis = await getRedisClient();
    const data = await redis.get(MEETING_KEY(meetingId));
    return data ? JSON.parse(data) : null;
  }

  /**
   * Update segment count and get current count
   */
  async incrementSegmentCount(meetingId: string): Promise<number> {
    const redis = await getRedisClient();
    const key = MEETING_KEY(meetingId);
    const data = await redis.get(key);

    if (!data) {
      logger.warn('[MEETING_STATE] Meeting not found for increment', { meetingId });
      return 0;
    }

    const state = JSON.parse(data) as MeetingState;
    state.segmentCount++;
    await redis.setex(key, TTL_SECONDS, JSON.stringify(state));
    return state.segmentCount;
  }

  /**
   * Store transcript segment for later retrieval (minutes generation)
   */
  async storeSegment(segment: TranscriptSegment): Promise<void> {
    const redis = await getRedisClient();
    const key = SEGMENTS_KEY(segment.meetingId);

    // Use segment index as score for ordering
    const score = segment.segmentIndex;
    await redis.zadd(key, score, JSON.stringify(segment));
    await redis.expire(key, TTL_SECONDS);
  }

  /**
   * Get all segments for a meeting (ordered by timestamp)
   */
  async getSegments(meetingId: string): Promise<TranscriptSegment[]> {
    const redis = await getRedisClient();
    const key = SEGMENTS_KEY(meetingId);

    const data = await redis.zrange(key, 0, -1);
    return data.map((d: string) => JSON.parse(d) as TranscriptSegment);
  }

  /**
   * Get segments since last summary
   */
  async getSegmentsSince(
    meetingId: string,
    lastIndex: number
  ): Promise<TranscriptSegment[]> {
    const segments = await this.getSegments(meetingId);
    return segments.filter((s) => s.segmentIndex > lastIndex);
  }

  /**
   * Update last summary segment index
   */
  async updateLastSummarySegment(
    meetingId: string,
    segmentIndex: number
  ): Promise<void> {
    const redis = await getRedisClient();
    const key = MEETING_KEY(meetingId);
    const data = await redis.get(key);

    if (!data) return;

    const state = JSON.parse(data) as MeetingState;
    state.lastSummarySegment = segmentIndex;
    await redis.setex(key, TTL_SECONDS, JSON.stringify(state));
  }

  /**
   * Set participant languages for translation
   */
  async setParticipantLanguages(
    meetingId: string,
    languages: string[]
  ): Promise<void> {
    const redis = await getRedisClient();
    const key = LANGUAGES_KEY(meetingId);

    const normalized = (languages || [])
      .map((l) => normalizeLang(l))
      .filter((l) => !!l);

    await redis.del(key);
    if (normalized.length > 0) {
      await redis.sadd(key, ...normalized);
      await redis.expire(key, TTL_SECONDS);
    }

    // Also update meeting state
    const stateKey = MEETING_KEY(meetingId);
    const data = await redis.get(stateKey);
    if (data) {
      const state = JSON.parse(data) as MeetingState;
      state.participantLanguages = normalized;
      await redis.setex(stateKey, TTL_SECONDS, JSON.stringify(state));
    }

    logger.debug('[MEETING_STATE] Languages set', { meetingId, languages });
  }

  /**
   * Upsert a participant's translation preferences for this meeting.
   * This is the authoritative source of per-user language prefs for multi-instance deployments.
   */
  async upsertParticipantPrefs(
    meetingId: string,
    prefs: Omit<MeetingParticipantPrefs, 'updatedAt'>
  ): Promise<void> {
    const redis = await getRedisClient();
    const key = PARTICIPANTS_KEY(meetingId);

    const normalizedLang = normalizeLang(prefs.language);
    const record: MeetingParticipantPrefs = {
      userId: prefs.userId,
      name: prefs.name,
      language: normalizedLang,
      receiveVoice: prefs.receiveVoice,
      updatedAt: new Date().toISOString(),
    };

    await redis.hset(key, prefs.userId, JSON.stringify(record));
    await redis.expire(key, TTL_SECONDS);

    // Best-effort: keep meeting-level language set in sync (union) for backward compat
    if (normalizedLang) {
      await redis.sadd(LANGUAGES_KEY(meetingId), normalizedLang);
      await redis.expire(LANGUAGES_KEY(meetingId), TTL_SECONDS);
    }
  }

  /** Remove a participant from meeting prefs */
  async removeParticipantPrefs(meetingId: string, userId: string): Promise<void> {
    const redis = await getRedisClient();
    const key = PARTICIPANTS_KEY(meetingId);
    await redis.hdel(key, userId);
    await redis.expire(key, TTL_SECONDS);
  }

  /** Get all participant prefs for a meeting */
  async getParticipantPrefs(meetingId: string): Promise<MeetingParticipantPrefs[]> {
    const redis = await getRedisClient();
    const key = PARTICIPANTS_KEY(meetingId);
    const values = await redis.hvals(key);
    const parsed: MeetingParticipantPrefs[] = [];
    for (const v of values) {
      try {
        const p = JSON.parse(v) as MeetingParticipantPrefs;
        parsed.push({
          ...p,
          language: normalizeLang(p.language),
        });
      } catch {
        // ignore malformed entry
      }
    }
    return parsed;
  }

  /**
   * Get target languages for translation
   */
  async getTargetLanguages(
    meetingId: string,
    excludeLanguage?: string
  ): Promise<string[]> {
    const redis = await getRedisClient();
    const exclude = excludeLanguage ? normalizeLang(excludeLanguage) : undefined;

    // Prefer per-participant prefs when available (multi-instance safe)
    const participantValues = await redis.hvals(PARTICIPANTS_KEY(meetingId));
    if (participantValues.length > 0) {
      const langSet = new Set<string>();
      for (const v of participantValues) {
        try {
          const p = JSON.parse(v) as { language?: string };
          const l = p.language ? normalizeLang(p.language) : '';
          if (l) langSet.add(l);
        } catch {
          // ignore
        }
      }
      const langs = Array.from(langSet);
      return exclude ? langs.filter((l) => l !== exclude) : langs;
    }

    // Fallback to legacy meeting-level set
    const key = LANGUAGES_KEY(meetingId);
    const languages = await redis.smembers(key);
    if (exclude) {
      return languages
        .map((l: string) => normalizeLang(l))
        .filter((l: string) => l !== exclude);
    }
    return languages.map((l: string) => normalizeLang(l));
  }

  /**
   * End a meeting
   */
  async endMeeting(meetingId: string): Promise<MeetingState | null> {
    const redis = await getRedisClient();
    const key = MEETING_KEY(meetingId);
    const data = await redis.get(key);

    if (!data) {
      logger.warn('[MEETING_STATE] Meeting not found for end', { meetingId });
      return null;
    }

    const state = JSON.parse(data) as MeetingState;
    state.status = 'ended';
    state.endedAt = new Date().toISOString();
    await redis.setex(key, TTL_SECONDS, JSON.stringify(state));

    logger.info('[MEETING_STATE] Meeting ended', {
      meetingId,
      segmentCount: state.segmentCount,
      duration: state.endedAt
        ? new Date(state.endedAt).getTime() - new Date(state.startedAt).getTime()
        : 0,
    });

    return state;
  }

  /**
   * Clean up meeting data (after minutes generated)
   */
  async cleanup(meetingId: string): Promise<void> {
    const redis = await getRedisClient();
    await Promise.all([
      redis.del(MEETING_KEY(meetingId)),
      redis.del(SEGMENTS_KEY(meetingId)),
      redis.del(LANGUAGES_KEY(meetingId)),
      redis.del(PARTICIPANTS_KEY(meetingId)),
    ]);
    logger.debug('[MEETING_STATE] Cleaned up', { meetingId });
  }
}

// Singleton instance
const meetingStateManager = new MeetingStateManager();

export { meetingStateManager, MeetingStateManager };
