# OrgsLedger — Deployment Guide

> **Database:** Neon.tech (PostgreSQL, free tier)
> **Hosting:** Hostinger Cloud Shared Hosting (hPanel)
> **App URL:** `test.orgsledger.com`
> **Sales Page:** `orgsledger.com`
> **Repo:** `https://github.com/iamabelj/OrgsLedger.git`

---

## Architecture

```
┌──────────────┐        ┌────────────────────────────────┐        ┌──────────────────┐
│   Browser    │───────▶│   Hostinger Cloud Hosting      │───────▶│    Neon.tech      │
│   (Users)    │        │   (hPanel — Express/Node.js)   │        │    PostgreSQL     │
└──────────────┘        │                                │        │    (Serverless)   │
                        │  test.orgsledger.com           │        │                  │
                        │    └── Express API serves:     │        │  AWS us-east-1   │
                        │         /api/*  (API routes)   │        └──────────────────┘
                        │         /*      (Web app)      │
                        │                                │
                        │  orgsledger.com                │
                        │    └── public_html/ (landing)  │
                        └────────────────────────────────┘
```

| Component       | Service                    | Cost                  |
|-----------------|----------------------------|-----------------------|
| Database        | Neon.tech (free tier)       | $0 (0.5 GB storage)   |
| Hosting         | Hostinger Cloud (shared)   | ~$10–13/mo            |
| Domain + SSL    | Hostinger (included)       | Free (auto-SSL)       |

> **Key:** The Express API serves BOTH the API endpoints (`/api/*`) and the
> web frontend (static files + SPA fallback). No separate web server needed.

---

## Part 1 — Neon.tech Database Setup (DONE ✅)

### 1.1 Project Created

Your Neon.tech database is set up and running:

```
DATABASE_URL=postgresql://neondb_owner:npg_S4XDP5sCkTyw@ep-crimson-sky-aim3t0hb-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require
```

- **Cloud:** AWS us-east-1
- **Connection:** Pooler enabled (production-ready)
- **Migrations:** ✅ 4 migrations applied
- **Seed:** ✅ Admin user + demo org created

### 1.2 Neon.tech Dashboard

- URL: [console.neon.tech](https://console.neon.tech)
- Monitor connections, queries, storage under **Monitoring** tab
- Free tier auto-suspends after 5 min idle (first request ~1s to wake)

---

## Part 2 — Hostinger Cloud Hosting Setup

### 2.1 Get Hosting

1. Go to [hostinger.com](https://hostinger.com) → **Cloud Hosting**
2. Choose any Cloud plan (Cloud Startup or higher)
3. Register/connect your domain `orgsledger.com`

### 2.2 Create Subdomain for the App

1. Login to **hPanel** → your hosting dashboard
2. Go to **Domains** → **Subdomains**
3. Create subdomain: `test.orgsledger.com`

### 2.3 Point DNS

In hPanel → **DNS / Nameservers** (or your domain registrar):

| Type | Name   | Value              | TTL  |
|------|--------|--------------------|------|
| A    | @      | Hostinger IP       | 3600 |
| A    | test   | Hostinger IP       | 3600 |
| A    | www    | Hostinger IP       | 3600 |

(Hostinger usually sets these automatically if the domain is managed there.)

### 2.4 Enable SSL

1. hPanel → **Security** → **SSL**
2. Install free SSL for both `orgsledger.com` and `test.orgsledger.com`
3. Enable **Force HTTPS**

---

## Part 3 — Deploy via SSH

### 3.1 Enable SSH & Connect

1. hPanel → **Advanced** → **SSH Access** → Enable SSH
2. Note your SSH credentials (username, port, hostname)
3. Connect:

```bash
ssh -p PORT username@hostname
```

### 3.2 Clone & Build

```bash
# Navigate to subdomain folder
cd domains/test.orgsledger.com

# Clone the repo
git clone https://github.com/iamabelj/OrgsLedger.git
cd OrgsLedger

# Install dependencies
npm install

# Build shared packages
cd packages/shared && npx tsc && cd ../..
cd packages/database && npx tsc && cd ../..

# Build API
cd apps/api && npx tsc && cd ../..

# Build web frontend
cd apps/mobile && npx expo export --platform web && cd ../..

# Create uploads directory
mkdir -p apps/api/uploads
```

---

## Part 4 — Create Node.js Application (Express)

### 4.1 Create App in hPanel

1. hPanel → **Advanced** → **Node.js**
2. Click **"Create a new application"**
3. Fill in:

   | Setting                      | Value                                                  |
   |------------------------------|--------------------------------------------------------|
   | **Framework**                | **Express**                                            |
   | **Node.js version**          | 20.x (latest LTS)                                     |
   | **Application mode**         | Production                                             |
   | **Application root**         | `domains/test.orgsledger.com/OrgsLedger/apps/api`      |
   | **Application startup file** | `dist/index.js`                                        |
   | **Linked domain**            | `test.orgsledger.com`                                  |

4. Click **Create**

> **How it works:** Hostinger proxies all `test.orgsledger.com` traffic to the
> Express app. The Express app serves API routes at `/api/*` and the web
> frontend (static files + SPA fallback) for all other routes. No `.htaccess`
> or `public_html` setup needed for the app subdomain.

### 4.2 Set Environment Variables

In hPanel → **Node.js** → your app → **Environment Variables**, add each one:

**Required:**
| Variable | Value |
|----------|-------|
| `NODE_ENV` | `production` |
| `PORT` | `3000` |
| `DATABASE_URL` | `postgresql://neondb_owner:npg_S4XDP5sCkTyw@ep-crimson-sky-aim3t0hb-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require` |
| `JWT_SECRET` | *(generate — see below)* |
| `JWT_EXPIRES_IN` | `7d` |
| `JWT_REFRESH_EXPIRES_IN` | `30d` |
| `CORS_ORIGINS` | `https://test.orgsledger.com,https://orgsledger.com` |
| `UPLOAD_DIR` | `./uploads` |
| `MAX_FILE_SIZE_MB` | `50` |

Generate your JWT secret locally:
```powershell
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```
Copy the output and paste it as the `JWT_SECRET` value.

**Optional (add later when ready):**
| Variable | Purpose |
|----------|---------|
| `STRIPE_SECRET_KEY` | Stripe payments |
| `PAYSTACK_SECRET_KEY` | Paystack payments |
| `PAYSTACK_PUBLIC_KEY` | Paystack payments |
| `FLUTTERWAVE_SECRET_KEY` | Flutterwave payments |
| `FLUTTERWAVE_PUBLIC_KEY` | Flutterwave payments |
| `OPENAI_API_KEY` | AI meeting minutes |
| `SMTP_HOST` | Email sending |
| `SMTP_PORT` | Email port (587) |
| `SMTP_USER` | Email username |
| `SMTP_PASS` | Email password |
| `EMAIL_FROM` | noreply@orgsledger.com |

### 4.3 Install Dependencies via hPanel

After creating the app, in hPanel → **Node.js** → your app:
1. Click **"Run NPM Install"** (this installs from the `apps/api/package.json`)
2. Click **"Restart"**

### 4.4 Verify App is Running

In hPanel → **Node.js** → your app should show status **"Running"**

Open browser: `https://test.orgsledger.com/health` → should return:
```json
{"status":"ok","version":"1.0.0","timestamp":"...","uptime":123}
```

Open browser: `https://test.orgsledger.com` → should show the login page.

---

## Part 5 — Landing Page (orgsledger.com)

### 5.1 Upload Landing Page

The landing/sales page goes on the **main domain's** `public_html/`:

**Option A — via SSH:**
```bash
cp ~/domains/test.orgsledger.com/OrgsLedger/landing/index.html ~/domains/orgsledger.com/public_html/index.html
```

**Option B — via hPanel:**
hPanel → **Files** → **File Manager** → navigate to `public_html/` → upload `landing/index.html`

### 5.2 Verify

Open `https://orgsledger.com` → you should see the sales/landing page.

---

## Part 6 — Default Login & First Steps

```
Email:    admin@orgsledger.com
Password: SuperAdmin123!
```

**⚠️ Change the password immediately after first login!**

---

## Part 7 — Updates & Maintenance

### Push an Update

1. Make changes locally, commit, push to GitHub:
   ```powershell
   git add -A
   git commit -m "description of changes"
   git push origin main
   ```

2. SSH into Hostinger and pull + rebuild:
   ```bash
   cd domains/test.orgsledger.com/OrgsLedger
   git pull origin main

   # Rebuild all
   cd packages/shared && npx tsc && cd ../..
   cd packages/database && npx tsc && cd ../..
   cd apps/api && npx tsc && cd ../..
   cd apps/mobile && npx expo export --platform web && cd ../..
   ```

3. Restart app: hPanel → **Node.js** → click **"Restart"**

4. Run new migrations (if any):
   ```bash
   cd packages/database
   DATABASE_URL="your_neon_url" npx ts-node src/migrate.ts
   ```

### Monitor

- **Neon.tech:** Dashboard → Monitoring (connections, queries, storage)
- **Hostinger:** hPanel → Node.js → check app status / logs
- **API health:** `curl https://test.orgsledger.com/health`

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| **"Database connection failed"** | Check `DATABASE_URL` in hPanel env vars — Neon free tier sleeps after 5 min, first request takes ~1s |
| **CORS error in browser** | Check `CORS_ORIGINS` env var includes your domain, restart app |
| **502 / App not loading** | hPanel → Node.js → check status. Click Restart. Verify `dist/index.js` exists. |
| **Blank page on web** | Rebuild: `cd apps/mobile && npx expo export --platform web`. Restart app. |
| **"Too many connections"** | Already using Neon's pooler (`-pooler` in hostname) ✅ |
| **SSL error** | hPanel → Security → SSL → Reinstall. Enable Force HTTPS. |
| **JWT error in production** | Make sure `JWT_SECRET` env var is set (not the default) |
| **Uploads not working** | `mkdir -p apps/api/uploads` and ensure write permissions |
| **"Cannot find module"** | Run `npm install` in `apps/api/`, then click "Run NPM Install" in hPanel |
| **Web files not found** | Ensure `apps/mobile/dist/` exists — rebuild with `npx expo export --platform web` |

---

## Quick Reference

```
Production URLs:
  App:      https://test.orgsledger.com
  API:      https://test.orgsledger.com/api
  Health:   https://test.orgsledger.com/health
  Landing:  https://orgsledger.com

GitHub Repo:
  https://github.com/iamabelj/OrgsLedger

Neon.tech Dashboard:
  https://console.neon.tech

Default Login:
  admin@orgsledger.com / SuperAdmin123!

Hostinger hPanel:
  https://hpanel.hostinger.com

Key Paths (on Hostinger via SSH):
  Repo:      ~/domains/test.orgsledger.com/OrgsLedger/
  API build: ~/domains/test.orgsledger.com/OrgsLedger/apps/api/dist/
  Web build: ~/domains/test.orgsledger.com/OrgsLedger/apps/mobile/dist/
  Uploads:   ~/domains/test.orgsledger.com/OrgsLedger/apps/api/uploads/
  Landing:   ~/domains/orgsledger.com/public_html/
```
