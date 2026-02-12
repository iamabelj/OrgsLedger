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
│   (Users)    │        │   (hPanel)                     │        │    PostgreSQL     │
└──────────────┘        │                                │        │    (Serverless)   │
                        │  orgsledger.com                │        │                  │
                        │    └── public_html/ (landing)  │        │  AWS us-east-1   │
                        │                                │        └──────────────────┘
                        │  test.orgsledger.com           │
                        │    ├── public_html/ (web app)  │
                        │    └── Node.js app (API:3000)  │
                        └────────────────────────────────┘
```

| Component       | Service                    | Cost                  |
|-----------------|----------------------------|-----------------------|
| Database        | Neon.tech (free tier)       | $0 (0.5 GB storage)   |
| Hosting         | Hostinger Cloud (shared)   | ~$10–13/mo            |
| Domain + SSL    | Hostinger (included)       | Free (auto-SSL)       |

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
4. This creates a folder at `domains/test.orgsledger.com/public_html/`

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

## Part 3 — Set Up Node.js Application (API)

### 3.1 Enable Node.js in hPanel

1. hPanel → **Advanced** → **Node.js**
2. Click **"Create a new application"**
3. Fill in:

   | Setting                | Value                                      |
   |------------------------|--------------------------------------------|
   | **Node.js version**    | 20.x (latest LTS)                          |
   | **Application mode**   | Production                                 |
   | **Application root**   | `domains/test.orgsledger.com/OrgsLedger/apps/api` |
   | **Application startup file** | `dist/index.js`                       |
   | **Run NPM install**    | Yes                                        |

4. Click **Create**

### 3.2 Set Environment Variables

In hPanel → **Node.js** → your app → **Environment Variables**, add:

```
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://neondb_owner:npg_S4XDP5sCkTyw@ep-crimson-sky-aim3t0hb-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require
JWT_SECRET=<generate with: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))">
JWT_EXPIRES_IN=7d
JWT_REFRESH_EXPIRES_IN=30d
CORS_ORIGINS=https://test.orgsledger.com,https://orgsledger.com
UPLOAD_DIR=./uploads
MAX_FILE_SIZE_MB=50
```

Optional (add when ready):
```
STRIPE_SECRET_KEY=
PAYSTACK_SECRET_KEY=
PAYSTACK_PUBLIC_KEY=
FLUTTERWAVE_SECRET_KEY=
FLUTTERWAVE_PUBLIC_KEY=
OPENAI_API_KEY=
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
EMAIL_FROM=noreply@orgsledger.com
```

### 3.3 Deploy via SSH (Terminal)

1. hPanel → **Advanced** → **SSH Access** → Enable SSH
2. Note your SSH credentials (username, port, hostname)
3. Connect:

```bash
ssh -p PORT username@hostname
```

4. Clone and build:

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

### 3.4 Copy Web App Files to public_html

The Expo web build needs to be served as static files:

```bash
# Copy web build to the subdomain's public_html
cp -r apps/mobile/dist/* ../public_html/
```

### 3.5 Configure .htaccess for SPA Routing

Create `.htaccess` in the subdomain's `public_html/` for single-page app routing:

```bash
cat > ../public_html/.htaccess << 'EOF'
RewriteEngine On

# Proxy API requests to Node.js app
RewriteRule ^api/(.*)$ http://127.0.0.1:3000/api/$1 [P,L]
RewriteRule ^health$ http://127.0.0.1:3000/health [P,L]
RewriteRule ^socket.io/(.*)$ http://127.0.0.1:3000/socket.io/$1 [P,L]

# Proxy uploads
RewriteRule ^uploads/(.*)$ http://127.0.0.1:3000/uploads/$1 [P,L]

# SPA fallback — serve index.html for all non-file routes
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule . /index.html [L]
EOF
```

### 3.6 Start the Node.js App

Go back to hPanel → **Node.js** → your app → click **"Restart"**

Or via SSH:
```bash
# If hPanel Node.js manager is set up, it auto-starts
# Otherwise, you can check the process:
cd domains/test.orgsledger.com/OrgsLedger/apps/api
node dist/index.js
```

---

## Part 4 — Landing Page (orgsledger.com)

### 4.1 Upload Landing Page

The sales page goes in the **main domain's** `public_html/`:

```bash
# Via SSH
cp landing/index.html ~/domains/orgsledger.com/public_html/index.html
```

Or via hPanel → **Files** → **File Manager** → navigate to `public_html/` → upload `landing/index.html`.

### 4.2 Verify

Open `https://orgsledger.com` → you should see the sales/landing page.

---

## Part 5 — Verify Deployment

### Check the API

```bash
curl https://test.orgsledger.com/health
```

Expected:
```json
{"status":"ok","version":"1.0.0","timestamp":"...","uptime":123}
```

### Check the Web App

Open `https://test.orgsledger.com` → you should see the login page.

### Default Login

```
Email:    admin@orgsledger.com
Password: SuperAdmin123!
```

**⚠️ Change the password immediately after first login!**

---

## Part 6 — Updates & Maintenance

### Push an Update

1. Make changes locally, commit, push to GitHub:
   ```powershell
   git add -A
   git commit -m "description of changes"
   git push origin main
   ```

2. SSH into Hostinger and pull:
   ```bash
   cd domains/test.orgsledger.com/OrgsLedger
   git pull origin main

   # Rebuild
   cd packages/shared && npx tsc && cd ../..
   cd packages/database && npx tsc && cd ../..
   cd apps/api && npx tsc && cd ../..
   cd apps/mobile && npx expo export --platform web && cd ../..

   # Copy updated web files
   cp -r apps/mobile/dist/* ../public_html/

   # Restart Node.js app via hPanel or:
   # hPanel → Node.js → Restart
   ```

3. Run new migrations (if any):
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
| **"Database connection failed"** | Check `DATABASE_URL` in Node.js env vars — Neon free tier sleeps after 5 min, first request takes ~1s |
| **CORS error in browser** | Add domain to `CORS_ORIGINS` env var, restart Node.js app |
| **502 / App not loading** | hPanel → Node.js → check status. Click Restart. Check logs. |
| **Blank page on web** | Rebuild: `cd apps/mobile && npx expo export --platform web`. Re-copy to public_html. |
| **"Too many connections"** | You're already using Neon's pooler (`-pooler` in hostname) ✅ |
| **SSL error** | hPanel → Security → SSL → Reinstall. Enable Force HTTPS. |
| **JWT error in production** | Make sure `JWT_SECRET` env var is set (not the default) |
| **Uploads not working** | `mkdir -p apps/api/uploads` and ensure write permissions |
| **API routes 404** | Check `.htaccess` has the ProxyPass rules for `/api/` |
| **Socket.io not connecting** | Check `.htaccess` proxies `/socket.io/` correctly |
| **Node.js version issue** | hPanel → Node.js → change to 20.x LTS |

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

Key Paths (on Hostinger):
  App code:    ~/domains/test.orgsledger.com/OrgsLedger/
  Web files:   ~/domains/test.orgsledger.com/public_html/
  Landing:     ~/domains/orgsledger.com/public_html/
  API build:   ~/domains/test.orgsledger.com/OrgsLedger/apps/api/dist/
  Uploads:     ~/domains/test.orgsledger.com/OrgsLedger/apps/api/uploads/
```
