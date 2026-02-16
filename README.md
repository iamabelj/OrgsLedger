# OrgsLedger

Cross-border organizational infrastructure: memberships, meetings, finances, chat, events, polls, documents, subscriptions, and wallets (AI + translation) in a single monorepo.

## Monorepo layout
- apps/api: Express + Knex API server (PostgreSQL)
- apps/mobile: Expo/React Native app (also exports web bundle)
- packages/database: Database schema, migrations, seed utilities
- packages/shared: Shared TS utilities
- landing: Static developer admin portal (gateway)

## Core domains
- Auth: JWT auth for app users; gateway JWT for developer admin. `/auth/login`, `/auth/me`, `/auth/refresh`.
- Organizations: CRUD, membership management, channels, audit logs.
- Subscriptions/Plans: Plans table, subscriptions per org, status transitions (active → grace → expired). Admin endpoints under `/subscriptions/admin/...`.
- Wallets: AI & translation minute balances per org; adjust and track usage.
- Meetings/Events/Polls/Documents/Announcements: Feature modules under apps/api/src/routes and mobile app screens.

## Key API flows (developer console)
- List orgs: `GET /subscriptions/admin/organizations` (latest subscription per org, member counts, wallets)
- Create org: `POST /subscriptions/admin/organizations` (creates org, channel, membership/invite, wallets; provisions subscription if plan slug exists)
- Assign plan: `POST /subscriptions/admin/organizations/:orgId/assign-plan` → `createSubscription()` (cancels prior active/grace/expired subs, creates new, updates org.subscription_status)
- Org status update: `PUT /subscriptions/admin/organizations/:orgId` (can adjust subscription_status and renew expired periods)

## Known pitfalls and how to avoid them
- Plan not reflecting: Ensure the plan slug exists in `subscription_plans`. `adminCreateOrganization` logs a warning and skips subscription if the slug is missing; dashboard will show "No plan".
- Duplicate/incorrect subscription rows: Fixed by using `DISTINCT ON` for the latest subscription and cancelling expired subs when creating a new one.
- Stale web bundle: Rebuild after frontend changes: `cd apps/mobile && npx expo export --platform web --clear && node scripts/post-export-web.js`.
- Gateway admin email reset on refresh: Fixed in `landing/admin.html` by decoding the gateway JWT on load.

## Build & run
- Install: `npm install`
- API dev: `cd apps/api && npm run dev` (requires PostgreSQL and env vars)
- Mobile/web dev: `cd apps/mobile && npm run start` (Expo)
- Web production bundle: `cd apps/mobile && npx expo export --platform web --clear && node ../../scripts/post-export-web.js`
- Database: `cd packages/database && npx knex migrate:latest` (configure env via `packages/database/src/knexfile.ts`)

## Environment highlights
- JWT secrets: `JWT_SECRET`, `JWT_REFRESH_SECRET`, `GATEWAY_JWT_SECRET`
- Gateway admin (landing server): `ADMIN_EMAIL`, `ADMIN_PASSWORD` (no default)
- Database connection: `DATABASE_URL` (or connection params)

## Support matrix
- Roles: `super_admin`, `developer` (gateway), org-level roles `org_admin`, `executive`, `member`
- Subscription statuses: `active`, `grace_period`, `expired`, `cancelled`, `suspended`
- Billing currencies: `USD`, `NGN`

## Debug checklist for plans/subscriptions
1) Verify plan slug exists: `select slug from subscription_plans;`
2) Create org with that slug; confirm `subscriptions` row inserted (status active) and `organizations.subscription_status` set.
3) Admin orgs endpoint should return `plan_name/plan_slug` and `sub_status`; if null, the plan slug was missing.
4) If dashboard still shows none, rebuild and deploy the web bundle.
