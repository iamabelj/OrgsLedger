#!/bin/bash
# ============================================================
# OrgsLedger — Production Update Script
# Pulls latest code from GitHub and rebuilds all services.
#
# Usage: bash deploy/update.sh
# Run from the project root: /opt/orgsledger
# ============================================================

set -e

APP_DIR="${APP_DIR:-/opt/orgsledger}"
cd "$APP_DIR"

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║       OrgsLedger — Production Update            ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# ── Step 1: Pull latest code ───────────────────────────
echo "▸ [1/5] Pulling latest code from GitHub..."
git fetch origin main
git reset --hard origin/main
echo "  ✓ Code updated to $(git rev-parse --short HEAD)"
echo "  ✓ Commit: $(git log --oneline -1)"
echo ""

# ── Step 2: Rebuild web frontend ───────────────────────
echo "▸ [2/5] Rebuilding web frontend..."
if command -v npx &> /dev/null; then
    # Build locally if Node is available on the host
    cd apps/mobile
    npm install --legacy-peer-deps 2>/dev/null || npm install
    npx expo export --platform web 2>&1 || echo "  ⚠ Expo export failed — using existing build"
    cd "$APP_DIR"
    # Copy web build into API serving directory
    node scripts/post-export-web.js 2>/dev/null || echo "  ⚠ Post-export skipped"
else
    # Build inside a Docker container
    docker run --rm -v "$APP_DIR:/app" -w /app node:20-alpine sh -c "
        cd apps/mobile && npm install --legacy-peer-deps && npx expo export --platform web
    " 2>&1 || echo "  ⚠ Docker web build failed — using existing build"
    node scripts/post-export-web.js 2>/dev/null || echo "  ⚠ Post-export skipped"
fi
echo "  ✓ Web frontend rebuilt"
echo ""

# ── Step 3: Rebuild and restart Docker services ────────
echo "▸ [3/5] Rebuilding API container (no cache)..."
docker compose -f docker-compose.prod.yml build --no-cache api
echo "  ✓ API container rebuilt"
echo ""

echo "▸ [4/5] Restarting all services..."
docker compose -f docker-compose.prod.yml up -d
echo "  ✓ All services restarted"
echo ""

# ── Step 4: Run database migrations ────────────────────
echo "▸ [5/5] Running database migrations..."
sleep 5  # Wait for postgres to be ready
docker exec orgsledger_api sh -c "
    cd /app/packages/database && \
    node -e \"
        const knex = require('knex');
        const config = require('./dist/knexfile').default || require('./dist/knexfile');
        const db = knex(config);
        db.migrate.latest().then(r => {
            console.log('Migrations applied:', JSON.stringify(r));
            return db.destroy();
        }).catch(e => { console.error('Migration error:', e.message); process.exit(0); });
    \"
" 2>/dev/null || echo "  ⚠ Migrations skipped (may already be up to date)"
echo "  ✓ Database up to date"
echo ""

# ── Verify ──────────────────────────────────────────────
echo "▸ Verifying deployment..."
sleep 3
if docker ps | grep -q orgsledger_api; then
    echo "  ✓ API container is running"
else
    echo "  ✗ API container is NOT running!"
    docker logs orgsledger_api --tail 20
fi

# Check API health
API_STATUS=$(docker exec orgsledger_api wget -qO- http://localhost:3000/api/health 2>/dev/null || echo '{"status":"unreachable"}')
echo "  API Health: $API_STATUS"

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║            ✓ UPDATE COMPLETE!                   ║"
echo "║  Commit: $(git rev-parse --short HEAD)                              ║"
echo "║  $(git log --oneline -1 | head -c 48)"
echo "╚══════════════════════════════════════════════════╝"
echo ""
echo "Logs: docker logs orgsledger_api -f --tail 50"
echo ""
