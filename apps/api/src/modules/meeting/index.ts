// ============================================================
// OrgsLedger API — Meeting Module Index
// Production-grade AI meeting infrastructure (Stage 1)
// ============================================================

// Models
export * from './models';

// Services
export * from './services';
export { 
  initializeWebSocketGateway, 
  shutdownWebSocketGateway,
  setupMeetingRooms,
} from './services/websocket-gateway.service';

// Controllers
export * from './controllers';

// Routes
export { meetingRoutes } from './routes';
