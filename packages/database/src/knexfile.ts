import type { Knex } from 'knex';
import type { ConnectionConfig } from './types';

function buildConnection(): ConnectionConfig {
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    };
  }
  return {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 5433,
    user: process.env.DB_USER || 'orgsledger',
    password: process.env.DB_PASSWORD || 'orgsledger_dev',
    database: process.env.DB_NAME || 'orgsledger',
  };
}

const config: Knex.Config = {
  client: 'pg',
  connection: buildConnection() as Knex.StaticConnectionConfig,
  pool: { min: 2, max: 20 },
  migrations: {
    directory: './migrations',
    extension: 'ts',
  },
  seeds: {
    directory: './seeds',
    extension: 'ts',
  },
};

export default config;
