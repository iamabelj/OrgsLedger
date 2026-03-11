# Meeting Pipeline Full Audit Report

**Date:** June 2025  
**Scope:** End-to-end meeting pipeline for 50,000+ simultaneous meetings  
**Auditor:** Senior Distributed Systems Engineer  
**Status:** CRITICAL ISSUES FOUND — NOT PRODUCTION-READY FOR 50K SCALE

---

## 1. System Architecture Summary

### Pipeline Flow

```
Audio → Deepgram WS → TranscriptionService → [transcript-events queue]
  → TranscriptWorker → Redis storage + [broadcast-events queue] + [translation-jobs queue]
    → TranslationWorker → [broadcast-events queue]
    → BroadcastWorker → Redis PubSub → EventBus → WebSocketGateway → Socket.IO clients
Meeting End → [minutes-generation queue] → MinutesWorker → AI summarization → PostgreSQL
```

### Key Components Inspected

| Component | File | Lines Read |
|-----------|------|-----------|
| Meeting Service | `src/modules/meeting/services/meeting.service.ts` | Full |
| Meeting Controller | `src/modules/meeting/controllers/meeting.controller.ts` | Full |
| Meeting Routes | `src/modules/meeting/routes/meeting.routes.ts` | Full |
| Transcript Worker | `src/workers/transcript.worker.ts` | Full |
| Translation Worker | `src/workers/translation.worker.ts` | Full |
| Broadcast Worker | `src/workers/broadcast.worker.ts` | Full |
| Minutes Worker | `src/workers/minutes.worker.ts` | Full |
| Queue Definitions (non-sharded) | `src/queues/transcript.queue.ts` | Full |
| Queue Manager (sharded) | `src/queues/queue-manager.ts` | Full |
| Shard Router | `src/scaling/shard-router.ts` | Full |
| Backpressure System | `src/scaling/backpressure.ts` | Full |
| Event Bus Service | `src/modules/meeting/services/event-bus.service.ts` | Full |
| WebSocket Gateway | `src/modules/meeting/services/websocket-gateway.service.ts` | Full |
| Socket.IO Setup | `src/socket.ts` | Full |
| Redis Client Manager | `src/infrastructure/redisClient.ts` | Full |
| Meeting Cache | `src/modules/meeting/services/meeting-cache.service.ts` | Full |
| Transcription Service | `src/modules/meeting/services/transcription.service.ts` | Full |
| AI Cost Monitor | `src/monitoring/ai-cost.monitor.ts` | Full |
| AI Rate Limit Guard | `src/monitoring/ai-rate-limit.guard.ts` | Full |
| Meeting Pipeline Metrics | `src/monitoring/meeting-metrics.ts` | Full |
| DB Migrations (029–034) | `packages/database/src/migrations/` | Full |

---

## 2. Verified Working Components

### ✅ Meeting CRUD Lifecycle
- Meeting creation with Zod validation and `aiCostGuard` middleware
- Status transitions properly validated (scheduled → active → ended)
- Host-only end-meeting authorization enforced
- Auto-start on host join of scheduled meeting
- Max participant enforcement
- Rejoin semantics handled (update existing participant record)

### ✅ Deepgram Transcription Integration
- WebSocket-based streaming connection with proper auth
- Reconnection logic (5 attempts with backoff)
- Keep-alive mechanism
- Speaker diarization via word-level speaker detection
- Only final transcripts queued for processing (interim results emitted locally)
- Backpressure-aware: checks queue depth before submitting
- AI rate limit guard integration before submission

### ✅ BullMQ Queue Infrastructure
- Four queue types with appropriate retry configurations
- Queue manager with sharded topology (16 shards, configurable up to 128)
- Deterministic routing via murmurhash3 (shard-router) and djb2 (queue-manager)
- Redis Cluster support in both standalone and cluster modes
- Prometheus metrics for queue depth monitoring

### ✅ Broadcast Pipeline
- BroadcastWorker with concurrency 20 and internal retry (3 attempts, exponential backoff)
- Event type mapping (transcript→meeting:transcript, translation→meeting:caption)
- Redis PubSub publishing via event bus
- WebSocket Gateway subscribes to event bus and routes to Socket.IO rooms

### ✅ Minutes Generation
- Idempotency check before generation (DB lookup + `ON CONFLICT` ignore)
- Transcript retrieval from Redis
- AI rate limit check before OpenAI call
- Structured output with summary, key topics, decisions, action items
- 10-minute lock duration for long AI processing
- Cost monitoring integration

### ✅ Monitoring & Observability
- Per-stage latency histograms (transcription, translation, broadcast)
- Total pipeline latency tracking
- Rolling window percentile calculations (p50/p95/p99)
- Batched PostgreSQL persistence for latency data (buffer size 50, 30s interval)
- 30-day retention with automatic cleanup
- AI cost tracking (Deepgram, OpenAI, Translation) with daily limits and alerts

### ✅ Meeting State Management
- Redis-backed active state with in-memory fallback
- 12-hour TTL prevents memory leaks from abandoned meetings
- Organization-scoped active meeting sets
- Participant updates during active meetings go to Redis only (not DB)
- Participants persisted to relational table at meeting end

### ✅ Backpressure System
- 3-tier decision system (ALLOW → THROTTLE → REJECT)
- Hysteresis to prevent state flapping (80% recovery threshold)
- Graduated degradation actions (slow ingestion → drop low priority → reduce languages → disable minutes)
- Per-queue configurable thresholds via environment variables
- Prometheus metrics for all state transitions
- 1-second stats cache reduces Redis calls

---

## 3. Broken or Missing Components

### 🔴 CRITICAL: Dual Queue System — Sharded vs Non-Sharded Are Disconnected

**Impact:** The sharded queue infrastructure built for 50k scale is **NOT CONNECTED** to the pipeline.

**Evidence:**  
- All 4 workers import from `src/queues/transcript.queue.ts` (non-sharded, single queue per type)
- `TranscriptionService` submits to `transcript.queue.ts` via `submitTranscriptEvent()`
- `MeetingService` submits minutes via `transcript.queue.ts` via `submitMinutesJob()`
- `queue-manager.ts` (sharded, 16 shards) is only imported by `system.routes.ts` for monitoring
- `backpressure.ts` imports from `queue-manager.ts` but the actual job flow goes through `transcript.queue.ts`

**Result:** At 50k meetings, ALL transcripts/translations/broadcasts funnel through a SINGLE BullMQ queue per type. The shard router provides no benefit. The backpressure system monitors the wrong queues.

**Location:**  
- `src/queues/transcript.queue.ts` — non-sharded queues used by pipeline
- `src/queues/queue-manager.ts` — sharded queues, unused by pipeline
- `src/workers/transcript.worker.ts` line 43 — consumes from `QUEUE_NAMES.TRANSCRIPT_EVENTS`
- `src/modules/meeting/services/transcription.service.ts` line 11 — submits to non-sharded queue

### 🔴 CRITICAL: Translation Worker Payload Field Mismatch

**Impact:** Translation may silently fail or process undefined text.

**Evidence:**
- Queue definition `TranslationJobData` (transcript.queue.ts:24) uses field `text: string`
- Transcript worker submits with `text` field (transcript.worker.ts:127)
- Translation worker's `TranslationJobPayload` (translation.worker.ts:44) expects field `transcript: string`
- Validation function checks `payload.transcript` (translation.worker.ts:175)
- Processing destructures `{ transcript }` from `job.data` (translation.worker.ts:314)

**Result:** The `validatePayload()` function will throw `'Invalid payload: transcript must be a non-empty string'` on every translation job, because `job.data.transcript` is `undefined` while `job.data.text` contains the actual content.

**Location:**  
- `src/queues/transcript.queue.ts` lines 24-31 (`text` field)
- `src/workers/translation.worker.ts` lines 41-53 (`transcript` field)

### 🔴 CRITICAL: No Transcript Persistence to PostgreSQL

**Impact:** Transcripts are only stored in Redis with 24-hour TTL. After 24 hours, all meeting transcript data is permanently lost.

**Evidence:**
- `TranscriptWorker.storeTranscript()` does `redis.rpush()` with 86400s TTL
- No DB insert anywhere in the transcript pipeline
- The `meeting_transcripts` table (if it exists) is never written to by any worker
- `getMeetingTranscripts()` reads only from Redis
- MinutesWorker retrieves transcripts from Redis — if run >24h after meeting, gets empty array

**Location:**  
- `src/workers/transcript.worker.ts` lines 155-175

### 🟡 HIGH: Redis PubSub Has Two Incompatible Implementations

**Impact:** Event delivery depends on which Redis client library module loads first.

**Evidence:**
- `event-bus.service.ts` uses the `redis` npm package (node-redis v4): `import('redis')` with `createClient()`
- `redisClient.ts` uses `ioredis` package: `import Redis from 'ioredis'`
- `meeting-cache.service.ts` uses the `redis` package: `import('redis')` with `createClient()`
- Workers use `ioredis` via `createBullMQConnection()`
- The broadcast worker publishes via `event-bus.service.ts` (node-redis) to channel `meeting.events`
- The websocket gateway subscribes via `event-bus.service.ts` (node-redis) to the same channel

**Result:** Two separate Redis client libraries are in use. While they connect to the same Redis server and PubSub does work across clients, having two client libraries increases memory usage, doubles connection count, and creates inconsistent error handling and reconnection behavior.

### 🟡 HIGH: WebSocket Gateway Does Not Route Broadcast Worker Events

**Impact:** Real-time transcript and caption delivery to clients may not work.

**Evidence:**
- BroadcastWorker publishes to `meeting.events` channel via `publishEvent(EVENT_CHANNELS.MEETING_EVENTS, payload)` with payload structure: `{ type: 'meeting:transcript', timestamp, data: { meetingId, ... } }`
- WebSocketGateway subscribes to `meeting.events` and receives the payload
- Gateway handler (`handleMeetingEvent`) casts payload as `MeetingEvent` and reads `event.meetingId` and `event.organizationId`
- BUT the broadcast worker wraps meetingId inside `data`: `{ type, timestamp, data: { meetingId, ... } }`
- The gateway reads `event.meetingId` which is `undefined` (it's at `event.data.meetingId`)
- Since `event.meetingId` is falsy, `io.to('meeting:undefined')` emits to nobody

**Result:** Broadcast events from the BroadcastWorker are published to Redis PubSub but the WebSocket Gateway cannot route them to the correct Socket.IO room because the payload structure doesn't match what the gateway expects.

**Location:**  
- `src/workers/broadcast.worker.ts` lines 290-310 (payload construction)
- `src/modules/meeting/services/websocket-gateway.service.ts` lines 25-48 (event handling)

---

## 4. Scalability Risks

### 🔴 Single-Queue Bottleneck
Since the sharded queue system is disconnected, all 50k meetings share one `transcript-events` queue, one `translation-jobs` queue, etc. BullMQ's single-queue throughput is bounded by Redis `BRPOPLPUSH` command latency (~1ms per job). With 50k meetings generating ~5 transcripts/second each = 250,000 jobs/second. A single BullMQ queue can handle ~10,000-50,000 jobs/second depending on Redis config. This is a hard ceiling.

### 🟡 Worker Concurrency Model
- Transcript Worker: concurrency 10 — processes 10 jobs simultaneously from ONE queue
- Translation Worker: concurrency 10 with BullMQ rate limiter (100 jobs/sec)
- Broadcast Worker: concurrency 20

At 50k meetings, even with horizontal pod scaling of workers, all pods compete on the same single queue. Adding pods beyond the Redis throughput ceiling provides no benefit.

### 🟡 In-Memory Translation Cache Not Shared
Translation cache (`Map` with 10k max entries) exists only in-process. With multiple worker replicas, cache hit rate drops proportionally. No shared Redis cache for translations.

### 🟡 Meeting Cache Uses `redis` (node-redis) While Rest Uses `ioredis`
Having two separate connection pools wastes file descriptors and memory. Each Redis library maintains its own reconnection logic, meaning one could be healthy while the other is disconnected.

### ⚠️ Latency Buffer Unbounded Growth
The latency buffer in `meeting-metrics.ts` re-queues failed flushes (`latencyBuffer.unshift(...rows)`) bounded at 500 entries. Under sustained DB outage with 50k meetings generating latency samples, this could cause memory growth, though the 500 cap mitigates catastrophic growth.

---

## 5. Data Integrity Risks

### 🔴 No Transactional Meeting State Transitions
- `meeting.service.ts:start()` does `db('meetings').update()` then `setActiveMeetingState()` in Redis
- If the Redis write fails after DB update succeeds, the meeting is "active" in the DB but has no Redis state
- Participants attempting to join will get stale data from `getByIdWithState()` which overlays Redis state on DB record
- No rollback mechanism exists

### 🔴 Non-Atomic Redis Transcript Storage
- `storeTranscript()` calls `rpush` then `expire` as two separate commands
- If the process crashes between `rpush` and `expire`, the key has no TTL and persists forever
- Should use Redis pipeline or `MULTI/EXEC` for atomicity

### 🟡 Meeting End Race Condition
- `meeting.service.ts:end()` reads participants from Redis, marks all as left, bulk-inserts to DB, updates meeting status, removes Redis state
- Multiple concurrent `end()` calls (e.g., last participant leaving while host ends) could produce duplicate participant records
- `persistParticipants()` does bulk insert without `ON CONFLICT` handling

### 🟡 Metrics Increment Not Atomic
- `incrementTranscriptsGenerated()` does `getOrCreateMetricsRecord()` then `db.update(transcripts_generated + 1)`
- `getOrCreateMetricsRecord()` does SELECT then INSERT if not found — classic race condition
- Two concurrent transcript events for the same meeting can create duplicate metrics rows
- The `db.raw('transcripts_generated + 1')` is atomic at the UPDATE level but the preceding getOrCreate is not

---

## 6. Queue Bottlenecks

### Current (Non-Sharded) Queue Configuration

| Queue | Attempts | Backoff | Concurrency | Rate Limit |
|-------|----------|---------|-------------|------------|
| transcript-events | 3 | 1s exponential | 10 | None |
| translation-jobs | 3 | — | 10 | 100 jobs/sec |
| broadcast-events | 1 | — | 20 | None |
| minutes-generation | 5 | 5s delay | 3 | None |

### Bottleneck Analysis at 50k Meetings

**Transcript Events:** 50k meetings × 5 final transcripts/min avg = 250k jobs/min = ~4,167 jobs/sec. Single queue can handle this with 10 concurrent workers per pod, but BullMQ overhead becomes significant.

**Translation Jobs:** With rate limiter at 100 jobs/sec and 3 target languages per meeting, the translation queue is hard-capped at 100 jobs/sec regardless of how many worker pods exist. At 4,167 transcript jobs/sec × 1 translation job each = 4,167 required translation jobs/sec. **The queue will back up 41x faster than it drains.**

**Broadcast Events:** Each transcript generates 1 broadcast + each translation generates 1 broadcast = ~8,333 broadcast jobs/sec minimum. Concurrency 20 per pod with BullMQ overhead means each pod handles ~200-500 broadcasts/sec. Need 17-42 pods minimum.

### Sharded Queue (Not Connected)
The queue-manager.ts with 16 shards would distribute load to ~3,125 meetings per shard, each producing ~260 jobs/sec — well within BullMQ's per-queue capacity. **This is the correct design but it's not wired in.**

---

## 7. Latency Risks

### Pipeline Hop Count
Audio → Deepgram WS → TranscriptionService → BullMQ Enqueue → TranscriptWorker dequeue → Redis rpush → BullMQ Enqueue (broadcast) → BroadcastWorker dequeue → Redis PubSub → EventBus → Socket.IO emit

**Minimum latency (healthy):** ~20-50ms per BullMQ hop × 2 hops + ~5ms Redis PubSub + Deepgram processing (~200-500ms) = **~250-600ms end-to-end**

**Under load (50k meetings, single queue):** BullMQ dequeue latency climbs with queue depth. At 100k+ waiting jobs, dequeue can take 1-5 seconds per job. **Total latency: 2-10 seconds**, breaking real-time caption UX.

### Translation Path
Adds one more BullMQ hop + API call to translation provider. **Expected: 500ms-2s additional** on top of transcript delivery, which is acceptable for captions.

### Minutes Generation
AI processing is inherently slow (10-60 seconds for GPT-4o-mini summarization). Lock duration of 10 minutes is appropriate. Not on the real-time path — acceptable.

---

## 8. Database Issues

### Schema Gaps

**No `meeting_transcripts` table:** No migration creates a `meeting_transcripts` table. Transcripts exist only in Redis (24h TTL). This means:
- No permanent record of what was said in meetings
- Cannot regenerate minutes after Redis TTL expires
- No audit trail for compliance
- Cannot search historical transcripts

**`meeting_pipeline_metrics` lacks unique constraint on `meeting_id`:** The `getOrCreateMetricsRecord()` function does SELECT-then-INSERT without constraint protection. Race conditions will create duplicate rows per meeting.

**`meeting_pipeline_latency` grows unbounded during high load:** At 50k meetings × 3 stages × 5 events/min = 750k rows/min = 1B rows/day. The 30-day retention cleanup runs daily, but a single `DELETE WHERE created_at < cutoff` on a billion-row table will lock for minutes.

### Index Analysis

**meetings table:** Well-indexed with composite indexes on (org_id, status), (host_id, status), (org_id, created_at). ✅

**meeting_pipeline_latency:** Has indexes on meeting_id, (stage, created_at), created_at. Adequate for queries but the retention DELETE will still be slow on very large tables. Should use partitioning.

**meeting_pipeline_metrics:** Only indexed on meeting_id. Missing unique constraint.

### Connection Pool Concerns

Two separate Redis client libraries (`redis` and `ioredis`) create two separate connection pools. At 50k meetings with multiple worker pods:
- `ioredis` RedisClientManager: 8-pool-size per pod
- `redis` (node-redis) in event-bus + meeting-cache: 2-4 connections per pod
- BullMQ workers: 1 connection each via `createBullMQConnection()`
- With 20 worker pods: ~240 Redis connections from ioredis + ~80 from node-redis = 320+ connections

Redis default maxclients is 10,000, so this is within limits but wasteful.

---

## 9. Security Concerns

### ✅ Authentication
- JWT-based Socket.IO authentication with user existence check
- Meeting routes protected by authentication middleware
- AI cost guard middleware on meeting creation

### ✅ Authorization
- Host-only meeting end authorization
- Channel membership verification for Socket.IO room joins
- Organization membership checks for ledger subscriptions

### ⚠️ Socket.IO Room Join Without Meeting Authorization
- `meeting:join-room` handler in `websocket-gateway.service.ts` joins any socket to any meeting room
- Only validates that meetingId is a non-empty string
- Does NOT verify the user is a participant of that meeting
- An authenticated user could listen to any meeting's transcript/caption events

**Location:** `src/modules/meeting/services/websocket-gateway.service.ts` lines 102-110

### ⚠️ No Input Sanitization on Transcript Text
- Transcript text from Deepgram is passed through to broadcast without sanitization
- If malicious audio causes Deepgram to transcribe XSS-like text, it gets broadcast verbatim
- Client-side rendering must handle escaping (not a server concern per se, but defense-in-depth)

### ⚠️ Redis Credentials in Multiple Locations
- Redis connection params are parsed independently in `redisClient.ts`, `queue-manager.ts`, `ai-rate-limit.guard.ts`, and `meeting-cache.service.ts`
- `meeting-cache.service.ts` and `event-bus.service.ts` use `config.redis.url` while others use individual env vars
- Inconsistent credential sourcing increases misconfiguration risk

---

## 10. Recommended Fixes (Prioritized)

### P0 — Must Fix Before Production

#### 1. Wire Sharded Queues to Pipeline
**Effort:** Medium (2-3 days)  
**Files:** transcript.worker.ts, translation.worker.ts, broadcast.worker.ts, minutes.worker.ts, transcription.service.ts, meeting.service.ts

Replace all references to `transcript.queue.ts` functions (`submitTranscriptEvent`, `submitTranslationJob`, `submitBroadcastEvent`, `submitMinutesJob`) with `queue-manager.ts` equivalents (`queueManager.submitTranscript`, `queueManager.submitTranslation`, `queueManager.submitBroadcast`, `queueManager.submitMinutes`). Update workers to consume from ALL shards using `queueManager.getAllQueues()`. The shard router and backpressure system will then function correctly.

#### 2. Fix Translation Worker Payload Mismatch
**Effort:** Small (30 minutes)  
**Files:** translation.worker.ts

Change `TranslationJobPayload.transcript` to `text` throughout, or change transcript worker to submit with field name `transcript` instead of `text`. Safest fix:

```typescript
// translation.worker.ts line 44
export interface TranslationJobPayload {
  meetingId: string;
  speakerId: string;
  text: string;  // was: transcript
  // ...
}
```

Update `validatePayload()` and `processTranslationJob()` to use `text` field.

#### 3. Add Transcript Persistence to PostgreSQL
**Effort:** Medium (1-2 days)  
**Files:** New migration, transcript.worker.ts

Create `meeting_transcripts` table migration. Add DB insert in transcript worker after Redis storage. This provides permanent record and compliance trail.

```sql
CREATE TABLE meeting_transcripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES meetings(id),
  speaker TEXT,
  speaker_id TEXT,
  text TEXT NOT NULL,
  language VARCHAR(10),
  confidence FLOAT,
  is_final BOOLEAN DEFAULT true,
  timestamp TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_mt_meeting_id ON meeting_transcripts(meeting_id);
CREATE INDEX idx_mt_meeting_timestamp ON meeting_transcripts(meeting_id, timestamp);
```

#### 4. Fix WebSocket Gateway Payload Routing
**Effort:** Small (30 minutes)  
**Files:** websocket-gateway.service.ts

The gateway reads `event.meetingId` but the broadcast worker wraps it in `event.data.meetingId`. Fix:

```typescript
async function handleMeetingEvent(payload: EventPayload): Promise<void> {
  const meetingId = payload.data?.meetingId;
  const organizationId = payload.data?.organizationId;
  
  if (organizationId) {
    io.to(`org:${organizationId}`).emit(payload.type, payload);
  }
  if (meetingId) {
    io.to(`meeting:${meetingId}`).emit(payload.type, payload);
  }
}
```

### P1 — Should Fix Before Scale Testing

#### 5. Atomic Redis Transcript Storage
**Effort:** Small (30 minutes)  
**Files:** transcript.worker.ts

```typescript
const pipeline = this.redis.pipeline();
pipeline.rpush(key, entry);
pipeline.expire(key, 86400);
await pipeline.exec();
```

#### 6. Add Unique Constraint on meeting_pipeline_metrics.meeting_id
**Effort:** Small (30 minutes)  
**Files:** New migration

```sql
ALTER TABLE meeting_pipeline_metrics 
ADD CONSTRAINT uq_meeting_pipeline_metrics_meeting_id UNIQUE (meeting_id);
```

Update `getOrCreateMetricsRecord()` to use `INSERT ... ON CONFLICT (meeting_id) DO NOTHING` followed by SELECT.

#### 7. Consolidate Redis Client Libraries
**Effort:** Medium (1-2 days)  
**Files:** event-bus.service.ts, meeting-cache.service.ts

Replace `import('redis')` (node-redis) usage with `ioredis` from `redisClient.ts`. This eliminates the dual-library issue, reduces connections, and provides consistent reconnection behavior.

#### 8. Authorize Socket.IO Meeting Room Joins
**Effort:** Small (1 hour)  
**Files:** websocket-gateway.service.ts

Verify meeting participant status before joining meeting room:

```typescript
socket.on('meeting:join-room', async (meetingId: string) => {
  const state = await getActiveMeetingState(meetingId);
  const isParticipant = state?.participants.some(p => p.userId === socket.userId && !p.leftAt);
  if (!isParticipant) return;
  socket.join(`meeting:${meetingId}`);
});
```

#### 9. Remove Translation Worker Rate Limiter or Increase Limit
**Effort:** Small (15 minutes)  
**Files:** translation.worker.ts

The 100 jobs/sec BullMQ rate limiter creates a hard ceiling. At 50k meetings, this is a guaranteed bottleneck. Either remove it (rely on AI rate limit guard instead) or increase to 10,000+.

### P2 — Good Practice Improvements

#### 10. Partition meeting_pipeline_latency Table
Use PostgreSQL range partitioning by `created_at` (monthly). This prevents the retention DELETE from blocking on a monolithic table.

#### 11. Add Transactional Meeting Start
Wrap DB update + Redis cache set in a try-catch with manual rollback:

```typescript
try {
  await db('meetings').update({ status: 'active', ... });
  await setActiveMeetingState(state);
} catch (err) {
  await db('meetings').update({ status: 'scheduled', ... }); // rollback
  throw err;
}
```

#### 12. Share Translation Cache via Redis
Replace in-memory `Map` with Redis-backed cache using meeting-specific keys and appropriate TTLs. This enables cache sharing across worker replicas.

#### 13. Add Idempotency to Participant Persistence
Use `ON CONFLICT (meeting_id, user_id) DO UPDATE` in `persistParticipants()` to handle concurrent end-meeting calls safely.

---

## Summary

| Severity | Count | Category |
|----------|-------|----------|
| 🔴 CRITICAL | 4 | Disconnected sharding, payload mismatch, no transcript persistence, broken PubSub routing |
| 🟡 HIGH | 4 | Dual Redis libraries, translation rate limit ceiling, non-atomic operations, unauthorized room joins |
| ⚠️ CAUTION | 5 | Latency buffer growth, credential inconsistency, transcript sanitization, partition strategy, transaction safety |

**Bottom line:** The system architecture is well-designed with sharding, backpressure, metrics, and rate limiting. However, the sharded queue infrastructure is not connected to the actual pipeline — all traffic flows through single non-sharded queues. Additionally, the translation pipeline has a field name mismatch that will cause every translation job to fail in production. These two issues alone block 50k scale deployment.
