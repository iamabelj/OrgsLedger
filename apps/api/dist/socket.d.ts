import { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
export declare const meetingLanguages: Map<string, Map<string, {
    language: string;
    name: string;
    receiveVoice: boolean;
}>>;
export declare function setupSocketIO(httpServer: HttpServer): Server;
/**
 * Force-disconnect all sockets from a meeting room.
 * Called when moderator ends meeting.
 * Emits meeting:force-disconnect before disconnecting.
 */
export declare function forceDisconnectMeeting(io: Server, meetingId: string): Promise<void>;
/**
 * Emit a financial update to all connected org members.
 * Called when transactions are created/updated.
 */
export declare function emitFinancialUpdate(io: Server, organizationId: string, data: any): void;
//# sourceMappingURL=socket.d.ts.map