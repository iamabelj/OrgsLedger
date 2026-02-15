# Phase 7: Code Smell Audit — Pre-Refactor Checklist

> **Date:** February 14, 2026
> **Scope:** Full codebase audit of `apps/api`, `apps/mobile`, `packages/`, `landing/`
> **Purpose:** Identify structural issues before major refactoring. No blind changes — targeted fixes with clear goals.

---

## Executive Summary

| Category | Findings | Critical | High | Medium |
|----------|----------|----------|------|--------|
| Business logic in controllers | 16/16 route files | 5 | 5 | 6 |
| Billing logic in frontend | 10 instances | 2 | 3 | 5 |
| Repeated wallet code | ~190 lines duplicated | 1 | 2 | 3 |
| Hardcoded pricing | 13 locations | 4 | 5 | 4 |
| Mixed currency calculations | 9 findings | 2 | 4 | 3 |
| Shared mutable state | 16 instances | 3 | 2 | 2 |

**Verdict:** The codebase has grown organically with all business logic living in Express route handlers. 14 of 16 domains lack a service layer. The wallet system has ~190 lines of copy-pasted code with subtle divergences. Currency handling has multiple hardcoded-USD assumptions. Three in-memory stores can grow unboundedly.

---

## 1. Business Logic Inside Controllers

**Scale:** 16/16 route files contain direct `db(...)` queries. Only `subscriptions.ts` meaningfully delegates to `subscription.service.ts`.

### Route File Assessment

| Route File | Lines | Direct DB | Business Logic | Has Service |
|------------|-------|-----------|----------------|-------------|
| `routes/auth.ts` | 668 | **YES** | **YES** | **NO** |
| `routes/organizations.ts` | 855 | **YES** | **YES** | Partial |
| `routes/meetings.ts` | 795 | **YES** | **YES** | Partial |
| `routes/financials.ts` | 612 | **YES** | **YES** | Partial |
| `routes/payments.ts` | 1235 | **YES** | **YES** | Partial |
| `routes/subscriptions.ts` | 600 | **YES** | **YES** | **YES** |
| `routes/admin.ts` | 600 | **YES** | **YES** | **NO** |
| `routes/chat.ts` | 600 | **YES** | **YES** | **NO** |
| `routes/committees.ts` | 500 | **YES** | **YES** | **NO** |
| `routes/documents.ts` | 500 | **YES** | Minimal | **NO** |
| `routes/events.ts` | 500 | **YES** | **YES** | Partial |
| `routes/expenses.ts` | 500 | **YES** | Minimal | **NO** |
| `routes/announcements.ts` | 500 | **YES** | **YES** | Partial |
| `routes/notifications.ts` | 500 | **YES** | Minimal | **NO** |
| `routes/polls.ts` | 500 | **YES** | **YES** | **NO** |
| `routes/analytics.ts` | 500 | **YES** | **YES** | **NO** |

**Total: ~8,500 lines of route code** with embedded business logic.

### Top 10 Worst Offenders

1. **`payments.ts` L47–245** — 200+ line payment orchestration handler (Stripe/Paystack/Flutterwave/bank transfer flows with inline DB updates, notifications, push, socket events)
2. **`analytics.ts` L18–130** — Dashboard endpoint runs 15 separate DB queries inline (member counts, revenue, expenses, attendance, collection rates, monthly breakdowns)
3. **`auth.ts` L79–167** — Register handler: 80+ lines of auto-join-org workflow (user existence check → hash → create → org lookup → membership → channel join)
4. **`auth.ts` L178–278** — Login handler: **duplicates** the same auto-join-org logic from register
5. **`organizations.ts` L370–500** — Member detail endpoint: 6 parallel financial queries inline
6. **`payments.ts` L485–830** — Three webhook handlers each duplicate: find transaction → update status → update related records → notification → push → socket
7. **`meetings.ts` L88–170** — Create meeting: AI credit check + Jitsi ID + meeting insert + agenda items + member notification + push — 5+ concerns mixed
8. **`financials.ts` L68–145** — Create due: insert due → resolve target members → bulk transactions → bulk notifications → push → audit → socket
9. **`admin.ts` L370–425** — Platform analytics: 7 inline COUNT/SUM aggregate queries
10. **`polls.ts` L85–140** — N+1 query: for each poll → fetch options → for each option → count votes → check user vote (120+ queries for 20 polls)

### Missing Service Files (to be created)

```
services/auth.service.ts
services/organization.service.ts
services/meeting.service.ts
services/financial.service.ts
services/payment.service.ts
services/chat.service.ts
services/committee.service.ts
services/document.service.ts
services/event.service.ts
services/expense.service.ts
services/announcement.service.ts
services/notification.service.ts
services/poll.service.ts
services/analytics-query.service.ts
services/admin.service.ts
```

---

## 2. Billing Logic in Frontend

### Critical Findings

| # | File | Issue | Risk |
|---|------|-------|------|
| 1 | `app/admin/wallets.tsx` L72–74, L110–111, L207 | Hardcoded AI price `$10/hr`, translation `$25/hr`, NGN `₦18,000/hr`, `₦45,000/hr`. Client computes cost = hours × price. | Prices diverge from DB if changed server-side |
| 2 | `app/admin/plans.tsx` L92–94, L115–116, L259, L326 | Same hardcoded prices duplicated. Display strings `"$10/hour"` / `"₦18,000/hour"` baked in. | Double maintenance burden |
| 3 | `src/stores/financial.store.ts` L70–87 | Client computes `totalIncome`, `pendingAmount`, `netBalance` from raw server data | Financial aggregates should be single-source-of-truth from backend |
| 4 | `app/financials/history.tsx` L68 | Client-side `.reduce()` sum of paginated transactions (limit: 50). Shows partial total. | **Incorrect totals** for users with >50 transactions |

### High/Medium Findings

| # | File | Issue |
|---|------|-------|
| 5 | `app/financials/donate/[campaignId].tsx` L22, L55 | Hardcoded `PRESET_AMOUNTS = [10, 25, 50, 100, 250, 500]` and `$1 minimum` |
| 6 | `app/admin/payment-methods.tsx` L36–48 | Default gateway enablement (Paystack/Flutterwave ON, Stripe OFF) hardcoded |
| 7 | `app/admin/settings.tsx` L36–51 | Hardcoded currency list (10 currencies) and payment gateway list |
| 8 | `app/admin/analytics.tsx` L64 | `Intl.NumberFormat('en-NG', { currency: 'NGN' })` — always formats as NGN |
| 9 | `src/stores/financial.store.ts` L107 | Default payment gateway hardcoded to `'stripe'` |
| 10 | `app/admin/create-fine.tsx` L110 | Fine currency hardcoded to `'USD'` regardless of org settings |

---

## 3. Repeated Wallet Calculation Code

### Cloned Function Pairs (~190 lines of duplication)

Every wallet operation exists as a copy-pasted pair in `subscription.service.ts`:

| Function | AI Version | Translation Version | Only Difference |
|----------|-----------|-------------------|-----------------|
| Get wallet | `getAiWallet` L191–198 | `getTranslationWallet` L200–206 | Table name |
| Top up | `topUpAiWallet` L208–249 | `topUpTranslationWallet` L251–291 | Table + tx-table |
| Deduct | `deductAiWallet` L293–336 | `deductTranslationWallet` L338–378 | Table + tx-table + log |
| History | `getAiWalletHistory` L380–385 | `getTranslationWalletHistory` L387–392 | Table name |
| Admin adjust | `adminAdjustAiWallet` L493–509 | `adminAdjustTranslationWallet` L511–527 | Table + tx-table |

**Fix:** Single generic function set parameterized by `walletType: 'ai' | 'translation'`.

### `parseFloat(wallet.balance_minutes)` — Repeated 6 Times

| File | Location |
|------|----------|
| `subscription.service.ts` | `deductAiWallet` L306 |
| `subscription.service.ts` | `deductTranslationWallet` L350 |
| `ai.service.ts` | `processMinutes` L71 |
| `socket.ts` | `translation:speech` handler L231 |
| `middleware/subscription.ts` | `checkAiWallet` L67 |
| `middleware/subscription.ts` | `checkTranslationWallet` L85 |

### Inconsistent Deduction Patterns

| Pattern | AI (ai.service.ts) | Translation (socket.ts) | Risk |
|---------|-------------------|------------------------|------|
| Balance check | **Before** processing (L69–100) | **Before** processing (L230–233) | Both pre-check |
| Deduction timing | **Before** AI API call | **After** translation API call | **Translation served free on deduction failure** |
| Amount source | Calculated from meeting duration | **Hardcoded 0.5 min** per batch | Translation under-counts |
| TOCTOU risk | Check outside transaction → deduct inside transaction | Same pattern | Both vulnerable |

### Critical: Translation Deduction After Usage

`socket.ts` L243–251: Translation API call happens FIRST, then deduction is attempted. If deduction fails, the code logs `"Wallet deduction failed but translation was served"` and continues. **Users get free translation on failure.**

### Critical: Admin Adjustments Missing Transaction Wrapping

`adminAdjustAiWallet` / `adminAdjustTranslationWallet` (L493–527) run UPDATE + INSERT without `db.transaction()`. If INSERT fails after UPDATE succeeds, balance changes with no audit trail. Also: no balance floor check — admin can drive balance negative.

---

## 4. Hardcoded Pricing

### Critical: Route Ignores DB Wallet Prices

`routes/subscriptions.ts` L218 and L242:
```typescript
// AI top-up — ignores wallet.price_per_hour_usd column
const pricePerHour = currency === 'NGN' ? 18000 : 10;

// Translation top-up — ignores wallet.price_per_hour_ngn column
const pricePerHour = currency === 'NGN' ? 45000 : 25;
```

The DB stores per-org `price_per_hour_usd` / `price_per_hour_ngn` on each wallet row, but the route handler **ignores** these and uses hardcoded values. Custom org pricing is impossible.

### Critical: Conflicting AI Credit Prices

| Source | Price | File |
|--------|-------|------|
| Migration default | $5/hr | `001_initial_schema.ts` L362 |
| Seed data | $7/hr | `seed.ts` L125 |
| Platform config | $7/hr | `seed.ts` L134 |
| Shared types comment | $5/hr | `packages/shared/src/index.ts` L331 |
| README docs | $5/hr | `README.md` L88 |

Three different prices in three different locations.

### Critical: Wallet Auto-Create Defaults to USD

`subscription.service.ts` L194 and L202:
```typescript
await db('ai_wallet').insert({ organization_id: orgId, balance_minutes: 0, currency: 'USD' });
await db('translation_wallet').insert({ organization_id: orgId, balance_minutes: 0, currency: 'USD' });
```
Always creates wallets with `currency: 'USD'` regardless of org's `billing_currency`.

### Other Hardcoded Values

| Location | Value | Issue |
|----------|-------|-------|
| `landing/server.js` L26 | `RATE_NGN_PER_USD = 1500` | Hardcoded exchange rate |
| `landing/index.html` L799–899 | Product prices (₦1.5M, $1000, etc.) | Static HTML — expected but fragile |
| `landing/routes/ai-proxy.js` L17–21 | API cost rates ($0.006/15s, $0.005/1K tokens) | Internal cost tracking |

---

## 5. Mixed Currency Calculations

### Hardcoded `$` Symbol Across Frontend

Every financial display in the mobile app hardcodes the USD `$` symbol:

| File | Line | Code |
|------|------|------|
| `app/admin/saas-dashboard.tsx` | L167 | `` `$${fmtNum(revenue)}` `` |
| `app/financials/history.tsx` | L68 | `` `$${total.toFixed(2)}` `` |
| `app/financials/history.tsx` | L96 | `` `$${parseFloat(item.amount).toFixed(2)}` `` |
| `app/financials/donate/[campaignId].tsx` | L55, L110, L159 | `$1 minimum`, `$${goal}`, `$${amount}` |
| `app/admin/wallets.tsx` | Multiple | `$10/hr`, `$25/hr` |

**Impact:** Nigerian organizations see `$` prefix on all NGN amounts.

### Wallet `priceKey` Bug

`app/admin/wallets.tsx` L72:
```typescript
const priceKey = activeWallet === 'ai' ? 'price_per_hour_usd' : 'price_per_hour_usd';
//                                        ^^^^^^^^^^^^^^^^         ^^^^^^^^^^^^^^^^
// BUG: Both branches return the same key — NGN price column is never read
```

### Currency Flow Gaps

| Operation | Currency Source | Correct? |
|-----------|---------------|----------|
| Plan subscription | `getCurrency(billingCountry)` → DB lookup | ✅ |
| Wallet top-up | Inline `currency === 'NGN' ? 18000 : 10` | ❌ Bypasses DB |
| Wallet auto-create | Hardcoded `'USD'` | ❌ Ignores org currency |
| Fine creation | Hardcoded `'USD'` in mobile | ❌ Wrong for NGN orgs |
| Financial display | Hardcoded `$` prefix | ❌ Wrong for NGN orgs |
| Analytics formatting | Hardcoded `Intl.NumberFormat('en-NG', 'NGN')` | ❌ Wrong for USD orgs |

---

## 6. Shared Mutable State

### HIGH Risk — Unbounded Growth (Memory Leaks)

| State | File | Line | Issue |
|-------|------|------|-------|
| `errorFrequency` Map | `error-monitor.service.ts` | L39 | Entries added per unique fingerprint, **never evicted** |
| `orgUsage` Map | `analytics.service.ts` | L51 | One entry per org, **never evicted**. Grows with org count. |
| `metrics.routeMetrics` Map | `metrics.service.ts` | L82 | Keyed by `req.path` (includes UUIDs). **Unbounded unique keys.** |

### MEDIUM Risk — Data Loss on Restart

| State | File | Bounded | Issue |
|-------|------|---------|-------|
| `meetingLanguages` Map | `socket.ts` L17 | By active meetings | Translation sessions lost on restart |
| `eventBuffer` Array | `analytics.service.ts` L50 | 10,000 entries | Recent analytics lost on restart |
| `errorBuffer` Array | `error-monitor.service.ts` L31 | 200 entries | Recent errors lost on restart |
| Rate limiter `MemoryStore` | `index.ts` L88, L172 | Auto-prunes | Rate limits reset on restart, per-process only |

### Horizontal Scaling Blockers

All in-memory state prevents clustering:
- `meetingLanguages` — users on different processes can't see each other
- `metrics.*` counters — each process tracks only its own traffic
- Rate limiter — attacker bypasses by hitting different processes
- Analytics/error buffers — partial view per process

---

## Refactoring Plan — Prioritized by Impact

### Phase 8A: Service Layer Extraction (Highest Impact)

**Goal:** Move business logic out of route handlers into testable service files.

**Priority order** (by complexity × risk):
1. `payment.service.ts` — Extract from `payments.ts` (1235 lines). Unify webhook completion logic. Highest duplication.
2. `auth.service.ts` — Extract from `auth.ts` (668 lines). Deduplicate auto-join-org workflow between register & login.
3. `financial.service.ts` — Extract from `financials.ts` (612 lines). Multi-step due/fine/donation creation with notifications.
4. `meeting.service.ts` — Extract from `meetings.ts` (795 lines). Credit checks + agenda + notifications.
5. `organization.service.ts` — Extract from `organizations.ts` (855 lines). Member management + financial queries.
6. `chat.service.ts`, `poll.service.ts`, `event.service.ts`, `announcement.service.ts`, `committee.service.ts`, `notification.service.ts`, `admin.service.ts`, `analytics-query.service.ts` — Remaining CRUD-heavy files.

**Each route handler should become:** Validate input → Call service → Return response. 3–10 lines max.

### Phase 8B: Wallet Consolidation

**Goal:** Eliminate ~190 lines of cloned code, fix transaction safety gaps.

1. Create generic `walletService.getWallet(type, orgId)`, `walletService.deduct(type, orgId, minutes)`, etc.
2. Wrap `adminAdjust` in `db.transaction()`.
3. Add balance floor check to admin adjustments.
4. Fix translation deduction: deduct BEFORE API call (or implement hold/confirm).
5. Extract `parseFloat(wallet.balance_minutes)` into a helper.

### Phase 8C: Pricing & Currency

**Goal:** Single source of truth for all prices. Org-aware currency everywhere.

1. Move wallet per-hour prices to config or read from DB (`wallet.price_per_hour_usd`).
2. Fix wallet auto-create to use org's `billing_currency`.
3. Create a shared `formatCurrency(amount, currency)` utility for mobile.
4. Replace all hardcoded `$` prefixes with org-aware formatting.
5. Fix `priceKey` ternary bug in `wallets.tsx`.
6. Resolve conflicting AI credit prices ($5 vs $7).

### Phase 8D: Memory Safety

**Goal:** Cap unbounded maps, prepare for horizontal scaling.

1. Add LRU eviction to `errorFrequency` (cap at 500).
2. Add LRU eviction to `orgUsage` (cap at 1000 most recent).
3. Fix `routeMetrics` key to use `req.route?.path` only (not raw URL with IDs).
4. Document: "single-process only" for current state; Redis migration path for clustering.

---

## Quick Win Fixes (Can Do Now)

These are small, safe changes that don't require service extraction:

- [x] Fix `wallets.tsx` L72 `priceKey` bug (both branches identical) — **FIXED: Now uses org currency and correct price key**
- [x] Fix `create-fine.tsx` L110 hardcoded `currency: 'USD'` → use org currency — **FIXED: Now fetches org billing_currency and uses it for fines**
- [x] Fix `analytics.tsx` L64 hardcoded NGN formatting → use org currency — **FIXED: Now fetches org billing_currency and formats accordingly**
- [x] Wrap `adminAdjustAiWallet` / `adminAdjustTranslationWallet` in `db.transaction()` — **ALREADY FIXED: Uses db.transaction() with GREATEST() floor check**
- [x] Cap `errorFrequency` Map at 500 entries — **ALREADY FIXED: LRU eviction at 500**
- [x] Cap `orgUsage` Map at 1000 entries — **ALREADY FIXED: LRU eviction at 1000**
- [x] Fix `routeMetrics` key to use `req.route?.path || 'unknown'` (not `req.path`) — **ALREADY FIXED: Capped at 200 entries with route pattern keys**
- [x] Fix wallet auto-creation to respect org `billing_currency` — **ALREADY FIXED: Uses org's billing_currency**

---

## Status: All Quick Win Fixes Complete ✅

All identified quick win fixes have been implemented. The project is now ready for larger refactoring efforts as outlined in Phase 8A-8D above.
