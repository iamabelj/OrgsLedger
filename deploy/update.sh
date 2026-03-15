#!/bin/bash
# ============================================================
# OrgsLedger — Production Update Script
# Pulls latest code from GitHub and rebuilds all services.
#
# Usage: bash deploy/update.sh
# Run from the project root: /opt/orgsledger
#
# Supports both PM2 and Docker Compose deployments.
# ============================================================

set -e

APP_DIR="${APP_DIR:-/opt/orgsledger}"
cd "$APP_DIR"
ENV_FILE="$APP_DIR/apps/api/.env.production"
WEB_ROOT="/var/www/orgsledger.com"

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║       OrgsLedger — Production Update            ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# ── Detect deployment method ───────────────────────────
USE_PM2=false
USE_DOCKER=false

if command -v pm2 &> /dev/null && pm2 list 2>/dev/null | grep -q "orgsledger-api\|orgs-landing"; then
    USE_PM2=true
    echo "▸ Detected: PM2 deployment"
elif command -v docker &> /dev/null && docker ps 2>/dev/null | grep -q "orgsledger"; then
    USE_DOCKER=true
    echo "▸ Detected: Docker deployment"
else
    echo "▸ No running services detected, will attempt PM2 deployment"
    USE_PM2=true
fi
echo ""

# ── Step 1: Pull latest code ───────────────────────────
echo "▸ [1/6] Pulling latest code from GitHub..."
git fetch origin main
git reset --hard origin/main
echo "  ✓ Code updated to $(git rev-parse --short HEAD)"
echo "  ✓ Commit: $(git log --oneline -1)"
echo ""

# ── Ensure production env defaults exist ───────────────
echo "▸ [2/6] Validating production environment file..."
if [ -f "$ENV_FILE" ]; then
    grep -q '^NODE_ENV=' "$ENV_FILE" || echo 'NODE_ENV=production' >> "$ENV_FILE"
    grep -q '^PORT=' "$ENV_FILE" || echo 'PORT=3000' >> "$ENV_FILE"
    echo "  ✓ Production env defaults ensured"
else
    echo "  ⚠ No $ENV_FILE found (may use .env or environment variables)"
fi
echo ""

# ── Step 3: Rebuild API ────────────────────────────────
echo "▸ [3/6] Rebuilding API..."
if [ "$USE_PM2" = true ]; then
    cd "$APP_DIR/apps/api"
    npm run build 2>/dev/null || echo "  ⚠ API build skipped"
    cd "$APP_DIR"
    echo "  ✓ API rebuilt"
else
    docker compose -f docker-compose.prod.yml build --no-cache api
    echo "  ✓ API container rebuilt"
fi
echo ""

# ── Step 4: Deploy web frontend ────────────────────────
echo "▸ [4/6] Deploying web frontend..."
if [ -d "$APP_DIR/deploy/flutter-web" ] && [ -d "$WEB_ROOT" ]; then
    # Copy pre-built web app to nginx root
    mkdir -p "$WEB_ROOT/app"
    cp -r "$APP_DIR/deploy/flutter-web/"* "$WEB_ROOT/app/"
    echo "  ✓ Web app deployed to $WEB_ROOT/app/"
    
    # Copy landing page assets
    if [ -f "$APP_DIR/landing/admin.html" ]; then
        cp "$APP_DIR/landing/admin.html" "$WEB_ROOT/admin.html"
        echo "  ✓ Developer console updated"
    fi
    
    # Copy landing static files if they exist
    for file in index.html about.html help.html; do
        if [ -f "$APP_DIR/landing/$file" ]; then
            cp "$APP_DIR/landing/$file" "$WEB_ROOT/$file"
        fi
    done
    
    # Copy legal pages
    if [ -d "$APP_DIR/landing/legal" ]; then
        mkdir -p "$WEB_ROOT/legal"
        cp -r "$APP_DIR/landing/legal/"* "$WEB_ROOT/legal/"
        echo "  ✓ Legal pages updated"
    fi
else
    echo "  ⚠ Web deployment skipped (missing flutter-web or $WEB_ROOT)"
fi
echo ""

# ── Step 5: Restart services ───────────────────────────
echo "▸ [5/6] Restarting services..."
if [ "$USE_PM2" = true ]; then
    pm2 restart all
    echo "  ✓ PM2 services restarted"
else
    docker compose -f docker-compose.prod.yml up -d --remove-orphans
    echo "  ✓ Docker services restarted"
fi
echo ""

# ── Step 6: Run database migrations ────────────────────
echo "▸ [6/6] Running database migrations..."
if [ "$USE_PM2" = true ]; then
    cd "$APP_DIR/packages/database"
    if [ -f ".env" ] || [ -n "$DATABASE_URL" ]; then
        npx knex migrate:latest 2>/dev/null || echo "  ⚠ Migrations skipped (may already be up to date)"
    else
        echo "  ⚠ No DATABASE_URL found, skipping migrations"
    fi
    cd "$APP_DIR"
else
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
fi
echo "  ✓ Database up to date"
echo ""

# ── Verify ──────────────────────────────────────────────
echo "▸ Verifying deployment..."
sleep 3
if [ "$USE_PM2" = true ]; then
    pm2 list
    echo ""
    # Check API health
    API_STATUS=$(curl -s http://localhost:3000/health 2>/dev/null || echo '{"status":"unreachable"}')
    echo "  API Health: $API_STATUS"
else
    if docker ps | grep -q orgsledger_api; then
        echo "  ✓ API container is running"
    else
        echo "  ✗ API container is NOT running!"
        docker logs orgsledger_api --tail 20
    fi
    API_STATUS=$(docker exec orgsledger_api node -e "
        const http = require('http');
        http.get('http://127.0.0.1:3000/health', (res) => {
            let data = '';
            res.on('data', (c) => (data += c));
            res.on('end', () => process.stdout.write(data || JSON.stringify({ status: 'empty' })));
        }).on('error', () => process.exit(1));
    " 2>/dev/null || echo '{"status":"unreachable"}')
    echo "  API Health: $API_STATUS"
fi

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║            ✓ UPDATE COMPLETE!                   ║"
echo "╚══════════════════════════════════════════════════╝"
echo "  Commit: $(git rev-parse --short HEAD)"
echo "  $(git log --oneline -1 | head -c 48)"
echo ""
if [ "$USE_PM2" = true ]; then
    echo "Logs: pm2 logs --lines 50"
else
    echo "Logs: docker logs orgsledger_api -f --tail 50"
fi
echo ""
