import winston from 'winston';
/** Deep-clone and mask sensitive values in objects */
declare function maskObject(obj: unknown, depth?: number): unknown;
/** Mask sensitive patterns in a string */
declare function maskString(str: string): string;
export declare function generateCorrelationId(): string;
export declare const logger: winston.Logger;
export declare function createServiceLogger(service: string): winston.Logger;
export declare function startTimer(operation: string): {
    end(meta?: Record<string, unknown>): number;
};
export { maskString, maskObject };
//# sourceMappingURL=logger.d.ts.map