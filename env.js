// ============================================================
// OrgsLedger — Production Environment Configuration
// Loaded by app.js BEFORE any other module.
// ============================================================

// Only apply if not already set (env vars from hosting panel take priority)
const defaults = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://neondb_owner:npg_S4XDP5sCkTyw@ep-crimson-sky-aim3t0hb-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require',
  JWT_SECRET: '8fb0da3dd7375f2de7b82feda6d06cd876d6b041358b1a468b3811c2005542ed9bcfd0c840f3d45b77d1ca904421bd1910fd2db02fa216cd3c54981d1feb22f3',
  JWT_REFRESH_SECRET: 'a7c12e9f4b806d352e91af083c7d5e19b4f62a0193d8e7c5b06f4a2d8e31cb97d4a5f09e1c783b62d0e4f51a93b7c8206d1e5f4a3b9c72068e1d4f5a2b3c9e80',
  GOOGLE_APPLICATION_CREDENTIALS: './google-credentials.json',
  ADMIN_PASSWORD: 'SuperAdmin123!',
  GATEWAY_JWT_SECRET: 'gw_8fb0da3dd7375f2de7b82feda6d06cd876d6b041',
};

for (const [key, value] of Object.entries(defaults)) {
  if (!process.env[key]) {
    process.env[key] = value;
  }
}
