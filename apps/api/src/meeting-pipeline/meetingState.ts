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
const TTL_SECONDS = 86400; // 24 hours

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
   * Get target languages for translation
   */
  async getTargetLanguages(
    meetingId: string,
    excludeLanguage?: string
  ): Promise<string[]> {
    const redis = await getRedisClient();
    const key = LANGUAGES_KEY(meetingId);
    const languages = await redis.smembers(key);

    const exclude = excludeLanguage ? normalizeLang(excludeLanguage) : undefined;

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
    ]);
    logger.debug('[MEETING_STATE] Cleaned up', { meetingId });
  }
}

// Singleton instance
const meetingStateManager = new MeetingStateManager();

export { meetingStateManager, MeetingStateManager };
