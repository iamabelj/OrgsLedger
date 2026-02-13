"use strict";
// ============================================================
// OrgsLedger — Shared Types & Enums
// Authoritative type definitions used by API and Mobile apps
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotificationType = exports.LicenseType = exports.AuditAction = exports.TransactionStatus = exports.TransactionType = exports.MeetingStatus = exports.ChannelType = exports.OrgStatus = exports.UserRole = void 0;
// ── User Roles ──────────────────────────────────────────────
var UserRole;
(function (UserRole) {
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
// ── Licensing ───────────────────────────────────────────────
var LicenseType;
(function (LicenseType) {
    LicenseType["FREE"] = "free";
    LicenseType["BASIC"] = "basic";
    LicenseType["PROFESSIONAL"] = "professional";
    LicenseType["ENTERPRISE"] = "enterprise";
})(LicenseType || (exports.LicenseType = LicenseType = {}));
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
//# sourceMappingURL=index.js.map