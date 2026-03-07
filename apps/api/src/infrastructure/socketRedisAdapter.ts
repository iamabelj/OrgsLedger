// ============================================================
// OrgsLedger — Socket.IO Redis Adapter Setup
// Enables Socket.IO to broadcast across multiple API instances.
// When multiple API pods run behind a load balancer, this ensures
// a message emitted on Pod A reaches clients connected to Pod B.
//
// Integration: call setupRedisAdapter(io) after setupSocketIO().
// Requires: @socket.io/redis-adapter + redis packages
// ============================================================

import { Server as SocketIOServer } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import { logger } from '../logger';

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);

/**
 * Attach the Redis Pub/Sub adapter to Socket.IO.
 * This is a non-breaking addition — if Redis is unavailable,
 * Socket.IO falls back to in-memory adapter (single-instance mode).
 */
export async function setupRedisAdapter(io: SocketIOServer): Promise<boolean> {
  // Only enable when explicitly opted in or running multiple instances
  if (process.env.SOCKETIO_REDIS_ADAPTER !== 'true') {
    logger.info('[SOCKETIO_ADAPTER] Redis adapter disabled (set SOCKETIO_REDIS_ADAPTER=true)');
    return false;
  }

  try {
    const pubClient = createClient({
      url: `redis://${REDIS_HOST}:${REDIS_PORT}`,
      socket: {
        reconnectStrategy: (retries) => Math.min(retries * 500, 5000),
      },
    });

    const subClient = pubClient.duplicate();

    pubClient.on('error', (err) => {
      logger.warn('[SOCKETIO_ADAPTER] Redis pub client error', err);
    });

    subClient.on('error', (err) => {
      logger.warn('[SOCKETIO_ADAPTER] Redis sub client error', err);
    });

    await Promise.all([pubClient.connect(), subClient.connect()]);

    io.adapter(createAdapter(pubClient, subClient) as any);

    logger.info(`[SOCKETIO_ADAPTER] Redis adapter connected (${REDIS_HOST}:${REDIS_PORT})`);
    return true;
  } catch (err) {
    logger.error('[SOCKETIO_ADAPTER] Failed to connect — falling back to in-memory adapter', err);
    return false;
  }
}
