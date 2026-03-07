// ============================================================
// OrgsLedger — NATS JetStream Client
// Singleton NATS connection with automatic reconnect.
// Used by the event bridge to publish/subscribe domain events.
// ============================================================

import { connect, NatsConnection, JetStreamClient, JetStreamManager, StringCodec } from 'nats';
import { logger } from '../../logger';

const sc = StringCodec();

let nc: NatsConnection | null = null;
let js: JetStreamClient | null = null;
let jsm: JetStreamManager | null = null;

const NATS_URL = process.env.NATS_URL || 'nats://localhost:4222';

/**
 * Connect to NATS and initialize JetStream.
 * Safe to call multiple times — returns existing connection.
 */
export async function getNatsConnection(): Promise<NatsConnection> {
  if (nc && !nc.isClosed()) return nc;

  nc = await connect({
    servers: NATS_URL,
    name: `orgsledger-api-${process.pid}`,
    reconnect: true,
    maxReconnectAttempts: -1, // infinite
    reconnectTimeWait: 2000,
    pingInterval: 30_000,
  });

  nc.closed().then(() => {
    logger.warn('[NATS] Connection closed');
    nc = null;
    js = null;
    jsm = null;
  });

  logger.info(`[NATS] Connected to ${NATS_URL}`);
  return nc;
}

/**
 * Get the JetStream client for publishing.
 */
export async function getJetStream(): Promise<JetStreamClient> {
  if (js) return js;
  const conn = await getNatsConnection();
  js = conn.jetstream();
  return js;
}

/**
 * Get the JetStream Manager for stream/consumer management.
 */
export async function getJetStreamManager(): Promise<JetStreamManager> {
  if (jsm) return jsm;
  const conn = await getNatsConnection();
  jsm = await conn.jetstreamManager();
  return jsm;
}

/**
 * Ensure all required streams exist. Idempotent — safe on every startup.
 */
export async function ensureStreams(): Promise<void> {
  const mgr = await getJetStreamManager();

  const streams = [
    {
      name: 'MEETINGS',
      subjects: ['meeting.started', 'meeting.ended', 'meeting.participant.joined', 'meeting.participant.left'],
      max_age: 24 * 60 * 60 * 1e9, // 24h in nanoseconds
      max_bytes: 1_000_000_000, // 1GB
      num_replicas: 1, // increase to 3 in production cluster
    },
    {
      name: 'AUDIO',
      subjects: ['audio.chunk.*'],
      max_age: 1 * 60 * 60 * 1e9, // 1h
      max_bytes: 50_000_000_000, // 50GB
      num_replicas: 1,
    },
    {
      name: 'TRANSCRIPTS',
      subjects: ['transcript.interim.*', 'transcript.final.*'],
      max_age: 24 * 60 * 60 * 1e9,
      max_bytes: 5_000_000_000, // 5GB
      num_replicas: 1,
    },
    {
      name: 'TRANSLATIONS',
      subjects: ['translation.completed.*'],
      max_age: 24 * 60 * 60 * 1e9,
      max_bytes: 5_000_000_000,
      num_replicas: 1,
    },
    {
      name: 'MINUTES',
      subjects: ['minutes.requested', 'minutes.generated'],
      max_age: 7 * 24 * 60 * 60 * 1e9, // 7d
      max_bytes: 1_000_000_000,
      num_replicas: 1,
    },
  ];

  for (const cfg of streams) {
    try {
      await mgr.streams.add({
        name: cfg.name,
        subjects: cfg.subjects,
        max_age: cfg.max_age,
        max_bytes: cfg.max_bytes,
        num_replicas: cfg.num_replicas,
        retention: 'limits' as any,
        storage: 'file' as any,
        discard: 'old' as any,
      });
      logger.info(`[NATS] Stream ${cfg.name} created/verified`);
    } catch (err: any) {
      // Stream already exists with same config — safe to ignore
      if (err.message?.includes('already in use')) {
        logger.debug(`[NATS] Stream ${cfg.name} already exists`);
      } else {
        logger.error(`[NATS] Failed to create stream ${cfg.name}`, err);
      }
    }
  }
}

/**
 * Publish a JSON event to a NATS JetStream subject.
 */
export async function publishEvent(subject: string, payload: Record<string, any>): Promise<void> {
  try {
    const jetstream = await getJetStream();
    const data = sc.encode(JSON.stringify(payload));
    await jetstream.publish(subject, data);
    logger.debug(`[NATS] Published ${subject}`, { meetingId: payload.meetingId });
  } catch (err) {
    // Non-fatal: NATS is an enhancement, not required for the monolith
    logger.warn(`[NATS] Failed to publish ${subject}`, err);
  }
}

/**
 * Graceful disconnect.
 */
export async function closeNats(): Promise<void> {
  if (nc && !nc.isClosed()) {
    await nc.drain();
    logger.info('[NATS] Connection drained');
  }
}

export { sc, StringCodec };
