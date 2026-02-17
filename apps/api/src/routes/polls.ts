// ============================================================
// OrgsLedger API — Polls / Surveys Routes
// ============================================================

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import db from '../db';
import { authenticate, loadMembershipAndSub as loadMembership, requireRole, validate } from '../middleware';
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
      }, req.user!.userId).catch(err => logger.warn('Push notification failed (new poll)', err));

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

      if (!polls.length) {
        res.json({
          success: true,
          data: [],
          meta: { page, limit, total: parseInt(total?.count as string) || 0 },
        });
        return;
      }

      const pollIds = polls.map((p: any) => p.id);

      // Batch: all options for all polls in one query
      const allOptions = await db('poll_options')
        .whereIn('poll_id', pollIds)
        .orderBy('order');

      // Batch: vote counts per option in one query (GROUP BY)
      const optionIds = allOptions.map((o: any) => o.id);
      const voteCounts = await db('poll_votes')
        .whereIn('option_id', optionIds)
        .select('option_id')
        .count('id as count')
        .groupBy('option_id');
      const voteCountMap: Record<string, number> = {};
      voteCounts.forEach((vc: any) => { voteCountMap[vc.option_id] = parseInt(vc.count as string) || 0; });

      // Batch: current user's votes across all listed polls
      const userVotes = await db('poll_votes')
        .whereIn('poll_id', pollIds)
        .where({ user_id: req.user!.userId });
      const userVotedSet = new Set(userVotes.map((v: any) => v.poll_id));

      // Assemble in memory
      const optionsByPoll: Record<string, any[]> = {};
      allOptions.forEach((opt: any) => {
        if (!optionsByPoll[opt.poll_id]) optionsByPoll[opt.poll_id] = [];
        optionsByPoll[opt.poll_id].push({
          ...opt,
          voteCount: voteCountMap[opt.id] || 0,
        });
      });

      const enriched = polls.map((poll: any) => {
        const options = optionsByPoll[poll.id] || [];
        const totalVotes = options.reduce((sum: number, o: any) => sum + o.voteCount, 0);
        return {
          ...poll,
          options,
          totalVotes,
          userVoted: userVotedSet.has(poll.id),
        };
      });

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

      // Batch: vote counts per option
      const optionIds = options.map((o: any) => o.id);
      const voteCounts = await db('poll_votes')
        .whereIn('option_id', optionIds)
        .select('option_id')
        .count('id as count')
        .groupBy('option_id');
      const voteCountMap: Record<string, number> = {};
      voteCounts.forEach((vc: any) => { voteCountMap[vc.option_id] = parseInt(vc.count as string) || 0; });

      // Batch: voter info if not anonymous
      let votersByOption: Record<string, any[]> = {};
      if (!poll.anonymous && optionIds.length) {
        const allVoters = await db('poll_votes')
          .join('users', 'poll_votes.user_id', 'users.id')
          .whereIn('option_id', optionIds)
          .select('poll_votes.option_id', 'users.first_name', 'users.last_name', 'users.id as userId');
        allVoters.forEach((v: any) => {
          if (!votersByOption[v.option_id]) votersByOption[v.option_id] = [];
          votersByOption[v.option_id].push({ first_name: v.first_name, last_name: v.last_name, userId: v.userId });
        });
      }

      const optionsWithVotes = options.map((opt: any) => ({
        ...opt,
        voteCount: voteCountMap[opt.id] || 0,
        voters: votersByOption[opt.id] || [],
      }));

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

      if (!optionId || typeof optionId !== 'string') {
        res.status(400).json({ success: false, error: 'optionId is required' });
        return;
      }

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

      // For multiple choice, prevent voting for same option twice
      if (poll.multiple_choice) {
        const duplicateVote = await db('poll_votes')
          .where({ poll_id: poll.id, option_id: optionId, user_id: req.user!.userId })
          .first();
        if (duplicateVote) {
          res.status(400).json({ success: false, error: 'You already voted for this option' });
          return;
        }
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
      // Verify poll belongs to this org before deleting related data
      const poll = await db('polls')
        .where({ id: req.params.pollId, organization_id: req.params.orgId })
        .first();
      if (!poll) {
        res.status(404).json({ success: false, error: 'Poll not found' });
        return;
      }

      await db('poll_votes').where({ poll_id: req.params.pollId }).delete();
      await db('poll_options').where({ poll_id: req.params.pollId }).delete();
      await db('polls').where({ id: req.params.pollId }).delete();
      res.json({ success: true, message: 'Poll deleted' });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to delete poll' });
    }
  }
);

export default router;
