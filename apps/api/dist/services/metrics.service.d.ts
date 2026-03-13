import { Request, Response, NextFunction } from 'express';
interface Counter {
    value: number;
    inc(amount?: number): void;
    reset(): void;
}
interface Histogram {
    values: number[];
    observe(value: number): void;
    percentile(p: number): number;
    avg(): number;
    count(): number;
    reset(): void;
}
export declare const metrics: {
    httpRequestsTotal: Counter;
    httpResponsesByStatus: Record<string, Counter>;
    httpResponseTime: Histogram;
    routeMetrics: Map<string, {
        count: number;
        totalTime: number;
        errors: number;
    }>;
    authLoginAttempts: Counter;
    authLoginSuccess: Counter;
    authLoginFailures: Counter;
    authTokenRefreshes: Counter;
    walletOperations: Counter;
    walletDeductions: Counter;
    aiMinutesUsed: Counter;
    orgsCreated: Counter;
    membersAdded: Counter;
    announcementsSent: Counter;
    paymentsInitiated: Counter;
    paymentsCompleted: Counter;
    paymentsFailed: Counter;
    wsConnectionsActive: Counter;
    wsMessagesTotal: Counter;
    startedAt: string;
};
export declare function metricsMiddleware(req: Request, res: Response, next: NextFunction): void;
export declare function getMetricsSnapshot(): {
    system: {
        uptime: number;
        uptimeHuman: string;
        startedAt: string;
        memoryMB: {
            rss: number;
            heapUsed: number;
            heapTotal: number;
            external: number;
        };
        cpuUsage: NodeJS.CpuUsage;
        nodeVersion: string;
        pid: number;
    };
    http: {
        totalRequests: number;
        requestsPerMinute: number;
        byStatus: {
            '2xx': number;
            '3xx': number;
            '4xx': number;
            '5xx': number;
        };
        responseTime: {
            avg: number;
            p50: number;
            p95: number;
            p99: number;
            samples: number;
        };
        topRoutes: {
            route: string;
            requests: number;
            avgResponseTimeMs: number;
            errorRate: number;
        }[];
    };
    auth: {
        loginAttempts: number;
        loginSuccess: number;
        loginFailures: number;
        tokenRefreshes: number;
    };
    business: {
        walletOperations: number;
        walletDeductions: number;
        aiMinutesUsed: number;
    };
    organizations: {
        orgsCreated: number;
        membersAdded: number;
        announcementsSent: number;
    };
    payments: {
        initiated: number;
        completed: number;
        failed: number;
    };
    websocket: {
        activeConnections: number;
        totalMessages: number;
    };
};
export declare const MetricsHelper: {
    trackLogin(success: boolean): void;
    trackWallet(deduction?: boolean): void;
    trackPayment(status: "initiated" | "completed" | "failed"): void;
    trackAiUsage(minutes: number): void;
    trackWsConnect(): void;
    trackWsDisconnect(): void;
    trackWsMessage(): void;
};
export declare function getPrometheusMetrics(): string;
export {};
//# sourceMappingURL=metrics.service.d.ts.map