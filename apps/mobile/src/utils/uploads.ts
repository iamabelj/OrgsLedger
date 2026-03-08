// ============================================================
// Upload URL resolver
// Handles auth tokens for protected upload paths
// ============================================================

import { Platform } from 'react-native';

/** Public upload subdirectories that don't need auth */
const PUBLIC_UPLOAD_PATHS = ['/uploads/avatars/', '/uploads/logos/', '/uploads/chat/'];

function getOrigin(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location) {
    return window.location.origin;
  }
  // @ts-ignore
  return __DEV__ ? 'http://localhost:3000' : 'https://app.orgsledger.com';
}

/**
 * Resolve an upload URL to a full, accessible URL.
 * - Public paths (avatars, logos, chat) → just prepend origin
 * - Protected paths → append ?token=JWT for browser <img> access
 * - Absolute URLs → return as-is
 */
export function resolveUploadUrl(url?: string | null): string | null {
  if (!url) return null;
  if (url.startsWith('http')) return url;

  const origin = getOrigin();
  const fullUrl = `${origin}${url}`;

  // Check if URL is under a public path — no token needed
  if (PUBLIC_UPLOAD_PATHS.some((p) => url.startsWith(p))) {
    return fullUrl;
  }

  // Protected upload path — append auth token
  if (url.startsWith('/uploads/')) {
    try {
      let token: string | null = null;
      if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
        token = localStorage.getItem('accessToken');
      }
      if (token) {
        return `${fullUrl}?token=${encodeURIComponent(token)}`;
      }
    } catch {
      // Storage access failed — return URL without token
    }
  }

  return fullUrl;
}
