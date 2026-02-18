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

// In-memory store for meeting translation sessions
// meetingId -> Map<userId, { language, name, receiveVoice }>
const meetingLanguages = new Map<string, Map<string, { language: string; name: string; receiveVoice: boolean }>>();

interface AuthenticatedSocket extends Socket {
  userId?: string;
  email?: string;
  globalRole?: string;
}

// ── Helper: Persist transcript segment to DB ────────────
// Always stores transcript even when org_id is missing
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
    const hasTable = await db.schema.hasTable('meeting_transcripts');
    if (!hasTable) {
      logger.warn('[TRANSLATION] meeting_transcripts table does not exist, skipping persist');
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
          const hasTable = await db.schema.hasTable('user_language_preferences');
          if (hasTable) {
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
          const hasTable = await db.schema.hasTable('user_language_preferences');
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
      if (!meetingId || !text?.trim()) return;

      const langMap = meetingLanguages.get(meetingId);

      // Get speaker name — from in-memory map or fall back to DB lookup
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

      // For interim results, just broadcast the original text to others
      // (so they see the speaker is talking)
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

      // For final results, translate to all unique languages needed
      const targetLangs = new Set<string>();
      if (langMap) {
        langMap.forEach((val) => {
          if (val.language !== sourceLang) {
            targetLangs.add(val.language);
          }
        });
      }

      // Always look up organization_id early for transcript storage
      let organizationId: string | null = null;
      try {
        const meeting = await db('meetings').where({ id: meetingId }).select('organization_id').first();
        organizationId = meeting?.organization_id || null;
      } catch (lookupErr) {
        logger.warn('[TRANSLATION] Failed to look up meeting org', lookupErr);
      }

      try {
        let translations: Record<string, string> = {};

        if (targetLangs.size > 0) {
          logger.debug(`[TRANSLATION] Translating to ${targetLangs.size} languages: ${[...targetLangs].join(', ')}`);

          if (organizationId) {
            // Check translation wallet before making API calls
            const wallet = await getTranslationWallet(organizationId);
            const balance = parseFloat(wallet.balance_minutes);
            if (balance <= 0) {
              socket.emit('translation:error', {
                meetingId,
                error: 'Translation wallet empty. Please top up to continue translations.',
                code: 'WALLET_EMPTY',
              });
              // Still persist the original transcript even if wallet empty
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

            // Deduct translation wallet — estimate ~0.5 minutes per translation batch
            const deductMinutes = 0.5;
            const deduction = await deductTranslationWallet(
              organizationId,
              deductMinutes,
              `Live translation: ${targetLangs.size} language(s) in meeting`
            );
            if (!deduction.success) {
              logger.warn('[TRANSLATION] Wallet deduction failed but translation was served', {
                meetingId, orgId: organizationId,
              });
            }
          } else {
            // No org found but still translate
            translations = await translateToMultiple(text, [...targetLangs], sourceLang);
            logger.warn('[TRANSLATION] No organization_id found for meeting, skipping wallet deduction', { meetingId });
          }
        }

        // ── Always persist transcript segment to DB ──────────
        await this_persistTranscript(meetingId, organizationId, userId, speakerName, text, sourceLang, translations);
        logger.info(`[TRANSCRIPT] ✓ Stored: meeting=${meetingId}, speaker=${speakerName}, translations=${Object.keys(translations).length}`);
        // Always include the original language
        translations[sourceLang] = text;

        const now = Date.now();

        // ── Emit transcript:stored for real-time transcript tab updates ──
        io.to(`meeting:${meetingId}`).emit('transcript:stored', {
          meetingId, speakerId: userId, speakerName, originalText: text,
          sourceLang, translations, timestamp: now,
        });

        // ── Per-user routing: emit individually with TTS availability ──
        // Each user gets their translation + a ttsAvailable flag based on:
        //   1. Whether TTS engine supports their target language
        //   2. Whether the user has opted in to receive voice
        const langMapForEmit = meetingLanguages.get(meetingId);
        if (langMapForEmit) {
          for (const [targetUserId, prefs] of langMapForEmit.entries()) {
            if (targetUserId === userId) continue; // Don't send to speaker
            const targetSocketIds = await io.in(`meeting:${meetingId}`).fetchSockets();
            const targetSocket = targetSocketIds.find((s) => (s as any).userId === targetUserId || (s as any).data?.userId === targetUserId);
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
        // Still persist the original text even if translation fails
        await this_persistTranscript(meetingId, organizationId, userId, speakerName, text, sourceLang, { [sourceLang]: text });
        logger.info(`[TRANSCRIPT] ✓ Stored (error fallback): meeting=${meetingId}, speaker=${speakerName}`);
        io.to(`meeting:${meetingId}`).emit('transcript:stored', {
          meetingId, speakerId: userId, speakerName, originalText: text,
          sourceLang, translations: { [sourceLang]: text }, timestamp: Date.now(),
        });

        // Still send the original text even if translation fails
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
    });

    // Clean up translation data when user leaves
    socket.on('meeting:leave', (meetingId: string) => {
      socket.leave(`meeting:${meetingId}`);
      (socket as any)._meetingId = null;
      socket.to(`meeting:${meetingId}`).emit('meeting:participant-left', {
        userId,
        meetingId,
      });

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
      // Clean up translation data for any meetings this user was in
      meetingLanguages.forEach((langMap, meetingId) => {
        if (langMap.has(userId)) {
          langMap.delete(userId);
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
