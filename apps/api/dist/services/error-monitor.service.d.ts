import { Request, Response, NextFunction } from 'express';
export type ErrorSeverity = 'fatal' | 'error' | 'warning' | 'info';
interface ErrorContext {
    userId?: string;
    orgId?: string;
    route?: string;
    method?: string;
    statusCode?: number;
    correlationId?: string;
    extra?: Record<string, unknown>;
}
export declare function captureError(err: Error, severity?: ErrorSeverity, context?: ErrorContext): void;
export declare function errorMonitorMiddleware(err: any, req: Request, res: Response, next: NextFunction): void;
export declare function setupProcessErrorHandlers(): void;
export declare function getRecentErrors(limit?: number): {
    timestamp: string;
    severity: ErrorSeverity;
    message: string;
    stack?: string;
    context: ErrorContext;
    fingerprint: string;
}[];
export declare function getErrorFrequency(): {
    fingerprint: string;
    count: number;
    firstSeen: string;
    lastSeen: string;
}[];
export declare function getErrorStats(): {
    total: number;
    last24h: number;
    bySeverity: {
        fatal: number;
        error: number;
        warning: number;
    };
    uniqueFingerprints: number;
    topErrors: {
        fingerprint: string;
        count: number;
        firstSeen: string;
        lastSeen: string;
    }[];
};
export {};
//# sourceMappingURL=error-monitor.service.d.ts.map