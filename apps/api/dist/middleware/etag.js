"use strict";
// ============================================================
// OrgsLedger API — ETag Middleware
// Adds weak ETags to JSON responses for client-side caching.
// Clients send If-None-Match; server returns 304 if unchanged.
// ============================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.etagMiddleware = etagMiddleware;
const crypto_1 = __importDefault(require("crypto"));
/**
 * ETag middleware for GET requests.
 * Computes a hash of the response body and returns 304 Not Modified
 * if the client's If-None-Match header matches.
 */
function etagMiddleware(req, res, next) {
    // Only apply to GET requests
    if (req.method !== 'GET')
        return next();
    const originalJson = res.json.bind(res);
    res.json = function (body) {
        // Generate weak ETag from response body
        const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
        const hash = crypto_1.default.createHash('md5').update(bodyStr).digest('hex').slice(0, 16);
        const etag = `W/"${hash}"`;
        res.setHeader('ETag', etag);
        res.setHeader('Cache-Control', 'private, no-cache');
        // Check If-None-Match
        const clientEtag = req.headers['if-none-match'];
        if (clientEtag === etag) {
            res.status(304).end();
            return res;
        }
        return originalJson(body);
    };
    next();
}
//# sourceMappingURL=etag.js.map