// Local entry point to avoid Windows backslash path issues in monorepo

// Global error handler for debugging — shows errors on white screen
if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => {
    console.error('[GLOBAL ERROR]', event.error);
    const div = document.createElement('div');
    div.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:#0B1426;color:#F0EDE5;padding:40px;z-index:99999;font-family:monospace;overflow:auto';
    div.innerHTML = '<h2 style="color:#C9A84C">Runtime Error</h2><pre style="white-space:pre-wrap;font-size:13px">' +
      (event.error?.stack || event.message || 'Unknown error') + '</pre>';
    document.body.appendChild(div);
  });
  window.addEventListener('unhandledrejection', (event) => {
    console.error('[UNHANDLED REJECTION]', event.reason);
  });
}

import 'expo-router/entry';
