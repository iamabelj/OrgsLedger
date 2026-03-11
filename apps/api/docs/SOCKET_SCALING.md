# Socket.IO Horizontal Scaling Guide

This document describes how to deploy OrgsLedger API with horizontally scaled WebSocket (Socket.IO) infrastructure.

## Architecture Overview

```
                    ┌─────────────────┐
                    │  Load Balancer  │
                    │  (NGINX/ALB)    │
                    │  sticky session │
                    └────────┬────────┘
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
         ▼                   ▼                   ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│   API Server 1  │ │   API Server 2  │ │   API Server N  │
│   Socket.IO     │ │   Socket.IO     │ │   Socket.IO     │
│   Worker ID: A  │ │   Worker ID: B  │ │   Worker ID: N  │
└────────┬────────┘ └────────┬────────┘ └────────┬────────┘
         │                   │                   │
         └───────────────────┼───────────────────┘
                             │
                    ┌────────┴────────┐
                    │   Redis Cluster │
                    │   Pub/Sub       │
                    └─────────────────┘
```

## Key Components

### 1. Redis Adapter (`@socket.io/redis-adapter`)

The Redis adapter allows all Socket.IO servers to broadcast events to each other via Redis Pub/Sub:

- File: `src/infrastructure/socket/socket-redis.ts`
- Creates dedicated pub/sub Redis clients
- Auto-reconnects with exponential backoff

### 2. Event Bridge

The event bridge subscribes to the event-bus (used by workers) and forwards events to Socket.IO rooms:

- File: `src/socket.ts` (setupEventBridge function)
- Subscribes to `meeting.events` channel
- Emits to appropriate Socket.IO rooms

### 3. Worker Identity

Each API server has a unique worker ID for distributed tracing:

```typescript
const WORKER_ID = `${os.hostname()}-${process.pid}`;
```

## Load Balancer Configuration

### IMPORTANT: Sticky Sessions Required

WebSocket connections require sticky sessions (session affinity) because:
1. The initial upgrade handshake must reach the same server
2. Long-polling fallback requires session consistency

### NGINX Configuration

```nginx
upstream api_servers {
    # IP Hash for consistent routing based on client IP
    ip_hash;
    
    # Alternative: Use sticky cookie
    # sticky cookie srv_id expires=1h domain=.yourdomain.com path=/;
    
    server api1:3000;
    server api2:3000;
    server api3:3000;
}

server {
    listen 80;
    server_name api.orgsledger.com;

    location / {
        proxy_pass http://api_servers;
        
        # WebSocket support
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        
        # Preserve client IP
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Host $host;
        
        # Long timeouts for WebSocket
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 86400s;  # 24 hours for WebSocket
    }
}
```

### AWS Application Load Balancer (ALB)

1. Enable sticky sessions on target group:
   - Type: `lb_cookie`
   - Duration: `86400` (1 day)

2. Enable WebSocket support:
   - ALB natively supports WebSockets
   - Ensure idle timeout is set high enough (e.g., 3600 seconds)

3. Target group health check:
   - Path: `/health`
   - Protocol: HTTP
   - Healthy threshold: 2
   - Unhealthy threshold: 3

### Cloudflare

1. Enable WebSocket support in your zone settings
2. Use `CF-Connecting-IP` header for client IP
3. Configure load balancing with session affinity:
   - Steering policy: `sticky`
   - Session affinity: `cookie`

## Redis Configuration

### Standalone Redis

```env
REDIS_URL=redis://localhost:6379/0
# or
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_password
REDIS_DB=0
```

### Redis Cluster

```env
REDIS_CLUSTER_NODES=redis1:6379,redis2:6379,redis3:6379
REDIS_PASSWORD=your_password
```

### Redis Memory Requirements

Estimate: ~100 bytes per connected client for adapter state.

- 10,000 clients: ~1 MB
- 100,000 clients: ~10 MB
- 1,000,000 clients: ~100 MB

## Scaling Guidelines

### Vertical Scaling (per server)

| Connections | CPU Cores | RAM   | Node Workers |
|-------------|-----------|-------|--------------|
| 10,000      | 2         | 2 GB  | 2            |
| 50,000      | 4         | 4 GB  | 4            |
| 100,000     | 8         | 8 GB  | 8            |

### Horizontal Scaling

| Target Connections | API Servers | Redis Mode    |
|--------------------|-------------|---------------|
| 50,000             | 3-5         | Standalone    |
| 200,000            | 10-15       | Sentinel      |
| 500,000+           | 20+         | Cluster       |

## Monitoring

### Prometheus Metrics

The following metrics are exposed:

```
# Connection metrics
orgsledger_socket_connections_total{worker_id}
orgsledger_socket_rooms_total{worker_id, room_type}

# Event metrics
orgsledger_socket_events_total{worker_id, event_type}
orgsledger_socket_broadcasts_total{worker_id, room_type}

# Redis adapter metrics
orgsledger_socket_redis_latency_ms{worker_id}
orgsledger_socket_redis_connected{worker_id}
orgsledger_socket_redis_reconnects_total{worker_id}
```

### Health Endpoint

```bash
curl http://localhost:3000/health/socket
```

Response:
```json
{
  "workerId": "api-server-1-12345",
  "connections": 5000,
  "totalServed": 25000,
  "uptime": 86400,
  "redis": {
    "connected": true,
    "pubConnected": true,
    "subConnected": true,
    "latencyMs": 1
  },
  "stats": {
    "totalConnections": 5000,
    "activeRooms": 150,
    "meetingRooms": 100,
    "userRooms": 5000,
    "channelRooms": 50
  }
}
```

## Load Testing

Run the Socket.IO load test:

```bash
# Test with 1000 connections against local server
cd apps/api
npx ts-node src/__tests__/load-test-socket.ts

# Test with multiple API instances
API_URLS=http://api1:3000,http://api2:3000,http://api3:3000 \
LOAD_TEST_CONNECTIONS=10000 \
LOAD_TEST_ROOMS=1000 \
LOAD_TEST_DURATION=120 \
npx ts-node src/__tests__/load-test-socket.ts
```

## Troubleshooting

### Events Not Propagating Across Servers

1. Check Redis connectivity:
   ```bash
   redis-cli PING
   ```

2. Verify pub/sub is working:
   ```bash
   redis-cli SUBSCRIBE "socket.io#/#"
   ```

3. Check logs for adapter errors:
   ```
   [SOCKET] Redis adapter attached successfully
   [SOCKET_REDIS] publisher ready
   [SOCKET_REDIS] subscriber ready
   ```

### High Latency

1. Check Redis latency:
   ```bash
   redis-cli --latency
   ```

2. Ensure Redis is geographically close to API servers

3. Check network between load balancer and API servers

### Connection Drops

1. Verify sticky sessions are enabled
2. Check WebSocket upgrade headers in load balancer
3. Increase load balancer idle timeouts

## Docker Deployment

```yaml
# docker-compose.scale.yml
version: '3.8'

services:
  api:
    build: ./apps/api
    deploy:
      replicas: 3
    environment:
      - REDIS_HOST=redis
      - REDIS_PORT=6379
    depends_on:
      - redis

  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes
    volumes:
      - redis_data:/data

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
    volumes:
      - ./deploy/nginx.conf:/etc/nginx/nginx.conf
    depends_on:
      - api

volumes:
  redis_data:
```

## Kubernetes Deployment

See `deploy/k8s/api.yaml` for Socket.IO scaling configuration with:
- HPA (Horizontal Pod Autoscaler)
- Redis Cluster StatefulSet
- Ingress with sticky sessions
