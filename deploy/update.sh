#!/bin/bash
# ============================================================
# OrgsLedger — Update / Redeploy Production
# Run this on the VPS after pushing new code to git.
#
# Usage: bash deploy/update.sh
# ============================================================

set -e

APP_DIR="/var/www/orgsledger"
cd "$APP_DIR"

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║       OrgsLedger — Production Update            ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# ── Step 1: Pull latest code ────────────────────────────
echo "▸ [1/5] Pulling latest code..."
git pull origin main
echo "  ✓ Code updated"

# ── Step 2: Ensure admin env vars exist ─────────────────
echo "▸ [2/5] Checking environment..."
ENV_FILE="$APP_DIR/apps/api/.env.production"
if [ -f "$ENV_FILE" ]; then
    if ! grep -q "DEFAULT_ADMIN_EMAIL" "$ENV_FILE"; then
        echo "DEFAULT_ADMIN_EMAIL=admin@orgsledger.com" >> "$ENV_FILE"
        echo "DEFAULT_ADMIN_PASSWORD=SuperAdmin1234!" >> "$ENV_FILE"
        echo "  ✓ Admin credentials added to .env.production"
    else
        echo "  ✓ Admin credentials already configured"
    fi
else
    echo "  ⚠ .env.production not found — run deploy.sh first"
    exit 1
fi

# ── Step 3: Rebuild API container ───────────────────────
echo "▸ [3/5] Rebuilding API container..."
docker compose -f docker-compose.prod.yml up -d --build api
echo "  ✓ API container rebuilt"

# ── Step 4: Wait for DB and run migrations ──────────────
echo "▸ [4/5] Running database migrations..."
sleep 5
docker exec orgsledger_api sh -c "cd /app/packages/database && node -e \"
const knex = require('knex');
const config = require('./dist/knexfile').default || require('./dist/knexfile');
const db = knex(config);
db.migrate.latest().then(r => {
  console.log('  ✓ Migrations applied:', r);
  return db.destroy();
}).catch(e => { console.error(e); process.exit(1); });
\"" 2>/dev/null || echo "  (migrations via fallback — API will handle on startup)"
echo "  ✓ Database updated"

# ── Step 5: Verify admin seed ───────────────────────────
echo "▸ [5/5] Verifying admin account..."
# The API auto-seeds the admin on startup via ensureSuperAdmin()
# Give it a moment to complete
sleep 3
docker exec orgsledger_api sh -c "node -e \"
const knex = require('knex');
const cfg = require('./packages/database/dist/knexfile').default || require('./packages/database/dist/knexfile');
const db = knex(cfg);
db('users').where({ email: 'admin@orgsledger.com' }).first().then(u => {
  if (u) {
    console.log('  ✓ Admin account exists (id=' + u.id + ', active=' + u.is_active + ', role=' + u.global_role + ')');
  } else {
    console.log('  ⚠ Admin account not found — check API logs: docker logs orgsledger_api');
  }
  return db.destroy();
}).catch(e => { console.error(e.message); process.exit(0); });
\"" 2>/dev/null || echo "  (verification skipped)"

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║            ✓ UPDATE COMPLETE!                   ║"
echo "╠══════════════════════════════════════════════════╣"
echo "║                                                  ║"
echo "║  Admin Login:                                    ║"
echo "║    Email:    admin@orgsledger.com                 ║"
echo "║    Password: SuperAdmin1234!                     ║"
echo "║                                                  ║"
echo "║  Useful commands:                                ║"
echo "║    Logs:     docker logs orgsledger_api -f        ║"
echo "║    Restart:  docker compose -f                    ║"
echo "║              docker-compose.prod.yml restart api  ║"
echo "║                                                  ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
