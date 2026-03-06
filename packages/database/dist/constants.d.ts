export declare const ROLES: {
    readonly GUEST: "guest";
    readonly MEMBER: "member";
    readonly EXECUTIVE: "executive";
    readonly ORG_ADMIN: "org_admin";
    readonly SUPER_ADMIN: "super_admin";
    readonly DEVELOPER: "developer";
};
export type Role = (typeof ROLES)[keyof typeof ROLES];
export declare const SUB_STATUS: {
    readonly ACTIVE: "active";
    readonly EXPIRED: "expired";
    readonly GRACE_PERIOD: "grace_period";
    readonly SUSPENDED: "suspended";
    readonly CANCELLED: "cancelled";
};
export declare const ORG_STATUS: {
    readonly ACTIVE: "active";
    readonly SUSPENDED: "suspended";
};
export declare const TX_STATUS: {
    readonly PENDING: "pending";
    readonly COMPLETED: "completed";
    readonly FAILED: "failed";
    readonly REFUNDED: "refunded";
};
export declare const FINE_STATUS: {
    readonly UNPAID: "unpaid";
    readonly PAID: "paid";
};
export declare const CURRENCIES: {
    readonly USD: "USD";
    readonly NGN: "NGN";
};
export declare const BILLING_CYCLES: {
    readonly ANNUAL: "annual";
    readonly MONTHLY: "monthly";
};
export declare const WALLET_PRICES: {
    readonly AI_PER_HOUR_USD: 10;
    readonly AI_PER_HOUR_NGN: 18000;
    readonly TRANSLATION_PER_HOUR_USD: 10;
    readonly TRANSLATION_PER_HOUR_NGN: 18000;
    readonly AI_CREDIT_PER_HOUR_USD: 7;
};
export declare const PLAN_SLUGS: {
    readonly STANDARD: "standard";
    readonly PROFESSIONAL: "professional";
    readonly ENTERPRISE: "enterprise";
    readonly ENTERPRISE_PRO: "enterprise_pro";
};
export declare const DEFAULTS: {
    readonly MAX_FILE_UPLOAD_MB: 10;
    readonly DEFAULT_BILLING_CYCLE: "annual";
    readonly DEFAULT_CURRENCY: "USD";
    readonly GRACE_PERIOD_DAYS: 7;
    readonly BCRYPT_ROUNDS: 12;
};
export declare const CONFIG_KEYS: {
    readonly AI_PRICE_PER_CREDIT_HOUR: "ai_price_per_credit_hour";
    readonly PLATFORM_NAME: "platform_name";
    readonly STRIPE_ENABLED: "stripe_enabled";
    readonly PAYSTACK_ENABLED: "paystack_enabled";
    readonly FLUTTERWAVE_ENABLED: "flutterwave_enabled";
    readonly MAX_FILE_UPLOAD_MB: "max_file_upload_mb";
    readonly DEFAULT_BILLING_CYCLE: "default_billing_cycle";
};
//# sourceMappingURL=constants.d.ts.map