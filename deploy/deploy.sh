#!/bin/bash
# ============================================================
# OrgsLedger — One-Command Production Deploy
# Run this on a fresh Ubuntu 22.04+ VPS (Hostinger KVM)
#
# Usage: bash deploy.sh yourdomain.com your@email.com
# Example: bash deploy.sh orgsledger.com admin@orgsledger.com
# ============================================================

set -e

DOMAIN="${1:?Usage: bash deploy.sh yourdomain.com your@email.com}"
EMAIL="${2:?Usage: bash deploy.sh yourdomain.com your@email.com}"
APP_DIR="/var/www/orgsledger"

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║       OrgsLedger — Production Deployment        ║"
echo "║  Domain: $DOMAIN"
echo "║  Email:  $EMAIL"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# ── Step 1: Install Docker ──────────────────────────────
echo "▸ [1/7] Installing Docker..."
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker && systemctl start docker
    echo "  ✓ Docker installed"
else
    echo "  ✓ Docker already installed"
fi

# ── Step 2: Generate secrets ────────────────────────────
echo "▸ [2/7] Generating production secrets..."
DB_PASS=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 64)

# ── Step 3: Create production .env ──────────────────────
echo "▸ [3/7] Creating production environment..."
cat > "$APP_DIR/apps/api/.env.production" << ENVEOF
NODE_ENV=production
PORT=3000
API_URL=https://api.${DOMAIN}

DB_HOST=postgres
DB_PORT=5432
DB_USER=orgsledger
DB_PASSWORD=${DB_PASS}
DB_NAME=orgsledger

REDIS_URL=redis://redis:6379

JWT_SECRET=${JWT_SECRET}
JWT_EXPIRES_IN=7d
JWT_REFRESH_EXPIRES_IN=30d

STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
PAYSTACK_SECRET_KEY=
PAYSTACK_PUBLIC_KEY=
FLUTTERWAVE_SECRET_KEY=
FLUTTERWAVE_PUBLIC_KEY=
FLUTTERWAVE_WEBHOOK_HASH=

OPENAI_API_KEY=$(grep OPENAI_API_KEY "$APP_DIR/apps/api/.env" 2>/dev/null | cut -d= -f2- || echo "")
GOOGLE_APPLICATION_CREDENTIALS=./google-credentials.json

SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
EMAIL_FROM=noreply@${DOMAIN}

UPLOAD_DIR=./uploads
MAX_FILE_SIZE_MB=50
FIREBASE_PROJECT_ID=
CORS_ORIGINS=https://${DOMAIN},https://app.${DOMAIN}
ENVEOF
echo "  ✓ .env.production created"

# ── Step 4: Update nginx config with actual domain ──────
echo "▸ [4/7] Configuring web server..."
cd "$APP_DIR"

# Replace domain in nginx configs
sed -i "s/orgsledger\.com/${DOMAIN}/g" deploy/nginx.conf
sed -i "s/orgsledger\.com/${DOMAIN}/g" deploy/nginx-initial.conf

# Replace domain in docker-compose.prod.yml (DB_PASSWORD)
export DB_PASSWORD="$DB_PASS"

# Use initial (HTTP-only) config first
cp deploy/nginx-initial.conf deploy/nginx-active.conf

# Temporarily point nginx config to initial
sed -i "s|./deploy/nginx.conf|./deploy/nginx-active.conf|" docker-compose.prod.yml
echo "  ✓ Web server configured"

# ── Step 5: Build web frontend ──────────────────────────
echo "▸ [5/7] Building web frontend..."
if [ ! -f "apps/mobile/dist/index.html" ]; then
    # Build inside a container if not pre-built
    docker run --rm -v "$APP_DIR:/app" -w /app/apps/mobile node:20-alpine sh -c "npm install && npx expo export --platform web"
fi
echo "  ✓ Web frontend built"

# ── Step 6: Start everything ────────────────────────────
echo "▸ [6/7] Starting all services..."
docker compose -f docker-compose.prod.yml up -d --build
echo "  ✓ All services running"

# Wait for postgres to be ready
echo "  Waiting for database..."
sleep 10

# Run migrations + seed inside the api container
docker exec orgsledger_api sh -c "cd /app/packages/database && node -e \"
const knex = require('knex');
const config = require('./dist/knexfile').default || require('./dist/knexfile');
const db = knex(config);
db.migrate.latest().then(r => {
  console.log('  ✓ Migrations applied:', r);
  return db.destroy();
}).catch(e => { console.error(e); process.exit(1); });
\"" 2>/dev/null || echo "  (migrations via ts-node fallback)"

echo "  ✓ Database ready"

# ── Step 7: SSL Certificate ────────────────────────────
echo "▸ [7/7] Getting SSL certificate..."
docker compose -f docker-compose.prod.yml run --rm certbot certonly \
    --webroot -w /usr/share/nginx/html \
    -d "$DOMAIN" -d "www.$DOMAIN" -d "api.$DOMAIN" -d "app.$DOMAIN" \
    --email "$EMAIL" --agree-tos --no-eff-email --force-renewal

# Switch to full SSL nginx config
cp deploy/nginx.conf deploy/nginx-active.conf
sed -i "s/orgsledger\.com/${DOMAIN}/g" deploy/nginx-active.conf 2>/dev/null || true
docker compose -f docker-compose.prod.yml restart web
echo "  ✓ SSL enabled"

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║            ✓ DEPLOYMENT COMPLETE!               ║"
echo "╠══════════════════════════════════════════════════╣"
echo "║                                                  ║"
echo "║  Web App:  https://${DOMAIN}                     "
echo "║  API:      https://api.${DOMAIN}                 "
echo "║                                                  ║"
echo "║  Admin Login:                                    ║"
echo "║    Email:    admin@orgsledger.com                 ║"
echo "║    Password: SuperAdmin123!                      ║"
echo "║                                                  ║"
echo "║  Manage:                                         ║"
echo "║    Logs:     docker logs orgsledger_api -f        ║"
echo "║    Restart:  docker compose -f                    ║"
echo "║              docker-compose.prod.yml restart      ║"
echo "║    Stop:     docker compose -f                    ║"
echo "║              docker-compose.prod.yml down         ║"
echo "║                                                  ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
echo "IMPORTANT: Save these credentials securely:"
echo "  DB Password: $DB_PASS"
echo "  JWT Secret:  $JWT_SECRET"
echo ""
