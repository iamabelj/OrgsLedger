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
//# sourceMappingURL=websocket-gateway.service.d.ts.map