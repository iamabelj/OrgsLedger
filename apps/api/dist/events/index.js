"use strict";
// ============================================================
// OrgsLedger API — Events Module Index
// Durable event persistence and replay
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.replayEvent = exports.durableSubmitMeetingEnded = exports.durableSubmitMinutes = exports.durableSubmitBroadcast = exports.durableSubmitTranslation = exports.durableSubmitTranscript = exports.initializeEventBridge = exports.eventQueueBridge = exports.isEventProcessed = exports.getUnprocessedEvents = exports.markEventProcessed = exports.storeEvent = exports.initializeEventStore = exports.eventStore = void 0;
var event_store_1 = require("./event-store");
// Event Store
Object.defineProperty(exports, "eventStore", { enumerable: true, get: function () { return event_store_1.eventStore; } });
Object.defineProperty(exports, "initializeEventStore", { enumerable: true, get: function () { return event_store_1.initializeEventStore; } });
Object.defineProperty(exports, "storeEvent", { enumerable: true, get: function () { return event_store_1.storeEvent; } });
Object.defineProperty(exports, "markEventProcessed", { enumerable: true, get: function () { return event_store_1.markEventProcessed; } });
Object.defineProperty(exports, "getUnprocessedEvents", { enumerable: true, get: function () { return event_store_1.getUnprocessedEvents; } });
Object.defineProperty(exports, "isEventProcessed", { enumerable: true, get: function () { return event_store_1.isEventProcessed; } });
var event_queue_bridge_1 = require("./event-queue-bridge");
// Event Queue Bridge
Object.defineProperty(exports, "eventQueueBridge", { enumerable: true, get: function () { return event_queue_bridge_1.eventQueueBridge; } });
Object.defineProperty(exports, "initializeEventBridge", { enumerable: true, get: function () { return event_queue_bridge_1.initializeEventBridge; } });
Object.defineProperty(exports, "durableSubmitTranscript", { enumerable: true, get: function () { return event_queue_bridge_1.durableSubmitTranscript; } });
Object.defineProperty(exports, "durableSubmitTranslation", { enumerable: true, get: function () { return event_queue_bridge_1.durableSubmitTranslation; } });
Object.defineProperty(exports, "durableSubmitBroadcast", { enumerable: true, get: function () { return event_queue_bridge_1.durableSubmitBroadcast; } });
Object.defineProperty(exports, "durableSubmitMinutes", { enumerable: true, get: function () { return event_queue_bridge_1.durableSubmitMinutes; } });
Object.defineProperty(exports, "durableSubmitMeetingEnded", { enumerable: true, get: function () { return event_queue_bridge_1.durableSubmitMeetingEnded; } });
Object.defineProperty(exports, "replayEvent", { enumerable: true, get: function () { return event_queue_bridge_1.replayEvent; } });
//# sourceMappingURL=index.js.map