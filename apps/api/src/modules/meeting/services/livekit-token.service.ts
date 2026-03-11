// ============================================================
// OrgsLedger API — LiveKit Token Service
// Generates LiveKit tokens for meeting participants
// Manages room creation and access control
// ============================================================

import { AccessToken, RoomServiceClient, VideoGrant } from 'livekit-server-sdk';
import { config } from '../../../config';
import { logger } from '../../../logger';

// ── Types ───────────────────────────────────────────────────

export interface ParticipantTokenRequest {
  meetingId: string;
  userId: string;
  name: string;
  role: 'host' | 'participant' | 'bot';
}

export interface LiveKitTokenResponse {
  token: string;
  url: string;
  roomName: string;
}

// ── Configuration ───────────────────────────────────────────

const LIVEKIT_URL = config.livekit?.url || '';
const LIVEKIT_API_KEY = config.livekit?.apiKey || '';
const LIVEKIT_API_SECRET = config.livekit?.apiSecret || '';

// Token validity (6 hours for meetings)
const TOKEN_TTL_SECONDS = 6 * 60 * 60;

// ── Room Service Client (lazy init) ─────────────────────────

let roomServiceClient: RoomServiceClient | null = null;

function getRoomServiceClient(): RoomServiceClient {
  if (!roomServiceClient) {
    if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
      throw new Error('LiveKit API credentials not configured');
    }
    // Extract HTTP URL from WebSocket URL
    const httpUrl = LIVEKIT_URL.replace('wss://', 'https://').replace('ws://', 'http://');
    roomServiceClient = new RoomServiceClient(httpUrl, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
  }
  return roomServiceClient;
}

// ── Service Functions ───────────────────────────────────────

/**
 * Create a LiveKit room if it doesn't exist
 * Room name = meetingId for simplicity
 */
export async function createRoomIfNotExists(meetingId: string): Promise<void> {
  if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    logger.warn('[LIVEKIT] Credentials not configured, skipping room creation');
    return;
  }

  const client = getRoomServiceClient();
  const roomName = meetingId;

  try {
    // List rooms to check if exists
    const rooms = await client.listRooms([roomName]);
    
    if (rooms.length === 0) {
      // Create the room
      await client.createRoom({
        name: roomName,
        // Empty room cleanup after 5 minutes
        emptyTimeout: 300,
        // Max duration 12 hours
        maxParticipants: 100,
      });
      logger.info('[LIVEKIT] Room created', { roomName });
    } else {
      logger.debug('[LIVEKIT] Room already exists', { roomName });
    }
  } catch (err: any) {
    logger.error('[LIVEKIT] Failed to create room', {
      roomName,
      error: err.message,
    });
    throw err;
  }
}

/**
 * Generate a LiveKit access token for a participant
 */
export async function generateParticipantToken(
  request: ParticipantTokenRequest
): Promise<LiveKitTokenResponse> {
  const { meetingId, userId, name, role } = request;
  const roomName = meetingId;

  if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    throw new Error('LiveKit API credentials not configured');
  }

  // Create access token
  const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity: userId,
    name: name,
    ttl: TOKEN_TTL_SECONDS,
  });

  // Configure video grant based on role
  const videoGrant: VideoGrant = {
    roomJoin: true,
    room: roomName,
    canSubscribe: true,
    canPublish: role !== 'bot', // Bots don't publish, only subscribe
    canPublishData: true,
  };

  // Host gets additional permissions
  if (role === 'host') {
    videoGrant.roomAdmin = true;
    videoGrant.roomRecord = true;
  }

  // Bot is hidden
  if (role === 'bot') {
    videoGrant.hidden = true;
  }

  token.addGrant(videoGrant);

  const jwt = await token.toJwt();

  logger.info('[LIVEKIT] Token generated', {
    meetingId,
    userId,
    role,
    roomName,
  });

  return {
    token: jwt,
    url: LIVEKIT_URL,
    roomName,
  };
}

/**
 * Delete a LiveKit room when meeting ends
 */
export async function deleteRoom(meetingId: string): Promise<void> {
  if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    return;
  }

  const client = getRoomServiceClient();
  const roomName = meetingId;

  try {
    await client.deleteRoom(roomName);
    logger.info('[LIVEKIT] Room deleted', { roomName });
  } catch (err: any) {
    // Room might not exist, that's OK
    logger.warn('[LIVEKIT] Failed to delete room', {
      roomName,
      error: err.message,
    });
  }
}

/**
 * Get list of participants in a room
 */
export async function getRoomParticipants(meetingId: string): Promise<any[]> {
  if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    return [];
  }

  const client = getRoomServiceClient();
  const roomName = meetingId;

  try {
    const participants = await client.listParticipants(roomName);
    return participants;
  } catch (err: any) {
    logger.warn('[LIVEKIT] Failed to list participants', {
      roomName,
      error: err.message,
    });
    return [];
  }
}

/**
 * Remove a participant from a room
 */
export async function removeParticipant(
  meetingId: string,
  userId: string
): Promise<void> {
  if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    return;
  }

  const client = getRoomServiceClient();

  try {
    await client.removeParticipant(meetingId, userId);
    logger.info('[LIVEKIT] Participant removed', { meetingId, userId });
  } catch (err: any) {
    logger.warn('[LIVEKIT] Failed to remove participant', {
      meetingId,
      userId,
      error: err.message,
    });
  }
}
