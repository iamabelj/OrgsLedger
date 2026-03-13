export interface EventPayload {
    type: string;
    timestamp: string;
    data: Record<string, any>;
}
export type EventHandler = (payload: EventPayload) => void | Promise<void>;
export declare const EVENT_CHANNELS: {
    /** @deprecated Use organization-scoped channels instead */
    readonly MEETING_EVENTS: "meeting.events";
};
export type EventChannel = typeof EVENT_CHANNELS[keyof typeof EVENT_CHANNELS] | string;
/**
 * Get organization-scoped channel name.
 * Isolates traffic to prevent large orgs from flooding the system.
 */
export declare function getOrgChannel(organizationId: string): string;
/**
 * Get meeting-specific channel name.
 */
export declare function getMeetingChannel(meetingId: string): string;
/**
 * Publish an event to a channel
 * Uses Redis pub/sub if available, falls back to in-memory
 */
export declare function publishEvent(channel: EventChannel, payload: EventPayload): Promise<void>;
/**
 * Subscribe to a channel
 * Returns unsubscribe function
 */
export declare function subscribe(channel: EventChannel, handler: EventHandler): Promise<() => void>;
/**
 * Check if event bus is using Redis
 */
export declare function isRedisAvailable(): boolean;
/**
 * Publish to organization-scoped channel.
 * Isolates traffic to prevent cross-org flooding.
 */
export declare function publishToOrg(organizationId: string, payload: EventPayload): Promise<void>;
/**
 * Publish to meeting-specific channel.
 */
export declare function publishToMeeting(meetingId: string, payload: EventPayload): Promise<void>;
/**
 * Publish to both organization and meeting channels.
 * Use this for events that need to reach both scopes.
 */
export declare function publishToOrgAndMeeting(organizationId: string, meetingId: string, payload: EventPayload): Promise<void>;
/**
 * Subscribe to organization-scoped channel.
 */
export declare function subscribeToOrg(organizationId: string, handler: EventHandler): Promise<() => void>;
/**
 * Subscribe to meeting-specific channel.
 */
export declare function subscribeToMeeting(meetingId: string, handler: EventHandler): Promise<() => void>;
/**
 * Subscribe to multiple organization channels using pattern.
 * Note: Requires Redis pattern subscription.
 */
export declare function subscribeToAllOrgs(handler: EventHandler): Promise<() => void>;
/**
 * Gracefully shutdown event bus connections
 */
export declare function shutdownEventBus(): Promise<void>;
//# sourceMappingURL=event-bus.service.d.ts.map