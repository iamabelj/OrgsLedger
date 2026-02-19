export declare const DOMAINS: {
    readonly LANDING: "orgsledger.com";
    readonly LANDING_WWW: "www.orgsledger.com";
    readonly APP: "app.orgsledger.com";
    readonly LOCALHOST: "localhost";
    readonly LOOPBACK: "127.0.0.1";
};
export declare const LANDING_HOSTS: readonly ["orgsledger.com", "www.orgsledger.com"];
/** Check whether a Host header belongs to the landing / marketing domain */
export declare function isLandingHost(host: string): boolean;
export declare const ROLES: {
    readonly GUEST: "guest";
    readonly MEMBER: "member";
    readonly EXECUTIVE: "executive";
    readonly ORG_ADMIN: "org_admin";
    readonly SUPER_ADMIN: "super_admin";
    readonly DEVELOPER: "developer";
};
export type Role = (typeof ROLES)[keyof typeof ROLES];
export declare const ROLE_HIERARCHY: Record<string, number>;
export declare const ELEVATED_ROLES: readonly string[];
export declare const SUB_STATUS: {
    readonly ACTIVE: "active";
    readonly EXPIRED: "expired";
    readonly GRACE_PERIOD: "grace_period";
    readonly SUSPENDED: "suspended";
    readonly CANCELLED: "cancelled";
};
export type SubStatus = (typeof SUB_STATUS)[keyof typeof SUB_STATUS];
export declare const GATEWAYS: {
    readonly STRIPE: "stripe";
    readonly PAYSTACK: "paystack";
    readonly FLUTTERWAVE: "flutterwave";
    readonly BANK_TRANSFER: "bank_transfer";
};
export declare const NOTIFICATION_TYPES: {
    readonly PAYMENT: "payment";
    readonly MEETING: "meeting";
    readonly CHAT: "chat";
    readonly EVENT: "event";
    readonly ANNOUNCEMENT: "announcement";
    readonly DUES: "dues";
    readonly POLL: "poll";
    readonly DOCUMENT: "document";
    readonly EXPENSE: "expense";
    readonly SYSTEM: "system";
};
export declare const CURRENCIES: {
    readonly USD: "USD";
    readonly NGN: "NGN";
};
export declare const RATE_NGN_PER_USD: number;
export declare const PAGINATION: {
    readonly DEFAULT_LIMIT: 50;
    readonly MAX_LIMIT: 200;
    readonly DEFAULT_PAGE: 1;
};
export declare const RATE_LIMITS: {
    readonly GLOBAL: {
        readonly windowMs: number;
        readonly max: 1000;
    };
    readonly AUTH: {
        readonly windowMs: number;
        readonly max: 15;
    };
    readonly REFRESH: {
        readonly windowMs: number;
        readonly max: 30;
    };
    readonly WEBHOOK: {
        readonly windowMs: number;
        readonly max: 60;
    };
};
export declare const UPLOAD: {
    readonly AVATAR_MAX_SIZE: number;
    readonly ALLOWED_IMAGE_TYPES: readonly string[];
};
export declare const PLANS: {
    readonly FREE: "free";
    readonly STANDARD: "standard";
    readonly PROFESSIONAL: "professional";
    readonly ENTERPRISE: "enterprise";
};
export declare const TX_STATUS: {
    readonly PENDING: "pending";
    readonly COMPLETED: "completed";
    readonly FAILED: "failed";
    readonly REFUNDED: "refunded";
};
export declare const SOCKET_EVENTS: {
    readonly PAYMENT_COMPLETED: "payment_completed";
    readonly FINANCIAL_UPDATE: "financial_update";
    readonly CHAT_MESSAGE: "chat_message";
    readonly NOTIFICATION: "notification";
};
export declare const DEEP_LINK_SCHEME = "orgsledger://";
export declare const APP_NAME = "OrgsLedger";
export declare const APP_VERSION = "1.0.0";
//# sourceMappingURL=constants.d.ts.map