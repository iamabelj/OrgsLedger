# OrgsLedger API — Production Deployment Checklist

**Generated:** Production-Ready Configuration Summary  
**Target:** 50,000+ concurrent meetings at scale

---

## ✅ Environment Variables

### Core Services
| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `production` | Must be `production` |
| `PORT` | `3000` | API server port |
| `DATABASE_URL` | - | PostgreSQL connection string |
| `REDIS_HOST` | `localhost` | Redis host |
| `REDIS_PORT` | `6379` | Redis port |
| `REDIS_PASSWORD` | - | Redis authentication |

### Redis High-Availability
| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_MODE` | `standalone` | `standalone` \| `sentinel` \| `cluster` |
| `REDIS_SENTINEL_NODES` | - | e.g., `host1:26379,host2:26379` |
| `REDIS_SENTINEL_MASTER` | `mymaster` | Sentinel master name |
| `REDIS_CLUSTER_NODES` | - | e.g., `host1:6379,host2:6379,host3:6379` |

### Queue Sharding
| Variable | Default | Description |
|----------|---------|-------------|
| `TRANSCRIPT_SHARDS` | `32` | High throughput (250k jobs/min) |
| `TRANSLATION_SHARDS` | `16` | Moderate throughput |
| `BROADCAST_SHARDS` | `16` | Moderate throughput |
| `MINUTES_SHARDS` | `8` | AI processing |

### Worker Configuration
| Variable | Default | Description |
|----------|---------|-------------|
| `MIN_WORKERS` | `2` | Minimum worker pool size |
| `MAX_WORKERS` | `20` | Maximum worker pool size |
| `WORKER_SCALE_UP_THRESHOLD` | `100` | Queue depth to scale up |
| `WORKER_SCALE_DOWN_THRESHOLD` | `20` | Queue depth to scale down |
| `EVENT_REPLAY_INTERVAL_MS` | `30000` | Event replay cycle (30s) |
| `EVENT_REPLAY_BATCH_SIZE` | `100` | Events per replay cycle |
| `EVENT_REPLAY_MAX_RETRIES` | `5` | Max retry attempts |

### Rate Limits
| Variable | Default | Description |
|----------|---------|-------------|
| `MEETING_RATE_LIMIT_RPM` | `1000` | Meetings created/min global |
| `TRANSCRIPT_RATE_LIMIT_PM` | `50000` | Transcripts/min |
| `AI_RATE_LIMIT_RPM` | `2000` | AI requests/min |

### AI Service Limits
| Variable | Default | Description |
|----------|---------|-------------|
| `DEEPGRAM_RATE_LIMIT_RPM` | `200` | Deepgram requests/min |
| `OPENAI_RATE_LIMIT_RPM` | `500` | OpenAI requests/min |
| `OPENAI_RATE_LIMIT_TPM` | `200000` | OpenAI tokens/min |
| `TRANSLATE_RATE_LIMIT_RPM` | `1000` | Translation requests/min |
| `AI_MEETING_TOKEN_LIMIT` | `100000` | Max tokens per meeting |
| `AI_DAILY_BUDGET_USD` | - | Daily cost cap (optional) |

### Load Shedding Thresholds
| Variable | Default | Description |
|----------|---------|-------------|
| `MAX_ACTIVE_MEETINGS` | `60000` | Reject new meetings above this |
| `MAX_QUEUE_LATENCY_MS` | `2000` | Shed load on queue lag |
| `MAX_WS_CONNECTIONS` | `200000` | Max WebSocket connections |
| `MAX_REDIS_MEMORY_PERCENT` | `0.90` | 90% Redis memory threshold |

### AI Circuit Breaker
| Variable | Default | Description |
|----------|---------|-------------|
| `AI_CB_WINDOW_SIZE` | `50` | Rolling window requests |
| `AI_CB_ERROR_THRESHOLD` | `0.20` | 20% error rate opens circuit |
| `AI_CB_LATENCY_THRESHOLD_MS` | `3000` | 3s avg latency opens circuit |
| `AI_CB_OPEN_DURATION_MS` | `60000` | 60s open before half-open |

---

## ✅ Middleware Execution Order

```
1. express.json (10MB body limit)
2. helmet (security headers)
3. compression (gzip)
4. cors (cross-origin)
5. static file serving
6. Auth rate limiter (/api/auth*)
7. Session expiry middleware (/api)
8. Global Load Shedder ← ALL routes protected
9. Webhook rate limiter (/api/payments/webhooks)
10. Route handlers with Rate Governor (/api/meetings)
11. 404 handler
12. Error monitoring + global error handler
```

---

## ✅ Queue Names & Sharding

| Queue Type | Shards | Pattern |
|------------|--------|---------|
| Transcript | 32 | `transcript-jobs-shard-{0..31}` |
| Translation | 16 | `translation-jobs-shard-{0..15}` |
| Broadcast | 16 | `broadcast-jobs-shard-{0..15}` |
| Minutes | 8 | `minutes-jobs-shard-{0..7}` |

**Routing:** `djb2Hash(meetingId) % SHARD_COUNT` (deterministic)

---

## ✅ Event Durability Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  1. Event received                                          │
│     ↓                                                       │
│  2. Persist to PostgreSQL (meeting_events table)            │
│     ↓                                                       │
│  3. Submit to BullMQ queue                                  │
│     ↓                                                       │
│  4. Mark processed on success                               │
│     │                                                       │
│     └── If queue fails → Event Replay Worker retries        │
│         (30-second cycles, exponential backoff)             │
└─────────────────────────────────────────────────────────────┘
```

**PostgreSQL Table:** `meeting_events`
- Indexes: `(meeting_id, created_at)`, `(processed)`
- Retention: Configurable (default indefinite for audit)

---

## ✅ Monitoring Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /metrics` | Prometheus metrics |
| `GET /health` | Basic health check |
| `GET /api/admin/observability/health` | Detailed health |
| `GET /api/system/status` | System status |

---

## ✅ Prometheus Metrics Summary

### Load Management (7 metrics)
- `orgsledger_load_shedder_rejections_total`
- `orgsledger_load_shedder_shedding`
- `orgsledger_load_shedder_active_meetings`
- `orgsledger_load_shedder_queue_latency`
- `orgsledger_load_shedder_ws_connections`
- `orgsledger_load_shedder_redis_memory`
- `orgsledger_global_rate_limit_*` (hits, current, allowed)

### Queue Health (12 metrics)
- `orgsledger_queue_waiting` / `_active` / `_failed` / `_stuck`
- `orgsledger_queue_*_sharded` (per-shard metrics)
- `orgsledger_queue_lag` / `_waiting_latency_ms` / `_total_latency_ms`
- `orgsledger_queue_backpressure_*`

### AI Services (15 metrics)
- `orgsledger_ai_circuit_breaker_state` / `_failures` / `_successes` / `_rejects`
- `orgsledger_ai_rate_limit_utilization` / `_warning` / `_backpressure`
- `orgsledger_ai_deepgram_minutes_total`
- `orgsledger_ai_openai_tokens_total`
- `orgsledger_ai_estimated_cost_usd`
- `orgsledger_ai_cost_*` (utilization, projected_daily, budget_remaining)

### Event Durability (8 metrics)
- `orgsledger_event_store_total` / `_latency_ms` / `_pending`
- `orgsledger_event_bridge_submit_total` / `_queue_failures_total` / `_latency_ms`
- `orgsledger_event_replay_*` (attempts, success, failures, pending)
- `orgsledger_idempotency_checks_total` / `_duplicates_total`

### Workers (10 metrics)
- `orgsledger_worker_healthy` / `_processed_jobs_total` / `_failed_jobs_total`
- `orgsledger_worker_alive` / `_unhealthy` / `_dead`
- `orgsledger_autoscaler_workers` / `_scale_events` / `_queue_depth` / `_lag`

### Redis Health (12 metrics)
- `orgsledger_redis_memory_*` (used, max, usage)
- `orgsledger_redis_evicted_keys` / `_fragmentation`
- `orgsledger_redis_connected_clients` / `_blocked_clients` / `_ops_per_sec`
- `orgsledger_redis_failover_*` (mode, connected, reconnects, failovers, errors)

### WebSocket (7 metrics)
- `orgsledger_socket_connections` / `_rooms`
- `orgsledger_ws_connection_attempts` / `_accepted` / `_throttled`
- `orgsledger_ws_connection_rate` / `_active_connections`

---

## ✅ Pre-Deployment Verification

### Database
- [ ] PostgreSQL 14+ with `gen_random_uuid()` support
- [ ] `meeting_events` table created (event store migration)
- [ ] Connection pooling configured (recommended: 50-100)
- [ ] `PGBOUNCER` or direct connections confirmed

### Redis
- [ ] Redis 6.2+ for BullMQ compatibility
- [ ] `maxmemory-policy` set to `noeviction` or `allkeys-lru`
- [ ] Memory sizing: ~1GB per 10k active meetings
- [ ] Persistence: RDB or AOF enabled for durability
- [ ] Sentinel/Cluster configured if `REDIS_MODE != standalone`

### Workers
- [ ] All worker types registered in `workers/index.ts`
- [ ] Worker autoscaler started (transcript workers)
- [ ] Event replay worker started (single leader)
- [ ] Graceful shutdown handlers in place

### Networking
- [ ] Load balancer timeout > 65 seconds (API `keepAliveTimeout`)
- [ ] WebSocket support enabled (sticky sessions if multiple nodes)
- [ ] Health check endpoint configured on LB

### Secrets
- [ ] `DEEPGRAM_API_KEY` set
- [ ] `OPENAI_API_KEY` set
- [ ] `JWT_SECRET` set (256+ bit random)
- [ ] `DATABASE_URL` with SSL if external

---

## ✅ Alert Thresholds (Recommended)

| Metric | Warning | Critical |
|--------|---------|----------|
| `queue_waiting > N` | 1000 | 5000 |
| `queue_failed > N` | 10 | 50 |
| `ai_circuit_breaker_state = 2` | - | OPEN |
| `redis_memory_usage > %` | 80% | 95% |
| `redis_evicted_keys > 0` | - | CRITICAL |
| `load_shedder_shedding = 1` | - | WARNING |
| `event_replay_pending > N` | 100 | 500 |
| `worker_dead > 0` | - | CRITICAL |

---

## ✅ Runbook Quick Reference

### Load Shedding Activated
1. Check `redis_memory_usage` — scale Redis or evict stale meetings
2. Check `queue_lag` — scale workers or reduce meeting throughput
3. Check `ws_connections` — enable graceful drain mode

### AI Circuit Breaker OPEN
1. Check AI provider status (status.openai.com / deepgram.com)
2. Review `ai_circuit_breaker_failures_total` for error patterns
3. Manually reset if false positive: `forceCircuitState('openai', 'CLOSED')`

### Event Replay Backlog
1. Check `event_replay_pending` — should be < 100 normally
2. Review `event_replay_failures_total` — identify failing event types
3. Check PostgreSQL connectivity for event store
4. Increase `EVENT_REPLAY_BATCH_SIZE` temporarily

### Queue Backlog
1. Scale workers: set `MAX_WORKERS` higher or deploy more replicas
2. Review `queue_failed` for stuck jobs — may need DLQ intervention
3. Check Redis latency — may indicate memory pressure

---

**Status:** READY FOR PRODUCTION ✅

