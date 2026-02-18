"use strict";
// ============================================================
// OrgsLedger — Shared Types & Enums
// Authoritative type definitions used by API and Mobile apps
// ============================================================
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotificationType = exports.PlanTier = exports.AuditAction = exports.TransactionStatus = exports.TransactionType = exports.MeetingStatus = exports.ChannelType = exports.OrgStatus = exports.UserRole = void 0;
// ── User Roles ──────────────────────────────────────────────
var UserRole;
(function (UserRole) {
    UserRole["DEVELOPER"] = "developer";
    UserRole["SUPER_ADMIN"] = "super_admin";
    UserRole["ORG_ADMIN"] = "org_admin";
    UserRole["EXECUTIVE"] = "executive";
    UserRole["MEMBER"] = "member";
    UserRole["GUEST"] = "guest";
})(UserRole || (exports.UserRole = UserRole = {}));
// ── Organization ────────────────────────────────────────────
var OrgStatus;
(function (OrgStatus) {
    OrgStatus["ACTIVE"] = "active";
    OrgStatus["SUSPENDED"] = "suspended";
    OrgStatus["TRIAL"] = "trial";
    OrgStatus["EXPIRED"] = "expired";
})(OrgStatus || (exports.OrgStatus = OrgStatus = {}));
// ── Communication ───────────────────────────────────────────
var ChannelType;
(function (ChannelType) {
    ChannelType["GENERAL"] = "general";
    ChannelType["COMMITTEE"] = "committee";
    ChannelType["DIRECT"] = "direct";
    ChannelType["ANNOUNCEMENT"] = "announcement";
})(ChannelType || (exports.ChannelType = ChannelType = {}));
// ── Meetings ────────────────────────────────────────────────
var MeetingStatus;
(function (MeetingStatus) {
    MeetingStatus["SCHEDULED"] = "scheduled";
    MeetingStatus["LIVE"] = "live";
    MeetingStatus["ENDED"] = "ended";
    MeetingStatus["CANCELLED"] = "cancelled";
})(MeetingStatus || (exports.MeetingStatus = MeetingStatus = {}));
// ── Financial ───────────────────────────────────────────────
var TransactionType;
(function (TransactionType) {
    TransactionType["DUE"] = "due";
    TransactionType["FINE"] = "fine";
    TransactionType["DONATION"] = "donation";
    TransactionType["LATE_FEE"] = "late_fee";
    TransactionType["MISCONDUCT_FINE"] = "misconduct_fine";
    TransactionType["REFUND"] = "refund";
    TransactionType["AI_CREDIT_PURCHASE"] = "ai_credit_purchase";
})(TransactionType || (exports.TransactionType = TransactionType = {}));
var TransactionStatus;
(function (TransactionStatus) {
    TransactionStatus["PENDING"] = "pending";
    TransactionStatus["COMPLETED"] = "completed";
    TransactionStatus["FAILED"] = "failed";
    TransactionStatus["REFUNDED"] = "refunded";
    TransactionStatus["PARTIALLY_REFUNDED"] = "partially_refunded";
})(TransactionStatus || (exports.TransactionStatus = TransactionStatus = {}));
// ── Audit Log ───────────────────────────────────────────────
var AuditAction;
(function (AuditAction) {
    AuditAction["CREATE"] = "create";
    AuditAction["UPDATE"] = "update";
    AuditAction["DELETE"] = "delete";
    AuditAction["LOGIN"] = "login";
    AuditAction["LOGOUT"] = "logout";
    AuditAction["PAYMENT"] = "payment";
    AuditAction["REFUND"] = "refund";
    AuditAction["ROLE_CHANGE"] = "role_change";
    AuditAction["SETTINGS_CHANGE"] = "settings_change";
    AuditAction["AI_USAGE"] = "ai_usage";
    AuditAction["EXPORT"] = "export";
})(AuditAction || (exports.AuditAction = AuditAction = {}));
// ── Subscription Plans ──────────────────────────────────────
var PlanTier;
(function (PlanTier) {
    PlanTier["STANDARD"] = "standard";
    PlanTier["PROFESSIONAL"] = "professional";
    PlanTier["ENTERPRISE"] = "enterprise";
})(PlanTier || (exports.PlanTier = PlanTier = {}));
// ── Notifications ───────────────────────────────────────────
var NotificationType;
(function (NotificationType) {
    NotificationType["MESSAGE"] = "message";
    NotificationType["MEETING"] = "meeting";
    NotificationType["PAYMENT"] = "payment";
    NotificationType["FINE"] = "fine";
    NotificationType["DUE_REMINDER"] = "due_reminder";
    NotificationType["MINUTES_READY"] = "minutes_ready";
    NotificationType["SYSTEM"] = "system";
})(NotificationType || (exports.NotificationType = NotificationType = {}));
// ── Language Registry ───────────────────────────────────────
__exportStar(require("./languages"), exports);
//# sourceMappingURL=index.js.map