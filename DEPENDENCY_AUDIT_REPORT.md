# Dependency & SDK Audit Report

**Scope**: Meeting pipeline — all dependencies and SDKs  
**Date**: $(date)  
**Status**: 🔴 4 CRITICAL missing packages, 12+ missing env vars in `.env.example`

---

## 1. Installed SDKs (26 — All Verified ✅)

All packages declared in `apps/api/package.json` resolve correctly from `node_modules`:

| Package | Version | Used By |
|---------|---------|---------|
| `bullmq` | 5.4.1 | All 7 workers, queue-manager, system.monitor |
| `ioredis` | 5.3.2 | redisClient.ts (BullMQ connections, Redis cluster) |
| `pg` | 8.12.0 | Knex PostgreSQL driver (db.ts) |
| `knex` | 3.1.0 | Database query builder / connection pool |
| `openai` | 4.104.0 | Installed but **unused** — see §3 |
| `socket.io` | 4.7.4 | WebSocket gateway (socket.ts) |
| `ws` | 8.19.0 | Deepgram raw WebSocket client, transcription service |
| `prom-client` | 15.1.3 | Prometheus metrics (meeting-metrics, system.monitor) |
| `winston` | 3.11.0 | Structured logging |
| `zod` | 3.22.4 | Schema validation |
| `uuid` | 9.0.0 | Meeting/participant ID generation |
| `dotenv` | 16.4.0 | Environment variable loading |
| `livekit-server-sdk` | 2.15.0 | LiveKit token generation, room management |
| `axios` | 1.7.0 | HTTP client |
| `stripe` | 14.14.0 | Payment processing |
| `express` | 4.18.2 | HTTP framework |
| `helmet` | 7.1.0 | Security headers |
| `cors` | 2.8.5 | CORS middleware |
| `jsonwebtoken` | 9.0.2 | JWT auth |
| `bcryptjs` | 2.4.3 | Password hashing |
| `multer` | 1.4.5 | File upload middleware |
| `nodemailer` | 6.9.8 | Email sending |
| `compression` | 1.7.4 | HTTP compression |
| `express-rate-limit` | 7.1.5 | Rate limiting |
| `@google-cloud/text-to-speech` | 6.4.0 | Google TTS |
| `google-auth-library` | 9.6.3 | Google auth |

---

## 2. Missing SDKs — NOT Installed ❌

These packages are **dynamically imported in source code** but are **not declared in `package.json`** and **not installed in `node_modules`**. They will fail at runtime.

### CRITICAL (used in core meeting pipeline)

| Package | Import Location | Purpose | Impact if Missing |
|---------|----------------|---------|-------------------|
| `redis` (node-redis v4) | `services/cache.service.ts:35` | `createClient` for pub/sub cache | Falls back to in-memory — **no cross-instance pub/sub** |
| | `modules/meeting/services/meeting-cache.service.ts:53` | Meeting state cache | Falls back to in-memory — **cache lost on restart** |
| | `modules/meeting/services/event-bus.service.ts:44` | Cross-process event bus | Falls back to in-memory — **events don't reach other instances** |

### HIGH (used in translation pipeline)

| Package | Import Location | Purpose | Impact if Missing |
|---------|----------------|---------|-------------------|
| `franc` | `workers/translation.worker.ts:92` | Language auto-detection | Falls back to skip — **translation may target wrong language** |
| `@google-cloud/translate` | `workers/translation.worker.ts` (dynamic) | Google Translate API | Falls back to mock — **no real translation** |
| `deepl-node` | `workers/translation.worker.ts:540` (dynamic) | DeepL Translate API | Falls back to mock — **no real translation** |

### LOW (referenced but not actively used)

| Package | Notes |
|---------|-------|
| `eventemitter3` | Checked; not actually imported in current code |
| `@deepgram/sdk` | Not used — code uses raw WebSocket via `ws` (correct) |
| `rate-limiter-flexible` | Not imported in current code |

---

## 3. Unused Dependencies

| Package | Status | Details |
|---------|--------|---------|
| `openai` (4.104.0) | **Installed but unused** | `minutes-ai.service.ts` uses raw `fetch` to `https://api.openai.com/v1/chat/completions` (or AI proxy URL) instead of the OpenAI SDK. Could be removed or code refactored to use it. |

---

## 4. Environment Variable Requirements

### Present in `.env.example` ✅
```
NODE_ENV, PORT, API_URL
DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME
REDIS_URL
JWT_SECRET, JWT_REFRESH_SECRET, JWT_EXPIRY, JWT_REFRESH_EXPIRY
STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
PAYSTACK_SECRET_KEY, PAYSTACK_WEBHOOK_SECRET
FLUTTERWAVE_SECRET_KEY, FLUTTERWAVE_WEBHOOK_SECRET
OPENAI_API_KEY
GOOGLE_APPLICATION_CREDENTIALS
SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
UPLOAD_MAX_SIZE, UPLOAD_DIR
FIREBASE_PROJECT_ID
CORS_ORIGINS
```

### MISSING from `.env.example` ❌

These are read in `config.ts` or directly via `process.env` but absent from `.env.example`:

| Variable | Used In | Default | Required in Prod? |
|----------|---------|---------|-------------------|
| `DEEPGRAM_API_KEY` | `config.ts` → deepgram.apiKey | `''` | **YES** — no transcription without it |
| `DEEPGRAM_MODEL` | `config.ts` → deepgram.model | `'nova-2'` | No |
| `DEEPGRAM_LANGUAGE` | `config.ts` → deepgram.language | `'en'` | No |
| `LIVEKIT_URL` | `config.ts` → livekit.url | `''` | **YES** — no meeting rooms without it |
| `LIVEKIT_API_KEY` | `config.ts` → livekit.apiKey | `''` | **YES** — no token generation |
| `LIVEKIT_API_SECRET` | `config.ts` → livekit.apiSecret | `''` | **YES** — no token generation |
| `REDIS_HOST` | `config.ts` → redis, production validation | none | **YES** if `REDIS_URL` not set |
| `REDIS_PORT` | Various Redis files | `6379` | No |
| `REDIS_PASSWORD` | Various Redis files | `''` | Depends on setup |
| `REDIS_CLUSTER_NODES` | `redisClient.ts` | none | Only if clustered |
| `REDIS_DB` | `redisClient.ts` | `0` | No |
| `TRANSLATION_PROVIDER` | `config.ts` → translation.provider | `'google'` | No |
| `TRANSLATION_LANGUAGES` | `config.ts` → translation.targetLanguages | `'es,fr,de,pt,zh'` | No |
| `AI_PROXY_URL` | `config.ts` → aiProxy.url | `''` | If using AI proxy |
| `AI_PROXY_KEY` | `config.ts` → aiProxy.apiKey | `''` | If using AI proxy |
| `DATABASE_URL` | `db.ts` | none | Alternative to DB_* vars |

---

## 5. Worker Dependency Matrix

All 7 workers verified — imports resolve correctly:

| Worker | bullmq | ioredis | pg/knex | prom-client | Other |
|--------|--------|---------|---------|-------------|-------|
| `transcript.worker.ts` | ✅ | ✅ (via redisClient) | ✅ (db) | ✅ | — |
| `translation.worker.ts` | ✅ | ✅ (via redisClient) | — | ✅ | ❌ `franc`, ❌ `@google-cloud/translate`, ❌ `deepl-node` |
| `broadcast.worker.ts` | ✅ | ✅ (via redisClient) | — | ✅ | ❌ `redis` (via event-bus) |
| `minutes.worker.ts` | ✅ | ✅ (via redisClient) | ✅ (db) | ✅ | Uses raw fetch to OpenAI |
| `notification.worker.ts` | ✅ | ✅ (via redisClient) | — | — | — |
| `email.worker.ts` | ✅ | ✅ (via redisClient) | — | — | nodemailer ✅ |
| `audit.worker.ts` | ✅ | ✅ (via redisClient) | — | — | — |

---

## 6. Queue Infrastructure

| Queue Name | Type | Redis Backend | Status |
|------------|------|---------------|--------|
| `transcript-events` | BullMQ | ioredis via `createBullMQConnection()` | ✅ Works |
| `translation-jobs` | BullMQ | ioredis via `createBullMQConnection()` | ✅ Works (but worker deps missing) |
| `broadcast-events` | BullMQ | ioredis via `createBullMQConnection()` | ✅ Works |
| `minutes-generation` | BullMQ | ioredis via `createBullMQConnection()` | ✅ Works |
| System monitor queues | BullMQ | ioredis via `createBullMQConnection()` | ✅ Works |
| Meeting cleanup queues | BullMQ | ioredis via `createBullMQConnection()` | ✅ Works |

**Note**: Sharded queue system (`shard-router.ts`, `queue-manager.ts`) exists but is not wired into the pipeline (see Pipeline Audit Report for details).

---

## 7. Database Driver

| Component | Package | Status |
|-----------|---------|--------|
| Query builder | `knex` 3.1.0 | ✅ Installed |
| PostgreSQL driver | `pg` 8.12.0 | ✅ Installed |
| Connection | `db.ts` — pool min:2, max:20 | ✅ Configured |
| SSL | Auto-normalizes `sslmode` in connection URLs | ✅ |
| Fallback | Supports `DATABASE_URL` or individual `DB_*` vars | ✅ |

No native compilation issues — `pg` uses JavaScript bindings by default (not `pg-native`).

---

## 8. Native / Binary Dependencies

No packages requiring native compilation (`node-gyp`, `.node` binaries) are used in the meeting pipeline. All dependencies are pure JavaScript/TypeScript:

- `bcryptjs` (JS implementation, not `bcrypt` which needs native)
- `ws` (pure JS WebSocket)
- `pg` (pure JS PostgreSQL driver, not `pg-native`)

✅ No native dependency risks.

---

## 9. Install Commands

### Critical — Required for production meeting pipeline:

```bash
cd apps/api

# Redis pub/sub client (event-bus, meeting-cache, cache service)
npm install redis

# Translation pipeline dependencies
npm install franc
npm install @google-cloud/translate
npm install deepl-node
```

### Optional — Clean up unused:

```bash
# Remove unused OpenAI SDK (raw fetch is used instead)
npm uninstall openai

# OR refactor minutes-ai.service.ts to use the SDK
```

### One-liner to install all missing:

```bash
cd apps/api && npm install redis franc @google-cloud/translate deepl-node
```

---

## 10. `.env.example` Additions Required

Add these lines to `apps/api/.env.example`:

```env
# ── LiveKit (Meeting Rooms) ─────────────────────────────────
LIVEKIT_URL=ws://localhost:7880
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=

# ── Deepgram (Transcription) ────────────────────────────────
DEEPGRAM_API_KEY=
DEEPGRAM_MODEL=nova-2
DEEPGRAM_LANGUAGE=en

# ── Redis (extended config) ─────────────────────────────────
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0
# REDIS_CLUSTER_NODES=host1:6379,host2:6379  (if using cluster mode)

# ── Translation ─────────────────────────────────────────────
TRANSLATION_PROVIDER=google
TRANSLATION_LANGUAGES=es,fr,de,pt,zh

# ── AI Proxy (optional) ─────────────────────────────────────
AI_PROXY_URL=
AI_PROXY_KEY=
```

---

## Summary

| Category | Status | Count |
|----------|--------|-------|
| Declared & installed | ✅ | 26 packages |
| Missing from package.json | ❌ CRITICAL | 4 packages (`redis`, `franc`, `@google-cloud/translate`, `deepl-node`) |
| Unused installed | ⚠️ | 1 package (`openai`) |
| Missing env vars in .env.example | ⚠️ | 16 variables |
| Native dependency risks | ✅ None | 0 |
| Queue infrastructure | ✅ | All 4 queues use installed BullMQ + ioredis |
| Database driver | ✅ | Knex + pg, pure JS |
