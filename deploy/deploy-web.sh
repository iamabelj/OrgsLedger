#!/bin/bash
set -e

echo "=== OrgsLedger Web Deploy ==="

# 1. Pull latest code
echo "[1/7] Pulling latest code..."
cd ~/OrgsLedger
git checkout -- .
git pull origin main

# 2. Install mobile app dependencies
echo "[2/7] Installing mobile app dependencies..."
cd ~/OrgsLedger/apps/mobile
npm install

# 3. Clear old build cache and rebuild
echo "[3/7] Rebuilding Expo web app (with baseUrl=/app)..."
rm -rf dist .expo
npx expo export --platform web

# 4. Verify the build has correct baseUrl
echo "[4/7] Verifying build..."
if grep -q '/_expo/' dist/index.html 2>/dev/null; then
  echo "WARNING: Build still references /_expo/ (absolute). baseUrl may not have taken effect."
  echo "Contents of index.html script tags:"
  grep -o 'src="[^"]*"' dist/index.html
fi
if grep -q '/app/_expo/' dist/index.html 2>/dev/null; then
  echo "OK: Build correctly references /app/_expo/"
fi

# 5. Post-process (add favicon, meta tags)
echo "[5/7] Post-processing..."
cd ~/OrgsLedger
node scripts/post-export-web.js

# 6. Deploy to web directory
echo "[6/7] Copying files to /var/www/orgsledger.com/..."
rm -rf /var/www/orgsledger.com/app/*
cp -r apps/api/web/* /var/www/orgsledger.com/app/
cp landing/*.html /var/www/orgsledger.com/

# 7. Update nginx and reload services
echo "[7/7] Updating nginx and reloading services..."
cp deploy/nginx-orgsledger.conf /etc/nginx/sites-available/orgsledger.com
nginx -t && systemctl reload nginx
pm2 reload orgsledger-api

echo ""
echo "=== Deploy complete ==="
echo "Test these URLs:"
echo "  https://orgsledger.com/app/login    (should show login page)"
echo "  https://orgsledger.com/developer/login (should show developer console)"
echo "  https://orgsledger.com/login        (should redirect to /)"
