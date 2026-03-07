// ============================================================
// OrgsLedger — Standalone Broadcast Worker
// Subscribes to NATS translation.completed events and emits
// Socket.IO events to meeting rooms via Redis Pub/Sub adapter.
//
// Usage: node dist/workers/standalone/broadcastWorker.js
// Env:   NATS_URL, REDIS_HOST, PORT (for Socket.IO adapter)
// ============================================================

import { connect, StringCodec, ConsumerConfig } from 'nats';
import { createAdapter } from '@socket.io/redis-adapter';
import { Server as SocketIOServer } from 'socket.io';
import { createServer } from 'http';
import { createClient } from 'redis';
import { logger } from '../../logger';

const sc = StringCodec();

const NATS_URL = process.env.NATS_URL || 'nats://localhost:4222';
const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);
const PORT = parseInt(process.env.BROADCAST_PORT || '3001', 10);
const WORKER_ID = `broadcast-worker-${process.pid}`;

interface TranslationEvent {
  meetingId: string;
  speakerId: string;
  speakerName: string;
  originalText: string;
  sourceLanguage: string;
  translations: Record<string, string>;
  isFinal: boolean;
  timestamp: string;
}

async function main() {
  logger.info(`[${WORKER_ID}] Starting standalone broadcast worker`);

  // Create Socket.IO server with Redis adapter for multi-instance broadcast
  const httpServer = createServer();
  const io = new SocketIOServer(httpServer, {
    cors: { origin: '*' },
    adapter: undefined, // Set below after Redis connects
  });

  // Setup Redis adapter for Socket.IO
  const pubClient = createClient({ url: `redis://${REDIS_HOST}:${REDIS_PORT}` });
  const subClient = pubClient.duplicate();
  await Promise.all([pubClient.connect(), subClient.connect()]);
  io.adapter(createAdapter(pubClient, subClient) as any);

  logger.info(`[${WORKER_ID}] Socket.IO Redis adapter connected`);

  // Connect to NATS
  const nc = await connect({
    servers: NATS_URL,
    name: WORKER_ID,
    reconnect: true,
    maxReconnectAttempts: -1,
  });

  const js = nc.jetstream();

  // Subscribe to translation results
  const sub = await js.subscribe('translation.completed.*', {
    queue: 'broadcast-workers',
    config: {
      durable_name: 'broadcast-workers',
      ack_policy: 'explicit' as any,
      max_deliver: 5,
      ack_wait: 10_000_000_000, // 10 seconds
    } as Partial<ConsumerConfig>,
  });

  logger.info(`[${WORKER_ID}] Subscribed to translation.completed.*`);

  // Start HTTP server (for health checks and Socket.IO handshake)
  httpServer.listen(PORT, () => {
    logger.info(`[${WORKER_ID}] Listening on port ${PORT}`);
  });

  // Process translation events and broadcast
  for await (const msg of sub) {
    try {
      const event: TranslationEvent = JSON.parse(sc.decode(msg.data));
      const { meetingId, isFinal } = event;

      const eventName = isFinal ? 'translation:result' : 'translation:interim';
      const payload = {
        speakerId: event.speakerId,
        speakerName: event.speakerName,
        originalText: event.originalText,
        sourceLanguage: event.sourceLanguage,
        translations: event.translations,
        timestamp: event.timestamp,
      };

      // Broadcast to all clients in the meeting room via Redis adapter
      io.to(`meeting:${meetingId}`).emit(eventName, payload);

      msg.ack();

      logger.debug(`[${WORKER_ID}] Broadcast ${eventName} to meeting:${meetingId}`);
    } catch (err) {
      logger.error(`[${WORKER_ID}] Broadcast failed`, err);
      msg.nak();
    }
  }
}

main().catch((err) => {
  logger.error(`[${WORKER_ID}] Fatal error`, err);
  process.exit(1);
});
