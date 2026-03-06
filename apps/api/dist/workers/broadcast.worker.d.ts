import { Server as SocketIOServer } from 'socket.io';
declare class BroadcastWorker {
    private worker;
    private ioServer;
    private isRunning;
    /**
     * Initialize broadcast worker with Socket.IO server
     */
    initialize(ioServer: SocketIOServer): Promise<void>;
    /**
     * Process a single broadcast job
     */
    private broadcastEvent;
    /**
     * Get worker status
     */
    getStatus(): Promise<{
        running: boolean;
        processed: number;
        failed: number;
        paused: boolean;
    }>;
    /**
     * Pause worker
     */
    pause(): Promise<void>;
    /**
     * Resume worker
     */
    resume(): Promise<void>;
    /**
     * Close worker gracefully
     */
    close(): Promise<void>;
    /**
     * Check if worker is healthy
     */
    isHealthy(): boolean;
}
export declare const broadcastWorker: BroadcastWorker;
/**
 * Initialize and start broadcast worker
 */
export declare function startBroadcastWorker(ioServer: SocketIOServer): Promise<void>;
/**
 * Gracefully shutdown broadcast worker
 */
export declare function stopBroadcastWorker(): Promise<void>;
export {};
//# sourceMappingURL=broadcast.worker.d.ts.map