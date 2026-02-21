#!/bin/bash
# ============================================================
# OrgsLedger — Production Build Script
# Run this locally before uploading to Hostinger
# ============================================================

set -e

echo "🔨 Building OrgsLedger for production..."

# 1. Install dependencies
echo "📦 Installing dependencies..."
npm install

# 2. Build shared package
echo "📦 Building shared package..."
cd packages/shared && npx tsc && cd ../..

# 3. Build database package
echo "📦 Building database package..."
cd packages/database && npx tsc && cd ../..

# 4. Build API
echo "🚀 Building API..."
cd apps/api && npx tsc && cd ../..

# 5. Install landing (gateway) dependencies
echo "📦 Installing landing gateway dependencies..."
cd landing && npm install --omit=dev && cd ..

# 6. Build web frontend
echo "🌐 Installing mobile dependencies..."
cd apps/mobile && npm install
echo "🌐 Building web frontend..."
npx expo export --platform web && cd ../..

# 7. Copy web build into API serving directory
echo "📋 Copying web build to API web directory..."
node scripts/post-export-web.js

echo ""
echo "✅ Build complete!"
echo "   API:      apps/api/dist/"
echo "   Web:      apps/api/web/ (copied from apps/mobile/dist/)"
echo "   Landing:  landing/ (gateway + admin console)"
echo ""
echo "Next: Upload to Hostinger (see DEPLOY.md)"
