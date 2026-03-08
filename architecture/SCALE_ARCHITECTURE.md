# OrgsLedger — Distributed Architecture for 100K Simultaneous Meetings

## Current State Analysis

The existing monolith already has strong foundations:

- **BullMQ queues** (Redis-backed): processing, broadcast, minutes, notification, email, audit, bot
- **Workers**: broadcast (concurrency 20), processing (concurrency 10), minutes (concurrency 2)
- **Two-tier translation cache**: L1 in-memory + L2 Redis
- **LiveKit Cloud**: audio/video via self-hosted LiveKit server
- **Deepgram Nova-3**: streaming multilingual STT
- **GPT-4o-mini**: translation engine with Google Translate fallback

### Current Bottlenecks (why it can't hit 100K meetings)

| Bottleneck | Impact | Root Cause |
| --- | --- | --- |
| Single Node.js process | ~500-1000 concurrent meetings max | All services share one event loop |
| In-memory `meetingLanguages` Map | Lost on restart, can't shard | Process-local state |
| Sequential Deepgram connections | O(n) per-participant streams | Single service manages all streams |
| Single Redis instance | SPOF, ~100K ops/sec ceiling | No clustering |
| Monolithic Docker container | Can't scale services independently | Everything in one image |
| No event streaming backbone | Services coupled via function calls | Direct imports between services |

---

## High-Level System Architecture

```text
                                    ┌──────────────────────────────┐
                                    │        LOAD BALANCER         │
                                    │   (nginx / AWS ALB / Traefik)│
                                    └─────────┬────────────────────┘
                                              │
                    ┌─────────────────────────┼─────────────────────────┐
                    │                         │                         │
              ┌─────▼─────┐           ┌──────▼──────┐          ┌──────▼──────┐
              │  API GW   │           │  API GW     │          │  API GW     │
              │ Instance 1│           │ Instance 2  │          │ Instance N  │
              │ (Express) │           │ (Express)   │          │ (Express)   │
              └────┬──────┘           └──────┬──────┘          └──────┬──────┘
                   │                         │                        │
                   └─────────────┬───────────┘────────────────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │    NATS JetStream       │
                    │  (Event Streaming)      │
                    │                         │
                    │  Subjects:              │
                    │  • meeting.started      │
                    │  • audio.chunk          │
                    │  • transcript.interim   │
                    │  • transcript.final     │
                    │  • translation.complete │
                    │  • minutes.requested    │
                    │  • minutes.generated    │
                    └───┬──────┬──────┬───────┘
                        │      │      │
           ┌────────────┘      │      └────────────┐
           │                   │                    │
    ┌──────▼──────┐    ┌──────▼──────┐     ┌──────▼──────┐
    │Transcription│    │ Translation │     │  Minutes    │
    │  Workers    │    │  Workers    │     │  Workers    │
    │  (pool)     │    │  (pool)     │     │  (pool)     │
    │             │    │             │     │             │
    │ Deepgram    │    │ GPT-4o-mini │     │ GPT-4o     │
    │ Streams     │    │ + Cache     │     │ Summarize  │
    └──────┬──────┘    └──────┬──────┘     └──────┬──────┘
           │                  │                   │
           └────────┬─────────┘───────────────────┘
                    │
          ┌─────────▼──────────┐
          │   Redis Cluster    │
          │                    │
          │  • Translation L2  │
          │  • Meeting state   │
          │  • BullMQ queues   │
          │  • Pub/Sub fanout  │
          └─────────┬──────────┘
                    │
          ┌─────────▼──────────┐
          │  PostgreSQL (Neon) │
          │                    │
          │  • Meetings        │
          │  • Transcripts     │
          │  • Minutes         │
          │  • Users/Orgs      │
          └────────────────────┘
```

---

## 1. Event Streaming Layer (NATS JetStream)

**Why NATS over Kafka**: NATS JetStream is operationally simpler (single binary, no ZooKeeper), has sub-millisecond latency, and is perfect for the message sizes in this system (transcript segments are < 1KB). For 100K meetings with ~3 events/second each, NATS handles ~300K msg/sec easily on modest hardware.

### Event Definitions

```text
Subject                          Payload Schema                         Retention
─────────────────────────────── ──────────────────────────────────────── ─────────
meeting.started                  { meetingId, orgId, participants[] }    24h
meeting.ended                    { meetingId, duration }                 24h
audio.chunk.{meetingId}          { meetingId, participantId, chunk }     1h
transcript.interim.{meetingId}   { meetingId, speakerId, text, lang }   1h
transcript.final.{meetingId}     { meetingId, speakerId, text, lang }   24h
translation.completed.{meetId}   { meetingId, translations{} }          24h
minutes.requested                { meetingId, orgId }                   7d
minutes.generated                { meetingId, summary, downloadUrls }   7d
broadcast.emit.{meetingId}       { event, room, payload }               1h
```

### Integration with Current Code

The existing monolith continues to work as-is. A **bridge module** publishes events to NATS whenever the current code calls its functions. New microservices subscribe to these events independently.

---

## 2. Microservice Definitions

Each microservice is a standalone Node.js process (Docker container) that communicates exclusively via NATS + Redis.

### 2.1 API Gateway Service (existing monolith, refactored)

**What changes**: Nothing removed. Add NATS publisher calls alongside existing function calls.

```text
Container:  orgsledger-api-gateway
Replicas:   3-10 (behind load balancer)
Memory:     512MB per instance
CPU:        0.5 vCPU per instance
Ports:      3000
```

Responsibilities:

- HTTP REST API (all current routes unchanged)
- Socket.IO connections (sticky sessions via Redis adapter)
- Authentication / authorization
- Publishes events to NATS on meeting lifecycle changes

### 2.2 Audio Ingestion Service

```text
Container:  orgsledger-audio-ingestion
Replicas:   5-20 (scales with active meetings)
Memory:     256MB per instance
CPU:        0.25 vCPU per instance
```

Responsibilities:

- Subscribes to LiveKit audio tracks via LiveKit Egress API
- Receives raw audio chunks from participants
- Publishes `audio.chunk.{meetingId}` to NATS
- Lightweight — just audio routing, no processing

### 2.3 Transcription Service

```text
Container:  orgsledger-transcription
Replicas:   10-50 (heaviest scale requirement)
Memory:     512MB per instance
CPU:        0.5 vCPU per instance
```

Responsibilities:

- Subscribes to `audio.chunk.{meetingId}`
- Manages Deepgram WebSocket streams (connection pooling)
- Publishes `transcript.interim.{meetingId}` and `transcript.final.{meetingId}`
- One instance handles ~200-500 concurrent Deepgram streams

### 2.4 Translation Service

```text
Container:  orgsledger-translation
Replicas:   10-30 (scales with language pairs × meetings)
Memory:     256MB per instance
CPU:        0.25 vCPU per instance
```

Responsibilities:

- Subscribes to `transcript.final.{meetingId}` and `transcript.interim.{meetingId}`
- Resolves target languages from Redis meeting state
- Translates via GPT-4o-mini (existing code) with Redis cache
- Publishes `translation.completed.{meetingId}`

### 2.5 Broadcast Service

```text
Container:  orgsledger-broadcast
Replicas:   5-20 (scales with connected clients)
Memory:     256MB per instance
CPU:        0.25 vCPU per instance
```

Responsibilities:

- Subscribes to `translation.completed.{meetingId}`
- Emits Socket.IO events to meeting rooms via Redis Pub/Sub adapter
- Handles interim + final broadcast distinction

### 2.6 Minutes Service

```text
Container:  orgsledger-minutes
Replicas:   2-5 (background, not latency-critical)
Memory:     512MB per instance
CPU:        0.5 vCPU per instance
```

Responsibilities:

- Subscribes to `minutes.requested`
- Aggregates transcripts from DB
- Generates AI summary via GPT-4o
- Publishes `minutes.generated`
- Stores to DB and generates download formats

### 2.7 Notification Service

```text
Container:  orgsledger-notification
Replicas:   2-3
Memory:     128MB per instance
CPU:        0.1 vCPU per instance
```

Responsibilities:

- Subscribes to `minutes.generated`, `meeting.ended`
- Sends push notifications, emails
- Non-latency-critical

---

## 3. Event Flow Pipeline

### Real-Time Transcription + Translation (hot path, < 500ms end-to-end)

```text
Participant speaks
       │
       ▼
┌──────────────┐     NATS: audio.chunk.{meetingId}
│ LiveKit Cloud │ ──────────────────────────────────►┌──────────────────┐
│ (audio track) │                                    │ Transcription    │
└──────────────┘                                    │ Worker           │
                                                    │                  │
                                                    │ Deepgram Stream  │
                                                    └────────┬─────────┘
                                                             │
                                          NATS: transcript.final.{meetingId}
                                                             │
                                                    ┌────────▼─────────┐
                                                    │ Translation      │
                                                    │ Worker           │
                                                    │                  │
                                                    │ Redis Cache →    │
                                                    │ GPT-4o-mini      │
                                                    └────────┬─────────┘
                                                             │
                                     NATS: translation.completed.{meetingId}
                                                             │
                                                    ┌────────▼─────────┐
                                                    │ Broadcast        │
                                                    │ Worker           │
                                                    │                  │
                                                    │ Socket.IO emit   │
                                                    │ via Redis PubSub │
                                                    └────────┬─────────┘
                                                             │
                                                    ┌────────▼─────────┐
                                                    │ All Participants │
                                                    │ in meeting room  │
                                                    └──────────────────┘
```

### Meeting Minutes (cold path, async)

```text
Meeting ends
       │
       ▼
┌──────────────┐     NATS: minutes.requested
│ API Gateway  │ ──────────────────────────────────►┌──────────────────┐
│              │                                    │ Minutes Worker   │
└──────────────┘                                    │                  │
                                                    │ 1. Query DB for  │
                                                    │    transcripts   │
                                                    │ 2. GPT-4o        │
                                                    │    summarize     │
                                                    │ 3. Generate PDFs │
                                                    └────────┬─────────┘
                                                             │
                                          NATS: minutes.generated
                                                             │
                                                    ┌────────▼─────────┐
                                                    │ Notification     │
                                                    │ Worker           │
                                                    │                  │
                                                    │ Push + Email     │
                                                    └──────────────────┘
```

---

## 4. NATS JetStream Topic Layout

```yaml
# Stream: MEETINGS — meeting lifecycle events
stream: MEETINGS
  subjects:

    - meeting.started
    - meeting.ended
    - meeting.participant.joined
    - meeting.participant.left
  retention: limits
  max_age: 24h
  max_bytes: 1GB
  replicas: 3
  consumers:

    - transcription-service (push, deliver: all)
    - minutes-service (push, deliver: all)
    - analytics-service (push, deliver: all)

# Stream: AUDIO — raw audio chunks (high throughput)
stream: AUDIO
  subjects:

    - audio.chunk.*  # wildcard per meetingId
  retention: limits
  max_age: 1h       # short retention — only for live processing
  max_bytes: 50GB
  replicas: 1        # no need for durability on audio chunks
  consumers:

    - transcription-workers (queue group, round-robin)

# Stream: TRANSCRIPTS — STT results
stream: TRANSCRIPTS
  subjects:

    - transcript.interim.*
    - transcript.final.*
  retention: limits
  max_age: 24h
  max_bytes: 5GB
  replicas: 3
  consumers:

    - translation-workers (queue group, round-robin)
    - persistence-worker (push, writes to PostgreSQL)

# Stream: TRANSLATIONS — completed translations
stream: TRANSLATIONS
  subjects:

    - translation.completed.*
  retention: limits
  max_age: 24h
  max_bytes: 5GB
  replicas: 3
  consumers:

    - broadcast-workers (queue group, fanout to Socket.IO)
    - persistence-worker (push, writes to PostgreSQL)

# Stream: MINUTES — minutes generation pipeline
stream: MINUTES
  subjects:

    - minutes.requested
    - minutes.generated
  retention: limits
  max_age: 7d
  max_bytes: 1GB
  replicas: 3
  consumers:

    - minutes-workers (queue group)
    - notification-workers (push, on minutes.generated)
```

---

## 5. Worker Scaling Strategy

### Scaling Dimensions

| Service | Scale Trigger | Min | Max | Scale Unit |
| --- | --- | --- | --- | --- |
| API Gateway | CPU > 60% or connections > 5000 | 3 | 10 | 1 pod |
| Audio Ingestion | Active meetings > 2000/instance | 5 | 20 | 1 pod |
| Transcription | Deepgram streams > 300/instance | 10 | 50 | 1 pod |
| Translation | Queue depth > 100 or latency > 200ms | 10 | 30 | 1 pod |
| Broadcast | Connected sockets > 10K/instance | 5 | 20 | 1 pod |
| Minutes | Queue depth > 10 | 2 | 5 | 1 pod |
| Notification | Queue depth > 50 | 2 | 3 | 1 pod |

### Kubernetes HPA Config

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: translation-workers-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: translation-workers
  minReplicas: 10
  maxReplicas: 30
  metrics:

    - type: Pods
      pods:
        metric:
          name: nats_consumer_pending_count
        target:
          type: AverageValue
          averageValue: "100"

    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 30
      policies:

        - type: Pods
          value: 5
          periodSeconds: 60
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:

        - type: Pods
          value: 2
          periodSeconds: 120
```

### Capacity Math (100K meetings)

```text
100,000 meetings × ~3 participants avg = 300,000 active streams
300,000 streams × 1 transcript/3 sec = 100,000 transcripts/sec
100,000 transcripts × 3 target langs avg = 300,000 translations/sec

Deepgram streams: 300K / 500 per instance = 600 transcription pods
  (but Deepgram rate limits apply — need enterprise plan)

Translation: 300K/sec / 100 req/sec per GPT worker = 3000 workers
  (mitigated by cache — 80% hit rate → 600 workers)
  (further mitigated by batching interims — ~200 workers)

Broadcast: 300K sockets / 20K per instance = 15 broadcast pods

Redis: 500K ops/sec → Redis Cluster with 6 shards
```

---

## 6. Redis Caching Design

### Key Spaces

```text
# Translation Cache (existing, preserved)
tl:{sourceLang}:{targetLang}:{md5Hash}
  Value: translated text
  TTL: 3600s (1 hour)
  Expected keys: ~500K at peak

# Meeting State (NEW — replaces in-memory meetingLanguages Map)
meeting:state:{meetingId}
  Type: Hash
  Fields:
    status: "active" | "ended"
    orgId: uuid
    createdAt: ISO timestamp
    participantCount: number
  TTL: 86400s (24 hours)

# Meeting Participants (NEW — replaces in-memory meetingLanguages Map)
meeting:langs:{meetingId}
  Type: Hash
  Field: userId → JSON { language, name, receiveVoice }
  TTL: 86400s (24 hours)
  Expected keys: ~100K (one per active meeting)

# Active Streams Registry (NEW)
streams:active:{meetingId}
  Type: Set
  Members: streamId values
  TTL: 86400s

# Event Deduplication (NEW)
dedup:{eventType}:{eventId}
  Type: String (value: "1")
  TTL: 300s (5 minutes)
  Purpose: Prevent duplicate processing in at-least-once delivery

# Translation Rate Limiter (NEW)
ratelimit:translation:{orgId}
  Type: String (counter)
  TTL: 60s
  Purpose: Per-org translation rate limiting

# Socket.IO Adapter (for multi-instance broadcasting)
socket.io#{namespace}#rooms#{roomId}
  Managed by @socket.io/redis-adapter
```

### Redis Cluster Topology

```text
┌─────────────────────────────────────────────────┐
│              Redis Cluster (6 nodes)            │
│                                                 │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐        │
│  │ Master 1│  │ Master 2│  │ Master 3│        │
│  │ Slots   │  │ Slots   │  │ Slots   │        │
│  │ 0-5460  │  │5461-10922│ │10923-16383│       │
│  └────┬────┘  └────┬────┘  └────┬────┘        │
│       │            │            │               │
│  ┌────▼────┐  ┌────▼────┐  ┌────▼────┐        │
│  │Replica 1│  │Replica 2│  │Replica 3│        │
│  └─────────┘  └─────────┘  └─────────┘        │
│                                                 │
│  Keyspace distribution:                         │
│  • tl:* keys → spread across all shards         │
│  • meeting:* → hashed by meetingId              │
│  • BullMQ → dedicated prefix per queue          │
└─────────────────────────────────────────────────┘
```

---

## 7. Integration Plan with Current OrgsLedger Services

### Phase 1: Foundation (Week 1-2) — Zero Breaking Changes

Add infrastructure alongside the monolith. Nothing in the existing codebase changes.

1. **Deploy NATS JetStream** as a Docker service
2. **Deploy Redis Cluster** (replace single Redis instance)
3. **Add Socket.IO Redis Adapter** for multi-instance broadcasting
4. **Add NATS Event Bridge** — publishes events from existing code paths

### Phase 2: Extract Workers (Week 3-4) — Gradual Migration

1. **Extract Translation Workers** into standalone containers
   - Same code, different entry point
   - Subscribe to NATS instead of BullMQ (or keep BullMQ with Redis Cluster)
2. **Extract Broadcast Workers** into standalone containers
3. **Move `meetingLanguages`** from in-memory Map to Redis hash

### Phase 3: Scale Services (Week 5-6)

1. **Extract Transcription Service** — manages Deepgram connections independently
2. **Extract Audio Ingestion** — LiveKit bridge as standalone service
3. **Deploy Kubernetes** with HPA for all services

### Phase 4: Edge + Observability (Week 7-8)

1. **Edge ingestion nodes** in 3 regions
2. **OpenTelemetry** distributed tracing across all services
3. **Prometheus + Grafana** dashboards

### What NEVER changes

- Express routes (auth, meetings, financials, etc.)
- Database schema
- Socket.IO event names/payloads
- Flutter/mobile client code
- Landing page

---

## 8. Edge Processing Architecture

```text
                     ┌─────────────────────────────┐
                     │      Global DNS (Route 53    │
                     │      / Cloudflare)           │
                     │   Latency-based routing      │
                     └──────────┬──────────────────┘
                                │
           ┌────────────────────┼────────────────────┐
           │                    │                     │
    ┌──────▼──────┐     ┌──────▼──────┐      ┌──────▼──────┐
    │  US-EAST    │     │  EU-WEST    │      │  AP-SOUTH   │
    │  Edge Node  │     │  Edge Node  │      │  Edge Node  │
    │             │     │             │      │             │
    │ • WebSocket │     │ • WebSocket │      │ • WebSocket │
    │   termination│    │   termination│     │   termination│
    │ • Audio     │     │ • Audio     │      │ • Audio     │
    │   buffering │     │   buffering │      │   buffering │
    │ • TLS       │     │ • TLS       │      │ • TLS       │
    │   offload   │     │   offload   │      │   offload   │
    └──────┬──────┘     └──────┬──────┘      └──────┬──────┘
           │                   │                     │
           └───────────────────┼─────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │  Central NATS       │
                    │  (or NATS Leaf Node)│
                    │  Event Backbone     │
                    └─────────────────────┘
```

Edge nodes are thin proxies that:

1. Terminate WebSocket/TLS close to the user (reduces latency by 50-200ms)
2. Buffer audio chunks and batch-publish to NATS (reduces event count)
3. Cache recent translations locally (L0 cache for immediate re-broadcast)
4. Handle Socket.IO connection management

---

## 9. Observability Stack

### Prometheus Metrics (exposed by each service)

```text
# Transcription
orgsledger_transcription_latency_seconds{quantile="0.99"}
orgsledger_transcription_active_streams
orgsledger_transcription_errors_total

# Translation
orgsledger_translation_latency_seconds{quantile="0.99"}
orgsledger_translation_cache_hit_ratio
orgsledger_translation_queue_depth

# Broadcast
orgsledger_broadcast_latency_seconds{quantile="0.99"}
orgsledger_broadcast_connected_clients
orgsledger_broadcast_events_per_second

# Meetings
orgsledger_meetings_active_total
orgsledger_meetings_participants_total

# NATS
nats_consumer_pending_count{stream="TRANSCRIPTS"}
nats_consumer_ack_pending{stream="TRANSLATIONS"}
nats_stream_messages_total
```

### OpenTelemetry Trace Flow

```text
Trace: meeting-transcript-pipeline
├── Span: audio.receive (edge node, 2ms)
├── Span: nats.publish audio.chunk (1ms)
├── Span: deepgram.transcribe (200-400ms)
│   └── Span: deepgram.websocket.send
├── Span: nats.publish transcript.final (1ms)
├── Span: translation.pipeline (50-200ms)
│   ├── Span: cache.lookup (1ms)
│   ├── Span: gpt4o-mini.translate (100-300ms) [cache miss only]
│   └── Span: cache.store (1ms)
├── Span: nats.publish translation.completed (1ms)
└── Span: broadcast.emit (5ms)
    └── Span: socketio.to.room.emit
```

---

## 10. Performance Targets vs Architecture Capacity

| Metric | Target | Architecture Capacity |
| --- | --- | --- |
| Simultaneous meetings | 100,000 | ~150,000 (with 50 transcription pods) |
| Transcription latency | < 1 second | 200-400ms (Deepgram Nova-3) |
| Translation latency (cache hit) | < 50ms | 1-5ms (L1) / 5-20ms (Redis L2) |
| Translation latency (cache miss) | < 500ms | 100-300ms (GPT-4o-mini) |
| End-to-end speech→text on screen | < 2 seconds | ~500-800ms |
| Minutes generation | < 60 seconds | 10-30s (GPT-4o) |
| Fault recovery | < 30 seconds | Auto-restart via K8s + NATS replay |
| Regional latency (with edge) | < 100ms | 20-50ms to nearest edge |

---

## Cost Estimate (100K meetings/month)

| Component | Monthly Cost |
| --- | --- |
| Deepgram Enterprise (300K streams) | ~$15,000 |
| OpenAI GPT-4o-mini (translations) | ~$3,000 (with 80% cache hit) |
| Kubernetes cluster (50-100 pods) | ~$5,000 |
| Redis Cluster (6 nodes) | ~$1,200 |
| NATS JetStream (3 nodes) | ~$600 |
| Edge nodes (3 regions) | ~$900 |
| PostgreSQL (Neon Scale) | ~$500 |
| **Total** | **~$26,200/month** |
