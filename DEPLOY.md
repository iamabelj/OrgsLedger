# OrgsLedger — Production Deployment Guide

> **Database:** Neon.tech (PostgreSQL)
> **Hosting:** Hostinger Cloud Hosting (hPanel)
> **Repo:** `https://github.com/iamabelj/OrgsLedger.git`

| Domain | Purpose |
|--------|---------|
| `orgsledger.com` | Marketing / landing page |
| `app.orgsledger.com` | Web application (frontend SPA) |
| `api.orgsledger.com` | Backend API (Express / Node.js) |

---

## Architecture

```
┌──────────────┐       ┌──────────────────────────────────────┐       ┌──────────────────┐
│   Browser    │──────▶│   Hostinger Cloud Hosting (hPanel)   │──────▶│    Neon.tech      │
│   (Users)    │       │                                      │       │    PostgreSQL     │
└──────────────┘       │  orgsledger.com                      │       │    (Serverless)   │
                       │    └── public_html/ (landing page)   │       │  AWS us-east-1   │
┌──────────────┐       │                                      │       └──────────────────┘
│  Mobile App  │──────▶│  api.orgsledger.com                  │
│  (iOS/Andr)  │       │    └── Node.js Express API           │
└──────────────┘       │         /api/*   (REST endpoints)    │
                       │         /health  (health check)      │
                       │         /uploads (authenticated)     │
                       │                                      │
                       │  app.orgsledger.com                  │
                       │    └── Static SPA (Expo web build)   │
                       │         /*  (React SPA, client-side) │
                       └──────────────────────────────────────┘
```

| Component | Service | Cost |
|-----------|---------|------|
| Database | Neon.tech (free/pro) | $0–$19/mo |
| Hosting | Hostinger Cloud | ~$10–13/mo |
| Domain + SSL | Hostinger (included) | Free (auto-SSL) |

---

## Part 1 — Neon.tech Database

### 1.1 Create Project

1. Sign up at [neon.tech](https://neon.tech)
2. Create a new project → choose **AWS us-east-1** (closest)
3. Copy the **pooled connection string**:
   ```
   DATABASE_URL=postgresql://USER:PASS@HOSTNAME-pooler.REGION.aws.neon.tech/neondb?sslmode=require
   ```

### 1.2 Run Migrations & Seed

From your local machine:

```powershell
cd packages/database
$env:DATABASE_URL = "your_neon_connection_string"
npx ts-node src/migrate.ts
npx ts-node src/seed.ts
```

This creates all tables and seeds the default admin user.

### 1.3 Neon Dashboard

- URL: [console.neon.tech](https://console.neon.tech)
- Monitor: connections, queries, storage under **Monitoring** tab
- Free tier auto-suspends after 5 min idle (first request ~1s cold start)

---

## Part 2 — Hostinger Setup

### 2.1 Get Hosting

1. Go to [hostinger.com](https://hostinger.com) → **Cloud Hosting**
2. Choose **Cloud Startup** or higher
3. Register/connect domain `orgsledger.com`

### 2.2 Create Subdomains

In hPanel → **Domains** → **Subdomains**, create:

1. `api.orgsledger.com` — for the backend API
2. `app.orgsledger.com` — for the web application

### 2.3 Point DNS

In hPanel → **DNS / Nameservers** (or your domain registrar):

| Type | Name | Value | TTL |
|------|------|-------|-----|
| A | @ | Hostinger IP | 3600 |
| A | api | Hostinger IP | 3600 |
| A | app | Hostinger IP | 3600 |
| A | www | Hostinger IP | 3600 |

(Hostinger usually auto-configures these if the domain is managed there.)

### 2.4 Enable SSL

1. hPanel → **Security** → **SSL**
2. Install free SSL for:
   - `orgsledger.com`
   - `api.orgsledger.com`
   - `app.orgsledger.com`
3. Enable **Force HTTPS** for all three

---

## Part 3 — Deploy API (api.orgsledger.com)

### 3.1 Enable SSH & Connect

1. hPanel → **Advanced** → **SSH Access** → Enable SSH
2. Note your SSH credentials
3. Connect:

```bash
ssh -p PORT username@hostname
```

### 3.2 Clone & Build

```bash
# Navigate to the API subdomain folder
cd domains/api.orgsledger.com

# Clone the repo
git clone https://github.com/iamabelj/OrgsLedger.git
cd OrgsLedger

# Install all dependencies (from project root)
npm install

# Build shared packages
cd packages/shared && npx tsc && cd ../..
cd packages/database && npx tsc && cd ../..

# Build API
cd apps/api && npx tsc && cd ../..

# Build web frontend (for SPA deployment)
cd apps/mobile && npx expo export --platform web && cd ../..

# Create uploads directory
mkdir -p apps/api/uploads
```

### 3.3 Create Node.js Application in hPanel

1. hPanel → **Advanced** → **Node.js**
2. Click **"Create a new application"**
3. Fill in:

| Setting | Value |
|---------|-------|
| **Framework** | Express |
| **Node.js version** | 20.x (latest LTS) |
| **Application mode** | Production |
| **Application root** | `domains/api.orgsledger.com/OrgsLedger/apps/api` |
| **Application startup file** | `dist/index.js` |
| **Linked domain** | `api.orgsledger.com` |

4. Click **Create**

### 3.4 Set Environment Variables

In hPanel → **Node.js** → your app → **Environment Variables**:

**Required:**

| Variable | Value |
|----------|-------|
| `NODE_ENV` | `production` |
| `PORT` | `3000` |
| `DATABASE_URL` | `postgresql://...your Neon.tech pooled URL...` |
| `JWT_SECRET` | *(generate a strong random string — see below)* |
| `JWT_EXPIRES_IN` | `7d` |
| `JWT_REFRESH_EXPIRES_IN` | `30d` |
| `CORS_ORIGINS` | `https://orgsledger.com,https://app.orgsledger.com,https://api.orgsledger.com` |
| `UPLOAD_DIR` | `./uploads` |
| `MAX_FILE_SIZE_MB` | `50` |

Generate your JWT secret:
```powershell
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

**Optional (add when ready):**

| Variable | Purpose |
|----------|---------|
| `STRIPE_SECRET_KEY` | Stripe payments |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook verification |
| `PAYSTACK_SECRET_KEY` | Paystack payments (Africa) |
| `PAYSTACK_PUBLIC_KEY` | Paystack client key |
| `FLUTTERWAVE_SECRET_KEY` | Flutterwave payments |
| `FLUTTERWAVE_PUBLIC_KEY` | Flutterwave client key |
| `OPENAI_API_KEY` | AI meeting summaries |
| `SMTP_HOST` | Email sending (e.g. smtp.zoho.com) |
| `SMTP_PORT` | `587` |
| `SMTP_USER` | Email username |
| `SMTP_PASS` | Email password |
| `EMAIL_FROM` | `noreply@orgsledger.com` |
| `FIREBASE_PROJECT_ID` | Push notifications (FCM) |
| `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe client key |

### 3.5 Install & Start

1. In hPanel → **Node.js** → click **"Run NPM Install"**
2. Click **"Restart"**

### 3.6 Verify API

```bash
curl https://api.orgsledger.com/health
```

Expected:
```json
{"status":"ok","version":"1.0.0","timestamp":"...","uptime":123}
```

---

## Part 4 — Deploy Web App (app.orgsledger.com)

The web app is a **static SPA** (Expo web build) — no Node.js needed.

### 4.1 Copy Build to Subdomain

Via SSH:
```bash
# Copy the Expo web build to the app subdomain's public folder
cp -r ~/domains/api.orgsledger.com/OrgsLedger/apps/mobile/dist/* ~/domains/app.orgsledger.com/public_html/
```

### 4.2 Create .htaccess for SPA Routing

The SPA needs all routes to serve `index.html` (client-side routing):

```bash
cat > ~/domains/app.orgsledger.com/public_html/.htaccess << 'EOF'
RewriteEngine On
RewriteBase /

# If the requested file or directory exists, serve it directly
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d

# Otherwise, serve index.html (SPA fallback)
RewriteRule ^(.*)$ /index.html [L]
EOF
```

### 4.3 Verify Web App

Open `https://app.orgsledger.com` in your browser → you should see the login page.

---

## Part 5 — Landing Page (orgsledger.com)

### 5.1 Upload Landing Page

Via SSH:
```bash
cp ~/domains/api.orgsledger.com/OrgsLedger/landing/index.html ~/domains/orgsledger.com/public_html/index.html
```

Or via hPanel → **Files** → **File Manager** → navigate to `public_html/` → upload `landing/index.html`.

### 5.2 Verify

Open `https://orgsledger.com` → you should see the marketing/sales page.

---

## Part 6 — Default Login

```
Email:    admin@orgsledger.com
Password: SuperAdmin123!
```

**⚠️ Change the password immediately after first login!**

---

## Part 7 — Updates & Maintenance

### 7.1 Push an Update (Full Workflow)

**Step 1 — Local: commit & push**
```powershell
cd c:\Users\Globull\Desktop\OrgsLedger
git add -A
git commit -m "description of changes"
git push origin main
```

**Step 2 — Hostinger SSH: pull & rebuild**
```bash
cd ~/domains/api.orgsledger.com/OrgsLedger
git pull origin main

# Rebuild everything
cd packages/shared && npx tsc && cd ../..
cd packages/database && npx tsc && cd ../..
cd apps/api && npx tsc && cd ../..
cd apps/mobile && npx expo export --platform web && cd ../..

# Copy updated web build to app subdomain
cp -r apps/mobile/dist/* ~/domains/app.orgsledger.com/public_html/

# Copy updated landing page
cp landing/index.html ~/domains/orgsledger.com/public_html/index.html
```

**Step 3 — Restart Node.js app**

hPanel → **Node.js** → click **"Restart"**

### 7.2 Run New Migrations (if any)

```bash
cd ~/domains/api.orgsledger.com/OrgsLedger/packages/database
DATABASE_URL="your_neon_url" npx ts-node src/migrate.ts
```

### 7.3 One-Line Rebuild Script

Create a `~/rebuild.sh` on Hostinger for convenience:

```bash
#!/bin/bash
set -e
cd ~/domains/api.orgsledger.com/OrgsLedger
git pull origin main
cd packages/shared && npx tsc && cd ../..
cd packages/database && npx tsc && cd ../..
cd apps/api && npx tsc && cd ../..
cd apps/mobile && npx expo export --platform web && cd ../..
cp -r apps/mobile/dist/* ~/domains/app.orgsledger.com/public_html/
cp landing/index.html ~/domains/orgsledger.com/public_html/index.html
echo "✅ Rebuild complete — restart Node.js app in hPanel"
```

```bash
chmod +x ~/rebuild.sh
# Usage: ~/rebuild.sh
```

---

## Part 8 — Monitoring

| Check | Command / URL |
|-------|---------------|
| API health | `curl https://api.orgsledger.com/health` |
| Web app | Open `https://app.orgsledger.com` |
| Landing page | Open `https://orgsledger.com` |
| Database | [console.neon.tech](https://console.neon.tech) → Monitoring |
| App status | hPanel → Node.js → check status / logs |
| Observability | `GET /api/admin/observability/metrics` (admin auth required) |

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| **"Database connection failed"** | Check `DATABASE_URL` in hPanel env vars. Neon free tier sleeps after 5 min — first request ~1s. |
| **CORS error in browser** | Check `CORS_ORIGINS` env var includes `https://app.orgsledger.com`. Restart app. |
| **502 / API not loading** | hPanel → Node.js → check status. Click Restart. Verify `dist/index.js` exists. |
| **Blank web page** | Rebuild: `cd apps/mobile && npx expo export --platform web`. Copy to `app.orgsledger.com/public_html/`. |
| **SPA routes return 404** | Ensure `.htaccess` file exists in `app.orgsledger.com/public_html/` (see Part 4.2). |
| **SSL error** | hPanel → Security → SSL → Reinstall for all 3 domains. Enable Force HTTPS. |
| **JWT error** | Ensure `JWT_SECRET` env var is set (not the default value). |
| **Uploads fail** | Run `mkdir -p apps/api/uploads` and check write permissions. |
| **"Cannot find module"** | Run `npm install` in SSH, then "Run NPM Install" in hPanel. Restart. |
| **Socket.io won't connect** | Check that `api.orgsledger.com` has WebSocket support (Hostinger Cloud supports it). |
| **Push notifications** | Set `FIREBASE_PROJECT_ID` env var. Upload `google-credentials.json` to `apps/api/`. |

---

## Quick Reference

```
Production URLs:
  Landing:  https://orgsledger.com
  Web App:  https://app.orgsledger.com
  API:      https://api.orgsledger.com/api
  Health:   https://api.orgsledger.com/health

GitHub Repo:
  https://github.com/iamabelj/OrgsLedger

Neon.tech Dashboard:
  https://console.neon.tech

Default Login:
  admin@orgsledger.com / SuperAdmin123!

Hostinger hPanel:
  https://hpanel.hostinger.com

Key Paths (Hostinger SSH):
  Repo:        ~/domains/api.orgsledger.com/OrgsLedger/
  API build:   ~/domains/api.orgsledger.com/OrgsLedger/apps/api/dist/
  Uploads:     ~/domains/api.orgsledger.com/OrgsLedger/apps/api/uploads/
  Web app:     ~/domains/app.orgsledger.com/public_html/
  Landing:     ~/domains/orgsledger.com/public_html/
```
