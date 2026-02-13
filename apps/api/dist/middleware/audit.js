"use strict";
// ============================================================
// OrgsLedger API — Audit Logging Middleware & Service
// ============================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeAuditLog = writeAuditLog;
exports.auditContext = auditContext;
const db_1 = __importDefault(require("../db"));
const logger_1 = require("../logger");
/**
 * Write an immutable audit log entry.
 */
async function writeAuditLog(entry) {
    try {
        await (0, db_1.default)('audit_logs').insert({
            organization_id: entry.organizationId || null,
            user_id: entry.userId,
            action: entry.action,
            entity_type: entry.entityType,
            entity_id: entry.entityId,
            previous_value: entry.previousValue ? JSON.stringify(entry.previousValue) : null,
            new_value: entry.newValue ? JSON.stringify(entry.newValue) : null,
            ip_address: entry.ipAddress || null,
            user_agent: entry.userAgent || null,
        });
    }
    catch (err) {
        logger_1.logger.error('Failed to write audit log', { entry, err });
    }
}
/**
 * Express middleware to capture request metadata for audit logging.
 * Attaches helpers to req for controllers to use.
 */
function auditContext(req, _res, next) {
    req.audit = async (params) => {
        if (!req.user)
            return;
        await writeAuditLog({
            ...params,
            userId: req.user.userId,
            ipAddress: req.ip || req.socket.remoteAddress || '',
            userAgent: req.headers['user-agent'] || '',
        });
    };
    next();
}
//# sourceMappingURL=audit.js.map