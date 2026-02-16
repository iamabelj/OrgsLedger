"use strict";
// ============================================================
// OrgsLedger API — Service Registry (Lightweight DI)
// Instead of storing services on `app.set()`, use a typed
// singleton registry that any module can import.
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.services = void 0;
class ServiceRegistry {
    _services = {};
    /** Register a service by key */
    register(key, instance) {
        this._services[key] = instance;
    }
    /** Retrieve a service – throws if not registered */
    get(key) {
        const svc = this._services[key];
        if (!svc) {
            throw new Error(`ServiceRegistry: "${key}" has not been registered yet`);
        }
        return svc;
    }
    /** Retrieve a service or undefined */
    getOptional(key) {
        return this._services[key];
    }
    /** Check if a service is registered */
    has(key) {
        return key in this._services;
    }
}
/** Global singleton – import from anywhere */
exports.services = new ServiceRegistry();
//# sourceMappingURL=registry.js.map