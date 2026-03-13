import { Request, Response, NextFunction } from 'express';
interface AuditEntry {
    organizationId?: string;
    userId: string;
    action: string;
    entityType: string;
    entityId: string;
    previousValue?: Record<string, unknown>;
    newValue?: Record<string, unknown>;
    ipAddress?: string;
    userAgent?: string;
}
/**
 * Write an immutable audit log entry.
 */
export declare function writeAuditLog(entry: AuditEntry): Promise<void>;
/**
 * Express middleware to capture request metadata for audit logging.
 * Attaches helpers to req for controllers to use.
 */
export declare function auditContext(req: Request, _res: Response, next: NextFunction): void;
export {};
//# sourceMappingURL=audit.d.ts.map