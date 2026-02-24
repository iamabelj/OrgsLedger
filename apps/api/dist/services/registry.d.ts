import type { Server as SocketIOServer } from 'socket.io';
import type { AIService } from '../services/ai.service';
import type { BotManager } from '../services/bot';
interface ServiceMap {
    io: SocketIOServer;
    aiService: AIService;
    botManager: BotManager;
}
declare class ServiceRegistry {
    private _services;
    /** Register a service by key */
    register<K extends keyof ServiceMap>(key: K, instance: ServiceMap[K]): void;
    /** Retrieve a service – throws if not registered */
    get<K extends keyof ServiceMap>(key: K): ServiceMap[K];
    /** Retrieve a service or undefined */
    getOptional<K extends keyof ServiceMap>(key: K): ServiceMap[K] | undefined;
    /** Check if a service is registered */
    has(key: keyof ServiceMap): boolean;
}
/** Global singleton – import from anywhere */
export declare const services: ServiceRegistry;
export {};
//# sourceMappingURL=registry.d.ts.map