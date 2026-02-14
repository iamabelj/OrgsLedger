import { Request, Response, NextFunction } from 'express';
/**
 * Block request if organization has no active subscription.
 * Super admins always bypass.
 * Returns 402 Payment Required if subscription is expired/missing.
 */
export declare function requireActiveSubscription(req: Request, res: Response, next: NextFunction): Promise<void>;
/**
 * Soft-check AI wallet balance — sets req.aiWalletBalance and req.aiWalletEmpty.
 * Does NOT block the request.
 */
export declare function checkAiWallet(req: Request, res: Response, next: NextFunction): Promise<void>;
/**
 * Soft-check Translation wallet balance — sets req.translationWalletBalance and req.translationWalletEmpty.
 * Does NOT block the request.
 */
export declare function checkTranslationWallet(req: Request, res: Response, next: NextFunction): Promise<void>;
//# sourceMappingURL=subscription.d.ts.map