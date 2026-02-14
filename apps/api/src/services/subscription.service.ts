// ============================================================
// OrgsLedger — Subscription Service
// Plans, subscriptions, wallets, invites, metering, analytics
// ============================================================

import db from '../db';
import { logger } from '../logger';
import crypto from 'crypto';

// ── Currency Helpers ──────────────────────────────────────
export function isNigeria(country?: string | null): boolean {
  if (!country) return false;
  return ['NG', 'NGA', 'nigeria'].includes(country.toLowerCase());
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
  if (currency === 'NGN') {
    return cycle === 'monthly'
      ? parseFloat(plan.price_ngn_monthly || plan.price_ngn_annual / 12)
      : parseFloat(plan.price_ngn_annual);
  }
  return cycle === 'monthly'
    ? parseFloat(plan.price_usd_monthly || plan.price_usd_annual / 12)
    : parseFloat(plan.price_usd_annual);
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
}) {
  const now = new Date();
  const periodEnd = new Date(now);
  if (params.billingCycle === 'monthly') {
    periodEnd.setMonth(periodEnd.getMonth() + 1);
  } else {
    periodEnd.setFullYear(periodEnd.getFullYear() + 1);
  }
  const graceEnd = new Date(periodEnd);
  graceEnd.setDate(graceEnd.getDate() + 7);

  // Deactivate old subscriptions
  await db('subscriptions')
    .where({ organization_id: params.organizationId })
    .whereIn('status', ['active', 'grace_period'])
    .update({ status: 'cancelled', updated_at: db.fn.now() });

  const [sub] = await db('subscriptions').insert({
    organization_id: params.organizationId,
    plan_id: params.planId,
    status: 'active',
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
  await db('organizations').where({ id: params.organizationId }).update({
    subscription_status: 'active',
    billing_currency: params.currency,
    billing_country: params.billingCountry,
  });

  // Log history
  await db('subscription_history').insert({
    subscription_id: sub.id,
    organization_id: params.organizationId,
    action: 'created',
    metadata: JSON.stringify({ planId: params.planId, amountPaid: params.amountPaid, cycle: params.billingCycle }),
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

  await db('subscriptions').where({ id: sub.id }).update({
    status: 'active',
    amount_paid: amountPaid,
    current_period_start: now.toISOString(),
    current_period_end: newEnd.toISOString(),
    grace_period_end: graceEnd.toISOString(),
    gateway_subscription_id: paymentRef || sub.gateway_subscription_id,
    updated_at: db.fn.now(),
  });

  await db('organizations').where({ id: orgId }).update({ subscription_status: 'active' });

  await db('subscription_history').insert({
    subscription_id: sub.id,
    organization_id: orgId,
    action: 'renewed',
    metadata: JSON.stringify({ amountPaid, paymentRef }),
  });

  return db('subscriptions').where({ id: sub.id }).first();
}

// ── Wallets ───────────────────────────────────────────────
export async function getAiWallet(orgId: string) {
  let wallet = await db('ai_wallet').where({ organization_id: orgId }).first();
  if (!wallet) {
    [wallet] = await db('ai_wallet').insert({ organization_id: orgId, balance_minutes: 0, currency: 'USD' }).returning('*');
  }
  return wallet;
}

export async function getTranslationWallet(orgId: string) {
  let wallet = await db('translation_wallet').where({ organization_id: orgId }).first();
  if (!wallet) {
    [wallet] = await db('translation_wallet').insert({ organization_id: orgId, balance_minutes: 0, currency: 'USD' }).returning('*');
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
  await db('ai_wallet')
    .where({ organization_id: params.orgId })
    .update({
      balance_minutes: db.raw('balance_minutes + ?', [params.minutes]),
      updated_at: db.fn.now(),
    });

  await db('ai_wallet_transactions').insert({
    organization_id: params.orgId,
    type: 'topup',
    amount_minutes: params.minutes,
    cost: params.cost,
    currency: params.currency,
    payment_ref: params.paymentRef,
    payment_gateway: params.paymentGateway,
    description: `Top-up: ${(params.minutes / 60).toFixed(1)} hours`,
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
  await db('translation_wallet')
    .where({ organization_id: params.orgId })
    .update({
      balance_minutes: db.raw('balance_minutes + ?', [params.minutes]),
      updated_at: db.fn.now(),
    });

  await db('translation_wallet_transactions').insert({
    organization_id: params.orgId,
    type: 'topup',
    amount_minutes: params.minutes,
    cost: params.cost,
    currency: params.currency,
    payment_ref: params.paymentRef,
    payment_gateway: params.paymentGateway,
    description: `Top-up: ${(params.minutes / 60).toFixed(1)} hours`,
  });

  return getTranslationWallet(params.orgId);
}

export async function deductAiWallet(orgId: string, minutes: number, description?: string) {
  const wallet = await getAiWallet(orgId);
  if (parseFloat(wallet.balance_minutes) < minutes) {
    return { success: false, error: 'Insufficient AI wallet balance' };
  }

  await db('ai_wallet')
    .where({ organization_id: orgId })
    .update({
      balance_minutes: db.raw('balance_minutes - ?', [minutes]),
      updated_at: db.fn.now(),
    });

  await db('ai_wallet_transactions').insert({
    organization_id: orgId,
    type: 'usage',
    amount_minutes: -minutes,
    description: description || `AI usage: ${minutes.toFixed(1)} minutes`,
  });

  return { success: true };
}

export async function deductTranslationWallet(orgId: string, minutes: number, description?: string) {
  const wallet = await getTranslationWallet(orgId);
  if (parseFloat(wallet.balance_minutes) < minutes) {
    return { success: false, error: 'Insufficient translation wallet balance' };
  }

  await db('translation_wallet')
    .where({ organization_id: orgId })
    .update({
      balance_minutes: db.raw('balance_minutes - ?', [minutes]),
      updated_at: db.fn.now(),
    });

  await db('translation_wallet_transactions').insert({
    organization_id: orgId,
    type: 'usage',
    amount_minutes: -minutes,
    description: description || `Translation usage: ${minutes.toFixed(1)} minutes`,
  });

  return { success: true };
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
  createdBy: string,
  role: string = 'member',
  maxUses?: number,
  expiresAt?: string
) {
  const code = generateInviteCode();
  const [link] = await db('invite_links').insert({
    organization_id: orgId,
    code,
    role,
    max_uses: maxUses || null,
    expires_at: expiresAt || null,
    created_by: createdBy,
  }).returning('*');
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
    const sub = await getOrgSubscription(link.organization_id);
    if (sub?.plan) {
      const count = await db('memberships')
        .where({ organization_id: link.organization_id, is_active: true })
        .count('id as count')
        .first();
      if (parseInt(count?.count as string) >= sub.plan.max_members) {
        return { valid: false, error: 'Organization has reached its member limit. Upgrade the plan.' };
      }
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
  await db('ai_wallet')
    .where({ organization_id: orgId })
    .update({
      balance_minutes: db.raw('balance_minutes + ?', [minutes]),
      updated_at: db.fn.now(),
    });

  await db('ai_wallet_transactions').insert({
    organization_id: orgId,
    type: 'admin_adjustment',
    amount_minutes: minutes,
    description,
  });

  return getAiWallet(orgId);
}

export async function adminAdjustTranslationWallet(orgId: string, minutes: number, description: string) {
  await db('translation_wallet')
    .where({ organization_id: orgId })
    .update({
      balance_minutes: db.raw('balance_minutes + ?', [minutes]),
      updated_at: db.fn.now(),
    });

  await db('translation_wallet_transactions').insert({
    organization_id: orgId,
    type: 'admin_adjustment',
    amount_minutes: minutes,
    description,
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
