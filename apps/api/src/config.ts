// ============================================================
// OrgsLedger API — Configuration
// ============================================================

import dotenv from 'dotenv';
dotenv.config();

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

// Validate critical config in production
if (config.env === 'production') {
  if (config.jwt.secret === 'CHANGE_ME_IN_PRODUCTION') {
    throw new Error('JWT_SECRET must be set in production!');
  }
  if (!process.env.DATABASE_URL && config.db.password === 'orgsledger_dev') {
    throw new Error('DB_PASSWORD must be changed from default in production!');
  }
}
