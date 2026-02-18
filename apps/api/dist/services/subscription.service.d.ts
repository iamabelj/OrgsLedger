export declare function isNigeria(country?: string | null): boolean;
export declare function getCurrency(country?: string | null): 'USD' | 'NGN';
export declare function getPlans(): Promise<any[]>;
export declare function getPlanById(id: string): Promise<any>;
export declare function getPlanBySlug(slug: string): Promise<any>;
export declare function getPlanPrice(plan: any, currency: 'USD' | 'NGN', cycle?: 'annual' | 'monthly'): number;
export declare function checkMemberLimit(orgId: string): Promise<{
    allowed: boolean;
    current: number;
    max: number;
}>;
export declare function getOrgSubscription(orgId: string): Promise<any>;
export declare function createSubscription(params: {
    organizationId: string;
    planId: string;
    billingCycle: 'annual' | 'monthly';
    currency: 'USD' | 'NGN';
    billingCountry?: string;
    amountPaid: number;
    paymentGateway?: string;
    gatewaySubscriptionId?: string;
    createdBy?: string;
    status?: 'active' | 'pending';
}): Promise<any>;
export declare function renewSubscription(orgId: string, amountPaid: number, paymentRef?: string): Promise<any>;
export declare function getAiWallet(orgId: string): Promise<any>;
export declare function getTranslationWallet(orgId: string): Promise<any>;
export declare function topUpAiWallet(params: {
    orgId: string;
    minutes: number;
    cost: number;
    currency: string;
    paymentRef?: string;
    paymentGateway?: string;
}): Promise<any>;
export declare function topUpTranslationWallet(params: {
    orgId: string;
    minutes: number;
    cost: number;
    currency: string;
    paymentRef?: string;
    paymentGateway?: string;
}): Promise<any>;
export declare function deductAiWallet(orgId: string, minutes: number, description?: string): Promise<{
    success: boolean;
    error: string;
} | {
    success: boolean;
    error?: undefined;
}>;
export declare function deductTranslationWallet(orgId: string, minutes: number, description?: string): Promise<{
    success: boolean;
    error: string;
} | {
    success: boolean;
    error?: undefined;
}>;
export declare function getAiWalletHistory(orgId: string, limit?: number, offset?: number): Promise<any[]>;
export declare function getTranslationWalletHistory(orgId: string, limit?: number, offset?: number): Promise<any[]>;
export declare function createInviteLink(orgId: string, createdBy?: string | null, role?: string, maxUses?: number, expiresAt?: string, description?: string): Promise<any>;
export declare function validateInviteLink(code: string): Promise<{
    valid: boolean;
    error: string;
    link?: undefined;
    organization?: undefined;
} | {
    valid: boolean;
    link: any;
    organization: any;
    error?: undefined;
}>;
export declare function useInviteLink(code: string, userId: string): Promise<{
    valid: boolean;
    error: string;
    organization?: undefined;
} | {
    valid: boolean;
    organization: any;
    error?: undefined;
}>;
export declare function startUsageRecord(orgId: string, serviceType: 'ai' | 'translation', meetingId?: string, userId?: string): Promise<any>;
export declare function completeUsageRecord(recordId: string, durationMinutes: number, cost: number, currency?: string): Promise<void>;
export declare function adminAdjustAiWallet(orgId: string, minutes: number, description: string): Promise<any>;
export declare function adminAdjustTranslationWallet(orgId: string, minutes: number, description: string): Promise<any>;
export declare function getPlatformRevenue(): Promise<{
    subscriptions: {
        totalRevenue: number;
        totalCount: number;
        active: number;
        expired: number;
        grace: number;
    };
    aiWallet: {
        totalRevenue: number;
        totalTopups: number;
    };
    translationWallet: {
        totalRevenue: number;
        totalTopups: number;
    };
    totalRevenue: number;
}>;
//# sourceMappingURL=subscription.service.d.ts.map