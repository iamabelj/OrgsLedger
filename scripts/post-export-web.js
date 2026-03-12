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

const STALE_SERVICE_WORKER_CLEANUP = `
    <script>
      (function () {
        if (!('serviceWorker' in navigator)) {
          return;
        }

        window.addEventListener('load', function () {
          navigator.serviceWorker.getRegistrations().then(function (registrations) {
            registrations.forEach(function (registration) {
              var activeUrl = registration.active && registration.active.scriptURL ? registration.active.scriptURL : '';
              if (registration.scope.indexOf('/app') !== -1 || activeUrl.indexOf('flutter_service_worker') !== -1) {
                registration.unregister().catch(function () {});
              }
            });
          }).catch(function () {});

          if ('caches' in window) {
            caches.keys().then(function (keys) {
              return Promise.all(
                keys
                  .filter(function (key) {
                    return key.indexOf('flutter') !== -1 || key.indexOf('workbox') !== -1;
                  })
                  .map(function (key) {
                    return caches.delete(key);
                  })
              );
            }).catch(function () {});
          }
        });
      })();
    </script>`;

const APP_PATH_CANONICALIZER = `
    <script>
      (function () {
        var bareAppRoutes = new Set([
          '/login',
          '/register',
          '/forgot-password',
          '/admin-register',
          '/home',
          '/activate'
        ]);

        function normalizePath(urlLike) {
          try {
            var parsed = new URL(urlLike, window.location.origin);
            if (bareAppRoutes.has(parsed.pathname)) {
              parsed.pathname = '/app' + parsed.pathname;
              return parsed.pathname + parsed.search + parsed.hash;
            }
          } catch (_) {}

          return urlLike;
        }

        if (bareAppRoutes.has(window.location.pathname)) {
          window.location.replace('/app' + window.location.pathname + window.location.search + window.location.hash);
          return;
        }

        var originalReplaceState = window.history.replaceState;
        var originalPushState = window.history.pushState;

        window.history.replaceState = function (state, title, url) {
          return originalReplaceState.call(this, state, title, typeof url === 'string' ? normalizePath(url) : url);
        };

        window.history.pushState = function (state, title, url) {
          return originalPushState.call(this, state, title, typeof url === 'string' ? normalizePath(url) : url);
        };
      })();
    </script>`;

const FLUTTER_SERVICE_WORKER_TOMBSTONE = `self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
    await self.registration.unregister();

    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) {
      client.navigate(client.url);
    }
  })());
});`;

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

  html = html.replace('</head>', `${APP_PATH_CANONICALIZER}\n${STALE_SERVICE_WORKER_CLEANUP}\n  </head>`);

// Remove Expo's default favicon link if it was injected separately
html = html.replace(/<link rel="shortcut icon" href="\/favicon\.ico" \/>/g, '');
// Remove duplicate if our injection already added it
html = html.replace(/(<link rel="shortcut icon" href="\/favicon\.ico" \/>)\s*\1/g, '$1');

fs.writeFileSync(htmlPath, html);
fs.writeFileSync(path.join(WEB, 'flutter_service_worker.js'), FLUTTER_SERVICE_WORKER_TOMBSTONE);
console.log('✓ Web build patched: favicon, meta tags, logo assets');
