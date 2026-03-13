// ============================================================
// OrgsLedger API — WebSocket Gateway Service
// Bridges Redis event bus to Socket.IO for real-time delivery
// Decouples business logic from WebSocket transport
// ============================================================

import { Server as SocketIOServer } from 'socket.io';
import { logger } from '../../../logger';
import { services } from '../../../services/registry';
import { 
  subscribe, 
  EventPayload, 
  EVENT_CHANNELS 
} from './event-bus.service';
import { MeetingEvent } from './meeting.service';

let unsubscribeFn: (() => void) | null = null;
let isInitialized = false;

/**
 * Handle meeting events from the event bus
 * Routes events to appropriate Socket.IO rooms
 */
async function handleMeetingEvent(payload: EventPayload): Promise<void> {
  const io = services.get('io') as SocketIOServer | undefined;
  if (!io) {
    logger.warn('[WS_GATEWAY] Socket.IO not available, skipping broadcast');
    return;
  }

  const event = payload as unknown as MeetingEvent;
  
  // Broadcast to organization room
  if (event.organizationId) {
    io.to(`org:${event.organizationId}`).emit('meeting:event', event);
  }
  
  // Broadcast to meeting-specific room
  if (event.meetingId) {
    io.to(`meeting:${event.meetingId}`).emit('meeting:event', event);
  }
  
  logger.debug('[WS_GATEWAY] Broadcasted event', {
    type: event.type,
    meetingId: event.meetingId,
    organizationId: event.organizationId,
  });
}

/**
 * Initialize the WebSocket gateway
 * Subscribes to Redis event bus channels and routes to Socket.IO
 */
export async function initializeWebSocketGateway(): Promise<void> {
  if (isInitialized) {
    logger.warn('[WS_GATEWAY] Already initialized, skipping');
    return;
  }
  
  try {
    // Subscribe to meeting events channel
    unsubscribeFn = await subscribe(
      EVENT_CHANNELS.MEETING_EVENTS,
      handleMeetingEvent
    );
    
    isInitialized = true;
    logger.info('[WS_GATEWAY] Initialized and subscribed to meeting events');
  } catch (err: any) {
    logger.error('[WS_GATEWAY] Failed to initialize', { error: err.message });
    throw err;
  }
}

/**
 * Shutdown the WebSocket gateway
 * Unsubscribes from all channels
 */
export async function shutdownWebSocketGateway(): Promise<void> {
  if (unsubscribeFn) {
    unsubscribeFn();
    unsubscribeFn = null;
  }
  isInitialized = false;
  logger.info('[WS_GATEWAY] Shutdown complete');
}

/**
 * Check if gateway is initialized
 */
export function isGatewayInitialized(): boolean {
  return isInitialized;
}

/**
 * Setup Socket.IO room management for meetings
 * Call this after Socket.IO is initialized
 */
export function setupMeetingRooms(io: SocketIOServer): void {
  io.on('connection', (socket) => {
    // Join meeting room
    socket.on('meeting:join-room', (meetingId: string) => {
      if (meetingId && typeof meetingId === 'string') {
        socket.join(`meeting:${meetingId}`);
        logger.debug('[WS_GATEWAY] Socket joined meeting room', {
          socketId: socket.id,
          meetingId,
        });
      }
    });
    
    // Leave meeting room
    socket.on('meeting:leave-room', (meetingId: string) => {
      if (meetingId && typeof meetingId === 'string') {
        socket.leave(`meeting:${meetingId}`);
        logger.debug('[WS_GATEWAY] Socket left meeting room', {
          socketId: socket.id,
          meetingId,
        });
      }
    });

    // Handle live captions from participants (browser speech recognition)
    socket.on('meeting:caption:send', (data: { meetingId: string; text: string; speaker: string }) => {
      if (!data?.meetingId || !data?.text) return;
      
      // Broadcast caption to all participants in the meeting room (except sender)
      socket.to(`meeting:${data.meetingId}`).emit('meeting:caption', {
        meetingId: data.meetingId,
        speaker: data.speaker || 'Unknown',
        text: data.text,
        timestamp: Date.now(),
      });
      
      logger.debug('[WS_GATEWAY] Caption broadcasted', {
        meetingId: data.meetingId,
        speaker: data.speaker,
        textLength: data.text.length,
      });
    });
  });
  
  logger.info('[WS_GATEWAY] Meeting room handlers registered');
}
