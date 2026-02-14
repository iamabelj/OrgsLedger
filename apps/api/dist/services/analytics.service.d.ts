export type AnalyticsEvent = 'meeting.created' | 'meeting.started' | 'meeting.ended' | 'meeting.ai_minutes_used' | 'meeting.translation_used' | 'member.joined' | 'member.removed' | 'org.created' | 'org.subscription_upgraded' | 'org.subscription_downgraded' | 'wallet.funded' | 'wallet.deducted' | 'payment.completed' | 'payment.failed' | 'announcement.sent' | 'poll.created' | 'poll.voted' | 'document.uploaded' | 'event.created' | 'chat.message_sent' | 'auth.login' | 'auth.register' | 'auth.password_change';
interface AnalyticsEntry {
    event: AnalyticsEvent;
    timestamp: string;
    orgId?: string;
    userId?: string;
    metadata?: Record<string, unknown>;
}
export declare function trackEvent(event: AnalyticsEvent, opts?: {
    orgId?: string;
    userId?: string;
    metadata?: Record<string, unknown>;
}): void;
/** Get recent events (for live feed) */
export declare function getRecentEvents(limit?: number, eventFilter?: AnalyticsEvent): AnalyticsEntry[];
/** Get org usage summary (for org admin dashboard) */
export declare function getOrgUsageSummary(orgId: string): {
    meetingsCreated: number;
    aiMinutesUsed: number;
    translationMinutes: number;
    membersAdded: number;
    paymentsCompleted: number;
    walletFunded: number;
    walletDeducted: number;
    messagesSent: number;
    documentsUploaded: number;
    lastActivity: string;
} | null;
/** Get all org usage (for super admin) */
export declare function getAllOrgUsage(): ({
    orgId: string;
} & {
    meetingsCreated: number;
    aiMinutesUsed: number;
    translationMinutes: number;
    membersAdded: number;
    paymentsCompleted: number;
    walletFunded: number;
    walletDeducted: number;
    messagesSent: number;
    documentsUploaded: number;
    lastActivity: string;
})[];
/** Get daily trends (for graphs) */
export declare function getDailyTrends(days?: number): {
    date: string;
    events: Record<string, number>;
    total: number;
}[];
/** Get platform-wide analytics snapshot */
export declare function getAnalyticsSnapshot(): {
    period: {
        last1h: number;
        last24h: number;
        bufferSize: number;
    };
    activeOrgs: number;
    activeUsers: number;
    eventCounts: Record<string, number>;
    dailyTrends: {
        date: string;
        events: Record<string, number>;
        total: number;
    }[];
    topOrgs: ({
        orgId: string;
    } & {
        meetingsCreated: number;
        aiMinutesUsed: number;
        translationMinutes: number;
        membersAdded: number;
        paymentsCompleted: number;
        walletFunded: number;
        walletDeducted: number;
        messagesSent: number;
        documentsUploaded: number;
        lastActivity: string;
    })[];
};
export declare function persistDailySnapshot(): Promise<void>;
export {};
//# sourceMappingURL=analytics.service.d.ts.map