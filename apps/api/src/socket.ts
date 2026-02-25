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

// In-memory store for meeting translation sessions
// meetingId -> Map<userId, { language, name, receiveVoice }>
export const meetingLanguages = new Map<string, Map<string, { language: string; name: string; receiveVoice: boolean }>>();

// Cache whether meeting_transcripts table exists (checked once on first insert)
let transcriptTableExists: boolean | null = null;

// Cache whether user_language_preferences table exists
let langPrefsTableExists: boolean | null = null;

// Per-user rate limiter for translation:speech events (max 2 per second)
const speechRateLimits = new Map<string, number>();
const SPEECH_RATE_LIMIT_MS = 500; // Min interval between final speech events

// Active Google STT sessions: socketId -> SpeechSession
const activeSttSessions = new Map<string, SpeechSession>();

interface AuthenticatedSocket extends Socket {
  userId?: string;
  email?: string;
  globalRole?: string;
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
  translations: Record<string, string>
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

    await db('meeting_transcripts').insert({
      meeting_id: meetingId,
      organization_id: organizationId,
      speaker_id: speakerId,
      speaker_name: speakerName,
      original_text: originalText,
      source_lang: sourceLang,
      translations: JSON.stringify(translations),
      spoken_at: Date.now(),
    });
    logger.debug(`[TRANSLATION] Transcript persisted: meeting=${meetingId}, speaker=${speakerName}, lang=${sourceLang}`);
  } catch (dbErr) {
    logger.warn('[TRANSLATION] Failed to persist transcript segment', dbErr);
  }
}

// ── Helper: Process speech text (translate, persist, broadcast) ──
// Shared by both translation:speech (text from client) and STT (text from Google)
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

  const langMap = meetingLanguages.get(meetingId);

  // Look up organization_id early (needed for both interim and final results)
  let organizationId: string | null = null;
  try {
    const meeting = await db('meetings').where({ id: meetingId }).select('organization_id').first();
    organizationId = meeting?.organization_id || null;
  } catch (lookupErr) {
    logger.warn('[TRANSLATION] Failed to look up meeting org', lookupErr);
  }

  // Get speaker name
  let speakerName = 'Unknown';
  const speaker = langMap?.get(userId);
  if (speaker?.name) {
    speakerName = speaker.name;
  } else {
    try {
      const user = await db('users').where({ id: userId }).select('first_name', 'last_name').first();
      if (user) speakerName = `${user.first_name} ${user.last_name}`.trim();
    } catch (_) { /* non-critical */ }
  }

  logger.debug(`[TRANSCRIPT] Speech: speaker=${speakerName}, isFinal=${isFinal}, lang=${sourceLang}, len=${text.length}`);

  // For interim results, broadcast AND persist to DB so we have data for minutes even if finals never arrive
  if (!isFinal) {
    socket.to(`meeting:${meetingId}`).emit('translation:interim', {
      meetingId,
      speakerId: userId,
      speakerName,
      text,
      sourceLang,
    });
    
    await this_persistTranscript(meetingId, organizationId, userId, speakerName, text, sourceLang, { [sourceLang]: text });
    logger.debug(`[TRANSCRIPT] ✓ Interim persisted: meeting=${meetingId}, speaker=${speakerName}`);
    return;
  }

  // Collect target languages
  const targetLangs = new Set<string>();
  if (langMap) {
    langMap.forEach((val) => {
      if (val.language !== sourceLang) {
        targetLangs.add(val.language);
      }
    });
  }

  try {
    let translations: Record<string, string> = {};

    if (targetLangs.size > 0) {
      logger.debug(`[TRANSLATION] Translating to ${targetLangs.size} languages: ${[...targetLangs].join(', ')}`);

      if (organizationId) {
        const wallet = await getTranslationWallet(organizationId);
        const balance = parseFloat(wallet.balance_minutes);
        if (balance <= 0) {
          socket.emit('translation:error', {
            meetingId,
            error: 'Translation wallet empty. Please top up to continue translations.',
            code: 'WALLET_EMPTY',
          });
          await this_persistTranscript(meetingId, organizationId, userId, speakerName, text, sourceLang, {});
          logger.info(`[TRANSCRIPT] ✓ Stored (wallet empty): meeting=${meetingId}, speaker=${speakerName}`);
          io.to(`meeting:${meetingId}`).emit('transcript:stored', {
            meetingId, speakerId: userId, speakerName, originalText: text,
            sourceLang, translations: {}, timestamp: Date.now(),
          });
          return;
        }

        translations = await translateToMultiple(text, [...targetLangs], sourceLang);
        logger.debug(`[TRANSLATION] Translation complete: ${Object.keys(translations).length} languages`);

        const speakingSeconds = Math.max(5, Math.ceil(text.length / 15));
        const langMultiplier = Math.max(1, targetLangs.size);
        const deductMinutes = (speakingSeconds * langMultiplier) / 60;
        const deduction = await deductTranslationWallet(
          organizationId,
          Math.round(deductMinutes * 100) / 100,
          `Live translation: ${targetLangs.size} language(s), ${text.length} chars in meeting`
        );
        if (!deduction.success) {
          logger.warn('[TRANSLATION] Wallet deduction failed but translation was served', {
            meetingId, orgId: organizationId,
          });
        }
      } else {
        translations = await translateToMultiple(text, [...targetLangs], sourceLang);
        logger.warn('[TRANSLATION] No organization_id found for meeting, skipping wallet deduction', { meetingId });
      }
    }

    // Always include the original language
    translations[sourceLang] = text;

    // Persist transcript
    await this_persistTranscript(meetingId, organizationId, userId, speakerName, text, sourceLang, translations);
    logger.info(`[TRANSCRIPT] ✓ Stored: meeting=${meetingId}, speaker=${speakerName}, translations=${Object.keys(translations).length}`);

    const now = Date.now();

    // Emit transcript:stored for real-time transcript tab
    io.to(`meeting:${meetingId}`).emit('transcript:stored', {
      meetingId, speakerId: userId, speakerName, originalText: text,
      sourceLang, translations, timestamp: now,
    });

    // Per-user routing with TTS availability
    const langMapForEmit = meetingLanguages.get(meetingId);
    if (langMapForEmit) {
      const allSockets = await io.in(`meeting:${meetingId}`).fetchSockets();
      for (const [targetUserId, prefs] of langMapForEmit.entries()) {
        if (targetUserId === userId) continue;
        const targetSocket = allSockets.find((s) => (s as any).userId === targetUserId || (s as any).data?.userId === targetUserId);
        if (targetSocket) {
          const ttsAvailable = isTtsSupported(prefs.language) && prefs.receiveVoice;
          targetSocket.emit('translation:result', {
            meetingId,
            speakerId: userId,
            speakerName,
            originalText: text,
            sourceLang,
            translations,
            timestamp: now,
            ttsEnabled: ttsAvailable,
            ttsAvailable,
            userLang: prefs.language,
          });
          logger.debug(`[TRANSLATION] Emitted to user ${targetUserId} (lang=${prefs.language}, tts=${ttsAvailable})`);
        }
      }
    }

    // Also emit to the speaker (no TTS for own speech)
    socket.emit('translation:result', {
      meetingId,
      speakerId: userId,
      speakerName,
      originalText: text,
      sourceLang,
      translations,
      timestamp: now,
      ttsEnabled: false,
      ttsAvailable: false,
    });
  } catch (err) {
    logger.error('[TRANSCRIPT] Translation pipeline failed', err);
    await this_persistTranscript(meetingId, organizationId, userId, speakerName, text, sourceLang, { [sourceLang]: text });
    logger.info(`[TRANSCRIPT] ✓ Stored (error fallback): meeting=${meetingId}, speaker=${speakerName}`);
    io.to(`meeting:${meetingId}`).emit('transcript:stored', {
      meetingId, speakerId: userId, speakerName, originalText: text,
      sourceLang, translations: { [sourceLang]: text }, timestamp: Date.now(),
    });

    socket.emit('translation:result', {
      meetingId,
      speakerId: userId,
      speakerName,
      originalText: text,
      sourceLang,
      translations: { [sourceLang]: text },
      timestamp: Date.now(),
      ttsEnabled: false,
      ttsAvailable: false,
      error: 'Translation temporarily unavailable',
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
              // Set in memory map so translation routing works immediately
              if (!meetingLanguages.has(meetingId)) {
                meetingLanguages.set(meetingId, new Map());
              }
              meetingLanguages.get(meetingId)!.set(userId, {
                language: pref.preferred_language,
                name,
                receiveVoice: pref.receive_voice !== false,
              });

              // Notify the user of their auto-loaded language
              socket.emit('translation:language-restored', {
                meetingId,
                language: pref.preferred_language,
                receiveVoice: pref.receive_voice !== false,
              });

              // Broadcast updated participant languages
              const participants: Array<{ userId: string; name: string; language: string }> = [];
              meetingLanguages.get(meetingId)!.forEach((val, uid) => {
                participants.push({ userId: uid, name: val.name, language: val.language });
              });
              io.to(`meeting:${meetingId}`).emit('translation:participants', { meetingId, participants });

              logger.debug(`[TRANSLATION] Auto-loaded language ${pref.preferred_language} for user ${userId} in meeting ${meetingId}`);
            }
          }
        } catch (prefErr) {
          logger.warn('[TRANSLATION] Failed to auto-load language preference', prefErr);
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

      logger.debug(`[TRANSLATION] User ${userId} setting language to ${language} for meeting ${meetingId} (receiveVoice: ${receiveVoice})`);

      // Get user's name
      const user = await db('users').where({ id: userId }).select('first_name', 'last_name').first();
      const name = user ? `${user.first_name} ${user.last_name}` : 'Unknown';

      // Store in memory (per-user preference including voice toggle)
      if (!meetingLanguages.has(meetingId)) {
        meetingLanguages.set(meetingId, new Map());
      }
      meetingLanguages.get(meetingId)!.set(userId, { language, name, receiveVoice });

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
                preferred_language: language,
                receive_voice: receiveVoice,
                receive_text: true,
              })
              .onConflict(['user_id', 'organization_id'])
              .merge({ preferred_language: language, receive_voice: receiveVoice });
            logger.debug(`[TRANSLATION] Persisted language preference for user ${userId}: ${language}`);
          }
        }
      } catch (prefErr) {
        logger.warn('[TRANSLATION] Failed to persist user language preference', prefErr);
      }

      // Broadcast updated participant languages to everyone in the meeting
      const participants: Array<{ userId: string; name: string; language: string }> = [];
      meetingLanguages.get(meetingId)!.forEach((val, uid) => {
        participants.push({ userId: uid, name: val.name, language: val.language });
      });

      io.to(`meeting:${meetingId}`).emit('translation:participants', {
        meetingId,
        participants,
      });

      logger.debug(`User ${userId} set translation language to ${language} for meeting ${meetingId}`);

      // Audit log for translation session start
      const meetingForAudit = await db('meetings').where({ id: meetingId }).select('organization_id').first();
      if (meetingForAudit?.organization_id) {
        writeAuditLog({
          organizationId: meetingForAudit.organization_id,
          userId,
          action: 'translation_session_start',
          entityType: 'meeting',
          entityId: meetingId,
          newValue: { language, participantCount: participants.length },
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

    // ── Server-Side Speech-to-Text (Google Cloud) ──────────
    // Client streams raw audio → server transcribes via Google STT
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

      // Look up speaker name
      let speakerName = 'Unknown';
      try {
        const user = await db('users').where({ id: userId }).select('first_name', 'last_name').first();
        if (user) speakerName = `${user.first_name} ${user.last_name}`.trim();
      } catch (_) {}

      // Determine language code (from language picker or default en-US)
      const langMap = meetingLanguages.get(meetingId);
      const userPrefs = langMap?.get(userId);
      const langCode = language || userPrefs?.language || 'en-US';

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
      const bcp47Lang = bcp47Map[langCode] || langCode;

      logger.info(`[STT] Starting audio stream: user=${userId}, meeting=${meetingId}, lang=${bcp47Lang}, encoding=${encoding || 'WEBM_OPUS'}`);

      const session = new SpeechSession({
        meetingId,
        userId,
        speakerName,
        languageCode: bcp47Lang,
        encoding: encoding || 'WEBM_OPUS',
        sampleRateHertz: sampleRate,
        onTranscript: (text: string, isFinal: boolean) => {
          // Feed Google STT results into the same translation pipeline
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
      if (!session || session.isClosed) return;
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

      // Remove from translation map
      const langMap = meetingLanguages.get(meetingId);
      if (langMap) {
        langMap.delete(userId);
        if (langMap.size === 0) {
          meetingLanguages.delete(meetingId);
        } else {
          // Broadcast updated participants
          const participants: Array<{ userId: string; name: string; language: string }> = [];
          langMap.forEach((val, uid) => {
            participants.push({ userId: uid, name: val.name, language: val.language });
          });
          io.to(`meeting:${meetingId}`).emit('translation:participants', { meetingId, participants });
        }
      }
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

      // Clean up translation data for any meetings this user was in
      meetingLanguages.forEach((langMap, meetingId) => {
        if (langMap.has(userId)) {
          langMap.delete(userId);
          // Clean up rate limiter for this user+meeting
          speechRateLimits.delete(`${userId}:${meetingId}`);
          if (langMap.size === 0) {
            meetingLanguages.delete(meetingId);
          } else {
            const participants: Array<{ userId: string; name: string; language: string }> = [];
            langMap.forEach((val, uid) => {
              participants.push({ userId: uid, name: val.name, language: val.language });
            });
            io.to(`meeting:${meetingId}`).emit('translation:participants', { meetingId, participants });
          }
        }
      });
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

  // Clean up translation session data for this meeting
  meetingLanguages.delete(meetingId);

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
