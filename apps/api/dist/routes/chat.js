"use strict";
// ============================================================
// OrgsLedger API — Chat / Communication Routes
// Channels, Messages, Threads, File Sharing, Search
// ============================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
const fs_1 = __importDefault(require("fs"));
const db_1 = __importDefault(require("../db"));
const middleware_1 = require("../middleware");
const config_1 = require("../config");
const logger_1 = require("../logger");
const router = (0, express_1.Router)();
// ── Channel Ownership + Membership Helper ───────────────────
async function verifyChannelOwnership(channelId, orgId, res) {
    const channel = await (0, db_1.default)('channels').where({ id: channelId, organization_id: orgId }).first();
    if (!channel) {
        res.status(404).json({ success: false, error: 'Channel not found in this organization' });
        return false;
    }
    return true;
}
/**
 * Verify user has access to a channel.
 * General/announcement channels are open to all org members.
 * Other channels require explicit channel_members entry.
 * Super admins bypass all channel access checks.
 */
async function verifyChannelAccess(channelId, orgId, userId, res, req) {
    // Super admin and developer bypass channel membership check
    if (req?.user?.globalRole === 'super_admin' || req?.user?.globalRole === 'developer')
        return true;
    const channel = await (0, db_1.default)('channels').where({ id: channelId, organization_id: orgId }).first();
    if (!channel) {
        res.status(404).json({ success: false, error: 'Channel not found in this organization' });
        return false;
    }
    // General and announcement channels are open to all org members
    if (['general', 'announcement'].includes(channel.type))
        return true;
    // Private/committee/direct channels require membership
    const membership = await (0, db_1.default)('channel_members')
        .where({ channel_id: channelId, user_id: userId })
        .first();
    if (!membership) {
        res.status(403).json({ success: false, error: 'Not a member of this channel' });
        return false;
    }
    return true;
}
// ── Multer config ───────────────────────────────────────────
const chatUploadDir = path_1.default.join(config_1.config.upload.dir, 'chat');
// Ensure directory exists on startup
fs_1.default.mkdirSync(chatUploadDir, { recursive: true });
const storage = multer_1.default.diskStorage({
    destination: (_req, _file, cb) => {
        cb(null, chatUploadDir);
    },
    filename: (_req, file, cb) => {
        const unique = crypto_1.default.randomBytes(12).toString('hex');
        const ext = path_1.default.extname(file.originalname);
        cb(null, `${unique}${ext}`);
    },
});
const upload = (0, multer_1.default)({
    storage,
    limits: { fileSize: config_1.config.upload.maxFileSizeMB * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        // Allow images, docs, pdf, video, audio
        const allowed = /jpeg|jpg|png|gif|webp|pdf|doc|docx|xls|xlsx|ppt|pptx|txt|csv|mp4|mp3|m4a|wav|zip|rar/;
        const ext = path_1.default.extname(file.originalname).toLowerCase().replace('.', '');
        cb(null, allowed.test(ext));
    },
});
// ── Schemas ─────────────────────────────────────────────────
const createChannelSchema = zod_1.z.object({
    name: zod_1.z.string().min(1).max(100),
    type: zod_1.z.enum(['general', 'committee', 'direct', 'announcement']).default('general'),
    description: zod_1.z.string().max(500).optional(),
    memberIds: zod_1.z.array(zod_1.z.string().uuid()).optional(),
    committeeId: zod_1.z.string().uuid().optional(),
});
const sendMessageSchema = zod_1.z.object({
    content: zod_1.z.string().min(1).max(10000),
    threadId: zod_1.z.string().uuid().optional(),
    attachmentIds: zod_1.z.array(zod_1.z.string().uuid()).optional(),
});
// ── List Channels ───────────────────────────────────────────
router.get('/:orgId/channels', middleware_1.authenticate, middleware_1.loadMembershipAndSub, async (req, res) => {
    try {
        const userId = req.user.userId;
        const channelData = await (0, db_1.default)('channels')
            .leftJoin('channel_members as cm', function () {
            this.on('channels.id', 'cm.channel_id')
                .andOn('cm.user_id', db_1.default.raw('?', [userId]));
        })
            .leftJoin('messages', function () {
            this.on('messages.channel_id', 'channels.id')
                .andOn('messages.is_deleted', db_1.default.raw('?', [false]));
        })
            .where({ 'channels.organization_id': req.params.orgId })
            .andWhere((qb) => {
            qb.where('cm.user_id', userId)
                .orWhereIn('channels.type', ['general', 'announcement']);
        })
            .select('channels.*', db_1.default.raw(`count(case when messages.created_at > coalesce(cm.last_read_at, '1970-01-01') then 1 end)::int as "unreadCount"`))
            .groupBy('channels.id', 'cm.last_read_at')
            .orderBy('channels.name')
            .limit(200);
        res.json({ success: true, data: channelData });
    }
    catch (err) {
        logger_1.logger.error('List channels error', err);
        res.status(500).json({ success: false, error: 'Failed to list channels' });
    }
});
// ── Create Channel ──────────────────────────────────────────
router.post('/:orgId/channels', middleware_1.authenticate, middleware_1.loadMembershipAndSub, (0, middleware_1.requireRole)('org_admin', 'executive'), (0, middleware_1.validate)(createChannelSchema), async (req, res) => {
    try {
        const { name, type, description, memberIds, committeeId } = req.body;
        const [channel] = await (0, db_1.default)('channels')
            .insert({
            organization_id: req.params.orgId,
            name,
            type,
            description: description || null,
            committee_id: committeeId || null,
        })
            .returning('*');
        // Add creator
        await (0, db_1.default)('channel_members').insert({
            channel_id: channel.id,
            user_id: req.user.userId,
        });
        // Add specified members
        if (memberIds?.length) {
            const inserts = memberIds
                .filter((id) => id !== req.user.userId)
                .map((userId) => ({
                channel_id: channel.id,
                user_id: userId,
            }));
            if (inserts.length) {
                await (0, db_1.default)('channel_members').insert(inserts).onConflict(['channel_id', 'user_id']).ignore();
            }
        }
        res.status(201).json({ success: true, data: channel });
    }
    catch (err) {
        logger_1.logger.error('Create channel error', err);
        res.status(500).json({ success: false, error: 'Failed to create channel' });
    }
});
// ── Get or Create Direct Message Channel ────────────────────
router.post('/:orgId/dm/:targetUserId', middleware_1.authenticate, middleware_1.loadMembershipAndSub, async (req, res) => {
    try {
        const { orgId, targetUserId } = req.params;
        const currentUserId = req.user.userId;
        if (currentUserId === targetUserId) {
            res.status(400).json({ success: false, error: 'Cannot create DM with yourself' });
            return;
        }
        // Verify target user is in the same org
        const targetMembership = await (0, db_1.default)('memberships')
            .where({ organization_id: orgId, user_id: targetUserId, is_active: true })
            .first();
        if (!targetMembership) {
            res.status(404).json({ success: false, error: 'User not found in this organization' });
            return;
        }
        // Find existing DM channel between these two users
        const existingChannel = await (0, db_1.default)('channels as c')
            .join('channel_members as cm1', 'c.id', 'cm1.channel_id')
            .join('channel_members as cm2', 'c.id', 'cm2.channel_id')
            .where({
            'c.organization_id': orgId,
            'c.type': 'direct',
            'cm1.user_id': currentUserId,
            'cm2.user_id': targetUserId,
        })
            .select('c.*')
            .first();
        if (existingChannel) {
            res.json({ success: true, data: existingChannel, created: false });
            return;
        }
        // Get target user's name for channel name
        const targetUser = await (0, db_1.default)('users').where({ id: targetUserId }).first();
        const currentUser = await (0, db_1.default)('users').where({ id: currentUserId }).first();
        const channelName = `${currentUser.first_name} & ${targetUser.first_name}`;
        // Create new DM channel
        const [channel] = await (0, db_1.default)('channels')
            .insert({
            organization_id: orgId,
            name: channelName,
            type: 'direct',
            description: 'Direct message',
        })
            .returning('*');
        // Add both users
        await (0, db_1.default)('channel_members').insert([
            { channel_id: channel.id, user_id: currentUserId },
            { channel_id: channel.id, user_id: targetUserId },
        ]);
        res.status(201).json({ success: true, data: channel, created: true });
    }
    catch (err) {
        logger_1.logger.error('Get/Create DM channel error', err);
        res.status(500).json({ success: false, error: 'Failed to get or create DM channel' });
    }
});
// ── Get Messages (with threads) ─────────────────────────────
router.get('/:orgId/channels/:channelId/messages', middleware_1.authenticate, middleware_1.loadMembershipAndSub, async (req, res) => {
    try {
        if (!(await verifyChannelAccess(req.params.channelId, req.params.orgId, req.user.userId, res, req)))
            return;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const before = req.query.before; // cursor-based pagination
        let query = (0, db_1.default)('messages')
            .join('users', 'messages.sender_id', 'users.id')
            .where({
            'messages.channel_id': req.params.channelId,
            'messages.is_deleted': false,
        })
            .whereNull('messages.thread_id') // only top-level messages
            .select('messages.*', 'users.first_name as senderFirstName', 'users.last_name as senderLastName', 'users.avatar_url as senderAvatar');
        if (before) {
            query = query.where('messages.created_at', '<', before);
        }
        const messages = await query
            .orderBy('messages.created_at', 'desc')
            .limit(limit);
        // Batch: thread counts for all messages in one query (GROUP BY)
        let threadCountMap = {};
        let attachmentMap = {};
        if (messages.length) {
            const msgIds = messages.map((m) => m.id);
            const threadCounts = await (0, db_1.default)('messages')
                .whereIn('thread_id', msgIds)
                .where({ is_deleted: false })
                .select('thread_id')
                .count('id as count')
                .groupBy('thread_id');
            threadCounts.forEach((tc) => { threadCountMap[tc.thread_id] = parseInt(tc.count) || 0; });
            // Batch: all attachments for all messages in one query
            const allAttachments = await (0, db_1.default)('attachments')
                .whereIn('message_id', msgIds);
            allAttachments.forEach((a) => {
                if (!attachmentMap[a.message_id])
                    attachmentMap[a.message_id] = [];
                attachmentMap[a.message_id].push(a);
            });
        }
        const enriched = messages.map((msg) => ({
            ...msg,
            threadCount: threadCountMap[msg.id] || 0,
            attachments: attachmentMap[msg.id] || [],
        }));
        // Update last read
        await (0, db_1.default)('channel_members')
            .where({ channel_id: req.params.channelId, user_id: req.user.userId })
            .update({ last_read_at: db_1.default.fn.now() });
        res.json({ success: true, data: enriched.reverse() });
    }
    catch (err) {
        logger_1.logger.error('List messages error', err);
        res.status(500).json({ success: false, error: 'Failed to list messages' });
    }
});
// ── Mark Channel as Read (explicit) ─────────────────────────
router.post('/:orgId/channels/:channelId/mark-read', middleware_1.authenticate, middleware_1.loadMembershipAndSub, async (req, res) => {
    try {
        if (!(await verifyChannelAccess(req.params.channelId, req.params.orgId, req.user.userId, res, req)))
            return;
        await (0, db_1.default)('channel_members')
            .where({ channel_id: req.params.channelId, user_id: req.user.userId })
            .update({ last_read_at: db_1.default.fn.now() });
        // Broadcast read receipt to other channel members via socket
        const io = req.app.get('io');
        if (io) {
            io.to(`channel:${req.params.channelId}`).emit('channel:read', {
                channelId: req.params.channelId,
                userId: req.user.userId,
                readAt: new Date().toISOString(),
            });
        }
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to mark as read' });
    }
});
// ── Send Message ────────────────────────────────────────────
router.post('/:orgId/channels/:channelId/messages', middleware_1.authenticate, middleware_1.loadMembershipAndSub, (0, middleware_1.validate)(sendMessageSchema), async (req, res) => {
    try {
        if (!(await verifyChannelAccess(req.params.channelId, req.params.orgId, req.user.userId, res, req)))
            return;
        const { content, threadId, attachmentIds } = req.body;
        const [message] = await (0, db_1.default)('messages')
            .insert({
            channel_id: req.params.channelId,
            sender_id: req.user.userId,
            content,
            thread_id: threadId || null,
        })
            .returning('*');
        // Link attachments to this message
        if (attachmentIds?.length) {
            await (0, db_1.default)('attachments')
                .whereIn('id', attachmentIds)
                .andWhere({ uploaded_by: req.user.userId })
                .whereNull('message_id')
                .update({ message_id: message.id });
        }
        // Fetch linked attachments for broadcast
        const attachments = await (0, db_1.default)('attachments')
            .where({ message_id: message.id })
            .select('*');
        // The Socket.io layer will broadcast this (see socket setup)
        // Emit event via app-level event system
        const io = req.app.get('io');
        if (io) {
            const sender = await (0, db_1.default)('users')
                .where({ id: req.user.userId })
                .select('first_name', 'last_name', 'avatar_url')
                .first();
            io.to(`channel:${req.params.channelId}`).emit('message:new', {
                ...message,
                senderFirstName: sender?.first_name,
                senderLastName: sender?.last_name,
                senderAvatar: sender?.avatar_url,
                attachments,
            });
        }
        res.status(201).json({ success: true, data: { ...message, attachments } });
    }
    catch (err) {
        logger_1.logger.error('Send message error', err);
        res.status(500).json({ success: false, error: 'Failed to send message' });
    }
});
// ── Get Thread Replies ──────────────────────────────────────
router.get('/:orgId/channels/:channelId/messages/:messageId/thread', middleware_1.authenticate, middleware_1.loadMembershipAndSub, async (req, res) => {
    try {
        if (!(await verifyChannelAccess(req.params.channelId, req.params.orgId, req.user.userId, res, req)))
            return;
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
        const before = req.query.before; // cursor-based pagination
        let query = (0, db_1.default)('messages')
            .join('users', 'messages.sender_id', 'users.id')
            .where({
            'messages.thread_id': req.params.messageId,
            'messages.is_deleted': false,
        })
            .select('messages.*', 'users.first_name as senderFirstName', 'users.last_name as senderLastName', 'users.avatar_url as senderAvatar');
        if (before) {
            query = query.where('messages.created_at', '<', before);
        }
        const replies = await query
            .orderBy('messages.created_at', 'asc')
            .limit(limit);
        res.json({ success: true, data: replies });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to get thread' });
    }
});
// ── Search Messages ─────────────────────────────────────────
router.get('/:orgId/messages/search', middleware_1.authenticate, middleware_1.loadMembershipAndSub, async (req, res) => {
    try {
        const query = req.query.q;
        if (!query || query.length < 2) {
            res.status(400).json({ success: false, error: 'Search query too short' });
            return;
        }
        // Get channels user has access to
        const channelIds = await (0, db_1.default)('channel_members')
            .join('channels', 'channel_members.channel_id', 'channels.id')
            .where({
            'channel_members.user_id': req.user.userId,
            'channels.organization_id': req.params.orgId,
        })
            .pluck('channels.id');
        const escapedQuery = query.replace(/[%_\\]/g, '\\$&');
        const messages = await (0, db_1.default)('messages')
            .join('users', 'messages.sender_id', 'users.id')
            .join('channels', 'messages.channel_id', 'channels.id')
            .whereIn('messages.channel_id', channelIds)
            .andWhere('messages.content', 'ilike', `%${escapedQuery}%`)
            .andWhere('messages.is_deleted', false)
            .select('messages.*', 'users.first_name as senderFirstName', 'users.last_name as senderLastName', 'channels.name as channelName')
            .orderBy('messages.created_at', 'desc')
            .limit(50);
        res.json({ success: true, data: messages });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Search failed' });
    }
});
// ── Edit Message ────────────────────────────────────────────
router.put('/:orgId/channels/:channelId/messages/:messageId', middleware_1.authenticate, middleware_1.loadMembershipAndSub, async (req, res) => {
    try {
        const { content } = req.body;
        if (!content || typeof content !== 'string' || !content.trim()) {
            res.status(400).json({ success: false, error: 'content is required' });
            return;
        }
        if (content.length > 10000) {
            res.status(400).json({ success: false, error: 'content must be at most 10000 characters' });
            return;
        }
        if (!(await verifyChannelAccess(req.params.channelId, req.params.orgId, req.user.userId, res, req)))
            return;
        const message = await (0, db_1.default)('messages')
            .where({ id: req.params.messageId, sender_id: req.user.userId })
            .first();
        if (!message) {
            res.status(404).json({ success: false, error: 'Message not found or not yours' });
            return;
        }
        await (0, db_1.default)('messages')
            .where({ id: req.params.messageId })
            .update({ content: content.trim(), is_edited: true });
        const io = req.app.get('io');
        if (io) {
            io.to(`channel:${req.params.channelId}`).emit('message:edited', {
                id: req.params.messageId,
                content: content.trim(),
            });
        }
        res.json({ success: true, message: 'Message updated' });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to update message' });
    }
});
// ── Delete Message ──────────────────────────────────────────
router.delete('/:orgId/channels/:channelId/messages/:messageId', middleware_1.authenticate, middleware_1.loadMembershipAndSub, async (req, res) => {
    try {
        if (!(await verifyChannelAccess(req.params.channelId, req.params.orgId, req.user.userId, res, req)))
            return;
        const message = await (0, db_1.default)('messages')
            .where({ id: req.params.messageId })
            .first();
        if (!message) {
            res.status(404).json({ success: false, error: 'Message not found' });
            return;
        }
        // Only sender or admin can delete
        if (message.sender_id !== req.user.userId &&
            req.membership?.role !== 'org_admin') {
            res.status(403).json({ success: false, error: 'Not authorized to delete this message' });
            return;
        }
        await (0, db_1.default)('messages')
            .where({ id: req.params.messageId })
            .update({ is_deleted: true });
        const io = req.app.get('io');
        if (io) {
            io.to(`channel:${req.params.channelId}`).emit('message:deleted', {
                id: req.params.messageId,
            });
        }
        res.json({ success: true, message: 'Message deleted' });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to delete message' });
    }
});
// ── Upload Attachment ───────────────────────────────────────
router.post('/:orgId/channels/:channelId/upload', middleware_1.authenticate, middleware_1.loadMembershipAndSub, upload.array('files', 5), async (req, res) => {
    try {
        if (!(await verifyChannelAccess(req.params.channelId, req.params.orgId, req.user.userId, res, req)))
            return;
        const files = req.files;
        if (!files || !files.length) {
            res.status(400).json({ success: false, error: 'No files uploaded' });
            return;
        }
        const attachmentRows = files.map((file) => ({
            file_name: file.originalname,
            file_url: `/uploads/chat/${file.filename}`,
            mime_type: file.mimetype,
            size_bytes: file.size,
            uploaded_by: req.user.userId,
        }));
        const attachments = await (0, db_1.default)('attachments').insert(attachmentRows).returning('*');
        res.status(201).json({ success: true, data: attachments });
    }
    catch (err) {
        logger_1.logger.error('File upload error', err);
        res.status(500).json({ success: false, error: 'File upload failed' });
    }
});
exports.default = router;
//# sourceMappingURL=chat.js.map