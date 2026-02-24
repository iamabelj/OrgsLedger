"use strict";
// ============================================================
// OrgsLedger API — Structured Logger (Winston)
// JSON logging in production with request correlation IDs,
// custom metadata fields, and performance timing.
// ============================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
exports.generateCorrelationId = generateCorrelationId;
exports.createServiceLogger = createServiceLogger;
exports.startTimer = startTimer;
exports.maskString = maskString;
exports.maskObject = maskObject;
const winston_1 = __importDefault(require("winston"));
const config_1 = require("./config");
const crypto_1 = __importDefault(require("crypto"));
// ── Sensitive Data Masking ────────────────────────────────
// Masks PII and secrets in log output to prevent accidental leakage.
const SENSITIVE_PATTERNS = [
    // JWT tokens (header.payload.signature)
    { regex: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, replacement: '[REDACTED_JWT]' },
    // Email addresses
    { regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, replacement: '[REDACTED_EMAIL]' },
    // Credit/debit card numbers (13-19 digits, with optional separators)
    { regex: /\b(?:\d[ -]*?){13,19}\b/g, replacement: '[REDACTED_CARD]' },
    // Bearer tokens in headers
    { regex: /Bearer\s+[A-Za-z0-9._~+/=-]+/gi, replacement: 'Bearer [REDACTED]' },
    // Password fields in JSON-like strings
    { regex: /"(?:password|passwd|secret|token|apiKey|api_key|authorization|refreshToken|refresh_token)":\s*"[^"]*"/gi, replacement: (match) => {
            const key = match.split(':')[0];
            return `${key}: "[REDACTED]"`;
        } },
];
const SENSITIVE_KEYS = new Set([
    'password', 'passwd', 'secret', 'token', 'apiKey', 'api_key',
    'authorization', 'refreshToken', 'refresh_token', 'creditCard',
    'cardNumber', 'cvv', 'ssn', 'accessToken', 'access_token',
]);
/** Deep-clone and mask sensitive values in objects */
function maskObject(obj, depth = 0) {
    if (depth > 8 || obj === null || obj === undefined)
        return obj;
    if (typeof obj === 'string')
        return maskString(obj);
    if (typeof obj !== 'object')
        return obj;
    if (Array.isArray(obj))
        return obj.map(item => maskObject(item, depth + 1));
    const masked = {};
    for (const [key, value] of Object.entries(obj)) {
        if (SENSITIVE_KEYS.has(key.toLowerCase())) {
            masked[key] = '[REDACTED]';
        }
        else if (typeof value === 'string') {
            masked[key] = maskString(value);
        }
        else if (typeof value === 'object' && value !== null) {
            masked[key] = maskObject(value, depth + 1);
        }
        else {
            masked[key] = value;
        }
    }
    return masked;
}
/** Mask sensitive patterns in a string */
function maskString(str) {
    let result = str;
    for (const { regex, replacement } of SENSITIVE_PATTERNS) {
        // Reset regex lastIndex for global patterns
        regex.lastIndex = 0;
        if (typeof replacement === 'string') {
            result = result.replace(regex, replacement);
        }
        else {
            result = result.replace(regex, replacement);
        }
    }
    return result;
}
// Winston format that masks sensitive data in all log entries
const sensitiveDataMask = winston_1.default.format((info) => {
    if (typeof info.message === 'string') {
        info.message = maskString(info.message);
    }
    // Mask metadata keys
    for (const key of Object.keys(info)) {
        if (key === 'level' || key === 'message' || key === 'timestamp' || key === 'service')
            continue;
        if (typeof info[key] === 'string') {
            if (SENSITIVE_KEYS.has(key.toLowerCase())) {
                info[key] = '[REDACTED]';
            }
            else {
                info[key] = maskString(info[key]);
            }
        }
        else if (typeof info[key] === 'object' && info[key] !== null) {
            info[key] = maskObject(info[key]);
        }
    }
    return info;
});
// ── Correlation ID Generator ──────────────────────────────
function generateCorrelationId() {
    return crypto_1.default.randomBytes(8).toString('hex');
}
// ── Custom Log Formats ────────────────────────────────────
const structuredFormat = winston_1.default.format.printf(({ level, message, timestamp, ...meta }) => {
    // Strip Symbol-keyed properties that Winston adds
    const cleanMeta = { ...meta };
    delete cleanMeta[Symbol.for('level')];
    delete cleanMeta[Symbol.for('splat')];
    return JSON.stringify({
        timestamp,
        level,
        message,
        service: 'orgsledger-api',
        environment: config_1.config.env,
        ...cleanMeta,
    });
});
const devFormat = winston_1.default.format.combine(winston_1.default.format.colorize(), winston_1.default.format.printf(({ level, message, timestamp, ...meta }) => {
    const cleanMeta = { ...meta };
    delete cleanMeta[Symbol.for('level')];
    delete cleanMeta[Symbol.for('splat')];
    delete cleanMeta.service;
    const metaStr = Object.keys(cleanMeta).length > 0
        ? ' ' + JSON.stringify(cleanMeta)
        : '';
    return `${timestamp} ${level}: ${message}${metaStr}`;
}));
// ── Logger Instance ───────────────────────────────────────
exports.logger = winston_1.default.createLogger({
    level: config_1.config.env === 'production' ? 'info' : 'debug',
    format: winston_1.default.format.combine(winston_1.default.format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }), winston_1.default.format.errors({ stack: true }), sensitiveDataMask()),
    defaultMeta: {
        service: 'orgsledger-api',
        version: process.env.npm_package_version || '1.0.0',
        nodeVersion: process.version,
        pid: process.pid,
    },
    transports: [
        new winston_1.default.transports.Console({
            format: config_1.config.env === 'production' ? structuredFormat : devFormat,
        }),
    ],
});
// ── Child Logger Factory ──────────────────────────────────
// Create scoped loggers for services with pre-set metadata
function createServiceLogger(service) {
    return exports.logger.child({ component: service });
}
// ── Performance Timer ─────────────────────────────────────
function startTimer(operation) {
    const start = process.hrtime.bigint();
    return {
        end(meta) {
            const elapsed = Number(process.hrtime.bigint() - start) / 1e6; // ms
            exports.logger.info(`[PERF] ${operation}`, {
                operation,
                durationMs: Math.round(elapsed * 100) / 100,
                ...meta,
            });
            return elapsed;
        },
    };
}
//# sourceMappingURL=logger.js.map