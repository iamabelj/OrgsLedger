// ============================================================
// OrgsLedger API — Socket.io Real-Time Layer
// Chat, Meetings, Notifications, Financial Updates
// ============================================================

import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { config } from './config';
import db, { tableExists } from './db';
import { logger } from './logger';
import { translateToMultiple, isTtsSupported } from './services/translation.service';
import { getOrgSubscription, getTranslationWallet, deductTranslationWallet } from './services/subscription.service';
import { writeAuditLog } from './middleware/audit';
import { transcribeAudio, generateTTSAudio, isWhisperAvailable } from './services/whisper.service';

// In-memory store for meeting translation sessions
// meetingId -> Map<userId, { language, name, receiveVoice }>
export const meetingLanguages = new Map<string, Map<string, { language: string; name: string; receiveVoice: boolean }>>();

// ── Caches to avoid repeated DB queries ─────────────────
// Meeting org_id cache (meetings rarely change org) — cleared on meeting end
const meetingOrgCache = new Map<string, string>();

// User name cache (avoid DB lookup on every speech event)
const userNameCache = new Map<string, { name: string; cachedAt: number }>();
const USER_NAME_CACHE_TTL = 300_000; // 5 minutes

function getCachedUserName(userId: string): string | null {
  const entry = userNameCache.get(userId);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > USER_NAME_CACHE_TTL) {
    userNameCache.delete(userId);
    return null;
  }
  return entry.name;
}

function cacheUserName(userId: string, name: string): void {
  if (userNameCache.size >= 500) {
    const firstKey = userNameCache.keys().next().value;
    if (firstKey) userNameCache.delete(firstKey);
  }
  userNameCache.set(userId, { name, cachedAt: Date.now() });
}

// Per-user rate limiter for translation:speech events (max 2 per second)
const speechRateLimits = new Map<string, number>();
const SPEECH_RATE_LIMIT_MS = 500; // Min interval between final speech events

// Per-socket audio state for Whisper segmented STT
interface AudioStreamState {
  meetingId: string;
  language: string;
  lastTranscript: string; // context for next segment
}
const activeAudioStreams = new Map<string, AudioStreamState>();

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
    if (!(await tableExists('meeting_transcripts'))) {
      logger.error('[TRANSLATION] ❌ meeting_transcripts table does not exist');
      return;
    }

    // Guard: organization_id is NOT NULL in the schema
    if (!organizationId) {
      logger.error('[TRANSLATION] ❌ Cannot persist transcript — organization_id is null', { meetingId, speakerName });
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
    logger.info(`[TRANSCRIPT] ✓ Persisted: meeting=${meetingId}, speaker=${speakerName}, lang=${sourceLang}, textLen=${originalText.length}`);
  } catch (dbErr: any) {
    logger.error(`[TRANSLATION] ❌ Failed to persist transcript: ${dbErr.message}`, { meetingId, speakerName, organizationId });
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

  // Get speaker name (cached)
  let speakerName = 'Unknown';
  const speaker = langMap?.get(userId);
  if (speaker?.name) {
    speakerName = speaker.name;
  } else {
    const cached = getCachedUserName(userId);
    if (cached) {
      speakerName = cached;
    } else {
      try {
        const user = await db('users').where({ id: userId }).select('first_name', 'last_name').first();
        if (user) {
          speakerName = `${user.first_name} ${user.last_name}`.trim();
          cacheUserName(userId, speakerName);
        }
      } catch (_) { /* non-critical */ }
    }
  }

  logger.debug(`[TRANSCRIPT] Speech: speaker=${speakerName}, isFinal=${isFinal}, lang=${sourceLang}, len=${text.length}`);

  // For interim results, just broadcast original text
  if (!isFinal) {
    socket.to(`meeting:${meetingId}`).emit('translation:interim', {
      meetingId,
      speakerId: userId,
      speakerName,
      text,
      sourceLang,
    });
    return;
  }

  // Collect target languages
  const targetLangs = new Set<string>();
  if (langMap) {
    langMap.forEach((val, uid) => {
      if (val.language !== sourceLang) {
        targetLangs.add(val.language);
      }
    });
    logger.info(`[TRANSLATION] Meeting ${meetingId}: ${langMap.size} participant(s), sourceLang=${sourceLang}, targetLangs=[${[...targetLangs].join(',')}]`);
  } else {
    logger.warn(`[TRANSLATION] No language map for meeting ${meetingId} — no one has set translation preferences`);
  }

  // Look up organization_id (cached per meeting)
  let organizationId: string | null = meetingOrgCache.get(meetingId) || null;
  if (!organizationId) {
    try {
      const meeting = await db('meetings').where({ id: meetingId }).select('organization_id').first();
      organizationId = meeting?.organization_id || null;
      if (organizationId) meetingOrgCache.set(meetingId, organizationId);
    } catch (lookupErr) {
      logger.warn('[TRANSLATION] Failed to look up meeting org', lookupErr);
    }
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

    // Per-user routing — emit translated text immediately
    const langMapForEmit = meetingLanguages.get(meetingId);
    const ttsTargets: { userId: string; language: string }[] = [];

    if (langMapForEmit) {
      const allSockets = await io.in(`meeting:${meetingId}`).fetchSockets();
      logger.debug(`[TRANSLATION] Routing to ${langMapForEmit.size} user(s), ${allSockets.length} socket(s) in room`);
      for (const [targetUserId, prefs] of langMapForEmit.entries()) {
        if (targetUserId === userId) continue;
        const targetSocket = allSockets.find((s) => s.data?.userId === targetUserId);
        if (targetSocket) {
          const ttsSupported = isTtsSupported(prefs.language);
          const wantsTts = ttsSupported && prefs.receiveVoice;
          targetSocket.emit('translation:result', {
            meetingId,
            speakerId: userId,
            speakerName,
            originalText: text,
            sourceLang,
            translations,
            timestamp: now,
            ttsAvailable: wantsTts,
            userLang: prefs.language,
          });
          logger.info(`[TRANSLATION] → user ${targetUserId} (lang=${prefs.language}, ttsSupported=${ttsSupported}, receiveVoice=${prefs.receiveVoice}, willTTS=${wantsTts})`);
          if (wantsTts) {
            ttsTargets.push({ userId: targetUserId, language: prefs.language });
          }
        } else {
          logger.warn(`[TRANSLATION] Socket not found for user ${targetUserId} in meeting room`);
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
      ttsAvailable: false,
    });

    // ── Fire-and-forget: generate server-side TTS audio ──
    // Group by language so we generate only one audio per language
    if (ttsTargets.length > 0) {
      logger.info(`[TTS] Generating audio for ${ttsTargets.length} target(s): ${ttsTargets.map(t => `${t.userId}:${t.language}`).join(', ')}`);
      const ttsGroups = new Map<string, string[]>(); // language → userId[]
      for (const t of ttsTargets) {
        const arr = ttsGroups.get(t.language) || [];
        arr.push(t.userId);
        ttsGroups.set(t.language, arr);
      }
      // Async — don't block the translation result delivery
      (async () => {
        try {
          const allSocks = await io.in(`meeting:${meetingId}`).fetchSockets();
          for (const [lang, userIds] of ttsGroups.entries()) {
            const ttsText = translations[lang] || text;
            if (!ttsText.trim()) {
              logger.warn(`[TTS] Empty text for lang=${lang}, skipping`);
              continue;
            }
            try {
              logger.debug(`[TTS] Generating audio: lang=${lang}, textLen=${ttsText.length}, text="${ttsText.slice(0, 60)}..."`);
              const audioBuffer = await generateTTSAudio(ttsText, { language: lang });
              const audioBase64 = audioBuffer.toString('base64');
              logger.info(`[TTS] ✓ Generated ${(audioBuffer.length / 1024).toFixed(1)}KB mp3 for lang=${lang}`);
              for (const uid of userIds) {
                const sock = allSocks.find((s) => s.data?.userId === uid);
                if (sock) {
                  sock.emit('tts:audio', {
                    meetingId,
                    speakerId: userId,
                    speakerName,
                    audio: audioBase64,
                    format: 'mp3',
                  });
                  logger.info(`[TTS] ✓ Sent audio to user ${uid} (lang=${lang}, ${(audioBase64.length / 1024).toFixed(1)}KB base64)`);
                } else {
                  logger.warn(`[TTS] ✗ Socket not found for user ${uid} — they may have left`);
                }
              }
            } catch (ttsErr: any) {
              logger.error(`[TTS] ✗ Failed to generate for lang=${lang}: ${ttsErr.message}`);
            }
          }
        } catch (outerErr) {
          logger.error('[TTS] Async TTS generation failed:', outerErr);
        }
      })();
    } else {
      logger.debug(`[TTS] No TTS targets (all same language or no receiveVoice) for meeting=${meetingId}`);
    }
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

      // Lightweight check — only select what we need
      const user = await db('users')
        .where({ id: payload.userId, is_active: true })
        .select('id', 'global_role')
        .first();
      if (!user) {
        return next(new Error('User not found'));
      }

      socket.userId = payload.userId;
      socket.email = payload.email;
      socket.globalRole = user.global_role || 'member';

      // CRITICAL: Also set on socket.data so fetchSockets() RemoteSocket objects can access it
      socket.data = { ...socket.data, userId: payload.userId, email: payload.email };
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
        // Parallel: fetch channel + membership in one go
        const [channel, memberships] = await Promise.all([
          db('channels').where({ id: channelId }).select('id', 'organization_id', 'type').first(),
          db('memberships').where({ user_id: userId, is_active: true }).select('organization_id'),
        ]);
        if (!channel) return;

        const isMember = memberships.some((m: any) => m.organization_id === channel.organization_id);
        if (!isMember) {
          socket.emit('error', { message: 'Not a member of this organization' });
          return;
        }

        // For non-general/announcement channels, verify channel membership
        if (!['general', 'announcement'].includes(channel.type)) {
          const channelMember = await db('channel_members')
            .where({ channel_id: channelId, user_id: userId })
            .select('user_id')
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
        // Parallel: fetch meeting + user + membership in one batch
        const [meeting, user] = await Promise.all([
          db('meetings').where({ id: meetingId }).select('organization_id', 'status').first(),
          db('users').where({ id: userId }).select('first_name', 'last_name').first(),
        ]);

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

        const name = user ? `${user.first_name} ${user.last_name}`.trim() : 'Unknown';
        cacheUserName(userId, name);
        // Cache meeting org_id
        meetingOrgCache.set(meetingId, meeting.organization_id);
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
        try {
          if (await tableExists('user_language_preferences')) {
            const pref = await db('user_language_preferences')
              .where({ user_id: userId, organization_id: meeting.organization_id })
              .first();
            if (pref?.preferred_language) {
              if (!meetingLanguages.has(meetingId)) {
                meetingLanguages.set(meetingId, new Map());
              }
              meetingLanguages.get(meetingId)!.set(userId, {
                language: pref.preferred_language,
                name,
                receiveVoice: pref.receive_voice !== false,
              });

              socket.emit('translation:language-restored', {
                meetingId,
                language: pref.preferred_language,
                receiveVoice: pref.receive_voice !== false,
              });

              const participants: Array<{ userId: string; name: string; language: string }> = [];
              meetingLanguages.get(meetingId)!.forEach((val, uid) => {
                participants.push({ userId: uid, name: val.name, language: val.language });
              });
              io.to(`meeting:${meetingId}`).emit('translation:participants', { meetingId, participants });

              logger.debug(`[TRANSLATION] Auto-loaded language ${pref.preferred_language} for user ${userId}`);
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

      logger.debug(`[TRANSLATION] User ${userId} setting language to ${language} for meeting ${meetingId}`);

      // Get user name (cached)
      let name = getCachedUserName(userId);
      if (!name) {
        const user = await db('users').where({ id: userId }).select('first_name', 'last_name').first();
        name = user ? `${user.first_name} ${user.last_name}` : 'Unknown';
        cacheUserName(userId, name);
      }

      // Store in memory
      if (!meetingLanguages.has(meetingId)) {
        meetingLanguages.set(meetingId, new Map());
      }
      meetingLanguages.get(meetingId)!.set(userId, { language, name, receiveVoice });

      // Persist to DB (fire-and-forget, don't block response)
      const orgId = meetingOrgCache.get(meetingId);
      if (orgId) {
        // Already cached — persist directly
        (async () => {
          try {
            if (await tableExists('user_language_preferences')) {
              await db('user_language_preferences')
                .insert({ user_id: userId, organization_id: orgId, preferred_language: language, receive_voice: receiveVoice, receive_text: true })
                .onConflict(['user_id', 'organization_id'])
                .merge({ preferred_language: language, receive_voice: receiveVoice });
            }
          } catch (e) { logger.warn('[TRANSLATION] Failed to persist pref', e); }
          writeAuditLog({ organizationId: orgId, userId, action: 'translation_session_start', entityType: 'meeting', entityId: meetingId, newValue: { language } }).catch(() => {});
        })();
      } else {
        // Need to look up org_id
        (async () => {
          try {
            const meeting = await db('meetings').where({ id: meetingId }).select('organization_id').first();
            if (meeting?.organization_id) {
              meetingOrgCache.set(meetingId, meeting.organization_id);
              if (await tableExists('user_language_preferences')) {
                await db('user_language_preferences')
                  .insert({ user_id: userId, organization_id: meeting.organization_id, preferred_language: language, receive_voice: receiveVoice, receive_text: true })
                  .onConflict(['user_id', 'organization_id'])
                  .merge({ preferred_language: language, receive_voice: receiveVoice });
              }
              writeAuditLog({ organizationId: meeting.organization_id, userId, action: 'translation_session_start', entityType: 'meeting', entityId: meetingId, newValue: { language } }).catch(() => {});
            }
          } catch (e) { logger.warn('[TRANSLATION] Failed to persist pref', e); }
        })();
      }

      // Broadcast updated participant languages (immediate, no DB needed)
      const participants: Array<{ userId: string; name: string; language: string }> = [];
      meetingLanguages.get(meetingId)!.forEach((val, uid) => {
        participants.push({ userId: uid, name: val.name, language: val.language });
      });
      io.to(`meeting:${meetingId}`).emit('translation:participants', { meetingId, participants });
      logger.debug(`User ${userId} set translation language to ${language} for meeting ${meetingId}`);
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

    // ── Server-Side Speech-to-Text (OpenAI Whisper) ──────────
    // Client records 4-second audio segments → sends complete webm files
    // Server transcribes via Whisper (excellent multilingual accuracy)

    socket.on('audio:start', async (data: {
      meetingId: string;
      language?: string;
    }) => {
      const { meetingId, language } = data;
      if (!meetingId) return;

      // Pre-flight: check if Whisper (OpenAI key) is available
      if (!isWhisperAvailable()) {
        logger.error('[STT] ❌ Cannot start audio stream — OpenAI API key not configured!');
        socket.emit('audio:error', {
          meetingId,
          error: 'Speech-to-text service unavailable. OpenAI API key not configured.',
          code: 'STT_UNAVAILABLE',
        });
        return;
      }

      // Clean up any existing state for this socket
      activeAudioStreams.delete(socket.id);

      // Determine language code
      const langMap = meetingLanguages.get(meetingId);
      const userPrefs = langMap?.get(userId);
      const langCode = language || userPrefs?.language || 'en';

      logger.info(`[STT] Starting Whisper audio stream: user=${userId}, meeting=${meetingId}, lang=${langCode}`);

      activeAudioStreams.set(socket.id, {
        meetingId,
        language: langCode,
        lastTranscript: '',
      });

      socket.emit('audio:started', { meetingId });
    });

    // Client sends a complete audio segment (4-second webm file)
    socket.on('audio:segment', async (data: {
      meetingId: string;
      audio: ArrayBuffer | Buffer | string;
    }) => {
      const state = activeAudioStreams.get(socket.id);
      if (!state) return;

      try {
        // Convert to Buffer
        let buf: Buffer;
        if (typeof data.audio === 'string') {
          buf = Buffer.from(data.audio, 'base64');
        } else if (data.audio instanceof ArrayBuffer) {
          buf = Buffer.from(data.audio);
        } else {
          buf = Buffer.isBuffer(data.audio) ? data.audio : Buffer.from(data.audio as any);
        }

        // Skip tiny segments (likely silence/noise)
        if (buf.length < 1000) {
          logger.debug(`[STT] Skipping tiny segment (${buf.length} bytes) for user=${userId}`);
          return;
        }

        // Transcribe via Whisper
        const result = await transcribeAudio(buf, {
          language: state.language,
          prompt: state.lastTranscript,
        });

        const text = result.text;
        if (!text || !text.trim()) {
          logger.debug(`[STT] Empty transcript from Whisper for user=${userId}`);
          return;
        }

        // Update context for next segment
        state.lastTranscript = text;

        // Feed into the translation pipeline (as a final result)
        await handleSpeechText(io, socket, userId, state.meetingId, text, state.language, true);
      } catch (err: any) {
        logger.error(`[STT] Whisper transcription failed for user=${userId}: ${err.message}`);
        socket.emit('audio:error', {
          meetingId: state.meetingId,
          error: `Transcription failed: ${err.message}`,
        });
      }
    });

    // Legacy audio:chunk handler — no-op (replaced by audio:segment)
    socket.on('audio:chunk', () => {});

    socket.on('audio:stop', (data: { meetingId?: string }) => {
      const state = activeAudioStreams.get(socket.id);
      if (state) {
        logger.info(`[STT] Stopping Whisper audio stream: user=${userId}`);
        activeAudioStreams.delete(socket.id);
        socket.emit('audio:stopped', { meetingId: data?.meetingId });
      }
    });

    // ── In-Meeting Chat ─────────────────────────────────
    socket.on('chat:send', async (data: { meetingId: string; message: string }) => {
      try {
        const { meetingId: mid, message } = data || {};
        if (!mid || !message || typeof message !== 'string') return;

        const trimmed = message.trim();
        if (!trimmed || trimmed.length > 2000) return;

        // Verify user is in this meeting room
        if (!socket.rooms.has(`meeting:${mid}`)) {
          socket.emit('chat:error', { message: 'Not in this meeting' });
          return;
        }

        // Cached user name lookup
        let senderName = getCachedUserName(userId);
        if (!senderName) {
          const user = await db('users').where({ id: userId }).select('first_name', 'last_name').first();
          senderName = user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : 'Unknown';
          cacheUserName(userId, senderName);
        }

        // Cached table existence check
        const hasTable = await tableExists('meeting_messages');
        let msgId: string | null = null;

        if (hasTable) {
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

        const hasTable = await tableExists('meeting_messages');
        if (!hasTable) {
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

      // Clean up audio stream state when leaving meeting
      activeAudioStreams.delete(socket.id);

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

      // Clean up audio stream state
      activeAudioStreams.delete(socket.id);

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

  // Clean up caches for this meeting
  meetingLanguages.delete(meetingId);
  meetingOrgCache.delete(meetingId);

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
