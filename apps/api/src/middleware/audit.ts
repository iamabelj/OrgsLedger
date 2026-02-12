// ============================================================
// OrgsLedger API — Audit Logging Middleware & Service
// ============================================================

import { Request, Response, NextFunction } from 'express';
import db from '../db';
import { logger } from '../logger';

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
export async function writeAuditLog(entry: AuditEntry): Promise<void> {
  try {
    await db('audit_logs').insert({
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
  } catch (err) {
    logger.error('Failed to write audit log', { entry, err });
  }
}

/**
 * Express middleware to capture request metadata for audit logging.
 * Attaches helpers to req for controllers to use.
 */
export function auditContext(req: Request, _res: Response, next: NextFunction): void {
  (req as any).audit = async (params: Omit<AuditEntry, 'userId' | 'ipAddress' | 'userAgent'>) => {
    if (!req.user) return;
    await writeAuditLog({
      ...params,
      userId: req.user.userId,
      ipAddress: req.ip || req.socket.remoteAddress || '',
      userAgent: req.headers['user-agent'] || '',
    });
  };
  next();
}
