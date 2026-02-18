# OrgsLedger — Technical Architecture & LiveKit Migration Guide

> **Status**: LiveKit migration **COMPLETED**. Jitsi has been fully replaced.
> **Purpose**: Historical architecture reference documenting the pre-migration analysis and implementation plan.
> **Note**: References to Jitsi in this document describe the *previous* architecture. See `TECHNICAL_README.md` for the current LiveKit-based architecture.

---

## Table of Contents

- [Phase 1 — Frontend Architecture](#phase-1--frontend-architecture)
- [Phase 2 — Backend Architecture](#phase-2--backend-architecture)
- [Phase 3 — Database Layer](#phase-3--database-layer)
- [Phase 4 — Current Jitsi Integration Analysis](#phase-4--current-jitsi-integration-analysis)
- [Phase 5 — Translation & Transcription Pipeline](#phase-5--translation--transcription-pipeline)
- [Phase 6 — Integration Gap Analysis](#phase-6--integration-gap-analysis)
- [Phase 7 — Surgical LiveKit Replacement Plan](#phase-7--surgical-livekit-replacement-plan)
- [Phase 8 — Performance, Safety & Migration Strategy](#phase-8--performance-safety--migration-strategy)
- [Appendix A — Complete API Endpoint Map](#appendix-a--complete-api-endpoint-map)
- [Appendix B — Socket Event Catalog](#appendix-b--socket-event-catalog)
- [Appendix C — Database Schema Relationships](#appendix-c--database-schema-relationships)

---

## Phase 1 — Frontend Architecture

### 1.1 Framework Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Runtime | React Native | 0.73.6 |
| Platform | Expo | ~50.0.0 |
| Navigation | Expo Router | ~3.4.0 |
| State | Zustand | 4.5.0 |
| Real-time | socket.io-client | 4.7.4 |
| HTTP | Axios | 1.6.7 |
| Native Video (fallback) | expo-web-browser | — |

### 1.2 State Management — Zustand Stores

Five stores live in `apps/mobile/src/stores/`:

| Store | File | Purpose |
|-------|------|---------|
| `useAuthStore` | `auth.store.ts` | JWT tokens, user object, login/logout |
| `useOrgStore` | `org.store.ts` | Active organization, membership role |
| `useNotificationStore` | `notification.store.ts` | Unread count, notification list |
| `useSubscriptionStore` | `subscription.store.ts` | Plan, wallet balances, feature flags |
| `useMeetingStore` | `meeting.store.ts` | **All meeting state (see below)** |

### 1.3 Meeting Store — Complete State Shape

File: `apps/mobile/src/stores/meeting.store.ts` (209 lines)

```
MeetingState {
  // Core
  meetingId: string | null
  orgId: string | null
  meeting: any | null           ← full meeting object from API
  status: 'scheduled' | 'live' | 'ended' | 'cancelled'
  isJoined: boolean

  // Participants (from socket events, NOT from Jitsi)
  participants: MeetingParticipant[]    ← { userId, name, isModerator, handRaised, language }
  
  // Translation
  myLanguage: string                    ← ISO-639-1 code, default 'en'
  translations: TranslationEntry[]      ← max 100 entries (sliced)
  interimText: string                   ← live interim speech text
  translationParticipants: Array<{ userId, name, language }>

  // Moderator controls
  isRecording: boolean
  isLocked: boolean
  meetingEndedByModerator: boolean
}
```

**Critical observation**: The meeting store tracks participants via Socket.IO events, NOT via Jitsi's participant system. Jitsi runs in an isolated iframe — the app has no programmatic access to Jitsi's participant list, audio tracks, or media state. LiveKit replaces the iframe with direct SDK control, eliminating this dual-tracking.

### 1.4 Meeting UI — File Locations

```
apps/mobile/app/meetings/
  └── [meetingId].tsx              ← 2043 lines — Meeting detail screen
                                      Contains: Jitsi iframe embed, control bar,
                                      transcript/minutes tabs, vote UI, join flow

apps/mobile/src/components/ui/
  └── LiveTranslation.tsx          ← 896 lines — Live translation panel
                                      Contains: Web Speech API STT, TTS playback,
                                      language selector, socket event listeners
```

### 1.5 Jitsi Iframe Embed — Current Implementation

Location: `apps/mobile/app/meetings/[meetingId].tsx`

The Jitsi iframe URL is constructed via `useMemo`:

```
https://{domain}/{roomName}?jwt={token}#{configHash}

Where:
  domain    = joinConfig.domain (e.g., "meet.orgsledger.com")
  roomName  = joinConfig.roomName (e.g., "org_a1b2c3d4e5f6_meeting_g7h8i9j0k1l2")
  token     = joinConfig.jwt (HS256 JWT signed with JITSI_APP_SECRET)
  configHash = JSON-encoded config.configOverwrite + config.interfaceConfigOverwrite + config.userInfo
```

**Platform-specific join behavior:**
- **Web**: Sets `showVideo=true` → renders `<iframe>` with `jitsiIframeSrc` in a container div
- **Native (iOS/Android)**: Opens `WebBrowser.openBrowserAsync(jitsiUrl)` → leaves the app entirely

**Break point [BP-1]**: The iframe is a black box. No media track access, no audio capture, no programmatic mute/unmute, no participant metadata. All meeting features (hand raise, recording status, lock) are propagated via a parallel Socket.IO channel, not through Jitsi.

### 1.6 Audio/Video Controls — Current State

The control bar in `[meetingId].tsx` provides buttons for:

| Control | Implementation | Jitsi-Dependent? |
|---------|---------------|-------------------|
| Join Video | API POST → iframe show | YES — triggers iframe |
| Join Audio | API POST → iframe show (audio-only config) | YES — audio config preset |
| Leave | `setShowVideo(false)` + socket `meeting:leave` | Partial — hides iframe |
| Raise Hand | Socket `meeting:raise-hand` | NO |
| Start/End Meeting | API POST → socket broadcast | NO |
| Start Recording | Socket `meeting:start-recording` | NO (metadata only) |
| Lock Meeting | Socket `meeting:lock` | NO (metadata only) |
| Translation | LiveTranslation component | NO |

**Break point [BP-2]**: "Start Recording" and "Lock Meeting" are metadata-only operations broadcasted via Socket.IO. They do NOT actually trigger Jitsi recording or room locking. These are UI indicators that other participants see, but no actual recording occurs server-side.

### 1.7 Frontend Architecture Diagram

```
┌──────────────────────────────────────────────────────────┐
│                    React Native App                       │
│  ┌────────────┐  ┌────────────┐  ┌─────────────────────┐ │
│  │  Expo       │  │  Zustand   │  │  Socket.IO Client   │ │
│  │  Router     │  │  5 Stores  │  │  (persistent conn)  │ │
│  └──────┬─────┘  └──────┬─────┘  └──────────┬──────────┘ │
│         │               │                    │            │
│  ┌──────▼─────────────────────────────────────▼──────────┐ │
│  │              [meetingId].tsx (2043 lines)              │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐ │ │
│  │  │ Jitsi iframe │  │ Control Bar  │  │ Tabs:       │ │ │
│  │  │ (black box)  │  │ (socket-     │  │ • Meeting   │ │ │
│  │  │ No API       │  │  driven)     │  │ • Transcript│ │ │
│  │  │ No tracks    │  │              │  │ • Minutes   │ │ │
│  │  └──────────────┘  └──────────────┘  └─────────────┘ │ │
│  │  ┌────────────────────────────────────────────────┐   │ │
│  │  │ LiveTranslation.tsx (896 lines)                │   │ │
│  │  │  Web Speech API → socket → server → TTS       │   │ │
│  │  └────────────────────────────────────────────────┘   │ │
│  └───────────────────────────────────────────────────────┘ │
│         │ HTTP                        │ WebSocket          │
└─────────┼────────────────────────────┼────────────────────┘
          ▼                            ▼
   Express API (:3000)          Socket.IO (:3000)
```

---

## Phase 2 — Backend Architecture

### 2.1 Server Stack

| Component | Technology | File |
|-----------|-----------|------|
| HTTP Server | Express 4.18.2 | `apps/api/src/index.ts` (234 lines) |
| WebSocket | Socket.IO 4.7.4 | `apps/api/src/socket.ts` (696 lines) |
| Database | PostgreSQL 16 + Knex 3.1.0 | `apps/api/src/db.ts` |
| Validation | Zod 3.22 | Per-route schemas |
| Auth | JWT (jsonwebtoken) | Custom middleware |
| Logging | Winston 3.11 | `apps/api/src/logger.ts` |
| Config | dotenv + `config.ts` | `apps/api/src/config.ts` (115 lines) |

### 2.2 Server Bootstrap Sequence

File: `apps/api/src/index.ts`

```
1. Create Express app
2. Create HTTP server
3. setupSocketIO(server) → io instance
4. app.set('io', io) + services.register('io', io)
5. new AIService(io) → aiService
6. app.set('aiService', aiService) + services.register('aiService', aiService)
7. Middleware chain:
   a. helmet()
   b. CORS (dynamic origin)
   c. Raw body capture for Stripe/Paystack webhooks
   d. JSON parser (10MB limit)
   e. Rate limiting (4 tiers)
   f. Pagination cap middleware
   g. Audit context middleware
   h. Metrics middleware
   i. Request logging
   j. JWT-protected /uploads static
8. Mount 17 route files at /api/*
9. ensureSuperAdmin()
10. server.listen(PORT)
11. startScheduler()
```

### 2.3 Rate Limiting Tiers

| Tier | Window | Max Requests | Applied To |
|------|--------|-------------|------------|
| Global | 15 min | 1000 | All routes |
| Auth | 15 min | 15 | `/api/auth/login`, `/api/auth/register` |
| Refresh | 15 min | 30 | `/api/auth/refresh` |
| Webhook | 1 min | 60 | `/api/webhooks/*` |

### 2.4 Middleware Chain

File: `apps/api/src/index.ts`

```
Request → helmet → CORS → rawBodyCapture → jsonParser(10MB)
  → rateLimiter → paginationCap → auditContext → metrics
  → requestLogging → auth(JWT) → route handler → response
```

### 2.5 Route Mount Map

All routes mounted at `/api/` prefix:

| Route File | Mount Path | Key Operations |
|-----------|-----------|----------------|
| `auth.ts` | `/api/auth` | login, register, refresh, verify-email |
| `users.ts` | `/api/users` | profile, avatar, FCM token |
| `organizations.ts` | `/api/organizations` | CRUD, settings, billing |
| `memberships.ts` | `/api/memberships` | join, leave, role management |
| `meetings.ts` | `/api/meetings` | **CREATE, JOIN, START, END, transcripts, minutes** |
| `channels.ts` | `/api/channels` | chat channel CRUD |
| `messages.ts` | `/api/messages` | send, edit, delete messages |
| `dues.ts` | `/api/dues` | create, assign, track dues |
| `fines.ts` | `/api/fines` | issue, pay, waive fines |
| `donations.ts` | `/api/donations` | campaigns, donate |
| `transactions.ts` | `/api/transactions` | ledger queries |
| `subscriptions.ts` | `/api/subscriptions` | plan management |
| `ai-wallet.ts` | `/api/ai-wallet` | balance, top-up, history |
| `notifications.ts` | `/api/notifications` | list, mark read |
| `events.ts` | `/api/events` | organization events |
| `polls.ts` | `/api/polls` | create, vote, results |
| `documents.ts` | `/api/documents` | file management |

### 2.6 Role System

#### Global Roles (users table)

| Role | Level | Scope |
|------|-------|-------|
| `member` | 1 | Default — can join organizations |
| `super_admin` | 4 | Platform-wide admin |
| `developer` | 5 | Full platform access |

#### Organization Roles (memberships table)

| Role | Level | Capabilities |
|------|-------|-------------|
| `guest` | 0 | View only |
| `member` | 1 | Participate in meetings, chat, pay dues |
| `executive` | 2 | Create meetings, manage some settings |
| `org_admin` | 3 | Full org management, billing, roles |

#### Moderator Determination (Meeting Context)

File: `apps/api/src/routes/meetings.ts` — JOIN endpoint

```typescript
const isModerator = meeting.created_by === userId || 
  ['org_admin', 'executive'].includes(membership.role);
```

Moderator status flows into:
1. Jitsi JWT claim: `context.user.moderator: true`
2. Jitsi JWT claim: `context.user.affiliation: 'owner'` (moderator) or `'member'` (non-moderator)
3. Socket broadcast: `meeting:participant-joined { isModerator: true }`
4. JWT feature claims: `recording: true, livestreaming: true, transcription: true` (moderator only)

### 2.7 Meeting State Machine

```
  scheduled ──────► live ──────► ended
      │                           ▲
      │                           │
      └──────► cancelled          │
                                  │
  (any status can be manually ended by org_admin/executive)
```

State transitions and their triggers:

| Transition | Trigger | Endpoint | Side Effects |
|-----------|---------|----------|-------------|
| scheduled → live | Moderator starts | `POST /:orgId/:meetingId/start` | Broadcasts `meeting:started` to org + meeting rooms |
| live → ended | Moderator ends | `POST /:orgId/:meetingId/end` | Broadcasts `meeting:ended`, `forceDisconnectMeeting()`, triggers AI processing if enabled |
| scheduled → cancelled | Admin cancels | `PATCH /:orgId/:meetingId` | Status update only |

### 2.8 Socket.IO — Real-Time Layer

File: `apps/api/src/socket.ts` (696 lines)

#### Connection Authentication

```
Client connects → auth middleware intercepts →
  1. Extract JWT from handshake.auth.token
  2. jwt.verify(token, config.jwt.secret)
  3. Query: SELECT * FROM users WHERE id = decoded.userId AND is_active = true
  4. Set socket.userId, socket.email, socket.globalRole
  5. Join rooms: user:{userId}, org:{orgId}* (for each membership), channel:{channelId}*
```

**Break point [BP-3]**: Auth middleware queries the `users` table on every single WebSocket connection. For apps with many reconnections (mobile backgrounding), this creates repeated DB hits. No caching layer.

#### Room Topology

```
user:{userId}           ← personal notifications, DMs
org:{orgId}             ← org-wide broadcasts (meeting started, financial updates)
channel:{channelId}     ← chat channel messages
meeting:{meetingId}     ← meeting participants, translation, hand raises
ledger:{orgId}          ← financial update subscriptions
```

#### Meeting-Specific Events

| Event | Direction | Payload | Purpose |
|-------|-----------|---------|---------|
| `meeting:join` | Client → Server | `{ meetingId, orgId }` | Join meeting room, load language prefs |
| `meeting:leave` | Client → Server | `{ meetingId }` | Leave room, cleanup language map |
| `meeting:participant-joined` | Server → Room | `{ userId, name, isModerator }` | Notify room of new participant |
| `meeting:participant-left` | Server → Room | `{ userId }` | Notify room of departure |
| `meeting:raise-hand` | Client → Server | `{ meetingId, raised }` | Toggle hand raise |
| `meeting:hand-raised` | Server → Room | `{ meetingId, userId, name, raised }` | Broadcast hand state |
| `meeting:started` | Server → Org+Room | `{ meetingId, title, status }` | Meeting went live |
| `meeting:ended` | Server → Org+Room | `{ meetingId, title, status }` | Meeting ended |
| `meeting:force-disconnect` | Server → Room | `{ meetingId }` | Force all clients to leave |
| `meeting:start-recording` | Client → Server | `{ meetingId }` | Broadcast recording state (metadata only) |
| `meeting:stop-recording` | Client → Server | `{ meetingId }` | Broadcast recording stopped |
| `meeting:recording-started` | Server → Room | `{ meetingId }` | Recording indicator ON |
| `meeting:recording-stopped` | Server → Room | `{ meetingId }` | Recording indicator OFF |
| `meeting:lock` | Client → Server | `{ meetingId, locked }` | Room lock toggle (metadata only) |
| `meeting:lock-changed` | Server → Room | `{ meetingId, locked }` | Room lock state broadcast |
| `meeting:minutes:ready` | Server → Room | `{ meetingId, ... }` | AI minutes completed |
| `meeting:minutes:processing` | Server → Room | `{ meetingId }` | AI minutes in progress |
| `meeting:minutes:failed` | Server → Room | `{ meetingId, error }` | AI minutes failed |

#### Translation Events

| Event | Direction | Payload | Purpose |
|-------|-----------|---------|---------|
| `translation:set-language` | Client → Server | `{ meetingId, language, receiveVoice }` | Set user's translation language |
| `translation:speech` | Client → Server | `{ meetingId, text, language, isFinal }` | Speech segment for translation |
| `translation:result` | Server → User | `{ text, translations, speakerName, ... }` | Translated result (per-user routing) |
| `translation:interim` | Server → Room | `{ meetingId, text, speakerName, lang }` | Interim (partial) speech display |
| `translation:participants` | Server → Room | `{ meetingId, participants }` | Language participant list update |
| `translation:language-restored` | Server → User | `{ language, receiveVoice }` | Restore saved language on rejoin |
| `transcript:stored` | Server → Room | `{ meetingId, transcript }` | New transcript row persisted |

### 2.9 Backend Services

| Service | File | Lines | Purpose |
|---------|------|-------|---------|
| `JitsiService` | `services/jitsi.service.ts` | 303 | JWT generation, room naming, video/audio config |
| `AIService` | `services/ai.service.ts` | 534 | Transcription (Google STT), minutes (GPT-4o) |
| `TranslationService` | `services/translation.service.ts` | 237 | Text translation with cache + fallback chain |

---

## Phase 3 — Database Layer

### 3.1 Complete Table Inventory

39 tables across 22 migrations. Meeting-critical tables marked with ★.

| # | Table | Migration | Meeting-Critical |
|---|-------|-----------|-----------------|
| 1 | `users` | 001 | ★ Auth, participant identity |
| 2 | `licenses` | 001 | |
| 3 | `organizations` | 001 | ★ Org context for meetings |
| 4 | `memberships` | 001 | ★ Role-based access, moderator check |
| 5 | `committees` | 001 | |
| 6 | `committee_members` | 001 | |
| 7 | `channels` | 001 | |
| 8 | `channel_members` | 001 | |
| 9 | `messages` | 001 | |
| 10 | `attachments` | 001 | |
| 11 | `meetings` | 001 | ★ Core meeting record |
| 12 | `agenda_items` | 001 | |
| 13 | `meeting_attendance` | 001 | ★ Auto-attendance on join |
| 14 | `votes` | 001 | |
| 15 | `vote_ballots` | 001 | |
| 16 | `meeting_minutes` | 001 | ★ AI-generated minutes |
| 17 | `dues` | 001 | |
| 18 | `fines` | 001 | |
| 19 | `donation_campaigns` | 001 | |
| 20 | `donations` | 001 | |
| 21 | `transactions` | 001 | |
| 22 | `refunds` | 001 | |
| 23 | `ai_credits` | 001 | |
| 24 | `ai_credit_transactions` | 001 | |
| 25 | `audit_logs` | 001 | |
| 26 | `notifications` | 001 | ★ Meeting notifications |
| 27 | `platform_config` | 001 | |
| 28 | `subscription_plans` | 006 | |
| 29 | `subscriptions` | 006 | ★ Feature gating, participant limits |
| 30 | `subscription_history` | 006 | |
| 31 | `ai_wallet` | 006 | ★ AI minutes budget |
| 32 | `ai_wallet_transactions` | 006 | |
| 33 | `translation_wallet` | 006 | ★ Translation budget |
| 34 | `translation_wallet_transactions` | 006 | |
| 35 | `usage_records` | 006 | |
| 36 | `invite_links` | 006 | |
| 37 | `meeting_join_logs` | 020 | ★ Audit trail per join |
| 38 | `meeting_transcripts` | 021 | ★ Live speech segments |
| 39 | `user_language_preferences` | 022 | ★ Per-user translation language |

### 3.2 Meeting-Critical Schemas

#### `meetings` table

```sql
id                    UUID PK DEFAULT uuid_generate_v4()
organization_id       UUID FK → organizations(id) CASCADE
title                 VARCHAR NOT NULL
description           TEXT
status                VARCHAR DEFAULT 'scheduled'  -- scheduled|live|ended|cancelled
scheduled_start       TIMESTAMP NOT NULL
scheduled_end         TIMESTAMP
actual_start          TIMESTAMP
actual_end            TIMESTAMP
created_by            UUID FK → users(id) CASCADE
ai_enabled            BOOLEAN DEFAULT false
audio_storage_url     VARCHAR                      -- uploaded audio for AI
translation_enabled   BOOLEAN DEFAULT false        -- (migration 005)
meeting_type          VARCHAR(10) DEFAULT 'video'  -- video|audio (migration 020)
max_participants      INTEGER DEFAULT 0            -- 0 = unlimited
duration_limit_minutes INTEGER DEFAULT 0           -- 0 = unlimited
lobby_enabled         BOOLEAN DEFAULT false
created_at            TIMESTAMP
updated_at            TIMESTAMP

INDEXES:
  (organization_id, status)
  (scheduled_start)
  (organization_id, meeting_type)  -- idx_meetings_org_type
```

**Note**: There is NO `jitsi_room_id` column in the schema. The room name is generated dynamically via `JitsiService.generateRoomName(orgId, meetingId)` at join time. The migration 001 code inserts `jitsi_room_id: 'pending'` but this column does not exist in the schema — it's silently ignored by Knex or was added via an untracked migration.

#### `meeting_transcripts` table (migration 021)

```sql
id                UUID PK
meeting_id        UUID FK → meetings(id) CASCADE
organization_id   UUID FK → organizations(id) CASCADE
speaker_id        UUID FK → users(id) SET NULL
speaker_name      VARCHAR(200) NOT NULL
original_text     TEXT NOT NULL
source_lang       VARCHAR(10) DEFAULT 'en'
translations      JSONB DEFAULT '{}'              -- {"fr": "Bonjour", "es": "Hola"}
spoken_at         BIGINT NOT NULL                 -- epoch ms from client
created_at        TIMESTAMP
updated_at        TIMESTAMP

INDEXES:
  (meeting_id, spoken_at)  -- idx_mt_meeting_spoken
  (organization_id)        -- idx_mt_org
```

#### `meeting_minutes` table

```sql
id                UUID PK
meeting_id        UUID FK → meetings(id) CASCADE  -- UNIQUE constraint
organization_id   UUID FK → organizations(id) CASCADE
transcript        JSONB DEFAULT '[]'
summary           TEXT
decisions         JSONB DEFAULT '[]'
motions           JSONB DEFAULT '[]'
action_items      JSONB DEFAULT '[]'
contributions     JSONB DEFAULT '[]'
ai_credits_used   DECIMAL(10,2) DEFAULT 0
status            VARCHAR DEFAULT 'processing'    -- processing|completed|failed
error_message     TEXT
generated_at      TIMESTAMP
download_formats  JSONB DEFAULT '{}'              -- (migration 021)
created_at        TIMESTAMP
updated_at        TIMESTAMP

INDEXES:
  UNIQUE(meeting_id)
  (organization_id)
```

#### `meeting_join_logs` table (migration 020)

```sql
id                UUID PK
meeting_id        UUID FK → meetings(id) CASCADE
user_id           UUID FK → users(id) CASCADE
organization_id   UUID FK → organizations(id) CASCADE
join_type         VARCHAR(10) NOT NULL            -- 'video' | 'audio'
is_moderator      BOOLEAN DEFAULT false
ip_address        VARCHAR(45)
user_agent        VARCHAR(500)
joined_at         TIMESTAMP DEFAULT now()
left_at           TIMESTAMP

INDEXES:
  (meeting_id, user_id)           -- idx_mjl_meeting_user
  (organization_id, joined_at)    -- idx_mjl_org_joined
```

#### `user_language_preferences` table (migration 022)

```sql
id                  UUID PK
user_id             UUID FK → users(id) CASCADE
organization_id     UUID FK → organizations(id) CASCADE
preferred_language  VARCHAR(10) DEFAULT 'en'
receive_voice       BOOLEAN DEFAULT true
receive_text        BOOLEAN DEFAULT true
created_at          TIMESTAMP
updated_at          TIMESTAMP

UNIQUE(user_id, organization_id)
INDEX(organization_id)
```

### 3.3 N+1 Query Risks

| Location | Query Pattern | Frequency | Severity |
|----------|--------------|-----------|----------|
| `socket.ts` auth middleware | `db('users').where({ id }).first()` | Every WS connection | **HIGH** — mobile reconnects happen frequently |
| `socket.ts` `translation:speech` handler | `db('users').where({ id: socket.userId }).first()` | Every final speech segment when speaker name not in langMap | **MEDIUM** — fallback path only |
| `socket.ts` `translation:speech` handler | `io.in(room).fetchSockets()` + loop | Every translated speech segment | **HIGH** — O(n) socket scan per translation result |
| `socket.ts` `translation:set-language` handler | `db('user_language_preferences').insert().onConflict().merge()` | Every language change | **LOW** — infrequent |
| `socket.ts` `_persistTranscript` | `db.schema.hasTable('meeting_transcripts')` | Every final speech segment | **HIGH** — schema check on every write |
| `routes/meetings.ts` JOIN | 7 sequential DB queries: meeting, subscription, plan, user, org, membership, log | Every join | **MEDIUM** — could be parallelized |
| `ai.service.ts` `processMinutes` | Sequential: wallet check → deduct → transcribe → generate → update → notify | Per meeting end | **LOW** — async, runs once |

### 3.4 Missing Indexes

| Table | Recommended Index | Reason |
|-------|------------------|--------|
| `meeting_transcripts` | `(meeting_id, speaker_id)` | Query by speaker for AI processing |
| `meeting_join_logs` | `(user_id, joined_at)` | User's meeting history queries |
| `memberships` | `(user_id, is_active)` | Socket connection room joins — queries all active memberships |
| `ai_wallet` | Already has `UNIQUE(organization_id)` | OK |
| `translation_wallet` | Already has `UNIQUE(organization_id)` | OK |

### 3.5 Legacy / Dead Fields

| Table | Field | Status | Notes |
|-------|-------|--------|-------|
| `meetings` | `audio_storage_url` | Semi-active | Used only when audio file uploaded for AI processing; live transcripts make this secondary |
| `ai_credits` | Entire table | **SUPERSEDED** | Migration 006 created `ai_wallet` + `ai_wallet_transactions`. The old `ai_credits` / `ai_credit_transactions` tables from migration 001 still exist but are unused by current code |
| `licenses` | Entire table | **SUPERSEDED** | Replaced by `subscription_plans` + `subscriptions` in migration 006 |
| `organizations.license_id` | FK to licenses | **DEAD** | No longer used — subscription system replaced licensing |

---

## Phase 4 — Current Jitsi Integration Analysis

### 4.1 Jitsi Service — Token & Room Generation

File: `apps/api/src/services/jitsi.service.ts` (303 lines)

#### Room Name Generation

```typescript
static generateRoomName(orgId: string, meetingId: string): string {
  const orgSlug = orgId.replace(/-/g, '').slice(0, 12);
  const meetingSlug = meetingId.replace(/-/g, '').slice(0, 12);
  return `org_${orgSlug}_meeting_${meetingSlug}`;
}
// Example: "org_a1b2c3d4e5f6_meeting_g7h8i9j0k1l2"
```

#### JWT Token Structure

```typescript
const payload = {
  aud: 'jitsi',                           // Fixed audience
  iss: config.jitsi.appId,                // 'orgsledger' (from env)
  sub: config.jitsi.domain,              // 'meet.orgsledger.com'
  room: roomName,                         // Generated room name
  exp: Math.floor(Date.now() / 1000) + config.jitsi.tokenExpirySeconds,  // 7200s default
  context: {
    user: {
      id: uniqueId,                       // {odId}-{meetingId}-{Date.now()}
      name: userName,
      email: userEmail,
      avatar: avatarUrl,
      affiliation: isModerator ? 'owner' : 'member',
      moderator: isModerator,
    },
    features: {
      recording: isModerator,
      livestreaming: isModerator,
      transcription: isModerator,
      'outbound-call': false,
    },
  },
};
// Signed with: jwt.sign(payload, config.jitsi.appSecret, { algorithm: 'HS256' })
```

#### Config Presets

Three preset configs returned by `buildJoinConfig()`:

**Video Config** (`getVideoConfig()`):
- Resolution: 720p ideal, 360p min
- P2P: enabled with STUN servers
- Audio processing: echo cancellation, noise suppression, AGC
- Full toolbar: camera, microphone, chat, tileview, settings, fullscreen, raise hand, etc.

**Audio Config** (`getAudioOnlyConfig()`):
- Video: disabled entirely (`startWithVideoMuted: true, disableVideoBackground: true`)
- Camera: disabled
- Bandwidth: minimized (`videoQuality.maxBitrateForVideoTier.low: 100000`)
- Toolbar: microphone, chat, raise hand, tileview only

**Interface Config** (`getInterfaceConfig(orgName?)`):
- Branding: watermark disabled, `APP_NAME: orgName || 'OrgsLedger Meeting'`
- Timer: visible
- Notifications: connection quality, lobby hidden
- Deep linking: disabled

### 4.2 Complete Join Flow — Step by Step

```
Client                          API Server                       Jitsi Stack
  │                                │                                │
  │ POST /api/meetings/:orgId/     │                                │
  │      :meetingId/join            │                                │
  │ { joinType: 'video'|'audio' }  │                                │
  │──────────────────────────────►│                                │
  │                                │ 1. meeting = SELECT * FROM meetings WHERE id=meetingId
  │                                │ 2. CHECK status != 'ended'
  │                                │ 3. subscription = SELECT * FROM subscriptions WHERE org_id
  │                                │ 4. plan = SELECT * FROM subscription_plans WHERE id=plan_id
  │                                │ 5. CHECK max_participants not exceeded
  │                                │ 6. CHECK duration_limit not exceeded
  │                                │ 7. user = SELECT * FROM users WHERE id=userId
  │                                │ 8. org = SELECT name FROM organizations WHERE id=orgId
  │                                │ 9. membership = SELECT * FROM memberships WHERE user+org
  │                                │ 10. isModerator = (created_by === userId || role in [org_admin, executive])
  │                                │ 11. meetingType = meeting.meeting_type (allow joinType override for audio)
  │                                │ 12. roomName = generateRoomName(orgId, meetingId)
  │                                │ 13. REQUIRE JITSI_APP_SECRET (throw if empty)
  │                                │ 14. jwt = generateJitsiToken({ roomName, userName, email, avatar,
  │                                │         odId: orgId, meetingId, isModerator })
  │                                │ 15. config = buildJoinConfig({ domain, roomName, jwt,
  │                                │         meetingType, orgName, userName, email, avatar, isModerator })
  │                                │ 16. INSERT INTO meeting_join_logs (...)
  │                                │ 17. INSERT INTO meeting_attendance (...) ON CONFLICT DO NOTHING
  │                                │ 18. socket.broadcast 'meeting:participant-joined'
  │◄──────────────────────────────│
  │ { joinConfig: { domain,        │
  │   roomName, jwt, config... } } │
  │                                │
  │ [WEB] Build iframe URL:        │
  │ https://domain/roomName        │
  │   ?jwt=TOKEN#configHash        │                                │
  │─────────────────────────────────────────────────────────────────►│
  │                                                                 │
  │                                │                 Prosody validates JWT:
  │                                │                 - iss matches JWT_APP_ID
  │                                │                 - aud matches JWT_ACCEPTED_AUDIENCES
  │                                │                 - signature matches JWT_APP_SECRET
  │                                │                 - token_verification module
  │                                │                 - token_affiliation module sets
  │                                │                   moderator role from affiliation claim
  │                                │                                │
  │◄────────────────────────────────────────────────────────────────│
  │ Jitsi UI renders in iframe      │                                │
  │ (WebRTC media flows directly    │                                │
  │  between browser and JVB)       │                                │
```

### 4.3 Jitsi Docker Stack

File: `docker-compose.prod.yml`

```
┌─────────────────────────────────────────────────────────────────┐
│                    Docker Compose Network                        │
│                                                                 │
│  ┌──────────┐   ┌──────────────┐   ┌──────────────┐            │
│  │  nginx   │──►│  jitsi-web   │   │  jitsi-xmpp  │            │
│  │  :443    │   │  :80         │   │  (Prosody)   │            │
│  │          │   │  stable-9823 │   │  :5222,5280  │            │
│  └──────────┘   └──────┬───────┘   └──────┬───────┘            │
│       │                │                   │                    │
│       │         ┌──────▼───────┐   ┌──────▼───────┐            │
│       │         │ jitsi-jicofo │   │   jitsi-jvb  │            │
│       │         │ (Focus)      │   │ (Video Bridge│            │
│       │         └──────────────┘   │  :10000/udp  │            │
│       │                            │  :8080       │            │
│       │                            └──────────────┘            │
│       │                                                         │
│       │    ┌──────────┐   ┌──────────┐   ┌──────────┐          │
│       └──►│  api      │──►│ postgres │   │  redis   │          │
│           │  :3000    │   │  :5432   │   │  :6379   │          │
│           └──────────┘   └──────────┘   └──────────┘          │
│                                                                 │
│  Network: meet.orgsledger.com (bridge)                          │
│  Jitsi services: jitsi-web, jitsi-xmpp, jitsi-jicofo, jitsi-jvb│
│  Default network: postgres, redis, api, web                     │
└─────────────────────────────────────────────────────────────────┘
```

**Nginx routing** (file: `deploy/nginx.conf`):

| Domain | Upstream | Purpose |
|--------|----------|---------|
| `orgsledger.com` | `api:3000` | Landing page, admin console, gateway API |
| `app.orgsledger.com` | `api:3000` | Expo web app + API |
| `api.orgsledger.com` | `api:3000` | API only |
| `meet.orgsledger.com` | `jitsi-web:80` | Jitsi Meet UI + XMPP WebSocket |

**Jitsi-specific nginx directives:**
- `X-Frame-Options: ALLOW-FROM https://orgsledger.com https://app.orgsledger.com` — allows iframe embedding
- `Content-Security-Policy: frame-ancestors https://orgsledger.com https://app.orgsledger.com` — CSP for iframe
- `/http-bind` → BOSH proxy
- `/xmpp-websocket` → XMPP WebSocket proxy

### 4.4 Jitsi Configuration (Environment Variables)

From `docker-compose.prod.yml`:

```
XMPP_DOMAIN=meet.orgsledger.com
XMPP_AUTH_DOMAIN=auth.meet.orgsledger.com
XMPP_MUC_DOMAIN=conference.meet.orgsledger.com
XMPP_INTERNAL_MUC_DOMAIN=internal-muc.meet.orgsledger.com

AUTH_TYPE=jwt
ENABLE_AUTH=1
ENABLE_GUESTS=0
JWT_APP_ID=orgsledger
JWT_APP_SECRET=9d91c6a6631af5ed641488460fb0da7bd1baf731c9c8b540e74777afd7c2c905
JWT_ACCEPTED_ISSUERS=orgsledger
JWT_ACCEPTED_AUDIENCES=jitsi
JWT_ALLOW_EMPTY=0

XMPP_MODULES=token_verification,token_affiliation
XMPP_MUC_MODULES=token_verification,token_affiliation

ENABLE_LOBBY=1
ENABLE_AV_MODERATION=1
ENABLE_PREJOIN_PAGE=0
ENABLE_CLOSE_PAGE=0
DISABLE_DEEP_LINKING=true
```

### 4.5 Break-Point Summary

| ID | Location | Description | Severity |
|----|----------|-------------|----------|
| BP-1 | `[meetingId].tsx` iframe | Jitsi iframe is a black box — no API for tracks, participants, mute state | **CRITICAL** |
| BP-2 | `socket.ts` recording/lock | Recording/lock are metadata-only broadcasts — no actual server-side recording | **HIGH** |
| BP-3 | `socket.ts` auth | DB query on every WebSocket connection — no caching | **MEDIUM** |
| BP-4 | Native join | Native uses `WebBrowser.openBrowserAsync()` — leaves app entirely | **HIGH** |
| BP-5 | Domain reachability | Client does `fetch(HEAD, no-cors)` to check if Jitsi domain is reachable before join | **LOW** |
| BP-6 | `jitsi.service.ts` appSecret check | JOIN endpoint throws 500 if `JITSI_APP_SECRET` is empty — hard dependency | **HIGH** |
| BP-7 | `docker-compose.prod.yml` | 4 Jitsi containers (web, xmpp, jicofo, jvb) tightly coupled — removal requires Docker config rewrite | **MEDIUM** |
| BP-8 | `nginx.conf` | `meet.orgsledger.com` server block + upstream — must be replaced or removed | **LOW** |

---

## Phase 5 — Translation & Transcription Pipeline

### 5.1 Complete Audio Flow Diagram

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ User's Mic   │     │ Web Speech   │     │  Socket.IO   │     │  Server      │
│ (Browser)    │────►│ API (STT)    │────►│  Client      │────►│  socket.ts   │
│              │     │ SpeechRecog  │     │ sendSpeech   │     │  translation │
│              │     │ continuous   │     │ ForTranslat  │     │  :speech     │
│              │     │ interimRes   │     │              │     │  handler     │
└──────────────┘     └──────────────┘     └──────────────┘     └──────┬───────┘
                                                                      │
                     ┌────────────────────────────────────────────────┘
                     │
                     ▼
           ┌──────────────────┐
           │  INTERIM check   │
           │  isFinal?        │
           └────┬────────┬────┘
                │NO      │YES
                ▼        ▼
     ┌──────────────┐  ┌───────────────────────────┐
     │ Broadcast    │  │ 1. Find unique target langs│
     │ translation  │  │ 2. Check translation wallet│
     │ :interim     │  │ 3. translateToMultiple()   │
     │ to room      │  │ 4. Deduct wallet (0.5 min) │
     └──────────────┘  │ 5. ALWAYS persist transcript│
                       │ 6. Route to individual users│
                       └──────────────┬──────────────┘
                                      │
                     ┌────────────────┘
                     ▼
           ┌──────────────────┐
           │ Per-socket scan: │
           │ io.in(meeting:   │
           │   ${id}).fetch   │
           │   Sockets()      │
           │                  │
           │ For each socket: │
           │  - Find userId   │
           │  - Lookup lang in│
           │    meetingLangs   │
           │  - Find matching │
           │    translation   │
           │  - Emit          │
           │    translation:  │
           │    result        │
           └────────┬─────────┘
                    │
                    ▼
           ┌──────────────────┐     ┌──────────────────┐
           │ Client receives  │     │  TTS Playback    │
           │ translation:     │────►│  Web: Speech     │
           │ result           │     │  SynthesisUtter  │
           │ { translations,  │     │  ance            │
           │   speakerName,   │     │  Native: expo-   │
           │   ttsAvailable } │     │  speech          │
           └──────────────────┘     └──────────────────┘
```

### 5.2 Web Speech API STT (Client-Side)

File: `apps/mobile/src/components/ui/LiveTranslation.tsx`

```
Configuration:
  - SpeechRecognition (Web Speech API, browser-native)
  - continuous: true
  - interimResults: true
  - lang: getBcp47(myLanguage)   ← from shared language registry
  - maxAlternatives: 1
  
Event flow:
  onresult → extract transcript → check isFinal
    → isFinal=false: socket.sendSpeechForTranslation(meetingId, text, lang, false)
    → isFinal=true:  socket.sendSpeechForTranslation(meetingId, text, lang, true)
  onend → auto-restart (if still listening)
  onerror → log + retry after 1s
```

**Limitation**: Web Speech API requires an active browser tab. If the user switches tabs or the app backgrounds, STT stops. No server-side audio capture exists.

### 5.3 Translation Service — Fallback Chain

File: `apps/api/src/services/translation.service.ts` (237 lines)

```
translateText(text, targetLang, sourceLang?)
  │
  ├─ 1. Check in-memory cache
  │     Cache: Map<string, { text, timestamp }>
  │     Max: 2000 entries, TTL: 10 minutes
  │     Eviction: oldest 25% when full
  │
  ├─ 2. AI Proxy (if configured)
  │     POST {AI_PROXY_URL}/api/gateway/translate
  │     Body: { text, targetLanguage, sourceLanguage, model: 'gpt-4o-mini' }
  │
  ├─ 3. GPT-4o-mini (direct OpenAI)
  │     model: 'gpt-4o-mini'
  │     temperature: 0
  │     Prompt: "Translate to {lang}. Output ONLY the translated text.
  │              Do not summarize. Do not paraphrase."
  │
  ├─ 4. Google Translate v2 (REST API)
  │     POST https://translation.googleapis.com/language/translate/v2
  │     Using GoogleAuth with google-credentials.json
  │
  └─ 5. Passthrough (return original text unchanged)

translateToMultiple(text, targetLangs, sourceLang)
  - Deduplicates target languages
  - Filters out source language
  - Parallel batches of 5 concurrent translations
  - Returns: Record<string, string>
```

### 5.4 TTS Playback (Client-Side)

File: `apps/mobile/src/components/ui/LiveTranslation.tsx`

**Chrome TTS Warm-Up** (web only):
```
On first click/touchstart event:
  1. Create empty SpeechSynthesisUtterance('')
  2. Set volume = 0
  3. Call speechSynthesis.speak(utterance)
  → This "unlocks" the audio context (Chrome autoplay policy)
```

**Speak Function:**
```
speak(text, lang):
  Web:
    1. speechSynthesis.cancel()     ← stop any current speech
    2. Wait 50ms                     ← Chrome bug workaround
    3. new SpeechSynthesisUtterance(text)
    4. Find voice matching lang prefix (e.g., 'fr' matches 'fr-FR')
    5. speechSynthesis.speak(utterance)
    
  Native:
    1. Speech.speak(text, { language: getBcp47(lang) })    ← expo-speech
```

### 5.5 Transcript Persistence

File: `apps/api/src/socket.ts` — `_persistTranscript()` method

```
Every final speech segment (translation:speech with isFinal=true):
  1. Check: db.schema.hasTable('meeting_transcripts')
     → If table doesn't exist, skip silently
  2. INSERT INTO meeting_transcripts:
     - meeting_id, organization_id
     - speaker_id (socket.userId)
     - speaker_name (from langMap or DB)
     - original_text (raw speech)
     - source_lang
     - translations (JSONB of all translations)
     - spoken_at (Date.now() epoch ms)
  3. Emit 'transcript:stored' to meeting room
```

**CRITICAL**: Transcript persistence happens REGARDLESS of wallet balance. Even if translation wallet is empty (translations fail), the original text is still persisted. This is the safety net.

### 5.6 AI Minutes Pipeline

File: `apps/api/src/services/ai.service.ts` (534 lines)

```
processMinutes(meetingId, orgId)
  │
  ├─ 1. Check AI wallet balance (requires > 0 minutes)
  │
  ├─ 2. Deduct wallet BEFORE processing
  │     → Cost: max(estimated_duration, 1) minutes
  │     → Prevents free usage on crash/timeout
  │
  ├─ 3. Get transcript data (one of two paths):
  │     ├─ Path A: Audio file exists (meeting.audio_storage_url)
  │     │   → transcribeAudio(audioUrl)
  │     │   → AI Proxy → Google Cloud STT → mock
  │     │   → Config: languageCode='auto', diarizationSpeakerCount=10,
  │     │             model='latest_long'
  │     │
  │     └─ Path B: Live transcripts exist (meeting_transcripts table)
  │         → getTranscriptsFromDB(meetingId)
  │         → SELECT * FROM meeting_transcripts 
  │           WHERE meeting_id = ? ORDER BY spoken_at ASC
  │         → Format: "[HH:MM:SS] Speaker Name: text"
  │         → Time offsets estimated from text length (~15 chars/sec)
  │
  ├─ 4. Generate minutes via GPT-4o:
  │     → AI Proxy → OpenAI GPT-4o
  │     → temperature: 0.3, max_tokens: 4000
  │     → response_format: { type: 'json_object' }
  │     → Prompt requests structured output:
  │       { summary, decisions[], motions[], actionItems[], contributions[] }
  │
  ├─ 5. Update meeting_minutes record:
  │     → status: 'completed'
  │     → transcript, summary, decisions, motions, action_items, contributions
  │     → ai_credits_used, generated_at
  │
  └─ 6. Notify stakeholders:
       → Socket: 'meeting:minutes:ready' to meeting room
       → Push notification (FCM)
       → Email notification
```

### 5.7 Latency Analysis

| Stage | Estimated Latency | Bottleneck |
|-------|------------------|-----------|
| Mic → Web Speech API | 50-200ms | Browser STT engine, varies by browser/OS |
| Speech → Socket.IO | 10-50ms | Network round-trip |
| Socket → translateToMultiple | 200-1500ms | GPT-4o-mini API call (per language batch) |
| Translation result → per-user routing | 5-50ms | Socket scan + emit loop |
| Result → TTS playback | 100-500ms | Chrome TTS queue, voice loading |
| **Total end-to-end** | **~400ms - 2.5s** | **Translation API is the bottleneck** |

For a meeting with 5 languages, `translateToMultiple` runs 5 translations in 1 batch (parallelized), so the latency is dominated by the slowest single translation, not cumulative.

---

## Phase 6 — Integration Gap Analysis

### 6.1 Tight Coupling — Jitsi-Specific Code

| File | Lines | Coupling Type | Risk |
|------|-------|--------------|------|
| `services/jitsi.service.ts` | 1-303 (entire file) | Jitsi JWT format, room naming, Prosody claims | **HIGH** — must be fully replaced |
| `routes/meetings.ts` | ~60 lines in JOIN endpoint | Calls `JitsiService.generateRoomName()`, `generateJitsiToken()`, `buildJoinConfig()` | **HIGH** — critical path |
| `[meetingId].tsx` | ~30 lines | `jitsiIframeSrc` useMemo, iframe rendering, domain reachability check | **HIGH** — rendering logic |
| `docker-compose.prod.yml` | ~120 lines | 4 Jitsi containers, volumes, networks, env vars | **MEDIUM** — infrastructure |
| `deploy/nginx.conf` | ~40 lines | `meet.orgsledger.com` server block, upstream, frame headers | **LOW** — config file |
| `apps/api/src/config.ts` | ~10 lines | `config.jitsi` block (domain, appId, appSecret, tokenExpiry) | **LOW** — config keys |

### 6.2 Hardcoded Assumptions

| Assumption | Location | Impact on Migration | Risk |
|-----------|----------|-------------------|------|
| JWT format uses Prosody-specific claims (`aud: 'jitsi'`, `iss: appId`, `sub: domain`) | `jitsi.service.ts:42-70` | LiveKit uses different token format (JWT with VideoGrant) | **HIGH** |
| Room names are deterministic from orgId+meetingId | `jitsi.service.ts:30-35` | LiveKit rooms can use any name — can keep same pattern | **LOW** |
| Moderator = `affiliation: 'owner'` in JWT | `jitsi.service.ts:55-56` | LiveKit uses `canPublish`, `canSubscribe`, `roomAdmin` grants | **HIGH** |
| Domain must be reachable via HEAD request | `[meetingId].tsx` join flow | LiveKit connects via WebSocket, not HTTP page load | **MEDIUM** |
| Video renders in iframe (no API) | `[meetingId].tsx` iframe section | LiveKit provides native React components | **HIGH** — full UI rewrite |
| `JITSI_APP_SECRET` required for JOIN | `routes/meetings.ts` line ~280 | Must swap to LiveKit API key/secret | **HIGH** |
| 4 Docker containers for video | `docker-compose.prod.yml` | LiveKit is single binary or cloud-hosted | **MEDIUM** |
| `meet.orgsledger.com` DNS/nginx | `nginx.conf`, DNS records | May keep for LiveKit or remove entirely | **LOW** |
| Config presets for video/audio/interface | `jitsi.service.ts:100-300` | LiveKit client config is different — resolution, codec, track settings | **MEDIUM** |
| Native app opens external browser for video | `[meetingId].tsx` join flow | LiveKit native SDK embeds video natively — major improvement | **HIGH** (positive) |

### 6.3 Non-Jitsi Components (Safe from Migration)

These components have ZERO Jitsi dependency and need no changes:

| Component | File | Why Safe |
|-----------|------|---------|
| Chat system | `routes/messages.ts`, `socket.ts` chat events | Completely separate WebSocket events |
| Financial system | `routes/transactions.ts`, `dues.ts`, `fines.ts` | No meeting dependency |
| Translation service | `services/translation.service.ts` | Pure translation — no video dependency |
| AI Service (GPT) | `services/ai.service.ts` (minutes generation) | Reads from DB transcripts, not from Jitsi |
| Meeting CRUD | `routes/meetings.ts` (CREATE, UPDATE, DELETE) | Create/edit don't touch Jitsi |
| Meeting lifecycle | `routes/meetings.ts` (START, END) | Socket broadcasts, no Jitsi calls |
| Attendance system | `routes/meetings.ts` (attendance endpoints) | Database-only |
| Voting system | `routes/meetings.ts` (votes endpoints) | Socket + DB only |
| Subscription system | `routes/subscriptions.ts` | Billing, no video |
| Notification system | `routes/notifications.ts`, push service | Independent |
| User auth | `routes/auth.ts` | JWT, independent |
| Socket auth | `socket.ts` auth middleware | JWT verify, independent |
| Meeting store (client) | `stores/meeting.store.ts` | Pure state — no Jitsi imports |
| Transcript persistence | `socket.ts` `_persistTranscript()` | Writes to DB, no Jitsi |

### 6.4 Risk Assessment Matrix

```
              LOW                    MEDIUM                   HIGH
         ┌──────────────────┬──────────────────────┬──────────────────────┐
IMPACT   │ nginx.conf       │ Docker compose        │ jitsi.service.ts     │
HIGH     │ changes          │ (4 containers)        │ (entire file)        │
         │                  │                       │ JOIN endpoint        │
         │                  │                       │ [meetingId].tsx       │
         │                  │                       │ iframe rendering     │
         ├──────────────────┼──────────────────────┼──────────────────────┤
IMPACT   │ config.ts        │ Domain reachability   │ Native join flow     │
MEDIUM   │ config keys      │ check logic           │ (expo-web-browser)   │
         │                  │ Config presets         │                      │
         │                  │ (video/audio modes)   │                      │
         ├──────────────────┼──────────────────────┼──────────────────────┤
IMPACT   │ Room name        │                       │                      │
LOW      │ format           │                       │                      │
         │ DNS records      │                       │                      │
         └──────────────────┴──────────────────────┴──────────────────────┘
```

---

## Phase 7 — Surgical LiveKit Replacement Plan

### 7.1 Overview — 10 Deliverables

| # | Deliverable | Files Changed | New Files | Est. Effort |
|---|-------------|--------------|-----------|-------------|
| D1 | LiveKit token service | Replace `jitsi.service.ts` | `livekit.service.ts` | 4h |
| D2 | Meeting JOIN endpoint update | Modify `routes/meetings.ts` | — | 2h |
| D3 | LiveKit React component (web) | Replace iframe in `[meetingId].tsx` | `LiveKitRoom.tsx` | 8h |
| D4 | LiveKit native component | Replace expo-web-browser | `LiveKitRoom.native.tsx` | 6h |
| D5 | Server-side audio capture | New LiveKit webhook/egress | `livekit-webhook.ts` | 6h |
| D6 | Moderator controls (real) | Modify socket handlers | — | 4h |
| D7 | Recording (real) | LiveKit Egress API | `recording.service.ts` | 4h |
| D8 | Audio track capture for translation | LiveKit track subscription | Modify `LiveTranslation.tsx` | 6h |
| D9 | Docker/nginx migration | Modify compose + nginx | — | 2h |
| D10 | Config migration | Modify `config.ts` | — | 1h |
| | **Total** | | | **~43h** |

### D1 — LiveKit Token Service

**Replace**: `apps/api/src/services/jitsi.service.ts` (303 lines)
**Create**: `apps/api/src/services/livekit.service.ts`

```typescript
// Conceptual structure — LiveKit token generation

import { AccessToken, VideoGrant } from 'livekit-server-sdk';
import { config } from '../config';

export class LiveKitService {
  
  // Room name generation — KEEP SAME PATTERN (backwards compatible)
  static generateRoomName(orgId: string, meetingId: string): string {
    const orgSlug = orgId.replace(/-/g, '').slice(0, 12);
    const meetingSlug = meetingId.replace(/-/g, '').slice(0, 12);
    return `org_${orgSlug}_meeting_${meetingSlug}`;
  }

  // LiveKit access token (replaces Jitsi JWT)
  static generateToken(params: {
    roomName: string;
    participantName: string;
    participantIdentity: string;  // unique: `${orgId}-${meetingId}-${userId}`
    isModerator: boolean;
    meetingType: 'video' | 'audio';
    metadata?: Record<string, any>;
  }): string {
    const token = new AccessToken(
      config.livekit.apiKey,
      config.livekit.apiSecret,
      {
        identity: params.participantIdentity,
        name: params.participantName,
        metadata: JSON.stringify(params.metadata || {}),
        ttl: config.livekit.tokenExpirySeconds,  // default 7200
      }
    );

    const grant: VideoGrant = {
      room: params.roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      // Moderator-only capabilities
      roomAdmin: params.isModerator,
      roomRecord: params.isModerator,
    };

    // Audio-only mode: disable video publish
    if (params.meetingType === 'audio') {
      grant.canPublishSources = ['microphone'];  // no camera
    }

    token.addGrant(grant);
    return token.toJwt();
  }

  // Build client connection config (replaces buildJoinConfig)
  static buildConnectionConfig(params: {
    roomName: string;
    token: string;
    meetingType: 'video' | 'audio';
    isModerator: boolean;
  }) {
    return {
      serverUrl: config.livekit.wsUrl,  // wss://livekit.orgsledger.com
      token: params.token,
      roomName: params.roomName,
      options: {
        video: params.meetingType === 'video',
        audio: true,
        // Resolution tiers based on meeting type
        videoResolution: params.meetingType === 'video' 
          ? { width: 1280, height: 720 } 
          : undefined,
      },
    };
  }
}
```

**Key differences from Jitsi:**
- No `aud`, `iss`, `sub` claims — LiveKit uses `VideoGrant`
- No `affiliation: 'owner'` — LiveKit uses `roomAdmin: true`
- No `configOverwrite` / `interfaceConfigOverwrite` — LiveKit client handles UI

### D2 — Meeting JOIN Endpoint Update

**File**: `apps/api/src/routes/meetings.ts`
**Changes**: ~60 lines in the JOIN handler

Replace:
```typescript
// OLD (Jitsi)
import { JitsiService } from '../services/jitsi.service';
// ...
const roomName = JitsiService.generateRoomName(orgId, meetingId);
if (!config.jitsi.appSecret) throw new Error('JITSI_APP_SECRET required');
const jwt = JitsiService.generateJitsiToken({ ... });
const joinConfig = JitsiService.buildJoinConfig({ ... });
```

With:
```typescript
// NEW (LiveKit)
import { LiveKitService } from '../services/livekit.service';
// ...
const roomName = LiveKitService.generateRoomName(orgId, meetingId);
const token = LiveKitService.generateToken({
  roomName,
  participantName: `${user.first_name} ${user.last_name}`,
  participantIdentity: `${orgId}-${meetingId}-${userId}`,
  isModerator,
  meetingType,
  metadata: { orgId, meetingId, userId, email: user.email, avatar: user.avatar_url },
});
const connectionConfig = LiveKitService.buildConnectionConfig({
  roomName, token, meetingType, isModerator,
});
```

**Response shape change:**

```typescript
// OLD response
{ joinConfig: { domain, roomName, jwt, configOverwrite, interfaceConfigOverwrite, userInfo } }

// NEW response
{ connectionConfig: { serverUrl, token, roomName, options: { video, audio, videoResolution } } }
```

**The frontend must handle BOTH formats during migration** (feature flag).

### D3 — LiveKit React Component (Web)

**Replace**: iframe in `apps/mobile/app/meetings/[meetingId].tsx`
**Create**: `apps/mobile/src/components/ui/LiveKitRoom.tsx`

This replaces the opaque iframe with a fully controllable React component:

```
LiveKitRoom.tsx
├── useRoom() hook — room connection + state
├── <VideoTrack /> — renders remote/local video tiles
├── <AudioTrack /> — plays remote audio
├── <ControlBar /> — mute/unmute, camera toggle, screen share, raise hand
├── <ParticipantList /> — real participant data from LiveKit
└── <ConnectionQuality /> — network indicator
```

**Key gains over iframe:**
- Programmatic mute/unmute
- Direct access to audio tracks (for STT — replaces Web Speech API)
- Real participant count from LiveKit (not dual-tracked via Socket.IO)
- Screen sharing support
- Bandwidth adaptation controls
- No iframe CSP issues, no X-Frame-Options headers needed

### D4 — Native Component

**Replace**: `WebBrowser.openBrowserAsync(jitsiUrl)` (leaves app)
**Use**: `@livekit/react-native` SDK

This is the **biggest UX improvement** — native users stay in-app instead of being bounced to an external browser. The React Native LiveKit SDK provides native `<VideoView>` components.

### D5 — Server-Side Audio Capture

**New capability**: LiveKit Egress API can record meetings server-side.

Currently, there is NO server-side audio capture. The `audio_storage_url` field only gets populated if someone manually uploads an audio file. With LiveKit Egress:

```
LiveKit Room → Egress API → S3/local storage → audio_storage_url
                                                     │
                                                     ▼
                                              AIService.processMinutes()
                                              (transcribeAudio path)
```

This replaces the need for live transcript capture as the primary AI input.

### D6 — Real Moderator Controls

Currently, recording and lock are metadata-only:

| Control | Current (Jitsi) | New (LiveKit) |
|---------|----------------|---------------|
| Mute participant | Not possible (iframe) | `room.localParticipant.setMicrophoneEnabled(false)` or admin mute via server API |
| Remove participant | Not possible | LiveKit Room Service API: `removeParticipant()` |
| Lock room | Socket broadcast (cosmetic) | Stop creating new tokens / use `maxParticipants` |
| Recording | Socket broadcast (cosmetic) | LiveKit Egress API: `startRoomCompositeEgress()` |
| Screen share | Depends on Jitsi iframe config | LiveKit: `localParticipant.setScreenShareEnabled(true)` |

### D7 — Real Recording

**New file**: `apps/api/src/services/recording.service.ts`

```
startRecording(meetingId, roomName):
  1. Call LiveKit Egress API: startRoomCompositeEgress
  2. Store egress_id in meeting record
  3. Broadcast 'meeting:recording-started' (now backed by real recording)

stopRecording(meetingId):
  1. Call LiveKit Egress API: stopEgress(egress_id)
  2. Wait for completion webhook
  3. Store file URL in meetings.audio_storage_url
  4. Broadcast 'meeting:recording-stopped'
```

### D8 — Audio Track Capture for Translation

**Current flow**: Web Speech API (browser-native STT) → socket → server translate

**New flow with LiveKit**: LiveKit audio track → server-side STT service → translate

Two options:

**Option A — Keep client-side STT (minimal change):**
- LiveKit provides `<AudioTrack>` component
- Pipe audio to Web Speech API (same as current)
- No server changes needed
- Risk: still browser-dependent, no native STT on mobile

**Option B — Server-side STT via LiveKit (better):**
- Subscribe to audio tracks on server via LiveKit SDK
- Forward audio frames to Google Cloud STT (streaming)
- Translation pipeline stays the same (server receives text, translates, routes)
- Benefit: works for native apps, more reliable
- Cost: higher server load, requires streaming STT integration

**Recommendation**: Start with Option A (keep client-side STT) for fastest migration, then upgrade to Option B as a follow-up.

### D9 — Docker/Nginx Migration

#### Docker Compose Changes

**Remove** (4 services, ~120 lines):
```yaml
# DELETE these services:
jitsi-web:      # image: jitsi/web:stable-9823
jitsi-xmpp:     # image: jitsi/prosody:stable-9823
jitsi-jicofo:   # image: jitsi/jicofo:stable-9823
jitsi-jvb:      # image: jitsi/jvb:stable-9823
```

**Remove** (7 volumes):
```yaml
# DELETE:
jitsi_web_config:
jitsi_web_crontabs:
jitsi_transcripts:
jitsi_prosody_config:
jitsi_prosody_plugins:
jitsi_jicofo_config:
jitsi_jvb_config:
```

**Remove** network:
```yaml
# DELETE:
networks:
  meet.orgsledger.com:
    driver: bridge
```

**Add** (if self-hosting LiveKit):
```yaml
livekit:
  image: livekit/livekit-server:latest
  container_name: orgsledger_livekit
  restart: always
  ports:
    - "7880:7880"     # HTTP API
    - "7881:7881"     # WebSocket (secure)
    - "7882:7882/udp" # WebRTC UDP (replaces JVB 10000/udp)
  volumes:
    - ./deploy/livekit.yaml:/etc/livekit.yaml
  command: --config /etc/livekit.yaml
```

**Alternative**: Use LiveKit Cloud (no self-hosting) — just configure API key/secret.

#### Nginx Changes

**Remove** `meet.orgsledger.com` server block:
```nginx
# DELETE entire block:
server {
    listen 443 ssl;
    server_name meet.orgsledger.com;
    ...
}
```

**Remove** upstream:
```nginx
# DELETE:
upstream jitsi_backend {
    server jitsi-web:80;
}
```

**Add** (if self-hosting LiveKit, or skip for cloud):
```nginx
upstream livekit_backend {
    server livekit:7880;
}

server {
    listen 443 ssl;
    server_name livekit.orgsledger.com;
    
    # WebSocket upgrade for LiveKit
    location / {
        proxy_pass http://livekit_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
    }
}
```

**Remove** from `web` service dependencies:
```yaml
# In docker-compose.prod.yml, web service:
depends_on:
  - api
  # - jitsi-web  ← DELETE this line
```

### D10 — Config Migration

**File**: `apps/api/src/config.ts`

Replace:
```typescript
jitsi: {
  domain: process.env.JITSI_DOMAIN || 'meet.jit.si',
  appId: process.env.JITSI_APP_ID || 'orgsledger',
  appSecret: process.env.JITSI_APP_SECRET || '',
  tokenExpirySeconds: parseInt(process.env.JITSI_TOKEN_EXPIRY || '7200', 10),
},
```

With:
```typescript
livekit: {
  wsUrl: process.env.LIVEKIT_WS_URL || 'wss://livekit.orgsledger.com',
  apiUrl: process.env.LIVEKIT_API_URL || 'http://livekit:7880',
  apiKey: process.env.LIVEKIT_API_KEY || '',
  apiSecret: process.env.LIVEKIT_API_SECRET || '',
  tokenExpirySeconds: parseInt(process.env.LIVEKIT_TOKEN_EXPIRY || '7200', 10),
},
```

**Environment variables** to add to `.env.production`:
```
LIVEKIT_WS_URL=wss://livekit.orgsledger.com
LIVEKIT_API_URL=http://livekit:7880
LIVEKIT_API_KEY=<generated>
LIVEKIT_API_SECRET=<generated>
LIVEKIT_TOKEN_EXPIRY=7200
```

**Environment variables** to remove:
```
JITSI_DOMAIN
JITSI_APP_ID
JITSI_APP_SECRET
JITSI_TOKEN_EXPIRY
```

---

## Phase 8 — Performance, Safety & Migration Strategy

### 8.1 Performance Safeguards

#### 8.1.1 Database Query Optimization

| Issue | Current | Fix | Priority |
|-------|---------|-----|----------|
| Socket auth DB query per connection | `db('users').where(id).first()` every connect | Add Redis cache: `redis.get('user:${userId}')` with 5min TTL | **P1** |
| Schema check per transcript | `db.schema.hasTable('meeting_transcripts')` every write | Check once on startup, cache boolean | **P1** |
| JOIN endpoint 7 sequential queries | 7 `await` in series | Parallelize independent queries with `Promise.all()` | **P2** |
| Speaker name DB fallback | `db('users').where(id).first()` on missing langMap entry | Pre-populate langMap on `meeting:join` (already done for most cases) | **P3** |

#### 8.1.2 Translation Caching Improvements

| Optimization | Current | Proposed |
|-------------|---------|----------|
| Cache backend | In-memory Map (2000 entries) | Redis: survives restarts, shared across instances |
| Cache TTL | 10 minutes | 1 hour (translations don't change) |
| Cache key | `${text}:${sourceLang}:${targetLang}` | Same but in Redis with EXPIRE |
| Batch size | 5 concurrent | 10 concurrent (GPT-4o-mini handles it) |

#### 8.1.3 Socket.IO Optimization

| Issue | Current | Fix |
|-------|---------|-----|
| Per-user routing via `fetchSockets()` | Scans all sockets in room, loops to find matching userId | Use `socket.join('user:${userId}')` rooms (already done) — emit to `user:${userId}` directly |
| `meetingLanguages` Map cleanup | Cleaned on disconnect/leave | Also clean on `meeting:ended` event — bulk clear |
| No heartbeat optimization | Default Socket.IO pingTimeout | Set `pingTimeout: 30000, pingInterval: 25000` for mobile |

#### 8.1.4 LiveKit-Specific Performance

| Concern | Mitigation |
|---------|-----------|
| Bandwidth for audio-only meetings | LiveKit Adaptive Streaming auto-adjusts; disable video tracks entirely |
| Many participants (>50) | LiveKit Selective Forwarding Unit (SFU) handles this natively |
| Server-side track subscription for STT | Rate-limit audio frames sent to Google STT; use VAD (Voice Activity Detection) |
| Egress recording storage | Stream to S3-compatible storage; compress with opus codec |

### 8.2 Transcript & Minutes Survival Plan

**Goal**: Zero data loss during migration. Every transcript captured before, during, and after migration must survive.

#### 8.2.1 Data Flow — Current → Migration → Post-Migration

```
CURRENT (Jitsi):
  Mic → Web Speech API → socket → server → DB          ✓ Survives
                                  └→ translate → TTS    ✓ Survives

DURING MIGRATION (feature flag):
  Same as current (Jitsi iframe still works)            ✓ No change
  LiveKit rooms available for testing                   ✓ Parallel

POST-MIGRATION (LiveKit):
  Mic → LiveKit audio track → Web Speech API → socket → server → DB
        └→ LiveKit Egress → audio file → AIService
  
  Transcript path: UNCHANGED (socket → _persistTranscript → DB)
  Minutes path:    UNCHANGED (DB transcripts → GPT-4o → meeting_minutes)
  Audio path:      IMPROVED (Egress → auto-uploaded → audio_storage_url)
```

#### 8.2.2 No-Data-Loss Guarantees

| Guarantee | Mechanism |
|-----------|----------|
| Transcripts persist even if translation fails | `_persistTranscript()` runs in finally block, before wallet check |
| Transcripts persist even if wallet is empty | Explicit: wallet empty → skip translation → STILL persist transcript |
| Minutes can be regenerated | `POST /:orgId/:meetingId/generate-minutes` — manual trigger, reads from DB |
| Audio recording (new) | LiveKit Egress creates independent audio file — secondary source for AI |
| Meeting minutes retry on failure | Status set to 'failed' — can be re-triggered via manual endpoint |

#### 8.2.3 Migration Verification Checklist

```
□ Create a test meeting with Jitsi (pre-migration)
□ Verify transcripts saved to meeting_transcripts table
□ Verify AI minutes generated from live transcripts
□ Switch to LiveKit (feature flag)
□ Create same test meeting with LiveKit
□ Verify Web Speech API still captures speech
□ Verify socket translation:speech events still fire
□ Verify _persistTranscript still writes to DB
□ Verify AI minutes still generate from DB transcripts
□ Enable LiveKit Egress recording
□ Verify audio file saved to storage
□ Verify AI minutes can generate from audio file (path A)
□ Compare minutes quality: live transcripts vs. audio file
```

### 8.3 Safe Migration Strategy — Step by Step

#### Phase A — Preparation (Week 1)

```
Day 1-2: Infrastructure
  □ 1. Create LiveKit Cloud account OR provision self-hosted LiveKit server
  □ 2. Generate LIVEKIT_API_KEY and LIVEKIT_API_SECRET
  □ 3. Configure DNS: livekit.orgsledger.com → LiveKit server
  □ 4. Test LiveKit connection from browser (JavaScript SDK)

Day 3-4: Backend Foundation
  □ 5. Create livekit.service.ts (D1)
  □ 6. Add config.livekit to config.ts (D10)
  □ 7. Add LIVEKIT_* env vars to .env.production
  □ 8. Add feature flag: VIDEO_PROVIDER = 'jitsi' | 'livekit'
       Store in platform_config table or env var

Day 5: Backend Integration
  □ 9. Modify JOIN endpoint (D2):
       if (VIDEO_PROVIDER === 'livekit') {
         // Use LiveKitService
       } else {
         // Keep JitsiService (existing code)
       }
  □ 10. Deploy backend with feature flag set to 'jitsi' (no behavior change)
```

#### Phase B — Frontend Build (Week 2)

```
Day 6-7: Web Component
  □ 11. Install @livekit/components-react, livekit-client
  □ 12. Create LiveKitRoom.tsx (D3)
  □ 13. Wire LiveKitRoom into [meetingId].tsx behind feature flag:
        if (connectionConfig.serverUrl) {
          // Render LiveKitRoom
        } else {
          // Render Jitsi iframe (existing)
        }

Day 8-9: Native Component
  □ 14. Install @livekit/react-native
  □ 15. Create LiveKitRoom.native.tsx (D4)
  □ 16. Replace WebBrowser.openBrowserAsync with native LiveKit view

Day 10: Translation Integration
  □ 17. Verify Web Speech API works with LiveKit audio (D8, Option A)
  □ 18. Test: speak → STT → socket → translate → TTS (full pipeline)
  □ 19. Verify transcript persistence unchanged
```

#### Phase C — Testing (Week 3)

```
Day 11-12: Internal Testing
  □ 20. Set VIDEO_PROVIDER='livekit' on staging/dev
  □ 21. Test all meeting types: video, audio-only
  □ 22. Test moderator controls: mute, recording start/stop, room lock
  □ 23. Test multi-language translation (3+ languages)
  □ 24. Test AI minutes generation (from live transcripts)
  □ 25. Test meeting end → force disconnect → minutes processing

Day 13-14: Edge Cases
  □ 26. Test: user joins after meeting started
  □ 27. Test: user reconnects after network drop
  □ 28. Test: moderator leaves → what happens to other participants
  □ 29. Test: max participants limit
  □ 30. Test: duration limit enforcement
  □ 31. Test: native app join + translation
  □ 32. Test: concurrent meetings (2+ rooms simultaneously)
```

#### Phase D — Production Migration (Week 4)

```
Day 15: Gradual Rollout
  □ 33. Enable LiveKit for 1 test organization (feature flag per org)
  □ 34. Monitor: connection quality, latency, transcript accuracy
  □ 35. Monitor: AI minutes quality comparison

Day 16-17: Full Rollout
  □ 36. Set VIDEO_PROVIDER='livekit' globally
  □ 37. Monitor all organizations for 48 hours
  □ 38. Keep Jitsi stack running (rollback safety)

Day 18-19: Cleanup
  □ 39. Remove Jitsi Docker services (D9)
  □ 40. Remove meet.orgsledger.com nginx config
  □ 41. Delete jitsi.service.ts
  □ 42. Remove feature flag code (clean up if/else branches)
  □ 43. Remove JITSI_* env vars
  □ 44. Update DNS (remove meet.orgsledger.com or redirect)
  □ 45. Delete Jitsi Docker volumes

Day 20: Verification
  □ 46. Full regression test on production
  □ 47. Verify no Jitsi references remain in codebase
  □ 48. Update documentation
```

### 8.4 Rollback Plan

If LiveKit fails in production:

```
1. Set VIDEO_PROVIDER='jitsi' (instant rollback via env var or platform_config)
2. Jitsi Docker services still running (don't remove until Day 18)
3. Frontend falls back to iframe rendering
4. Backend falls back to JitsiService token generation
5. Translation pipeline unaffected (runs on Socket.IO regardless)
6. Transcripts unaffected (DB writes are video-provider-agnostic)
7. Minutes unaffected (reads from DB, not from video provider)
```

**Maximum rollback time**: < 1 minute (env var change + API restart)

### 8.5 Risk Mitigation Summary

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|-----------|
| LiveKit connection failures on poor networks | Medium | High | Feature flag rollback to Jitsi; LiveKit adaptive bitrate |
| Web Speech API stops working with LiveKit audio | Low | High | Test thoroughly in Phase C; fallback: keep browser mic separate from LiveKit |
| Translation pipeline breaks | Very Low | High | Pipeline is video-provider-agnostic; socket events unchanged |
| AI minutes quality degrades | Low | Medium | Compare outputs side-by-side; live transcripts path unchanged |
| Native app crashes with LiveKit SDK | Medium | Medium | Extensive testing; staged rollout per platform |
| Meeting join slower with LiveKit | Low | Low | LiveKit WebSocket connect is faster than iframe page load |
| Concurrent meeting limit | Low | Medium | LiveKit SFU scales better than Jitsi JVB |
| Cost increase (LiveKit Cloud) | Certain | Low | Offset by removing 4 Docker containers; LiveKit pricing is competitive |

---

## Appendix A — Complete API Endpoint Map

### Meeting Endpoints (file: `apps/api/src/routes/meetings.ts`, 1497 lines)

| Method | Path | Auth | Purpose | Jitsi-Dependent? |
|--------|------|------|---------|-----------------|
| GET | `/api/meetings/:orgId` | JWT + member | List meetings | No |
| POST | `/api/meetings/:orgId` | JWT + org_admin/executive | Create meeting | No |
| GET | `/api/meetings/:orgId/:meetingId` | JWT + member | Get meeting detail | No |
| PATCH | `/api/meetings/:orgId/:meetingId` | JWT + org_admin/executive | Update meeting | No |
| DELETE | `/api/meetings/:orgId/:meetingId` | JWT + org_admin | Delete meeting | No |
| POST | `/api/meetings/:orgId/:meetingId/join` | JWT + member | **Join meeting** | **YES** |
| POST | `/api/meetings/:orgId/:meetingId/start` | JWT + org_admin/executive | Start meeting | No |
| POST | `/api/meetings/:orgId/:meetingId/end` | JWT + org_admin/executive | End meeting | No |
| GET | `/api/meetings/:orgId/:meetingId/attendance` | JWT + member | Get attendance | No |
| POST | `/api/meetings/:orgId/:meetingId/attendance` | JWT + org_admin/executive | Mark attendance | No |
| POST | `/api/meetings/:orgId/:meetingId/votes` | JWT + org_admin/executive | Create vote | No |
| POST | `/api/meetings/:orgId/:meetingId/votes/:voteId/cast` | JWT + member | Cast vote | No |
| POST | `/api/meetings/:orgId/:meetingId/votes/:voteId/close` | JWT + org_admin/executive | Close vote | No |
| POST | `/api/meetings/:orgId/:meetingId/audio` | JWT + org_admin/executive | Upload audio file | No |
| GET | `/api/meetings/:orgId/:meetingId/translation-languages` | JWT + member | Get translation lang map | No |
| GET | `/api/meetings/:orgId/:meetingId/transcripts` | JWT + member | Get transcripts | No |
| GET | `/api/meetings/:orgId/:meetingId/minutes` | JWT + member | Get AI minutes | No |
| GET | `/api/meetings/:orgId/:meetingId/minutes/download` | JWT + member | Download minutes document | No |
| POST | `/api/meetings/:orgId/:meetingId/generate-minutes` | JWT + org_admin/executive | Trigger AI minutes | No |

**Only 1 of 19 endpoints is Jitsi-dependent** — the JOIN endpoint.

---

## Appendix B — Socket Event Catalog

### Complete Event List

| # | Event | Direction | Category | Jitsi-Dependent? |
|---|-------|-----------|----------|-----------------|
| 1 | `meeting:join` | C→S | Meeting | No |
| 2 | `meeting:leave` | C→S | Meeting | No |
| 3 | `meeting:participant-joined` | S→Room | Meeting | No |
| 4 | `meeting:participant-left` | S→Room | Meeting | No |
| 5 | `meeting:raise-hand` | C→S | Meeting | No |
| 6 | `meeting:hand-raised` | S→Room | Meeting | No |
| 7 | `meeting:started` | S→Org+Room | Lifecycle | No |
| 8 | `meeting:ended` | S→Org+Room | Lifecycle | No |
| 9 | `meeting:force-disconnect` | S→Room | Lifecycle | No |
| 10 | `meeting:start-recording` | C→S | Control | No (metadata) |
| 11 | `meeting:stop-recording` | C→S | Control | No (metadata) |
| 12 | `meeting:recording-started` | S→Room | Control | No (metadata) |
| 13 | `meeting:recording-stopped` | S→Room | Control | No (metadata) |
| 14 | `meeting:lock` | C→S | Control | No (metadata) |
| 15 | `meeting:lock-changed` | S→Room | Control | No (metadata) |
| 16 | `meeting:minutes:ready` | S→Room | AI | No |
| 17 | `meeting:minutes:processing` | S→Room | AI | No |
| 18 | `meeting:minutes:failed` | S→Room | AI | No |
| 19 | `translation:set-language` | C→S | Translation | No |
| 20 | `translation:speech` | C→S | Translation | No |
| 21 | `translation:result` | S→User | Translation | No |
| 22 | `translation:interim` | S→Room | Translation | No |
| 23 | `translation:participants` | S→Room | Translation | No |
| 24 | `translation:language-restored` | S→User | Translation | No |
| 25 | `transcript:stored` | S→Room | Transcript | No |
| 26 | `chat:message` | Both | Chat | No |
| 27 | `chat:typing` | C→S | Chat | No |
| 28 | `notification` | S→User | System | No |
| 29 | `financial_update` | S→Org | Finance | No |
| 30 | `payment_completed` | S→User | Finance | No |

**Zero socket events have Jitsi dependency.** Translation and transcript events use Socket.IO exclusively — they bypass Jitsi entirely.

---

## Appendix C — Database Schema Relationships

### Meeting-Domain ER Diagram

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│     users         │     │  organizations   │     │ subscription_    │
│─────────────────  │     │─────────────────  │     │ plans           │
│ id (PK)          │◄─┐  │ id (PK)          │◄─┐  │ id (PK)        │
│ email            │  │  │ name             │  │  │ slug            │
│ first_name       │  │  │ slug             │  │  │ max_members     │
│ last_name        │  │  │ settings (JSONB) │  │  │ features        │
│ global_role      │  │  │ subscription_    │  │  └────────┬────────┘
│ fcm_token        │  │  │   status         │  │           │
└─────────┬────────┘  │  └────────┬─────────┘  │           │
          │           │           │             │           │
          │           │           │             │  ┌────────▼────────┐
          │           │           │             │  │ subscriptions   │
          │           │           │             └──│ organization_id │
          │           │           │                │ plan_id         │
          │           │           │                │ status          │
          │           │           │                └─────────────────┘
          │           │           │
     ┌────▼───────────┴───────────▼────┐
     │          memberships             │
     │──────────────────────────────── │
     │ user_id (FK → users)           │
     │ organization_id (FK → orgs)    │
     │ role (org_admin|executive|     │
     │       member|guest)            │
     │ UNIQUE(user_id, org_id)        │
     └────────────────────────────────┘
                    │
                    ▼
     ┌──────────────────────────────────┐
     │           meetings               │
     │──────────────────────────────── │
     │ id (PK)                         │
     │ organization_id (FK → orgs)     │
     │ created_by (FK → users)         │
     │ status (scheduled|live|ended)   │
     │ meeting_type (video|audio)      │
     │ ai_enabled                      │
     │ translation_enabled             │
     │ audio_storage_url               │
     │ max_participants                │
     │ lobby_enabled                   │
     └──────┬──────────────────────────┘
            │
     ┌──────┼──────────────────────────────────────────┐
     │      │                                          │
     ▼      ▼                    ▼                     ▼
┌──────────────┐  ┌──────────────────┐  ┌──────────────────┐
│ meeting_     │  │ meeting_         │  │ meeting_         │
│ attendance   │  │ transcripts      │  │ minutes          │
│──────────── │  │──────────────── │  │──────────────── │
│ meeting_id   │  │ meeting_id       │  │ meeting_id (UNQ) │
│ user_id      │  │ speaker_id       │  │ organization_id  │
│ status       │  │ speaker_name     │  │ transcript (JSON)│
│ joined_at    │  │ original_text    │  │ summary          │
│ UNIQUE(m,u)  │  │ source_lang      │  │ decisions (JSON) │
└──────────────┘  │ translations     │  │ motions (JSON)   │
                  │   (JSONB)        │  │ action_items     │
┌──────────────┐  │ spoken_at        │  │ status           │
│ meeting_     │  └──────────────────┘  │ (processing|     │
│ join_logs    │                        │  completed|failed)│
│──────────── │  ┌──────────────────┐  └──────────────────┘
│ meeting_id   │  │ user_language_   │
│ user_id      │  │ preferences      │
│ join_type    │  │──────────────── │  ┌──────────────────┐
│ is_moderator │  │ user_id          │  │ ai_wallet        │
│ joined_at    │  │ organization_id  │  │──────────────── │
│ left_at      │  │ preferred_lang   │  │ organization_id  │
└──────────────┘  │ receive_voice    │  │   (UNIQUE)       │
                  │ receive_text     │  │ balance_minutes  │
┌──────────────┐  │ UNIQUE(u,o)      │  └──────────────────┘
│ agenda_items │  └──────────────────┘
│──────────── │                        ┌──────────────────┐
│ meeting_id   │                        │ translation_     │
│ title        │                        │ wallet           │
│ order        │                        │──────────────── │
│ duration_min │                        │ organization_id  │
└──────────────┘                        │   (UNIQUE)       │
                                        │ balance_minutes  │
┌──────────────┐                        └──────────────────┘
│ votes        │
│──────────── │
│ meeting_id   │
│ title        │
│ options (JSON│
│ status       │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ vote_ballots │
│──────────── │
│ vote_id      │
│ user_id      │
│ selected_opt │
│ UNIQUE(v,u)  │
└──────────────┘
```

### Key Foreign Key Chains

```
Meeting Join Authorization:
  users → memberships (user_id + org_id) → meetings (org_id) → meeting_join_logs

Translation Pipeline:
  users → user_language_preferences (user_id + org_id)
  meetings → meeting_transcripts (meeting_id)
  organizations → translation_wallet (org_id)

AI Minutes Pipeline:
  meetings → meeting_transcripts (meeting_id) → meeting_minutes (meeting_id)
  organizations → ai_wallet (org_id) → ai_wallet_transactions (org_id)

Subscription Gating:
  organizations → subscriptions (org_id) → subscription_plans (plan_id)
```

---

*End of document. Total Jitsi-dependent code: ~500 lines across 3 files. Total codebase: ~10,000+ lines. Migration surface area: ~5% of backend, ~15% of meeting frontend.*
