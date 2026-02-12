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

# 5. Build web frontend
echo "🌐 Building web frontend..."
cd apps/mobile && npx expo export --platform web && cd ../..

echo ""
echo "✅ Build complete!"
echo "   API:  apps/api/dist/"
echo "   Web:  apps/mobile/dist/"
echo ""
echo "Next: Upload to Hostinger (see DEPLOY.md)"
