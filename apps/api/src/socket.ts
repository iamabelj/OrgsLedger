// ============================================================
// OrgsLedger API — Socket.io Real-Time Layer
// Chat, Meetings, Notifications, Financial Updates
// ============================================================

import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { config } from './config';
import db from './db';
import { logger } from './logger';
import { translateToMultiple, isTtsSupported } from './services/translation.service';
import { getOrgSubscription, getTranslationWallet, deductTranslationWallet } from './services/subscription.service';
import { writeAuditLog } from './middleware/audit';
import { SpeechSession, AudioEncoding } from './services/speech-to-text.service';
import { submitProcessingJob, meetingStateManager } from './meeting-pipeline';
import { registerMultilingualMeetingHandlers } from './services/multilingualMeeting.socket';
import { normalizeLang } from './utils/langNormalize';

// Cache for user info to avoid repeated DB lookups in hot path
// userId -> { firstName, lastName, name }
const userCache = new Map<string, { firstName: string; lastName: string; name: string }>();
const USER_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const userCacheTTL = new Map<string, number>();

// Cache for meeting org_id to avoid repeated DB lookups
// meetingId -> organizationId
const meetingOrgCache = new Map<string, string>();
const MEETING_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const meetingCacheTTL = new Map<string, number>();

// Cache whether meeting_transcripts table exists (checked once on first insert)
let transcriptTableExists: boolean | null = null;

// Cache whether user_language_preferences table exists
let langPrefsTableExists: boolean | null = null;

// Per-user rate limiter for translation:speech events (max 2 per second)
const speechRateLimits = new Map<string, number>();
const SPEECH_RATE_LIMIT_MS = 500; // Min interval between final speech events

// Active Deepgram STT sessions: socketId -> SpeechSession
const activeSttSessions = new Map<string, SpeechSession>();

interface AuthenticatedSocket extends Socket {
  userId?: string;
  email?: string;
  globalRole?: string;
}

// ── Helper: Get cached or fetch user name ────────────────
async function getCachedUserName(userId: string): Promise<string> {
  const now = Date.now();
  const cached = userCache.get(userId);
  const cachedTime = userCacheTTL.get(userId) || 0;

  if (cached && now - cachedTime < USER_CACHE_TTL_MS) {
    return cached.name;
  }

  try {
    const user = await db('users').where({ id: userId }).select('first_name', 'last_name').first();
    if (user) {
      const name = `${user.first_name} ${user.last_name}`.trim();
      userCache.set(userId, { firstName: user.first_name, lastName: user.last_name, name });
      userCacheTTL.set(userId, now);
      return name;
    }
  } catch (_) { /* non-critical */ }

  return 'Unknown';
}

// ── Helper: Get cached or fetch meeting org_id ───────────
async function getCachedMeetingOrg(meetingId: string): Promise<string | null> {
  const now = Date.now();
  const cached = meetingOrgCache.get(meetingId);
  const cachedTime = meetingCacheTTL.get(meetingId) || 0;

  if (cached && now - cachedTime < MEETING_CACHE_TTL_MS) {
    return cached;
  }

  try {
    const meeting = await db('meetings').where({ id: meetingId }).select('organization_id').first();
    if (meeting?.organization_id) {
      meetingOrgCache.set(meetingId, meeting.organization_id);
      meetingCacheTTL.set(meetingId, now);
      return meeting.organization_id;
    }
  } catch (_) { /* non-critical */ }

  return null;
}

// ── Helper: Persist transcript segment to DB ────────────
// Stores transcript. Requires valid organizationId (NOT NULL in schema).
async function this_persistTranscript(
  meetingId: string,
  organizationId: string | null,
  speakerId: string,
  speakerName: string,
  originalText: string,
  sourceLang: string,
  translations: Record<string, string>,
  spokenAtMs?: number
): Promise<void> {
  try {
    // Check table existence once and cache result
    if (transcriptTableExists === null) {
      transcriptTableExists = await db.schema.hasTable('meeting_transcripts');
    }
    if (!transcriptTableExists) {
      logger.warn('[TRANSLATION] meeting_transcripts table does not exist, skipping persist');
      return;
    }

    // Guard: organization_id is NOT NULL in the schema
    if (!organizationId) {
      logger.warn('[TRANSLATION] Cannot persist transcript — organization_id is null', { meetingId });
      return;
    }

    const normalizedSourceLang = normalizeLang(sourceLang);

    await db('meeting_transcripts').insert({
      meeting_id: meetingId,
      organization_id: organizationId,
      speaker_id: speakerId,
      speaker_name: speakerName,
      original_text: originalText,
      source_lang: normalizedSourceLang,
      translations: JSON.stringify(translations),
      spoken_at: typeof spokenAtMs === 'number' ? spokenAtMs : Date.now(),
    });
    logger.debug(`[TRANSLATION] Transcript persisted: meeting=${meetingId}, speaker=${speakerName}, lang=${normalizedSourceLang}`);
  } catch (dbErr) {
    logger.warn('[TRANSLATION] Failed to persist transcript segment', dbErr);
  }
}

// ── Helper: Process speech text (translate, persist, broadcast) ──
// Shared by both translation:speech (text from client) and STT (text from Deepgram)
async function handleSpeechText(
  io: Server,
  socket: AuthenticatedSocket,
  userId: string,
  meetingId: string,
  text: string,
  sourceLang: string,
  isFinal: boolean
): Promise<void> {
  if (!meetingId || !text?.trim()) return;

  const normalizedSourceLang = normalizeLang(sourceLang);

  // Rate limit final speech events per user (prevent flooding)
  if (isFinal) {
    const rateLimitKey = `${userId}:${meetingId}`;
    const lastTime = speechRateLimits.get(rateLimitKey) || 0;
    const now = Date.now();
    if (now - lastTime < SPEECH_RATE_LIMIT_MS) {
      logger.debug(`[TRANSLATION] Rate limited speech from ${userId} (${now - lastTime}ms since last)`);
      return;
    }
    speechRateLimits.set(rateLimitKey, now);
  }

  // Get speaker name (use cache to avoid DB lookup in hot path)
  const speakerName = await getCachedUserName(userId);

  logger.debug(`[TRANSCRIPT] Speech: speaker=${speakerName}, isFinal=${isFinal}, lang=${sourceLang}, len=${text.length}`);

  // For interim results: broadcast ONLY (do NOT persist)
  // Redline removal: Interim persistence in hot path is expensive and not needed
  // Clients cache interim text locally until final arrives; we only need finals in DB for minutes generation
  if (!isFinal) {
    socket.to(`meeting:${meetingId}`).emit('translation:interim', {
      meetingId,
      speakerId: userId,
      speakerName,
      text,
      sourceLang: normalizedSourceLang,
    });
    return; // <-- KEY CHANGE: Skip DB write for interim
  }

  // For FINAL results: persist + translate + broadcast
  // Get cached organization_id (needed for transcript storage)
  let organizationId: string | null = await getCachedMeetingOrg(meetingId);

  // Use a stable timestamp for DB + socket events + queued job
  const spokenAtMs = Date.now();

  // Durability: best-effort persist + emit immediately, regardless of queue health.
  // This prevents permanent data loss if BullMQ workers are down/crashing.
  if (organizationId) {
    await this_persistTranscript(meetingId, organizationId, userId, speakerName, text, normalizedSourceLang, {}, spokenAtMs);
    io.to(`meeting:${meetingId}`).emit('transcript:stored', {
      meetingId,
      speakerId: userId,
      speakerName,
      originalText: text,
      sourceLang: normalizedSourceLang,
      translations: {},
      timestamp: spokenAtMs,
    });
  } else {
    // Still emit so UIs can render something even if DB write is impossible
    io.to(`meeting:${meetingId}`).emit('transcript:stored', {
      meetingId,
      speakerId: userId,
      speakerName,
      originalText: text,
      sourceLang: normalizedSourceLang,
      translations: {},
      timestamp: spokenAtMs,
    });
    logger.warn('[TRANSLATION] organizationId missing; transcript not persisted (schema requires NOT NULL)', { meetingId });
  }

  // Collect target languages (Redis-backed, multi-instance safe)
  const targetLangList = await meetingStateManager.getTargetLanguages(meetingId, normalizedSourceLang);
  const targetLangs = new Set<string>(targetLangList);

  try {
    if (targetLangs.size > 0) {
      logger.debug(`[TRANSLATION] Queuing translation job to ${targetLangs.size} languages: ${[...targetLangs].join(', ')}`);

      if (organizationId) {
        // Check wallet balance before submitting (for immediate feedback)
        const wallet = await getTranslationWallet(organizationId);
        const balance = parseFloat(wallet.balance_minutes);
        if (balance <= 0) {
          socket.emit('translation:error', {
            meetingId,
            error: 'Translations disabled (translation wallet empty). Original transcript was still saved.',
            code: 'TRANSLATIONS_DISABLED',
            reason: 'WALLET_EMPTY',
          });
          logger.warn('[TRANSLATION] Wallet empty, rejecting translation job', { meetingId, orgId: organizationId });
          return; // transcript already persisted/emitted above
        }

        // Submit translation job to processing queue (non-blocking)
        const jobId = await submitProcessingJob({
          meetingId,
          speakerId: userId,
          originalText: text,
          sourceLanguage: normalizedSourceLang,
          targetLanguages: [...targetLangs],
          isFinal: true,
          organizationId, // Pass org ID for wallet deduction in worker
          timestamp: spokenAtMs,
          alreadyPersisted: true,
        });
        logger.info(`[TRANSLATION] ✓ Job submitted to queue: jobId=${jobId}, meeting=${meetingId}, speaker=${speakerName}, targets=${targetLangs.size}`);

        await writeAuditLog({
          userId,
          action: 'submitted_translation_job',
          entityType: 'meeting',
          entityId: meetingId,
          newValue: { jobId, targetLanguages: targetLangs.size, textLength: text.length },
        });
      } else {
        // Submit job without wallet tracking (org-less meetings)
        const jobId = await submitProcessingJob({
          meetingId,
          speakerId: userId,
          originalText: text,
          sourceLanguage: normalizedSourceLang,
          targetLanguages: [...targetLangs],
          isFinal: true,
          timestamp: spokenAtMs,
          alreadyPersisted: false,
        });
        logger.info(`[TRANSLATION] ✓ Job submitted (no org): jobId=${jobId}, meeting=${meetingId}, speaker=${speakerName}`);
      }
    } else {
      // No target languages: nothing to enqueue (durability already handled above)
      logger.info(`[TRANSCRIPT] ✓ Stored (original only): meeting=${meetingId}, speaker=${speakerName}`);
    }
  } catch (err) {
    logger.error('[TRANSLATION] Failed to submit translation job', err);
    // Transcript already persisted/emitted above; here we only surface the error to the client
    socket.emit('translation:error', {
      meetingId,
      error: 'Failed to process translation. Please try again.',
      code: 'JOB_SUBMISSION_FAILED',
      timestamp: Date.now(),
    });
  }
}

export function setupSocketIO(httpServer: HttpServer): Server {
  const allowedOrigins = config.env === 'production'
    ? ['https://app.orgsledger.com', 'https://orgsledger.com']
    : '*';

  const io = new Server(httpServer, {
    cors: {
      origin: allowedOrigins,
      methods: ['GET', 'POST'],
    },
    pingTimeout: 60000,
    pingInterval: 25000,
    maxHttpBufferSize: 10e6, // 10MB for file sharing
  });

  // ── Authentication Middleware ────────────────────────────
  io.use(async (socket: AuthenticatedSocket, next) => {
    try {
      const token =
        socket.handshake.auth.token ||
        socket.handshake.headers.authorization?.split(' ')[1];

      if (!token) {
        return next(new Error('Authentication required'));
      }

      const payload = jwt.verify(token, config.jwt.secret) as {
        userId: string;
        email: string;
      };

      const user = await db('users')
        .where({ id: payload.userId, is_active: true })
        .first();
      if (!user) {
        return next(new Error('User not found'));
      }

      socket.userId = payload.userId;
      socket.email = payload.email;
      socket.globalRole = user.global_role || 'member';
      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  // ── Connection Handler ──────────────────────────────────
  io.on('connection', async (socket: AuthenticatedSocket) => {
    const userId = socket.userId!;
    logger.debug(`Socket connected: ${userId}`);

    // Join user's personal room
    socket.join(`user:${userId}`);

    // Join all organization rooms the user belongs to
    try {
      const memberships = await db('memberships')
        .where({ user_id: userId, is_active: true })
        .select('organization_id');

      for (const m of memberships) {
        socket.join(`org:${m.organization_id}`);
      }

      // Join all channels the user is a member of
      const channelMemberships = await db('channel_members')
        .join('channels', 'channel_members.channel_id', 'channels.id')
        .where({ 'channel_members.user_id': userId })
        .select('channels.id');

      for (const cm of channelMemberships) {
        socket.join(`channel:${cm.id}`);
      }
    } catch (err) {
      logger.error('Error joining rooms', err);
    }

    // ── Register Deepgram Multilingual Meeting Handlers ──────
    registerMultilingualMeetingHandlers(io, socket);

    // ── Channel Events ──────────────────────────────────
    socket.on('channel:join', async (channelId: string) => {
      try {
        // Verify user is a member of this channel (or it's a general/announcement channel in an org they belong to)
        const channel = await db('channels').where({ id: channelId }).first();
        if (!channel) return;

        const membership = await db('memberships')
          .where({ user_id: userId, organization_id: channel.organization_id, is_active: true })
          .first();
        if (!membership) {
          socket.emit('error', { message: 'Not a member of this organization' });
          return;
        }

        // For non-general/announcement channels, verify channel membership
        if (!['general', 'announcement'].includes(channel.type)) {
          const channelMember = await db('channel_members')
            .where({ channel_id: channelId, user_id: userId })
            .first();
          if (!channelMember) {
            socket.emit('error', { message: 'Not a member of this channel' });
            return;
          }
        }

        socket.join(`channel:${channelId}`);
      } catch (err) {
        logger.error('channel:join authorization error', err);
      }
    });

    socket.on('channel:leave', (channelId: string) => {
      socket.leave(`channel:${channelId}`);
    });

    socket.on('channel:typing', (data: { channelId: string }) => {
      socket.to(`channel:${data.channelId}`).emit('channel:typing', {
        userId,
        channelId: data.channelId,
      });
    });

    socket.on('channel:stop-typing', (data: { channelId: string }) => {
      socket.to(`channel:${data.channelId}`).emit('channel:stop-typing', {
        userId,
        channelId: data.channelId,
      });
    });

    socket.on('channel:read', (data: { channelId: string }) => {
      // Update last_read_at in DB and broadcast to channel
      db('channel_members')
        .where({ channel_id: data.channelId, user_id: userId })
        .update({ last_read_at: db.fn.now() })
        .catch((err) => logger.error('Failed to update read timestamp', err));

      socket.to(`channel:${data.channelId}`).emit('channel:read', {
        userId,
        channelId: data.channelId,
        readAt: new Date().toISOString(),
      });
    });

    // ── Meeting Events ──────────────────────────────────
    socket.on('meeting:join', async (meetingId: string) => {
      try {
        // Verify user is a member of the meeting's organization
        const meeting = await db('meetings').where({ id: meetingId }).select('organization_id', 'status').first();
        if (!meeting) {
          socket.emit('error', { message: 'Meeting not found' });
          return;
        }

        // Prevent joining ended meetings
        if (meeting.status === 'ended') {
          socket.emit('meeting:join-rejected', { meetingId, reason: 'Meeting has ended' });
          return;
        }

        const membership = await db('memberships')
          .where({ user_id: userId, organization_id: meeting.organization_id, is_active: true })
          .first();
        if (!membership) {
          socket.emit('error', { message: 'Not a member of this organization' });
          return;
        }

        // Get user name for participant payload
        const user = await db('users').where({ id: userId }).select('first_name', 'last_name').first();
        const name = user ? `${user.first_name} ${user.last_name}`.trim() : 'Unknown';
        const isModerator = ['org_admin', 'executive'].includes(membership.role);

        socket.join(`meeting:${meetingId}`);
        // Store meeting association on socket for cleanup
        (socket as any)._meetingId = meetingId;

        socket.to(`meeting:${meetingId}`).emit('meeting:participant-joined', {
          userId,
          name,
          isModerator,
          meetingId,
        });

        // ── Auto-load saved language preference for this user ──
        // If user previously set a language in this org, auto-apply it
        try {
          if (langPrefsTableExists === null) {
            langPrefsTableExists = await db.schema.hasTable('user_language_preferences');
          }
          if (langPrefsTableExists) {
            const pref = await db('user_language_preferences')
              .where({ user_id: userId, organization_id: meeting.organization_id })
              .first();
            if (pref?.preferred_language) {
              const normalizedPrefLang = normalizeLang(pref.preferred_language);
              await meetingStateManager.upsertParticipantPrefs(meetingId, {
                userId,
                name,
                language: normalizedPrefLang,
                receiveVoice: pref.receive_voice !== false,
              });

              // Notify the user of their auto-loaded language
              socket.emit('translation:language-restored', {
                meetingId,
                language: normalizedPrefLang,
                receiveVoice: pref.receive_voice !== false,
              });

              // Broadcast updated participant languages
              const prefs = await meetingStateManager.getParticipantPrefs(meetingId);
              const participants = prefs.map((p) => ({ userId: p.userId, name: p.name, language: p.language }));
              io.to(`meeting:${meetingId}`).emit('translation:participants', { meetingId, participants });

              logger.debug(`[TRANSLATION] Auto-loaded language ${pref.preferred_language} for user ${userId} in meeting ${meetingId}`);
            }
          }
        } catch (prefErr) {
          logger.warn('[TRANSLATION] Failed to auto-load language preference', prefErr);
        }

        // Ensure participant exists in Redis even if no saved prefs
        // (prevents split-brain + makes translation routing multi-instance safe)
        try {
          const existing = await meetingStateManager.getParticipantPrefs(meetingId);
          if (!existing.some((p) => p.userId === userId)) {
            await meetingStateManager.upsertParticipantPrefs(meetingId, {
              userId,
              name,
              language: 'en',
              receiveVoice: true,
            });
            const participants = (await meetingStateManager.getParticipantPrefs(meetingId))
              .map((p) => ({ userId: p.userId, name: p.name, language: p.language }));
            io.to(`meeting:${meetingId}`).emit('translation:participants', { meetingId, participants });
          }
        } catch (e) {
          logger.warn('[TRANSLATION] Failed to ensure participant prefs', e);
        }

        logger.debug(`User ${userId} (${name}) joined meeting ${meetingId}`);
      } catch (err) {
        logger.error('meeting:join authorization error', err);
      }
    });

    // ── Raise Hand ──────────────────────────────────────
    socket.on('meeting:raise-hand', (data: { meetingId: string; userId: string; name: string; raised: boolean }) => {
      if (!data.meetingId) return;
      socket.to(`meeting:${data.meetingId}`).emit('meeting:hand-raised', {
        userId: data.userId,
        name: data.name,
        raised: data.raised,
      });
    });

    // ── Moderator Controls ──────────────────────────────
    socket.on('meeting:recording-started', (data: { meetingId: string }) => {
      if (!data.meetingId) return;
      io.to(`meeting:${data.meetingId}`).emit('meeting:recording-started', {
        meetingId: data.meetingId,
        startedBy: userId,
      });
    });

    socket.on('meeting:recording-stopped', (data: { meetingId: string }) => {
      if (!data.meetingId) return;
      io.to(`meeting:${data.meetingId}`).emit('meeting:recording-stopped', {
        meetingId: data.meetingId,
        stoppedBy: userId,
      });
    });

    socket.on('meeting:lock', (data: { meetingId: string; locked: boolean }) => {
      if (!data.meetingId) return;
      io.to(`meeting:${data.meetingId}`).emit('meeting:lock-changed', {
        meetingId: data.meetingId,
        locked: data.locked,
        changedBy: userId,
      });
    });

    // ── Audio Streaming for AI ──────────────────────────
    socket.on('meeting:audio-chunk', (data: { meetingId: string; chunk: Buffer }) => {
      // Forward audio chunks for real-time processing
      socket.to(`meeting:${data.meetingId}`).emit('meeting:audio-chunk', {
        userId,
        chunk: data.chunk,
      });
    });

    // ── Live Translation System ─────────────────────────
    // User sets their preferred language for a meeting
    socket.on('translation:set-language', async (data: { meetingId: string; language: string; receiveVoice?: boolean }) => {
      const { meetingId, language, receiveVoice = true } = data;
      if (!meetingId || !language) return;

      const normalizedLanguage = normalizeLang(language);

      logger.debug(`[TRANSLATION] User ${userId} setting language to ${normalizedLanguage} for meeting ${meetingId} (receiveVoice: ${receiveVoice})`);

      // Get user's name
      const user = await db('users').where({ id: userId }).select('first_name', 'last_name').first();
      const name = user ? `${user.first_name} ${user.last_name}` : 'Unknown';

      // Store in memory (per-user preference including voice toggle)
      await meetingStateManager.upsertParticipantPrefs(meetingId, {
        userId,
        name,
        language: normalizedLanguage,
        receiveVoice,
      });

      // Persist to DB for future meetings
      try {
        const meeting = await db('meetings').where({ id: meetingId }).select('organization_id').first();
        if (meeting?.organization_id) {
          const hasTable = langPrefsTableExists !== null ? langPrefsTableExists : await db.schema.hasTable('user_language_preferences');
          if (langPrefsTableExists === null) langPrefsTableExists = hasTable;
          if (hasTable) {
            await db('user_language_preferences')
              .insert({
                user_id: userId,
                organization_id: meeting.organization_id,
                preferred_language: normalizedLanguage,
                receive_voice: receiveVoice,
                receive_text: true,
              })
              .onConflict(['user_id', 'organization_id'])
              .merge({ preferred_language: normalizedLanguage, receive_voice: receiveVoice });
            logger.debug(`[TRANSLATION] Persisted language preference for user ${userId}: ${normalizedLanguage}`);
          }
        }
      } catch (prefErr) {
        logger.warn('[TRANSLATION] Failed to persist user language preference', prefErr);
      }

      // Broadcast updated participant languages to everyone in the meeting
      const prefs = await meetingStateManager.getParticipantPrefs(meetingId);
      const participants = prefs.map((p) => ({ userId: p.userId, name: p.name, language: p.language }));

      io.to(`meeting:${meetingId}`).emit('translation:participants', {
        meetingId,
        participants,
      });

      logger.debug(`User ${userId} set translation language to ${normalizedLanguage} for meeting ${meetingId}`);

      // Audit log for translation session start
      const meetingForAudit = await db('meetings').where({ id: meetingId }).select('organization_id').first();
      if (meetingForAudit?.organization_id) {
        writeAuditLog({
          organizationId: meetingForAudit.organization_id,
          userId,
          action: 'translation_session_start',
          entityType: 'meeting',
          entityId: meetingId,
          newValue: { language: normalizedLanguage, participantCount: participants.length },
        }).catch(err => logger.warn('Audit log failed (translation session)', err));
      }
    });

    // User sends spoken text for translation
    socket.on('translation:speech', async (data: {
      meetingId: string;
      text: string;
      sourceLang: string;
      isFinal: boolean;
    }) => {
      const { meetingId, text, sourceLang, isFinal } = data;
      await handleSpeechText(io, socket, userId, meetingId, text, sourceLang, isFinal);
    });

    // ── Server-Side Speech-to-Text (Deepgram) ──────────
    // Client streams raw audio → server transcribes via Deepgram STT
    // Works for web (MediaRecorder WEBM_OPUS) and mobile clients

    socket.on('audio:start', async (data: {
      meetingId: string;
      language?: string;
      encoding?: AudioEncoding;
      sampleRate?: number;
    }) => {
      const { meetingId, language, encoding, sampleRate } = data;
      if (!meetingId) return;

      // Clean up any existing session for this socket
      const sessionKey = socket.id;
      const existingSession = activeSttSessions.get(sessionKey);
      if (existingSession) {
        existingSession.close();
        activeSttSessions.delete(sessionKey);
      }

      // Look up speaker name (use cache to avoid DB lookup)
      const speakerName = await getCachedUserName(userId);

      // Determine language code (from language picker or default en-US)
      const prefs = await meetingStateManager.getParticipantPrefs(meetingId);
      const myPref = prefs.find((p) => p.userId === userId);
      const langCode = normalizeLang(language || myPref?.language || 'en');

      // Map our short language codes to BCP-47
      const bcp47Map: Record<string, string> = {
        en: 'en-US', es: 'es-ES', fr: 'fr-FR', de: 'de-DE',
        pt: 'pt-BR', it: 'it-IT', zh: 'zh-CN', ja: 'ja-JP',
        ko: 'ko-KR', ar: 'ar-SA', hi: 'hi-IN', ru: 'ru-RU',
        nl: 'nl-NL', sv: 'sv-SE', pl: 'pl-PL', tr: 'tr-TR',
        vi: 'vi-VN', th: 'th-TH', uk: 'uk-UA', cs: 'cs-CZ',
        ro: 'ro-RO', hu: 'hu-HU', el: 'el-GR', he: 'he-IL',
        da: 'da-DK', fi: 'fi-FI', no: 'nb-NO', id: 'id-ID',
        ms: 'ms-MY', tl: 'fil-PH', sw: 'sw-KE', bn: 'bn-IN',
      };
      const bcp47Lang = bcp47Map[langCode] || bcp47Map[normalizeLang(langCode)] || langCode;

      logger.info(`[STT] Starting audio stream: user=${userId}, meeting=${meetingId}, lang=${bcp47Lang}, encoding=${encoding || 'WEBM_OPUS'}`);

      // Safety net: ensure user has Redis-backed participant prefs
      // so translation fan-out can determine target languages.
      // This covers cases where the client forgets to emit translation:set-language.
      try {
        await meetingStateManager.upsertParticipantPrefs(meetingId, {
          userId,
          name: speakerName,
          language: langCode,
          receiveVoice: true,
        });
        const participants = (await meetingStateManager.getParticipantPrefs(meetingId))
          .map((p) => ({ userId: p.userId, name: p.name, language: p.language }));
        io.to(`meeting:${meetingId}`).emit('translation:participants', { meetingId, participants });
      } catch (e) {
        logger.warn('[STT] Failed to upsert participant prefs', e);
      }

      const session = new SpeechSession({
        meetingId,
        userId,
        speakerName,
        languageCode: bcp47Lang,
        encoding: encoding || 'WEBM_OPUS',
        sampleRateHertz: sampleRate,
        onTranscript: (text: string, isFinal: boolean) => {
          // Feed Deepgram STT results into the same translation pipeline
          handleSpeechText(io, socket, userId, meetingId, text, langCode, isFinal);
        },
        onError: (err: Error) => {
          socket.emit('audio:error', {
            meetingId,
            error: err.message,
          });
        },
      });

      session.start();
      activeSttSessions.set(sessionKey, session);

      socket.emit('audio:started', { meetingId });
    });

    socket.on('audio:chunk', (data: {
      meetingId: string;
      audio: ArrayBuffer | Buffer | string;
    }) => {
      const session = activeSttSessions.get(socket.id);
      if (!session || session.isClosed) {
        logger.debug(`[STT] audio:chunk ignored: hasSession=${!!session}, isClosed=${session?.isClosed}`);
        return;
      }
      const audioSize = data.audio ? (data.audio instanceof ArrayBuffer ? data.audio.byteLength : (Buffer.isBuffer(data.audio) ? data.audio.length : data.audio.length)) : 0;
      logger.debug(`[STT] audio:chunk received: user=${userId}, size=${audioSize}`);
      session.pushAudio(data.audio);
    });

    socket.on('audio:stop', (data: { meetingId?: string }) => {
      const session = activeSttSessions.get(socket.id);
      if (session) {
        logger.info(`[STT] Stopping audio stream: user=${userId}`);
        session.close();
        activeSttSessions.delete(socket.id);
        socket.emit('audio:stopped', { meetingId: data?.meetingId });
      }
    });

    // ── In-Meeting Chat ─────────────────────────────────
    socket.on('chat:send', async (data: { meetingId: string; message: string }) => {
      try {
        const { meetingId: mid, message } = data || {};
        if (!mid || !message || typeof message !== 'string') return;

        const trimmed = message.trim();
        if (!trimmed || trimmed.length > 2000) return; // Reject empty or oversized messages

        // Verify user is in this meeting room
        const rooms = socket.rooms;
        if (!rooms.has(`meeting:${mid}`)) {
          socket.emit('chat:error', { message: 'Not in this meeting' });
          return;
        }

        // Look up sender name
        const user = await db('users').where({ id: userId }).select('first_name', 'last_name').first();
        const senderName = user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : 'Unknown';

        // Check table existence (cached)
        const tableExists = await db.schema.hasTable('meeting_messages');
        let msgId: string | null = null;

        if (tableExists) {
          const [row] = await db('meeting_messages')
            .insert({
              meeting_id: mid,
              sender_id: userId,
              sender_name: senderName,
              message: trimmed,
            })
            .returning('id');
          msgId = row?.id || row;
        }

        const payload = {
          id: msgId || `temp_${Date.now()}`,
          meetingId: mid,
          senderId: userId,
          senderName,
          message: trimmed,
          createdAt: new Date().toISOString(),
        };

        // Broadcast to everyone in the meeting room (including sender)
        io.to(`meeting:${mid}`).emit('chat:new', payload);
        logger.debug(`[Chat] Message in meeting ${mid} from ${senderName}`);
      } catch (err) {
        logger.error('[Chat] chat:send error', err);
        socket.emit('chat:error', { message: 'Failed to send message' });
      }
    });

    // Fetch chat history for a meeting
    socket.on('chat:history', async (data: { meetingId: string }, callback?: Function) => {
      try {
        const mid = data?.meetingId;
        if (!mid) return;

        const tableExists = await db.schema.hasTable('meeting_messages');
        if (!tableExists) {
          if (typeof callback === 'function') callback({ messages: [] });
          return;
        }

        const messages = await db('meeting_messages')
          .where({ meeting_id: mid })
          .orderBy('created_at', 'asc')
          .limit(200)
          .select('id', 'meeting_id', 'sender_id', 'sender_name', 'message', 'created_at');

        const formatted = messages.map((m: any) => ({
          id: m.id,
          meetingId: m.meeting_id,
          senderId: m.sender_id,
          senderName: m.sender_name,
          message: m.message,
          createdAt: m.created_at,
        }));

        if (typeof callback === 'function') {
          callback({ messages: formatted });
        } else {
          socket.emit('chat:history', { messages: formatted });
        }
      } catch (err) {
        logger.error('[Chat] chat:history error', err);
        if (typeof callback === 'function') callback({ messages: [] });
      }
    });

    // Clean up translation data when user leaves
    socket.on('meeting:leave', (meetingId: string) => {
      socket.leave(`meeting:${meetingId}`);
      (socket as any)._meetingId = null;
      socket.to(`meeting:${meetingId}`).emit('meeting:participant-left', {
        userId,
        meetingId,
      });

      // Clean up STT session when leaving meeting
      const sttSession = activeSttSessions.get(socket.id);
      if (sttSession) {
        sttSession.close();
        activeSttSessions.delete(socket.id);
      }

      // Clean up rate limiter for this user+meeting
      speechRateLimits.delete(`${userId}:${meetingId}`);

      // Remove from Redis participant prefs
      meetingStateManager.removeParticipantPrefs(meetingId, userId)
        .then(async () => {
          const prefs = await meetingStateManager.getParticipantPrefs(meetingId);
          const participants = prefs.map((p) => ({ userId: p.userId, name: p.name, language: p.language }));
          io.to(`meeting:${meetingId}`).emit('translation:participants', { meetingId, participants });
        })
        .catch((e) => logger.warn('[TRANSLATION] Failed to remove participant prefs on leave', e));
    });

    // ── Financial Updates ───────────────────────────────
    socket.on('ledger:subscribe', async (orgId: string) => {
      try {
        // Verify user is a member of this organization
        const membership = await db('memberships')
          .where({ user_id: userId, organization_id: orgId, is_active: true })
          .first();
        if (!membership) {
          socket.emit('error', { message: 'Not a member of this organization' });
          return;
        }
        socket.join(`ledger:${orgId}`);
      } catch (err) {
        logger.error('ledger:subscribe authorization error', err);
      }
    });

    // ── Presence ────────────────────────────────────────
    socket.on('disconnect', () => {
      logger.debug(`Socket disconnected: ${userId}`);

      // Clean up STT session
      const sttSession = activeSttSessions.get(socket.id);
      if (sttSession) {
        sttSession.close();
        activeSttSessions.delete(socket.id);
        logger.debug(`[STT] Cleaned up session on disconnect: user=${userId}`);
      }

      // Clean up Redis participant prefs for the meeting this socket was associated with
      const meetingId = (socket as any)._meetingId as string | null;
      if (meetingId) {
        meetingStateManager.removeParticipantPrefs(meetingId, userId)
          .then(async () => {
            // Clean up rate limiter for this user+meeting
            speechRateLimits.delete(`${userId}:${meetingId}`);
            const prefs = await meetingStateManager.getParticipantPrefs(meetingId);
            const participants = prefs.map((p) => ({ userId: p.userId, name: p.name, language: p.language }));
            io.to(`meeting:${meetingId}`).emit('translation:participants', { meetingId, participants });
          })
          .catch((e) => logger.warn('[TRANSLATION] Failed to remove participant prefs on disconnect', e));
      }
    });
  });

  return io;
}

/**
 * Force-disconnect all sockets from a meeting room.
 * Called when moderator ends meeting.
 * Emits meeting:force-disconnect before disconnecting.
 */
export async function forceDisconnectMeeting(
  io: Server,
  meetingId: string
): Promise<void> {
  const roomName = `meeting:${meetingId}`;

  // Emit force-disconnect event BEFORE removing sockets
  io.to(roomName).emit('meeting:force-disconnect', {
    meetingId,
    reason: 'Meeting ended by moderator',
  });

  // Get all sockets in the meeting room and force them out
  const sockets = await io.in(roomName).fetchSockets();
  for (const s of sockets) {
    s.leave(roomName);
  }

  try {
    // Best-effort cleanup of Redis participant prefs
    const prefs = await meetingStateManager.getParticipantPrefs(meetingId);
    await Promise.all(prefs.map((p) => meetingStateManager.removeParticipantPrefs(meetingId, p.userId)));
  } catch (e) {
    logger.warn('[TRANSLATION] Failed to cleanup participant prefs on force disconnect', e);
  }

  logger.info(`Force-disconnected ${sockets.length} sockets from meeting ${meetingId}`);
}

/**
 * Emit a financial update to all connected org members.
 * Called when transactions are created/updated.
 */
export function emitFinancialUpdate(
  io: Server,
  organizationId: string,
  data: any
): void {
  io.to(`org:${organizationId}`).emit('financial:update', data);
  io.to(`ledger:${organizationId}`).emit('ledger:update', data);
}
