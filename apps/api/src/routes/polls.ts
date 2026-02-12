// ============================================================
// OrgsLedger API — Polls / Surveys Routes
// ============================================================

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import db from '../db';
import { authenticate, loadMembership, requireRole, validate } from '../middleware';
import { logger } from '../logger';
import { sendPushToOrg } from '../services/push.service';

const router = Router();

// ── Schemas ─────────────────────────────────────────────────
const createPollSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(5000).optional(),
  options: z.array(z.string().min(1)).min(2).max(10),
  multipleChoice: z.boolean().default(false),
  anonymous: z.boolean().default(false),
  expiresAt: z.string().datetime().optional(),
});

// ── Create Poll ─────────────────────────────────────────────
router.post(
  '/:orgId',
  authenticate,
  loadMembership,
  requireRole('org_admin', 'executive'),
  validate(createPollSchema),
  async (req: Request, res: Response) => {
    try {
      const { title, description, options, multipleChoice, anonymous, expiresAt } = req.body;

      const [poll] = await db('polls')
        .insert({
          organization_id: req.params.orgId,
          title,
          description: description || null,
          multiple_choice: multipleChoice,
          anonymous,
          expires_at: expiresAt || null,
          created_by: req.user!.userId,
          status: 'active',
        })
        .returning('*');

      // Insert poll options
      const optionRows = options.map((label: string, idx: number) => ({
        poll_id: poll.id,
        label,
        order: idx + 1,
      }));
      await db('poll_options').insert(optionRows);

      // Notify org
      sendPushToOrg(req.params.orgId, {
        title: '📊 New Poll',
        body: title,
        data: { pollId: poll.id, type: 'poll' },
      }, req.user!.userId).catch(() => {});

      const createdOptions = await db('poll_options').where({ poll_id: poll.id }).orderBy('order');

      res.status(201).json({ success: true, data: { ...poll, options: createdOptions } });
    } catch (err) {
      logger.error('Create poll error', err);
      res.status(500).json({ success: false, error: 'Failed to create poll' });
    }
  }
);

// ── List Polls ──────────────────────────────────────────────
router.get(
  '/:orgId',
  authenticate,
  loadMembership,
  async (req: Request, res: Response) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const status = req.query.status as string;

      let query = db('polls')
        .where({ organization_id: req.params.orgId });

      if (status) {
        query = query.where({ status });
      }

      const total = await query.clone().clear('select').count('id as count').first();

      const polls = await query
        .select('polls.*')
        .orderBy('created_at', 'desc')
        .offset((page - 1) * limit)
        .limit(limit);

      // Enrich with options and vote counts
      const enriched = await Promise.all(
        polls.map(async (poll: any) => {
          const options = await db('poll_options')
            .where({ poll_id: poll.id })
            .orderBy('order');

          const optionsWithVotes = await Promise.all(
            options.map(async (opt: any) => {
              const voteCount = await db('poll_votes')
                .where({ option_id: opt.id })
                .count('id as count')
                .first();
              return {
                ...opt,
                voteCount: parseInt(voteCount?.count as string) || 0,
              };
            })
          );

          const totalVotes = optionsWithVotes.reduce((sum, o) => sum + o.voteCount, 0);

          // Check if current user voted
          const userVote = await db('poll_votes')
            .where({ poll_id: poll.id, user_id: req.user!.userId })
            .first();

          return {
            ...poll,
            options: optionsWithVotes,
            totalVotes,
            userVoted: !!userVote,
          };
        })
      );

      res.json({
        success: true,
        data: enriched,
        meta: { page, limit, total: parseInt(total?.count as string) || 0 },
      });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to list polls' });
    }
  }
);

// ── Get Poll Detail ─────────────────────────────────────────
router.get(
  '/:orgId/:pollId',
  authenticate,
  loadMembership,
  async (req: Request, res: Response) => {
    try {
      const poll = await db('polls')
        .where({ id: req.params.pollId, organization_id: req.params.orgId })
        .first();

      if (!poll) {
        res.status(404).json({ success: false, error: 'Poll not found' });
        return;
      }

      const options = await db('poll_options')
        .where({ poll_id: poll.id })
        .orderBy('order');

      const optionsWithVotes = await Promise.all(
        options.map(async (opt: any) => {
          const voteCount = await db('poll_votes')
            .where({ option_id: opt.id })
            .count('id as count')
            .first();

          // Include voter info if not anonymous
          let voters: any[] = [];
          if (!poll.anonymous) {
            voters = await db('poll_votes')
              .join('users', 'poll_votes.user_id', 'users.id')
              .where({ option_id: opt.id })
              .select('users.first_name', 'users.last_name', 'users.id as userId');
          }

          return {
            ...opt,
            voteCount: parseInt(voteCount?.count as string) || 0,
            voters,
          };
        })
      );

      const userVote = await db('poll_votes')
        .where({ poll_id: poll.id, user_id: req.user!.userId })
        .first();

      res.json({
        success: true,
        data: {
          ...poll,
          options: optionsWithVotes,
          userVoted: !!userVote,
          userVoteOptionId: userVote?.option_id || null,
        },
      });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to get poll' });
    }
  }
);

// ── Vote on Poll ────────────────────────────────────────────
router.post(
  '/:orgId/:pollId/vote',
  authenticate,
  loadMembership,
  async (req: Request, res: Response) => {
    try {
      const { optionId } = req.body;
      const poll = await db('polls')
        .where({ id: req.params.pollId, organization_id: req.params.orgId })
        .first();

      if (!poll) {
        res.status(404).json({ success: false, error: 'Poll not found' });
        return;
      }

      if (poll.status !== 'active') {
        res.status(400).json({ success: false, error: 'Poll is no longer active' });
        return;
      }

      if (poll.expires_at && new Date(poll.expires_at) < new Date()) {
        res.status(400).json({ success: false, error: 'Poll has expired' });
        return;
      }

      // Check if already voted
      const existingVote = await db('poll_votes')
        .where({ poll_id: poll.id, user_id: req.user!.userId })
        .first();

      if (existingVote && !poll.multiple_choice) {
        res.status(400).json({ success: false, error: 'You have already voted' });
        return;
      }

      // Validate option belongs to this poll
      const option = await db('poll_options')
        .where({ id: optionId, poll_id: poll.id })
        .first();

      if (!option) {
        res.status(400).json({ success: false, error: 'Invalid option' });
        return;
      }

      await db('poll_votes').insert({
        poll_id: poll.id,
        option_id: optionId,
        user_id: req.user!.userId,
      });

      res.json({ success: true, message: 'Vote recorded' });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to vote' });
    }
  }
);

// ── Close Poll ──────────────────────────────────────────────
router.put(
  '/:orgId/:pollId/close',
  authenticate,
  loadMembership,
  requireRole('org_admin', 'executive'),
  async (req: Request, res: Response) => {
    try {
      await db('polls')
        .where({ id: req.params.pollId, organization_id: req.params.orgId })
        .update({ status: 'closed' });

      res.json({ success: true, message: 'Poll closed' });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to close poll' });
    }
  }
);

// ── Delete Poll ─────────────────────────────────────────────
router.delete(
  '/:orgId/:pollId',
  authenticate,
  loadMembership,
  requireRole('org_admin'),
  async (req: Request, res: Response) => {
    try {
      await db('poll_votes').where({ poll_id: req.params.pollId }).delete();
      await db('poll_options').where({ poll_id: req.params.pollId }).delete();
      await db('polls')
        .where({ id: req.params.pollId, organization_id: req.params.orgId })
        .delete();
      res.json({ success: true, message: 'Poll deleted' });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to delete poll' });
    }
  }
);

export default router;
