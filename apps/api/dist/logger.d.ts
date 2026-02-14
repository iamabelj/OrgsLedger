import winston from 'winston';
export declare function generateCorrelationId(): string;
export declare const logger: winston.Logger;
export declare function createServiceLogger(service: string): winston.Logger;
export declare function startTimer(operation: string): {
    end(meta?: Record<string, unknown>): number;
};
//# sourceMappingURL=logger.d.ts.map