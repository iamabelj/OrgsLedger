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
const winston_1 = __importDefault(require("winston"));
const config_1 = require("./config");
const crypto_1 = __importDefault(require("crypto"));
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
    format: winston_1.default.format.combine(winston_1.default.format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }), winston_1.default.format.errors({ stack: true })),
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