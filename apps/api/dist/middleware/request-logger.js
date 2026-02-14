"use strict";
// ============================================================
// OrgsLedger — Full Request/Response Logging Middleware
// Temporary observability layer — disable after SaaS stabilization
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestLogger = requestLogger;
const logger_1 = require("../logger");
/**
 * Log every API request with method, path, user, org, duration, status.
 * Attach to app.use() BEFORE route handlers.
 */
function requestLogger(req, res, next) {
    const start = Date.now();
    const { method, originalUrl, ip } = req;
    // Capture response finish
    res.on('finish', () => {
        const duration = Date.now() - start;
        const userId = req.user?.userId || 'anon';
        const orgId = req.params?.orgId || req.organizationId || '-';
        const status = res.statusCode;
        const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
        logger_1.logger[level]('[REQ]', {
            method,
            path: originalUrl,
            status,
            duration: `${duration}ms`,
            userId,
            orgId,
            ip: ip || req.socket.remoteAddress,
            userAgent: req.headers['user-agent']?.substring(0, 80),
        });
    });
    next();
}
//# sourceMappingURL=request-logger.js.map