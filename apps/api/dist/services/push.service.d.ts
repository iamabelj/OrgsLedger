interface PushPayload {
    title: string;
    body: string;
    data?: Record<string, string>;
}
/**
 * Send push notification to a specific user.
 */
export declare function sendPushToUser(userId: string, payload: PushPayload): Promise<void>;
/**
 * Send push notification to all members of an organization.
 */
export declare function sendPushToOrg(organizationId: string, payload: PushPayload, excludeUserId?: string): Promise<void>;
export {};
//# sourceMappingURL=push.service.d.ts.map