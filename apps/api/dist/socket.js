"use strict";
// ============================================================
// OrgsLedger API — Socket.io Real-Time Layer
// Chat, Meetings, Notifications, Financial Updates
// ============================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupSocketIO = setupSocketIO;
exports.emitFinancialUpdate = emitFinancialUpdate;
const socket_io_1 = require("socket.io");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const config_1 = require("./config");
const db_1 = __importDefault(require("./db"));
const logger_1 = require("./logger");
const translation_service_1 = require("./services/translation.service");
// In-memory store for meeting translation sessions
// meetingId -> Map<userId, { language, name }>
const meetingLanguages = new Map();
function setupSocketIO(httpServer) {
    const io = new socket_io_1.Server(httpServer, {
        cors: {
            origin: '*',
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
        socket.on('channel:join', (channelId) => {
            socket.join(`channel:${channelId}`);
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
        socket.on('meeting:join', (meetingId) => {
            socket.join(`meeting:${meetingId}`);
            socket.to(`meeting:${meetingId}`).emit('meeting:participant-joined', {
                userId,
            });
            logger_1.logger.debug(`User ${userId} joined meeting ${meetingId}`);
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
            const { meetingId, language } = data;
            if (!meetingId || !language)
                return;
            // Get user's name
            const user = await (0, db_1.default)('users').where({ id: userId }).select('first_name', 'last_name').first();
            const name = user ? `${user.first_name} ${user.last_name}` : 'Unknown';
            // Store in memory
            if (!meetingLanguages.has(meetingId)) {
                meetingLanguages.set(meetingId, new Map());
            }
            meetingLanguages.get(meetingId).set(userId, { language, name });
            // Broadcast updated participant languages to everyone in the meeting
            const participants = [];
            meetingLanguages.get(meetingId).forEach((val, uid) => {
                participants.push({ userId: uid, name: val.name, language: val.language });
            });
            io.to(`meeting:${meetingId}`).emit('translation:participants', {
                meetingId,
                participants,
            });
            logger_1.logger.debug(`User ${userId} set translation language to ${language} for meeting ${meetingId}`);
        });
        // User sends spoken text for translation
        socket.on('translation:speech', async (data) => {
            const { meetingId, text, sourceLang, isFinal } = data;
            if (!meetingId || !text?.trim())
                return;
            const langMap = meetingLanguages.get(meetingId);
            if (!langMap || langMap.size === 0)
                return;
            // Get speaker name
            const speaker = langMap.get(userId);
            const speakerName = speaker?.name || 'Unknown';
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
            const targetLangs = new Set();
            langMap.forEach((val) => {
                if (val.language !== sourceLang) {
                    targetLangs.add(val.language);
                }
            });
            try {
                let translations = {};
                if (targetLangs.size > 0) {
                    translations = await (0, translation_service_1.translateToMultiple)(text, [...targetLangs], sourceLang);
                }
                // Always include the original language
                translations[sourceLang] = text;
                // Broadcast to all meeting participants
                io.to(`meeting:${meetingId}`).emit('translation:result', {
                    meetingId,
                    speakerId: userId,
                    speakerName,
                    originalText: text,
                    sourceLang,
                    translations, // { en: "Hello", fr: "Bonjour", es: "Hola" }
                    timestamp: Date.now(),
                });
            }
            catch (err) {
                logger_1.logger.error('Translation failed', err);
                // Still send the original text even if translation fails
                io.to(`meeting:${meetingId}`).emit('translation:result', {
                    meetingId,
                    speakerId: userId,
                    speakerName,
                    originalText: text,
                    sourceLang,
                    translations: { [sourceLang]: text },
                    timestamp: Date.now(),
                    error: 'Translation temporarily unavailable',
                });
            }
        });
        // Clean up translation data when meeting ends
        socket.on('meeting:leave', (meetingId) => {
            socket.leave(`meeting:${meetingId}`);
            socket.to(`meeting:${meetingId}`).emit('meeting:participant-left', {
                userId,
            });
            // Remove from translation map
            const langMap = meetingLanguages.get(meetingId);
            if (langMap) {
                langMap.delete(userId);
                if (langMap.size === 0) {
                    meetingLanguages.delete(meetingId);
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
        socket.on('ledger:subscribe', (orgId) => {
            socket.join(`ledger:${orgId}`);
        });
        // ── Presence ────────────────────────────────────────
        socket.on('disconnect', () => {
            logger_1.logger.debug(`Socket disconnected: ${userId}`);
            // Clean up translation data for any meetings this user was in
            meetingLanguages.forEach((langMap, meetingId) => {
                if (langMap.has(userId)) {
                    langMap.delete(userId);
                    if (langMap.size === 0) {
                        meetingLanguages.delete(meetingId);
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
 * Emit a financial update to all connected org members.
 * Called when transactions are created/updated.
 */
function emitFinancialUpdate(io, organizationId, data) {
    io.to(`org:${organizationId}`).emit('financial:update', data);
    io.to(`ledger:${organizationId}`).emit('ledger:update', data);
}
//# sourceMappingURL=socket.js.map