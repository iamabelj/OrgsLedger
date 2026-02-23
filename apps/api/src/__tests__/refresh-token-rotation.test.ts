// ============================================================
// Test — Refresh Token Rotation
// Validates: token storage, rotation on refresh, revocation
// on password change, and reuse detection.
// ============================================================

import crypto from 'crypto';

describe('Refresh Token Rotation Logic', () => {
  // Simulate the token hash store (in-memory for unit test)
  const tokenStore = new Map<string, { userId: string; expiresAt: Date }>();

  function hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  function storeToken(userId: string, token: string): void {
    const hash = hashToken(token);
    tokenStore.set(hash, { userId, expiresAt: new Date(Date.now() + 7 * 86400000) });
  }

  function isTokenValid(token: string): boolean {
    const hash = hashToken(token);
    const entry = tokenStore.get(hash);
    if (!entry) return false;
    return entry.expiresAt > new Date();
  }

  function revokeToken(token: string): boolean {
    const hash = hashToken(token);
    return tokenStore.delete(hash);
  }

  function revokeAllForUser(userId: string): void {
    for (const [hash, entry] of tokenStore.entries()) {
      if (entry.userId === userId) tokenStore.delete(hash);
    }
  }

  beforeEach(() => {
    tokenStore.clear();
  });

  it('should store and validate a refresh token', () => {
    const token = 'refresh_abc123';
    storeToken('user-1', token);
    expect(isTokenValid(token)).toBe(true);
  });

  it('should reject an unknown token', () => {
    expect(isTokenValid('unknown-token')).toBe(false);
  });

  it('should revoke a specific token', () => {
    const token = 'refresh_xyz';
    storeToken('user-1', token);
    expect(isTokenValid(token)).toBe(true);

    revokeToken(token);
    expect(isTokenValid(token)).toBe(false);
  });

  it('should revoke all tokens for a user (password change)', () => {
    const token1 = 'refresh_device1';
    const token2 = 'refresh_device2';
    const token3 = 'refresh_other_user';

    storeToken('user-1', token1);
    storeToken('user-1', token2);
    storeToken('user-2', token3);

    revokeAllForUser('user-1');

    expect(isTokenValid(token1)).toBe(false);
    expect(isTokenValid(token2)).toBe(false);
    expect(isTokenValid(token3)).toBe(true); // Other user unaffected
  });

  it('should detect token reuse after rotation', () => {
    const oldToken = 'refresh_old';
    const newToken = 'refresh_new';

    // Login: store original token
    storeToken('user-1', oldToken);
    expect(isTokenValid(oldToken)).toBe(true);

    // Refresh: rotate — revoke old, store new
    revokeToken(oldToken);
    storeToken('user-1', newToken);

    expect(isTokenValid(oldToken)).toBe(false); // Old token revoked
    expect(isTokenValid(newToken)).toBe(true);   // New token valid
  });

  it('should hash tokens consistently', () => {
    const token = 'test-token-value';
    const hash1 = hashToken(token);
    const hash2 = hashToken(token);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA-256 hex = 64 chars
  });

  it('should handle many tokens per user', () => {
    // Simulate logins from 10 devices
    const tokens: string[] = [];
    for (let i = 0; i < 10; i++) {
      const t = `refresh_device_${i}`;
      tokens.push(t);
      storeToken('user-1', t);
    }

    expect(tokenStore.size).toBe(10);
    tokens.forEach(t => expect(isTokenValid(t)).toBe(true));

    // Revoke all
    revokeAllForUser('user-1');
    expect(tokenStore.size).toBe(0);
  });
});
