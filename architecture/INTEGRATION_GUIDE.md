# OrgsLedger — Integration Guide

> How to wire the distributed architecture modules into the existing monolith.
>
> **Rule: None of these changes alter existing behaviour.**
> When `NATS_URL` is not set, every hook is a no-op — the monolith runs exactly as before.

---

## Phase 1 — Event Bridge Hooks (Recommended First Step)

All hooks are imported from `services/integrationHooks.ts`. They are **fire-and-forget** — any failure is silently logged, never thrown.

### 1.1  socket.ts — `meeting:join`

After the existing `socket.join()` call (~line 456), add:

```ts
import { onMeetingJoined, onLanguageSet } from './services/integrationHooks';

// Inside 'meeting:join' handler, after socket.join(`meeting:${meetingId}`):
onMeetingJoined({
  meetingId,
  userId,
  name,
  language: pref?.preferred_language || 'en',
  organizationId: meeting.organization_id,
});
```

### 1.2  socket.ts — `meeting:leave`

At the top of the `meeting:leave` handler (~line 853):

```ts
import { onMeetingLeft } from './services/integrationHooks';

// Inside 'meeting:leave' handler:
onMeetingLeft({ meetingId, userId });
```

### 1.3  socket.ts — `disconnect`

Inside the `meetingLanguages.forEach(...)` block (~line 905), for each meeting the user was in:

```ts
import { onMeetingLeft } from './services/integrationHooks';

// Inside disconnect handler, after langMap.delete(userId):
onMeetingLeft({ meetingId, userId });
```

### 1.4  socket.ts — `translation:set-language`

After `meetingLanguages.get(meetingId)!.set(userId, ...)` (~line 598):

```ts
import { onLanguageSet } from './services/integrationHooks';

onLanguageSet({ meetingId, userId, language, name });
```

---

## Phase 2 — Transcription & Translation Hooks

### 2.1  meetingTranscript.handler.ts — `handleFinalTranscript`

After `context.io.to(...).emit('translation:result', payload)` (~line 209):

```ts
import { onTranscriptFinal, onTranslationCompleted } from './integrationHooks';

onTranscriptFinal({
  meetingId: context.meetingId,
  speakerId: segment.speakerId,
  speakerName: segment.speakerName,
  text: segment.text,
  language: segment.language,
});

onTranslationCompleted({
  meetingId: context.meetingId,
  speakerId: segment.speakerId,
  speakerName: segment.speakerName,
  originalText: segment.text,
  sourceLanguage: segment.language,
  translations: translations.translations,
  isFinal: true,
  latencyMs: Date.now() - startTime, // add `const startTime = Date.now()` at method start
});
```

### 2.2  meetingTranscript.handler.ts — `flushInterim`

After `context.io.to(...).emit('translation:interim', payload)` (~line 149):

```ts
import { onTranscriptInterim } from './integrationHooks';

onTranscriptInterim({
  meetingId: context.meetingId,
  speakerId: segment.speakerId,
  speakerName: segment.speakerName,
  text: segment.text,
  language: segment.language,
});
```

---

## Phase 3 — Minutes Hooks

### 3.1  minutes.queue.ts — `addMinutesJob`

After the BullMQ `add()` call:

```ts
import { onMinutesRequested } from '../services/integrationHooks';

onMinutesRequested({
  meetingId: data.meetingId,
  organizationId: data.organizationId,
  requestedBy: data.requestedBy,
});
```

### 3.2  minutes.worker.ts — after successful generation

After the DB insert for meeting_minutes:

```ts
import { onMinutesGenerated } from '../services/integrationHooks';

onMinutesGenerated({
  meetingId,
  organizationId: orgId,
  minutesId: result.id,
  summaryLength: result.summary.length,
});
```

---

## Phase 4 — Observability & Metrics

### 4.1  index.ts — Prometheus scrape endpoint

After the `/health` route:

```ts
import { prometheusMetricsHandler, prometheusHttpMiddleware } from './services/integrationHooks';

// Prometheus scrape endpoint
app.get('/metrics', prometheusMetricsHandler);

// Optional: detailed HTTP metrics (after existing metricsMiddleware)
app.use(prometheusHttpMiddleware);
```

### 4.2  index.ts — OpenTelemetry initialization

At the very top of `index.ts` (BEFORE any other imports):

```ts
// Must be first import — instruments require/import hooks
if (process.env.OTEL_ENABLED === 'true') {
  require('./infrastructure/telemetry');
}
```

### 4.3  index.ts — Socket.IO Redis adapter (multi-instance)

After `setupSocketIO(server)`:

```ts
import { setupRedisAdapter } from './infrastructure/socketRedisAdapter';

// Enable Socket.IO Redis adapter for multi-instance broadcasting
setupRedisAdapter(io).catch(err => 
  logger.warn('[STARTUP] Redis adapter setup failed (non-fatal)', err)
);
```

### 4.4  index.ts — NATS connection in startup

In `doPostStart()`, after worker orchestrator initialization:

```ts
// Initialize NATS connection for event streaming (if configured)
if (process.env.NATS_URL) {
  const { getNatsConnection, ensureStreams } = require('./infrastructure/natsClient');
  try {
    await getNatsConnection();
    await ensureStreams();
    logger.info('[STARTUP] ✓ NATS JetStream connected and streams ensured');
  } catch (err: any) {
    logger.warn('[STARTUP] NATS initialization failed (non-fatal):', err.message);
  }
}
```

### 4.5  index.ts — Graceful shutdown additions

In `gracefulShutdown()`, add before database pool close:

```ts
// Close NATS connection
if (process.env.NATS_URL) {
  try {
    const { closeNats } = require('./infrastructure/natsClient');
    await closeNats();
    logger.info('[SHUTDOWN] NATS connection closed');
  } catch (err: any) {
    logger.error('[SHUTDOWN] NATS close error:', err.message);
  }
}
```

---

## Environment Variables

Add these to your `.env` / `.env.production` to activate distributed features:

```bash
# ── NATS JetStream ──────────────────────────
# Set to enable event streaming (leave unset for monolith mode)
NATS_URL=nats://nats:4222

# ── Socket.IO Multi-Instance ────────────────
# Set to 'true' when running multiple API replicas behind a load balancer
SOCKETIO_REDIS_ADAPTER=true

# ── OpenTelemetry ───────────────────────────
# Set to 'true' to enable distributed tracing
OTEL_ENABLED=true
OTEL_SERVICE_NAME=orgsledger-api
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
```

---

## Activation Order

1. **Phase 0** — Deploy NATS container (docker-compose) → No code changes needed
2. **Phase 1** — Add meeting lifecycle hooks → Validates event flow
3. **Phase 2** — Add transcription hooks → Enables standalone translation workers
4. **Phase 3** — Add minutes hooks → Enables standalone minutes workers  
5. **Phase 4** — Add /metrics endpoint + telemetry → Full observability

Each phase can be deployed independently. Rolling back = remove the hook calls.
