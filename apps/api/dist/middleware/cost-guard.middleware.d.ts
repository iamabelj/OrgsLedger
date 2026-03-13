import { Request, Response, NextFunction } from 'express';
import * as client from 'prom-client';
export declare const aiCostUtilization: client.Gauge<"service">;
export declare const aiCostGuardBlocksTotal: client.Counter<string>;
export declare const aiCostGuardWarningsTotal: client.Counter<string>;
export declare const aiCostProjectedDaily: client.Gauge<string>;
export declare const aiCostBudgetRemaining: client.Gauge<string>;
interface CostBreakdown {
    currentCostUSD: number;
    projectedCostUSD: number;
    budgetLimitUSD: number;
    utilizationPercent: number;
    remainingBudgetUSD: number;
    byService: {
        transcription: {
            current: number;
            projected: number;
        };
        translation: {
            current: number;
            projected: number;
        };
        minutesGeneration: {
            current: number;
            projected: number;
        };
    };
}
/**
 * AI Cost Guard Middleware
 *
 * Blocks requests when AI budget is exceeded.
 * Apply to meeting creation and other AI-intensive endpoints.
 *
 * Usage:
 *   router.post('/meetings/create', aiCostGuard, meetingController.create);
 */
export declare function aiCostGuard(req: Request, res: Response, next: NextFunction): void;
/**
 * Lenient AI Cost Guard
 *
 * Logs warnings but doesn't block requests.
 * Use for non-critical AI endpoints.
 */
export declare function aiCostGuardLenient(req: Request, res: Response, next: NextFunction): void;
/**
 * Get current cost guard status
 * For use in system health endpoints
 */
export declare function getCostGuardStatus(): {
    enabled: boolean;
    isBlocking: boolean;
    isWarning: boolean;
    costBreakdown: CostBreakdown;
    config: {
        blockThreshold: number;
        warnThreshold: number;
        estimatedCostPerMeeting: number;
    };
};
/**
 * Check if system is currently budget-constrained
 * Quick check without full breakdown
 */
export declare function isBudgetConstrained(): boolean;
/**
 * Get remaining budget
 */
export declare function getRemainingBudget(): number;
declare const _default: {
    aiCostGuard: typeof aiCostGuard;
    aiCostGuardLenient: typeof aiCostGuardLenient;
    getCostGuardStatus: typeof getCostGuardStatus;
    isBudgetConstrained: typeof isBudgetConstrained;
    getRemainingBudget: typeof getRemainingBudget;
};
export default _default;
//# sourceMappingURL=cost-guard.middleware.d.ts.map