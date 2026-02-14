"use strict";
// ============================================================
// OrgsLedger — Subscription Service
// Plans, subscriptions, wallets, invites, metering, analytics
// ============================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isNigeria = isNigeria;
exports.getCurrency = getCurrency;
exports.getPlans = getPlans;
exports.getPlanById = getPlanById;
exports.getPlanBySlug = getPlanBySlug;
exports.getPlanPrice = getPlanPrice;
exports.checkMemberLimit = checkMemberLimit;
exports.getOrgSubscription = getOrgSubscription;
exports.createSubscription = createSubscription;
exports.renewSubscription = renewSubscription;
exports.getAiWallet = getAiWallet;
exports.getTranslationWallet = getTranslationWallet;
exports.topUpAiWallet = topUpAiWallet;
exports.topUpTranslationWallet = topUpTranslationWallet;
exports.deductAiWallet = deductAiWallet;
exports.deductTranslationWallet = deductTranslationWallet;
exports.getAiWalletHistory = getAiWalletHistory;
exports.getTranslationWalletHistory = getTranslationWalletHistory;
exports.createInviteLink = createInviteLink;
exports.validateInviteLink = validateInviteLink;
exports.useInviteLink = useInviteLink;
exports.startUsageRecord = startUsageRecord;
exports.completeUsageRecord = completeUsageRecord;
exports.adminAdjustAiWallet = adminAdjustAiWallet;
exports.adminAdjustTranslationWallet = adminAdjustTranslationWallet;
exports.getPlatformRevenue = getPlatformRevenue;
const db_1 = __importDefault(require("../db"));
const logger_1 = require("../logger");
const audit_1 = require("../middleware/audit");
const crypto_1 = __importDefault(require("crypto"));
// ── Currency Helpers ──────────────────────────────────────
function isNigeria(country) {
    if (!country)
        return false;
    return ['ng', 'nga', 'nigeria'].includes(country.toLowerCase());
}
function getCurrency(country) {
    return isNigeria(country) ? 'NGN' : 'USD';
}
// ── Plans ─────────────────────────────────────────────────
async function getPlans() {
    return (0, db_1.default)('subscription_plans').where({ is_active: true }).orderBy('sort_order', 'asc');
}
async function getPlanById(id) {
    return (0, db_1.default)('subscription_plans').where({ id }).first();
}
async function getPlanBySlug(slug) {
    return (0, db_1.default)('subscription_plans').where({ slug }).first();
}
function getPlanPrice(plan, currency, cycle = 'annual') {
    let price;
    const parse = (v) => { const n = parseFloat(v); return isNaN(n) ? null : n; };
    if (currency === 'NGN') {
        price = cycle === 'monthly'
            ? (parse(plan.price_ngn_monthly) ?? (parse(plan.price_ngn_annual) ?? 0) / 12)
            : (parse(plan.price_ngn_annual) ?? 0);
    }
    else {
        price = cycle === 'monthly'
            ? (parse(plan.price_usd_monthly) ?? (parse(plan.price_usd_annual) ?? 0) / 12)
            : (parse(plan.price_usd_annual) ?? 0);
    }
    return Math.round(price * 100) / 100;
}
// ── Member Limit Check ────────────────────────────────────
async function checkMemberLimit(orgId) {
    const sub = await getOrgSubscription(orgId);
    const maxMembers = sub?.plan?.max_members || 100;
    const countResult = await (0, db_1.default)('memberships')
        .where({ organization_id: orgId, is_active: true })
        .count('id as count')
        .first();
    const current = parseInt(countResult?.count) || 0;
    return { allowed: current < maxMembers, current, max: maxMembers };
}
// ── Subscriptions ─────────────────────────────────────────
async function getOrgSubscription(orgId) {
    const sub = await (0, db_1.default)('subscriptions')
        .where({ organization_id: orgId })
        .orderBy('created_at', 'desc')
        .first();
    if (!sub)
        return null;
    const plan = await getPlanById(sub.plan_id);
    const now = new Date();
    const periodEnd = new Date(sub.current_period_end);
    const graceEnd = new Date(sub.grace_period_end);
    // Auto-transition status
    if (sub.status === 'active' && now > periodEnd) {
        if (now <= graceEnd) {
            await (0, db_1.default)('subscriptions').where({ id: sub.id }).update({ status: 'grace_period', updated_at: db_1.default.fn.now() });
            await (0, db_1.default)('organizations').where({ id: orgId }).update({ subscription_status: 'grace_period' });
            sub.status = 'grace_period';
        }
        else {
            await (0, db_1.default)('subscriptions').where({ id: sub.id }).update({ status: 'expired', updated_at: db_1.default.fn.now() });
            await (0, db_1.default)('organizations').where({ id: orgId }).update({ subscription_status: 'expired' });
            sub.status = 'expired';
        }
    }
    else if (sub.status === 'grace_period' && now > graceEnd) {
        await (0, db_1.default)('subscriptions').where({ id: sub.id }).update({ status: 'expired', updated_at: db_1.default.fn.now() });
        await (0, db_1.default)('organizations').where({ id: orgId }).update({ subscription_status: 'expired' });
        sub.status = 'expired';
    }
    return { ...sub, plan };
}
async function createSubscription(params) {
    const initialStatus = params.status || 'active';
    const now = new Date();
    const periodEnd = new Date(now);
    if (params.billingCycle === 'monthly') {
        periodEnd.setMonth(periodEnd.getMonth() + 1);
    }
    else {
        periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    }
    const graceEnd = new Date(periodEnd);
    graceEnd.setDate(graceEnd.getDate() + 7);
    // Deactivate old subscriptions
    await (0, db_1.default)('subscriptions')
        .where({ organization_id: params.organizationId })
        .whereIn('status', ['active', 'grace_period'])
        .update({ status: 'cancelled', updated_at: db_1.default.fn.now() });
    const [sub] = await (0, db_1.default)('subscriptions').insert({
        organization_id: params.organizationId,
        plan_id: params.planId,
        status: initialStatus,
        billing_cycle: params.billingCycle,
        currency: params.currency,
        billing_country: params.billingCountry,
        amount_paid: params.amountPaid,
        current_period_start: now.toISOString(),
        current_period_end: periodEnd.toISOString(),
        grace_period_end: graceEnd.toISOString(),
        payment_gateway: params.paymentGateway,
        gateway_subscription_id: params.gatewaySubscriptionId,
        created_by: params.createdBy,
    }).returning('*');
    // Update org
    await (0, db_1.default)('organizations').where({ id: params.organizationId }).update({
        subscription_status: initialStatus === 'active' ? 'active' : 'pending',
        billing_currency: params.currency,
        billing_country: params.billingCountry,
    });
    // Log history
    await (0, db_1.default)('subscription_history').insert({
        subscription_id: sub.id,
        organization_id: params.organizationId,
        action: 'created',
        metadata: JSON.stringify({ planId: params.planId, amountPaid: params.amountPaid, cycle: params.billingCycle }),
    });
    logger_1.logger.info('[SUB] Subscription created', {
        orgId: params.organizationId,
        planId: params.planId,
        cycle: params.billingCycle,
        currency: params.currency,
        amountPaid: params.amountPaid,
        periodEnd: periodEnd.toISOString(),
        gateway: params.paymentGateway || 'none',
    });
    await (0, audit_1.writeAuditLog)({
        organizationId: params.organizationId,
        userId: params.createdBy || 'system',
        action: 'subscription_created',
        entityType: 'subscription',
        entityId: sub.id,
        newValue: { planId: params.planId, billingCycle: params.billingCycle, currency: params.currency, amountPaid: params.amountPaid, periodEnd: periodEnd.toISOString() },
    });
    return sub;
}
async function renewSubscription(orgId, amountPaid, paymentRef) {
    const sub = await (0, db_1.default)('subscriptions')
        .where({ organization_id: orgId })
        .orderBy('created_at', 'desc')
        .first();
    if (!sub)
        throw new Error('No subscription to renew');
    const now = new Date();
    const base = new Date(sub.current_period_end) > now ? new Date(sub.current_period_end) : now;
    const newEnd = new Date(base);
    if (sub.billing_cycle === 'monthly') {
        newEnd.setMonth(newEnd.getMonth() + 1);
    }
    else {
        newEnd.setFullYear(newEnd.getFullYear() + 1);
    }
    const graceEnd = new Date(newEnd);
    graceEnd.setDate(graceEnd.getDate() + 7);
    await (0, db_1.default)('subscriptions').where({ id: sub.id }).update({
        status: 'active',
        amount_paid: amountPaid,
        current_period_start: now.toISOString(),
        current_period_end: newEnd.toISOString(),
        grace_period_end: graceEnd.toISOString(),
        gateway_subscription_id: paymentRef || sub.gateway_subscription_id,
        updated_at: db_1.default.fn.now(),
    });
    await (0, db_1.default)('organizations').where({ id: orgId }).update({ subscription_status: 'active' });
    await (0, db_1.default)('subscription_history').insert({
        subscription_id: sub.id,
        organization_id: orgId,
        action: 'renewed',
        metadata: JSON.stringify({ amountPaid, paymentRef }),
    });
    await (0, audit_1.writeAuditLog)({
        organizationId: orgId,
        userId: 'system',
        action: 'subscription_renewed',
        entityType: 'subscription',
        entityId: sub.id,
        previousValue: { status: sub.status, periodEnd: sub.current_period_end },
        newValue: { status: 'active', periodEnd: newEnd.toISOString(), amountPaid },
    });
    return (0, db_1.default)('subscriptions').where({ id: sub.id }).first();
}
// ── Wallets ───────────────────────────────────────────────
async function getAiWallet(orgId) {
    let wallet = await (0, db_1.default)('ai_wallet').where({ organization_id: orgId }).first();
    if (!wallet) {
        // Use org's billing currency instead of hardcoded USD
        const org = await (0, db_1.default)('organizations').where({ id: orgId }).select('billing_currency').first();
        const currency = org?.billing_currency || 'USD';
        [wallet] = await (0, db_1.default)('ai_wallet').insert({ organization_id: orgId, balance_minutes: 0, currency }).returning('*');
    }
    return wallet;
}
async function getTranslationWallet(orgId) {
    let wallet = await (0, db_1.default)('translation_wallet').where({ organization_id: orgId }).first();
    if (!wallet) {
        // Use org's billing currency instead of hardcoded USD
        const org = await (0, db_1.default)('organizations').where({ id: orgId }).select('billing_currency').first();
        const currency = org?.billing_currency || 'USD';
        [wallet] = await (0, db_1.default)('translation_wallet').insert({ organization_id: orgId, balance_minutes: 0, currency }).returning('*');
    }
    return wallet;
}
async function topUpAiWallet(params) {
    await db_1.default.transaction(async (trx) => {
        await trx('ai_wallet')
            .where({ organization_id: params.orgId })
            .update({
            balance_minutes: trx.raw('balance_minutes + ?', [params.minutes]),
            updated_at: trx.fn.now(),
        });
        await trx('ai_wallet_transactions').insert({
            organization_id: params.orgId,
            type: 'topup',
            amount_minutes: params.minutes,
            cost: params.cost,
            currency: params.currency,
            payment_ref: params.paymentRef,
            payment_gateway: params.paymentGateway,
            description: `Top-up: ${(params.minutes / 60).toFixed(1)} hours`,
        });
    });
    logger_1.logger.info('[WALLET] AI wallet topped up', {
        orgId: params.orgId,
        minutes: params.minutes,
        hours: (params.minutes / 60).toFixed(1),
        cost: params.cost,
        currency: params.currency,
        gateway: params.paymentGateway || 'none',
    });
    await (0, audit_1.writeAuditLog)({
        organizationId: params.orgId,
        userId: 'system',
        action: 'wallet_topup',
        entityType: 'ai_wallet',
        entityId: params.orgId,
        newValue: { minutes: params.minutes, hours: +(params.minutes / 60).toFixed(1), cost: params.cost, currency: params.currency, gateway: params.paymentGateway || 'none' },
    });
    return getAiWallet(params.orgId);
}
async function topUpTranslationWallet(params) {
    await db_1.default.transaction(async (trx) => {
        await trx('translation_wallet')
            .where({ organization_id: params.orgId })
            .update({
            balance_minutes: trx.raw('balance_minutes + ?', [params.minutes]),
            updated_at: trx.fn.now(),
        });
        await trx('translation_wallet_transactions').insert({
            organization_id: params.orgId,
            type: 'topup',
            amount_minutes: params.minutes,
            cost: params.cost,
            currency: params.currency,
            payment_ref: params.paymentRef,
            payment_gateway: params.paymentGateway,
            description: `Top-up: ${(params.minutes / 60).toFixed(1)} hours`,
        });
    });
    logger_1.logger.info('[WALLET] Translation wallet topped up', {
        orgId: params.orgId,
        minutes: params.minutes,
        hours: (params.minutes / 60).toFixed(1),
        cost: params.cost,
        currency: params.currency,
        gateway: params.paymentGateway || 'none',
    });
    await (0, audit_1.writeAuditLog)({
        organizationId: params.orgId,
        userId: 'system',
        action: 'wallet_topup',
        entityType: 'translation_wallet',
        entityId: params.orgId,
        newValue: { minutes: params.minutes, hours: +(params.minutes / 60).toFixed(1), cost: params.cost, currency: params.currency, gateway: params.paymentGateway || 'none' },
    });
    return getTranslationWallet(params.orgId);
}
async function deductAiWallet(orgId, minutes, description) {
    const result = await db_1.default.transaction(async (trx) => {
        // Lock row to prevent concurrent deductions (TOCTOU race)
        const wallet = await trx('ai_wallet')
            .where({ organization_id: orgId })
            .forUpdate()
            .first();
        if (!wallet) {
            logger_1.logger.warn('[WALLET] AI wallet not found', { orgId });
            return { success: false, error: 'AI wallet not found' };
        }
        const balanceBefore = parseFloat(wallet.balance_minutes);
        if (balanceBefore < minutes) {
            logger_1.logger.warn('[WALLET] AI deduction failed - insufficient balance', { orgId, requested: minutes, available: balanceBefore });
            return { success: false, error: 'Insufficient AI wallet balance' };
        }
        await trx('ai_wallet')
            .where({ organization_id: orgId })
            .update({
            balance_minutes: trx.raw('balance_minutes - ?', [minutes]),
            updated_at: trx.fn.now(),
        });
        await trx('ai_wallet_transactions').insert({
            organization_id: orgId,
            type: 'usage',
            amount_minutes: -minutes,
            description: description || `AI usage: ${minutes.toFixed(1)} minutes`,
        });
        logger_1.logger.info('[WALLET] AI wallet deducted', { orgId, minutes, balanceBefore, balanceAfter: balanceBefore - minutes, description });
        return { success: true };
    });
    // Audit log after successful transaction commit (fire-and-forget)
    if (result.success) {
        (0, audit_1.writeAuditLog)({
            organizationId: orgId,
            userId: 'system',
            action: 'wallet_deduction',
            entityType: 'ai_wallet',
            entityId: orgId,
            newValue: { minutes, description: description || `AI usage: ${minutes.toFixed(1)} minutes` },
        }).catch(() => { });
    }
    return result;
}
async function deductTranslationWallet(orgId, minutes, description) {
    const result = await db_1.default.transaction(async (trx) => {
        // Lock row to prevent concurrent deductions (TOCTOU race)
        const wallet = await trx('translation_wallet')
            .where({ organization_id: orgId })
            .forUpdate()
            .first();
        if (!wallet) {
            logger_1.logger.warn('[WALLET] Translation wallet not found', { orgId });
            return { success: false, error: 'Translation wallet not found' };
        }
        const balanceBefore = parseFloat(wallet.balance_minutes);
        if (balanceBefore < minutes) {
            logger_1.logger.warn('[WALLET] Translation deduction failed - insufficient balance', { orgId, requested: minutes, available: balanceBefore });
            return { success: false, error: 'Insufficient translation wallet balance' };
        }
        await trx('translation_wallet')
            .where({ organization_id: orgId })
            .update({
            balance_minutes: trx.raw('balance_minutes - ?', [minutes]),
            updated_at: trx.fn.now(),
        });
        await trx('translation_wallet_transactions').insert({
            organization_id: orgId,
            type: 'usage',
            amount_minutes: -minutes,
            description: description || `Translation usage: ${minutes.toFixed(1)} minutes`,
        });
        logger_1.logger.info('[WALLET] Translation wallet deducted', { orgId, minutes, balanceBefore, balanceAfter: balanceBefore - minutes, description });
        return { success: true };
    });
    // Audit log after successful transaction commit (fire-and-forget)
    if (result.success) {
        (0, audit_1.writeAuditLog)({
            organizationId: orgId,
            userId: 'system',
            action: 'wallet_deduction',
            entityType: 'translation_wallet',
            entityId: orgId,
            newValue: { minutes, description: description || `Translation usage: ${minutes.toFixed(1)} minutes` },
        }).catch(() => { });
    }
    return result;
}
async function getAiWalletHistory(orgId, limit = 50, offset = 0) {
    return (0, db_1.default)('ai_wallet_transactions')
        .where({ organization_id: orgId })
        .orderBy('created_at', 'desc')
        .limit(limit)
        .offset(offset);
}
async function getTranslationWalletHistory(orgId, limit = 50, offset = 0) {
    return (0, db_1.default)('translation_wallet_transactions')
        .where({ organization_id: orgId })
        .orderBy('created_at', 'desc')
        .limit(limit)
        .offset(offset);
}
// ── Invite Links ──────────────────────────────────────────
function generateInviteCode() {
    return crypto_1.default.randomBytes(4).toString('hex').toUpperCase();
}
async function createInviteLink(orgId, createdBy, role = 'member', maxUses, expiresAt) {
    const code = generateInviteCode();
    const [link] = await (0, db_1.default)('invite_links').insert({
        organization_id: orgId,
        code,
        role,
        max_uses: maxUses || null,
        expires_at: expiresAt || null,
        created_by: createdBy,
    }).returning('*');
    return link;
}
async function validateInviteLink(code) {
    const link = await (0, db_1.default)('invite_links').where({ code, is_active: true }).first();
    if (!link)
        return { valid: false, error: 'Invalid invite link' };
    if (link.expires_at && new Date(link.expires_at) < new Date()) {
        return { valid: false, error: 'Invite link has expired' };
    }
    if (link.max_uses && link.use_count >= link.max_uses) {
        return { valid: false, error: 'Invite link has reached its maximum uses' };
    }
    const organization = await (0, db_1.default)('organizations').where({ id: link.organization_id }).first();
    return { valid: true, link, organization };
}
async function useInviteLink(code, userId) {
    const validation = await validateInviteLink(code);
    if (!validation.valid)
        return validation;
    const { link, organization } = validation;
    // Check if already member
    const existing = await (0, db_1.default)('memberships').where({
        user_id: userId,
        organization_id: link.organization_id,
    }).first();
    if (existing) {
        if (existing.is_active)
            return { valid: false, error: 'Already a member of this organization' };
        await (0, db_1.default)('memberships').where({ id: existing.id }).update({ is_active: true, role: link.role });
    }
    else {
        // Check member limit
        const { allowed, current, max } = await checkMemberLimit(link.organization_id);
        if (!allowed) {
            return { valid: false, error: `Organization has reached its member limit (${current}/${max}). Upgrade the plan.` };
        }
        await (0, db_1.default)('memberships').insert({
            user_id: userId,
            organization_id: link.organization_id,
            role: link.role,
        });
    }
    // Add to General channel
    const general = await (0, db_1.default)('channels').where({ organization_id: link.organization_id, type: 'general' }).first();
    if (general) {
        await (0, db_1.default)('channel_members').insert({ channel_id: general.id, user_id: userId }).onConflict(['channel_id', 'user_id']).ignore();
    }
    // Increment use count
    await (0, db_1.default)('invite_links').where({ id: link.id }).update({ use_count: db_1.default.raw('use_count + 1') });
    return { valid: true, organization };
}
// ── Usage Records (Metering) ──────────────────────────────
async function startUsageRecord(orgId, serviceType, meetingId, userId) {
    const [record] = await (0, db_1.default)('usage_records').insert({
        organization_id: orgId,
        service_type: serviceType,
        meeting_id: meetingId,
        user_id: userId,
        status: 'active',
        started_at: db_1.default.fn.now(),
    }).returning('*');
    return record;
}
async function completeUsageRecord(recordId, durationMinutes, cost, currency) {
    await (0, db_1.default)('usage_records').where({ id: recordId }).update({
        duration_minutes: durationMinutes,
        cost,
        currency,
        status: 'completed',
        completed_at: db_1.default.fn.now(),
        updated_at: db_1.default.fn.now(),
    });
}
// ── Admin Adjustments ─────────────────────────────────────
async function adminAdjustAiWallet(orgId, minutes, description) {
    await db_1.default.transaction(async (trx) => {
        await trx('ai_wallet')
            .where({ organization_id: orgId })
            .update({
            balance_minutes: db_1.default.raw('GREATEST(balance_minutes + ?, 0)', [minutes]),
            updated_at: db_1.default.fn.now(),
        });
        await trx('ai_wallet_transactions').insert({
            organization_id: orgId,
            type: 'admin_adjustment',
            amount_minutes: minutes,
            description,
        });
    });
    return getAiWallet(orgId);
}
async function adminAdjustTranslationWallet(orgId, minutes, description) {
    await db_1.default.transaction(async (trx) => {
        await trx('translation_wallet')
            .where({ organization_id: orgId })
            .update({
            balance_minutes: db_1.default.raw('GREATEST(balance_minutes + ?, 0)', [minutes]),
            updated_at: db_1.default.fn.now(),
        });
        await trx('translation_wallet_transactions').insert({
            organization_id: orgId,
            type: 'admin_adjustment',
            amount_minutes: minutes,
            description,
        });
    });
    return getTranslationWallet(orgId);
}
// ── Platform Revenue ──────────────────────────────────────
async function getPlatformRevenue() {
    const subRevenue = await (0, db_1.default)('subscriptions')
        .where('amount_paid', '>', 0)
        .select(db_1.default.raw('COUNT(*) as total_subscriptions'), db_1.default.raw('COALESCE(SUM(amount_paid), 0) as total_subscription_revenue'))
        .first();
    const aiRevenue = await (0, db_1.default)('ai_wallet_transactions')
        .where({ type: 'topup' })
        .select(db_1.default.raw('COUNT(*) as total_topups'), db_1.default.raw('COALESCE(SUM(cost), 0) as total_ai_revenue'))
        .first();
    const translationRevenue = await (0, db_1.default)('translation_wallet_transactions')
        .where({ type: 'topup' })
        .select(db_1.default.raw('COUNT(*) as total_topups'), db_1.default.raw('COALESCE(SUM(cost), 0) as total_translation_revenue'))
        .first();
    const activeSubs = await (0, db_1.default)('subscriptions').where({ status: 'active' }).count('* as count').first();
    const expiredSubs = await (0, db_1.default)('subscriptions').where({ status: 'expired' }).count('* as count').first();
    const graceSubs = await (0, db_1.default)('subscriptions').where({ status: 'grace_period' }).count('* as count').first();
    return {
        subscriptions: {
            totalRevenue: parseFloat(subRevenue?.total_subscription_revenue || '0'),
            totalCount: parseInt(subRevenue?.total_subscriptions) || 0,
            active: parseInt(activeSubs?.count) || 0,
            expired: parseInt(expiredSubs?.count) || 0,
            grace: parseInt(graceSubs?.count) || 0,
        },
        aiWallet: {
            totalRevenue: parseFloat(aiRevenue?.total_ai_revenue || '0'),
            totalTopups: parseInt(aiRevenue?.total_topups) || 0,
        },
        translationWallet: {
            totalRevenue: parseFloat(translationRevenue?.total_translation_revenue || '0'),
            totalTopups: parseInt(translationRevenue?.total_topups) || 0,
        },
        totalRevenue: parseFloat(subRevenue?.total_subscription_revenue || '0') +
            parseFloat(aiRevenue?.total_ai_revenue || '0') +
            parseFloat(translationRevenue?.total_translation_revenue || '0'),
    };
}
//# sourceMappingURL=subscription.service.js.map