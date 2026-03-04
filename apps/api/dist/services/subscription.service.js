"use strict";
// ============================================================
// OrgsLedger — Subscription Service
// Plans, subscriptions, wallets, invites, metering, analytics
// ============================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.supportsDigitalSignatures = supportsDigitalSignatures;
exports.getLatestPlanSlugForOrg = getLatestPlanSlugForOrg;
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
const validators_1 = require("../utils/validators");
const crypto_1 = __importDefault(require("crypto"));
const FREE_TIER_MAX_MEMBERS = 5;
const INCLUDED_AI_HOURS_BY_PLAN = {
    starter: 4,
    standard: 10,
    professional: 30,
    enterprise: 150,
    enterprise_pro: 150,
};
// Plans that support digital meeting signatures (Professional+)
const SIGNATURE_ENABLED_PLANS = ['professional', 'enterprise', 'enterprise_pro'];
function getIncludedAiMinutesForPlanSlug(slug) {
    if (!slug)
        return 0;
    const hours = INCLUDED_AI_HOURS_BY_PLAN[slug.toLowerCase()] ?? 0;
    return hours * 60;
}
function supportsDigitalSignatures(planSlug) {
    if (!planSlug)
        return false;
    return SIGNATURE_ENABLED_PLANS.includes(planSlug.toLowerCase());
}
async function getLatestPlanSlugForOrg(orgId) {
    const subQuery = (0, db_1.default)('subscriptions').where({ organization_id: orgId });
    const sub = typeof subQuery.orderBy === 'function'
        ? await subQuery.orderBy('created_at', 'desc').first()
        : await subQuery.first();
    if (!sub?.plan_id)
        return null;
    const plan = await (0, db_1.default)('subscription_plans')
        .where({ id: sub.plan_id })
        .select('slug')
        .first();
    return plan?.slug || null;
}
async function applyIncludedAiMinutesTx(trx, params) {
    if (!params.minutes || params.minutes <= 0)
        return;
    let wallet = await trx('wallet')
        .where({ organization_id: params.orgId, service_type: 'ai' })
        .forUpdate()
        .first();
    if (!wallet) {
        const [created] = await trx('wallet')
            .insert({
            organization_id: params.orgId,
            service_type: 'ai',
            balance_minutes: 0,
            currency: params.currency || 'USD',
            price_per_hour_usd: 10.00,
            price_per_hour_ngn: 18000.00,
        })
            .returning('*');
        wallet = created;
    }
    const balanceBefore = parseFloat(wallet.balance_minutes || '0');
    const balanceAfter = balanceBefore + params.minutes;
    const txCurrency = params.currency || wallet.currency || 'USD';
    await trx('wallet')
        .where({ organization_id: params.orgId, service_type: 'ai' })
        .update({
        balance_minutes: trx.raw('balance_minutes + ?', [params.minutes]),
        total_topped_up: trx.raw('COALESCE(total_topped_up, 0) + ?', [params.minutes]),
        updated_at: trx.fn.now(),
    });
    await trx('wallet_transactions').insert({
        wallet_id: wallet.id,
        organization_id: params.orgId,
        service_type: 'ai',
        type: 'bonus',
        amount_minutes: params.minutes,
        balance_after: balanceAfter,
        cost: 0,
        currency: txCurrency,
        description: params.description,
    });
}
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
    const maxMembers = sub?.plan?.max_members || FREE_TIER_MAX_MEMBERS;
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
    const graceEnd = sub.grace_period_end ? new Date(sub.grace_period_end) : new Date(periodEnd);
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
    const safeCreatedBy = (0, validators_1.isUUID)(params.createdBy) ? params.createdBy : null;
    const plan = await getPlanById(params.planId);
    const includedAiMinutes = initialStatus === 'active'
        ? getIncludedAiMinutesForPlanSlug(plan?.slug)
        : 0;
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
    // Wrap all subscription writes in a single transaction for atomicity
    const sub = await db_1.default.transaction(async (trx) => {
        // Deactivate ALL old subscriptions (including expired) so the LEFT JOIN
        // in GET /admin/organizations never produces duplicate rows per org
        await trx('subscriptions')
            .where({ organization_id: params.organizationId })
            .whereIn('status', ['active', 'grace_period', 'expired'])
            .update({ status: 'cancelled', updated_at: trx.fn.now() });
        const [newSub] = await trx('subscriptions').insert({
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
            created_by: safeCreatedBy,
        }).returning('*');
        // Update org
        await trx('organizations').where({ id: params.organizationId }).update({
            subscription_status: initialStatus === 'active' ? 'active' : 'pending',
            billing_currency: params.currency,
            billing_country: params.billingCountry,
        });
        // Log history
        await trx('subscription_history').insert({
            subscription_id: newSub.id,
            organization_id: params.organizationId,
            action: 'created',
            metadata: JSON.stringify({ planId: params.planId, amountPaid: params.amountPaid, cycle: params.billingCycle }),
        });
        if (includedAiMinutes > 0) {
            await applyIncludedAiMinutesTx(trx, {
                orgId: params.organizationId,
                minutes: includedAiMinutes,
                currency: params.currency,
                description: `Plan included AI credits (${(includedAiMinutes / 60).toFixed(0)}h) - ${plan?.slug || 'plan'} ${params.billingCycle}`,
            });
        }
        return newSub;
    });
    logger_1.logger.info('[SUB] Subscription created', {
        orgId: params.organizationId,
        planId: params.planId,
        cycle: params.billingCycle,
        currency: params.currency,
        amountPaid: params.amountPaid,
        periodEnd: periodEnd.toISOString(),
        gateway: params.paymentGateway || 'none',
        createdBy: safeCreatedBy || 'system',
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
    const renewalPlan = await (0, db_1.default)('subscription_plans').where({ id: sub.plan_id }).select('slug').first();
    const includedAiMinutes = getIncludedAiMinutesForPlanSlug(renewalPlan?.slug);
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
    // Wrap renewal in a transaction for atomicity
    await db_1.default.transaction(async (trx) => {
        await trx('subscriptions').where({ id: sub.id }).update({
            status: 'active',
            amount_paid: amountPaid,
            current_period_start: now.toISOString(),
            current_period_end: newEnd.toISOString(),
            grace_period_end: graceEnd.toISOString(),
            gateway_subscription_id: paymentRef || sub.gateway_subscription_id,
            updated_at: trx.fn.now(),
        });
        await trx('organizations').where({ id: orgId }).update({ subscription_status: 'active' });
        await trx('subscription_history').insert({
            subscription_id: sub.id,
            organization_id: orgId,
            action: 'renewed',
            metadata: JSON.stringify({ amountPaid, paymentRef }),
        });
        if (includedAiMinutes > 0) {
            await applyIncludedAiMinutesTx(trx, {
                orgId,
                minutes: includedAiMinutes,
                currency: sub.currency,
                description: `Plan included AI credits (${(includedAiMinutes / 60).toFixed(0)}h) - ${renewalPlan?.slug || 'plan'} renewal`,
            });
        }
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
// Unified wallet getter (internal)
async function getWallet(orgId, serviceType) {
    let wallet = await (0, db_1.default)('wallet')
        .where({ organization_id: orgId, service_type: serviceType })
        .first();
    if (!wallet) {
        // Use org's billing currency instead of hardcoded USD
        const org = await (0, db_1.default)('organizations').where({ id: orgId }).select('billing_currency').first();
        const currency = org?.billing_currency || 'USD';
        if (serviceType === 'ai') {
            const planSlug = await getLatestPlanSlugForOrg(orgId);
            const includedAiMinutes = getIncludedAiMinutesForPlanSlug(planSlug);
            [wallet] = await (0, db_1.default)('wallet').insert({
                organization_id: orgId,
                service_type: 'ai',
                balance_minutes: includedAiMinutes,
                currency,
                price_per_hour_usd: 10.00,
                price_per_hour_ngn: 18000.00,
            }).returning('*');
        }
        else {
            // Default 60 minutes so new orgs can use live translation out of the box
            [wallet] = await (0, db_1.default)('wallet').insert({
                organization_id: orgId,
                service_type: 'translation',
                balance_minutes: 60,
                currency,
                price_per_hour_usd: 25.00,
                price_per_hour_ngn: 45000.00,
            }).returning('*');
        }
    }
    return wallet;
}
async function getAiWallet(orgId) {
    return getWallet(orgId, 'ai');
}
async function getTranslationWallet(orgId) {
    return getWallet(orgId, 'translation');
}
async function topUpAiWallet(params) {
    await db_1.default.transaction(async (trx) => {
        // Lock wallet row to prevent concurrent top-up race conditions
        const wallet = await trx('wallet')
            .where({ organization_id: params.orgId, service_type: 'ai' })
            .forUpdate()
            .first();
        if (!wallet) {
            throw new Error('AI wallet not found for top-up');
        }
        const balanceBefore = parseFloat(wallet.balance_minutes);
        const balanceAfter = balanceBefore + params.minutes;
        await trx('wallet')
            .where({ organization_id: params.orgId, service_type: 'ai' })
            .update({
            balance_minutes: trx.raw('balance_minutes + ?', [params.minutes]),
            total_topped_up: trx.raw('COALESCE(total_topped_up, 0) + ?', [params.minutes]),
            updated_at: trx.fn.now(),
        });
        await trx('wallet_transactions').insert({
            wallet_id: wallet.id,
            organization_id: params.orgId,
            service_type: 'ai',
            type: 'topup',
            amount_minutes: params.minutes,
            balance_after: balanceAfter,
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
        // Lock wallet row to prevent concurrent top-up race conditions
        const wallet = await trx('wallet')
            .where({ organization_id: params.orgId, service_type: 'translation' })
            .forUpdate()
            .first();
        if (!wallet) {
            throw new Error('Translation wallet not found for top-up');
        }
        const balanceBefore = parseFloat(wallet.balance_minutes);
        const balanceAfter = balanceBefore + params.minutes;
        await trx('wallet')
            .where({ organization_id: params.orgId, service_type: 'translation' })
            .update({
            balance_minutes: trx.raw('balance_minutes + ?', [params.minutes]),
            total_topped_up: trx.raw('COALESCE(total_topped_up, 0) + ?', [params.minutes]),
            updated_at: trx.fn.now(),
        });
        await trx('wallet_transactions').insert({
            wallet_id: wallet.id,
            organization_id: params.orgId,
            service_type: 'translation',
            type: 'topup',
            amount_minutes: params.minutes,
            balance_after: balanceAfter,
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
        const wallet = await trx('wallet')
            .where({ organization_id: orgId, service_type: 'ai' })
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
        await trx('wallet')
            .where({ organization_id: orgId, service_type: 'ai' })
            .update({
            balance_minutes: trx.raw('balance_minutes - ?', [minutes]),
            updated_at: trx.fn.now(),
        });
        await trx('wallet_transactions').insert({
            wallet_id: wallet.id,
            organization_id: orgId,
            service_type: 'ai',
            type: 'usage',
            amount_minutes: -minutes,
            balance_after: balanceBefore - minutes,
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
        }).catch(err => logger_1.logger.warn('Audit log failed (AI wallet deduction)', err));
    }
    return result;
}
async function deductTranslationWallet(orgId, minutes, description) {
    const result = await db_1.default.transaction(async (trx) => {
        // Lock row to prevent concurrent deductions (TOCTOU race)
        const wallet = await trx('wallet')
            .where({ organization_id: orgId, service_type: 'translation' })
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
        await trx('wallet')
            .where({ organization_id: orgId, service_type: 'translation' })
            .update({
            balance_minutes: trx.raw('balance_minutes - ?', [minutes]),
            updated_at: trx.fn.now(),
        });
        await trx('wallet_transactions').insert({
            wallet_id: wallet.id,
            organization_id: orgId,
            service_type: 'translation',
            type: 'usage',
            amount_minutes: -minutes,
            balance_after: balanceBefore - minutes,
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
        }).catch(err => logger_1.logger.warn('Audit log failed (translation wallet deduction)', err));
    }
    return result;
}
async function getAiWalletHistory(orgId, limit = 50, offset = 0) {
    return (0, db_1.default)('wallet_transactions')
        .where({ organization_id: orgId, service_type: 'ai' })
        .orderBy('created_at', 'desc')
        .limit(limit)
        .offset(offset);
}
async function getTranslationWalletHistory(orgId, limit = 50, offset = 0) {
    return (0, db_1.default)('wallet_transactions')
        .where({ organization_id: orgId, service_type: 'translation' })
        .orderBy('created_at', 'desc')
        .limit(limit)
        .offset(offset);
}
// ── Invite Links ──────────────────────────────────────────
function generateInviteCode() {
    return crypto_1.default.randomBytes(4).toString('hex').toUpperCase();
}
async function createInviteLink(orgId, createdBy, role = 'member', maxUses, expiresAt, description) {
    const safeCreatedBy = (0, validators_1.isUUID)(createdBy) ? createdBy : null;
    const code = generateInviteCode();
    // Build insert object - only include description if provided (column may not exist in older DBs)
    const insertData = {
        organization_id: orgId,
        code,
        role,
        max_uses: maxUses || null,
        expires_at: expiresAt || null,
        created_by: safeCreatedBy,
    };
    // Only add description if provided (avoids error if column doesn't exist)
    if (description?.trim()) {
        insertData.description = description.trim();
    }
    const [link] = await (0, db_1.default)('invite_links').insert(insertData).returning('*');
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
    return db_1.default.transaction(async (trx) => {
        // Lock the invite link row to prevent concurrent use_count bypass
        const link = await trx('invite_links')
            .where({ code, is_active: true })
            .forUpdate()
            .first();
        if (!link)
            return { valid: false, error: 'Invalid or expired invite link' };
        if (link.max_uses && link.use_count >= link.max_uses) {
            return { valid: false, error: 'This invite link has reached its maximum uses' };
        }
        if (link.expires_at && new Date(link.expires_at) < new Date()) {
            return { valid: false, error: 'This invite link has expired' };
        }
        const organization = await trx('organizations').where({ id: link.organization_id }).first();
        if (!organization)
            return { valid: false, error: 'Organization not found' };
        // Check if already member
        const existing = await trx('memberships').where({
            user_id: userId,
            organization_id: link.organization_id,
        }).first();
        if (existing) {
            if (existing.is_active)
                return { valid: false, error: 'Already a member of this organization' };
            await trx('memberships').where({ id: existing.id }).update({ is_active: true, role: link.role });
        }
        else {
            // Check member limit
            const memberCount = await trx('memberships')
                .where({ organization_id: link.organization_id, is_active: true })
                .count('* as count')
                .first();
            const sub = await trx('subscriptions')
                .where({ organization_id: link.organization_id, status: 'active' })
                .first();
            let maxMembers = FREE_TIER_MAX_MEMBERS; // free tier default
            if (sub) {
                const plan = await trx('subscription_plans').where({ id: sub.plan_id }).first();
                maxMembers = plan?.max_members || FREE_TIER_MAX_MEMBERS;
            }
            const current = parseInt(String(memberCount?.count || 0));
            if (current >= maxMembers) {
                return { valid: false, error: `Organization has reached its member limit (${current}/${maxMembers}). Upgrade the plan.` };
            }
            await trx('memberships').insert({
                user_id: userId,
                organization_id: link.organization_id,
                role: link.role,
            });
        }
        // Add to General channel
        const general = await trx('channels').where({ organization_id: link.organization_id, type: 'general' }).first();
        if (general) {
            await trx('channel_members').insert({ channel_id: general.id, user_id: userId }).onConflict(['channel_id', 'user_id']).ignore();
        }
        // Increment use count
        await trx('invite_links').where({ id: link.id }).update({ use_count: trx.raw('use_count + 1') });
        return { valid: true, organization };
    });
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
        const wallet = await trx('wallet')
            .where({ organization_id: orgId, service_type: 'ai' })
            .forUpdate()
            .first();
        const balanceBefore = parseFloat(wallet.balance_minutes);
        const balanceAfter = Math.max(balanceBefore + minutes, 0);
        await trx('wallet')
            .where({ organization_id: orgId, service_type: 'ai' })
            .update({
            balance_minutes: db_1.default.raw('GREATEST(balance_minutes + ?, 0)', [minutes]),
            updated_at: db_1.default.fn.now(),
        });
        await trx('wallet_transactions').insert({
            wallet_id: wallet.id,
            organization_id: orgId,
            service_type: 'ai',
            type: 'admin_adjustment',
            amount_minutes: minutes,
            balance_after: balanceAfter,
            description,
        });
    });
    return getAiWallet(orgId);
}
async function adminAdjustTranslationWallet(orgId, minutes, description) {
    await db_1.default.transaction(async (trx) => {
        const wallet = await trx('wallet')
            .where({ organization_id: orgId, service_type: 'translation' })
            .forUpdate()
            .first();
        const balanceBefore = parseFloat(wallet.balance_minutes);
        const balanceAfter = Math.max(balanceBefore + minutes, 0);
        await trx('wallet')
            .where({ organization_id: orgId, service_type: 'translation' })
            .update({
            balance_minutes: db_1.default.raw('GREATEST(balance_minutes + ?, 0)', [minutes]),
            updated_at: db_1.default.fn.now(),
        });
        await trx('wallet_transactions').insert({
            wallet_id: wallet.id,
            organization_id: orgId,
            service_type: 'translation',
            type: 'admin_adjustment',
            amount_minutes: minutes,
            balance_after: balanceAfter,
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
    const aiRevenue = await (0, db_1.default)('wallet_transactions')
        .where({ type: 'topup', service_type: 'ai' })
        .select(db_1.default.raw('COUNT(*) as total_topups'), db_1.default.raw('COALESCE(SUM(cost), 0) as total_ai_revenue'))
        .first();
    const translationRevenue = await (0, db_1.default)('wallet_transactions')
        .where({ type: 'topup', service_type: 'translation' })
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