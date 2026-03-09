// ============================================================
// OrgsLedger — LiveKit Bot (per-meeting)
// Connects to a LiveKit room as a hidden participant using
// @livekit/rtc-node (server-native SDK), subscribes to all
// audio tracks, and creates a RealtimeSession per speaker
// to stream audio to Deepgram for per-speaker transcription.
// ============================================================

import { AccessToken } from 'livekit-server-sdk';
import { config } from '../../config';
import { logger } from '../../logger';
import { meetingStateManager } from '../../meeting-pipeline';
import { meetingPipeline } from '../../meeting-pipeline';
import { deepgramRealtimeService } from '../deepgramRealtime.service';
import { normalizeLang } from '../../utils/langNormalize';

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
}

// ── Constants ────────────────────────────────────────────────

const BOT_IDENTITY = 'orgsledger-transcription-bot';
const BOT_NAME = 'OrgsLedger Transcriber';

// ── LiveKit Bot ──────────────────────────────────────────────

export class LivekitBot {
  // Room typed as `any` because @livekit/rtc-node is ESM-only
  // and loaded dynamically. Actual type: import('@livekit/rtc-node').Room
  private room: any = null;
  private sessions = new Map<string, { streamId: string; closed: boolean }>();
  // Keep AudioStream references alive to prevent GC while piping
  private audioStreams = new Map<string, any>();
  private closed = false;

  private readonly meetingId: string;
  private readonly organizationId: string;
  private readonly roomName: string;
  private readonly io: any;

  constructor(opts: LivekitBotOptions) {
    this.meetingId = opts.meetingId;
    this.organizationId = opts.organizationId;
    this.roomName = opts.roomName;
    this.io = opts.io;

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

    // Close all Deepgram streams
    for (const [speakerId, session] of this.sessions) {
      logger.info(`[Deepgram] Closing stream for ${speakerId}`);
      session.closed = true;
      await deepgramRealtimeService.closeStream(session.streamId);
    }
    logger.info(`[Deepgram] All streams closed (meeting=${this.meetingId})`);
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
    * Create a Deepgram stream for the speaker and pipe audio
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
    try {
      const prefs = await meetingStateManager.getParticipantPrefs(this.meetingId);
      const speakerPrefs = prefs.find((p) => p.userId === speakerId);
      if (speakerPrefs?.language) {
        sourceLang = speakerPrefs.language;
      }
    } catch (err) {
      logger.warn('[LivekitBot] Failed to read participant prefs for source language (non-critical)', err);
    }

    // Create Deepgram realtime stream (one per speaker)
    const streamId = `${this.meetingId}:${speakerId}`;
    const created = await deepgramRealtimeService.createStream(
      streamId,
      {
        meetingId: this.meetingId,
        speakerId,
        speakerName,
      },
      {
        onInterim: (segment) => {
          this.submitTranscriptToPipeline({
            speakerId,
            speakerName,
            text: segment.text,
            isFinal: false,
            language: normalizeLang(segment.language || sourceLang),
          }).catch(() => {});
        },
        onFinal: (segment) => {
          this.submitTranscriptToPipeline({
            speakerId,
            speakerName,
            text: segment.text,
            isFinal: true,
            language: normalizeLang(segment.language || sourceLang),
          }).catch(() => {});
        },
        onError: (err) => {
          logger.error(`[LivekitBot] Deepgram stream error: speaker=${speakerName}`, err);
        },
      }
    );

    if (!created) {
      logger.error(`[LivekitBot] Deepgram stream creation failed: speaker=${speakerName}`);
      return;
    }

    this.sessions.set(speakerId, { streamId, closed: false });
    logger.info(`[LivekitBot] Deepgram stream connected: speaker=${speakerName}`);

    // Create an AudioStream from the subscribed track
    // @livekit/rtc-node AudioStream is an async iterable of AudioFrame
    // Deepgram expects linear16; use 16kHz mono
    try {
      const audioStream = new rtc.AudioStream(track, 16000, 1);
      this.audioStreams.set(speakerId, audioStream);

      // Pipe audio frames in background (non-blocking)
      this.pipeAudioFrames(audioStream, streamId, speakerId, speakerName);
    } catch (err) {
      logger.error(`[LivekitBot] AudioStream creation failed: speaker=${speakerName}`, err);
    }
  }

  /**
    * Async iterator over AudioStream frames → push into Deepgram stream.
   * Runs until the stream or session ends.
   */
  private async pipeAudioFrames(
    audioStream: any,
    streamId: string,
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
        const session = this.sessions.get(speakerId);
        if (!session || session.closed || this.closed) break;
        frameCount++;

        // @livekit/rtc-node AudioFrame.data is Int16Array (PCM16 mono)
        if (frame.data instanceof Int16Array) {
          totalSamples += frame.data.length;
          if (frame.data.length === 0) zeroFrames++;
          const buf = Buffer.from(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength);
          deepgramRealtimeService.handleAudioChunk(streamId, buf).catch(() => {});
        } else if (frame.data instanceof Float32Array) {
          totalSamples += frame.data.length;
          if (frame.data.length === 0) zeroFrames++;
          // Float32 PCM not expected at 16k linear16; skip
        } else if (Buffer.isBuffer(frame.data)) {
          totalSamples += frame.data.length / 2; // PCM16 = 2 bytes/sample
          if (frame.data.length === 0) zeroFrames++;
          deepgramRealtimeService.handleAudioChunk(streamId, frame.data).catch(() => {});
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
      const session = this.sessions.get(speakerId);
      if (!this.closed && session && !session.closed) {
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
    if (!session) return;

    // ── Track unsubscribe closes Deepgram stream ─
    logger.info(`[Deepgram] Closing stream for ${speakerId}`);
    session.closed = true;
    deepgramRealtimeService.closeStream(session.streamId).catch(() => {});
    this.sessions.delete(speakerId);
    this.audioStreams.delete(speakerId);
    logger.info(`[Deepgram] Stream closed: speaker=${speakerId}, remainingSessions=${this.sessions.size}`);
  }

  // ── Meeting Pipeline Integration ───────────────────────

  private segmentCounters: Map<string, number> = new Map();
  private lastInterimAt: Map<string, number> = new Map();
  private readonly INTERIM_THROTTLE_MS = 250;

  private getNextSegmentIndex(meetingId: string): number {
    const current = this.segmentCounters.get(meetingId) || 0;
    const next = current + 1;
    this.segmentCounters.set(meetingId, next);
    return next;
  }

  private async submitTranscriptToPipeline(input: {
    speakerId: string;
    speakerName: string;
    text: string;
    isFinal: boolean;
    language: string;
  }): Promise<void> {
    const text = input.text?.trim();
    if (!text) return;

    // Throttle interim updates to reduce queue pressure
    if (!input.isFinal) {
      const last = this.lastInterimAt.get(input.speakerId) || 0;
      const now = Date.now();
      if (now - last < this.INTERIM_THROTTLE_MS) return;
      this.lastInterimAt.set(input.speakerId, now);
    }

    const segmentIndex = input.isFinal ? this.getNextSegmentIndex(this.meetingId) : -1;

    await meetingPipeline.submitTranscript({
      meetingId: this.meetingId,
      organizationId: this.organizationId,
      segmentIndex,
      text,
      speakerId: input.speakerId,
      speakerName: input.speakerName,
      timestamp: new Date().toISOString(),
      isFinal: input.isFinal,
      language: normalizeLang(input.language),
    });
  }
}
