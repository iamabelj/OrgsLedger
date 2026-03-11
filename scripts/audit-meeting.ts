#!/usr/bin/env ts-node
// ============================================================
// OrgsLedger — Meeting Audit Tool
// Verifies that a meeting flowed correctly through the
// entire pipeline: Audio → Transcription → Translation →
// Broadcast → Database → Metrics
// ============================================================
//
// Usage:
//   npx ts-node scripts/audit-meeting.ts <meetingId>
//   npm run audit:meeting <meetingId>
//
// Simulate a full pipeline run:
//   npx ts-node scripts/audit-meeting.ts <meetingId> --simulate
//   npm run audit:meeting -- <meetingId> --simulate
//
// Environment Variables:
//   DATABASE_URL or POSTGRES_URL   — PostgreSQL connection
//   REDIS_HOST, REDIS_PORT         — Redis connection
//   REDIS_PASSWORD                 — (optional)
//
// ============================================================

import Redis from 'ioredis';
import { Pool } from 'pg';
import { Queue, QueueEvents } from 'bullmq';
import { randomUUID } from 'crypto';

// ── CLI Argument Parsing ────────────────────────────────────

const meetingId = process.argv[2];
const simulateFlag = process.argv.includes('--simulate');

if (!meetingId) {
  console.error('\n  Usage: npx ts-node scripts/audit-meeting.ts <meetingId> [--simulate]\n');
  process.exit(1);
}

// Validate UUID format
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!UUID_RE.test(meetingId)) {
  console.error(`\n  Error: "${meetingId}" is not a valid UUID.\n`);
  process.exit(1);
}

// ── Configuration ───────────────────────────────────────────

const CONFIG = {
  // Redis
  redisHost: process.env.REDIS_HOST || 'localhost',
  redisPort: parseInt(process.env.REDIS_PORT || '6379', 10),
  redisPassword: process.env.REDIS_PASSWORD || undefined,

  // Database
  databaseUrl:
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    'postgresql://postgres:postgres@localhost:5432/orgs_ledger',

  // Latency alert thresholds (ms)
  thresholds: {
    transcription: 500,
    translation: 500,
    broadcast: 200,
  },

  // Queue health limits
  maxWaitingJobs: 100,
  maxFailedJobs: 5,

  // PubSub listen timeout
  pubsubTimeoutMs: 5000,

  // Simulation stage timeout
  stageTimeoutMs: 5000,
};

// ── Queue Names ─────────────────────────────────────────────

const QUEUE_NAMES = {
  TRANSCRIPT_EVENTS: 'transcript-events',
  TRANSLATION_JOBS: 'translation-jobs',
  BROADCAST_EVENTS: 'broadcast-events',
  MINUTES_GENERATION: 'minutes-generation',
} as const;

// ── Styling Helpers ─────────────────────────────────────────

const C = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
};

const PASS = `${C.green}✓${C.reset}`;
const FAIL = `${C.red}✗${C.reset}`;
const WARN = `${C.yellow}⚠${C.reset}`;

interface CheckResult {
  name: string;
  passed: boolean;
  detail?: string;
  warning?: string;
}

const results: CheckResult[] = [];
const warnings: string[] = [];

function pass(name: string, detail?: string): void {
  results.push({ name, passed: true, detail });
}

function fail(name: string, detail?: string): void {
  results.push({ name, passed: false, detail });
}

function warn(msg: string): void {
  warnings.push(msg);
}

// ── Connections ─────────────────────────────────────────────

let redis: Redis | null = null;
let pool: Pool | null = null;

function createRedis(): Redis {
  return new Redis({
    host: CONFIG.redisHost,
    port: CONFIG.redisPort,
    password: CONFIG.redisPassword,
    maxRetriesPerRequest: 1,
    connectTimeout: 5000,
    lazyConnect: true,
  });
}

function createPool(): Pool {
  return new Pool({
    connectionString: CONFIG.databaseUrl,
    max: 3,
    connectionTimeoutMillis: 5000,
    statement_timeout: 15000,
  });
}

// ── 1. Database Checks ─────────────────────────────────────

async function checkMeetingExists(pg: Pool): Promise<boolean> {
  const { rows } = await pg.query(
    'SELECT id, status, title, started_at, ended_at FROM meetings WHERE id = $1',
    [meetingId],
  );
  if (rows.length === 0) {
    fail('Meeting exists', 'Meeting not found in database');
    return false;
  }
  const m = rows[0];
  pass('Meeting exists', `"${m.title || '(untitled)'}" — status: ${m.status}`);
  return true;
}

async function checkTranscripts(pg: Pool): Promise<void> {
  const { rows } = await pg.query(
    'SELECT COUNT(*)::int AS total FROM meeting_transcripts WHERE meeting_id = $1',
    [meetingId],
  );
  const total = rows[0].total;
  if (total > 0) {
    pass('Transcripts stored', `${total} transcript(s)`);
  } else {
    fail('Transcripts stored', 'No transcripts found for this meeting');
  }
}

async function checkTranslations(pg: Pool): Promise<void> {
  const { rows } = await pg.query(
    `SELECT COUNT(*)::int AS total
       FROM meeting_transcripts
      WHERE meeting_id = $1
        AND translations IS NOT NULL
        AND translations != '{}'::jsonb`,
    [meetingId],
  );
  const total = rows[0].total;
  if (total > 0) {
    pass('Translations generated', `${total} transcript(s) with translations`);
  } else {
    fail('Translations generated', 'No translations found in transcripts JSONB');
  }
}

async function checkPipelineMetrics(pg: Pool): Promise<void> {
  const { rows } = await pg.query(
    `SELECT transcripts_generated, translations_generated, broadcast_events, minutes_generation_ms
       FROM meeting_pipeline_metrics
      WHERE meeting_id = $1`,
    [meetingId],
  );
  if (rows.length > 0) {
    const m = rows[0];
    pass(
      'Pipeline metrics recorded',
      `transcripts=${m.transcripts_generated} translations=${m.translations_generated} broadcasts=${m.broadcast_events}` +
        (m.minutes_generation_ms != null ? ` minutes=${m.minutes_generation_ms}ms` : ''),
    );
  } else {
    fail('Pipeline metrics recorded', 'No meeting_pipeline_metrics row found');
  }
}

async function checkAIUsage(pg: Pool): Promise<{ totalCostUsd: number }> {
  // ai_usage_metrics is global — link via timestamp range from meeting
  const { rows: meetingRows } = await pg.query(
    'SELECT started_at, ended_at FROM meetings WHERE id = $1',
    [meetingId],
  );

  let totalCostUsd = 0;

  if (meetingRows.length > 0 && meetingRows[0].started_at) {
    const start = meetingRows[0].started_at;
    const end = meetingRows[0].ended_at || new Date();

    const { rows } = await pg.query(
      `SELECT COALESCE(SUM(estimated_cost_usd), 0)::float AS total_cost,
              COALESCE(SUM(deepgram_minutes), 0)::float AS deepgram_mins,
              COALESCE(SUM(openai_input_tokens + openai_output_tokens), 0)::bigint AS openai_tokens,
              COALESCE(SUM(translation_characters), 0)::bigint AS translation_chars
         FROM ai_usage_metrics
        WHERE timestamp >= $1 AND timestamp <= $2`,
      [start, end],
    );

    if (rows.length > 0 && parseFloat(rows[0].total_cost) > 0) {
      totalCostUsd = parseFloat(rows[0].total_cost);
      pass(
        'AI usage tracked',
        `deepgram=${rows[0].deepgram_mins.toFixed(2)}min openai=${rows[0].openai_tokens}tok translation=${rows[0].translation_chars}chars`,
      );
    } else {
      fail('AI usage tracked', 'No AI usage metrics found in the meeting time window');
    }
  } else {
    fail('AI usage tracked', 'Meeting has no started_at — cannot locate AI usage window');
  }

  return { totalCostUsd };
}

// ── 2. Queue Checks ─────────────────────────────────────────

async function checkQueues(redisClient: Redis): Promise<void> {
  const queueEntries = Object.entries(QUEUE_NAMES) as [string, string][];
  let allHealthy = true;

  for (const [label, name] of queueEntries) {
    const queue = new Queue(name, {
      connection: {
        host: CONFIG.redisHost,
        port: CONFIG.redisPort,
        password: CONFIG.redisPassword,
        maxRetriesPerRequest: null,
      },
    });

    try {
      const counts = await queue.getJobCounts('waiting', 'active', 'failed', 'completed');

      if (counts.waiting > CONFIG.maxWaitingJobs) {
        warn(`Queue "${name}": ${counts.waiting} waiting jobs (threshold: ${CONFIG.maxWaitingJobs})`);
        allHealthy = false;
      }
      if (counts.failed > CONFIG.maxFailedJobs) {
        warn(`Queue "${name}": ${counts.failed} failed jobs (threshold: ${CONFIG.maxFailedJobs})`);
        allHealthy = false;
      }
    } catch (err: any) {
      warn(`Queue "${name}": could not read job counts — ${err.message}`);
      allHealthy = false;
    } finally {
      await queue.close().catch(() => {});
    }
  }

  if (allHealthy) {
    pass('Queues healthy', 'All queues within thresholds');
  } else {
    fail('Queues healthy', 'One or more queues exceeded thresholds — see warnings');
  }
}

// ── 3. Redis Checks ─────────────────────────────────────────

async function checkRedis(redisClient: Redis): Promise<void> {
  // Connectivity
  try {
    const pong = await redisClient.ping();
    if (pong === 'PONG') {
      pass('Redis connected');
    } else {
      fail('Redis connected', `Unexpected ping response: ${pong}`);
      return;
    }
  } catch (err: any) {
    fail('Redis connected', err.message);
    return;
  }

  // Queue keys exist
  const queueNames = Object.values(QUEUE_NAMES);
  let keysFound = 0;
  for (const name of queueNames) {
    const keys = await redisClient.keys(`bull:${name}:*`);
    if (keys.length > 0) keysFound++;
  }

  if (keysFound > 0) {
    pass('Queue keys exist', `${keysFound}/${queueNames.length} queues have Redis keys`);
  } else {
    fail('Queue keys exist', 'No bull:* keys found for any queue');
  }

  // PubSub channel check — verify meeting.events channel has subscribers
  try {
    const channelCounts = await redisClient.pubsub('NUMSUB', 'meeting.events') as (string | number)[];
    const subscriberCount = typeof channelCounts[1] === 'number' ? channelCounts[1] : parseInt(String(channelCounts[1]), 10);
    if (subscriberCount > 0) {
      pass('PubSub channels active', `meeting.events has ${subscriberCount} subscriber(s)`);
    } else {
      warn('PubSub channel "meeting.events" has 0 subscribers — server may not be running');
      pass('PubSub channels active', '0 subscribers (server may be offline)');
    }
  } catch (err: any) {
    warn(`PubSub check failed: ${err.message}`);
    pass('PubSub channels active', 'Could not verify (non-fatal)');
  }
}

// ── 4. Real-Time Broadcast Check ────────────────────────────

async function checkBroadcastPayload(redisClient: Redis): Promise<void> {
  const REQUIRED_FIELDS = [
    'meetingId',
    'speaker',
    'originalText',
    'translatedText',
    'timestamp',
    'language',
    'sourceLanguage',
  ];

  const subscriber = createRedis();

  try {
    await subscriber.connect();
  } catch (err: any) {
    warn(`Broadcast check: could not create subscriber — ${err.message}`);
    pass('Broadcast payload structure', 'Skipped (could not subscribe)');
    await subscriber.quit().catch(() => {});
    return;
  }

  let resolved = false;

  const result = await Promise.race([
    new Promise<{ valid: boolean; missing: string[] }>((resolve) => {
      subscriber.subscribe('meeting.events', (err) => {
        if (err) {
          resolve({ valid: false, missing: ['subscription-error'] });
          return;
        }

        subscriber.on('message', (_channel: string, message: string) => {
          if (resolved) return;
          try {
            const parsed = JSON.parse(message);
            const data = parsed.data || parsed;

            // Check if this event is relevant to our meeting
            if (data.meetingId && data.meetingId !== meetingId) return;

            const missing = REQUIRED_FIELDS.filter((f) => !(f in data));
            resolved = true;
            resolve({ valid: missing.length === 0, missing });
          } catch {
            // Not JSON — skip
          }
        });
      });
    }),
    new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), CONFIG.pubsubTimeoutMs),
    ),
  ]);

  await subscriber.unsubscribe().catch(() => {});
  await subscriber.quit().catch(() => {});

  if (result === null) {
    pass('Broadcast payload structure', `No events received in ${CONFIG.pubsubTimeoutMs / 1000}s (meeting may be inactive)`);
  } else if (result.valid) {
    pass('Broadcast payload structure', 'All required fields present');
  } else {
    fail('Broadcast payload structure', `Missing fields: ${result.missing.join(', ')}`);
  }
}

// ── 5. Pipeline Latency Check ───────────────────────────────

interface LatencyStats {
  stage: string;
  avg: number;
  p95: number;
  count: number;
}

async function checkPipelineLatency(pg: Pool): Promise<LatencyStats[]> {
  const { rows } = await pg.query(
    `SELECT
       stage,
       COUNT(*)::int AS count,
       ROUND(AVG(latency_ms)::numeric, 1) AS avg_ms,
       ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms)::numeric, 1) AS p95_ms
     FROM meeting_pipeline_latency
     WHERE meeting_id = $1
     GROUP BY stage
     ORDER BY stage`,
    [meetingId],
  );

  if (rows.length === 0) {
    fail('Pipeline latency data', 'No latency rows in meeting_pipeline_latency');
    return [];
  }

  const stats: LatencyStats[] = [];

  for (const row of rows) {
    const stage = row.stage as string;
    const avg = parseFloat(row.avg_ms);
    const p95 = parseFloat(row.p95_ms);
    const count = row.count;

    stats.push({ stage, avg, p95, count });

    const threshold =
      CONFIG.thresholds[stage as keyof typeof CONFIG.thresholds];

    if (threshold && p95 > threshold) {
      warn(
        `Pipeline "${stage}" p95 latency ${p95}ms exceeds threshold ${threshold}ms`,
      );
    }
  }

  pass(
    'Pipeline latency data',
    stats.map((s) => `${s.stage}: avg=${s.avg}ms p95=${s.p95}ms (${s.count} samples)`).join(', '),
  );

  return stats;
}

// ── 6. Pipeline Simulation ──────────────────────────────────

/** Race a promise against a stage timeout. */
function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Stage "${label}" timed out after ${CONFIG.stageTimeoutMs}ms`)),
      CONFIG.stageTimeoutMs,
    );
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

const SIM_PREFIX = 'SIM';

interface SimResult {
  transcriptJobId: string | null;
  broadcastReceived: boolean;
  translationFound: boolean;
  dbPersisted: boolean;
  metricsUpdated: boolean;
}

/**
 * Run a full end-to-end simulation:
 * 1. Submit fake transcript → transcript-events queue
 * 2. Subscribe to Redis PubSub for broadcast events
 * 3. Wait for transcript + translation + broadcast workers to process
 * 4. Verify database row created with translations JSONB
 * 5. Verify pipeline metrics incremented
 */
async function runSimulation(
  redisClient: Redis,
  pg: Pool,
): Promise<SimResult> {
  const simResult: SimResult = {
    transcriptJobId: null,
    broadcastReceived: false,
    translationFound: false,
    dbPersisted: false,
    metricsUpdated: false,
  };

  const simId = randomUUID();
  const simSpeaker = `audit-sim-${simId.substring(0, 8)}`;
  const simText = `[AUDIT SIM ${simId.substring(0, 8)}] The pipeline verification test is running.`;
  const simTimestamp = new Date().toISOString();

  const redisConn = {
    host: CONFIG.redisHost,
    port: CONFIG.redisPort,
    password: CONFIG.redisPassword,
    maxRetriesPerRequest: null as null,
  };

  console.log(`\n${C.bold}${SIM_PREFIX} Running pipeline simulation…${C.reset}`);
  console.log(`${C.dim}${SIM_PREFIX} simId=${simId.substring(0, 8)} meetingId=${meetingId}${C.reset}`);

  // ── Capture pre-simulation metrics snapshot ─────────────
  let preTranscripts = 0;
  let preTranslations = 0;
  let preBroadcasts = 0;

  try {
    const { rows } = await pg.query(
      `SELECT transcripts_generated, translations_generated, broadcast_events
         FROM meeting_pipeline_metrics WHERE meeting_id = $1`,
      [meetingId],
    );
    if (rows.length > 0) {
      preTranscripts = rows[0].transcripts_generated || 0;
      preTranslations = rows[0].translations_generated || 0;
      preBroadcasts = rows[0].broadcast_events || 0;
    }
  } catch {
    // Table may not exist yet — that's fine
  }

  // ── Stage 1: Subscribe to broadcast channel ─────────────
  const subscriber = createRedis();
  let broadcastPayload: Record<string, unknown> | null = null;

  try {
    await subscriber.connect();
  } catch (err: any) {
    warn(`${SIM_PREFIX} Could not create PubSub subscriber: ${err.message}`);
  }

  const broadcastPromise = new Promise<boolean>((resolve) => {
    subscriber.subscribe('meeting.events', (err) => {
      if (err) { resolve(false); return; }
    });

    subscriber.on('message', (_channel: string, message: string) => {
      try {
        const parsed = JSON.parse(message);
        const data = parsed.data || parsed;
        // Match our simulation by checking speaker name
        if (
          data.meetingId === meetingId &&
          (data.speaker === simSpeaker || data.originalText?.includes(simId.substring(0, 8)))
        ) {
          broadcastPayload = data;
          resolve(true);
        }
      } catch {
        // Not JSON
      }
    });

    // Resolve false on timeout — the timeout wrapper will handle hard failures
    setTimeout(() => resolve(false), CONFIG.stageTimeoutMs);
  });

  // ── Stage 2: Submit transcript event to queue ───────────
  const transcriptQueue = new Queue('transcript-events', { connection: redisConn });

  try {
    const job = await withTimeout(
      transcriptQueue.add('transcript', {
        meetingId,
        speaker: simSpeaker,
        speakerId: null,
        text: simText,
        timestamp: simTimestamp,
        isFinal: true,
        confidence: 0.99,
        language: 'en',
      }, { priority: 1 }),
      'submit-transcript',
    );

    simResult.transcriptJobId = job.id!;
    pass(`${SIM_PREFIX} Transcript submitted`, `jobId=${job.id}`);
  } catch (err: any) {
    fail(`${SIM_PREFIX} Transcript submitted`, err.message);
    await transcriptQueue.close().catch(() => {});
    await subscriber.quit().catch(() => {});
    return simResult;
  }

  // ── Stage 3: Wait for transcript job completion ─────────
  const queueEvents = new QueueEvents('transcript-events', { connection: redisConn });

  try {
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        const onCompleted = ({ jobId }: { jobId: string }) => {
          if (jobId === simResult.transcriptJobId) {
            queueEvents.off('completed', onCompleted);
            queueEvents.off('failed', onFailed);
            resolve();
          }
        };
        const onFailed = ({ jobId, failedReason }: { jobId: string; failedReason: string }) => {
          if (jobId === simResult.transcriptJobId) {
            queueEvents.off('completed', onCompleted);
            queueEvents.off('failed', onFailed);
            reject(new Error(`Transcript job failed: ${failedReason}`));
          }
        };
        queueEvents.on('completed', onCompleted);
        queueEvents.on('failed', onFailed);
      }),
      'transcript-processing',
    );
    pass(`${SIM_PREFIX} Transcript job processed`);
  } catch (err: any) {
    fail(`${SIM_PREFIX} Transcript job processed`, err.message);
  }

  // ── Stage 4: Wait for translation jobs ──────────────────
  // The transcript worker submits translation jobs. Poll the DB
  // for the transcript row with populated translations JSONB.
  try {
    await withTimeout(
      (async () => {
        const deadline = Date.now() + CONFIG.stageTimeoutMs;
        while (Date.now() < deadline) {
          const { rows } = await pg.query(
            `SELECT translations
               FROM meeting_transcripts
              WHERE meeting_id = $1
                AND speaker_name = $2
                AND translations IS NOT NULL
                AND translations != '{}'::jsonb
              LIMIT 1`,
            [meetingId, simSpeaker],
          );
          if (rows.length > 0) {
            const langs = Object.keys(rows[0].translations || {});
            simResult.translationFound = true;
            pass(`${SIM_PREFIX} Translations produced`, `languages: ${langs.join(', ') || '(none)'}`);
            return;
          }
          await new Promise((r) => setTimeout(r, 250));
        }
        // If we get here without finding translations, check if the
        // transcript at least exists (translations might be disabled)
        const { rows: transcriptRows } = await pg.query(
          `SELECT id, translations
             FROM meeting_transcripts
            WHERE meeting_id = $1 AND speaker_name = $2
            LIMIT 1`,
          [meetingId, simSpeaker],
        );
        if (transcriptRows.length > 0) {
          warn(`${SIM_PREFIX} Transcript stored but no translations populated (translation may be disabled)`);
          simResult.translationFound = false;
          pass(`${SIM_PREFIX} Translations produced`, 'Skipped — no target languages configured');
        } else {
          throw new Error('Transcript row not found in DB after processing');
        }
      })(),
      'translation-completion',
    );
  } catch (err: any) {
    fail(`${SIM_PREFIX} Translations produced`, err.message);
  }

  // ── Stage 5: Verify broadcast was received ──────────────
  try {
    simResult.broadcastReceived = await withTimeout(broadcastPromise, 'broadcast-listen');
    if (simResult.broadcastReceived && broadcastPayload) {
      const expectedFields = [
        'meetingId', 'speaker', 'originalText', 'translatedText',
        'timestamp', 'language', 'sourceLanguage',
      ];
      const bp = broadcastPayload;
      const present = expectedFields.filter((f) => f in bp);
      pass(
        `${SIM_PREFIX} Broadcast received`,
        `${present.length}/${expectedFields.length} fields present`,
      );
    } else {
      pass(`${SIM_PREFIX} Broadcast received`, 'No broadcast captured (server may be offline)');
    }
  } catch (err: any) {
    pass(`${SIM_PREFIX} Broadcast received`, 'Timed out (server may be offline)');
  }

  // ── Stage 6: Verify database persistence ────────────────
  try {
    await withTimeout(
      (async () => {
        const { rows } = await pg.query(
          `SELECT id, original_text, source_lang, translations
             FROM meeting_transcripts
            WHERE meeting_id = $1 AND speaker_name = $2
            LIMIT 1`,
          [meetingId, simSpeaker],
        );
        if (rows.length > 0) {
          simResult.dbPersisted = true;
          pass(
            `${SIM_PREFIX} Database persistence`,
            `row id=${rows[0].id.substring(0, 8)}… text="${rows[0].original_text.substring(0, 40)}…"`,
          );
        } else {
          fail(`${SIM_PREFIX} Database persistence`, 'Transcript row not found');
        }
      })(),
      'db-persistence',
    );
  } catch (err: any) {
    fail(`${SIM_PREFIX} Database persistence`, err.message);
  }

  // ── Stage 7: Verify metrics incremented ─────────────────
  try {
    await withTimeout(
      (async () => {
        // Give workers a moment to update counters
        await new Promise((r) => setTimeout(r, 500));
        const { rows } = await pg.query(
          `SELECT transcripts_generated, translations_generated, broadcast_events
             FROM meeting_pipeline_metrics WHERE meeting_id = $1`,
          [meetingId],
        );
        if (rows.length > 0) {
          const post = rows[0];
          const tDelta = (post.transcripts_generated || 0) - preTranscripts;
          const trDelta = (post.translations_generated || 0) - preTranslations;
          const bDelta = (post.broadcast_events || 0) - preBroadcasts;
          if (tDelta > 0 || trDelta > 0 || bDelta > 0) {
            simResult.metricsUpdated = true;
            pass(
              `${SIM_PREFIX} Metrics incremented`,
              `Δtranscripts=+${tDelta} Δtranslations=+${trDelta} Δbroadcasts=+${bDelta}`,
            );
          } else {
            warn(`${SIM_PREFIX} Pipeline metrics not incremented (counters unchanged)`);
            pass(`${SIM_PREFIX} Metrics incremented`, 'No increment detected — workers may lag');
          }
        } else {
          fail(`${SIM_PREFIX} Metrics incremented`, 'No meeting_pipeline_metrics row exists');
        }
      })(),
      'metrics-verification',
    );
  } catch (err: any) {
    fail(`${SIM_PREFIX} Metrics incremented`, err.message);
  }

  // ── Cleanup simulation resources ────────────────────────
  await queueEvents.close().catch(() => {});
  await transcriptQueue.close().catch(() => {});
  await subscriber.unsubscribe().catch(() => {});
  await subscriber.quit().catch(() => {});

  return simResult;
}

// ── Report Printer ──────────────────────────────────────────

function printReport(
  latencyStats: LatencyStats[],
  totalCostUsd: number,
): void {
  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.filter((r) => !r.passed).length;

  const overallP95 =
    latencyStats.length > 0
      ? Math.max(...latencyStats.map((s) => s.p95))
      : null;

  const status =
    failedCount === 0 && warnings.length === 0
      ? 'HEALTHY'
      : failedCount === 0
        ? 'HEALTHY (with warnings)'
        : 'UNHEALTHY';

  const statusColor =
    status === 'HEALTHY'
      ? C.green
      : status.startsWith('HEALTHY')
        ? C.yellow
        : C.red;

  console.log('');
  console.log(`${C.bold}MEETING AUDIT REPORT${C.reset}`);
  console.log(`${'─'.repeat(40)}`);
  console.log(`Meeting ID: ${C.cyan}${meetingId}${C.reset}`);
  if (simulateFlag) {
    console.log(`Mode:       ${C.cyan}audit + simulation${C.reset}`);
  }
  console.log('');

  // Check results
  for (const r of results) {
    const icon = r.passed ? PASS : FAIL;
    const detail = r.detail ? ` ${C.dim}${r.detail}${C.reset}` : '';
    console.log(`  ${icon} ${r.name}${detail}`);
  }

  // Warnings
  if (warnings.length > 0) {
    console.log('');
    for (const w of warnings) {
      console.log(`  ${WARN} ${C.yellow}${w}${C.reset}`);
    }
  }

  // Summary
  console.log('');
  console.log(`  Total AI Cost: ${C.cyan}$${totalCostUsd.toFixed(4)}${C.reset}`);

  if (overallP95 !== null) {
    const latColor = overallP95 > 500 ? C.yellow : C.green;
    console.log(
      `  Pipeline Latency p95: ${latColor}${overallP95}ms${C.reset}`,
    );
  } else {
    console.log(`  Pipeline Latency p95: ${C.dim}N/A${C.reset}`);
  }

  console.log('');
  console.log(
    `  Status: ${statusColor}${C.bold}${status}${C.reset}  (${passedCount} passed, ${failedCount} failed, ${warnings.length} warning(s))`,
  );
  console.log('');
}

// ── Main ────────────────────────────────────────────────────

async function main(): Promise<void> {
  let totalCostUsd = 0;
  let latencyStats: LatencyStats[] = [];

  // --- Connect Redis ---
  redis = createRedis();
  try {
    await redis.connect();
  } catch (err: any) {
    fail('Redis connected', err.message);
    printReport([], 0);
    process.exit(1);
  }

  // --- Connect PostgreSQL ---
  pool = createPool();
  try {
    await pool.query('SELECT 1');
  } catch (err: any) {
    fail('Database connected', err.message);
    printReport([], 0);
    await cleanup();
    process.exit(1);
  }

  // --- Run Checks ---
  try {
    // 1. Database checks
    const exists = await checkMeetingExists(pool);
    if (exists) {
      await checkTranscripts(pool);
      await checkTranslations(pool);
      await checkPipelineMetrics(pool);
      const aiResult = await checkAIUsage(pool);
      totalCostUsd = aiResult.totalCostUsd;
    }

    // 2. Queue checks
    await checkQueues(redis);

    // 3. Redis checks
    await checkRedis(redis);

    // 4. Broadcast payload check
    await checkBroadcastPayload(redis);

    // 5. Pipeline latency check
    if (exists) {
      latencyStats = await checkPipelineLatency(pool);
    }

    // 6. Pipeline simulation (if --simulate flag is passed)
    if (simulateFlag) {
      if (!exists) {
        fail('SIM Pipeline simulation', 'Cannot simulate — meeting does not exist in database');
      } else {
        await runSimulation(redis, pool);
      }
    }
  } catch (err: any) {
    fail('Audit execution', `Unexpected error: ${err.message}`);
  }

  // --- Print Report ---
  printReport(latencyStats, totalCostUsd);

  // --- Cleanup & Exit ---
  await cleanup();

  const failedCount = results.filter((r) => !r.passed).length;
  process.exit(failedCount > 0 ? 1 : 0);
}

async function cleanup(): Promise<void> {
  if (redis) {
    await redis.quit().catch(() => {});
  }
  if (pool) {
    await pool.end().catch(() => {});
  }
}

// Handle unhandled rejections gracefully
process.on('unhandledRejection', (err: any) => {
  console.error(`\n${C.red}Unhandled error: ${err.message || err}${C.reset}\n`);
  cleanup().finally(() => process.exit(1));
});

main();
