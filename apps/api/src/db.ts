// ============================================================
// OrgsLedger API — Database Connection
// ============================================================

import Knex from 'knex';
import { config } from './config';
import { logger } from './logger';

const connection = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }
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
    max: 10,
    afterCreate: (conn: any, done: any) => {
      conn.query('SELECT 1', (err: any) => {
        if (err) {
          logger.error('Database connection failed', { error: err.message });
        }
        done(err, conn);
      });
    },
  },
});

// Test connection on startup
db.raw('SELECT 1')
  .then(() => logger.info('Database connected successfully'))
  .catch((err) => {
    logger.error('Database connection failed on startup', { error: err.message });
    // Log but don't crash — let the fallback server handle diagnostics
    logger.error('App will continue but database queries will fail');
  });

export default db;
