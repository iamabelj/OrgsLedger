"use strict";
// ============================================================
// OrgsLedger API — Configuration
// ============================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
// Load .env from project root (two levels up from apps/api/src)
dotenv_1.default.config({ path: path_1.default.resolve(__dirname, '../../../.env') });
dotenv_1.default.config(); // Also try local .env as fallback
exports.config = {
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
        refreshSecret: process.env.JWT_REFRESH_SECRET || (process.env.JWT_SECRET ? process.env.JWT_SECRET + '_refresh' : 'CHANGE_ME_IN_PRODUCTION_REFRESH'),
        expiresIn: process.env.JWT_EXPIRES_IN || '1h',
        refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
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
        url: process.env.AI_PROXY_URL || '', // e.g. https://orgsledger.com
        apiKey: process.env.AI_PROXY_KEY || '', // client API key from the gateway
    },
    // Gateway URL — used for AI proxy routing
    gateway: {
        url: process.env.GATEWAY_URL || 'https://orgsledger.com',
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
// Warn about critical config in production/staging environments
if (exports.config.env !== 'development' && exports.config.env !== 'test') {
    if (exports.config.jwt.secret === 'CHANGE_ME_IN_PRODUCTION') {
        console.error(`[CONFIG] FATAL: JWT_SECRET is using the default value in ${exports.config.env} — set JWT_SECRET in env.js or environment variables`);
        process.exit(1);
    }
    if (exports.config.jwt.secret === exports.config.jwt.refreshSecret) {
        console.error(`[CONFIG] FATAL: JWT_SECRET and JWT_REFRESH_SECRET must be different in ${exports.config.env} — set JWT_REFRESH_SECRET`);
        process.exit(1);
    }
    if (!process.env.DATABASE_URL && exports.config.db.password === 'orgsledger_dev') {
        console.error(`[CONFIG] FATAL: DB_PASSWORD is using the default value in ${exports.config.env} — set DB_PASSWORD in env.js or environment variables`);
        process.exit(1);
    }
}
//# sourceMappingURL=config.js.map