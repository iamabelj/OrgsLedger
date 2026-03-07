// ============================================================
// OrgsLedger — Standalone Transcription Worker
// Manages Deepgram WebSocket streams independently.
// Subscribes to audio chunks from NATS, publishes transcripts.
//
// Each instance handles up to 500 concurrent Deepgram streams.
//
// Usage: node dist/workers/standalone/transcriptionWorker.js
// Env:   NATS_URL, DEEPGRAM_API_KEY
// ============================================================

import { connect, StringCodec, ConsumerConfig } from 'nats';
import { DeepgramClient } from '@deepgram/sdk';
import { logger } from '../../logger';

const sc = StringCodec();

const NATS_URL = process.env.NATS_URL || 'nats://localhost:4222';
const WORKER_ID = `transcription-worker-${process.pid}`;
const MAX_STREAMS = parseInt(process.env.MAX_STREAMS || '500', 10);

// Active Deepgram streams: streamId -> connection
const activeStreams = new Map<string, any>();

async function main() {
  logger.info(`[${WORKER_ID}] Starting standalone transcription worker (max ${MAX_STREAMS} streams)`);

  if (!process.env.DEEPGRAM_API_KEY) {
    logger.error(`[${WORKER_ID}] DEEPGRAM_API_KEY not set`);
    process.exit(1);
  }

  const deepgram = new DeepgramClient({ apiKey: process.env.DEEPGRAM_API_KEY });

  // Connect to NATS
  const nc = await connect({
    servers: NATS_URL,
    name: WORKER_ID,
    reconnect: true,
    maxReconnectAttempts: -1,
  });

  const js = nc.jetstream();

  // Subscribe to audio chunks (queue group for load balancing)
  const sub = await js.subscribe('audio.chunk.*', {
    queue: 'transcription-workers',
    config: {
      durable_name: 'transcription-workers',
      ack_policy: 'explicit' as any,
      max_deliver: 3,
      ack_wait: 5_000_000_000, // 5 seconds
    } as Partial<ConsumerConfig>,
  });

  logger.info(`[${WORKER_ID}] Subscribed to audio.chunk.*`);

  for await (const msg of sub) {
    try {
      const event = JSON.parse(sc.decode(msg.data));
      const streamId = `${event.meetingId}:${event.participantId}`;

      // Get or create Deepgram stream for this participant
      let stream = activeStreams.get(streamId);

      if (!stream && activeStreams.size < MAX_STREAMS) {
        // Create new Deepgram stream
        stream = await createDeepgramStream(deepgram, streamId, event, js);
        if (stream) {
          activeStreams.set(streamId, stream);
        }
      }

      if (stream && event.audioData) {
        // Forward audio chunk to Deepgram
        const buffer = Buffer.from(event.audioData, 'base64');
        stream.socket.send(buffer);
      }

      msg.ack();
    } catch (err) {
      logger.error(`[${WORKER_ID}] Audio chunk processing failed`, err);
      msg.nak();
    }
  }
}

async function createDeepgramStream(
  deepgram: DeepgramClient,
  streamId: string,
  event: any,
  js: any
): Promise<any> {
  try {
    const connection = await deepgram.listen.v1.connect({
      model: 'nova-3',
      language: 'multi',
      punctuate: true,
      smart_format: true,
      diarize: true,
      interim_results: true,
      endpointing: 300,
      utterance_end_ms: 3000,
    } as any);

    connection.on('message', async (data: any) => {
      if (data.type !== 'Results') return;

      const transcript = data.channel?.alternatives?.[0];
      if (!transcript?.transcript) return;

      const text = transcript.transcript.trim();
      if (!text) return;

      const isFinal = data.is_final === true;
      const language = data.channel?.detected_language || 'en';
      const confidence = transcript.confidence || 0;

      const subject = isFinal
        ? `transcript.final.${event.meetingId}`
        : `transcript.interim.${event.meetingId}`;

      await js.publish(subject, sc.encode(JSON.stringify({
        meetingId: event.meetingId,
        speakerId: event.participantId,
        speakerName: event.participantName || 'Unknown',
        text,
        language,
        isFinal,
        confidence,
        timestamp: new Date().toISOString(),
      })));
    });

    connection.on('close', () => {
      activeStreams.delete(streamId);
      logger.debug(`[${WORKER_ID}] Deepgram stream closed: ${streamId}`);
    });

    connection.on('error', (err: Error) => {
      logger.error(`[${WORKER_ID}] Deepgram stream error: ${streamId}`, err);
      activeStreams.delete(streamId);
    });

    connection.connect();
    await connection.waitForOpen();

    logger.debug(`[${WORKER_ID}] Deepgram stream created: ${streamId}`);
    return connection;
  } catch (err) {
    logger.error(`[${WORKER_ID}] Failed to create Deepgram stream: ${streamId}`, err);
    return null;
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info(`[${WORKER_ID}] Shutting down — closing ${activeStreams.size} streams`);
  for (const [id, stream] of activeStreams) {
    try { stream.finalize(); } catch {}
  }
  process.exit(0);
});

main().catch((err) => {
  logger.error(`[${WORKER_ID}] Fatal error`, err);
  process.exit(1);
});
