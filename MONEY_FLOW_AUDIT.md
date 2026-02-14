# MONEY FLOW AUDIT — Pre-Refactor Safety Gate

**Date**: Pre-refactor validation  
**Status**: ⛔ DO NOT REFACTOR until all tests pass  
**Total Money Paths**: 22  
**Critical Bugs Found**: 20 (10 verified with exact code)  
**Test Coverage**: See `money-flow-*.test.ts` files

---

## THE GOLDEN RULE ANSWERS

### WHERE is money CALCULATED?

| What | Where | How | Bug? |
|------|-------|-----|------|
| Subscription plan price | `subscription.service.ts → getPlanPrice()` | Reads `subscription_plans` table, uses `price_usd_monthly/annual` or `price_ngn_monthly/annual` based on `isNigeria()` | ⚠ Fallback `price_ngn_monthly \|\| price_ngn_annual / 12` can return `NaN` if both null |
| AI wallet top-up cost | `routes/subscriptions.ts` L218-220 | **HARDCODED**: `currency === 'NGN' ? 18000 : 10` per hour | 🔴 Ignores DB `ai_price_per_hour` column |
| Translation wallet top-up cost | `routes/subscriptions.ts` L242-244 | **HARDCODED**: `currency === 'NGN' ? 45000 : 25` per hour | 🔴 Ignores DB `translation_price_per_hour` column |
| AI deduction amount | `ai.service.ts` L94 | Meeting duration in minutes from `meetings.duration_minutes` | ✅ Correct |
| Translation deduction amount | `socket.ts` L240 | **HARDCODED** `0.5` minutes per batch regardless of content | ⚠ Arbitrary flat rate |
| Dues/fines amounts | `routes/financials.ts` | Admin-supplied `amount` field | ⚠ No max limit validation |
| Donation amounts | `routes/financials.ts` | User-supplied, Zod-validated | ✅ Validated |
| Expense amounts | `routes/expenses.ts` | `parseFloat(req.body.amount)` | 🔴 No Zod, no range check — NaN/negative/Infinity accepted |
| Refund amounts | `routes/payments.ts` L408 | `transaction.amount` from DB | ✅ Server-side |
| Revenue totals | `subscription.service.ts → getPlatformRevenue()` | `SUM(amount_paid)` across ALL currencies | 🔴 Mixes USD + NGN into one number |
| Late fee calculation | `scheduler.service.ts` | `dueAmount * 0.05` hardcoded 5% | ⚠ Not configurable per org |

### WHERE is money DEDUCTED?

| What | Where | Atomic? | Lock? | Bug? |
|------|-------|---------|-------|------|
| AI wallet deduction | `subscription.service.ts → deductAiWallet()` | ✅ `db.transaction()` | ✅ `FOR UPDATE` | 🔴 No refund on AI processing failure |
| Translation wallet deduction | `subscription.service.ts → deductTranslationWallet()` | ✅ `db.transaction()` | ✅ `FOR UPDATE` | 🔴 Deducts AFTER service delivery |
| Admin AI wallet adjust | `subscription.service.ts → adminAdjustAiWallet()` | ✅ `db.transaction()` | ❌ No lock | ✅ Fixed with GREATEST floor |
| Admin Translation adjust | `subscription.service.ts → adminAdjustTranslationWallet()` | ✅ `db.transaction()` | ❌ No lock | ✅ Fixed with GREATEST floor |
| Subscription payment | `subscription.service.ts → createSubscription()` | ❌ **NOT atomic** | ❌ No lock | 🔴 4 separate writes can partially fail |
| Subscription renewal | `subscription.service.ts → renewSubscription()` | ❌ **NOT atomic** | ❌ No lock | 🔴 3 separate writes can partially fail |
| Gateway refund | `routes/payments.ts` L408-469 | ❌ **NOT atomic** | ❌ No lock | 🔴 Gateway refund can succeed, DB update can fail |

### WHERE is money STORED?

| Table | Purpose | Key Columns | Currency? |
|-------|---------|-------------|-----------|
| `subscriptions` | Active subscription state | `plan_id, amount_paid, status, starts_at, ends_at` | ❌ No currency column |
| `subscription_history` | Subscription audit trail | `plan_id, amount_paid, action` | ❌ No currency column |
| `subscription_plans` | Plan catalog + pricing | `price_usd_monthly, price_usd_annual, price_ngn_monthly, price_ngn_annual` | ✅ Split columns |
| `ai_wallet` | AI minutes balance | `balance_minutes, total_topped_up, total_spent` | ❌ No currency column |
| `ai_wallet_transactions` | AI wallet audit trail | `minutes, cost, currency, type, description` | ✅ Has currency |
| `translation_wallet` | Translation minutes balance | `balance_minutes, total_topped_up, total_spent` | ❌ No currency column |
| `translation_wallet_transactions` | Translation wallet audit trail | `minutes, cost, currency, type, description` | ✅ Has currency |
| `transactions` | Universal payment ledger | `amount, currency, status, payment_gateway_id, reference_type, reference_id` | ✅ Has currency |
| `dues` | Membership dues | `amount, currency, status` | ✅ Has currency |
| `fines` | Member fines | `amount, currency, status` | ✅ Has currency |
| `donations` | Donation records | `amount, currency, status, is_anonymous` | ✅ Has currency |
| `donation_campaigns` | Campaign goals | `target_amount, currency` | ✅ Has currency |
| `expenses` | Org expenses | `amount` | 🔴 **No currency column** |
| `refunds` | Refund records | `amount, reason, status` | ❌ No currency column |
| `ai_credits` | **LEGACY** credit balance | `minutes_remaining` | ❌ Legacy system |
| `ai_credit_transactions` | **LEGACY** credit audit | `minutes, description` | ❌ Legacy system |
| `licenses` | Seat licenses | `price, currency` | ✅ Has currency |
| `usage_records` | Metered usage | `quantity, unit_price, total_price` | ❌ No currency column |

### WHERE is money LOGGED?

| Event | Log Location | Audit Table | Complete? |
|-------|-------------|-------------|-----------|
| Wallet top-up | `logger.info` in route | `ai_wallet_transactions` / `translation_wallet_transactions` | ⚠ No payment verification logged |
| Wallet deduction | Within `db.transaction()` | `ai_wallet_transactions` / `translation_wallet_transactions` | ✅ Complete |
| Payment initiated | `logger.info` in route | `transactions` (status: pending) | ✅ Complete |
| Payment completed | `markTransactionCompleted()` | `transactions` (status: completed) | 🔴 Dues status NOT updated |
| Webhook received | `logger.info` only | Updates `transactions` | ⚠ No separate webhook log |
| Refund processed | `logger.info` in route | `refunds` table + `transactions` update | 🔴 Fine/donation status NOT reverted |
| Subscription created | `logger.info` in service | `subscription_history` | ⚠ Non-atomic — partial logs possible |
| Admin adjustment | `logger.info` in route | Wallet transaction table | ✅ Complete |
| Expense created | None | `expenses` table only | 🔴 No audit trail, hard deletable |

### HOW is money VALIDATED?

| Validation | Status | Location | Bug? |
|------------|--------|----------|------|
| Subscription plan exists | ✅ | `subscription.service.ts` | OK |
| Wallet balance sufficient (deduction) | ✅ | `deductAiWallet/deductTranslationWallet` with `FOR UPDATE` | OK |
| Wallet balance sufficient (middleware) | ⚠ | `middleware/subscription.ts` — soft check, no lock | Race condition possible |
| Payment gateway configured | 🔴 | `routes/payments.ts` — falls back to dev mode | **Auto-completes if missing** |
| Payment amount matches expected | 🔴 | Paystack/Flutterwave callbacks | **Never verified** |
| Payment reference is real | 🔴 | Wallet top-up endpoints | **Never verified** |
| Webhook signature authentic | ⚠ | Paystack uses `x-paystack-signature`, Flutterwave uses `verif-hash` | Stripe webhook not validated |
| Currency matches org setting | ⚠ | Only wallet top-up (after Phase 7 fix) | Dues/fines default to 'USD' |
| Amount is positive number | 🔴 | Expenses: no check. Dues/fines: Zod partial | Inconsistent |
| Duplicate payment prevention | ⚠ | Webhook checks `tx.status === 'pending'` | Race condition between webhook + callback |
| Refund eligibility | ⚠ | Checks `tx.status === 'completed'` | No double-refund guard |

---

## ALL 22 MONEY FLOW PATHS

### Flow 1: Organization Creation
```
POST /organizations
  → subscription.service.ts → createSubscription()
    → INSERT subscriptions (plan_id, status:'active', amount_paid:0)  [NOT ATOMIC]
    → INSERT subscription_history (action:'created')                   [NOT ATOMIC]
    → getAiWallet() → may INSERT ai_wallet (balance:0)                [RACE CONDITION]
    → getTranslationWallet() → may INSERT translation_wallet (balance:0) [RACE CONDITION]
```

### Flow 2: Subscribe to Plan
```
POST /subscriptions/:orgId/subscribe
  → Validate plan exists
  → getPlanPrice(plan, billingCycle, country)
  → createSubscription(orgId, planId, amountPaid)
    → UPDATE subscriptions                                             [NOT ATOMIC]
    → INSERT subscription_history (action:'subscribed')                [NOT ATOMIC]
```

### Flow 3: Renew Subscription
```
POST /subscriptions/:orgId/renew
  → Validate current subscription
  → getPlanPrice(plan, billingCycle, country)
  → renewSubscription(orgId, planId, amountPaid)
    → UPDATE subscriptions (extend dates)                              [NOT ATOMIC]
    → INSERT subscription_history (action:'renewed')                   [NOT ATOMIC]
```

### Flow 4: AI Wallet Top-Up
```
POST /subscriptions/:orgId/wallet/ai/topup
  → Read org.billing_currency
  → HARDCODED price: NGN ? 18000 : 10 per hour
  → topUpAiWallet(orgId, minutes, cost, currency, paymentRef)
    → GET or CREATE ai_wallet                                          [RACE CONDITION on create]
    → db.transaction:
      → UPDATE ai_wallet (balance += minutes, total_topped_up += minutes)
      → INSERT ai_wallet_transactions (type:'topup')
  ⛔ NO payment verification — paymentRef blindly trusted
```

### Flow 5: Translation Wallet Top-Up
```
POST /subscriptions/:orgId/wallet/translation/topup
  → Read org.billing_currency
  → HARDCODED price: NGN ? 45000 : 25 per hour
  → topUpTranslationWallet(orgId, minutes, cost, currency, paymentRef)
    → GET or CREATE translation_wallet                                 [RACE CONDITION on create]
    → db.transaction:
      → UPDATE translation_wallet (balance += minutes, total_topped_up += minutes)
      → INSERT translation_wallet_transactions (type:'topup')
  ⛔ NO payment verification — paymentRef blindly trusted
```

### Flow 6: AI Wallet Deduction (Meeting Processing)
```
ai.service.ts → processMinutes()
  → deductAiWallet(orgId, durationMinutes, description)
    → db.transaction + FOR UPDATE:
      → CHECK balance >= minutes
      → UPDATE ai_wallet (balance -= minutes, total_spent += minutes)
      → INSERT ai_wallet_transactions (type:'deduction')
  → transcribeAudio(audioUrl)                                         [CAN THROW]
  → generateMinutes(transcript, meeting)                              [CAN THROW]
  ⛔ If transcribe/generate fails: minutes LOST, no refund path
```

### Flow 7: Translation Wallet Deduction (Live Translation)
```
socket.ts → 'translate' event
  → translateToMultiple(text, targetLangs)                             [HAPPENS FIRST]
  → deductTranslationWallet(orgId, 0.5, description)                  [HAPPENS AFTER]
    → db.transaction + FOR UPDATE:
      → CHECK balance >= 0.5
      → UPDATE translation_wallet
      → INSERT translation_wallet_transactions
  ⛔ Translation served BEFORE deduction — free service if deduction fails
  ⛔ If orgId missing: translation served with ZERO billing
```

### Flow 8: Admin Wallet Adjustment (AI)
```
POST /subscriptions/:orgId/wallet/ai/adjust
  → adminAdjustAiWallet(orgId, minutes, reason, adminId)
    → db.transaction:
      → UPDATE ai_wallet SET balance = GREATEST(balance + minutes, 0)
      → INSERT ai_wallet_transactions (type: minutes > 0 ? 'admin_topup' : 'admin_deduction')
  ✅ Fixed in Phase 7 — atomic with floor at 0
```

### Flow 9: Admin Wallet Adjustment (Translation)
```
POST /subscriptions/:orgId/wallet/translation/adjust
  → adminAdjustTranslationWallet(orgId, minutes, reason, adminId)
    → db.transaction:
      → UPDATE translation_wallet SET balance = GREATEST(balance + minutes, 0)
      → INSERT translation_wallet_transactions
  ✅ Fixed in Phase 7 — atomic with floor at 0
```

### Flow 10: Stripe Payment
```
POST /payments/:orgId/pay
  → IF Stripe configured:
    → stripe.paymentIntents.create(amount, currency)
    → stripe.paymentIntents.confirm(paymentIntentId)
    → INSERT transactions (status: 'pending')
    → markTransactionCompleted(tx, stripePaymentId, 'card', 'stripe')
  → IF Stripe NOT configured:
    → devModeFallback() → auto-completes                              [🔴 NO ENV GUARD]
```

### Flow 11: Paystack Payment
```
POST /payments/:orgId/pay (gateway: 'paystack')
  → IF Paystack configured:
    → paystackService.initializeTransaction(email, amount, reference)
    → INSERT transactions (status: 'pending', payment_gateway_id: reference)
    → Return authorization_url to client
  → Client redirects to Paystack → pays → redirects back
  → Callback (Flow 14) or Webhook (Flow 12) completes payment
```

### Flow 12: Paystack Webhook
```
POST /payments/webhooks/paystack
  → Validate HMAC signature (x-paystack-signature)
  → IF event === 'charge.success':
    → Find transaction by payment_gateway_id = data.reference
    → IF tx.status === 'pending':
      → markTransactionCompleted(tx, reference, channel, 'paystack')
      ⛔ NO amount verification — amount_paid could differ from tx.amount
      ⛔ RACE with callback (Flow 14) — no row lock
```

### Flow 13: Flutterwave Webhook
```
POST /payments/webhooks/flutterwave
  → Validate verif-hash header
  → IF event === 'charge.completed' && status === 'successful':
    → Find transaction by payment_gateway_id = data.tx_ref
    → IF tx.status === 'pending':
      → markTransactionCompleted(tx, txRef, paymentType, 'flutterwave')
      ⛔ NO amount verification
      ⛔ RACE with callback (Flow 15) — no row lock
```

### Flow 14: Paystack Callback
```
GET /payments/paystack/callback?reference=xxx
  → paystackService.verifyTransaction(reference)
  → IF result.status === 'success':
    → Find transaction by payment_gateway_id
    → IF tx.status === 'pending':
      → UPDATE transactions SET status='completed'
      → Update fines/donations status
      ⛔ NO amount verification — result.amount not compared
      ⛔ RACE with webhook (Flow 12)
```

### Flow 15: Flutterwave Callback
```
GET /payments/flutterwave/callback?tx_ref=xxx&transaction_id=yyy
  → flutterwaveService.verifyTransaction(transactionId)
  → IF result.status === 'successful':
    → Find transaction by payment_gateway_id = tx_ref
    → IF tx.status === 'pending':
      → UPDATE transactions SET status='completed'
      → Update fines/donations status
      ⛔ NO amount verification
      ⛔ RACE with webhook (Flow 13)
```

### Flow 16: Refund Processing
```
POST /payments/:orgId/refund/:transactionId
  → Validate tx.status === 'completed'
  → IF stripe: stripe.refunds.create()                                [GATEWAY CALL]
  → IF paystack: paystackService.refund()                             [GATEWAY CALL]
  → IF flutterwave: flutterwaveService.refund()                       [GATEWAY CALL]
  → INSERT refunds (amount, reason, status:'completed')                [NOT ATOMIC with above]
  → UPDATE transactions SET status='refunded'                          [NOT ATOMIC]
  ⛔ If gateway refund succeeds but DB write fails: money refunded, no record
  ⛔ Fine/donation status NOT reverted to unpaid
  ⛔ No double-refund guard (only checks tx.status !== 'refunded')
```

### Flow 17: Due Creation + Member Transactions
```
POST /financials/:orgId/dues
  → INSERT dues (amount, currency defaults 'USD')                      [NOT org billing_currency]
  → For EACH member of org:
    → INSERT transactions (type:'due', status:'pending')               [NOT ATOMIC — can fail mid-loop]
  ⛔ Currency defaults to 'USD', not org billing_currency
  ⛔ N inserts not wrapped in transaction — partial creation possible
```

### Flow 18: Fine Creation
```
POST /financials/:orgId/fines
  → INSERT fines (amount, currency defaults 'USD', status:'pending')
  → INSERT transactions (type:'fine', status:'pending')                [NOT ATOMIC]
  ⛔ No duplicate guard — same member can be fined for same reason multiple times
  ⛔ Currency defaults to 'USD'
```

### Flow 19: Donation
```
POST /financials/:orgId/donations
  → INSERT donations (amount, currency, is_anonymous, user_id: anonymous ? null : userId)
  → INSERT transactions (type:'donation', user_id: ALWAYS real userId) [PRIVACY LEAK]
  ⛔ Anonymous donations leak user_id in transactions table
```

### Flow 20: Expense
```
POST /expenses/:orgId
  → parseFloat(amount) — no Zod, no range check                       [NaN/negative/Infinity]
  → INSERT expenses (amount, NO currency column)
  ⛔ No currency field, no validation, hard-deletable (no soft delete)
```

### Flow 21: Recurring Dues (Scheduler)
```
scheduler.service.ts → processRecurringDues()
  → Find dues WHERE is_recurring = true AND next_due_date <= now
  → For each: create new due + member transactions
  → Calculate late_fee = amount * 0.05
  ⛔ 24-hour dedup window fragile — clock skew can cause duplicates
```

### Flow 22: Revenue Reporting
```
GET /subscriptions/revenue (super_admin only)
  → getPlatformRevenue()
    → SUM(subscriptions.amount_paid)                                   [MIXES CURRENCIES]
    → SUM(ai_wallet_transactions.cost) WHERE type='topup'              [MIXES CURRENCIES]
    → SUM(translation_wallet_transactions.cost) WHERE type='topup'     [MIXES CURRENCIES]
  ⛔ USD + NGN summed into single number
```

---

## TRANSACTION SAFETY MATRIX

| Operation | db.transaction() | FOR UPDATE | Atomic? | Risk |
|-----------|-----------------|------------|---------|------|
| `deductAiWallet` | ✅ | ✅ | ✅ | Low — but no refund on failure |
| `deductTranslationWallet` | ✅ | ✅ | ✅ | Low — but deducts AFTER service |
| `topUpAiWallet` | ✅ | ❌ | ✅ | Medium — no payment verification |
| `topUpTranslationWallet` | ✅ | ❌ | ✅ | Medium — no payment verification |
| `adminAdjustAiWallet` | ✅ | ❌ | ✅ | Low — fixed Phase 7 |
| `adminAdjustTranslationWallet` | ✅ | ❌ | ✅ | Low — fixed Phase 7 |
| `createSubscription` | ❌ | ❌ | ❌ | **HIGH** — 4 loose writes |
| `renewSubscription` | ❌ | ❌ | ❌ | **HIGH** — 3 loose writes |
| `markTransactionCompleted` | ❌ | ❌ | ❌ | **HIGH** — 2-3 loose writes |
| Refund processing | ❌ | ❌ | ❌ | **CRITICAL** — gateway + DB separate |
| Due creation (N members) | ❌ | ❌ | ❌ | **HIGH** — N loose inserts |
| Fine creation | ❌ | ❌ | ❌ | Medium — 2 loose writes |
| Donation creation | ❌ | ❌ | ❌ | Medium — 2 loose writes |
| Expense creation | ❌ | ❌ | ❌ | Low — single write |
| Webhook handler (Paystack) | ❌ | ❌ | ❌ | **CRITICAL** — races with callback |
| Webhook handler (Flutterwave) | ❌ | ❌ | ❌ | **CRITICAL** — races with callback |
| Revenue reporting | N/A | N/A | N/A | **HIGH** — mixes currencies |

---

## ALL CONFIRMED BUGS (Priority Order)

### P0 — Active Financial Loss / Exploitable

| # | Bug | File | Impact | Exploit |
|---|-----|------|--------|---------|
| 1 | **Wallet top-up: no payment verification** | `routes/subscriptions.ts` L218 | Unlimited free wallet credits | POST with fake `paymentReference` |
| 2 | **Dev mode auto-complete** | `routes/payments.ts` L107 | Free goods/services | Missing gateway env vars in prod |
| 3 | **Paystack callback: no amount verification** | `routes/payments.ts` L670 | Pay ₦1 for ₦50,000 transaction | Modify Paystack payment amount |
| 4 | **Flutterwave callback: no amount verification** | `routes/payments.ts` L800 | Pay ₦1 for ₦50,000 transaction | Modify Flutterwave payment amount |
| 5 | **Translation served before deduction** | `socket.ts` L240 | Unlimited free translations | Use service, deduction fails silently |
| 6 | **AI processing failure = money lost** | `ai.service.ts` L94 | Users lose paid minutes | Service error after deduction |

### P1 — Data Integrity / Race Conditions

| # | Bug | File | Impact |
|---|-----|------|--------|
| 7 | **Webhook + callback race condition** | `routes/payments.ts` L602-828 | Double-completion possible |
| 8 | **markTransactionCompleted ignores dues** | `routes/payments.ts` L260 | Dues stay unpaid after payment |
| 9 | **Refund: gateway success + DB failure** | `routes/payments.ts` L408 | Money refunded, no record |
| 10 | **Refund doesn't revert fine/donation status** | `routes/payments.ts` L408 | Paid fines stay 'paid' after refund |
| 11 | **createSubscription not atomic** | `subscription.service.ts` | Partial subscription records |
| 12 | **renewSubscription not atomic** | `subscription.service.ts` | Partial renewal records |
| 13 | **Wallet auto-create race condition** | `subscription.service.ts` | Duplicate wallet rows |
| 14 | **Due creation N inserts not atomic** | `routes/financials.ts` | Partial member dues |
| 15 | **Revenue mixes USD + NGN** | `subscription.service.ts` | Meaningless revenue numbers |

### P2 — Incorrect Behavior

| # | Bug | File | Impact |
|---|-----|------|--------|
| 16 | **Hardcoded wallet prices** | `routes/subscriptions.ts` L218,242 | DB price columns ignored |
| 17 | **Anonymous donation leaks user_id** | `routes/financials.ts` L400 | Privacy violation |
| 18 | **Expense: no validation, no currency** | `routes/expenses.ts` | NaN/negative/Infinity amounts |
| 19 | **Dues/fines default USD not org currency** | `routes/financials.ts` | Wrong currency assigned |
| 20 | **No duplicate fine guard** | `routes/financials.ts` | Same fine issued multiple times |

---

## DUAL WALLET SYSTEM WARNING

The codebase has TWO separate AI credit systems:

1. **New system**: `ai_wallet` + `ai_wallet_transactions` — used by wallet top-up and admin adjustments
2. **Legacy system**: `ai_credits` + `ai_credit_transactions` — checked by `ai.service.ts` for meeting processing

**Critical**: Top-ups credit the NEW wallet, but meeting processing may check the LEGACY credits table. Must verify which table `ai.service.ts` actually reads before any refactor.

---

## PAYMENT GATEWAY SECURITY

| Gateway | Auth Check | Amount Verify | Replay Guard | Race Guard |
|---------|-----------|---------------|-------------|------------|
| Stripe | Direct confirm (server-side) | N/A (server creates intent) | ❌ | ❌ |
| Paystack | HMAC webhook signature | ❌ **MISSING** | `status === 'pending'` check | ❌ No row lock |
| Flutterwave | `verif-hash` header | ❌ **MISSING** | `status === 'pending'` check | ❌ No row lock |
| Bank Transfer | Manual admin approval | N/A | N/A | N/A |

---

## REFACTORING PREREQUISITES

Before ANY billing/wallet/subscription refactoring:

- [ ] All money-flow tests written and passing
- [ ] Malicious attack simulations passing
- [ ] P0 bugs have fix plan documented
- [ ] Each fix is atomic (one bug, one commit)
- [ ] No regression in 285 existing tests
- [ ] Revenue system produces correct numbers

**Do NOT refactor until this checklist is complete.**
