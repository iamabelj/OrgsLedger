#!/usr/bin/env node
// ============================================================
// Post-export script: patches Expo web export into apps/api/web
// Usage: node scripts/post-export-web.js
// ============================================================

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'apps', 'mobile', 'dist');
const WEB  = path.join(ROOT, 'apps', 'api', 'web');

// 1. Clear old web build
fs.rmSync(WEB, { recursive: true, force: true });
fs.mkdirSync(WEB, { recursive: true });

// 2. Copy dist → web
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}
copyDir(DIST, WEB);

// 3. Copy logo files
fs.copyFileSync(
  path.join(ROOT, 'apps', 'mobile', 'assets', 'logo-no-bg.png'),
  path.join(WEB, 'logo-192.png')
);
fs.copyFileSync(
  path.join(ROOT, 'apps', 'mobile', 'assets', 'logo.png'),
  path.join(WEB, 'logo-512.png')
);

// 4. Patch index.html — add favicon, meta tags, SEO
const htmlPath = path.join(WEB, 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');

// Replace title
html = html.replace(
  '<title>OrgsLedger</title>',
  `<title>OrgsLedger — Organization Management Platform</title>
    <meta name="description" content="Manage your organization's members, finances, meetings, and communications in one place." />
    <meta name="theme-color" content="#0B1426" />
    <link rel="icon" type="image/png" sizes="192x192" href="/logo-192.png" />
    <link rel="icon" type="image/png" sizes="512x512" href="/logo-512.png" />
    <link rel="apple-touch-icon" href="/logo-192.png" />
    <link rel="shortcut icon" href="/favicon.ico" />
    <meta property="og:title" content="OrgsLedger" />
    <meta property="og:description" content="Cross-Border Organizational Infrastructure — manage members, finances & meetings." />
    <meta property="og:image" content="/logo-512.png" />
    <meta property="og:type" content="website" />`
);

// Remove Expo's default favicon link if it was injected separately
html = html.replace(/<link rel="shortcut icon" href="\/favicon\.ico" \/>/g, '');
// Remove duplicate if our injection already added it
html = html.replace(/(<link rel="shortcut icon" href="\/favicon\.ico" \/>)\s*\1/g, '$1');

fs.writeFileSync(htmlPath, html);
console.log('✓ Web build patched: favicon, meta tags, logo assets');
