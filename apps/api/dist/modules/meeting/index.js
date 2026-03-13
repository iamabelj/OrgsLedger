"use strict";
// ============================================================
// OrgsLedger API — Meeting Module Index
// Production-grade AI meeting infrastructure (Stage 1)
// ============================================================
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.meetingRoutes = exports.setupMeetingRooms = exports.shutdownWebSocketGateway = exports.initializeWebSocketGateway = void 0;
// Models
__exportStar(require("./models"), exports);
// Services
__exportStar(require("./services"), exports);
var websocket_gateway_service_1 = require("./services/websocket-gateway.service");
Object.defineProperty(exports, "initializeWebSocketGateway", { enumerable: true, get: function () { return websocket_gateway_service_1.initializeWebSocketGateway; } });
Object.defineProperty(exports, "shutdownWebSocketGateway", { enumerable: true, get: function () { return websocket_gateway_service_1.shutdownWebSocketGateway; } });
Object.defineProperty(exports, "setupMeetingRooms", { enumerable: true, get: function () { return websocket_gateway_service_1.setupMeetingRooms; } });
// Controllers
__exportStar(require("./controllers"), exports);
// Routes
var routes_1 = require("./routes");
Object.defineProperty(exports, "meetingRoutes", { enumerable: true, get: function () { return routes_1.meetingRoutes; } });
//# sourceMappingURL=index.js.map