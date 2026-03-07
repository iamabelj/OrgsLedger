// ============================================================
// OrgsLedger — Standalone Translation Worker
// Runs as an independent process/container, subscribes to
// NATS transcript events, translates, and publishes results.
//
// This is the SAME translation logic from the monolith,
// extracted into a standalone entry point for horizontal scaling.
//
// Usage: node dist/workers/standalone/translationWorker.js
// Env:   NATS_URL, REDIS_HOST, OPENAI_API_KEY
// ============================================================

import { connect, StringCodec, JetStreamClient, ConsumerConfig } from 'nats';
import { logger } from '../../logger';
import { translateText } from '../../services/translation.service';
import { getCachedTranslation, setCachedTranslation } from '../../services/translationCache';
import { normalizeLang, isSameLang } from '../../utils/langNormalize';
import { getTargetLanguages } from '../../services/meetingState';
import { tryClaimEvent, buildEventId } from '../../services/eventDedup';
import { recordTranslationLatency } from '../../services/translationMetrics';

const sc = StringCodec();

const NATS_URL = process.env.NATS_URL || 'nats://localhost:4222';
const WORKER_ID = `translation-worker-${process.pid}`;
const BATCH_SIZE = 5; // Max parallel GPT calls per job

interface TranscriptEvent {
  meetingId: string;
  speakerId: string;
  speakerName: string;
  text: string;
  language: string;
  confidence: number;
  timestamp: string;
}

async function main() {
  logger.info(`[${WORKER_ID}] Starting standalone translation worker`);

  // Connect to NATS
  const nc = await connect({
    servers: NATS_URL,
    name: WORKER_ID,
    reconnect: true,
    maxReconnectAttempts: -1,
    reconnectTimeWait: 2000,
  });

  const js = nc.jetstream();

  // Subscribe to final transcripts as a queue group (load-balanced)
  const sub = await js.subscribe('transcript.final.*', {
    queue: 'translation-workers', // Queue group for round-robin
    config: {
      durable_name: 'translation-workers',
      ack_policy: 'explicit' as any,
      max_deliver: 3,
      ack_wait: 30_000_000_000, // 30 seconds in nanoseconds
    } as Partial<ConsumerConfig>,
  });

  logger.info(`[${WORKER_ID}] Subscribed to transcript.final.*`);

  // Process messages
  for await (const msg of sub) {
    const t0 = Date.now();

    try {
      const event: TranscriptEvent = JSON.parse(sc.decode(msg.data));
      const { meetingId, speakerId, speakerName, text, language } = event;

      // Deduplicate
      const eventId = buildEventId(meetingId, speakerId, text, event.timestamp);
      const claimed = await tryClaimEvent('translation', eventId);
      if (!claimed) {
        msg.ack();
        continue;
      }

      const src = normalizeLang(language);

      // Get target languages from Redis meeting state
      const targetLangs = await getTargetLanguages(meetingId, src);

      if (targetLangs.length === 0) {
        msg.ack();
        continue;
      }

      // Translate with cache
      const translations: Record<string, string> = {};
      const misses: string[] = [];

      // Check cache first
      const cacheResults = await Promise.all(
        targetLangs.map(async (tl) => ({
          lang: tl,
          cached: await getCachedTranslation(text, src, tl),
        }))
      );

      for (const { lang, cached } of cacheResults) {
        if (cached !== null) {
          translations[lang] = cached;
        } else {
          misses.push(lang);
        }
      }

      // Translate cache misses in parallel batches
      for (let i = 0; i < misses.length; i += BATCH_SIZE) {
        const batch = misses.slice(i, i + BATCH_SIZE);
        const results = await Promise.all(
          batch.map(async (tl) => {
            try {
              const result = await translateText(text, tl, src);
              setCachedTranslation(text, src, tl, result.translatedText).catch(() => {});
              return { lang: tl, text: result.translatedText };
            } catch (err) {
              logger.warn(`[${WORKER_ID}] Translation ${src}->${tl} failed`, err);
              return { lang: tl, text: text }; // Fallback to original
            }
          })
        );

        for (const r of results) {
          translations[r.lang] = r.text;
        }
      }

      // Publish translation result to NATS
      const resultPayload = {
        meetingId,
        speakerId,
        speakerName,
        originalText: text,
        sourceLanguage: src,
        translations,
        isFinal: true,
        latencyMs: Date.now() - t0,
        timestamp: new Date().toISOString(),
      };

      await js.publish(
        `translation.completed.${meetingId}`,
        sc.encode(JSON.stringify(resultPayload))
      );

      recordTranslationLatency(Date.now() - t0);
      msg.ack();

      logger.debug(`[${WORKER_ID}] Translated "${text.slice(0, 30)}..." to ${targetLangs.length} langs in ${Date.now() - t0}ms`);
    } catch (err) {
      logger.error(`[${WORKER_ID}] Translation job failed`, err);
      msg.nak(); // Negative ack — NATS will redeliver
    }
  }
}

// Run
main().catch((err) => {
  logger.error(`[${WORKER_ID}] Fatal error`, err);
  process.exit(1);
});
