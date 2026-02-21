// ============================================================
// OrgsLedger — LiveKit Bot (per-meeting)
// Connects to a LiveKit room as a hidden participant using
// @livekit/rtc-node (server-native SDK), subscribes to all
// audio tracks, and creates a RealtimeSession per speaker
// to stream audio to OpenAI for per-speaker transcription.
// ============================================================

import { AccessToken } from 'livekit-server-sdk';
import { config } from '../../config';
import { logger } from '../../logger';
import db from '../../db';
import { RealtimeSession, TranscriptRow } from './realtimeSession';
import { translateToMultiple, isTtsSupported } from '../translation.service';
import { getTranslationWallet, deductTranslationWallet } from '../subscription.service';

// @livekit/rtc-node is ESM-only — dynamic import cached at runtime
let lkRtc: typeof import('@livekit/rtc-node') | null = null;
async function getLkRtc() {
  if (!lkRtc) {
    lkRtc = await import('@livekit/rtc-node');
  }
  return lkRtc;
}

// ── Types ────────────────────────────────────────────────────

export interface LivekitBotOptions {
  meetingId: string;
  organizationId: string;
  roomName: string;
  /** Socket.IO server instance for broadcasting */
  io: any;
  /** In-memory language prefs map from socket.ts */
  meetingLanguages?: Map<string, Map<string, { language: string; name: string; receiveVoice: boolean }>>;
}

// ── Constants ────────────────────────────────────────────────

const BOT_IDENTITY = 'orgsledger-transcription-bot';
const BOT_NAME = 'OrgsLedger Transcriber';

// ── LiveKit Bot ──────────────────────────────────────────────

export class LivekitBot {
  // Room typed as `any` because @livekit/rtc-node is ESM-only
  // and loaded dynamically. Actual type: import('@livekit/rtc-node').Room
  private room: any = null;
  private sessions = new Map<string, RealtimeSession>();
  // Keep AudioStream references alive to prevent GC while piping
  private audioStreams = new Map<string, any>();
  private closed = false;

  private readonly meetingId: string;
  private readonly organizationId: string;
  private readonly roomName: string;
  private readonly io: any;
  private readonly meetingLanguages?: Map<string, Map<string, { language: string; name: string; receiveVoice: boolean }>>;

  constructor(opts: LivekitBotOptions) {
    this.meetingId = opts.meetingId;
    this.organizationId = opts.organizationId;
    this.roomName = opts.roomName;
    this.io = opts.io;
    this.meetingLanguages = opts.meetingLanguages;

    logger.info(`[LivekitBot] Created for meeting=${this.meetingId}, room=${this.roomName}`);
  }

  // ── Public API ──────────────────────────────────────────

  /** Connect to the LiveKit room and start subscribing to audio tracks. */
  async connect(): Promise<void> {
    if (this.closed) return;

    const { url, apiKey, apiSecret } = config.livekit;

    // ── LAYER 1.1 — Config validation ─────────────────
    if (!url) {
      logger.error('[Bot] LIVEKIT_URL not configured — cannot connect');
      throw new Error('LIVEKIT_URL not configured');
    }
    if (!apiKey || !apiSecret) {
      logger.error('[Bot] LIVEKIT_API_KEY / LIVEKIT_API_SECRET not configured');
      throw new Error('LIVEKIT_API_KEY / LIVEKIT_API_SECRET not configured');
    }
    logger.info(`[Bot] Connecting to room: ${this.roomName} (meeting=${this.meetingId})`);
    logger.info(`[Bot] LiveKit URL=${url}, apiKey=${apiKey.slice(0, 6)}..., identity=${BOT_IDENTITY}`);

    // Generate a bot access token — subscribe-only, hidden
    const token = new AccessToken(apiKey, apiSecret, {
      identity: BOT_IDENTITY,
      name: BOT_NAME,
      ttl: '2h',
    });
    token.addGrant({
      room: this.roomName,
      roomJoin: true,
      canPublish: false,
      canSubscribe: true,
      canPublishData: false,
      hidden: true,
    });
    const jwt = await token.toJwt();
    logger.debug(`[Bot] Token generated: room=${this.roomName}, grants=[roomJoin, canSubscribe, hidden]`);

    // Dynamic import of the ESM-only rtc-node SDK
    const rtc = await getLkRtc();

    // Create and connect the Room
    this.room = new rtc.Room();
    this.setupEventHandlers(rtc);

    const connectStart = Date.now();
    await this.room.connect(url, jwt, { autoSubscribe: true });
    const connectMs = Date.now() - connectStart;
    logger.info(`[Bot] Connected successfully in ${connectMs}ms: room=${this.roomName}, participants=${this.room.remoteParticipants.size}`);

    // Process participants already in the room
    let existingAudioTracks = 0;
    for (const participant of this.room.remoteParticipants.values()) {
      for (const pub of participant.trackPublications.values()) {
        if (pub.track && pub.kind === rtc.TrackKind.KIND_AUDIO) {
          existingAudioTracks++;
          await this.onTrackSubscribed(rtc, pub.track, pub, participant);
        }
      }
    }
    if (existingAudioTracks > 0) {
      logger.info(`[Bot] Processed ${existingAudioTracks} existing audio track(s) in room`);
    }
  }

  /** Disconnect from the room and close all sessions. */
  async disconnect(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    // ── LAYER 7.2 — Meeting end closes everything ─────
    logger.info(`[Bot] Stopping bot for meeting ${this.meetingId} (activeSessions=${this.sessions.size}, audioStreams=${this.audioStreams.size})`);

    // Close all RealtimeSession instances
    for (const [speakerId, session] of this.sessions) {
      logger.info(`[Realtime] Closing session for ${speakerId}`);
      session.close();
    }
    logger.info(`[Realtime] All sessions closed (meeting=${this.meetingId})`);
    this.sessions.clear();
    this.audioStreams.clear();

    // Disconnect from LiveKit
    if (this.room) {
      await this.room.disconnect();
      this.room = null;
    }

    logger.info(`[Bot] Room disconnected: meeting=${this.meetingId}, no WebSocket connections remain`);
  }

  get activeSessionCount(): number {
    return this.sessions.size;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  // ── Event Handlers ──────────────────────────────────────

  private setupEventHandlers(rtc: typeof import('@livekit/rtc-node')): void {
    if (!this.room) return;

    // Track subscribed → create transcription session
    this.room.on(rtc.RoomEvent.TrackSubscribed, (
      track: any,
      publication: any,
      participant: any,
    ) => {
      this.onTrackSubscribed(rtc, track, publication, participant).catch((err: any) => {
        logger.error(`[LivekitBot] onTrackSubscribed error`, err);
      });
    });

    // Track unsubscribed → close session
    this.room.on(rtc.RoomEvent.TrackUnsubscribed, (
      _track: any,
      publication: any,
      participant: any,
    ) => {
      if (publication.kind !== rtc.TrackKind.KIND_AUDIO) return;
      const speakerId = participant.identity;
      logger.info(`[LivekitBot] Track unsubscribed: speaker=${participant.name || speakerId}`);
      this.closeSession(speakerId);
    });

    // Participant disconnected → close session
    this.room.on(rtc.RoomEvent.ParticipantDisconnected, (participant: any) => {
      const speakerId = participant.identity;
      logger.info(`[LivekitBot] Participant disconnected: speaker=${participant.name || speakerId}`);
      this.closeSession(speakerId);
    });

    // Room disconnected
    this.room.on(rtc.RoomEvent.Disconnected, (reason: any) => {
      logger.warn(`[LivekitBot] Room disconnected: meeting=${this.meetingId}, reason=${reason}`);
      if (!this.closed) {
        this.disconnect().catch(() => {});
      }
    });
  }

  /**
   * Create a RealtimeSession for the speaker and pipe audio
   * from the LiveKit AudioStream into it.
   */
  private async onTrackSubscribed(
    rtc: typeof import('@livekit/rtc-node'),
    track: any,
    publication: any,
    participant: any,
  ): Promise<void> {
    // Only audio tracks
    if (publication.kind !== rtc.TrackKind.KIND_AUDIO) return;

    const speakerId: string = participant.identity;
    const speakerName: string = participant.name || participant.identity;

    // Skip duplicate sessions
    if (this.sessions.has(speakerId)) {
      logger.debug(`[Bot] Session already exists: speaker=${speakerName}`);
      return;
    }
    // Skip bot's own tracks
    if (speakerId === BOT_IDENTITY) return;

    // ── LAYER 1.2 — Track subscription confirmation ───
    logger.info(`[Bot] Subscribed to audio track from ${speakerId} (name=${speakerName}, trackSid=${track?.sid || 'unknown'})`);

    // Determine source language from metadata or in-memory map
    let sourceLang = 'en';
    try {
      const meta = participant.metadata ? JSON.parse(participant.metadata) : {};
      if (meta.language) sourceLang = meta.language;
    } catch (_) { /* default */ }
    const langMap = this.meetingLanguages?.get(this.meetingId);
    if (langMap?.has(speakerId)) {
      sourceLang = langMap.get(speakerId)!.language;
    }

    // Create the RealtimeSession (one per speaker)
    const session = new RealtimeSession({
      meetingId: this.meetingId,
      organizationId: this.organizationId,
      speakerId,
      speakerName,
      sourceLang,
      onTranscript: (transcript) => this.translateAndBroadcast(transcript),
    });
    this.sessions.set(speakerId, session);

    try {
      await session.connect();
      logger.info(`[LivekitBot] RealtimeSession connected: speaker=${speakerName}`);
    } catch (err) {
      logger.error(`[LivekitBot] RealtimeSession connect failed: speaker=${speakerName}`, err);
      this.sessions.delete(speakerId);
      return;
    }

    // Create an AudioStream from the subscribed track
    // @livekit/rtc-node AudioStream is an async iterable of AudioFrame
    // We request 24kHz mono to match OpenAI Realtime requirements
    try {
      const audioStream = new rtc.AudioStream(track, 24000, 1);
      this.audioStreams.set(speakerId, audioStream);

      // Pipe audio frames in background (non-blocking)
      this.pipeAudioFrames(audioStream, session, speakerId, speakerName);
    } catch (err) {
      logger.error(`[LivekitBot] AudioStream creation failed: speaker=${speakerName}`, err);
    }
  }

  /**
   * Async iterator over AudioStream frames → push into RealtimeSession.
   * Runs until the stream or session ends.
   */
  private async pipeAudioFrames(
    audioStream: any,
    session: RealtimeSession,
    speakerId: string,
    speakerName: string,
  ): Promise<void> {
    // ── LAYER 2.1 — Audio frame flow tracking ─────────
    let frameCount = 0;
    let totalSamples = 0;
    let zeroFrames = 0;
    const pipeStart = Date.now();
    const LOG_INTERVAL = 500; // Log summary every 500 frames

    try {
      for await (const frame of audioStream) {
        if (session.isClosed || this.closed) break;
        frameCount++;

        // @livekit/rtc-node AudioFrame.data is Int16Array (PCM16 mono)
        if (frame.data instanceof Int16Array) {
          totalSamples += frame.data.length;
          if (frame.data.length === 0) zeroFrames++;
          const buf = Buffer.from(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength);
          session.pushAudio(buf);
        } else if (frame.data instanceof Float32Array) {
          totalSamples += frame.data.length;
          if (frame.data.length === 0) zeroFrames++;
          session.pushAudio(frame.data);
        } else if (Buffer.isBuffer(frame.data)) {
          totalSamples += frame.data.length / 2; // PCM16 = 2 bytes/sample
          if (frame.data.length === 0) zeroFrames++;
          session.pushAudio(frame.data);
        }

        // ── LAYER 2.1 — Periodic audio flow summary ───
        if (frameCount === 1) {
          logger.info(`[Audio] First frame received from ${speakerId}, samples: ${frame.data?.length || 0}, type: ${frame.data?.constructor?.name || 'unknown'}`);
        }
        if (frameCount % LOG_INTERVAL === 0) {
          const elapsedSec = ((Date.now() - pipeStart) / 1000).toFixed(1);
          logger.info(`[Audio] Pipeline stats for ${speakerId}: frames=${frameCount}, totalSamples=${totalSamples}, zeroFrames=${zeroFrames}, elapsed=${elapsedSec}s`);
        }
      }
    } catch (err: any) {
      if (!this.closed && !session.isClosed) {
        logger.warn(`[Audio] AudioStream ended: speaker=${speakerName}: ${err.message}`);
      }
    } finally {
      const totalSec = ((Date.now() - pipeStart) / 1000).toFixed(1);
      logger.info(`[Audio] Pipeline ended for ${speakerId}: totalFrames=${frameCount}, totalSamples=${totalSamples}, zeroFrames=${zeroFrames}, duration=${totalSec}s`);
      this.audioStreams.delete(speakerId);
    }
  }

  /** Close and remove a session for a specific speaker. */
  private closeSession(speakerId: string): void {
    const session = this.sessions.get(speakerId);
    if (session) {
      // ── LAYER 7.1 — Track unsubscribe closes session ─
      logger.info(`[Realtime] Closing session for ${speakerId}`);
      session.close();
      this.sessions.delete(speakerId);
      this.audioStreams.delete(speakerId);
      logger.info(`[Realtime] Session closed: speaker=${speakerId}, remainingSessions=${this.sessions.size}`);
    }
  }

  // ── Translation & Broadcast ─────────────────────────────

  /**
   * After a transcript is persisted by the RealtimeSession,
   * translate to all target languages and broadcast via Socket.IO.
   * Mirrors the translation:speech handler in socket.ts.
   */
  private async translateAndBroadcast(transcript: TranscriptRow): Promise<void> {
    const { meetingId, organizationId, speakerId, speakerName, text, sourceLang, timestamp } = transcript;
    // ── LAYER 6.1 — Translation trigger fires ─────────
    logger.info(`[Translation] Translating transcript for meeting ${meetingId}: speaker=${speakerName}, textLen=${text.length}, sourceLang=${sourceLang}`);

    try {
      const langMap = this.meetingLanguages?.get(meetingId);
      const targetLangs = new Set<string>();

      if (langMap) {
        langMap.forEach((val) => {
          if (val.language !== sourceLang) {
            targetLangs.add(val.language);
          }
        });
      }

      let translations: Record<string, string> = {};

      if (targetLangs.size > 0 && organizationId) {
        const wallet = await getTranslationWallet(organizationId);
        const balance = parseFloat(wallet.balance_minutes);
        logger.info(`[TRANSLATION_PIPELINE] Wallet check: org=${organizationId}, balance=${balance.toFixed(2)} min, targetLangs=${[...targetLangs].join(',')}`);

        if (balance > 0) {
          translations = await translateToMultiple(text, [...targetLangs], sourceLang);
          logger.info(`[TRANSLATION_PIPELINE] Translation SUCCESS: ${Object.keys(translations).length} languages translated`);

          // Deduct wallet — scaled by content length × target languages
          const speakingSeconds = Math.max(5, Math.ceil(text.length / 15));
          const langMultiplier = Math.max(1, targetLangs.size);
          const deductMinutes = (speakingSeconds * langMultiplier) / 60;
          await deductTranslationWallet(
            organizationId,
            Math.round(deductMinutes * 100) / 100,
            `Bot transcription translation: ${targetLangs.size} lang(s), ${text.length} chars`
          ).catch((err: any) => logger.warn('[LivekitBot] Wallet deduction failed', err));
        } else {
          logger.warn('[LivekitBot] Translation wallet empty — skipping translation');
        }
      }

      // Always include source language
      translations[sourceLang] = text;

      // Update DB row with translations (best-effort)
      try {
        const updated = await db('meeting_transcripts')
          .where({ meeting_id: meetingId, speaker_id: speakerId, spoken_at: timestamp })
          .update({ translations: JSON.stringify(translations) });
        logger.debug(`[DB] Translation update: meeting=${meetingId}, speaker=${speakerId}, rowsUpdated=${updated}`);
      } catch (dbErr) {
        logger.warn(`[DB] Translation update failed (non-critical): meeting=${meetingId}, error=${(dbErr as any)?.message}`);
      }

      // ── LAYER 6.2 — Socket broadcast occurs ──────────
      this.io.to(`meeting:${meetingId}`).emit('transcript:stored', {
        meetingId,
        speakerId,
        speakerName,
        originalText: text,
        sourceLang,
        translations,
        timestamp,
      });
      logger.info(`[Socket] Emitted transcript:stored to room meeting:${meetingId} (langs=${Object.keys(translations).join(',')})`);

      // Per-user routing with TTS availability
      if (langMap) {
        const allSockets = await this.io.in(`meeting:${meetingId}`).fetchSockets();
        let routed = 0;
        for (const [targetUserId, prefs] of langMap.entries()) {
          if (targetUserId === speakerId) continue;
          const targetSocket = allSockets.find(
            (s: any) => s.userId === targetUserId || s.data?.userId === targetUserId
          );
          if (targetSocket) {
            const ttsAvailable = isTtsSupported(prefs.language) && prefs.receiveVoice;
            targetSocket.emit('translation:result', {
              meetingId,
              speakerId,
              speakerName,
              originalText: text,
              sourceLang,
              translations,
              timestamp,
              ttsEnabled: ttsAvailable,
              ttsAvailable,
              userLang: prefs.language,
            });
            routed++;
          }
        }
        logger.info(`[Socket] Emitted translation:result to ${routed} user(s) in meeting ${meetingId}`);
      }

      logger.info(`[TRANSLATION_PIPELINE] Broadcast COMPLETE: meeting=${meetingId}, speaker=${speakerName}, langs=${Object.keys(translations).join(',')}`);
    } catch (err) {
      logger.error('[LivekitBot] translateAndBroadcast failed', err);

      // Fallback: broadcast original text only
      this.io.to(`meeting:${meetingId}`).emit('transcript:stored', {
        meetingId,
        speakerId,
        speakerName,
        originalText: text,
        sourceLang,
        translations: { [sourceLang]: text },
        timestamp,
      });
    }
  }
}
