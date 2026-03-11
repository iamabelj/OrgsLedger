// ============================================================
// OrgsLedger API — Service Registry (Lightweight DI)
// Instead of storing services on `app.set()`, use a typed
// singleton registry that any module can import.
// ============================================================

import type { Server as SocketIOServer } from 'socket.io';

interface ServiceMap {
  io: SocketIOServer;
}

class ServiceRegistry {
  private _services: Partial<ServiceMap> = {};

  /** Register a service by key */
  register<K extends keyof ServiceMap>(key: K, instance: ServiceMap[K]): void {
    this._services[key] = instance;
  }

  /** Retrieve a service – throws if not registered */
  get<K extends keyof ServiceMap>(key: K): ServiceMap[K] {
    const svc = this._services[key];
    if (!svc) {
      throw new Error(`ServiceRegistry: "${key}" has not been registered yet`);
    }
    return svc as ServiceMap[K];
  }

  /** Retrieve a service or undefined */
  getOptional<K extends keyof ServiceMap>(key: K): ServiceMap[K] | undefined {
    return this._services[key] as ServiceMap[K] | undefined;
  }

  /** Check if a service is registered */
  has(key: keyof ServiceMap): boolean {
    return key in this._services;
  }
}

/** Global singleton – import from anywhere */
export const services = new ServiceRegistry();
