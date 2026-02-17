// ============================================================
// OrgsLedger — Subscription Service
// Plans, subscriptions, wallets, invites, metering, analytics
// ============================================================

import db from '../db';
import { logger } from '../logger';
import { writeAuditLog } from '../middleware/audit';
import { isUUID } from '../utils/validators';
import crypto from 'crypto';

// ── Currency Helpers ──────────────────────────────────────
export function isNigeria(country?: string | null): boolean {
  if (!country) return false;
  return ['ng', 'nga', 'nigeria'].includes(country.toLowerCase());
}

export function getCurrency(country?: string | null): 'USD' | 'NGN' {
  return isNigeria(country) ? 'NGN' : 'USD';
}

// ── Plans ─────────────────────────────────────────────────
export async function getPlans() {
  return db('subscription_plans').where({ is_active: true }).orderBy('sort_order', 'asc');
}

export async function getPlanById(id: string) {
  return db('subscription_plans').where({ id }).first();
}

export async function getPlanBySlug(slug: string) {
  return db('subscription_plans').where({ slug }).first();
}

export function getPlanPrice(plan: any, currency: 'USD' | 'NGN', cycle: 'annual' | 'monthly' = 'annual'): number {
  let price: number;
  const parse = (v: any) => { const n = parseFloat(v); return isNaN(n) ? null : n; };
  if (currency === 'NGN') {
    price = cycle === 'monthly'
      ? (parse(plan.price_ngn_monthly) ?? (parse(plan.price_ngn_annual) ?? 0) / 12)
      : (parse(plan.price_ngn_annual) ?? 0);
  } else {
    price = cycle === 'monthly'
      ? (parse(plan.price_usd_monthly) ?? (parse(plan.price_usd_annual) ?? 0) / 12)
      : (parse(plan.price_usd_annual) ?? 0);
  }
  return Math.round(price * 100) / 100;
}

// ── Member Limit Check ────────────────────────────────────
export async function checkMemberLimit(orgId: string): Promise<{ allowed: boolean; current: number; max: number }> {
  const sub = await getOrgSubscription(orgId);
  const maxMembers = sub?.plan?.max_members || 100;
  const countResult = await db('memberships')
    .where({ organization_id: orgId, is_active: true })
    .count('id as count')
    .first();
  const current = parseInt(countResult?.count as string) || 0;
  return { allowed: current < maxMembers, current, max: maxMembers };
}

// ── Subscriptions ─────────────────────────────────────────
export async function getOrgSubscription(orgId: string) {
  const sub = await db('subscriptions')
    .where({ organization_id: orgId })
    .orderBy('created_at', 'desc')
    .first();

  if (!sub) return null;

  const plan = await getPlanById(sub.plan_id);
  const now = new Date();
  const periodEnd = new Date(sub.current_period_end);
  const graceEnd = new Date(sub.grace_period_end);

  // Auto-transition status
  if (sub.status === 'active' && now > periodEnd) {
    if (now <= graceEnd) {
      await db('subscriptions').where({ id: sub.id }).update({ status: 'grace_period', updated_at: db.fn.now() });
      await db('organizations').where({ id: orgId }).update({ subscription_status: 'grace_period' });
      sub.status = 'grace_period';
    } else {
      await db('subscriptions').where({ id: sub.id }).update({ status: 'expired', updated_at: db.fn.now() });
      await db('organizations').where({ id: orgId }).update({ subscription_status: 'expired' });
      sub.status = 'expired';
    }
  } else if (sub.status === 'grace_period' && now > graceEnd) {
    await db('subscriptions').where({ id: sub.id }).update({ status: 'expired', updated_at: db.fn.now() });
    await db('organizations').where({ id: orgId }).update({ subscription_status: 'expired' });
    sub.status = 'expired';
  }

  return { ...sub, plan };
}

export async function createSubscription(params: {
  organizationId: string;
  planId: string;
  billingCycle: 'annual' | 'monthly';
  currency: 'USD' | 'NGN';
  billingCountry?: string;
  amountPaid: number;
  paymentGateway?: string;
  gatewaySubscriptionId?: string;
  createdBy?: string;
  status?: 'active' | 'pending';
}) {
  const initialStatus = params.status || 'active';
  const safeCreatedBy = isUUID(params.createdBy) ? params.createdBy : null;
  const now = new Date();
  const periodEnd = new Date(now);
  if (params.billingCycle === 'monthly') {
    periodEnd.setMonth(periodEnd.getMonth() + 1);
  } else {
    periodEnd.setFullYear(periodEnd.getFullYear() + 1);
  }
  const graceEnd = new Date(periodEnd);
  graceEnd.setDate(graceEnd.getDate() + 7);

  // Wrap all subscription writes in a single transaction for atomicity
  const sub = await db.transaction(async (trx) => {
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

    return newSub;
  });

  logger.info('[SUB] Subscription created', {
    orgId: params.organizationId,
    planId: params.planId,
    cycle: params.billingCycle,
    currency: params.currency,
    amountPaid: params.amountPaid,
    periodEnd: periodEnd.toISOString(),
    gateway: params.paymentGateway || 'none',
    createdBy: safeCreatedBy || 'system',
  });

  await writeAuditLog({
    organizationId: params.organizationId,
    userId: params.createdBy || 'system',
    action: 'subscription_created',
    entityType: 'subscription',
    entityId: sub.id,
    newValue: { planId: params.planId, billingCycle: params.billingCycle, currency: params.currency, amountPaid: params.amountPaid, periodEnd: periodEnd.toISOString() },
  });

  return sub;
}

export async function renewSubscription(orgId: string, amountPaid: number, paymentRef?: string) {
  const sub = await db('subscriptions')
    .where({ organization_id: orgId })
    .orderBy('created_at', 'desc')
    .first();

  if (!sub) throw new Error('No subscription to renew');

  const now = new Date();
  const base = new Date(sub.current_period_end) > now ? new Date(sub.current_period_end) : now;
  const newEnd = new Date(base);
  if (sub.billing_cycle === 'monthly') {
    newEnd.setMonth(newEnd.getMonth() + 1);
  } else {
    newEnd.setFullYear(newEnd.getFullYear() + 1);
  }
  const graceEnd = new Date(newEnd);
  graceEnd.setDate(graceEnd.getDate() + 7);

  // Wrap renewal in a transaction for atomicity
  await db.transaction(async (trx) => {
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
  });

  await writeAuditLog({
    organizationId: orgId,
    userId: 'system',
    action: 'subscription_renewed',
    entityType: 'subscription',
    entityId: sub.id,
    previousValue: { status: sub.status, periodEnd: sub.current_period_end },
    newValue: { status: 'active', periodEnd: newEnd.toISOString(), amountPaid },
  });

  return db('subscriptions').where({ id: sub.id }).first();
}

// ── Wallets ───────────────────────────────────────────────
export async function getAiWallet(orgId: string) {
  let wallet = await db('ai_wallet').where({ organization_id: orgId }).first();
  if (!wallet) {
    // Use org's billing currency instead of hardcoded USD
    const org = await db('organizations').where({ id: orgId }).select('billing_currency').first();
    const currency = org?.billing_currency || 'USD';
    [wallet] = await db('ai_wallet').insert({ organization_id: orgId, balance_minutes: 0, currency }).returning('*');
  }
  return wallet;
}

export async function getTranslationWallet(orgId: string) {
  let wallet = await db('translation_wallet').where({ organization_id: orgId }).first();
  if (!wallet) {
    // Use org's billing currency instead of hardcoded USD
    const org = await db('organizations').where({ id: orgId }).select('billing_currency').first();
    const currency = org?.billing_currency || 'USD';
    [wallet] = await db('translation_wallet').insert({ organization_id: orgId, balance_minutes: 0, currency }).returning('*');
  }
  return wallet;
}

export async function topUpAiWallet(params: {
  orgId: string;
  minutes: number;
  cost: number;
  currency: string;
  paymentRef?: string;
  paymentGateway?: string;
}) {
  await db.transaction(async (trx) => {
    // Lock wallet row to prevent concurrent top-up race conditions
    const wallet = await trx('ai_wallet').where({ organization_id: params.orgId }).forUpdate().first();
    if (!wallet) {
      throw new Error('AI wallet not found for top-up');
    }
    const balanceBefore = parseFloat(wallet.balance_minutes);
    const balanceAfter = balanceBefore + params.minutes;
    await trx('ai_wallet')
      .where({ organization_id: params.orgId })
      .update({
        balance_minutes: trx.raw('balance_minutes + ?', [params.minutes]),
        total_topped_up: trx.raw('COALESCE(total_topped_up, 0) + ?', [params.minutes]),
        updated_at: trx.fn.now(),
      });

    await trx('ai_wallet_transactions').insert({
      wallet_id: wallet.id,
      organization_id: params.orgId,
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

  logger.info('[WALLET] AI wallet topped up', {
    orgId: params.orgId,
    minutes: params.minutes,
    hours: (params.minutes / 60).toFixed(1),
    cost: params.cost,
    currency: params.currency,
    gateway: params.paymentGateway || 'none',
  });

  await writeAuditLog({
    organizationId: params.orgId,
    userId: 'system',
    action: 'wallet_topup',
    entityType: 'ai_wallet',
    entityId: params.orgId,
    newValue: { minutes: params.minutes, hours: +(params.minutes / 60).toFixed(1), cost: params.cost, currency: params.currency, gateway: params.paymentGateway || 'none' },
  });

  return getAiWallet(params.orgId);
}

export async function topUpTranslationWallet(params: {
  orgId: string;
  minutes: number;
  cost: number;
  currency: string;
  paymentRef?: string;
  paymentGateway?: string;
}) {
  await db.transaction(async (trx) => {
    // Lock wallet row to prevent concurrent top-up race conditions
    const wallet = await trx('translation_wallet').where({ organization_id: params.orgId }).forUpdate().first();
    if (!wallet) {
      throw new Error('Translation wallet not found for top-up');
    }
    const balanceBefore = parseFloat(wallet.balance_minutes);
    const balanceAfter = balanceBefore + params.minutes;
    await trx('translation_wallet')
      .where({ organization_id: params.orgId })
      .update({
        balance_minutes: trx.raw('balance_minutes + ?', [params.minutes]),
        total_topped_up: trx.raw('COALESCE(total_topped_up, 0) + ?', [params.minutes]),
        updated_at: trx.fn.now(),
      });

    await trx('translation_wallet_transactions').insert({
      wallet_id: wallet.id,
      organization_id: params.orgId,
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

  logger.info('[WALLET] Translation wallet topped up', {
    orgId: params.orgId,
    minutes: params.minutes,
    hours: (params.minutes / 60).toFixed(1),
    cost: params.cost,
    currency: params.currency,
    gateway: params.paymentGateway || 'none',
  });

  await writeAuditLog({
    organizationId: params.orgId,
    userId: 'system',
    action: 'wallet_topup',
    entityType: 'translation_wallet',
    entityId: params.orgId,
    newValue: { minutes: params.minutes, hours: +(params.minutes / 60).toFixed(1), cost: params.cost, currency: params.currency, gateway: params.paymentGateway || 'none' },
  });

  return getTranslationWallet(params.orgId);
}

export async function deductAiWallet(orgId: string, minutes: number, description?: string) {
  const result = await db.transaction(async (trx) => {
    // Lock row to prevent concurrent deductions (TOCTOU race)
    const wallet = await trx('ai_wallet')
      .where({ organization_id: orgId })
      .forUpdate()
      .first();

    if (!wallet) {
      logger.warn('[WALLET] AI wallet not found', { orgId });
      return { success: false, error: 'AI wallet not found' };
    }

    const balanceBefore = parseFloat(wallet.balance_minutes);
    if (balanceBefore < minutes) {
      logger.warn('[WALLET] AI deduction failed - insufficient balance', { orgId, requested: minutes, available: balanceBefore });
      return { success: false, error: 'Insufficient AI wallet balance' };
    }

    await trx('ai_wallet')
      .where({ organization_id: orgId })
      .update({
        balance_minutes: trx.raw('balance_minutes - ?', [minutes]),
        updated_at: trx.fn.now(),
      });

    await trx('ai_wallet_transactions').insert({
      wallet_id: wallet.id,
      organization_id: orgId,
      type: 'usage',
      amount_minutes: -minutes,
      balance_after: balanceBefore - minutes,
      description: description || `AI usage: ${minutes.toFixed(1)} minutes`,
    });

    logger.info('[WALLET] AI wallet deducted', { orgId, minutes, balanceBefore, balanceAfter: balanceBefore - minutes, description });

    return { success: true };
  });

  // Audit log after successful transaction commit (fire-and-forget)
  if (result.success) {
    writeAuditLog({
      organizationId: orgId,
      userId: 'system',
      action: 'wallet_deduction',
      entityType: 'ai_wallet',
      entityId: orgId,
      newValue: { minutes, description: description || `AI usage: ${minutes.toFixed(1)} minutes` },
    }).catch(err => logger.warn('Audit log failed (AI wallet deduction)', err));
  }

  return result;
}

export async function deductTranslationWallet(orgId: string, minutes: number, description?: string) {
  const result = await db.transaction(async (trx) => {
    // Lock row to prevent concurrent deductions (TOCTOU race)
    const wallet = await trx('translation_wallet')
      .where({ organization_id: orgId })
      .forUpdate()
      .first();

    if (!wallet) {
      logger.warn('[WALLET] Translation wallet not found', { orgId });
      return { success: false, error: 'Translation wallet not found' };
    }

    const balanceBefore = parseFloat(wallet.balance_minutes);
    if (balanceBefore < minutes) {
      logger.warn('[WALLET] Translation deduction failed - insufficient balance', { orgId, requested: minutes, available: balanceBefore });
      return { success: false, error: 'Insufficient translation wallet balance' };
    }

    await trx('translation_wallet')
      .where({ organization_id: orgId })
      .update({
        balance_minutes: trx.raw('balance_minutes - ?', [minutes]),
        updated_at: trx.fn.now(),
      });

    await trx('translation_wallet_transactions').insert({
      wallet_id: wallet.id,
      organization_id: orgId,
      type: 'usage',
      amount_minutes: -minutes,
      balance_after: balanceBefore - minutes,
      description: description || `Translation usage: ${minutes.toFixed(1)} minutes`,
    });

    logger.info('[WALLET] Translation wallet deducted', { orgId, minutes, balanceBefore, balanceAfter: balanceBefore - minutes, description });

    return { success: true };
  });

  // Audit log after successful transaction commit (fire-and-forget)
  if (result.success) {
    writeAuditLog({
      organizationId: orgId,
      userId: 'system',
      action: 'wallet_deduction',
      entityType: 'translation_wallet',
      entityId: orgId,
      newValue: { minutes, description: description || `Translation usage: ${minutes.toFixed(1)} minutes` },
    }).catch(err => logger.warn('Audit log failed (translation wallet deduction)', err));
  }

  return result;
}

export async function getAiWalletHistory(orgId: string, limit = 50, offset = 0) {
  return db('ai_wallet_transactions')
    .where({ organization_id: orgId })
    .orderBy('created_at', 'desc')
    .limit(limit)
    .offset(offset);
}

export async function getTranslationWalletHistory(orgId: string, limit = 50, offset = 0) {
  return db('translation_wallet_transactions')
    .where({ organization_id: orgId })
    .orderBy('created_at', 'desc')
    .limit(limit)
    .offset(offset);
}

// ── Invite Links ──────────────────────────────────────────
function generateInviteCode(): string {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

export async function createInviteLink(
  orgId: string,
  createdBy?: string | null,
  role: string = 'member',
  maxUses?: number,
  expiresAt?: string,
  description?: string
) {
  const safeCreatedBy = isUUID(createdBy) ? createdBy : null;
  const code = generateInviteCode();
  
  // Build insert object - only include description if provided (column may not exist in older DBs)
  const insertData: Record<string, any> = {
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
  
  const [link] = await db('invite_links').insert(insertData).returning('*');
  return link;
}

export async function validateInviteLink(code: string) {
  const link = await db('invite_links').where({ code, is_active: true }).first();
  if (!link) return { valid: false, error: 'Invalid invite link' };

  if (link.expires_at && new Date(link.expires_at) < new Date()) {
    return { valid: false, error: 'Invite link has expired' };
  }

  if (link.max_uses && link.use_count >= link.max_uses) {
    return { valid: false, error: 'Invite link has reached its maximum uses' };
  }

  const organization = await db('organizations').where({ id: link.organization_id }).first();
  return { valid: true, link, organization };
}

export async function useInviteLink(code: string, userId: string) {
  const validation = await validateInviteLink(code);
  if (!validation.valid) return validation;

  const { link, organization } = validation;

  // Check if already member
  const existing = await db('memberships').where({
    user_id: userId,
    organization_id: link.organization_id,
  }).first();

  if (existing) {
    if (existing.is_active) return { valid: false, error: 'Already a member of this organization' };
    await db('memberships').where({ id: existing.id }).update({ is_active: true, role: link.role });
  } else {
    // Check member limit
    const { allowed, current, max } = await checkMemberLimit(link.organization_id);
    if (!allowed) {
      return { valid: false, error: `Organization has reached its member limit (${current}/${max}). Upgrade the plan.` };
    }

    await db('memberships').insert({
      user_id: userId,
      organization_id: link.organization_id,
      role: link.role,
    });
  }

  // Add to General channel
  const general = await db('channels').where({ organization_id: link.organization_id, type: 'general' }).first();
  if (general) {
    await db('channel_members').insert({ channel_id: general.id, user_id: userId }).onConflict(['channel_id', 'user_id']).ignore();
  }

  // Increment use count
  await db('invite_links').where({ id: link.id }).update({ use_count: db.raw('use_count + 1') });

  return { valid: true, organization };
}

// ── Usage Records (Metering) ──────────────────────────────
export async function startUsageRecord(orgId: string, serviceType: 'ai' | 'translation', meetingId?: string, userId?: string) {
  const [record] = await db('usage_records').insert({
    organization_id: orgId,
    service_type: serviceType,
    meeting_id: meetingId,
    user_id: userId,
    status: 'active',
    started_at: db.fn.now(),
  }).returning('*');
  return record;
}

export async function completeUsageRecord(recordId: string, durationMinutes: number, cost: number, currency?: string) {
  await db('usage_records').where({ id: recordId }).update({
    duration_minutes: durationMinutes,
    cost,
    currency,
    status: 'completed',
    completed_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
}

// ── Admin Adjustments ─────────────────────────────────────
export async function adminAdjustAiWallet(orgId: string, minutes: number, description: string) {
  await db.transaction(async (trx) => {
    const wallet = await trx('ai_wallet').where({ organization_id: orgId }).first();
    const balanceBefore = parseFloat(wallet.balance_minutes);
    const balanceAfter = Math.max(balanceBefore + minutes, 0);
    await trx('ai_wallet')
      .where({ organization_id: orgId })
      .update({
        balance_minutes: db.raw('GREATEST(balance_minutes + ?, 0)', [minutes]),
        updated_at: db.fn.now(),
      });

    await trx('ai_wallet_transactions').insert({
      wallet_id: wallet.id,
      organization_id: orgId,
      type: 'admin_adjustment',
      amount_minutes: minutes,
      balance_after: balanceAfter,
      description,
    });
  });

  return getAiWallet(orgId);
}

export async function adminAdjustTranslationWallet(orgId: string, minutes: number, description: string) {
  await db.transaction(async (trx) => {
    const wallet = await trx('translation_wallet').where({ organization_id: orgId }).first();
    const balanceBefore = parseFloat(wallet.balance_minutes);
    const balanceAfter = Math.max(balanceBefore + minutes, 0);
    await trx('translation_wallet')
      .where({ organization_id: orgId })
      .update({
        balance_minutes: db.raw('GREATEST(balance_minutes + ?, 0)', [minutes]),
        updated_at: db.fn.now(),
      });

    await trx('translation_wallet_transactions').insert({
      wallet_id: wallet.id,
      organization_id: orgId,
      type: 'admin_adjustment',
      amount_minutes: minutes,
      balance_after: balanceAfter,
      description,
    });
  });

  return getTranslationWallet(orgId);
}

// ── Platform Revenue ──────────────────────────────────────
export async function getPlatformRevenue() {
  const subRevenue = await db('subscriptions')
    .where('amount_paid', '>', 0)
    .select(
      db.raw('COUNT(*) as total_subscriptions'),
      db.raw('COALESCE(SUM(amount_paid), 0) as total_subscription_revenue')
    )
    .first();

  const aiRevenue = await db('ai_wallet_transactions')
    .where({ type: 'topup' })
    .select(
      db.raw('COUNT(*) as total_topups'),
      db.raw('COALESCE(SUM(cost), 0) as total_ai_revenue')
    )
    .first();

  const translationRevenue = await db('translation_wallet_transactions')
    .where({ type: 'topup' })
    .select(
      db.raw('COUNT(*) as total_topups'),
      db.raw('COALESCE(SUM(cost), 0) as total_translation_revenue')
    )
    .first();

  const activeSubs = await db('subscriptions').where({ status: 'active' }).count('* as count').first();
  const expiredSubs = await db('subscriptions').where({ status: 'expired' }).count('* as count').first();
  const graceSubs = await db('subscriptions').where({ status: 'grace_period' }).count('* as count').first();

  return {
    subscriptions: {
      totalRevenue: parseFloat(subRevenue?.total_subscription_revenue || '0'),
      totalCount: parseInt(subRevenue?.total_subscriptions as string) || 0,
      active: parseInt(activeSubs?.count as string) || 0,
      expired: parseInt(expiredSubs?.count as string) || 0,
      grace: parseInt(graceSubs?.count as string) || 0,
    },
    aiWallet: {
      totalRevenue: parseFloat(aiRevenue?.total_ai_revenue || '0'),
      totalTopups: parseInt(aiRevenue?.total_topups as string) || 0,
    },
    translationWallet: {
      totalRevenue: parseFloat(translationRevenue?.total_translation_revenue || '0'),
      totalTopups: parseInt(translationRevenue?.total_topups as string) || 0,
    },
    totalRevenue:
      parseFloat(subRevenue?.total_subscription_revenue || '0') +
      parseFloat(aiRevenue?.total_ai_revenue || '0') +
      parseFloat(translationRevenue?.total_translation_revenue || '0'),
  };
}
