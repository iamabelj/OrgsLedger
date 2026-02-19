"use strict";
// ============================================================
// OrgsLedger — LiveKit Bot (per-meeting)
// Connects to a LiveKit room as a hidden participant using
// @livekit/rtc-node (server-native SDK), subscribes to all
// audio tracks, and creates a RealtimeSession per speaker
// to stream audio to OpenAI for per-speaker transcription.
// ============================================================
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LivekitBot = void 0;
const livekit_server_sdk_1 = require("livekit-server-sdk");
const config_1 = require("../../config");
const logger_1 = require("../../logger");
const db_1 = __importDefault(require("../../db"));
const realtimeSession_1 = require("./realtimeSession");
const translation_service_1 = require("../translation.service");
const subscription_service_1 = require("../subscription.service");
// @livekit/rtc-node is ESM-only — dynamic import cached at runtime
let lkRtc = null;
async function getLkRtc() {
    if (!lkRtc) {
        lkRtc = await Promise.resolve().then(() => __importStar(require('@livekit/rtc-node')));
    }
    return lkRtc;
}
// ── Constants ────────────────────────────────────────────────
const BOT_IDENTITY = 'orgsledger-transcription-bot';
const BOT_NAME = 'OrgsLedger Transcriber';
// ── LiveKit Bot ──────────────────────────────────────────────
class LivekitBot {
    // Room typed as `any` because @livekit/rtc-node is ESM-only
    // and loaded dynamically. Actual type: import('@livekit/rtc-node').Room
    room = null;
    sessions = new Map();
    // Keep AudioStream references alive to prevent GC while piping
    audioStreams = new Map();
    closed = false;
    meetingId;
    organizationId;
    roomName;
    io;
    meetingLanguages;
    constructor(opts) {
        this.meetingId = opts.meetingId;
        this.organizationId = opts.organizationId;
        this.roomName = opts.roomName;
        this.io = opts.io;
        this.meetingLanguages = opts.meetingLanguages;
        logger_1.logger.info(`[LivekitBot] Created for meeting=${this.meetingId}, room=${this.roomName}`);
    }
    // ── Public API ──────────────────────────────────────────
    /** Connect to the LiveKit room and start subscribing to audio tracks. */
    async connect() {
        if (this.closed)
            return;
        const { url, apiKey, apiSecret } = config_1.config.livekit;
        // ── LAYER 1.1 — Config validation ─────────────────
        if (!url) {
            logger_1.logger.error('[Bot] LIVEKIT_URL not configured — cannot connect');
            throw new Error('LIVEKIT_URL not configured');
        }
        if (!apiKey || !apiSecret) {
            logger_1.logger.error('[Bot] LIVEKIT_API_KEY / LIVEKIT_API_SECRET not configured');
            throw new Error('LIVEKIT_API_KEY / LIVEKIT_API_SECRET not configured');
        }
        logger_1.logger.info(`[Bot] Connecting to room: ${this.roomName} (meeting=${this.meetingId})`);
        logger_1.logger.info(`[Bot] LiveKit URL=${url}, apiKey=${apiKey.slice(0, 6)}..., identity=${BOT_IDENTITY}`);
        // Generate a bot access token — subscribe-only, hidden
        const token = new livekit_server_sdk_1.AccessToken(apiKey, apiSecret, {
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
        logger_1.logger.debug(`[Bot] Token generated: room=${this.roomName}, grants=[roomJoin, canSubscribe, hidden]`);
        // Dynamic import of the ESM-only rtc-node SDK
        const rtc = await getLkRtc();
        // Create and connect the Room
        this.room = new rtc.Room();
        this.setupEventHandlers(rtc);
        const connectStart = Date.now();
        await this.room.connect(url, jwt, { autoSubscribe: true });
        const connectMs = Date.now() - connectStart;
        logger_1.logger.info(`[Bot] Connected successfully in ${connectMs}ms: room=${this.roomName}, participants=${this.room.remoteParticipants.size}`);
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
            logger_1.logger.info(`[Bot] Processed ${existingAudioTracks} existing audio track(s) in room`);
        }
    }
    /** Disconnect from the room and close all sessions. */
    async disconnect() {
        if (this.closed)
            return;
        this.closed = true;
        // ── LAYER 7.2 — Meeting end closes everything ─────
        logger_1.logger.info(`[Bot] Stopping bot for meeting ${this.meetingId} (activeSessions=${this.sessions.size}, audioStreams=${this.audioStreams.size})`);
        // Close all RealtimeSession instances
        for (const [speakerId, session] of this.sessions) {
            logger_1.logger.info(`[Realtime] Closing session for ${speakerId}`);
            session.close();
        }
        logger_1.logger.info(`[Realtime] All sessions closed (meeting=${this.meetingId})`);
        this.sessions.clear();
        this.audioStreams.clear();
        // Disconnect from LiveKit
        if (this.room) {
            await this.room.disconnect();
            this.room = null;
        }
        logger_1.logger.info(`[Bot] Room disconnected: meeting=${this.meetingId}, no WebSocket connections remain`);
    }
    get activeSessionCount() {
        return this.sessions.size;
    }
    get isClosed() {
        return this.closed;
    }
    // ── Event Handlers ──────────────────────────────────────
    setupEventHandlers(rtc) {
        if (!this.room)
            return;
        // Track subscribed → create transcription session
        this.room.on(rtc.RoomEvent.TrackSubscribed, (track, publication, participant) => {
            this.onTrackSubscribed(rtc, track, publication, participant).catch((err) => {
                logger_1.logger.error(`[LivekitBot] onTrackSubscribed error`, err);
            });
        });
        // Track unsubscribed → close session
        this.room.on(rtc.RoomEvent.TrackUnsubscribed, (_track, publication, participant) => {
            if (publication.kind !== rtc.TrackKind.KIND_AUDIO)
                return;
            const speakerId = participant.identity;
            logger_1.logger.info(`[LivekitBot] Track unsubscribed: speaker=${participant.name || speakerId}`);
            this.closeSession(speakerId);
        });
        // Participant disconnected → close session
        this.room.on(rtc.RoomEvent.ParticipantDisconnected, (participant) => {
            const speakerId = participant.identity;
            logger_1.logger.info(`[LivekitBot] Participant disconnected: speaker=${participant.name || speakerId}`);
            this.closeSession(speakerId);
        });
        // Room disconnected
        this.room.on(rtc.RoomEvent.Disconnected, (reason) => {
            logger_1.logger.warn(`[LivekitBot] Room disconnected: meeting=${this.meetingId}, reason=${reason}`);
            if (!this.closed) {
                this.disconnect().catch(() => { });
            }
        });
    }
    /**
     * Create a RealtimeSession for the speaker and pipe audio
     * from the LiveKit AudioStream into it.
     */
    async onTrackSubscribed(rtc, track, publication, participant) {
        // Only audio tracks
        if (publication.kind !== rtc.TrackKind.KIND_AUDIO)
            return;
        const speakerId = participant.identity;
        const speakerName = participant.name || participant.identity;
        // Skip duplicate sessions
        if (this.sessions.has(speakerId)) {
            logger_1.logger.debug(`[Bot] Session already exists: speaker=${speakerName}`);
            return;
        }
        // Skip bot's own tracks
        if (speakerId === BOT_IDENTITY)
            return;
        // ── LAYER 1.2 — Track subscription confirmation ───
        logger_1.logger.info(`[Bot] Subscribed to audio track from ${speakerId} (name=${speakerName}, trackSid=${track?.sid || 'unknown'})`);
        // Determine source language from metadata or in-memory map
        let sourceLang = 'en';
        try {
            const meta = participant.metadata ? JSON.parse(participant.metadata) : {};
            if (meta.language)
                sourceLang = meta.language;
        }
        catch (_) { /* default */ }
        const langMap = this.meetingLanguages?.get(this.meetingId);
        if (langMap?.has(speakerId)) {
            sourceLang = langMap.get(speakerId).language;
        }
        // Create the RealtimeSession (one per speaker)
        const session = new realtimeSession_1.RealtimeSession({
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
            logger_1.logger.info(`[LivekitBot] RealtimeSession connected: speaker=${speakerName}`);
        }
        catch (err) {
            logger_1.logger.error(`[LivekitBot] RealtimeSession connect failed: speaker=${speakerName}`, err);
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
        }
        catch (err) {
            logger_1.logger.error(`[LivekitBot] AudioStream creation failed: speaker=${speakerName}`, err);
        }
    }
    /**
     * Async iterator over AudioStream frames → push into RealtimeSession.
     * Runs until the stream or session ends.
     */
    async pipeAudioFrames(audioStream, session, speakerId, speakerName) {
        // ── LAYER 2.1 — Audio frame flow tracking ─────────
        let frameCount = 0;
        let totalSamples = 0;
        let zeroFrames = 0;
        const pipeStart = Date.now();
        const LOG_INTERVAL = 500; // Log summary every 500 frames
        try {
            for await (const frame of audioStream) {
                if (session.isClosed || this.closed)
                    break;
                frameCount++;
                // @livekit/rtc-node AudioFrame.data is Int16Array (PCM16 mono)
                if (frame.data instanceof Int16Array) {
                    totalSamples += frame.data.length;
                    if (frame.data.length === 0)
                        zeroFrames++;
                    const buf = Buffer.from(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength);
                    session.pushAudio(buf);
                }
                else if (frame.data instanceof Float32Array) {
                    totalSamples += frame.data.length;
                    if (frame.data.length === 0)
                        zeroFrames++;
                    session.pushAudio(frame.data);
                }
                else if (Buffer.isBuffer(frame.data)) {
                    totalSamples += frame.data.length / 2; // PCM16 = 2 bytes/sample
                    if (frame.data.length === 0)
                        zeroFrames++;
                    session.pushAudio(frame.data);
                }
                // ── LAYER 2.1 — Periodic audio flow summary ───
                if (frameCount === 1) {
                    logger_1.logger.info(`[Audio] First frame received from ${speakerId}, samples: ${frame.data?.length || 0}, type: ${frame.data?.constructor?.name || 'unknown'}`);
                }
                if (frameCount % LOG_INTERVAL === 0) {
                    const elapsedSec = ((Date.now() - pipeStart) / 1000).toFixed(1);
                    logger_1.logger.info(`[Audio] Pipeline stats for ${speakerId}: frames=${frameCount}, totalSamples=${totalSamples}, zeroFrames=${zeroFrames}, elapsed=${elapsedSec}s`);
                }
            }
        }
        catch (err) {
            if (!this.closed && !session.isClosed) {
                logger_1.logger.warn(`[Audio] AudioStream ended: speaker=${speakerName}: ${err.message}`);
            }
        }
        finally {
            const totalSec = ((Date.now() - pipeStart) / 1000).toFixed(1);
            logger_1.logger.info(`[Audio] Pipeline ended for ${speakerId}: totalFrames=${frameCount}, totalSamples=${totalSamples}, zeroFrames=${zeroFrames}, duration=${totalSec}s`);
            this.audioStreams.delete(speakerId);
        }
    }
    /** Close and remove a session for a specific speaker. */
    closeSession(speakerId) {
        const session = this.sessions.get(speakerId);
        if (session) {
            // ── LAYER 7.1 — Track unsubscribe closes session ─
            logger_1.logger.info(`[Realtime] Closing session for ${speakerId}`);
            session.close();
            this.sessions.delete(speakerId);
            this.audioStreams.delete(speakerId);
            logger_1.logger.info(`[Realtime] Session closed: speaker=${speakerId}, remainingSessions=${this.sessions.size}`);
        }
    }
    // ── Translation & Broadcast ─────────────────────────────
    /**
     * After a transcript is persisted by the RealtimeSession,
     * translate to all target languages and broadcast via Socket.IO.
     * Mirrors the translation:speech handler in socket.ts.
     */
    async translateAndBroadcast(transcript) {
        const { meetingId, organizationId, speakerId, speakerName, text, sourceLang, timestamp } = transcript;
        // ── LAYER 6.1 — Translation trigger fires ─────────
        logger_1.logger.info(`[Translation] Translating transcript for meeting ${meetingId}: speaker=${speakerName}, textLen=${text.length}, sourceLang=${sourceLang}`);
        try {
            const langMap = this.meetingLanguages?.get(meetingId);
            const targetLangs = new Set();
            if (langMap) {
                langMap.forEach((val) => {
                    if (val.language !== sourceLang) {
                        targetLangs.add(val.language);
                    }
                });
            }
            let translations = {};
            if (targetLangs.size > 0 && organizationId) {
                const wallet = await (0, subscription_service_1.getTranslationWallet)(organizationId);
                const balance = parseFloat(wallet.balance_minutes);
                logger_1.logger.info(`[TRANSLATION_PIPELINE] Wallet check: org=${organizationId}, balance=${balance.toFixed(2)} min, targetLangs=${[...targetLangs].join(',')}`);
                if (balance > 0) {
                    translations = await (0, translation_service_1.translateToMultiple)(text, [...targetLangs], sourceLang);
                    logger_1.logger.info(`[TRANSLATION_PIPELINE] Translation SUCCESS: ${Object.keys(translations).length} languages translated`);
                    // Deduct wallet — scaled by content length × target languages
                    const speakingSeconds = Math.max(5, Math.ceil(text.length / 15));
                    const langMultiplier = Math.max(1, targetLangs.size);
                    const deductMinutes = (speakingSeconds * langMultiplier) / 60;
                    await (0, subscription_service_1.deductTranslationWallet)(organizationId, Math.round(deductMinutes * 100) / 100, `Bot transcription translation: ${targetLangs.size} lang(s), ${text.length} chars`).catch((err) => logger_1.logger.warn('[LivekitBot] Wallet deduction failed', err));
                }
                else {
                    logger_1.logger.warn('[LivekitBot] Translation wallet empty — skipping translation');
                }
            }
            // Always include source language
            translations[sourceLang] = text;
            // Update DB row with translations (best-effort)
            try {
                const updated = await (0, db_1.default)('meeting_transcripts')
                    .where({ meeting_id: meetingId, speaker_id: speakerId, spoken_at: timestamp })
                    .update({ translations: JSON.stringify(translations) });
                logger_1.logger.debug(`[DB] Translation update: meeting=${meetingId}, speaker=${speakerId}, rowsUpdated=${updated}`);
            }
            catch (dbErr) {
                logger_1.logger.warn(`[DB] Translation update failed (non-critical): meeting=${meetingId}, error=${dbErr?.message}`);
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
            logger_1.logger.info(`[Socket] Emitted transcript:stored to room meeting:${meetingId} (langs=${Object.keys(translations).join(',')})`);
            // Per-user routing with TTS availability
            if (langMap) {
                const allSockets = await this.io.in(`meeting:${meetingId}`).fetchSockets();
                let routed = 0;
                for (const [targetUserId, prefs] of langMap.entries()) {
                    if (targetUserId === speakerId)
                        continue;
                    const targetSocket = allSockets.find((s) => s.userId === targetUserId || s.data?.userId === targetUserId);
                    if (targetSocket) {
                        const ttsAvailable = (0, translation_service_1.isTtsSupported)(prefs.language) && prefs.receiveVoice;
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
                logger_1.logger.info(`[Socket] Emitted translation:result to ${routed} user(s) in meeting ${meetingId}`);
            }
            logger_1.logger.info(`[TRANSLATION_PIPELINE] Broadcast COMPLETE: meeting=${meetingId}, speaker=${speakerName}, langs=${Object.keys(translations).join(',')}`);
        }
        catch (err) {
            logger_1.logger.error('[LivekitBot] translateAndBroadcast failed', err);
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
exports.LivekitBot = LivekitBot;
//# sourceMappingURL=livekitBot.js.map