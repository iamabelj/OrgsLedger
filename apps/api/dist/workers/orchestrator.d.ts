import { Server as SocketIOServer } from 'socket.io';
import { ProcessingWorker as IProcessingWorkerService } from '../services/workers/processingWorker.service';
import { MinutesWorkerService } from '../services/workers/minutesWorker.service';
declare class WorkerOrchestrator {
    private isInitialized;
    private initialiationStartTime;
    /**
     * Initialize all workers
     */
    initialize(ioServer: SocketIOServer, processingService: IProcessingWorkerService, minutesService: MinutesWorkerService): Promise<void>;
    /**
     * Check health of all workers
     */
    getHealthStatus(): Promise<{
        orchestratorReady: boolean;
        broadcast: {
            healthy: boolean;
            running: boolean;
            processed: number;
            failed: number;
        };
        processing: {
            healthy: boolean;
            running: boolean;
            processed: number;
            failed: number;
        };
        minutes: {
            healthy: boolean;
            running: boolean;
            processed: number;
            failed: number;
        };
    }>;
    /**
     * Pause all workers
     */
    pauseAll(): Promise<void>;
    /**
     * Resume all workers
     */
    resumeAll(): Promise<void>;
    /**
     * Gracefully shutdown all workers
     */
    shutdown(): Promise<void>;
    /**
     * Check if orchestrator is initialized and healthy
     */
    isHealthy(): boolean;
}
export declare const workerOrchestrator: WorkerOrchestrator;
/**
 * Initialize worker orchestrator
 */
export declare function initializeWorkerOrchestrator(ioServer: SocketIOServer, processingService: IProcessingWorkerService, minutesService: MinutesWorkerService): Promise<void>;
/**
 * Shutdown worker orchestrator gracefully
 */
export declare function shutdownWorkerOrchestrator(): Promise<void>;
export {};
//# sourceMappingURL=orchestrator.d.ts.map