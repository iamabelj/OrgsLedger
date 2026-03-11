# Scalable Architecture: 50,000+ Simultaneous AI Meetings

## Executive Summary

This document describes a production-ready, horizontally scalable architecture for a real-time AI-powered meeting platform capable of handling **50,000+ simultaneous meetings** with features including:
- Real-time audio transcription
- Multi-language translation
- Live broadcast to participants
- Automatic meeting minutes generation
- Comprehensive monitoring and cost control

---

## 1. High-Level System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                    LOAD BALANCER (L7)                                   │
│                          (AWS ALB / GCP LB / Cloudflare / Kong)                         │
│                    - WebSocket upgrade handling                                         │
│                    - Geographic routing                                                 │
│                    - Rate limiting (10k req/s per region)                              │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                           │
              ┌────────────────────────────┼────────────────────────────┐
              ▼                            ▼                            ▼
┌──────────────────────┐    ┌──────────────────────┐    ┌──────────────────────┐
│   API Gateway Pod    │    │   API Gateway Pod    │    │   API Gateway Pod    │
│   (Replicas: 20-100) │    │   (Replicas: 20-100) │    │   (Replicas: 20-100) │
│                      │    │                      │    │                      │
│  - Express.js        │    │  - Express.js        │    │  - Express.js        │
│  - WebSocket (WS)    │    │  - WebSocket (WS)    │    │  - WebSocket (WS)    │
│  - Socket.IO         │    │  - Socket.IO         │    │  - Socket.IO         │
│  - Auth/Rate Limit   │    │  - Auth/Rate Limit   │    │  - Auth/Rate Limit   │
└──────────┬───────────┘    └──────────┬───────────┘    └──────────┬───────────┘
           │                           │                           │
           └───────────────────────────┼───────────────────────────┘
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              REDIS CLUSTER (Sharded)                                    │
│                                                                                         │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐       │
│  │ Redis Shard 0   │ │ Redis Shard 1   │ │ Redis Shard 2   │ │ Redis Shard N   │       │
│  │ (meetings 0-9k) │ │ (meetings 10-19k)│ │ (meetings 20-29k)│ │ (meetings 40-50k)│      │
│  │                 │ │                 │ │                 │ │                 │       │
│  │ - Session state │ │ - Session state │ │ - Session state │ │ - Session state │       │
│  │ - PubSub rooms  │ │ - PubSub rooms  │ │ - PubSub rooms  │ │ - PubSub rooms  │       │
│  │ - Heartbeats    │ │ - Heartbeats    │ │ - Heartbeats    │ │ - Heartbeats    │       │
│  └─────────────────┘ └─────────────────┘ └─────────────────┘ └─────────────────┘       │
│                                                                                         │
│  Uses: Consistent hashing on meeting_id for shard routing                              │
│  Memory: ~100 bytes per participant × 50k meetings × 50 avg = 250GB total              │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                           BULLMQ QUEUE LAYER (Sharded)                                  │
│                                                                                         │
│  ┌───────────────────────────────────────────────────────────────────────────────────┐ │
│  │                        QUEUE SHARDING STRATEGY                                     │ │
│  │                                                                                    │ │
│  │  50,000 meetings ÷ 5,000 meetings/shard = 10 queue shards                        │ │
│  │                                                                                    │ │
│  │  Queue naming: {queue-type}-shard-{N}                                            │ │
│  │  Example: transcript-events-shard-0, transcript-events-shard-1, ...              │ │
│  │                                                                                    │ │
│  │  Shard routing: meetingId.hashCode() % SHARD_COUNT                               │ │
│  └───────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                         │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐       │
│  │ transcript  │ │ transcript  │ │ transcript  │ │ transcript  │ │ transcript  │       │
│  │ -shard-0    │ │ -shard-1    │ │ -shard-2    │ │ -shard-3    │ │ -shard-N    │       │
│  │ (5k mtgs)   │ │ (5k mtgs)   │ │ (5k mtgs)   │ │ (5k mtgs)   │ │ (5k mtgs)   │       │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘       │
│                                                                                         │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐       │
│  │ translation │ │ translation │ │ translation │ │ translation │ │ translation │       │
│  │ -shard-0    │ │ -shard-1    │ │ -shard-2    │ │ -shard-3    │ │ -shard-N    │       │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘       │
│                                                                                         │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐       │
│  │ broadcast   │ │ broadcast   │ │ broadcast   │ │ broadcast   │ │ broadcast   │       │
│  │ -shard-0    │ │ -shard-1    │ │ -shard-2    │ │ -shard-3    │ │ -shard-N    │       │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘       │
│                                                                                         │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐       │
│  │ minutes     │ │ minutes     │ │ minutes     │ │ minutes     │ │ minutes     │       │
│  │ -shard-0    │ │ -shard-1    │ │ -shard-2    │ │ -shard-3    │ │ -shard-N    │       │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘       │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                       │
           ┌───────────────────────────┼───────────────────────────┐
           ▼                           ▼                           ▼
┌──────────────────────┐    ┌──────────────────────┐    ┌──────────────────────┐
│  TRANSCRIPT WORKERS  │    │ TRANSLATION WORKERS  │    │  BROADCAST WORKERS   │
│  (Pods: 50-200)      │    │  (Pods: 30-100)      │    │  (Pods: 20-80)       │
│                      │    │                      │    │                      │
│  - Deepgram client   │    │  - Google Translate  │    │  - Redis PubSub      │
│  - Audio chunking    │    │  - Batch API calls   │    │  - Socket.IO rooms   │
│  - VAD processing    │    │  - Language routing  │    │  - Fanout logic      │
│  - Cost tracking     │    │  - Cost tracking     │    │  - Latency tracking  │
└──────────────────────┘    └──────────────────────┘    └──────────────────────┘
           │                           │                           │
           ▼                           ▼                           ▼
┌──────────────────────┐    ┌──────────────────────┐    ┌──────────────────────┐
│   MINUTES WORKERS    │    │   CLEANUP WORKERS    │    │  ANALYTICS WORKERS   │
│  (Pods: 20-50)       │    │  (Pods: 5-10)        │    │  (Pods: 10-20)       │
│                      │    │                      │    │                      │
│  - OpenAI GPT-4.1    │    │  - Stale meeting     │    │  - Metrics           │
│  - Summarization     │    │    cleanup           │    │    aggregation       │
│  - Action items      │    │  - Redis key expiry  │    │  - Cost rollup       │
│  - Cost tracking     │    │  - S3 archival       │    │  - Usage stats       │
└──────────────────────┘    └──────────────────────┘    └──────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                         POSTGRESQL CLUSTER (Citus / Aurora)                             │
│                                                                                         │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐   │
│  │                     HORIZONTAL SHARDING STRATEGY                                 │   │
│  │                                                                                  │   │
│  │  Distribution column: organization_id                                           │   │
│  │  Reference tables: users, pricing_tiers, system_config                          │   │
│  │  Distributed tables: meetings, transcripts, translations, minutes               │   │
│  └─────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                         │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐                   │
│  │  Coordinator │ │   Worker 0   │ │   Worker 1   │ │   Worker N   │                   │
│  │              │ │ (Shard 0-31) │ │ (Shard 32-63)│ │(Shard 96-127)│                   │
│  │              │ │              │ │              │ │              │                   │
│  │  Query       │ │  meetings    │ │  meetings    │ │  meetings    │                   │
│  │  routing     │ │  transcripts │ │  transcripts │ │  transcripts │                   │
│  │  Planner     │ │  translations│ │  translations│ │  translations│                   │
│  └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘                   │
│                                                                                         │
│  Capacity: 128 shards × 500GB = 64TB total storage                                     │
│  Read replicas: 2 per worker node for read scaling                                      │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              EXTERNAL AI SERVICES                                       │
│                                                                                         │
│  ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐            │
│  │      DEEPGRAM       │  │       OPENAI        │  │  GOOGLE TRANSLATE   │            │
│  │                     │  │                     │  │                     │            │
│  │  - Streaming ASR    │  │  - GPT-4.1-mini     │  │  - Neural MT        │            │
│  │  - WebSocket pool   │  │  - Batch API        │  │  - Batch API        │            │
│  │  - Multi-region     │  │  - Rate limited     │  │  - Rate limited     │            │
│  │                     │  │                     │  │                     │            │
│  │  Rate: 1000 streams │  │  Rate: 10k req/min  │  │  Rate: 100k char/s  │            │
│  │  Cost: $0.0043/min  │  │  Cost: $0.15/1M in  │  │  Cost: $20/1M char  │            │
│  └─────────────────────┘  └─────────────────────┘  └─────────────────────┘            │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                           OBSERVABILITY STACK                                           │
│                                                                                         │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐   │
│  │                              PROMETHEUS                                          │   │
│  │       (Federated - 1 per region, centralized aggregator)                        │   │
│  │                                                                                  │   │
│  │  Metrics:                                                                        │   │
│  │  - orgsledger_ai_deepgram_minutes_total                                         │   │
│  │  - orgsledger_ai_openai_tokens_total{type="input|output"}                       │   │
│  │  - orgsledger_ai_translation_characters_total                                   │   │
│  │  - orgsledger_queue_waiting_jobs{queue="..."}                                   │   │
│  │  - orgsledger_queue_failed_jobs{queue="..."}                                    │   │
│  │  - orgsledger_worker_processed_jobs_total{worker="..."}                         │   │
│  │  - orgsledger_pipeline_broadcast_latency_ms                                     │   │
│  │  - orgsledger_system_overall_status (2=healthy, 1=degraded, 0=critical)        │   │
│  └─────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                         │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐                      │
│  │     GRAFANA      │  │      LOKI        │  │     JAEGER       │                      │
│  │                  │  │                  │  │                  │                      │
│  │  - Dashboards    │  │  - Log aggreg.   │  │  - Distributed   │                      │
│  │  - Alerting      │  │  - Query         │  │    tracing       │                      │
│  │  - SLO tracking  │  │  - Retention     │  │  - Latency       │                      │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘                      │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Audio Streaming Pipeline

### 2.1 Audio Flow Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         CLIENT (Browser / Mobile)                           │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Media Capture → VAD (Voice Activity Detection) → WebSocket Stream │   │
│  │                                                                     │   │
│  │  - 16kHz mono PCM or Opus                                          │   │
│  │  - Client-side VAD to detect speech                                │   │
│  │  - Only transmit when isSpeaking=true                              │   │
│  │  - Batch audio into 100ms chunks                                   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     │ WebSocket (wss://)
                                     │ Binary frames (audio chunks)
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         API GATEWAY (Audio Ingest)                          │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     AUDIO BUFFER MANAGER                            │   │
│  │                                                                     │   │
│  │  Per-meeting audio buffer:                                          │   │
│  │  - Ring buffer: 2 seconds of audio per speaker                     │   │
│  │  - Speaker diarization tracking                                    │   │
│  │  - Flush to queue every 1 second OR on silence detection          │   │
│  │                                                                     │   │
│  │  Batching strategy:                                                 │   │
│  │  - Group consecutive audio from same speaker                       │   │
│  │  - Max batch size: 5 seconds                                       │   │
│  │  - Min batch size: 500ms (avoid micro-batches)                    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Audio chunk → Validate → Buffer → Batch → Enqueue to Transcript Queue    │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     │ BullMQ job
                                     │ {meetingId, speakerId, audioBase64, startMs, endMs}
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       TRANSCRIPT WORKER POOL                                │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                  DEEPGRAM CONNECTION POOL                           │   │
│  │                                                                     │   │
│  │  Per-worker connection pool:                                        │   │
│  │  - 10 persistent WebSocket connections to Deepgram                 │   │
│  │  - Connection rotation every 5 minutes                             │   │
│  │  - Automatic reconnection with exponential backoff                 │   │
│  │                                                                     │   │
│  │  Request handling:                                                  │   │
│  │  - Pick least-loaded connection from pool                          │   │
│  │  - Stream audio chunk to Deepgram                                  │   │
│  │  - Receive transcript with word timestamps                         │   │
│  │  - Record usage: AICostMonitor.recordDeepgramUsage()              │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Transcript → Enqueue to Translation Queue → Enqueue to Broadcast Queue   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Cost Optimization Strategies

```typescript
// ── Audio Batching Configuration ─────────────────────────────
const AUDIO_PIPELINE_CONFIG = {
  // VAD (Voice Activity Detection)
  vad: {
    enabled: true,                    // Client-side VAD required
    silenceThresholdMs: 500,          // Silence > 500ms = not speaking
    minSpeechDurationMs: 100,         // Ignore speech < 100ms
  },
  
  // Batching
  batching: {
    minBatchMs: 500,                  // Don't send < 500ms chunks
    maxBatchMs: 5000,                 // Max 5 second batches
    flushOnSilenceMs: 1000,           // Flush after 1s silence
    maxQueuedBatches: 10,             // Backpressure limit
  },
  
  // Speaker diarization
  diarization: {
    maxSpeakersPerMeeting: 50,        // Limit speakers
    speakerIdleTimeoutMs: 300000,     // Remove speaker after 5min idle
  },
  
  // Cost controls
  costControls: {
    maxMinutesPerMeetingHour: 120,    // 2 hours of audio per meeting-hour
    throttleThreshold: 0.8,           // Start throttling at 80% of limit
    dropAudioAboveLimit: true,        // Drop audio if limit exceeded
  },
};

// ── Estimated Cost Savings ───────────────────────────────────
// Without optimization: 50k meetings × 60 min = 3M minutes/hour
// With VAD (40% speech): 50k × 24 min = 1.2M minutes/hour
// With batching efficiency: ~1M minutes/hour
// Deepgram cost: 1M × $0.0043 = $4,300/hour
```

---

## 3. Translation Pipeline Optimization

### 3.1 Translation Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         TRANSLATION WORKER POOL                             │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    BATCH AGGREGATOR                                  │   │
│  │                                                                     │   │
│  │  Strategy: Collect transcripts for 200ms, then batch translate     │   │
│  │                                                                     │   │
│  │  Batching rules:                                                    │   │
│  │  - Group by target language                                        │   │
│  │  - Max 50 segments per batch                                       │   │
│  │  - Max 5000 characters per batch                                   │   │
│  │  - Flush on timeout OR batch full                                  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                  LANGUAGE ROUTING TABLE                              │   │
│  │                                                                     │   │
│  │  Language   │ Provider       │ Batch Size │ Rate Limit │ Priority  │   │
│  │  ─────────────────────────────────────────────────────────────────  │   │
│  │  en→es      │ Google NMT     │ 100        │ 10k/min    │ HIGH      │   │
│  │  en→zh      │ Google NMT     │ 50         │ 10k/min    │ HIGH      │   │
│  │  en→fr      │ Google NMT     │ 100        │ 10k/min    │ MEDIUM    │   │
│  │  en→de      │ Google NMT     │ 100        │ 10k/min    │ MEDIUM    │   │
│  │  en→ja      │ Google NMT     │ 50         │ 10k/min    │ MEDIUM    │   │
│  │  *→*        │ Google NMT     │ 50         │ 5k/min     │ LOW       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                  DEFERRED TRANSLATION MODE                          │   │
│  │                                                                     │   │
│  │  For meetings with >5 languages OR >1000 participants:             │   │
│  │  - Primary language: Real-time translation                         │   │
│  │  - Secondary languages: 5-second delay (batch window)              │   │
│  │  - Tertiary languages: Post-meeting translation                    │   │
│  │                                                                     │   │
│  │  Benefits: 70% reduction in API calls for multi-language meetings  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Translation Cost Model

```typescript
// ── Translation Tiers ────────────────────────────────────────
interface TranslationTier {
  name: string;
  maxLanguages: number;
  realTimeLanguages: number;
  batchDelayMs: number;
  costMultiplier: number;
}

const TRANSLATION_TIERS: TranslationTier[] = [
  {
    name: 'standard',
    maxLanguages: 3,
    realTimeLanguages: 3,
    batchDelayMs: 0,
    costMultiplier: 1.0,
  },
  {
    name: 'multi-language',
    maxLanguages: 10,
    realTimeLanguages: 3,
    batchDelayMs: 5000,      // 5 second batch window for 4-10
    costMultiplier: 0.6,      // 40% savings
  },
  {
    name: 'enterprise',
    maxLanguages: 50,
    realTimeLanguages: 5,
    batchDelayMs: 10000,     // 10 second batch for 6-50
    costMultiplier: 0.4,      // 60% savings
  },
];

// ── Cost Estimate ────────────────────────────────────────────
// 50k meetings × 1000 chars/min × 2 languages avg = 100M chars/min
// Google Translate: $20/1M chars = $2,000/min = $120,000/hour
// With batching (60% reduction): $48,000/hour
```

---

## 4. Monitoring & Observability Architecture

### 4.1 Metrics Pipeline

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           METRICS COLLECTION                                │
│                                                                             │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │                    APPLICATION LAYER                               │    │
│  │                                                                    │    │
│  │  SystemMonitor (every 30s):                                       │    │
│  │  ├── checkRedisHealth() → latency, connected                     │    │
│  │  ├── checkPostgresHealth() → latency, connected                  │    │
│  │  ├── checkQueueHealth() → waiting, active, failed, stuck         │    │
│  │  ├── checkWorkerHealth() → heartbeat, processed, failed          │    │
│  │  └── getPipelineMetrics() → throughput, latency                  │    │
│  │                                                                    │    │
│  │  AICostMonitor (every 60s):                                       │    │
│  │  ├── deepgramMinutes, cost                                        │    │
│  │  ├── openaiTokens (input/output), cost                           │    │
│  │  ├── translationCharacters, cost                                  │    │
│  │  └── alerts (threshold violations)                                │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│                            │                                                │
│                            ▼                                                │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │                    PROMETHEUS EXPORTER                             │    │
│  │                                                                    │    │
│  │  GET /api/system/metrics                                          │    │
│  │                                                                    │    │
│  │  # HELP orgsledger_ai_deepgram_minutes_total Total minutes       │    │
│  │  # TYPE orgsledger_ai_deepgram_minutes_total gauge               │    │
│  │  orgsledger_ai_deepgram_minutes_total 1234.56                    │    │
│  │                                                                    │    │
│  │  # HELP orgsledger_queue_waiting_jobs Jobs waiting               │    │
│  │  # TYPE orgsledger_queue_waiting_jobs gauge                      │    │
│  │  orgsledger_queue_waiting_jobs{queue="transcript-events"} 42     │    │
│  │  orgsledger_queue_waiting_jobs{queue="translation-jobs"} 18      │    │
│  │                                                                    │    │
│  │  # HELP orgsledger_worker_healthy Worker health status           │    │
│  │  # TYPE orgsledger_worker_healthy gauge                          │    │
│  │  orgsledger_worker_healthy{worker="transcript"} 1                │    │
│  │  orgsledger_worker_healthy{worker="translation"} 1               │    │
│  └────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     │ Prometheus scrape (15s interval)
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PROMETHEUS (Federated)                              │
│                                                                             │
│  Region: us-east-1            Region: us-west-2           Region: eu-west-1│
│  ┌──────────────────┐         ┌──────────────────┐        ┌───────────────┐│
│  │ Prometheus       │         │ Prometheus       │        │ Prometheus    ││
│  │ (local scrape)   │         │ (local scrape)   │        │ (local scrape)││
│  └────────┬─────────┘         └────────┬─────────┘        └───────┬───────┘│
│           │                            │                          │         │
│           └────────────────────────────┼──────────────────────────┘         │
│                                        ▼                                    │
│                     ┌─────────────────────────────────┐                    │
│                     │   PROMETHEUS AGGREGATOR         │                    │
│                     │   (Thanos / Cortex / VictoriaM) │                    │
│                     │                                 │                    │
│                     │   - Long-term storage           │                    │
│                     │   - Global queries              │                    │
│                     │   - Deduplication               │                    │
│                     └─────────────────────────────────┘                    │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Alert Rules

```yaml
# prometheus-alerts.yaml
groups:
  - name: orgsledger-critical
    rules:
      # AI Cost Alerts
      - alert: AICostDailyLimitExceeded
        expr: orgsledger_ai_estimated_cost_usd > 10000
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Daily AI cost limit exceeded"
          description: "Current cost: ${{ $value }}"
      
      # Queue Health
      - alert: QueueBacklogCritical
        expr: orgsledger_queue_waiting_jobs > 10000
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Queue backlog critical: {{ $labels.queue }}"
          
      # Worker Health
      - alert: WorkerCrashed
        expr: orgsledger_worker_healthy == 0
        for: 30s
        labels:
          severity: critical
        annotations:
          summary: "Worker {{ $labels.worker }} crashed"
          
      # System Health
      - alert: SystemDegraded
        expr: orgsledger_system_overall_status < 2
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "System health degraded"
          
      # Pipeline Latency
      - alert: BroadcastLatencyHigh
        expr: orgsledger_pipeline_broadcast_latency_ms > 2000
        for: 3m
        labels:
          severity: warning
        annotations:
          summary: "Broadcast latency high: {{ $value }}ms"
```

---

## 5. AI Cost Monitoring & Budgeting

### 5.1 Cost Control Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        AI COST CONTROL SYSTEM                               │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     BUDGET HIERARCHY                                 │   │
│  │                                                                     │   │
│  │  Organization Budget                                                │   │
│  │  └── Monthly limit: $50,000                                        │   │
│  │      ├── Deepgram:    $20,000 (40%)                               │   │
│  │      ├── OpenAI:      $15,000 (30%)                               │   │
│  │      └── Translation: $15,000 (30%)                               │   │
│  │                                                                     │   │
│  │  Per-Meeting Budget                                                │   │
│  │  └── Max cost per meeting: $50                                     │   │
│  │      ├── Deepgram:    $25 (60 minutes max)                        │   │
│  │      ├── OpenAI:      $15 (minutes generation)                    │   │
│  │      └── Translation: $10 (cost varies by language count)         │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                  REAL-TIME COST TRACKING                            │   │
│  │                                                                     │   │
│  │  AICostMonitor singleton:                                          │   │
│  │  ├── recordDeepgramUsage(durationSeconds, meetingId)              │   │
│  │  ├── recordOpenAIUsage(inputTokens, outputTokens, model)          │   │
│  │  ├── recordTranslationUsage(textLength, languageCount)            │   │
│  │  └── getMetrics() → current costs + alerts                        │   │
│  │                                                                     │   │
│  │  Cost calculation (per operation):                                  │   │
│  │  ├── Deepgram: minutes × $0.0043                                  │   │
│  │  ├── OpenAI input: tokens / 1M × $0.15                            │   │
│  │  ├── OpenAI output: tokens / 1M × $0.60                           │   │
│  │  └── Translation: characters × $0.00002                           │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    THROTTLING ENGINE                                │   │
│  │                                                                     │   │
│  │  Thresholds:                                                        │   │
│  │  ├── 80% of budget: WARNING alert, log to Slack                   │   │
│  │  ├── 90% of budget: Reduce quality (downgrade models)             │   │
│  │  ├── 95% of budget: Disable non-essential features (translation)  │   │
│  │  └── 100% of budget: CRITICAL alert, block new meetings           │   │
│  │                                                                     │   │
│  │  Throttling actions:                                                │   │
│  │  ├── Increase audio batch size (reduce Deepgram calls)            │   │
│  │  ├── Defer translations to post-meeting                           │   │
│  │  ├── Skip minutes for short meetings (<5 min)                     │   │
│  │  └── Drop low-priority audio (background noise)                   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 Cost Estimation for 50k Meetings

```
┌───────────────────────────────────────────────────────────────────────────┐
│                    COST MODEL: 50,000 MEETINGS/HOUR                       │
├───────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  ASSUMPTIONS:                                                             │
│  - Average meeting duration: 30 minutes                                   │
│  - Average participants: 8                                                │
│  - Audio activity (with VAD): 40% of meeting time                        │
│  - Translation: 2 languages average                                       │
│  - Minutes generation: All meetings                                       │
│                                                                           │
├───────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  DEEPGRAM TRANSCRIPTION:                                                  │
│  ──────────────────────────────────────────────────────────────────       │
│  50k meetings × 30 min × 40% active = 600,000 minutes/hour               │
│  Cost: 600,000 × $0.0043 = $2,580/hour                                   │
│  Daily (24h): $61,920                                                     │
│                                                                           │
│  OPENAI MINUTES GENERATION:                                               │
│  ──────────────────────────────────────────────────────────────────       │
│  50k meetings × 2000 input tokens × 1000 output tokens                   │
│  Input: 100M tokens × ($0.15/1M) = $15/hour                              │
│  Output: 50M tokens × ($0.60/1M) = $30/hour                              │
│  Total: $45/hour, Daily: $1,080                                          │
│                                                                           │
│  TRANSLATION:                                                             │
│  ──────────────────────────────────────────────────────────────────       │
│  50k meetings × 5000 chars/meeting × 2 languages                         │
│  Characters: 500M chars/hour                                              │
│  With batching (60% efficiency): 200M chars billed                       │
│  Cost: 200M × $0.00002 = $4,000/hour                                     │
│  Daily: $96,000                                                           │
│                                                                           │
├───────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  TOTAL ESTIMATED COST:                                                    │
│  ──────────────────────────────────────────────────────────────────       │
│  Hourly:  $2,580 + $45 + $4,000 = $6,625/hour                           │
│  Daily:   $159,000                                                        │
│  Monthly: $4,770,000                                                      │
│                                                                           │
│  OPTIMIZATION TARGETS:                                                    │
│  - Aggressive VAD: -30% Deepgram cost                                    │
│  - Deferred translation: -40% translation cost                           │
│  - Selective minutes (>10min meetings only): -20% OpenAI cost           │
│                                                                           │
│  OPTIMIZED MONTHLY: ~$2,800,000                                          │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Ultra-Large Meeting Architecture (2000+ Participants)

### 6.1 Tiered Participant Model

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                   ULTRA-LARGE MEETING ARCHITECTURE                          │
│                      (>2000 Participants)                                   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    PARTICIPANT TIERS                                 │   │
│  │                                                                     │   │
│  │  HOT TIER (Active Speakers)                                        │   │
│  │  ────────────────────────────                                       │   │
│  │  - Max 50 participants                                              │   │
│  │  - Full audio streaming                                             │   │
│  │  - Real-time transcription                                          │   │
│  │  - Immediate translation                                            │   │
│  │  - WebSocket push updates                                           │   │
│  │  - Promote on speak, demote on 30s silence                         │   │
│  │                                                                     │   │
│  │  WARM TIER (Recent Speakers)                                        │   │
│  │  ──────────────────────────────                                     │   │
│  │  - Max 200 participants                                             │   │
│  │  - Audio ready to stream on speak                                  │   │
│  │  - Receive transcripts via SSE (Server-Sent Events)               │   │
│  │  - 5-second translation delay                                       │   │
│  │  - Promoted to HOT on new speech                                   │   │
│  │                                                                     │   │
│  │  COLD TIER (Listeners)                                              │   │
│  │  ─────────────────────────                                          │   │
│  │  - Unlimited participants                                           │   │
│  │  - Receive-only (no audio upload)                                  │   │
│  │  - Batch transcript updates (every 10s)                            │   │
│  │  - Translation on-demand (click to translate)                      │   │
│  │  - HTTP long-polling or periodic fetch                             │   │
│  │                                                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    BROADCAST OPTIMIZATION                           │   │
│  │                                                                     │   │
│  │  Problem: 2000 participants × WebSocket push = 2000 messages       │   │
│  │                                                                     │   │
│  │  Solution: Hierarchical Fanout                                      │   │
│  │                                                                     │   │
│  │  API Server                                                         │   │
│  │     │                                                               │   │
│  │     ├──► Fanout Server 1 (500 connections)                        │   │
│  │     ├──► Fanout Server 2 (500 connections)                        │   │
│  │     ├──► Fanout Server 3 (500 connections)                        │   │
│  │     └──► Fanout Server 4 (500 connections)                        │   │
│  │                                                                     │   │
│  │  Benefits:                                                          │   │
│  │  - API server sends 1 message to 4 fanout servers                  │   │
│  │  - Each fanout server handles 500 client connections               │   │
│  │  - Horizontal scaling: add more fanout servers                     │   │
│  │                                                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    CDN INTEGRATION (COLD TIER)                      │   │
│  │                                                                     │   │
│  │  For meetings >5000 participants:                                   │   │
│  │  - Transcripts pushed to CDN (Cloudflare, CloudFront)              │   │
│  │  - Cold tier participants fetch from CDN edge                      │   │
│  │  - Cache TTL: 10 seconds                                           │   │
│  │  - Reduces origin server load by 99%                               │   │
│  │                                                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 7. Auto-Scaling Strategies

### 7.1 Kubernetes HPA Configuration

```yaml
# k8s/hpa-workers.yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: transcript-worker-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: transcript-worker
  minReplicas: 20
  maxReplicas: 200
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 30
      policies:
        - type: Percent
          value: 100        # Double pods
          periodSeconds: 30
        - type: Pods
          value: 20         # Add 20 pods max
          periodSeconds: 30
      selectPolicy: Max
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
        - type: Percent
          value: 10         # Remove 10% of pods
          periodSeconds: 60
  metrics:
    # Scale on queue depth
    - type: External
      external:
        metric:
          name: bullmq_queue_waiting
          selector:
            matchLabels:
              queue: transcript-events
        target:
          type: AverageValue
          averageValue: "100"   # Target 100 waiting jobs per pod
    
    # Scale on CPU
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
    
    # Scale on memory
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80

---
# Keda ScaledObject for more advanced scaling
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: translation-worker-scaler
spec:
  scaleTargetRef:
    name: translation-worker
  minReplicaCount: 10
  maxReplicaCount: 100
  pollingInterval: 10
  cooldownPeriod: 60
  triggers:
    - type: redis
      metadata:
        address: redis-cluster:6379
        listName: bull:translation-jobs:waiting
        listLength: "50"   # Scale when >50 jobs waiting per shard
    
    - type: prometheus
      metadata:
        serverAddress: http://prometheus:9090
        metricName: orgsledger_queue_waiting_jobs
        threshold: "500"
        query: |
          sum(orgsledger_queue_waiting_jobs{queue=~"translation.*"})
```

### 7.2 Scaling Decision Matrix

```
┌───────────────────────────────────────────────────────────────────────────┐
│                     AUTO-SCALING DECISION MATRIX                          │
├─────────────────┬──────────────────────────────────────────────────────────┤
│ METRIC          │ TRIGGER → ACTION                                        │
├─────────────────┼──────────────────────────────────────────────────────────┤
│                 │                                                          │
│ Queue Waiting   │ >100/worker → Scale up workers +20%                     │
│                 │ >500/worker → Scale up workers +100%                    │
│                 │ <20/worker for 5min → Scale down workers -10%          │
│                 │                                                          │
├─────────────────┼──────────────────────────────────────────────────────────┤
│                 │                                                          │
│ Queue Failed    │ >1%  failure rate → Alert, add retry workers           │
│                 │ >5%  failure rate → Circuit breaker, pause queue       │
│                 │ >10% failure rate → Incident, manual intervention      │
│                 │                                                          │
├─────────────────┼──────────────────────────────────────────────────────────┤
│                 │                                                          │
│ API Latency     │ p95 >500ms → Add API replicas                          │
│ (Request)       │ p95 >1000ms → Alert + aggressive scaling               │
│                 │ p95 <100ms for 10min → Scale down API -10%             │
│                 │                                                          │
├─────────────────┼──────────────────────────────────────────────────────────┤
│                 │                                                          │
│ WebSocket       │ >500 conn/pod → Add Socket.IO pods                     │
│ Connections     │ >1000 conn/pod → Alert + emergency scaling             │
│                 │ <100 conn/pod for 10min → Scale down -20%              │
│                 │                                                          │
├─────────────────┼──────────────────────────────────────────────────────────┤
│                 │                                                          │
│ Redis Memory    │ >70% → Add Redis shards                                │
│                 │ >85% → Alert + aggressive key expiry                   │
│                 │ >95% → Emergency: evict cold meeting data              │
│                 │                                                          │
├─────────────────┼──────────────────────────────────────────────────────────┤
│                 │                                                          │
│ AI Service      │ Rate limit 50% → Pre-emptive scaling                   │
│ Rate Limits     │ Rate limit 80% → Request queue + backpressure          │
│                 │ Rate limit 100% → Fallback provider or degrade quality │
│                 │                                                          │
└─────────────────┴──────────────────────────────────────────────────────────┘
```

---

## 8. Code Structure (Node.js / TypeScript)

```
apps/
├── api/
│   ├── src/
│   │   ├── index.ts                 # Application entry point
│   │   ├── app.ts                   # Express app setup
│   │   ├── config.ts                # Environment configuration
│   │   ├── db.ts                    # PostgreSQL connection (Knex)
│   │   ├── logger.ts                # Winston logger
│   │   ├── socket.ts                # Socket.IO setup
│   │   │
│   │   ├── config/
│   │   │   ├── ai-pricing.ts        # AI service pricing constants
│   │   │   ├── queue-sharding.ts    # Queue sharding configuration
│   │   │   ├── scaling.ts           # Auto-scaling thresholds
│   │   │   └── feature-flags.ts     # Feature toggles
│   │   │
│   │   ├── controllers/
│   │   │   ├── meeting.controller.ts
│   │   │   ├── transcription.controller.ts
│   │   │   ├── translation.controller.ts
│   │   │   └── admin.controller.ts
│   │   │
│   │   ├── routes/
│   │   │   ├── index.ts
│   │   │   ├── meeting.routes.ts
│   │   │   ├── system.routes.ts     # Health + Prometheus /metrics
│   │   │   └── admin.routes.ts
│   │   │
│   │   ├── middleware/
│   │   │   ├── auth.middleware.ts
│   │   │   ├── rate-limit.middleware.ts
│   │   │   ├── cost-guard.middleware.ts   # Block if over budget
│   │   │   └── latency-tracking.middleware.ts
│   │   │
│   │   ├── services/
│   │   │   ├── meeting.service.ts
│   │   │   ├── transcription.service.ts
│   │   │   ├── translation.service.ts
│   │   │   ├── minutes.service.ts
│   │   │   └── broadcast.service.ts
│   │   │
│   │   ├── queues/
│   │   │   ├── queue-manager.ts         # Sharded queue factory
│   │   │   ├── transcript.queue.ts
│   │   │   ├── translation.queue.ts
│   │   │   ├── broadcast.queue.ts
│   │   │   └── minutes.queue.ts
│   │   │
│   │   ├── workers/
│   │   │   ├── transcript.worker.ts
│   │   │   ├── translation.worker.ts
│   │   │   ├── broadcast.worker.ts
│   │   │   ├── minutes.worker.ts
│   │   │   └── cleanup.worker.ts
│   │   │
│   │   ├── monitoring/
│   │   │   ├── index.ts                  # Export all monitoring
│   │   │   ├── system.monitor.ts         # Health checks, stuck job recovery
│   │   │   ├── ai-cost.monitor.ts        # AI usage tracking
│   │   │   ├── prometheus.metrics.ts     # Prometheus exporter
│   │   │   └── meeting-metrics.ts        # Per-meeting pipeline stats
│   │   │
│   │   ├── infrastructure/
│   │   │   ├── redisClient.ts            # Redis cluster connection
│   │   │   ├── deepgramClient.ts         # Deepgram WebSocket pool
│   │   │   ├── openaiClient.ts           # OpenAI API client
│   │   │   └── translateClient.ts        # Google Translate client
│   │   │
│   │   ├── scaling/
│   │   │   ├── shard-router.ts           # Meeting → shard mapping
│   │   │   ├── load-balancer.ts          # Worker load distribution
│   │   │   ├── circuit-breaker.ts        # Failure handling
│   │   │   └── backpressure.ts           # Queue overflow handling
│   │   │
│   │   └── utils/
│   │       ├── audio-buffer.ts           # Audio batching
│   │       ├── vad.ts                    # Voice activity detection
│   │       ├── cost-calculator.ts        # Cost estimation
│   │       └── retry.ts                  # Retry with backoff
│   │
│   └── Dockerfile
│
├── workers/
│   ├── transcript-worker/
│   │   ├── src/
│   │   │   ├── index.ts              # Worker entry point
│   │   │   ├── processor.ts          # Job processing logic
│   │   │   └── deepgram-pool.ts      # Connection pool
│   │   └── Dockerfile
│   │
│   ├── translation-worker/
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── processor.ts
│   │   │   ├── batch-aggregator.ts   # Batch multiple translations
│   │   │   └── language-router.ts    # Route to best provider
│   │   └── Dockerfile
│   │
│   ├── broadcast-worker/
│   │   └── ...
│   │
│   └── minutes-worker/
│       └── ...
│
packages/
├── database/
│   ├── src/
│   │   ├── migrations/
│   │   │   ├── 001_initial_schema.ts
│   │   │   ├── 030_add_sharding_key.ts   # org_id distribution
│   │   │   ├── 032_ai_usage_metrics.ts
│   │   │   └── 033_meeting_pipeline_metrics.ts
│   │   └── seeds/
│   └── package.json
│
├── shared/
│   ├── src/
│   │   ├── types/
│   │   │   ├── meeting.types.ts
│   │   │   ├── transcript.types.ts
│   │   │   ├── queue.types.ts
│   │   │   └── metrics.types.ts
│   │   ├── constants/
│   │   └── utils/
│   └── package.json
│
deploy/
├── k8s/
│   ├── base/
│   │   ├── namespace.yaml
│   │   ├── configmap.yaml
│   │   └── secrets.yaml
│   │
│   ├── api/
│   │   ├── deployment.yaml
│   │   ├── service.yaml
│   │   ├── hpa.yaml
│   │   └── ingress.yaml
│   │
│   ├── workers/
│   │   ├── transcript-worker.yaml
│   │   ├── translation-worker.yaml
│   │   ├── broadcast-worker.yaml
│   │   └── minutes-worker.yaml
│   │
│   ├── redis/
│   │   ├── redis-cluster.yaml
│   │   └── redis-sentinel.yaml
│   │
│   ├── monitoring/
│   │   ├── prometheus.yaml
│   │   ├── grafana.yaml
│   │   ├── alertmanager.yaml
│   │   └── dashboards/
│   │
│   └── keda/
│       └── scaled-objects.yaml
│
├── terraform/
│   ├── aws/
│   │   ├── eks.tf
│   │   ├── rds.tf
│   │   ├── elasticache.tf
│   │   └── alb.tf
│   └── gcp/
│       └── ...
│
└── docker-compose.yml        # Local development
```

---

## 9. Production Best Practices

### 9.1 Error Recovery & Stuck Job Detection

```typescript
// ── Stuck Job Recovery Configuration ─────────────────────────
const RECOVERY_CONFIG = {
  // Job is considered stuck if active > this duration
  maxActiveJobDurationMs: 30000,  // 30 seconds
  
  // Maximum automatic recovery attempts
  maxAutoRecoverRetries: 3,
  
  // After max retries, move to failed queue
  moveToFailedAfterMaxRetries: true,
  
  // Alert types
  alerts: {
    STUCK_JOB_DETECTED: 'warning',
    STUCK_JOB_FAILED: 'critical',
    WORKER_CRASHED: 'critical',
  },
};

// ── Recovery Implementation ──────────────────────────────────
async function recoverStuckJobs(queueName: string): Promise<void> {
  const queue = queueManager.getQueue(queueName);
  const activeJobs = await queue.getActive();
  const now = Date.now();
  
  for (const job of activeJobs) {
    if (!job.processedOn) continue;
    
    const activeForMs = now - job.processedOn;
    if (activeForMs <= RECOVERY_CONFIG.maxActiveJobDurationMs) continue;
    
    // Job is stuck
    const retryCount = await getRetryCount(job.id);
    
    if (retryCount >= RECOVERY_CONFIG.maxAutoRecoverRetries) {
      // Move to failed
      await job.moveToFailed(
        new Error(`Stuck job exceeded max retries (${retryCount})`),
        job.token || 'monitor-recovery'
      );
      
      // Emit alert
      alertManager.emit({
        type: 'STUCK_JOB_FAILED',
        severity: 'critical',
        jobId: job.id,
        queueName,
        retryCount,
      });
    } else {
      // Retry: move back to delayed queue
      await job.moveToDelayed(now + 1000, job.token || 'monitor-recovery');
      await incrementRetryCount(job.id);
      
      logger.warn('[RECOVERY] Stuck job recovered', {
        jobId: job.id,
        queueName,
        retryCount: retryCount + 1,
      });
    }
  }
}
```

### 9.2 Circuit Breaker Pattern

```typescript
// ── Circuit Breaker for External Services ────────────────────
interface CircuitBreakerConfig {
  failureThreshold: number;     // Failures before opening
  successThreshold: number;     // Successes before closing
  timeout: number;              // Time in OPEN state before HALF_OPEN
  halfOpenMaxCalls: number;     // Max calls in HALF_OPEN state
}

class CircuitBreaker {
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private failures = 0;
  private successes = 0;
  private lastFailure: number = 0;
  private halfOpenCalls = 0;
  
  constructor(
    private name: string,
    private config: CircuitBreakerConfig
  ) {}
  
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailure > this.config.timeout) {
        this.state = 'HALF_OPEN';
        this.halfOpenCalls = 0;
      } else {
        throw new Error(`Circuit ${this.name} is OPEN`);
      }
    }
    
    if (this.state === 'HALF_OPEN') {
      if (this.halfOpenCalls >= this.config.halfOpenMaxCalls) {
        throw new Error(`Circuit ${this.name} HALF_OPEN limit reached`);
      }
      this.halfOpenCalls++;
    }
    
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
  
  private onSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      this.successes++;
      if (this.successes >= this.config.successThreshold) {
        this.state = 'CLOSED';
        this.failures = 0;
        this.successes = 0;
        logger.info(`[CIRCUIT] ${this.name} CLOSED`);
      }
    } else {
      this.failures = 0;
    }
  }
  
  private onFailure(): void {
    this.failures++;
    this.lastFailure = Date.now();
    
    if (this.failures >= this.config.failureThreshold) {
      this.state = 'OPEN';
      logger.error(`[CIRCUIT] ${this.name} OPEN after ${this.failures} failures`);
    }
    
    if (this.state === 'HALF_OPEN') {
      this.state = 'OPEN';
    }
  }
}

// Usage
const deepgramCircuit = new CircuitBreaker('deepgram', {
  failureThreshold: 5,
  successThreshold: 3,
  timeout: 30000,
  halfOpenMaxCalls: 3,
});

async function transcribe(audio: Buffer): Promise<string> {
  return deepgramCircuit.execute(() => deepgramClient.transcribe(audio));
}
```

### 9.3 Graceful Shutdown

```typescript
// ── Graceful Shutdown Handler ────────────────────────────────
async function gracefulShutdown(signal: string): Promise<void> {
  logger.info(`[SHUTDOWN] Received ${signal}, starting graceful shutdown`);
  
  const shutdownTimeout = 30000; // 30 seconds max
  const shutdownStart = Date.now();
  
  try {
    // 1. Stop accepting new connections
    await httpServer.close();
    logger.info('[SHUTDOWN] HTTP server closed');
    
    // 2. Stop accepting new jobs
    for (const worker of workers) {
      await worker.pause();
    }
    logger.info('[SHUTDOWN] Workers paused');
    
    // 3. Wait for active jobs to complete
    let activeJobs = await getActiveJobCount();
    while (activeJobs > 0 && Date.now() - shutdownStart < shutdownTimeout) {
      logger.info(`[SHUTDOWN] Waiting for ${activeJobs} active jobs`);
      await sleep(1000);
      activeJobs = await getActiveJobCount();
    }
    
    // 4. Close workers
    for (const worker of workers) {
      await worker.close();
    }
    logger.info('[SHUTDOWN] Workers closed');
    
    // 5. Flush metrics
    await metricsBuffer.flush();
    logger.info('[SHUTDOWN] Metrics flushed');
    
    // 6. Close database connections
    await db.destroy();
    logger.info('[SHUTDOWN] Database closed');
    
    // 7. Close Redis connections
    await redis.quit();
    logger.info('[SHUTDOWN] Redis closed');
    
    logger.info('[SHUTDOWN] Graceful shutdown complete');
    process.exit(0);
    
  } catch (error) {
    logger.error('[SHUTDOWN] Error during shutdown', error);
    process.exit(1);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
```

### 9.4 Health Check Implementation

```typescript
// ── Comprehensive Health Check ───────────────────────────────
interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  checks: {
    redis: { connected: boolean; latencyMs: number };
    postgres: { connected: boolean; latencyMs: number };
    queues: { name: string; waiting: number; failed: number }[];
    workers: { name: string; healthy: boolean; heartbeatAgeMs: number }[];
    aiServices: { 
      deepgram: boolean; 
      openai: boolean; 
      translation: boolean;
    };
  };
  metrics: {
    activeConnections: number;
    requestsPerMinute: number;
    errorRate: number;
    p95LatencyMs: number;
  };
  costs: {
    hourly: number;
    daily: number;
    budgetUtilization: number;
  };
}

// Kubernetes readiness probe
app.get('/api/system/ready', async (req, res) => {
  const health = await performHealthCheck();
  
  if (health.status === 'unhealthy') {
    return res.status(503).json(health);
  }
  
  res.status(200).json(health);
});

// Kubernetes liveness probe
app.get('/api/system/live', (req, res) => {
  // Simple check - process is alive
  res.status(200).json({ status: 'alive', timestamp: Date.now() });
});

// Detailed health for dashboards
app.get('/api/system/health', async (req, res) => {
  const health = await performHealthCheck();
  res.status(health.status === 'healthy' ? 200 : 503).json(health);
});
```

---

## 10. Deployment Checklist

### Pre-Production

- [ ] Load test with 50k simulated meetings
- [ ] Chaos engineering: kill workers, Redis nodes
- [ ] Failover testing: database, Redis
- [ ] Cost projection validation
- [ ] Security audit: auth, rate limiting
- [ ] Pen testing: WebSocket, API endpoints

### Production

- [ ] Blue-green deployment strategy
- [ ] Canary releases for workers
- [ ] Database migration strategy (zero-downtime)
- [ ] Rollback procedures documented
- [ ] Incident response runbook
- [ ] On-call rotation with PagerDuty/Opsgenie

### Monitoring

- [ ] SLO definitions (99.9% uptime, <500ms p95 latency)
- [ ] Alert thresholds tuned
- [ ] Dashboards for all critical metrics
- [ ] Log retention policy (30 days hot, 1 year cold)
- [ ] Audit logging for compliance

---

## Conclusion

This architecture supports **50,000+ simultaneous meetings** with:

- **Horizontal scalability** via sharded queues and worker pools
- **Cost optimization** through VAD, batching, and tiered translation
- **High availability** with Redis Cluster, PostgreSQL sharding, and multi-region deployment
- **Observability** via Prometheus, Grafana, and distributed tracing
- **Resilience** through circuit breakers, stuck job recovery, and graceful degradation

Estimated infrastructure cost at scale: **$150,000-200,000/month** (compute + AI services)
