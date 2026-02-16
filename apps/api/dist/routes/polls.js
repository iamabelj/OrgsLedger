"use strict";
// ============================================================
// OrgsLedger API — Polls / Surveys Routes
// ============================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = __importDefault(require("../db"));
const middleware_1 = require("../middleware");
const logger_1 = require("../logger");
const push_service_1 = require("../services/push.service");
const router = (0, express_1.Router)();
// ── Schemas ─────────────────────────────────────────────────
const createPollSchema = zod_1.z.object({
    title: zod_1.z.string().min(1).max(300),
    description: zod_1.z.string().max(5000).optional(),
    options: zod_1.z.array(zod_1.z.string().min(1)).min(2).max(10),
    multipleChoice: zod_1.z.boolean().default(false),
    anonymous: zod_1.z.boolean().default(false),
    expiresAt: zod_1.z.string().datetime().optional(),
});
// ── Create Poll ─────────────────────────────────────────────
router.post('/:orgId', middleware_1.authenticate, middleware_1.loadMembershipAndSub, (0, middleware_1.requireRole)('org_admin', 'executive'), (0, middleware_1.validate)(createPollSchema), async (req, res) => {
    try {
        const { title, description, options, multipleChoice, anonymous, expiresAt } = req.body;
        const [poll] = await (0, db_1.default)('polls')
            .insert({
            organization_id: req.params.orgId,
            title,
            description: description || null,
            multiple_choice: multipleChoice,
            anonymous,
            expires_at: expiresAt || null,
            created_by: req.user.userId,
            status: 'active',
        })
            .returning('*');
        // Insert poll options
        const optionRows = options.map((label, idx) => ({
            poll_id: poll.id,
            label,
            order: idx + 1,
        }));
        await (0, db_1.default)('poll_options').insert(optionRows);
        // Notify org
        (0, push_service_1.sendPushToOrg)(req.params.orgId, {
            title: '📊 New Poll',
            body: title,
            data: { pollId: poll.id, type: 'poll' },
        }, req.user.userId).catch(err => logger_1.logger.warn('Push notification failed (new poll)', err));
        const createdOptions = await (0, db_1.default)('poll_options').where({ poll_id: poll.id }).orderBy('order');
        res.status(201).json({ success: true, data: { ...poll, options: createdOptions } });
    }
    catch (err) {
        logger_1.logger.error('Create poll error', err);
        res.status(500).json({ success: false, error: 'Failed to create poll' });
    }
});
// ── List Polls ──────────────────────────────────────────────
router.get('/:orgId', middleware_1.authenticate, middleware_1.loadMembershipAndSub, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const status = req.query.status;
        let query = (0, db_1.default)('polls')
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
        const enriched = await Promise.all(polls.map(async (poll) => {
            const options = await (0, db_1.default)('poll_options')
                .where({ poll_id: poll.id })
                .orderBy('order');
            const optionsWithVotes = await Promise.all(options.map(async (opt) => {
                const voteCount = await (0, db_1.default)('poll_votes')
                    .where({ option_id: opt.id })
                    .count('id as count')
                    .first();
                return {
                    ...opt,
                    voteCount: parseInt(voteCount?.count) || 0,
                };
            }));
            const totalVotes = optionsWithVotes.reduce((sum, o) => sum + o.voteCount, 0);
            // Check if current user voted
            const userVote = await (0, db_1.default)('poll_votes')
                .where({ poll_id: poll.id, user_id: req.user.userId })
                .first();
            return {
                ...poll,
                options: optionsWithVotes,
                totalVotes,
                userVoted: !!userVote,
            };
        }));
        res.json({
            success: true,
            data: enriched,
            meta: { page, limit, total: parseInt(total?.count) || 0 },
        });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to list polls' });
    }
});
// ── Get Poll Detail ─────────────────────────────────────────
router.get('/:orgId/:pollId', middleware_1.authenticate, middleware_1.loadMembershipAndSub, async (req, res) => {
    try {
        const poll = await (0, db_1.default)('polls')
            .where({ id: req.params.pollId, organization_id: req.params.orgId })
            .first();
        if (!poll) {
            res.status(404).json({ success: false, error: 'Poll not found' });
            return;
        }
        const options = await (0, db_1.default)('poll_options')
            .where({ poll_id: poll.id })
            .orderBy('order');
        const optionsWithVotes = await Promise.all(options.map(async (opt) => {
            const voteCount = await (0, db_1.default)('poll_votes')
                .where({ option_id: opt.id })
                .count('id as count')
                .first();
            // Include voter info if not anonymous
            let voters = [];
            if (!poll.anonymous) {
                voters = await (0, db_1.default)('poll_votes')
                    .join('users', 'poll_votes.user_id', 'users.id')
                    .where({ option_id: opt.id })
                    .select('users.first_name', 'users.last_name', 'users.id as userId');
            }
            return {
                ...opt,
                voteCount: parseInt(voteCount?.count) || 0,
                voters,
            };
        }));
        const userVote = await (0, db_1.default)('poll_votes')
            .where({ poll_id: poll.id, user_id: req.user.userId })
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
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to get poll' });
    }
});
// ── Vote on Poll ────────────────────────────────────────────
router.post('/:orgId/:pollId/vote', middleware_1.authenticate, middleware_1.loadMembershipAndSub, async (req, res) => {
    try {
        const { optionId } = req.body;
        const poll = await (0, db_1.default)('polls')
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
        const existingVote = await (0, db_1.default)('poll_votes')
            .where({ poll_id: poll.id, user_id: req.user.userId })
            .first();
        if (existingVote && !poll.multiple_choice) {
            res.status(400).json({ success: false, error: 'You have already voted' });
            return;
        }
        // For multiple choice, prevent voting for same option twice
        if (poll.multiple_choice) {
            const duplicateVote = await (0, db_1.default)('poll_votes')
                .where({ poll_id: poll.id, option_id: optionId, user_id: req.user.userId })
                .first();
            if (duplicateVote) {
                res.status(400).json({ success: false, error: 'You already voted for this option' });
                return;
            }
        }
        // Validate option belongs to this poll
        const option = await (0, db_1.default)('poll_options')
            .where({ id: optionId, poll_id: poll.id })
            .first();
        if (!option) {
            res.status(400).json({ success: false, error: 'Invalid option' });
            return;
        }
        await (0, db_1.default)('poll_votes').insert({
            poll_id: poll.id,
            option_id: optionId,
            user_id: req.user.userId,
        });
        res.json({ success: true, message: 'Vote recorded' });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to vote' });
    }
});
// ── Close Poll ──────────────────────────────────────────────
router.put('/:orgId/:pollId/close', middleware_1.authenticate, middleware_1.loadMembershipAndSub, (0, middleware_1.requireRole)('org_admin', 'executive'), async (req, res) => {
    try {
        await (0, db_1.default)('polls')
            .where({ id: req.params.pollId, organization_id: req.params.orgId })
            .update({ status: 'closed' });
        res.json({ success: true, message: 'Poll closed' });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to close poll' });
    }
});
// ── Delete Poll ─────────────────────────────────────────────
router.delete('/:orgId/:pollId', middleware_1.authenticate, middleware_1.loadMembershipAndSub, (0, middleware_1.requireRole)('org_admin'), async (req, res) => {
    try {
        await (0, db_1.default)('poll_votes').where({ poll_id: req.params.pollId }).delete();
        await (0, db_1.default)('poll_options').where({ poll_id: req.params.pollId }).delete();
        await (0, db_1.default)('polls')
            .where({ id: req.params.pollId, organization_id: req.params.orgId })
            .delete();
        res.json({ success: true, message: 'Poll deleted' });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to delete poll' });
    }
});
exports.default = router;
//# sourceMappingURL=polls.js.map