# OrgsLedger

**Licensed, resellable, cross-platform (Android & iOS) application for group communication, meetings, operations, payments, and financial transparency — for associations, organizations, clubs, and communities.**

---

## Architecture

```
OrgsLedger/
├── apps/
│   ├── api/              # Node.js + Express backend
│   └── mobile/           # React Native (Expo) mobile app
├── packages/
│   ├── shared/           # Shared TypeScript types & enums
│   └── database/         # Knex migrations & seeds (28 tables)
├── docker-compose.yml    # PostgreSQL 16, Redis 7, API
├── tsconfig.base.json    # Shared TS config
└── package.json          # Monorepo workspaces (npm)
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | Node.js, Express, TypeScript, Socket.io |
| **Database** | PostgreSQL 16 (via Knex), 28 tables |
| **Cache** | Redis 7 |
| **Mobile** | React Native (Expo ~50), Expo Router ~3.4 |
| **State** | Zustand (3 stores) |
| **Payments** | Stripe, Paystack, Flutterwave |
| **AI** | Google Cloud Speech-to-Text, OpenAI GPT-4o |
| **Auth** | JWT (access + refresh), bcrypt (12 rounds) |
| **Push** | Firebase Cloud Messaging v1 (OAuth2) |
| **Email** | Nodemailer (SMTP) |
| **Validation** | Zod (body, query, params) |
| **Infra** | Docker Compose |

---

## Project Cores

### 1. Organizations & Multi-Tenancy

Multi-tenant org management with slug-based unique identifiers. Each org gets isolated data, its own settings, and a license tier.

- Create / join / manage organizations
- Per-org settings: currency, timezone, locale, feature flags
- Auto-provisioned free license, General channel, and AI credit record on creation
- Member invitation by email with role assignment
- 5-tier role hierarchy: **guest** → **member** → **executive** → **org_admin** → **super_admin**

### 2. Real-Time Chat & Communication

Full messaging system with 4 channel types and real-time delivery via Socket.IO.

- **Channel types**: general, committee, direct, announcement
- Threaded message replies with thread counts
- File uploads: images, docs, PDFs, videos, audio, archives (via multer)
- Unread message counts per channel per user
- Message search with pagination
- Typing indicators (bidirectional Socket.IO)

### 3. Meetings & Governance

Complete meeting lifecycle with structured governance tools.

- **Lifecycle**: scheduled → live → ended → cancelled
- Structured agenda items with durations, presenters, and ordering
- Attendance tracking: present, absent, excused, late (15-min grace period)
- Bulk attendance management for admins
- **In-meeting voting**: create polls, cast ballots, close & auto-tally results
- Location field for physical / virtual meeting venues
- AI audio upload endpoint for post-meeting processing

### 4. AI-Powered Meeting Minutes

End-to-end pipeline: audio → transcript → structured minutes → email delivery.

| Stage | Technology |
|-------|-----------|
| Speech-to-Text | Google Cloud Speech (v1 long-running, speaker diarization, 5 languages) |
| Summarization | OpenAI GPT-4o — structured output extraction |
| Delivery | Socket.IO real-time status + SMTP email to attendees |

**Structured output includes**: transcript segments, summary, decisions, motions (moved/seconded/result), action items (assignee/due date/status), per-speaker contribution analysis (speaking time, key points).

**Credit system**: per-org balance in minutes, deducted pro-rata by meeting duration, purchasable via any payment gateway ($5/hour default). Credit types: purchase, usage, refund, bonus.

### 5. Financial Management

Complete financial operations with an immutable audit trail.

- **Dues**: one-time or recurring (weekly, biweekly, monthly, quarterly, yearly)
- **Recurring dues scheduler**: runs hourly, auto-generates pending transactions, sends notifications
- **Late fees**: configurable grace days, auto-applied by scheduler
- **Fines**: misconduct, late_payment, absence, other — with descriptions
- **Donation campaigns**: goal tracking, progress bar, anonymous donations
- **Immutable transaction ledger**: every financial event recorded, never modified
- **Ledger summary**: total collected, pending, refunds — per-member financial history
- **CSV export**: properly escaped field values for external reporting

### 6. Multi-Gateway Payments

Three payment gateways with dev-mode auto-complete fallback.

| Gateway | Flow |
|---------|------|
| **Stripe** | Server-side PaymentIntents → client-side Payment Sheet (native) → webhook confirmation |
| **Paystack** | Server initializes → authorization URL → in-app browser redirect → webhook + polling verification |
| **Flutterwave** | Server generates hosted payment link → in-app browser → webhook + polling verification |

All three support: payments, refunds, receipt tracking, and webhook signature validation. Dev mode auto-completes transactions when API keys aren't configured.

### 7. Committees

Sub-group management within organizations.

- Create / update / delete committees
- Assign committee chairs
- Add / remove committee members
- Dedicated committee channels for focused discussion

### 8. Notifications & Push

Dual notification system: in-app + device push.

- **In-app**: paginated notification center, filterable by type, mark read / mark all read
- **Push**: Firebase Cloud Messaging v1 HTTP API with OAuth2 token management
- Auto-cleanup of invalid FCM tokens on 404/400 responses
- Android/APNs-specific notification config (sound, channel, badge)

### 9. Admin & Licensing Platform

Super-admin platform management for reseller deployment.

- **License tiers**: free, basic, professional, enterprise
- **Feature flags per license**: chat, meetings, aiMinutes, financials, donations, voting
- AI credit allocation per license tier
- Platform analytics dashboard: org count, user count, revenue, AI usage
- Paginated audit log viewer with user/action/entity filtering
- Platform config key-value store
- Reseller ID tracking

### 10. Security & Infrastructure

- JWT access tokens (15-min expiry) + refresh tokens (7-day expiry)
- bcrypt 12-round password hashing
- Rate limiting (express-rate-limit)
- Helmet security headers
- CORS: environment-aware (production reads `CORS_ORIGINS`)
- Zod validation on all request bodies, queries, and params
- Parameterized SQL queries throughout (no string interpolation)
- LIKE pattern escaping for search endpoints
- Immutable audit logging with auto-captured IP/user-agent
- Production config validation (JWT_SECRET, DB_PASSWORD)
- DB connection health check on startup

---

### Database Schema (28 tables)

```
users · licenses · organizations · memberships
committees · committee_members
channels · channel_members · messages · attachments
meetings · agenda_items · meeting_attendance
votes · vote_ballots · meeting_minutes
dues · fines · donation_campaigns · donations
transactions · refunds
ai_credits · ai_credit_transactions
audit_logs · notifications · platform_config
```

### Backend Services

| Service | Purpose |
|---------|---------|
| `ai.service` | Speech-to-Text transcription + GPT summarization pipeline, credit deduction |
| `email.service` | SMTP email via nodemailer; meeting minutes template |
| `push.service` | FCM v1 push notifications with OAuth2 token caching |
| `paystack.service` | Paystack API client — initialize, verify, refund, webhook validation |
| `flutterwave.service` | Flutterwave API client — hosted payment links, verify, refund |
| `scheduler.service` | Hourly recurring dues processor + late fee applicator (with run lock) |

### Middleware Stack

| Middleware | Purpose |
|------------|---------|
| `authenticate` | JWT verification, user existence check, attaches `req.user` |
| `loadMembership` | Loads org membership for request, sets `req.membership` |
| `requireRole` | Hierarchical RBAC — super_admin bypasses all |
| `requireSuperAdmin` | Platform-level super admin gate |
| `validate` | Zod schema validation with structured error responses |
| `auditContext` | Attaches `req.audit()` helper for immutable audit log entries |

### Mobile App

**5 Tab Screens**: Home, Chat, Meetings, Financials, Profile

**Feature Screens**: Channel view, Meeting detail, Create meeting, Transaction history, Donate to campaign, Org create/join, Login, Register

**3 Zustand Stores**:
| Store | Responsibilities |
|-------|-----------------|
| `auth` | Login, register, logout, user/membership state, secure token storage, socket lifecycle |
| `chat` | Channel list, messages, send/receive, real-time Socket.IO ingestion |
| `financial` | Ledger summary, transactions, dues, fines, per-user history, real-time updates |

### Shared Types Package

**Enums**: `UserRole`, `OrgStatus`, `ChannelType`, `MeetingStatus`, `TransactionType`, `TransactionStatus`, `AuditAction`, `LicenseType`, `NotificationType`

**Interfaces**: `IOrganization`, `IOrgSettings`, `FeatureFlags`, `IUser`, `IMembership`, `IChannel`, `IMessage`, `IAttachment`, `IMeeting`, `IAgendaItem`, `IAttendance`, `IVote`, `IMeetingMinutes`, `ITranscriptSegment`, `IMotion`, `IActionItem`, `IContribution`, `ITransaction`, `IDue`, `IFine`, `IDonation`, `IAuditLog`, `IAICredits`, `IAICreditTransaction`, `ILicense`, `INotification`, `ApiResponse<T>`, `PaginatedRequest`

---

## Getting Started

### Prerequisites

- Node.js >= 18
- Docker & Docker Compose
- npm >= 9

### 1. Clone & Install

```bash
git clone <repo-url> OrgsLedger
cd OrgsLedger
npm install
```

### 2. Environment Configuration

Create `apps/api/.env`:

```env
# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=orgsledger
DB_USER=orgsledger
DB_PASSWORD=orgsledger_secret

# Redis
REDIS_URL=redis://localhost:6379

# JWT
JWT_SECRET=your-256-bit-secret-minimum-32-chars
JWT_REFRESH_SECRET=your-refresh-256-bit-secret

# Stripe (optional for dev — auto-completes without)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Paystack (optional)
PAYSTACK_SECRET_KEY=sk_test_...
PAYSTACK_PUBLIC_KEY=pk_test_...

# Flutterwave (optional)
FLUTTERWAVE_SECRET_KEY=FLWSECK_TEST-...
FLUTTERWAVE_PUBLIC_KEY=FLWPUBK_TEST-...
FLUTTERWAVE_WEBHOOK_HASH=your-webhook-hash

# AI (optional — falls back to mocks)
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
OPENAI_API_KEY=sk-...

# Email (optional)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=noreply@example.com
SMTP_PASS=password
EMAIL_FROM=noreply@orgsledger.com

# FCM (optional)
FIREBASE_PROJECT_ID=your-firebase-project
GOOGLE_APPLICATION_CREDENTIALS=/path/to/firebase-credentials.json

# Uploads
UPLOAD_DIR=./uploads
MAX_FILE_SIZE=10485760

# Server
PORT=3000
NODE_ENV=development
CORS_ORIGINS=https://yourdomain.com
```

### 3. Start Infrastructure

```bash
docker-compose up -d
```

This starts PostgreSQL and Redis containers.

### 4. Run Migrations & Seed

```bash
cd packages/database
npx ts-node src/migrate.ts
npx ts-node src/seed.ts
```

### 5. Start API Server

```bash
cd apps/api
npm run dev
```

Server starts at `http://localhost:3000`. Health check: `GET /health`.

### 6. Start Mobile App

```bash
cd apps/mobile
npx expo start
```

Scan QR code with Expo Go (Android) or Camera app (iOS).

---

## API Endpoints

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Register new user |
| POST | `/api/auth/login` | Login (returns JWT) |
| POST | `/api/auth/refresh` | Refresh access token |
| GET | `/api/auth/me` | Get current user profile |
| PUT | `/api/auth/me` | Update profile |

### Organizations
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/organizations` | Create organization |
| GET | `/api/organizations` | List user's organizations |
| GET | `/api/organizations/:orgId` | Get organization details |
| PUT | `/api/organizations/:orgId/settings` | Update settings |
| GET/POST | `/api/organizations/:orgId/members` | Manage members |

### Chat
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/api/chat/:orgId/channels` | Channel CRUD |
| GET/POST | `/api/chat/:orgId/channels/:channelId/messages` | Messages |
| GET | `/api/chat/:orgId/channels/:channelId/messages/:msgId/replies` | Thread replies |
| GET | `/api/chat/:orgId/search?q=...` | Search messages |

### Meetings
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST/GET | `/api/meetings/:orgId/meetings` | Create / list meetings |
| POST | `.../start` | Start meeting |
| POST | `.../end` | End meeting (triggers AI) |
| POST | `.../attendance` | Mark attendance |
| POST | `.../votes` | Create vote |
| POST | `.../votes/:voteId/cast` | Cast ballot |
| POST | `.../audio` | Upload audio for AI |

### Financials
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST/GET | `/api/financials/:orgId/dues` | Manage dues |
| POST/GET | `/api/financials/:orgId/fines` | Manage fines |
| POST/GET | `/api/financials/:orgId/donation-campaigns` | Campaigns |
| POST | `/api/financials/:orgId/donations` | Make donation |
| GET | `/api/financials/:orgId/ledger` | Immutable ledger |
| GET | `/api/financials/:orgId/ledger/export` | CSV export |

### Payments
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/payments/:orgId/payments/pay` | Pay transaction (Stripe) |
| POST | `.../refund` | Process refund |
| POST | `/api/payments/webhooks/stripe` | Stripe webhook |
| GET/POST | `/api/payments/:orgId/ai-credits` | AI credits |

### Admin (Super Admin)
| Method | Endpoint | Description |
|--------|----------|-------------|
| CRUD | `/api/admin/licenses` | License management |
| GET/PUT | `/api/admin/config` | Platform config |
| GET | `/api/admin/analytics` | Dashboard analytics |
| GET | `/api/admin/audit-logs` | Audit log viewer |

---

## Real-time Events (Socket.io)

| Event | Direction | Description |
|-------|-----------|-------------|
| `message:new` | Server → Client | New chat message |
| `channel:typing` | Bidirectional | Typing indicators |
| `meeting:started` | Server → Client | Meeting began |
| `meeting:ended` | Server → Client | Meeting ended |
| `meeting:vote:created` | Server → Client | New vote |
| `meeting:audio:chunk` | Client → Server | Audio streaming |
| `meeting:minutes:ready` | Server → Client | AI minutes done |
| `ledger:update` | Server → Client | Financial update |

---

## Roles & Permissions

| Role | Level | Capabilities |
|------|-------|-------------|
| `guest` | 0 | Read-only access |
| `member` | 1 | Chat, attend meetings, pay dues, vote |
| `executive` | 2 | Create meetings, manage channels, issue fines |
| `org_admin` | 3 | Full org management, financial admin |
| `super_admin` | 4 | Platform-wide access, licensing, config |

---

## Default Seed Data

- **Super Admin**: `admin@orgsledger.com` / `SuperAdmin123!`
- **Free License**: Basic tier with default feature limits
- **Demo Org**: "Demo Organization" with General channel
- **AI Credits**: 120 minutes for demo org

---

## License

Proprietary. Licensed per-organization. See `AUDIT_CHECKLIST.md` for compliance details.
