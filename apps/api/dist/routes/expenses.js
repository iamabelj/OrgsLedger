"use strict";
// ============================================================
// OrgsLedger API — Expenses Routes
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../db");
const middleware_1 = require("../middleware");
const router = (0, express_1.Router)();
// ── List Expenses ───────────────────────────────────────────
router.get('/:orgId', middleware_1.authenticate, middleware_1.loadMembershipAndSub, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const status = req.query.status;
        const category = req.query.category;
        let query = (0, db_1.db)('expenses')
            .where({ organization_id: req.params.orgId })
            .select('*');
        if (status)
            query = query.where({ status });
        if (category)
            query = query.where({ category });
        const total = await query.clone().clear('select').count('id as count').first();
        const expenses = await query
            .orderBy('created_at', 'desc')
            .offset((page - 1) * limit)
            .limit(limit);
        res.json({
            success: true,
            data: expenses,
            meta: {
                page,
                limit,
                total: parseInt(total?.count) || 0,
            },
        });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to list expenses' });
    }
});
// ── Get Expense ─────────────────────────────────────────────
router.get('/:orgId/:expenseId', middleware_1.authenticate, middleware_1.loadMembershipAndSub, async (req, res) => {
    try {
        const expense = await (0, db_1.db)('expenses')
            .where({ id: req.params.expenseId, organization_id: req.params.orgId })
            .first();
        if (!expense) {
            res.status(404).json({ success: false, error: 'Expense not found' });
            return;
        }
        res.json({ success: true, data: expense });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to get expense' });
    }
});
// ── Create Expense ──────────────────────────────────────────
router.post('/:orgId', middleware_1.authenticate, middleware_1.loadMembershipAndSub, (0, middleware_1.requireRole)('org_admin', 'executive'), async (req, res) => {
    try {
        const { title, description, amount, category, date, receipt_url } = req.body;
        if (!title || !amount) {
            res.status(400).json({ success: false, error: 'Title and amount are required' });
            return;
        }
        const [expense] = await (0, db_1.db)('expenses')
            .insert({
            organization_id: req.params.orgId,
            title,
            description: description || null,
            amount: parseFloat(amount),
            category: category || 'general',
            date: date || new Date().toISOString(),
            receipt_url: receipt_url || null,
            created_by: req.user.userId,
            status: 'approved',
        })
            .returning('*');
        await req.audit?.({
            organizationId: req.params.orgId,
            action: 'create',
            entityType: 'expense',
            entityId: expense.id,
            newValue: { title, amount, category },
        });
        res.status(201).json({ success: true, data: expense });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to create expense' });
    }
});
// ── Update Expense ──────────────────────────────────────────
router.put('/:orgId/:expenseId', middleware_1.authenticate, middleware_1.loadMembershipAndSub, (0, middleware_1.requireRole)('org_admin', 'executive', 'treasurer'), async (req, res) => {
    try {
        const { title, description, amount, category, date, status, receipt_url } = req.body;
        const existing = await (0, db_1.db)('expenses')
            .where({ id: req.params.expenseId, organization_id: req.params.orgId })
            .first();
        if (!existing) {
            res.status(404).json({ success: false, error: 'Expense not found' });
            return;
        }
        const updates = {};
        if (title !== undefined)
            updates.title = title;
        if (description !== undefined)
            updates.description = description;
        if (amount !== undefined)
            updates.amount = parseFloat(amount);
        if (category !== undefined)
            updates.category = category;
        if (date !== undefined)
            updates.date = date;
        if (status !== undefined)
            updates.status = status;
        if (receipt_url !== undefined)
            updates.receipt_url = receipt_url;
        updates.updated_at = new Date().toISOString();
        const [updated] = await (0, db_1.db)('expenses')
            .where({ id: req.params.expenseId })
            .update(updates)
            .returning('*');
        await req.audit?.({
            organizationId: req.params.orgId,
            action: 'update',
            entityType: 'expense',
            entityId: req.params.expenseId,
            previousValue: existing,
            newValue: updates,
        });
        res.json({ success: true, data: updated });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to update expense' });
    }
});
// ── Delete Expense ──────────────────────────────────────────
router.delete('/:orgId/:expenseId', middleware_1.authenticate, middleware_1.loadMembershipAndSub, (0, middleware_1.requireRole)('org_admin', 'executive', 'treasurer'), async (req, res) => {
    try {
        const expense = await (0, db_1.db)('expenses')
            .where({ id: req.params.expenseId, organization_id: req.params.orgId })
            .first();
        if (!expense) {
            res.status(404).json({ success: false, error: 'Expense not found' });
            return;
        }
        await (0, db_1.db)('expenses').where({ id: req.params.expenseId }).delete();
        await req.audit?.({
            organizationId: req.params.orgId,
            action: 'delete',
            entityType: 'expense',
            entityId: req.params.expenseId,
        });
        res.json({ success: true, message: 'Expense deleted' });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to delete expense' });
    }
});
exports.default = router;
//# sourceMappingURL=expenses.js.map