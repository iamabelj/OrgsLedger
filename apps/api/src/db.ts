// ============================================================
// OrgsLedger API — Database Connection (Optimized)
// ============================================================

import Knex from 'knex';
import { config } from './config';
import { logger } from './logger';

function normalizePgSslModeInUrl(rawUrl: string): string {
  // `pg-connection-string` warns that sslmode values like 'require' will change semantics
  // in the next major version. Today they alias to 'verify-full'. Make that explicit.
  try {
    const url = new URL(rawUrl);
    const sslmode = url.searchParams.get('sslmode');
    if (!sslmode) return rawUrl;

    const needsNormalization = sslmode === 'prefer' || sslmode === 'require' || sslmode === 'verify-ca';
    if (!needsNormalization) return rawUrl;

    // If the user explicitly opted into libpq compatibility, don't override their intent.
    if (url.searchParams.get('uselibpqcompat') === 'true') return rawUrl;

    url.searchParams.set('sslmode', 'verify-full');
    return url.toString();
  } catch {
    return rawUrl;
  }
}

const connection = process.env.DATABASE_URL
  ? {
      connectionString: normalizePgSslModeInUrl(process.env.DATABASE_URL),
      ssl: { rejectUnauthorized: false },
    }
  : {
      host: config.db.host,
      port: config.db.port,
      user: config.db.user,
      password: config.db.password,
      database: config.db.database,
    };

export const db = Knex({
  client: 'pg',
  connection,
  pool: {
    min: 2,
    max: 20,                // ↑ from 10 — prevents pool exhaustion under load
    acquireTimeoutMillis: 30000,  // Fail fast if pool is exhausted (30s)
    createTimeoutMillis: 10000,   // Don't hang forever creating connections
    idleTimeoutMillis: 30000,     // Release idle connections after 30s
    reapIntervalMillis: 1000,     // Check for idle connections every 1s
    propagateCreateError: false,  // Don't crash on transient connection errors
    afterCreate: (conn: any, done: any) => {
      // Set statement timeout to 30s to prevent runaway queries
      conn.query('SET statement_timeout = 30000', (err: any) => {
        if (err) {
          logger.error('Database connection setup failed', { error: err.message });
        }
        done(err, conn);
      });
    },
  },
});

// Test connection on startup (skip during Jest to avoid open-handle leaks)
const _isJest = typeof process.env.JEST_WORKER_ID !== 'undefined' || process.env.NODE_ENV === 'test';
if (!_isJest) {
  db.raw('SELECT 1')
    .then(() => logger.info('Database connected successfully'))
    .catch((err) => {
      logger.error('Database connection failed on startup', { error: err.message });
      logger.error('App will continue but database queries will fail');
    });
}

// ── Table Existence Cache ────────────────────────────────
// Avoids expensive db.schema.hasTable() calls on every request
const tableExistsCache = new Map<string, boolean>();

export async function tableExists(tableName: string): Promise<boolean> {
  const cached = tableExistsCache.get(tableName);
  if (cached !== undefined) return cached;
  const exists = await db.schema.hasTable(tableName);
  tableExistsCache.set(tableName, exists);
  return exists;
}

/** Call after creating a table at runtime to update cache */
export function markTableExists(tableName: string): void {
  tableExistsCache.set(tableName, true);
}

export default db;
