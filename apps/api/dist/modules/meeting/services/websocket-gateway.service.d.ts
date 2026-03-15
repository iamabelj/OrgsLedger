import { Server as SocketIOServer } from 'socket.io';
/**
 * Initialize the WebSocket gateway
 * Subscribes to Redis event bus channels and routes to Socket.IO
 */
export declare function initializeWebSocketGateway(): Promise<void>;
/**
 * Shutdown the WebSocket gateway
 * Unsubscribes from all channels
 */
export declare function shutdownWebSocketGateway(): Promise<void>;
/**
 * Check if gateway is initialized
 */
export declare function isGatewayInitialized(): boolean;
/**
 * Setup Socket.IO room management for meetings
 * Call this after Socket.IO is initialized
 */
export declare function setupMeetingRooms(io: SocketIOServer): void;
/**
 * Send a targeted event to a specific user.
 * Used for meeting invites, notifications, etc.
 */
export declare function emitToUser(io: SocketIOServer, userId: string, event: string, data: any): void;
/**
 * Send a meeting event to all participants in a meeting room.
 */
export declare function emitToMeeting(io: SocketIOServer, meetingId: string, event: string, data: any): void;
//# sourceMappingURL=websocket-gateway.service.d.ts.map