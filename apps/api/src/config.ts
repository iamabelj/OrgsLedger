// ============================================================
// OrgsLedger API — Configuration
// ============================================================

import dotenv from 'dotenv';
import path from 'path';

// Try loading .env from multiple locations
// 1. Current working directory (apps/api in production)
// 2. Project root (two levels up from apps/api)
dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  apiUrl: process.env.API_URL || 'http://localhost:3000',

  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'orgsledger',
    password: process.env.DB_PASSWORD || 'orgsledger_dev',
    database: process.env.DB_NAME || 'orgsledger',
  },

  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'CHANGE_ME_IN_PRODUCTION',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  },

  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  },

  paystack: {
    secretKey: process.env.PAYSTACK_SECRET_KEY || '',
    publicKey: process.env.PAYSTACK_PUBLIC_KEY || '',
  },

  flutterwave: {
    secretKey: process.env.FLUTTERWAVE_SECRET_KEY || '',
    publicKey: process.env.FLUTTERWAVE_PUBLIC_KEY || '',
    webhookHash: process.env.FLUTTERWAVE_WEBHOOK_HASH || '',
  },

  ai: {
    openaiApiKey: process.env.OPENAI_API_KEY || '',
    googleCredentials: process.env.GOOGLE_APPLICATION_CREDENTIALS || '',
  },

  // AI Gateway proxy — when set, AI requests go through orgsledger.com
  // instead of calling Google / OpenAI directly.
  aiProxy: {
    url: process.env.AI_PROXY_URL || '',   // e.g. https://orgsledger.com
    apiKey: process.env.AI_PROXY_KEY || '', // client API key from the gateway
  },

  // License key — required for deployment
  license: {
    key: process.env.LICENSE_KEY || '',
    gatewayUrl: process.env.GATEWAY_URL || 'https://orgsledger.com',
  },

  email: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.EMAIL_FROM || 'noreply@orgsledger.com',
  },

  upload: {
    dir: process.env.UPLOAD_DIR || './uploads',
    maxFileSizeMB: parseInt(process.env.MAX_FILE_SIZE_MB || '50', 10),
  },

  fcm: {
    projectId: process.env.FIREBASE_PROJECT_ID || '',
  },
};

// Validate critical config in production (warn, don't crash)
if (config.env === 'production') {
  if (config.jwt.secret === 'CHANGE_ME_IN_PRODUCTION') {
    console.error('[CONFIG WARNING] JWT_SECRET is not set! Auth will not work.');
  }
  if (!process.env.DATABASE_URL && config.db.password === 'orgsledger_dev') {
    console.error('[CONFIG WARNING] DATABASE_URL is not set — DB queries will fail.');
  }
}
