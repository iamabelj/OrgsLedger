import express from 'express';
/**
 * Mount landing gateway onto the Express app.
 * Returns true if the gateway was loaded.
 */
export declare function mountLandingGateway(app: express.Application): boolean;
/**
 * Mount the Expo web SPA frontend.
 * Serves static files and provides SPA fallback.
 */
export declare function mountWebFrontend(app: express.Application): void;
/**
 * Register the SPA catch-all AFTER all API routes.
 */
export declare function mountSpaFallback(app: express.Application): void;
//# sourceMappingURL=landing-gateway.d.ts.map