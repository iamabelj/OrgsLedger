import { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
export declare function setupSocketIO(httpServer: HttpServer): Server;
/**
 * Emit a financial update to all connected org members.
 * Called when transactions are created/updated.
 */
export declare function emitFinancialUpdate(io: Server, organizationId: string, data: any): void;
//# sourceMappingURL=socket.d.ts.map