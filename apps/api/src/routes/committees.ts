// ============================================================
// OrgsLedger API — Committee Management Routes
// CRUD for committees and their members
// ============================================================

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import db from '../db';
import { authenticate, loadMembershipAndSub as loadMembership, requireRole, validate } from '../middleware';
import { logger } from '../logger';

const router = Router();

// ── Schemas ─────────────────────────────────────────────────
const createCommitteeSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(1000).optional(),
  chairUserId: z.string().uuid().optional(),
  memberIds: z.array(z.string().uuid()).optional(),
});

const updateCommitteeSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(1000).optional(),
  chairUserId: z.string().uuid().nullable().optional(),
});

const addMemberSchema = z.object({
  userId: z.string().uuid(),
});

// ── List Committees ─────────────────────────────────────────
router.get(
  '/:orgId/committees',
  authenticate,
  loadMembership,
  async (req: Request, res: Response) => {
    try {
      const rows = await db('committees')
        .leftJoin('committee_members as cm', 'committees.id', 'cm.committee_id')
        .leftJoin('users as chair_user', 'committees.chair_user_id', 'chair_user.id')
        .where({ 'committees.organization_id': req.params.orgId })
        .select(
          'committees.*',
          db.raw('count(cm.id)::int as "memberCount"'),
          'chair_user.id as chair_id',
          'chair_user.first_name as chair_first_name',
          'chair_user.last_name as chair_last_name',
          'chair_user.email as chair_email',
          'chair_user.avatar_url as chair_avatar_url'
        )
        .groupBy('committees.id', 'chair_user.id', 'chair_user.first_name', 'chair_user.last_name', 'chair_user.email', 'chair_user.avatar_url')
        .orderBy('committees.name');

      const data = rows.map((row: any) => {
        const { chair_id, chair_first_name, chair_last_name, chair_email, chair_avatar_url, ...committee } = row;
        return {
          ...committee,
          chair: chair_id
            ? { id: chair_id, first_name: chair_first_name, last_name: chair_last_name, email: chair_email, avatar_url: chair_avatar_url }
            : null,
        };
      });

      res.json({ success: true, data });
    } catch (err) {
      logger.error('List committees error', err);
      res.status(500).json({ success: false, error: 'Failed to list committees' });
    }
  }
);

// ── Get Committee Detail ────────────────────────────────────
router.get(
  '/:orgId/committees/:committeeId',
  authenticate,
  loadMembership,
  async (req: Request, res: Response) => {
    try {
      const committee = await db('committees')
        .where({ id: req.params.committeeId, organization_id: req.params.orgId })
        .first();

      if (!committee) {
        res.status(404).json({ success: false, error: 'Committee not found' });
        return;
      }

      const members = await db('committee_members')
        .join('users', 'committee_members.user_id', 'users.id')
        .where({ 'committee_members.committee_id': committee.id })
        .select(
          'users.id',
          'users.first_name',
          'users.last_name',
          'users.email',
          'users.avatar_url',
          'committee_members.created_at as joined_at'
        );

      let chair = null;
      if (committee.chair_user_id) {
        chair = await db('users')
          .where({ id: committee.chair_user_id })
          .select('id', 'first_name', 'last_name', 'email', 'avatar_url')
          .first();
      }

      // Get linked channel if any
      const channel = await db('channels')
        .where({ committee_id: committee.id })
        .first();

      res.json({
        success: true,
        data: {
          ...committee,
          chair,
          members,
          memberCount: members.length,
          channel: channel || null,
        },
      });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to get committee' });
    }
  }
);

// ── Create Committee ────────────────────────────────────────
router.post(
  '/:orgId/committees',
  authenticate,
  loadMembership,
  requireRole('org_admin', 'executive'),
  validate(createCommitteeSchema),
  async (req: Request, res: Response) => {
    try {
      const { name, description, chairUserId, memberIds } = req.body;

      const [committee] = await db('committees')
        .insert({
          organization_id: req.params.orgId,
          name,
          description: description || null,
          chair_user_id: chairUserId || null,
        })
        .returning('*');

      // Add initial members
      const allMemberIds = new Set<string>(memberIds || []);
      if (chairUserId) allMemberIds.add(chairUserId);

      if (allMemberIds.size > 0) {
        const memberInserts = Array.from(allMemberIds).map((userId) => ({
          committee_id: committee.id,
          user_id: userId,
        }));
        await db('committee_members').insert(memberInserts);
      }

      // Auto-create committee chat channel
      const [channel] = await db('channels')
        .insert({
          organization_id: req.params.orgId,
          name: `${name} (Committee)`,
          type: 'committee',
          description: `Channel for ${name} committee`,
          committee_id: committee.id,
        })
        .returning('*');

      // Add members to channel
      if (allMemberIds.size > 0) {
        const channelMemberInserts = Array.from(allMemberIds).map((userId) => ({
          channel_id: channel.id,
          user_id: userId,
        }));
        await db('channel_members').insert(channelMemberInserts);
      }

      await (req as any).audit?.({
        organizationId: req.params.orgId,
        action: 'create',
        entityType: 'committee',
        entityId: committee.id,
        newValue: { name, memberCount: allMemberIds.size },
      });

      res.status(201).json({
        success: true,
        data: { ...committee, channel },
      });
    } catch (err) {
      logger.error('Create committee error', err);
      res.status(500).json({ success: false, error: 'Failed to create committee' });
    }
  }
);

// ── Update Committee ────────────────────────────────────────
router.put(
  '/:orgId/committees/:committeeId',
  authenticate,
  loadMembership,
  requireRole('org_admin', 'executive'),
  validate(updateCommitteeSchema),
  async (req: Request, res: Response) => {
    try {
      const { name, description, chairUserId } = req.body;
      const previous = await db('committees')
        .where({ id: req.params.committeeId, organization_id: req.params.orgId })
        .first();

      if (!previous) {
        res.status(404).json({ success: false, error: 'Committee not found' });
        return;
      }

      const updates: Record<string, any> = {};
      if (name !== undefined) updates.name = name;
      if (description !== undefined) updates.description = description;
      if (chairUserId !== undefined) updates.chair_user_id = chairUserId;

      await db('committees')
        .where({ id: req.params.committeeId })
        .update(updates);

      // If chair changed, ensure chair is a member
      if (chairUserId) {
        const isMember = await db('committee_members')
          .where({ committee_id: req.params.committeeId, user_id: chairUserId })
          .first();
        if (!isMember) {
          await db('committee_members').insert({
            committee_id: req.params.committeeId,
            user_id: chairUserId,
          });
        }
      }

      await (req as any).audit?.({
        organizationId: req.params.orgId,
        action: 'update',
        entityType: 'committee',
        entityId: req.params.committeeId,
        previousValue: previous,
        newValue: updates,
      });

      res.json({ success: true, message: 'Committee updated' });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to update committee' });
    }
  }
);

// ── Delete Committee ────────────────────────────────────────
router.delete(
  '/:orgId/committees/:committeeId',
  authenticate,
  loadMembership,
  requireRole('org_admin'),
  async (req: Request, res: Response) => {
    try {
      const committee = await db('committees')
        .where({ id: req.params.committeeId, organization_id: req.params.orgId })
        .first();

      if (!committee) {
        res.status(404).json({ success: false, error: 'Committee not found' });
        return;
      }

      // Archive linked channel instead of deleting
      await db('channels')
        .where({ committee_id: req.params.committeeId })
        .update({ is_archived: true });

      await db('committees')
        .where({ id: req.params.committeeId })
        .del();

      await (req as any).audit?.({
        organizationId: req.params.orgId,
        action: 'delete',
        entityType: 'committee',
        entityId: req.params.committeeId,
        previousValue: { name: committee.name },
      });

      res.json({ success: true, message: 'Committee deleted' });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to delete committee' });
    }
  }
);

// ── Add Member to Committee ─────────────────────────────────
router.post(
  '/:orgId/committees/:committeeId/members',
  authenticate,
  loadMembership,
  requireRole('org_admin', 'executive'),
  validate(addMemberSchema),
  async (req: Request, res: Response) => {
    try {
      const { userId } = req.body;

      // Verify user is an org member
      const membership = await db('memberships')
        .where({ user_id: userId, organization_id: req.params.orgId, is_active: true })
        .first();

      if (!membership) {
        res.status(400).json({ success: false, error: 'User is not a member of this organization' });
        return;
      }

      // Check not already a member
      const existing = await db('committee_members')
        .where({ committee_id: req.params.committeeId, user_id: userId })
        .first();

      if (existing) {
        res.status(409).json({ success: false, error: 'User is already a committee member' });
        return;
      }

      await db('committee_members').insert({
        committee_id: req.params.committeeId,
        user_id: userId,
      });

      // Also add to the committee's chat channel
      const channel = await db('channels')
        .where({ committee_id: req.params.committeeId })
        .first();
      if (channel) {
        const existingChannelMember = await db('channel_members')
          .where({ channel_id: channel.id, user_id: userId })
          .first();
        if (!existingChannelMember) {
          await db('channel_members').insert({
            channel_id: channel.id,
            user_id: userId,
          });
        }
      }

      await (req as any).audit?.({
        organizationId: req.params.orgId,
        action: 'create',
        entityType: 'committee_member',
        entityId: req.params.committeeId,
        newValue: { userId },
      });

      res.status(201).json({ success: true, message: 'Member added to committee' });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to add committee member' });
    }
  }
);

// ── Remove Member from Committee ────────────────────────────
router.delete(
  '/:orgId/committees/:committeeId/members/:userId',
  authenticate,
  loadMembership,
  requireRole('org_admin', 'executive'),
  async (req: Request, res: Response) => {
    try {
      await db('committee_members')
        .where({
          committee_id: req.params.committeeId,
          user_id: req.params.userId,
        })
        .del();

      // Update chair if removed user was the chair
      await db('committees')
        .where({ id: req.params.committeeId, chair_user_id: req.params.userId })
        .update({ chair_user_id: null });

      await (req as any).audit?.({
        organizationId: req.params.orgId,
        action: 'delete',
        entityType: 'committee_member',
        entityId: req.params.committeeId,
        newValue: { userId: req.params.userId },
      });

      res.json({ success: true, message: 'Member removed from committee' });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to remove committee member' });
    }
  }
);

export default router;
