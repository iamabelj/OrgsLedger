// ============================================================
// OrgsLedger API — Chat / Communication Routes
// Channels, Messages, Threads, File Sharing, Search
// ============================================================

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import db from '../db';
import { authenticate, loadMembershipAndSub as loadMembership, requireRole, validate } from '../middleware';
import { config } from '../config';
import { logger } from '../logger';

const router = Router();

// ── Channel Ownership + Membership Helper ───────────────────
async function verifyChannelOwnership(channelId: string, orgId: string, res: Response): Promise<boolean> {
  const channel = await db('channels').where({ id: channelId, organization_id: orgId }).first();
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
async function verifyChannelAccess(channelId: string, orgId: string, userId: string, res: Response, req?: Request): Promise<boolean> {
  // Super admin and developer bypass channel membership check
  if ((req as any)?.user?.globalRole === 'super_admin' || (req as any)?.user?.globalRole === 'developer') return true;

  const channel = await db('channels').where({ id: channelId, organization_id: orgId }).first();
  if (!channel) {
    res.status(404).json({ success: false, error: 'Channel not found in this organization' });
    return false;
  }
  // General and announcement channels are open to all org members
  if (['general', 'announcement'].includes(channel.type)) return true;

  // Private/committee/direct channels require membership
  const membership = await db('channel_members')
    .where({ channel_id: channelId, user_id: userId })
    .first();
  if (!membership) {
    res.status(403).json({ success: false, error: 'Not a member of this channel' });
    return false;
  }
  return true;
}

// ── Multer config ───────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, config.upload.dir);
  },
  filename: (_req, file, cb) => {
    const unique = crypto.randomBytes(12).toString('hex');
    const ext = path.extname(file.originalname);
    cb(null, `${unique}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: config.upload.maxFileSizeMB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    // Allow images, docs, pdf, video, audio
    const allowed = /jpeg|jpg|png|gif|webp|pdf|doc|docx|xls|xlsx|ppt|pptx|txt|csv|mp4|mp3|m4a|wav|zip|rar/;
    const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
    cb(null, allowed.test(ext));
  },
});

// ── Schemas ─────────────────────────────────────────────────
const createChannelSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(['general', 'committee', 'direct', 'announcement']).default('general'),
  description: z.string().max(500).optional(),
  memberIds: z.array(z.string().uuid()).optional(),
  committeeId: z.string().uuid().optional(),
});

const sendMessageSchema = z.object({
  content: z.string().min(1).max(10000),
  threadId: z.string().uuid().optional(),
  attachmentIds: z.array(z.string().uuid()).optional(),
});

// ── List Channels ───────────────────────────────────────────
router.get(
  '/:orgId/channels',
  authenticate,
  loadMembership,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;

      const channelData = await db('channels')
        .leftJoin('channel_members as cm', function () {
          this.on('channels.id', 'cm.channel_id')
              .andOn('cm.user_id', db.raw('?', [userId]));
        })
        .leftJoin('messages', function () {
          this.on('messages.channel_id', 'channels.id')
              .andOn('messages.is_deleted', db.raw('?', [false]));
        })
        .where({ 'channels.organization_id': req.params.orgId })
        .andWhere((qb) => {
          qb.where('cm.user_id', userId)
            .orWhereIn('channels.type', ['general', 'announcement']);
        })
        .select(
          'channels.*',
          db.raw(`count(case when messages.created_at > coalesce(cm.last_read_at, '1970-01-01') then 1 end)::int as "unreadCount"`)
        )
        .groupBy('channels.id', 'cm.last_read_at')
        .orderBy('channels.name');

      res.json({ success: true, data: channelData });
    } catch (err) {
      logger.error('List channels error', err);
      res.status(500).json({ success: false, error: 'Failed to list channels' });
    }
  }
);

// ── Create Channel ──────────────────────────────────────────
router.post(
  '/:orgId/channels',
  authenticate,
  loadMembership,
  requireRole('org_admin', 'executive'),
  validate(createChannelSchema),
  async (req: Request, res: Response) => {
    try {
      const { name, type, description, memberIds, committeeId } = req.body;

      const [channel] = await db('channels')
        .insert({
          organization_id: req.params.orgId,
          name,
          type,
          description: description || null,
          committee_id: committeeId || null,
        })
        .returning('*');

      // Add creator
      await db('channel_members').insert({
        channel_id: channel.id,
        user_id: req.user!.userId,
      });

      // Add specified members
      if (memberIds?.length) {
        const inserts = memberIds
          .filter((id: string) => id !== req.user!.userId)
          .map((userId: string) => ({
            channel_id: channel.id,
            user_id: userId,
          }));
        if (inserts.length) {
          await db('channel_members').insert(inserts).onConflict(['channel_id', 'user_id']).ignore();
        }
      }

      res.status(201).json({ success: true, data: channel });
    } catch (err) {
      logger.error('Create channel error', err);
      res.status(500).json({ success: false, error: 'Failed to create channel' });
    }
  }
);

// ── Get Messages (with threads) ─────────────────────────────
router.get(
  '/:orgId/channels/:channelId/messages',
  authenticate,
  loadMembership,
  async (req: Request, res: Response) => {
    try {
      if (!(await verifyChannelAccess(req.params.channelId, req.params.orgId, req.user!.userId, res, req))) return;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 50;
      const before = req.query.before as string; // cursor-based pagination

      let query = db('messages')
        .join('users', 'messages.sender_id', 'users.id')
        .where({
          'messages.channel_id': req.params.channelId,
          'messages.is_deleted': false,
        })
        .whereNull('messages.thread_id') // only top-level messages
        .select(
          'messages.*',
          'users.first_name as senderFirstName',
          'users.last_name as senderLastName',
          'users.avatar_url as senderAvatar'
        );

      if (before) {
        query = query.where('messages.created_at', '<', before);
      }

      const messages = await query
        .orderBy('messages.created_at', 'desc')
        .limit(limit);

      // Attach thread counts + attachments
      const enriched = await Promise.all(
        messages.map(async (msg) => {
          const threadCount = await db('messages')
            .where({ thread_id: msg.id, is_deleted: false })
            .count('id as count')
            .first();
          const attachments = await db('attachments')
            .where({ message_id: msg.id })
            .select('*');
          return {
            ...msg,
            threadCount: parseInt(threadCount?.count as string) || 0,
            attachments,
          };
        })
      );

      // Update last read
      await db('channel_members')
        .where({ channel_id: req.params.channelId, user_id: req.user!.userId })
        .update({ last_read_at: db.fn.now() });

      res.json({ success: true, data: enriched.reverse() });
    } catch (err) {
      logger.error('List messages error', err);
      res.status(500).json({ success: false, error: 'Failed to list messages' });
    }
  }
);

// ── Mark Channel as Read (explicit) ─────────────────────────
router.post(
  '/:orgId/channels/:channelId/mark-read',
  authenticate,
  loadMembership,
  async (req: Request, res: Response) => {
    try {
      if (!(await verifyChannelOwnership(req.params.channelId, req.params.orgId, res))) return;
      await db('channel_members')
        .where({ channel_id: req.params.channelId, user_id: req.user!.userId })
        .update({ last_read_at: db.fn.now() });

      // Broadcast read receipt to other channel members via socket
      const io = req.app.get('io');
      if (io) {
        io.to(`channel:${req.params.channelId}`).emit('channel:read', {
          channelId: req.params.channelId,
          userId: req.user!.userId,
          readAt: new Date().toISOString(),
        });
      }

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to mark as read' });
    }
  }
);

// ── Send Message ────────────────────────────────────────────
router.post(
  '/:orgId/channels/:channelId/messages',
  authenticate,
  loadMembership,
  validate(sendMessageSchema),
  async (req: Request, res: Response) => {
    try {
      if (!(await verifyChannelAccess(req.params.channelId, req.params.orgId, req.user!.userId, res, req))) return;
      const { content, threadId, attachmentIds } = req.body;

      const [message] = await db('messages')
        .insert({
          channel_id: req.params.channelId,
          sender_id: req.user!.userId,
          content,
          thread_id: threadId || null,
        })
        .returning('*');

      // Link attachments to this message
      if (attachmentIds?.length) {
        await db('attachments')
          .whereIn('id', attachmentIds)
          .andWhere({ uploaded_by: req.user!.userId })
          .whereNull('message_id')
          .update({ message_id: message.id });
      }

      // Fetch linked attachments for broadcast
      const attachments = await db('attachments')
        .where({ message_id: message.id })
        .select('*');

      // The Socket.io layer will broadcast this (see socket setup)
      // Emit event via app-level event system
      const io = req.app.get('io');
      if (io) {
        const sender = await db('users')
          .where({ id: req.user!.userId })
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
    } catch (err) {
      logger.error('Send message error', err);
      res.status(500).json({ success: false, error: 'Failed to send message' });
    }
  }
);

// ── Get Thread Replies ──────────────────────────────────────
router.get(
  '/:orgId/channels/:channelId/messages/:messageId/thread',
  authenticate,
  loadMembership,
  async (req: Request, res: Response) => {
    try {
      if (!(await verifyChannelOwnership(req.params.channelId, req.params.orgId, res))) return;
      const replies = await db('messages')
        .join('users', 'messages.sender_id', 'users.id')
        .where({
          'messages.thread_id': req.params.messageId,
          'messages.is_deleted': false,
        })
        .select(
          'messages.*',
          'users.first_name as senderFirstName',
          'users.last_name as senderLastName',
          'users.avatar_url as senderAvatar'
        )
        .orderBy('messages.created_at', 'asc');

      res.json({ success: true, data: replies });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to get thread' });
    }
  }
);

// ── Search Messages ─────────────────────────────────────────
router.get(
  '/:orgId/messages/search',
  authenticate,
  loadMembership,
  async (req: Request, res: Response) => {
    try {
      const query = req.query.q as string;
      if (!query || query.length < 2) {
        res.status(400).json({ success: false, error: 'Search query too short' });
        return;
      }

      // Get channels user has access to
      const channelIds = await db('channel_members')
        .join('channels', 'channel_members.channel_id', 'channels.id')
        .where({
          'channel_members.user_id': req.user!.userId,
          'channels.organization_id': req.params.orgId,
        })
        .pluck('channels.id');

      const escapedQuery = query.replace(/[%_\\]/g, '\\$&');
      const messages = await db('messages')
        .join('users', 'messages.sender_id', 'users.id')
        .join('channels', 'messages.channel_id', 'channels.id')
        .whereIn('messages.channel_id', channelIds)
        .andWhere('messages.content', 'ilike', `%${escapedQuery}%`)
        .andWhere('messages.is_deleted', false)
        .select(
          'messages.*',
          'users.first_name as senderFirstName',
          'users.last_name as senderLastName',
          'channels.name as channelName'
        )
        .orderBy('messages.created_at', 'desc')
        .limit(50);

      res.json({ success: true, data: messages });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Search failed' });
    }
  }
);

// ── Edit Message ────────────────────────────────────────────
router.put(
  '/:orgId/channels/:channelId/messages/:messageId',
  authenticate,
  loadMembership,
  async (req: Request, res: Response) => {
    try {
      if (!(await verifyChannelOwnership(req.params.channelId, req.params.orgId, res))) return;
      const message = await db('messages')
        .where({ id: req.params.messageId, sender_id: req.user!.userId })
        .first();
      if (!message) {
        res.status(404).json({ success: false, error: 'Message not found or not yours' });
        return;
      }

      await db('messages')
        .where({ id: req.params.messageId })
        .update({ content: req.body.content, is_edited: true });

      const io = req.app.get('io');
      if (io) {
        io.to(`channel:${req.params.channelId}`).emit('message:edited', {
          id: req.params.messageId,
          content: req.body.content,
        });
      }

      res.json({ success: true, message: 'Message updated' });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to update message' });
    }
  }
);

// ── Delete Message ──────────────────────────────────────────
router.delete(
  '/:orgId/channels/:channelId/messages/:messageId',
  authenticate,
  loadMembership,
  async (req: Request, res: Response) => {
    try {
      if (!(await verifyChannelOwnership(req.params.channelId, req.params.orgId, res))) return;
      const message = await db('messages')
        .where({ id: req.params.messageId })
        .first();
      if (!message) {
        res.status(404).json({ success: false, error: 'Message not found' });
        return;
      }

      // Only sender or admin can delete
      if (
        message.sender_id !== req.user!.userId &&
        req.membership?.role !== 'org_admin'
      ) {
        res.status(403).json({ success: false, error: 'Not authorized to delete this message' });
        return;
      }

      await db('messages')
        .where({ id: req.params.messageId })
        .update({ is_deleted: true });

      const io = req.app.get('io');
      if (io) {
        io.to(`channel:${req.params.channelId}`).emit('message:deleted', {
          id: req.params.messageId,
        });
      }

      res.json({ success: true, message: 'Message deleted' });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to delete message' });
    }
  }
);

// ── Upload Attachment ───────────────────────────────────────
router.post(
  '/:orgId/channels/:channelId/upload',
  authenticate,
  loadMembership,
  upload.array('files', 5),
  async (req: Request, res: Response) => {
    try {
      if (!(await verifyChannelOwnership(req.params.channelId, req.params.orgId, res))) return;
      const files = req.files as Express.Multer.File[];
      if (!files || !files.length) {
        res.status(400).json({ success: false, error: 'No files uploaded' });
        return;
      }

      const attachments = await Promise.all(
        files.map(async (file) => {
          const [attachment] = await db('attachments')
            .insert({
              file_name: file.originalname,
              file_url: `/uploads/${file.filename}`,
              mime_type: file.mimetype,
              size_bytes: file.size,
              uploaded_by: req.user!.userId,
            })
            .returning('*');
          return attachment;
        })
      );

      res.status(201).json({ success: true, data: attachments });
    } catch (err) {
      logger.error('File upload error', err);
      res.status(500).json({ success: false, error: 'File upload failed' });
    }
  }
);

export default router;
