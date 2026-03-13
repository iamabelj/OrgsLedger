import { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { getSocketRedisHealth } from './infrastructure/socket/socket-redis';
declare const WORKER_ID: string;
interface SocketStats {
    totalConnections: number;
    activeRooms: number;
    meetingRooms: number;
    userRooms: number;
    channelRooms: number;
}
export declare function setupSocketIO(httpServer: HttpServer): Server;
/**
 * Emit a financial update to all connected org members.
 * Called when transactions are created/updated.
 */
export declare function emitFinancialUpdate(io: Server, organizationId: string, data: any): void;
/**
 * Emit an event to a specific meeting room.
 * Used by broadcast worker for transcripts, captions, minutes.
 */
export declare function emitMeetingEvent(io: Server, meetingId: string, eventType: string, data: any): void;
/**
 * Get the Socket.IO server instance (if initialized).
 */
export declare function getIO(): Server | null;
/**
 * Get current socket statistics.
 */
export declare function getSocketStats(): SocketStats;
/**
 * Get detailed health information for the Socket.IO layer.
 */
export declare function getSocketHealth(): Promise<{
    workerId: string;
    connections: number;
    totalServed: number;
    uptime: number;
    redis: Awaited<ReturnType<typeof getSocketRedisHealth>>;
    stats: SocketStats;
}>;
/**
 * Gracefully shut down Socket.IO and Redis connections.
 */
export declare function shutdownSocket(): Promise<void>;
export { WORKER_ID };
//# sourceMappingURL=socket.d.ts.map