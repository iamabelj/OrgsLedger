"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkTranslationWallet = exports.checkAiWallet = exports.requireActiveSubscription = exports.validate = exports.writeAuditLog = exports.auditContext = exports.requireDeveloper = exports.requireSuperAdmin = exports.requireRole = exports.loadMembership = exports.authenticate = void 0;
exports.loadMembershipAndSub = loadMembershipAndSub;
const auth_1 = require("./auth");
const subscription_1 = require("./subscription");
var auth_2 = require("./auth");
Object.defineProperty(exports, "authenticate", { enumerable: true, get: function () { return auth_2.authenticate; } });
Object.defineProperty(exports, "loadMembership", { enumerable: true, get: function () { return auth_2.loadMembership; } });
var rbac_1 = require("./rbac");
Object.defineProperty(exports, "requireRole", { enumerable: true, get: function () { return rbac_1.requireRole; } });
Object.defineProperty(exports, "requireSuperAdmin", { enumerable: true, get: function () { return rbac_1.requireSuperAdmin; } });
Object.defineProperty(exports, "requireDeveloper", { enumerable: true, get: function () { return rbac_1.requireDeveloper; } });
var audit_1 = require("./audit");
Object.defineProperty(exports, "auditContext", { enumerable: true, get: function () { return audit_1.auditContext; } });
Object.defineProperty(exports, "writeAuditLog", { enumerable: true, get: function () { return audit_1.writeAuditLog; } });
var validate_1 = require("./validate");
Object.defineProperty(exports, "validate", { enumerable: true, get: function () { return validate_1.validate; } });
var subscription_2 = require("./subscription");
Object.defineProperty(exports, "requireActiveSubscription", { enumerable: true, get: function () { return subscription_2.requireActiveSubscription; } });
Object.defineProperty(exports, "checkAiWallet", { enumerable: true, get: function () { return subscription_2.checkAiWallet; } });
Object.defineProperty(exports, "checkTranslationWallet", { enumerable: true, get: function () { return subscription_2.checkTranslationWallet; } });
/**
 * Combined middleware: loads membership then enforces active subscription.
 * Use on all org-scoped routes that require a paid plan.
 */
function loadMembershipAndSub(req, res, next) {
    (0, auth_1.loadMembership)(req, res, (err) => {
        if (err)
            return next(err);
        if (res.headersSent)
            return;
        (0, subscription_1.requireActiveSubscription)(req, res, next);
    });
}
//# sourceMappingURL=index.js.map