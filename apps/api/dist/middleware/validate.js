"use strict";
// ============================================================
// OrgsLedger API — Validation Middleware (Zod)
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.validate = validate;
const zod_1 = require("zod");
function validate(schema, source = 'body') {
    return (req, res, next) => {
        try {
            const data = schema.parse(req[source]);
            req[source] = data;
            next();
        }
        catch (err) {
            if (err instanceof zod_1.ZodError) {
                res.status(400).json({
                    success: false,
                    error: 'Validation failed',
                    details: err.errors.map((e) => ({
                        path: e.path.join('.'),
                        message: e.message,
                    })),
                });
                return;
            }
            next(err);
        }
    };
}
//# sourceMappingURL=validate.js.map