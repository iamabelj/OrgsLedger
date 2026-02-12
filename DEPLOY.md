# OrgsLedger — Deployment Guide

> **Database:** Neon.tech (PostgreSQL, free tier)
> **App Server:** Hostinger Cloud VPS (Ubuntu + Docker)
> **App URL:** `test.orgsledger.com`
> **Sales Page:** `orgsledger.com`

---

## Architecture

```
┌──────────────┐        ┌──────────────────────────┐        ┌──────────────────┐
│   Browser    │───────▶│   Hostinger Cloud VPS    │───────▶│    Neon.tech      │
│   (Users)    │        │                          │        │    PostgreSQL     │
└──────────────┘        │  Nginx (SSL/proxy)       │        │    (Serverless)   │
                        │    ├── Static web files   │        │                  │
                        │    └── API (Node.js:3000) │        │  AWS us-east-1   │
                        └──────────────────────────┘        └──────────────────┘
```

| Component       | Service           | Cost                  |
|-----------------|-------------------|-----------------------|
| Database        | Neon.tech (free)  | $0 (0.5 GB storage)   |
| App Server      | Hostinger KVM VPS | ~$5–10/mo             |
| Domain + SSL    | Let's Encrypt     | Free                  |

---

## Part 1 — Neon.tech Database Setup

### 1.1 Create Project

1. Go to [neon.tech](https://neon.tech) → Sign in
2. Click **"New Project"**
3. Fill in:

   | Setting              | Value                    |
   |----------------------|--------------------------|
   | **Project name**     | `orgsledger`             |
   | **Cloud provider**   | **AWS** ← pick this      |
   | **Region**           | Closest to your VPS (see below) |
   | **PostgreSQL version** | **16**                 |

   **Region guide — pick the one nearest your Hostinger VPS:**
   - US East → `AWS us-east-1` (N. Virginia)
   - US West → `AWS us-west-2` (Oregon)
   - Europe  → `AWS eu-central-1` (Frankfurt)
   - Asia    → `AWS ap-southeast-1` (Singapore)

4. Click **"Create Project"**

### 1.2 Copy Connection String

After project creation, Neon shows your connection details:

```
postgresql://orgsledger_owner:AbCdEfGh1234@ep-cool-sun-123456.us-east-1.aws.neon.tech/orgsledger?sslmode=require
```

**Save this string — it is your `DATABASE_URL`.**

To find it later: Dashboard → Your project → **Connection Details** (sidebar) → copy the URI.

### 1.3 Neon.tech Tips

- **Auto-suspend:** Free tier pauses compute after 5 min idle. First request after sleep takes ~1 second to wake. This is normal.
- **Connection pooling:** Enabled by default. If you hit "too many connections," use the **Pooled connection** string (has `-pooler` in the hostname).
- **IP Allow List:** By default all IPs are allowed. No changes needed.
- **Branching:** You can create a `dev` branch for testing without affecting production data.

---

## Part 2 — Run Migrations (Local Machine)

Before deploying, set up the database schema from your local machine.

### Windows (PowerShell)

```powershell
# Set connection string (paste yours from Neon)
$env:DATABASE_URL = "postgresql://orgsledger_owner:xxxx@ep-xxxxx.us-east-1.aws.neon.tech/orgsledger?sslmode=require"

# Run migrations
cd packages\database
npx ts-node src/migrate.ts

# Seed initial data (admin user, sample org, plans)
npx ts-node src/seed.ts
```

### Mac / Linux

```bash
export DATABASE_URL="postgresql://orgsledger_owner:xxxx@ep-xxxxx.us-east-1.aws.neon.tech/orgsledger?sslmode=require"

cd packages/database
npx ts-node src/migrate.ts
npx ts-node src/seed.ts
```

You should see:
```
✓ Migrations complete
✓ Seed complete
```

Verify in Neon dashboard → **Tables** tab → you should see all tables populated.

---

## Part 3 — Build for Production

### 3.1 Build Everything

```powershell
# From OrgsLedger root
npm install

# Build packages
cd packages\shared; npx tsc; cd ..\..
cd packages\database; npx tsc; cd ..\..

# Build API
cd apps\api; npx tsc; cd ..\..

# Build web frontend
cd apps\mobile; npx expo export --platform web; cd ..\..
```

Or run the script:
```bash
bash deploy/build-production.sh
```

Output:
- `apps/api/dist/` — compiled Node.js API
- `apps/mobile/dist/` — static web frontend (HTML/JS/CSS)

### 3.2 Push to GitHub

```powershell
git add -A
git commit -m "Production build ready"
git push origin main
```

---

## Part 4 — Create .env.production

Create `apps/api/.env.production` with your values:

```env
NODE_ENV=production
PORT=3000

# ── Neon.tech Database ──────────────────────────────
DATABASE_URL=postgresql://orgsledger_owner:xxxx@ep-xxxxx.us-east-1.aws.neon.tech/orgsledger?sslmode=require

# ── JWT (REQUIRED — generate your own!) ─────────────
# Generate: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
JWT_SECRET=PASTE_YOUR_GENERATED_SECRET_HERE
JWT_EXPIRES_IN=7d
JWT_REFRESH_EXPIRES_IN=30d

# ── Payment Gateways (add when ready) ───────────────
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
PAYSTACK_SECRET_KEY=
PAYSTACK_PUBLIC_KEY=
FLUTTERWAVE_SECRET_KEY=
FLUTTERWAVE_PUBLIC_KEY=
FLUTTERWAVE_WEBHOOK_HASH=

# ── AI (Optional) ───────────────────────────────────
OPENAI_API_KEY=
GOOGLE_APPLICATION_CREDENTIALS=./google-credentials.json

# ── Email SMTP (Optional) ───────────────────────────
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
EMAIL_FROM=noreply@orgsledger.com

# ── File Uploads ─────────────────────────────────────
UPLOAD_DIR=./uploads
MAX_FILE_SIZE_MB=50

# ── Push Notifications (Optional) ───────────────────
FIREBASE_PROJECT_ID=

# ── CORS ─────────────────────────────────────────────
CORS_ORIGINS=https://test.orgsledger.com,https://orgsledger.com
```

> **Important:** Do NOT commit this file to Git! Add `apps/api/.env.production` to `.gitignore`.

---

## Part 5 — Deploy to Hostinger Cloud VPS

### 5.1 Get a VPS

1. Go to [hostinger.com](https://hostinger.com) → **VPS Hosting**
2. Choose **KVM 1** plan or higher (minimum 1 GB RAM, 1 vCPU)
3. Select OS: **Ubuntu 22.04**
4. Note your **VPS IP address** from the dashboard
5. Set up SSH:
   ```bash
   ssh root@YOUR_VPS_IP
   ```

### 5.2 Point Domain to VPS

In your domain's DNS settings (Hostinger hPanel or your registrar):

| Type | Name   | Value       | TTL  |
|------|--------|-------------|------|
| A    | test   | YOUR_VPS_IP | 3600 |
| A    | @      | YOUR_VPS_IP | 3600 |
| A    | www    | YOUR_VPS_IP | 3600 |

Wait 5–10 min for DNS propagation. Verify: `ping test.orgsledger.com`

### 5.3 Deploy with Docker (Recommended)

SSH into your VPS and run:

```bash
# Clone the repo
cd /var/www
git clone https://github.com/YOUR_USERNAME/OrgsLedger.git orgsledger
cd orgsledger

# Copy your .env.production file (or create it on the server)
nano apps/api/.env.production
# Paste your env vars from Part 4, save with Ctrl+X → Y → Enter

# Deploy everything with one command
bash deploy/deploy.sh test.orgsledger.com your@email.com
```

The script handles: Docker install → build → Nginx → SSL → start all services.

**Since you use Neon.tech** (not Docker Postgres), edit `.env.production` on the server:

```bash
nano /var/www/orgsledger/apps/api/.env.production
```

Make sure `DATABASE_URL` points to Neon.tech (not local postgres), then:

```bash
# Restart API to use Neon.tech
docker compose -f docker-compose.prod.yml restart api

# Optionally stop the Docker postgres container (not needed with Neon)
docker stop orgsledger_db
```

### 5.4 Deploy without Docker (PM2 + Nginx)

If you prefer running Node.js directly:

```bash
# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git nginx certbot python3-certbot-nginx

# Install PM2
sudo npm install -g pm2

# Clone & build
cd /var/www
git clone https://github.com/YOUR_USERNAME/OrgsLedger.git orgsledger
cd orgsledger
npm install
bash deploy/build-production.sh

# Copy env
cp apps/api/.env.production apps/api/.env

# Start API with PM2
cd apps/api
pm2 start dist/index.js --name orgsledger-api
pm2 save
pm2 startup    # auto-start on reboot
cd ../..

# Configure Nginx
sudo tee /etc/nginx/sites-available/orgsledger << 'NGINX'
server {
    listen 80;
    server_name test.orgsledger.com;

    # API
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
        client_max_body_size 200M;
    }

    # Health check
    location /health {
        proxy_pass http://127.0.0.1:3000;
    }

    # Uploads
    location /uploads/ {
        proxy_pass http://127.0.0.1:3000;
    }

    # Web frontend (static)
    location / {
        root /var/www/orgsledger/apps/mobile/dist;
        index index.html;
        try_files $uri $uri/ /index.html;
    }

    # Cache static assets
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot|map)$ {
        root /var/www/orgsledger/apps/mobile/dist;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
NGINX

sudo ln -sf /etc/nginx/sites-available/orgsledger /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl restart nginx

# Get SSL certificate
sudo certbot --nginx -d test.orgsledger.com --agree-tos -m your@email.com --non-interactive
```

---

## Part 6 — Verify Deployment

### Health Check

```bash
curl https://test.orgsledger.com/health
```

Expected:
```json
{"status":"ok","version":"1.0.0","timestamp":"...","uptime":123}
```

### Open in Browser

Go to `https://test.orgsledger.com` → you should see the login page.

### Default Login

```
Email:    admin@orgsledger.com
Password: SuperAdmin123!
```

**Change the password immediately!**

---

## Part 7 — Landing Page (orgsledger.com)

The sales page at `landing/index.html` goes on the main domain. Add this Nginx config:

```bash
sudo tee /etc/nginx/sites-available/landing << 'NGINX'
server {
    listen 80;
    server_name orgsledger.com www.orgsledger.com;

    root /var/www/orgsledger/landing;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
NGINX

sudo ln -sf /etc/nginx/sites-available/landing /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl restart nginx
sudo certbot --nginx -d orgsledger.com -d www.orgsledger.com --agree-tos -m your@email.com --non-interactive
```

---

## Part 8 — Maintenance

### Update the App

```bash
cd /var/www/orgsledger
git pull origin main
bash deploy/build-production.sh

# Run new migrations (if any)
cd packages/database
DATABASE_URL="your_neon_connection_string" npx ts-node src/migrate.ts
cd ../..

# Restart
pm2 restart orgsledger-api
# or with Docker:
docker compose -f docker-compose.prod.yml restart api
```

### Monitor

```bash
# PM2
pm2 status
pm2 logs orgsledger-api

# Docker
docker logs orgsledger_api -f

# Neon.tech
# Dashboard → Monitoring → check connections, queries, storage
```

### SSL Renewal

Let's Encrypt certificates auto-renew. Verify:
```bash
sudo certbot renew --dry-run
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| **"Database connection failed"** | Check `DATABASE_URL` in `.env` — Neon free tier sleeps after 5 min, first request takes ~1s to wake |
| **CORS error in browser** | Add domain to `CORS_ORIGINS` in `.env`, restart API |
| **502 Bad Gateway** | API crashed — check `pm2 logs` or `docker logs orgsledger_api` |
| **Blank page on web** | Rebuild web: `cd apps/mobile && npx expo export --platform web` |
| **"Too many connections"** | Use Neon's pooled connection string (check "Pooled" in dashboard) |
| **SSL error** | Run `sudo certbot --nginx -d test.orgsledger.com` |
| **JWT error in production** | Make sure `JWT_SECRET` is set (not the default) |
| **Uploads not working** | Ensure `uploads/` directory exists with write permissions |

---

## Quick Reference

```
Production URLs:
  App:      https://test.orgsledger.com
  API:      https://test.orgsledger.com/api
  Health:   https://test.orgsledger.com/health
  Landing:  https://orgsledger.com

Neon.tech Dashboard:
  https://console.neon.tech

Default Login:
  admin@orgsledger.com / SuperAdmin123!

Key Files:
  .env.production      → apps/api/.env.production
  API build            → apps/api/dist/
  Web build            → apps/mobile/dist/
  Nginx config         → /etc/nginx/sites-available/orgsledger
  PM2 config           → pm2 show orgsledger-api
```
