"use strict";
// ============================================================
// OrgsLedger API — Socket.io Real-Time Layer
// Chat, Meetings, Notifications, Financial Updates
// ============================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.meetingLanguages = void 0;
exports.setupSocketIO = setupSocketIO;
exports.forceDisconnectMeeting = forceDisconnectMeeting;
exports.emitFinancialUpdate = emitFinancialUpdate;
const socket_io_1 = require("socket.io");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const config_1 = require("./config");
const db_1 = __importDefault(require("./db"));
const logger_1 = require("./logger");
const translation_service_1 = require("./services/translation.service");
const subscription_service_1 = require("./services/subscription.service");
const audit_1 = require("./middleware/audit");
const whisper_service_1 = require("./services/whisper.service");
// In-memory store for meeting translation sessions
// meetingId -> Map<userId, { language, name, receiveVoice }>
exports.meetingLanguages = new Map();
// Cache whether meeting_transcripts table exists (checked once on first insert)
let transcriptTableExists = null;
// Cache whether user_language_preferences table exists
let langPrefsTableExists = null;
// Per-user rate limiter for translation:speech events (max 2 per second)
const speechRateLimits = new Map();
const SPEECH_RATE_LIMIT_MS = 500; // Min interval between final speech events
const activeAudioStreams = new Map();
// ── Helper: Persist transcript segment to DB ────────────
// Stores transcript. Requires valid organizationId (NOT NULL in schema).
async function this_persistTranscript(meetingId, organizationId, speakerId, speakerName, originalText, sourceLang, translations) {
    try {
        // Check table existence once and cache result
        if (transcriptTableExists === null) {
            transcriptTableExists = await db_1.default.schema.hasTable('meeting_transcripts');
            logger_1.logger.info(`[TRANSLATION] meeting_transcripts table exists: ${transcriptTableExists}`);
        }
        if (!transcriptTableExists) {
            logger_1.logger.error('[TRANSLATION] ❌ meeting_transcripts table does not exist — transcripts will NOT be saved! Run migrations or restart server.');
            return;
        }
        // Guard: organization_id is NOT NULL in the schema
        if (!organizationId) {
            logger_1.logger.error('[TRANSLATION] ❌ Cannot persist transcript — organization_id is null', { meetingId, speakerName });
            return;
        }
        await (0, db_1.default)('meeting_transcripts').insert({
            meeting_id: meetingId,
            organization_id: organizationId,
            speaker_id: speakerId,
            speaker_name: speakerName,
            original_text: originalText,
            source_lang: sourceLang,
            translations: JSON.stringify(translations),
            spoken_at: Date.now(),
        });
        logger_1.logger.info(`[TRANSCRIPT] ✓ Persisted: meeting=${meetingId}, speaker=${speakerName}, lang=${sourceLang}, textLen=${originalText.length}`);
    }
    catch (dbErr) {
        logger_1.logger.error(`[TRANSLATION] ❌ Failed to persist transcript: ${dbErr.message}`, { meetingId, speakerName, organizationId });
    }
}
// ── Helper: Process speech text (translate, persist, broadcast) ──
// Shared by both translation:speech (text from client) and STT (text from Google)
async function handleSpeechText(io, socket, userId, meetingId, text, sourceLang, isFinal) {
    if (!meetingId || !text?.trim())
        return;
    // Rate limit final speech events per user (prevent flooding)
    if (isFinal) {
        const rateLimitKey = `${userId}:${meetingId}`;
        const lastTime = speechRateLimits.get(rateLimitKey) || 0;
        const now = Date.now();
        if (now - lastTime < SPEECH_RATE_LIMIT_MS) {
            logger_1.logger.debug(`[TRANSLATION] Rate limited speech from ${userId} (${now - lastTime}ms since last)`);
            return;
        }
        speechRateLimits.set(rateLimitKey, now);
    }
    const langMap = exports.meetingLanguages.get(meetingId);
    // Get speaker name
    let speakerName = 'Unknown';
    const speaker = langMap?.get(userId);
    if (speaker?.name) {
        speakerName = speaker.name;
    }
    else {
        try {
            const user = await (0, db_1.default)('users').where({ id: userId }).select('first_name', 'last_name').first();
            if (user)
                speakerName = `${user.first_name} ${user.last_name}`.trim();
        }
        catch (_) { /* non-critical */ }
    }
    logger_1.logger.debug(`[TRANSCRIPT] Speech: speaker=${speakerName}, isFinal=${isFinal}, lang=${sourceLang}, len=${text.length}`);
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
    const targetLangs = new Set();
    if (langMap) {
        langMap.forEach((val) => {
            if (val.language !== sourceLang) {
                targetLangs.add(val.language);
            }
        });
    }
    // Look up organization_id
    let organizationId = null;
    try {
        const meeting = await (0, db_1.default)('meetings').where({ id: meetingId }).select('organization_id').first();
        organizationId = meeting?.organization_id || null;
    }
    catch (lookupErr) {
        logger_1.logger.warn('[TRANSLATION] Failed to look up meeting org', lookupErr);
    }
    try {
        let translations = {};
        if (targetLangs.size > 0) {
            logger_1.logger.debug(`[TRANSLATION] Translating to ${targetLangs.size} languages: ${[...targetLangs].join(', ')}`);
            if (organizationId) {
                const wallet = await (0, subscription_service_1.getTranslationWallet)(organizationId);
                const balance = parseFloat(wallet.balance_minutes);
                if (balance <= 0) {
                    socket.emit('translation:error', {
                        meetingId,
                        error: 'Translation wallet empty. Please top up to continue translations.',
                        code: 'WALLET_EMPTY',
                    });
                    await this_persistTranscript(meetingId, organizationId, userId, speakerName, text, sourceLang, {});
                    logger_1.logger.info(`[TRANSCRIPT] ✓ Stored (wallet empty): meeting=${meetingId}, speaker=${speakerName}`);
                    io.to(`meeting:${meetingId}`).emit('transcript:stored', {
                        meetingId, speakerId: userId, speakerName, originalText: text,
                        sourceLang, translations: {}, timestamp: Date.now(),
                    });
                    return;
                }
                translations = await (0, translation_service_1.translateToMultiple)(text, [...targetLangs], sourceLang);
                logger_1.logger.debug(`[TRANSLATION] Translation complete: ${Object.keys(translations).length} languages`);
                const speakingSeconds = Math.max(5, Math.ceil(text.length / 15));
                const langMultiplier = Math.max(1, targetLangs.size);
                const deductMinutes = (speakingSeconds * langMultiplier) / 60;
                const deduction = await (0, subscription_service_1.deductTranslationWallet)(organizationId, Math.round(deductMinutes * 100) / 100, `Live translation: ${targetLangs.size} language(s), ${text.length} chars in meeting`);
                if (!deduction.success) {
                    logger_1.logger.warn('[TRANSLATION] Wallet deduction failed but translation was served', {
                        meetingId, orgId: organizationId,
                    });
                }
            }
            else {
                translations = await (0, translation_service_1.translateToMultiple)(text, [...targetLangs], sourceLang);
                logger_1.logger.warn('[TRANSLATION] No organization_id found for meeting, skipping wallet deduction', { meetingId });
            }
        }
        // Always include the original language
        translations[sourceLang] = text;
        // Persist transcript
        await this_persistTranscript(meetingId, organizationId, userId, speakerName, text, sourceLang, translations);
        logger_1.logger.info(`[TRANSCRIPT] ✓ Stored: meeting=${meetingId}, speaker=${speakerName}, translations=${Object.keys(translations).length}`);
        const now = Date.now();
        // Emit transcript:stored for real-time transcript tab
        io.to(`meeting:${meetingId}`).emit('transcript:stored', {
            meetingId, speakerId: userId, speakerName, originalText: text,
            sourceLang, translations, timestamp: now,
        });
        // Per-user routing — emit translated text immediately
        const langMapForEmit = exports.meetingLanguages.get(meetingId);
        const ttsTargets = [];
        if (langMapForEmit) {
            const allSockets = await io.in(`meeting:${meetingId}`).fetchSockets();
            for (const [targetUserId, prefs] of langMapForEmit.entries()) {
                if (targetUserId === userId)
                    continue;
                const targetSocket = allSockets.find((s) => s.data?.userId === targetUserId);
                if (targetSocket) {
                    const wantsTts = (0, translation_service_1.isTtsSupported)(prefs.language) && prefs.receiveVoice;
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
                    logger_1.logger.debug(`[TRANSLATION] Emitted to user ${targetUserId} (lang=${prefs.language}, tts=${wantsTts})`);
                    if (wantsTts) {
                        ttsTargets.push({ userId: targetUserId, language: prefs.language });
                    }
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
            const ttsGroups = new Map(); // language → userId[]
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
                        if (!ttsText.trim())
                            continue;
                        try {
                            const audioBuffer = await (0, whisper_service_1.generateTTSAudio)(ttsText);
                            const audioBase64 = audioBuffer.toString('base64');
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
                                }
                            }
                            logger_1.logger.debug(`[TTS] Sent audio for lang=${lang} to ${userIds.length} user(s)`);
                        }
                        catch (ttsErr) {
                            logger_1.logger.warn(`[TTS] Failed to generate for lang=${lang}: ${ttsErr.message}`);
                        }
                    }
                }
                catch (outerErr) {
                    logger_1.logger.error('[TTS] Async TTS generation failed:', outerErr);
                }
            })();
        }
    }
    catch (err) {
        logger_1.logger.error('[TRANSCRIPT] Translation pipeline failed', err);
        await this_persistTranscript(meetingId, organizationId, userId, speakerName, text, sourceLang, { [sourceLang]: text });
        logger_1.logger.info(`[TRANSCRIPT] ✓ Stored (error fallback): meeting=${meetingId}, speaker=${speakerName}`);
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
function setupSocketIO(httpServer) {
    const allowedOrigins = config_1.config.env === 'production'
        ? ['https://app.orgsledger.com', 'https://orgsledger.com']
        : '*';
    const io = new socket_io_1.Server(httpServer, {
        cors: {
            origin: allowedOrigins,
            methods: ['GET', 'POST'],
        },
        pingTimeout: 60000,
        pingInterval: 25000,
        maxHttpBufferSize: 10e6, // 10MB for file sharing
    });
    // ── Authentication Middleware ────────────────────────────
    io.use(async (socket, next) => {
        try {
            const token = socket.handshake.auth.token ||
                socket.handshake.headers.authorization?.split(' ')[1];
            if (!token) {
                return next(new Error('Authentication required'));
            }
            const payload = jsonwebtoken_1.default.verify(token, config_1.config.jwt.secret);
            const user = await (0, db_1.default)('users')
                .where({ id: payload.userId, is_active: true })
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
        }
        catch (err) {
            next(new Error('Invalid token'));
        }
    });
    // ── Connection Handler ──────────────────────────────────
    io.on('connection', async (socket) => {
        const userId = socket.userId;
        logger_1.logger.debug(`Socket connected: ${userId}`);
        // Join user's personal room
        socket.join(`user:${userId}`);
        // Join all organization rooms the user belongs to
        try {
            const memberships = await (0, db_1.default)('memberships')
                .where({ user_id: userId, is_active: true })
                .select('organization_id');
            for (const m of memberships) {
                socket.join(`org:${m.organization_id}`);
            }
            // Join all channels the user is a member of
            const channelMemberships = await (0, db_1.default)('channel_members')
                .join('channels', 'channel_members.channel_id', 'channels.id')
                .where({ 'channel_members.user_id': userId })
                .select('channels.id');
            for (const cm of channelMemberships) {
                socket.join(`channel:${cm.id}`);
            }
        }
        catch (err) {
            logger_1.logger.error('Error joining rooms', err);
        }
        // ── Channel Events ──────────────────────────────────
        socket.on('channel:join', async (channelId) => {
            try {
                // Verify user is a member of this channel (or it's a general/announcement channel in an org they belong to)
                const channel = await (0, db_1.default)('channels').where({ id: channelId }).first();
                if (!channel)
                    return;
                const membership = await (0, db_1.default)('memberships')
                    .where({ user_id: userId, organization_id: channel.organization_id, is_active: true })
                    .first();
                if (!membership) {
                    socket.emit('error', { message: 'Not a member of this organization' });
                    return;
                }
                // For non-general/announcement channels, verify channel membership
                if (!['general', 'announcement'].includes(channel.type)) {
                    const channelMember = await (0, db_1.default)('channel_members')
                        .where({ channel_id: channelId, user_id: userId })
                        .first();
                    if (!channelMember) {
                        socket.emit('error', { message: 'Not a member of this channel' });
                        return;
                    }
                }
                socket.join(`channel:${channelId}`);
            }
            catch (err) {
                logger_1.logger.error('channel:join authorization error', err);
            }
        });
        socket.on('channel:leave', (channelId) => {
            socket.leave(`channel:${channelId}`);
        });
        socket.on('channel:typing', (data) => {
            socket.to(`channel:${data.channelId}`).emit('channel:typing', {
                userId,
                channelId: data.channelId,
            });
        });
        socket.on('channel:stop-typing', (data) => {
            socket.to(`channel:${data.channelId}`).emit('channel:stop-typing', {
                userId,
                channelId: data.channelId,
            });
        });
        socket.on('channel:read', (data) => {
            // Update last_read_at in DB and broadcast to channel
            (0, db_1.default)('channel_members')
                .where({ channel_id: data.channelId, user_id: userId })
                .update({ last_read_at: db_1.default.fn.now() })
                .catch((err) => logger_1.logger.error('Failed to update read timestamp', err));
            socket.to(`channel:${data.channelId}`).emit('channel:read', {
                userId,
                channelId: data.channelId,
                readAt: new Date().toISOString(),
            });
        });
        // ── Meeting Events ──────────────────────────────────
        socket.on('meeting:join', async (meetingId) => {
            try {
                // Verify user is a member of the meeting's organization
                const meeting = await (0, db_1.default)('meetings').where({ id: meetingId }).select('organization_id', 'status').first();
                if (!meeting) {
                    socket.emit('error', { message: 'Meeting not found' });
                    return;
                }
                // Prevent joining ended meetings
                if (meeting.status === 'ended') {
                    socket.emit('meeting:join-rejected', { meetingId, reason: 'Meeting has ended' });
                    return;
                }
                const membership = await (0, db_1.default)('memberships')
                    .where({ user_id: userId, organization_id: meeting.organization_id, is_active: true })
                    .first();
                if (!membership) {
                    socket.emit('error', { message: 'Not a member of this organization' });
                    return;
                }
                // Get user name for participant payload
                const user = await (0, db_1.default)('users').where({ id: userId }).select('first_name', 'last_name').first();
                const name = user ? `${user.first_name} ${user.last_name}`.trim() : 'Unknown';
                const isModerator = ['org_admin', 'executive'].includes(membership.role);
                socket.join(`meeting:${meetingId}`);
                // Store meeting association on socket for cleanup
                socket._meetingId = meetingId;
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
                        langPrefsTableExists = await db_1.default.schema.hasTable('user_language_preferences');
                    }
                    if (langPrefsTableExists) {
                        const pref = await (0, db_1.default)('user_language_preferences')
                            .where({ user_id: userId, organization_id: meeting.organization_id })
                            .first();
                        if (pref?.preferred_language) {
                            // Set in memory map so translation routing works immediately
                            if (!exports.meetingLanguages.has(meetingId)) {
                                exports.meetingLanguages.set(meetingId, new Map());
                            }
                            exports.meetingLanguages.get(meetingId).set(userId, {
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
                            const participants = [];
                            exports.meetingLanguages.get(meetingId).forEach((val, uid) => {
                                participants.push({ userId: uid, name: val.name, language: val.language });
                            });
                            io.to(`meeting:${meetingId}`).emit('translation:participants', { meetingId, participants });
                            logger_1.logger.debug(`[TRANSLATION] Auto-loaded language ${pref.preferred_language} for user ${userId} in meeting ${meetingId}`);
                        }
                    }
                }
                catch (prefErr) {
                    logger_1.logger.warn('[TRANSLATION] Failed to auto-load language preference', prefErr);
                }
                logger_1.logger.debug(`User ${userId} (${name}) joined meeting ${meetingId}`);
            }
            catch (err) {
                logger_1.logger.error('meeting:join authorization error', err);
            }
        });
        // ── Raise Hand ──────────────────────────────────────
        socket.on('meeting:raise-hand', (data) => {
            if (!data.meetingId)
                return;
            socket.to(`meeting:${data.meetingId}`).emit('meeting:hand-raised', {
                userId: data.userId,
                name: data.name,
                raised: data.raised,
            });
        });
        // ── Moderator Controls ──────────────────────────────
        socket.on('meeting:recording-started', (data) => {
            if (!data.meetingId)
                return;
            io.to(`meeting:${data.meetingId}`).emit('meeting:recording-started', {
                meetingId: data.meetingId,
                startedBy: userId,
            });
        });
        socket.on('meeting:recording-stopped', (data) => {
            if (!data.meetingId)
                return;
            io.to(`meeting:${data.meetingId}`).emit('meeting:recording-stopped', {
                meetingId: data.meetingId,
                stoppedBy: userId,
            });
        });
        socket.on('meeting:lock', (data) => {
            if (!data.meetingId)
                return;
            io.to(`meeting:${data.meetingId}`).emit('meeting:lock-changed', {
                meetingId: data.meetingId,
                locked: data.locked,
                changedBy: userId,
            });
        });
        // ── Audio Streaming for AI ──────────────────────────
        socket.on('meeting:audio-chunk', (data) => {
            // Forward audio chunks for real-time processing
            socket.to(`meeting:${data.meetingId}`).emit('meeting:audio-chunk', {
                userId,
                chunk: data.chunk,
            });
        });
        // ── Live Translation System ─────────────────────────
        // User sets their preferred language for a meeting
        socket.on('translation:set-language', async (data) => {
            const { meetingId, language, receiveVoice = true } = data;
            if (!meetingId || !language)
                return;
            logger_1.logger.debug(`[TRANSLATION] User ${userId} setting language to ${language} for meeting ${meetingId} (receiveVoice: ${receiveVoice})`);
            // Get user's name
            const user = await (0, db_1.default)('users').where({ id: userId }).select('first_name', 'last_name').first();
            const name = user ? `${user.first_name} ${user.last_name}` : 'Unknown';
            // Store in memory (per-user preference including voice toggle)
            if (!exports.meetingLanguages.has(meetingId)) {
                exports.meetingLanguages.set(meetingId, new Map());
            }
            exports.meetingLanguages.get(meetingId).set(userId, { language, name, receiveVoice });
            // Persist to DB for future meetings
            try {
                const meeting = await (0, db_1.default)('meetings').where({ id: meetingId }).select('organization_id').first();
                if (meeting?.organization_id) {
                    const hasTable = langPrefsTableExists !== null ? langPrefsTableExists : await db_1.default.schema.hasTable('user_language_preferences');
                    if (langPrefsTableExists === null)
                        langPrefsTableExists = hasTable;
                    if (hasTable) {
                        await (0, db_1.default)('user_language_preferences')
                            .insert({
                            user_id: userId,
                            organization_id: meeting.organization_id,
                            preferred_language: language,
                            receive_voice: receiveVoice,
                            receive_text: true,
                        })
                            .onConflict(['user_id', 'organization_id'])
                            .merge({ preferred_language: language, receive_voice: receiveVoice });
                        logger_1.logger.debug(`[TRANSLATION] Persisted language preference for user ${userId}: ${language}`);
                    }
                }
            }
            catch (prefErr) {
                logger_1.logger.warn('[TRANSLATION] Failed to persist user language preference', prefErr);
            }
            // Broadcast updated participant languages to everyone in the meeting
            const participants = [];
            exports.meetingLanguages.get(meetingId).forEach((val, uid) => {
                participants.push({ userId: uid, name: val.name, language: val.language });
            });
            io.to(`meeting:${meetingId}`).emit('translation:participants', {
                meetingId,
                participants,
            });
            logger_1.logger.debug(`User ${userId} set translation language to ${language} for meeting ${meetingId}`);
            // Audit log for translation session start
            const meetingForAudit = await (0, db_1.default)('meetings').where({ id: meetingId }).select('organization_id').first();
            if (meetingForAudit?.organization_id) {
                (0, audit_1.writeAuditLog)({
                    organizationId: meetingForAudit.organization_id,
                    userId,
                    action: 'translation_session_start',
                    entityType: 'meeting',
                    entityId: meetingId,
                    newValue: { language, participantCount: participants.length },
                }).catch(err => logger_1.logger.warn('Audit log failed (translation session)', err));
            }
        });
        // User sends spoken text for translation
        socket.on('translation:speech', async (data) => {
            const { meetingId, text, sourceLang, isFinal } = data;
            await handleSpeechText(io, socket, userId, meetingId, text, sourceLang, isFinal);
        });
        // ── Server-Side Speech-to-Text (OpenAI Whisper) ──────────
        // Client records 4-second audio segments → sends complete webm files
        // Server transcribes via Whisper (excellent multilingual accuracy)
        socket.on('audio:start', async (data) => {
            const { meetingId, language } = data;
            if (!meetingId)
                return;
            // Pre-flight: check if Whisper (OpenAI key) is available
            if (!(0, whisper_service_1.isWhisperAvailable)()) {
                logger_1.logger.error('[STT] ❌ Cannot start audio stream — OpenAI API key not configured!');
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
            const langMap = exports.meetingLanguages.get(meetingId);
            const userPrefs = langMap?.get(userId);
            const langCode = language || userPrefs?.language || 'en';
            logger_1.logger.info(`[STT] Starting Whisper audio stream: user=${userId}, meeting=${meetingId}, lang=${langCode}`);
            activeAudioStreams.set(socket.id, {
                meetingId,
                language: langCode,
                lastTranscript: '',
            });
            socket.emit('audio:started', { meetingId });
        });
        // Client sends a complete audio segment (4-second webm file)
        socket.on('audio:segment', async (data) => {
            const state = activeAudioStreams.get(socket.id);
            if (!state)
                return;
            try {
                // Convert to Buffer
                let buf;
                if (typeof data.audio === 'string') {
                    buf = Buffer.from(data.audio, 'base64');
                }
                else if (data.audio instanceof ArrayBuffer) {
                    buf = Buffer.from(data.audio);
                }
                else {
                    buf = Buffer.isBuffer(data.audio) ? data.audio : Buffer.from(data.audio);
                }
                // Skip tiny segments (likely silence/noise)
                if (buf.length < 1000) {
                    logger_1.logger.debug(`[STT] Skipping tiny segment (${buf.length} bytes) for user=${userId}`);
                    return;
                }
                // Transcribe via Whisper
                const result = await (0, whisper_service_1.transcribeAudio)(buf, {
                    language: state.language,
                    prompt: state.lastTranscript,
                });
                const text = result.text;
                if (!text || !text.trim()) {
                    logger_1.logger.debug(`[STT] Empty transcript from Whisper for user=${userId}`);
                    return;
                }
                // Update context for next segment
                state.lastTranscript = text;
                // Feed into the translation pipeline (as a final result)
                await handleSpeechText(io, socket, userId, state.meetingId, text, state.language, true);
            }
            catch (err) {
                logger_1.logger.error(`[STT] Whisper transcription failed for user=${userId}: ${err.message}`);
                socket.emit('audio:error', {
                    meetingId: state.meetingId,
                    error: `Transcription failed: ${err.message}`,
                });
            }
        });
        // Legacy audio:chunk handler — no-op (replaced by audio:segment)
        socket.on('audio:chunk', () => { });
        socket.on('audio:stop', (data) => {
            const state = activeAudioStreams.get(socket.id);
            if (state) {
                logger_1.logger.info(`[STT] Stopping Whisper audio stream: user=${userId}`);
                activeAudioStreams.delete(socket.id);
                socket.emit('audio:stopped', { meetingId: data?.meetingId });
            }
        });
        // ── In-Meeting Chat ─────────────────────────────────
        socket.on('chat:send', async (data) => {
            try {
                const { meetingId: mid, message } = data || {};
                if (!mid || !message || typeof message !== 'string')
                    return;
                const trimmed = message.trim();
                if (!trimmed || trimmed.length > 2000)
                    return; // Reject empty or oversized messages
                // Verify user is in this meeting room
                const rooms = socket.rooms;
                if (!rooms.has(`meeting:${mid}`)) {
                    socket.emit('chat:error', { message: 'Not in this meeting' });
                    return;
                }
                // Look up sender name
                const user = await (0, db_1.default)('users').where({ id: userId }).select('first_name', 'last_name').first();
                const senderName = user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : 'Unknown';
                // Check table existence (cached)
                const tableExists = await db_1.default.schema.hasTable('meeting_messages');
                let msgId = null;
                if (tableExists) {
                    const [row] = await (0, db_1.default)('meeting_messages')
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
                logger_1.logger.debug(`[Chat] Message in meeting ${mid} from ${senderName}`);
            }
            catch (err) {
                logger_1.logger.error('[Chat] chat:send error', err);
                socket.emit('chat:error', { message: 'Failed to send message' });
            }
        });
        // Fetch chat history for a meeting
        socket.on('chat:history', async (data, callback) => {
            try {
                const mid = data?.meetingId;
                if (!mid)
                    return;
                const tableExists = await db_1.default.schema.hasTable('meeting_messages');
                if (!tableExists) {
                    if (typeof callback === 'function')
                        callback({ messages: [] });
                    return;
                }
                const messages = await (0, db_1.default)('meeting_messages')
                    .where({ meeting_id: mid })
                    .orderBy('created_at', 'asc')
                    .limit(200)
                    .select('id', 'meeting_id', 'sender_id', 'sender_name', 'message', 'created_at');
                const formatted = messages.map((m) => ({
                    id: m.id,
                    meetingId: m.meeting_id,
                    senderId: m.sender_id,
                    senderName: m.sender_name,
                    message: m.message,
                    createdAt: m.created_at,
                }));
                if (typeof callback === 'function') {
                    callback({ messages: formatted });
                }
                else {
                    socket.emit('chat:history', { messages: formatted });
                }
            }
            catch (err) {
                logger_1.logger.error('[Chat] chat:history error', err);
                if (typeof callback === 'function')
                    callback({ messages: [] });
            }
        });
        // Clean up translation data when user leaves
        socket.on('meeting:leave', (meetingId) => {
            socket.leave(`meeting:${meetingId}`);
            socket._meetingId = null;
            socket.to(`meeting:${meetingId}`).emit('meeting:participant-left', {
                userId,
                meetingId,
            });
            // Clean up audio stream state when leaving meeting
            activeAudioStreams.delete(socket.id);
            // Clean up rate limiter for this user+meeting
            speechRateLimits.delete(`${userId}:${meetingId}`);
            // Remove from translation map
            const langMap = exports.meetingLanguages.get(meetingId);
            if (langMap) {
                langMap.delete(userId);
                if (langMap.size === 0) {
                    exports.meetingLanguages.delete(meetingId);
                }
                else {
                    // Broadcast updated participants
                    const participants = [];
                    langMap.forEach((val, uid) => {
                        participants.push({ userId: uid, name: val.name, language: val.language });
                    });
                    io.to(`meeting:${meetingId}`).emit('translation:participants', { meetingId, participants });
                }
            }
        });
        // ── Financial Updates ───────────────────────────────
        socket.on('ledger:subscribe', async (orgId) => {
            try {
                // Verify user is a member of this organization
                const membership = await (0, db_1.default)('memberships')
                    .where({ user_id: userId, organization_id: orgId, is_active: true })
                    .first();
                if (!membership) {
                    socket.emit('error', { message: 'Not a member of this organization' });
                    return;
                }
                socket.join(`ledger:${orgId}`);
            }
            catch (err) {
                logger_1.logger.error('ledger:subscribe authorization error', err);
            }
        });
        // ── Presence ────────────────────────────────────────
        socket.on('disconnect', () => {
            logger_1.logger.debug(`Socket disconnected: ${userId}`);
            // Clean up audio stream state
            activeAudioStreams.delete(socket.id);
            // Clean up translation data for any meetings this user was in
            exports.meetingLanguages.forEach((langMap, meetingId) => {
                if (langMap.has(userId)) {
                    langMap.delete(userId);
                    // Clean up rate limiter for this user+meeting
                    speechRateLimits.delete(`${userId}:${meetingId}`);
                    if (langMap.size === 0) {
                        exports.meetingLanguages.delete(meetingId);
                    }
                    else {
                        const participants = [];
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
async function forceDisconnectMeeting(io, meetingId) {
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
    exports.meetingLanguages.delete(meetingId);
    logger_1.logger.info(`Force-disconnected ${sockets.length} sockets from meeting ${meetingId}`);
}
/**
 * Emit a financial update to all connected org members.
 * Called when transactions are created/updated.
 */
function emitFinancialUpdate(io, organizationId, data) {
    io.to(`org:${organizationId}`).emit('financial:update', data);
    io.to(`ledger:${organizationId}`).emit('ledger:update', data);
}
//# sourceMappingURL=socket.js.map