# OrgsLedger — Technical Architecture Reference

> **Video Provider**: LiveKit (self-hosted or cloud)
> **See also**: `TECHNICAL_README.md` for implementation details

---

## Table of Contents

- [Phase 1 — Frontend Architecture](#phase-1--frontend-architecture)
- [Phase 2 — Backend Architecture](#phase-2--backend-architecture)
- [Phase 3 — Database Layer](#phase-3--database-layer)
- [Phase 5 — Translation & Transcription Pipeline](#phase-5--translation--transcription-pipeline)
- [Appendix A — Complete API Endpoint Map](#appendix-a--complete-api-endpoint-map)
- [Appendix B — Socket Event Catalog](#appendix-b--socket-event-catalog)
- [Appendix C — Database Schema Relationships](#appendix-c--database-schema-relationships)

---

## Phase 1 — Frontend Architecture

### 1.1 Framework Stack

| Layer | Technology | Version |
| ------- | ----------- | --------- |
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
| ------- | ------ | --------- |
| `useAuthStore` | `auth.store.ts` | JWT tokens, user object, login/logout |
| `useOrgStore` | `org.store.ts` | Active organization, membership role |
| `useNotificationStore` | `notification.store.ts` | Unread count, notification list |
| `useSubscriptionStore` | `subscription.store.ts` | Plan, wallet balances, feature flags |
| `useMeetingStore` | `meeting.store.ts` | **All meeting state (see below)** |

### 1.3 Meeting Store — Complete State Shape

File: `apps/mobile/src/stores/meeting.store.ts` (209 lines)

```text
MeetingState {
  // Core
  meetingId: string | null
  orgId: string | null
  meeting: any | null           ← full meeting object from API
  status: 'scheduled' | 'live' | 'ended' | 'cancelled'
  isJoined: boolean

  // Participants (from socket events)
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

**Note**: The meeting store tracks participants via Socket.IO events in parallel with LiveKit's own participant system. LiveKit provides direct SDK access to media tracks, participant metadata, and connection state.

### 1.4 Meeting UI — File Locations

```text
apps/mobile/app/meetings/
  └── [meetingId].tsx              ← Meeting detail screen
                                      Contains: LiveKit room embed, control bar,
                                      transcript/minutes tabs, vote UI, join flow

apps/mobile/src/components/ui/
  └── LiveTranslation.tsx          ← 896 lines — Live translation panel
                                      Contains: Web Speech API STT, TTS playback,
                                      language selector, socket event listeners
```

### 1.5 LiveKit Room Embed

Location: `apps/mobile/app/meetings/[meetingId].tsx`

The LiveKit connection URL is constructed via `useMemo` from the join config returned by the API:

```text
wss://livekit.orgsledger.com  (WebSocket URL from config.livekit.url)
Token: HS256 JWT with LiveKit VideoGrant claims
Room: org_<orgSlug>_meeting_<meetingSlug>
```

**Platform-specific join behavior:**

- **Web**: Renders LiveKit room as `<iframe>` pointing to LiveKit room URL with token
- **Native (iOS/Android)**: Opens LiveKit room URL via `WebBrowser.openBrowserAsync()`

### 1.6 Audio/Video Controls

The control bar in `[meetingId].tsx` provides buttons for:

| Control | Implementation |
| --------- | --------------- |
| Join Video | API POST → LiveKit room embed |
| Join Audio | API POST → LiveKit room embed (audio-only config) |
| Leave | Disconnect from room + socket `meeting:leave` |
| Raise Hand | Socket `meeting:raise-hand` |
| Start/End Meeting | API POST → socket broadcast |
| Start Recording | Socket `meeting:start-recording` (metadata broadcast) |
| Lock Meeting | Socket `meeting:lock` (metadata broadcast) |
| Translation | LiveTranslation component |

### 1.7 Frontend Architecture Diagram

```text
┌──────────────────────────────────────────────────────────┐
│                    React Native App                       │
│  ┌────────────┐  ┌────────────┐  ┌─────────────────────┐ │
│  │  Expo       │  │  Zustand   │  │  Socket.IO Client   │ │
│  │  Router     │  │  5 Stores  │  │  (persistent conn)  │ │
│  └──────┬─────┘  └──────┬─────┘  └──────────┬──────────┘ │
│         │               │                    │            │
│  ┌──────▼─────────────────────────────────────▼──────────┐ │
│  │              [meetingId].tsx                           │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐ │ │
│  │  │ LiveKit Room │  │ Control Bar  │  │ Tabs:       │ │ │
│  │  │ (iframe/     │  │ (socket-     │  │ • Meeting   │ │ │
│  │  │  SDK embed)  │  │  driven)     │  │ • Transcript│ │ │
│  │  │              │  │              │  │ • Minutes   │ │ │
│  │  └──────────────┘  └──────────────┘  └─────────────┘ │ │
│  │  ┌────────────────────────────────────────────────┐   │ │
│  │  │ LiveTranslation.tsx                            │   │ │
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
| ----------- | ----------- | ------ |
| HTTP Server | Express 4.18.2 | `apps/api/src/index.ts` (234 lines) |
| WebSocket | Socket.IO 4.7.4 | `apps/api/src/socket.ts` (696 lines) |
| Database | PostgreSQL 16 + Knex 3.1.0 | `apps/api/src/db.ts` |
| Validation | Zod 3.22 | Per-route schemas |
| Auth | JWT (jsonwebtoken) | Custom middleware |
| Logging | Winston 3.11 | `apps/api/src/logger.ts` |
| Config | dotenv + `config.ts` | `apps/api/src/config.ts` (115 lines) |

### 2.2 Server Bootstrap Sequence

File: `apps/api/src/index.ts`

```text
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
| ------ | -------- | ------------- | ------------ |
| Global | 15 min | 1000 | All routes |
| Auth | 15 min | 15 | `/api/auth/login`, `/api/auth/register` |
| Refresh | 15 min | 30 | `/api/auth/refresh` |
| Webhook | 1 min | 60 | `/api/webhooks/*` |

### 2.4 Middleware Chain

File: `apps/api/src/index.ts`

```text
Request → helmet → CORS → rawBodyCapture → jsonParser(10MB)
  → rateLimiter → paginationCap → auditContext → metrics
  → requestLogging → auth(JWT) → route handler → response
```

### 2.5 Route Mount Map

All routes mounted at `/api/` prefix:

| Route File | Mount Path | Key Operations |
| ----------- | ----------- | ---------------- |
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
| ------ | ------- | ------- |
| `member` | 1 | Default — can join organizations |
| `super_admin` | 4 | Platform-wide admin |
| `developer` | 5 | Full platform access |

#### Organization Roles (memberships table)

| Role | Level | Capabilities |
| ------ | ------- | ------------- |
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

1. LiveKit token grant: `roomAdmin: true`
2. LiveKit token grant: `roomRecord: true` (moderator only)
3. Socket broadcast: `meeting:participant-joined { isModerator: true }`
4. LiveKit publish permissions: `canPublishSources: ['camera', 'microphone', 'screen_share', 'screen_share_audio']` (moderator only)

### 2.7 Meeting State Machine

```text
  scheduled ──────► live ──────► ended
      │                           ▲
      │                           │
      └──────► cancelled          │
                                  │
  (any status can be manually ended by org_admin/executive)
```

State transitions and their triggers:

| Transition | Trigger | Endpoint | Side Effects |
| ----------- | --------- | ---------- | ------------- |
| scheduled → live | Moderator starts | `POST /:orgId/:meetingId/start` | Broadcasts `meeting:started` to org + meeting rooms |
| live → ended | Moderator ends | `POST /:orgId/:meetingId/end` | Broadcasts `meeting:ended`, `forceDisconnectMeeting()`, triggers AI processing if enabled |
| scheduled → cancelled | Admin cancels | `PATCH /:orgId/:meetingId` | Status update only |

### 2.8 Socket.IO — Real-Time Layer

File: `apps/api/src/socket.ts` (696 lines)

#### Connection Authentication

```text
Client connects → auth middleware intercepts →
  1. Extract JWT from handshake.auth.token
  2. jwt.verify(token, config.jwt.secret)
  3. Query: SELECT * FROM users WHERE id = decoded.userId AND is_active = true
  4. Set socket.userId, socket.email, socket.globalRole
  5. Join rooms: user:{userId}, org:{orgId}* (for each membership), channel:{channelId}*
```

**Break point [BP-3]**: Auth middleware queries the `users` table on every single WebSocket connection. For apps with many reconnections (mobile backgrounding), this creates repeated DB hits. No caching layer.

#### Room Topology

```text
user:{userId}           ← personal notifications, DMs
org:{orgId}             ← org-wide broadcasts (meeting started, financial updates)
channel:{channelId}     ← chat channel messages
meeting:{meetingId}     ← meeting participants, translation, hand raises
ledger:{orgId}          ← financial update subscriptions
```

#### Meeting-Specific Events

| Event | Direction | Payload | Purpose |
| ------- | ----------- | --------- | --------- |
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
| ------- | ----------- | --------- | --------- |
| `translation:set-language` | Client → Server | `{ meetingId, language, receiveVoice }` | Set user's translation language |
| `translation:speech` | Client → Server | `{ meetingId, text, language, isFinal }` | Speech segment for translation |
| `translation:result` | Server → User | `{ text, translations, speakerName, ... }` | Translated result (per-user routing) |
| `translation:interim` | Server → Room | `{ meetingId, text, speakerName, lang }` | Interim (partial) speech display |
| `translation:participants` | Server → Room | `{ meetingId, participants }` | Language participant list update |
| `translation:language-restored` | Server → User | `{ language, receiveVoice }` | Restore saved language on rejoin |
| `transcript:stored` | Server → Room | `{ meetingId, transcript }` | New transcript row persisted |

### 2.9 Backend Services

| Service | File | Lines | Purpose |
| --------- | ------ | ------- | --------- |
| `LiveKitService` | `services/livekit.service.ts` | 141 | JWT token generation, room naming, join config |
| `AIService` | `services/ai.service.ts` | 534 | Transcription (Google STT), minutes (GPT-4o) |
| `TranslationService` | `services/translation.service.ts` | 237 | Text translation with cache + fallback chain |

---

## Phase 3 — Database Layer

### 3.1 Complete Table Inventory

39 tables across 22 migrations. Meeting-critical tables marked with ★.

| # | Table | Migration | Meeting-Critical |
| --- | ------- | ----------- | ----------------- |
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

**Note**: The `room_id` column (renamed from the legacy `jitsi_room_id` via migration 024) stores the LiveKit room name. Room names are generated deterministically via `generateRoomName(orgId, meetingId)` at creation time.

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
| ---------- | -------------- | ----------- | ---------- |
| `socket.ts` auth middleware | `db('users').where({ id }).first()` | Every WS connection | **HIGH** — mobile reconnects happen frequently |
| `socket.ts` `translation:speech` handler | `db('users').where({ id: socket.userId }).first()` | Every final speech segment when speaker name not in langMap | **MEDIUM** — fallback path only |
| `socket.ts` `translation:speech` handler | `io.in(room).fetchSockets()` + loop | Every translated speech segment | **HIGH** — O(n) socket scan per translation result |
| `socket.ts` `translation:set-language` handler | `db('user_language_preferences').insert().onConflict().merge()` | Every language change | **LOW** — infrequent |
| `socket.ts` `_persistTranscript` | `db.schema.hasTable('meeting_transcripts')` | Every final speech segment | **HIGH** — schema check on every write |
| `routes/meetings.ts` JOIN | 7 sequential DB queries: meeting, subscription, plan, user, org, membership, log | Every join | **MEDIUM** — could be parallelized |
| `ai.service.ts` `processMinutes` | Sequential: wallet check → deduct → transcribe → generate → update → notify | Per meeting end | **LOW** — async, runs once |

### 3.4 Missing Indexes

| Table | Recommended Index | Reason |
| ------- | ------------------ | -------- |
| `meeting_transcripts` | `(meeting_id, speaker_id)` | Query by speaker for AI processing |
| `meeting_join_logs` | `(user_id, joined_at)` | User's meeting history queries |
| `memberships` | `(user_id, is_active)` | Socket connection room joins — queries all active memberships |
| `ai_wallet` | Already has `UNIQUE(organization_id)` | OK |
| `translation_wallet` | Already has `UNIQUE(organization_id)` | OK |

### 3.5 Legacy / Dead Fields

| Table | Field | Status | Notes |
| ------- | ------- | -------- | ------- |
| `meetings` | `audio_storage_url` | Semi-active | Used only when audio file uploaded for AI processing; live transcripts make this secondary |
| `ai_credits` | Entire table | **SUPERSEDED** | Migration 006 created `ai_wallet` + `ai_wallet_transactions`. The old `ai_credits` / `ai_credit_transactions` tables from migration 001 still exist but are unused by current code |
| `licenses` | Entire table | **SUPERSEDED** | Replaced by `subscription_plans` + `subscriptions` in migration 006 |
| `organizations.license_id` | FK to licenses | **DEAD** | No longer used — subscription system replaced licensing |

---

## Phase 5 — Translation & Transcription Pipeline

### 5.1 Complete Audio Flow Diagram

```text
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

```text
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

```text
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

```text
On first click/touchstart event:
  1. Create empty SpeechSynthesisUtterance('')
  2. Set volume = 0
  3. Call speechSynthesis.speak(utterance)
  → This "unlocks" the audio context (Chrome autoplay policy)
```

**Speak Function:**

```text
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

```text
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

```text
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
| ------- | ------------------ | ----------- |
| Mic → Web Speech API | 50-200ms | Browser STT engine, varies by browser/OS |
| Speech → Socket.IO | 10-50ms | Network round-trip |
| Socket → translateToMultiple | 200-1500ms | GPT-4o-mini API call (per language batch) |
| Translation result → per-user routing | 5-50ms | Socket scan + emit loop |
| Result → TTS playback | 100-500ms | Chrome TTS queue, voice loading |
| **Total end-to-end** | **~400ms - 2.5s** | **Translation API is the bottleneck** |

For a meeting with 5 languages, `translateToMultiple` runs 5 translations in 1 batch (parallelized), so the latency is dominated by the slowest single translation, not cumulative.

---

## Appendix A — Complete API Endpoint Map

### Meeting Endpoints (file: `apps/api/src/routes/meetings.ts`, 1497 lines)

| Method | Path | Auth | Purpose |
| -------- | ------ | ------ | --------- |
| GET | `/api/meetings/:orgId` | JWT + member | List meetings |
| POST | `/api/meetings/:orgId` | JWT + org_admin/executive | Create meeting |
| GET | `/api/meetings/:orgId/:meetingId` | JWT + member | Get meeting detail |
| PATCH | `/api/meetings/:orgId/:meetingId` | JWT + org_admin/executive | Update meeting |
| DELETE | `/api/meetings/:orgId/:meetingId` | JWT + org_admin | Delete meeting |
| POST | `/api/meetings/:orgId/:meetingId/join` | JWT + member | **Join meeting (LiveKit token)** |
| POST | `/api/meetings/:orgId/:meetingId/start` | JWT + org_admin/executive | Start meeting |
| POST | `/api/meetings/:orgId/:meetingId/end` | JWT + org_admin/executive | End meeting |
| GET | `/api/meetings/:orgId/:meetingId/attendance` | JWT + member | Get attendance |
| POST | `/api/meetings/:orgId/:meetingId/attendance` | JWT + org_admin/executive | Mark attendance |
| POST | `/api/meetings/:orgId/:meetingId/votes` | JWT + org_admin/executive | Create vote |
| POST | `/api/meetings/:orgId/:meetingId/votes/:voteId/cast` | JWT + member | Cast vote |
| POST | `/api/meetings/:orgId/:meetingId/votes/:voteId/close` | JWT + org_admin/executive | Close vote |
| POST | `/api/meetings/:orgId/:meetingId/audio` | JWT + org_admin/executive | Upload audio file |
| GET | `/api/meetings/:orgId/:meetingId/translation-languages` | JWT + member | Get translation lang map |
| GET | `/api/meetings/:orgId/:meetingId/transcripts` | JWT + member | Get transcripts |
| GET | `/api/meetings/:orgId/:meetingId/minutes` | JWT + member | Get AI minutes |
| GET | `/api/meetings/:orgId/:meetingId/minutes/download` | JWT + member | Download minutes document |
| POST | `/api/meetings/:orgId/:meetingId/generate-minutes` | JWT + org_admin/executive | Trigger AI minutes |

---

## Appendix B — Socket Event Catalog

### Complete Event List

| # | Event | Direction | Category |
| --- | ------- | ----------- | ---------- |
| 1 | `meeting:join` | C→S | Meeting |
| 2 | `meeting:leave` | C→S | Meeting |
| 3 | `meeting:participant-joined` | S→Room | Meeting |
| 4 | `meeting:participant-left` | S→Room | Meeting |
| 5 | `meeting:raise-hand` | C→S | Meeting |
| 6 | `meeting:hand-raised` | S→Room | Meeting |
| 7 | `meeting:started` | S→Org+Room | Lifecycle |
| 8 | `meeting:ended` | S→Org+Room | Lifecycle |
| 9 | `meeting:force-disconnect` | S→Room | Lifecycle |
| 10 | `meeting:start-recording` | C→S | Control |
| 11 | `meeting:stop-recording` | C→S | Control |
| 12 | `meeting:recording-started` | S→Room | Control |
| 13 | `meeting:recording-stopped` | S→Room | Control |
| 14 | `meeting:lock` | C→S | Control |
| 15 | `meeting:lock-changed` | S→Room | Control |
| 16 | `meeting:minutes:ready` | S→Room | AI |
| 17 | `meeting:minutes:processing` | S→Room | AI |
| 18 | `meeting:minutes:failed` | S→Room | AI |
| 19 | `translation:set-language` | C→S | Translation |
| 20 | `translation:speech` | C→S | Translation |
| 21 | `translation:result` | S→User | Translation |
| 22 | `translation:interim` | S→Room | Translation |
| 23 | `translation:participants` | S→Room | Translation |
| 24 | `translation:language-restored` | S→User | Translation |
| 25 | `transcript:stored` | S→Room | Transcript |
| 26 | `chat:message` | Both | Chat |
| 27 | `chat:typing` | C→S | Chat |
| 28 | `notification` | S→User | System |
| 29 | `financial_update` | S→Org | Finance |
| 30 | `payment_completed` | S→User | Finance |

All socket events use Socket.IO exclusively — translation and transcript events are independent of the video transport layer.

---

## Appendix C — Database Schema Relationships

### Meeting-Domain ER Diagram

```text
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

```text
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

*End of document.*
