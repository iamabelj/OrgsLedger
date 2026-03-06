import { Queue } from 'bullmq';
export interface AuditJobData {
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
declare class AuditQueueManager {
    private queue;
    private initialized;
    initialize(): Promise<Queue<AuditJobData>>;
    getQueue(): Queue<AuditJobData> | null;
    isInitialized(): boolean;
}
export declare function initializeAuditQueue(): Promise<Queue<AuditJobData>>;
export declare function submitAuditJob(data: AuditJobData): Promise<void>;
export declare function getAuditQueueManager(): AuditQueueManager;
export {};
//# sourceMappingURL=audit.queue.d.ts.map