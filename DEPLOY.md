# OrgsLedger — Deployment Guide (Hostinger + Neon.tech)

> No SSH required. Everything done through hPanel GUI + local terminal.

| Domain | What it serves |
|--------|---------------|
| `app.orgsledger.com` | **Everything** — API (`/api/*`) + Web App (`/*`) — single Node.js app |
| `orgsledger.com` | Marketing / landing page (static HTML) |

---

## Architecture

```
┌──────────────┐       ┌─────────────────────────────────┐       ┌──────────────────┐
│   Browser    │──────▶│  app.orgsledger.com              │──────▶│    Neon.tech      │
│   + Mobile   │       │    Express Node.js app           │       │    PostgreSQL     │
└──────────────┘       │      /api/*  → REST API          │       │    (cloud DB)     │
                       │      /health → health check      │       └──────────────────┘
                       │      /*      → Web SPA            │
                       │                                   │
                       │  orgsledger.com                   │
                       │    public_html/ → landing page    │
                       └─────────────────────────────────┘
```

| Service | Cost |
|---------|------|
| Neon.tech PostgreSQL (free tier) | $0 |
| Hostinger Cloud Hosting | ~$10–13/mo |
| Domain + SSL (Hostinger) | Free |

---

## Step 1 — Neon.tech Database

### First-time setup (already done if you have a DATABASE_URL)

1. Sign up at [neon.tech](https://neon.tech)
2. Create project → choose **AWS us-east-1**
3. Copy the **pooled connection string** (the one with `-pooler` in the hostname)

### Run Migrations (from your local machine)

Open PowerShell locally:

```powershell
cd c:\Users\Globull\Desktop\OrgsLedger\packages\database
$env:DATABASE_URL = "postgresql://neondb_owner:YOUR_PASS@YOUR_HOST-pooler.REGION.aws.neon.tech/neondb?sslmode=require"
npx ts-node src/migrate.ts
npx ts-node src/seed.ts
```

### Do I need to do anything in Neon.tech when I deploy?

**No.** The same `DATABASE_URL` works forever. Your API connects to Neon.tech over the internet — the database doesn't care where the API is hosted. Only run migrations again if you add new migration files.

---

## Step 2 — Build Locally Before Deploying

Before deploying, build everything on your local machine:

```powershell
cd c:\Users\Globull\Desktop\OrgsLedger

# Build shared packages
cd packages/shared; npx tsc; cd ../..
cd packages/database; npx tsc; cd ../..

# Build API (compiles TypeScript → dist/)
cd apps/api; npx tsc; cd ../..

# Build web frontend (Expo → apps/mobile/dist/)
cd apps/mobile; npx expo export --platform web; cd ../..
```

Then push to GitHub:
```powershell
git add -A
git commit -m "production build"
git push origin main
```

---

## Step 3 — Hostinger Setup (One-time, via hPanel)

### 3.1 Create Subdomain

1. Login to [hPanel](https://hpanel.hostinger.com)
2. Go to **Domains** → **Subdomains**
3. Create: `app.orgsledger.com`

### 3.2 Enable SSL

1. hPanel → **Security** → **SSL**
2. Install free SSL for both:
   - `orgsledger.com`
   - `app.orgsledger.com`
3. Enable **Force HTTPS**

### 3.3 Create Node.js Application

1. hPanel → **Advanced** → **Node.js**
2. Click **"Create a new application"**
3. Fill in:

| Setting | Value |
|---------|-------|
| **Node.js version** | 20.x (latest LTS) |
| **Application mode** | Production |
| **Application root** | `domains/app.orgsledger.com/OrgsLedger` (folder containing `server.js`) |
| **Application startup file** | `server.js` |
| **Linked domain** | `app.orgsledger.com` |

4. Click **Create**

### 3.4 Connect Git Repository

1. hPanel → **Files** → **Git**
2. Click **"Create a new repository"** or **"Import from GitHub"**
3. Repository URL: `https://github.com/iamabelj/OrgsLedger.git`
4. Branch: `main`
5. Target directory: `domains/app.orgsledger.com/OrgsLedger`
6. Enable **Auto-deploy** (every push to `main` auto-deploys)

> **Alternative (no Git):** Use hPanel → **Files** → **File Manager** to upload the entire project folder manually. Or use the **Import from GitHub** option.

### 3.5 Set Environment Variables

hPanel → **Node.js** → your app → **Environment Variables**:

| Variable | Value |
|----------|-------|
| `NODE_ENV` | `production` |
| `PORT` | `3000` |
| `DATABASE_URL` | `postgresql://neondb_owner:YOUR_PASS@YOUR_HOST-pooler.REGION.aws.neon.tech/neondb?sslmode=require` |
| `JWT_SECRET` | *(generate — see below)* |
| `JWT_EXPIRES_IN` | `7d` |
| `JWT_REFRESH_EXPIRES_IN` | `30d` |
| `CORS_ORIGINS` | `https://orgsledger.com,https://app.orgsledger.com` |
| `UPLOAD_DIR` | `./uploads` |
| `MAX_FILE_SIZE_MB` | `50` |

**Generate JWT secret** (run locally in PowerShell):
```powershell
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```
Copy the output → paste as `JWT_SECRET`.

**Optional variables** (add later when you set up these services):

| Variable | Purpose |
|----------|---------|
| `STRIPE_SECRET_KEY` | Stripe payments |
| `PAYSTACK_SECRET_KEY` | Paystack payments |
| `PAYSTACK_PUBLIC_KEY` | Paystack client key |
| `FLUTTERWAVE_SECRET_KEY` | Flutterwave payments |
| `FLUTTERWAVE_PUBLIC_KEY` | Flutterwave client key |
| `OPENAI_API_KEY` | AI meeting summaries |
| `SMTP_HOST` | Email (e.g. `smtp.zoho.com`) |
| `SMTP_PORT` | `587` |
| `SMTP_USER` | Email username |
| `SMTP_PASS` | Email password |
| `EMAIL_FROM` | `noreply@orgsledger.com` |
| `FIREBASE_PROJECT_ID` | Push notifications |

### 3.6 Install Dependencies & Start

1. hPanel → **Node.js** → click **"Run NPM Install"**
2. Click **"Restart"**

### 3.7 Verify

Open `https://app.orgsledger.com/health` in your browser. You should see:
```json
{"status":"ok","version":"1.0.0","timestamp":"...","uptime":123}
```

Open `https://app.orgsledger.com` → you should see the login page.

---

## Step 4 — Landing Page (orgsledger.com)

1. hPanel → **Files** → **File Manager**
2. Navigate to `public_html/` (the root domain's folder)
3. Upload `landing/index.html` as `index.html`
4. Open `https://orgsledger.com` → marketing/sales page

---

## Step 5 — First Login

```
Email:    admin@orgsledger.com
Password: SuperAdmin123!
```

**⚠️ Change the password immediately!**

---

## Updating the App (Future Deployments)

### If Auto-deploy is enabled (recommended)

1. Make changes locally
2. Push to GitHub:
   ```powershell
   git add -A
   git commit -m "what changed"
   git push origin main
   ```
3. Hostinger auto-pulls the code
4. hPanel → **Node.js** → click **"Restart"**

### If Auto-deploy is NOT enabled

1. Push to GitHub (same as above)
2. hPanel → **Files** → **Git** → click **"Pull"**
3. hPanel → **Node.js** → click **"Run NPM Install"** (only if dependencies changed)
4. hPanel → **Node.js** → click **"Restart"**

### If you added new database migrations

Run from your local machine (no need to touch Hostinger):
```powershell
cd packages/database
$env:DATABASE_URL = "your_neon_url"
npx ts-node src/migrate.ts
```

---

## FAQ

**Q: Do I need to do anything in Neon.tech when I deploy?**
No. The `DATABASE_URL` never changes. Your API connects to Neon.tech over the internet. The database is always available.

**Q: When do I run migrations?**
Only when you add new migration files in `packages/database/src/migrations/`. Run them from your local machine — Neon.tech is accessible from anywhere.

**Q: Why one domain for API + web app?**
The Express server serves both API routes (`/api/*`) and the web frontend (static SPA at `/*`). One domain, one Node.js app, simpler setup.

**Q: What about the mobile app?**
The mobile app (iOS/Android) calls `https://app.orgsledger.com/api` — same server. No separate API domain needed.

**Q: Do I need SSH?**
No. Everything is done through hPanel GUI (Git import, file manager, Node.js panel, env vars, restart).

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| **502 / App won't start** | hPanel → Node.js → check status. Click Restart. Make sure `server.js` exists at the application root. Startup file must be `server.js` (not `dist/index.js`). |
| **Database connection fails** | Check `DATABASE_URL` in env vars. Neon free tier sleeps after 5 min — first request is ~1s slow. |
| **CORS error** | Check `CORS_ORIGINS` includes `https://app.orgsledger.com`. Restart. |
| **Blank web page** | Rebuild locally: `cd apps/mobile && npx expo export --platform web`. Push. Pull in hPanel. Restart. |
| **JWT / auth errors** | Make sure `JWT_SECRET` env var is set (not the default). Restart. |
| **Uploads fail** | Ensure `uploads/` folder exists in `apps/api/`. |
| **SSL errors** | hPanel → Security → SSL → Reinstall. Enable Force HTTPS. |
| **"Cannot find module"** | hPanel → Node.js → "Run NPM Install" → Restart. |

---

## Quick Reference

```
Production URLs:
  Web App + API:  https://app.orgsledger.com
  API endpoint:   https://app.orgsledger.com/api
  Health check:   https://app.orgsledger.com/health
  Landing page:   https://orgsledger.com

Default Login:
  admin@orgsledger.com / SuperAdmin123!

GitHub:  https://github.com/iamabelj/OrgsLedger
Neon.tech: https://console.neon.tech
hPanel:  https://hpanel.hostinger.com
```
