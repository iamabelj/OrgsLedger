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
    console.error('[OrgsLedger] DB connection failed:', err.message);
    if (process.env.DATABASE_URL) {
      console.error('[OrgsLedger] DATABASE_URL is set but connection failed. Check the connection string and network access.');
    } else {
      console.error('[OrgsLedger] DATABASE_URL is NOT set. Using individual DB_HOST/DB_USER/DB_PASSWORD/DB_NAME vars.');
      console.error('[OrgsLedger] Set DATABASE_URL to your Neon.tech PostgreSQL connection string.');
    }
    // In production, exit so Hostinger can restart and show logs
    if (config.env === 'production') {
      process.exit(1);
    }
  });

export default db;
