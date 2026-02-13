// ============================================================
// OrgsLedger — Production Environment Configuration
// Loaded by app.js BEFORE any other module.
// ============================================================

// Only apply if not already set (env vars from hosting panel take priority)
const defaults = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://neondb_owner:npg_S4XDP5sCkTyw@ep-crimson-sky-aim3t0hb-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require',
  JWT_SECRET: '8fb0da3dd7375f2de7b82feda6d06cd876d6b041358b1a468b3811c2005542ed9bcfd0c840f3d45b77d1ca904421bd1910fd2db02fa216cd3c54981d1feb22f3',
  GOOGLE_APPLICATION_CREDENTIALS: './google-credentials.json',
};

for (const [key, value] of Object.entries(defaults)) {
  if (!process.env[key]) {
    process.env[key] = value;
  }
}
