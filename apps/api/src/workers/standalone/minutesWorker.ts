// ============================================================
// OrgsLedger — Standalone Minutes Worker
// Subscribes to NATS minutes.requested events, generates
// AI-powered meeting summaries, and publishes results.
//
// Usage: node dist/workers/standalone/minutesWorker.js
// Env:   NATS_URL, REDIS_HOST, OPENAI_API_KEY, DATABASE_URL
// ============================================================

import { connect, StringCodec, ConsumerConfig } from 'nats';
import { logger } from '../../logger';
import { tryClaimEvent } from '../../services/eventDedup';

const sc = StringCodec();

const NATS_URL = process.env.NATS_URL || 'nats://localhost:4222';
const WORKER_ID = `minutes-worker-${process.pid}`;

interface MinutesRequestEvent {
  meetingId: string;
  organizationId: string;
  requestedBy?: string;
  timestamp: string;
}

async function main() {
  logger.info(`[${WORKER_ID}] Starting standalone minutes worker`);

  const nc = await connect({
    servers: NATS_URL,
    name: WORKER_ID,
    reconnect: true,
    maxReconnectAttempts: -1,
  });

  const js = nc.jetstream();

  const sub = await js.subscribe('minutes.requested', {
    queue: 'minutes-workers',
    config: {
      durable_name: 'minutes-workers',
      ack_policy: 'explicit' as any,
      max_deliver: 3,
      ack_wait: 300_000_000_000, // 5 minutes (minutes generation is slow)
    } as Partial<ConsumerConfig>,
  });

  logger.info(`[${WORKER_ID}] Subscribed to minutes.requested`);

  for await (const msg of sub) {
    const t0 = Date.now();

    try {
      const event: MinutesRequestEvent = JSON.parse(sc.decode(msg.data));
      const { meetingId, organizationId } = event;

      // Deduplicate
      const claimed = await tryClaimEvent('minutes', meetingId, 600); // 10 min window
      if (!claimed) {
        logger.debug(`[${WORKER_ID}] Skipping duplicate minutes request for ${meetingId}`);
        msg.ack();
        continue;
      }

      logger.info(`[${WORKER_ID}] Generating minutes for meeting ${meetingId}`);

      // Import the existing minutes service dynamically
      // (avoids loading all dependencies at startup)
      const { MinutesWorkerService } = await import('../../services/workers/minutesWorker.service');

      // Create a minimal IO stub (minutes worker doesn't need Socket.IO)
      const ioStub = {
        to: () => ({ emit: () => {} }),
        emit: () => {},
      } as any;

      const minutesService = new MinutesWorkerService(ioStub);
      const result = await minutesService.generateMinutes(meetingId, organizationId);

      if (result) {
        // Publish completion event
        await js.publish('minutes.generated', sc.encode(JSON.stringify({
          meetingId,
          organizationId,
          minutesId: result.id || meetingId,
          summaryLength: result.summary?.length || 0,
          generationTimeMs: Date.now() - t0,
          timestamp: new Date().toISOString(),
        })));

        logger.info(`[${WORKER_ID}] Minutes generated for ${meetingId} in ${Date.now() - t0}ms`);
      }

      msg.ack();
    } catch (err) {
      logger.error(`[${WORKER_ID}] Minutes generation failed`, err);
      msg.nak();
    }
  }
}

main().catch((err) => {
  logger.error(`[${WORKER_ID}] Fatal error`, err);
  process.exit(1);
});
