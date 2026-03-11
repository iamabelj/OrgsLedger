// ============================================================
// OrgsLedger — k6 Load Test: 50k Concurrent Meetings
// Simulates full meeting lifecycle with audio packets,
// 3 translation languages, and WebSocket broadcast events.
// Outputs metrics to Prometheus via remote write.
// ============================================================
//
// Usage:
//   k6 run scripts/k6-meeting-load-test.js \
//     -e BASE_URL=https://api.orgsledger.com \
//     -e WS_URL=wss://api.orgsledger.com \
//     -e EMAIL=loadtest@orgsledger.com \
//     -e PASSWORD=LoadTest123! \
//     -e ORG_ID=<organization-id> \
//     -o experimental-prometheus-rw
//
// Prometheus remote write env vars:
//   K6_PROMETHEUS_RW_SERVER_URL=http://prometheus:9090/api/v1/write
//   K6_PROMETHEUS_RW_TREND_AS_NATIVE_HISTOGRAM=true
//
// ============================================================

import http from 'k6/http';
import ws from 'k6/ws';
import { check, sleep, group } from 'k6';
import { Counter, Trend, Rate, Gauge } from 'k6/metrics';

// ── Configuration ──────────────────────────────────────────

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const WS_URL   = __ENV.WS_URL   || 'ws://localhost:3000';
const EMAIL    = __ENV.EMAIL    || 'loadtest@orgsledger.com';
const PASSWORD = __ENV.PASSWORD || 'LoadTest123!';
const ORG_ID   = __ENV.ORG_ID  || '';

const AUDIO_INTERVAL_MS     = 500;   // 1 audio packet every 500ms
const MEETING_DURATION_S    = 120;   // each VU runs a 2-min meeting
const TRANSLATION_LANGUAGES = ['es', 'fr', 'de'];

// ── Custom Metrics ─────────────────────────────────────────

// Latency
const meetingCreateLatency  = new Trend('meeting_create_latency_ms', true);
const meetingJoinLatency    = new Trend('meeting_join_latency_ms', true);
const meetingTokenLatency   = new Trend('meeting_token_latency_ms', true);
const meetingStartLatency   = new Trend('meeting_start_latency_ms', true);
const meetingEndLatency     = new Trend('meeting_end_latency_ms', true);
const wsConnectLatency      = new Trend('ws_connect_latency_ms', true);
const healthCheckLatency    = new Trend('health_check_latency_ms', true);
const transcriptEventLatency = new Trend('transcript_event_latency_ms', true);

// Error rates
const meetingErrors   = new Rate('meeting_error_rate');
const wsErrors        = new Rate('ws_error_rate');
const apiErrors       = new Rate('api_error_rate');

// Counters
const meetingsCreated    = new Counter('meetings_created_total');
const meetingsCompleted  = new Counter('meetings_completed_total');
const audioPacketsSent   = new Counter('audio_packets_sent_total');
const wsMessagesReceived = new Counter('ws_messages_received_total');
const transcriptsReceived = new Counter('transcripts_received_total');
const captionsReceived   = new Counter('captions_received_total');

// Gauges — scraped from /api/system/health during test
const queueBacklog  = new Gauge('queue_backlog_total');
const cpuUsage      = new Gauge('system_cpu_usage');
const memoryUsage   = new Gauge('system_memory_usage_bytes');

// ── Options ────────────────────────────────────────────────

export const options = {
  scenarios: {
    // Main load scenario: 50k concurrent meetings
    meetings: {
      executor: 'ramping-vus',
      exec: 'default',
      startVUs: 0,
      stages: [
        { duration: '2m',  target: 1000  },  // warm-up
        { duration: '3m',  target: 5000  },  // ramp phase 1
        { duration: '5m',  target: 15000 },  // ramp phase 2
        { duration: '5m',  target: 30000 },  // ramp phase 3
        { duration: '5m',  target: 50000 },  // full load
        { duration: '10m', target: 50000 },  // sustained peak
        { duration: '5m',  target: 25000 },  // ramp down phase 1
        { duration: '3m',  target: 5000  },  // ramp down phase 2
        { duration: '2m',  target: 0     },  // cool down
      ],
      gracefulRampDown: '30s',
    },

    // Health monitor: runs alongside to track system metrics
    health_monitor: {
      executor: 'constant-vus',
      exec: 'healthMonitor',
      vus: 2,
      duration: '40m',
    },
  },

  thresholds: {
    // P95 latencies
    'meeting_create_latency_ms':   ['p(95)<3000'],
    'meeting_join_latency_ms':     ['p(95)<2000'],
    'meeting_token_latency_ms':    ['p(95)<1000'],
    'meeting_start_latency_ms':    ['p(95)<3000'],
    'meeting_end_latency_ms':      ['p(95)<5000'],
    'ws_connect_latency_ms':       ['p(95)<5000'],
    'health_check_latency_ms':     ['p(95)<1000'],
    // Error rates under 1%
    'meeting_error_rate':          ['rate<0.01'],
    'ws_error_rate':               ['rate<0.01'],
    'api_error_rate':              ['rate<0.01'],
    // Queue backlog should not exceed 100k
    'queue_backlog_total':         ['value<100000'],
  },

  // Graceful stop — allow in-flight meetings to wrap up
  gracefulStop: '30s',

  // DNS cache
  dns: { ttl: '5m', select: 'roundRobin' },
};

// ── Setup: Authenticate once, share token ──────────────────

export function setup() {
  const loginRes = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ email: EMAIL, password: PASSWORD }),
    { headers: { 'Content-Type': 'application/json' }, timeout: '30s' }
  );

  const loginOk = check(loginRes, {
    'login status 200': (r) => r.status === 200,
    'login has accessToken': (r) => {
      try {
        return !!r.json('data.accessToken');
      } catch (_) {
        return false;
      }
    },
  });

  if (!loginOk) {
    console.error(`Login failed: ${loginRes.status} ${loginRes.body}`);
    throw new Error('Setup failed: could not authenticate');
  }

  const body = loginRes.json();
  return {
    accessToken: body.data.accessToken,
    userId: body.data.user.id,
    organizationId: ORG_ID || (body.data.memberships && body.data.memberships.length > 0
      ? body.data.memberships[0].organizationId
      : ''),
  };
}

// ── Helper: auth headers ───────────────────────────────────

function authHeaders(token) {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  };
}

// ── Helper: make API request with error tracking ───────────

function apiRequest(method, url, body, token, latencyMetric) {
  const params = {
    headers: authHeaders(token),
    timeout: '30s',
  };

  let res;
  if (method === 'GET') {
    res = http.get(url, params);
  } else {
    res = http.post(url, body ? JSON.stringify(body) : null, params);
  }

  if (latencyMetric) {
    latencyMetric.add(res.timings.duration);
  }

  const ok = res.status >= 200 && res.status < 300;
  apiErrors.add(!ok);

  return { res, ok };
}

// ── Helper: generate fake 16-bit PCM audio chunk ───────────
// 16kHz mono, 500ms = 16,000 samples = 32,000 bytes

function generateAudioChunk() {
  // k6 doesn't have ArrayBuffer manipulation like Node.js.
  // We simulate audio payload as a base64-encoded string of ~32KB.
  // In a real test you'd use k6/encoding or precomputed data.
  // For throughput testing, a fixed-size payload is sufficient.
  const CHUNK_SIZE = 32000; // 500ms of 16-bit PCM @ 16kHz mono
  // Generate a repeating pattern that approximates the payload size
  const pattern = 'AAAA'; // Base64 for 3 zero bytes
  const repetitions = Math.ceil(CHUNK_SIZE / 3); // base64: 4 chars = 3 bytes
  return pattern.repeat(repetitions).substring(0, Math.ceil(CHUNK_SIZE * 4 / 3));
}

const AUDIO_CHUNK = generateAudioChunk();

// ── Main VU Scenario ───────────────────────────────────────

export default function (data) {
  const { accessToken, organizationId } = data;

  if (!organizationId) {
    console.error('No organizationId available. Set ORG_ID env var.');
    apiErrors.add(true);
    meetingErrors.add(true);
    sleep(5);
    return;
  }

  let meetingId = null;

  // ── Step 1: Create Meeting ─────────────────────────────

  group('Create Meeting', function () {
    const { res, ok } = apiRequest('POST', `${BASE_URL}/api/meetings/create`, {
      organizationId: organizationId,
      title: `Load Test Meeting VU-${__VU}-${Date.now()}`,
      settings: {
        maxParticipants: 10,
        allowRecording: false,
        waitingRoom: false,
        muteOnEntry: true,
        allowScreenShare: false,
      },
    }, accessToken, meetingCreateLatency);

    const created = check(res, {
      'meeting created (201)': (r) => r.status === 201,
    });

    meetingErrors.add(!created);

    if (created) {
      meetingsCreated.add(1);
      try {
        meetingId = res.json('data.id') || res.json('data.meeting.id');
      } catch (_) {
        meetingId = null;
      }
    }
  });

  if (!meetingId) {
    sleep(1);
    return;
  }

  // ── Step 2: Start Meeting ──────────────────────────────

  group('Start Meeting', function () {
    const { res, ok } = apiRequest(
      'POST',
      `${BASE_URL}/api/meetings/${meetingId}/start`,
      null,
      accessToken,
      meetingStartLatency
    );

    check(res, {
      'meeting started (200)': (r) => r.status === 200,
    });

    meetingErrors.add(!ok);
  });

  // ── Step 3: Join Meeting ───────────────────────────────

  group('Join Meeting', function () {
    const { res, ok } = apiRequest('POST', `${BASE_URL}/api/meetings/join`, {
      meetingId: meetingId,
      displayName: `LoadTestUser-${__VU}`,
    }, accessToken, meetingJoinLatency);

    check(res, {
      'meeting joined (200)': (r) => r.status === 200,
    });

    meetingErrors.add(!ok);
  });

  // ── Step 4: Get LiveKit Token ──────────────────────────

  group('Get Token', function () {
    const { res, ok } = apiRequest(
      'POST',
      `${BASE_URL}/api/meetings/${meetingId}/token`,
      null,
      accessToken,
      meetingTokenLatency
    );

    check(res, {
      'token generated (200)': (r) => r.status === 200,
    });

    meetingErrors.add(!ok);
  });

  // ── Step 5: WebSocket — Join Room & Simulate Audio ─────

  group('WebSocket Session', function () {
    // Socket.IO handshake: first GET to obtain sid, then upgrade
    // k6's ws.connect speaks raw WebSocket, so use Engine.IO protocol
    const wsUrl = `${WS_URL}/socket.io/?EIO=4&transport=websocket&token=${accessToken}`;
    const wsStart = Date.now();

    const response = ws.connect(wsUrl, null, function (socket) {
      wsConnectLatency.add(Date.now() - wsStart);

      let connected = false;
      let packetsSent = 0;
      const maxPackets = Math.floor(MEETING_DURATION_S * 1000 / AUDIO_INTERVAL_MS);

      // Socket.IO Engine.IO protocol: send "40" for connect
      socket.send('40');

      socket.on('open', function () {
        // Engine.IO opens, wait for Socket.IO handshake
      });

      socket.on('message', function (msg) {
        wsMessagesReceived.add(1);

        // Engine.IO: "0" = open (sid), "40" = Socket.IO connect ack
        if (msg.startsWith('0{')) {
          // Engine.IO open packet with sid — send Socket.IO connect
          // Already sent "40" above
          return;
        }

        if (msg === '40' || msg.startsWith('40{')) {
          // Socket.IO connected
          connected = true;

          // Join meeting room
          // Socket.IO protocol: "42" prefix for event messages
          // Event: ["meeting:join-room", meetingId]
          socket.send(`42${JSON.stringify(['meeting:join-room', meetingId])}`);
          return;
        }

        // Handle Engine.IO ping ("2") → respond with pong ("3")
        if (msg === '2') {
          socket.send('3');
          return;
        }

        // Socket.IO event messages start with "42"
        if (msg.startsWith('42')) {
          try {
            const payload = JSON.parse(msg.substring(2));
            const eventName = payload[0];
            const eventData = payload[1];

            if (eventName === 'meeting:transcript') {
              transcriptsReceived.add(1);
              if (eventData && eventData.timestamp) {
                transcriptEventLatency.add(Date.now() - eventData.timestamp);
              }
            } else if (eventName === 'meeting:caption') {
              captionsReceived.add(1);
            } else if (eventName === 'meeting:event') {
              // Meeting lifecycle event broadcast
            }
          } catch (_) {
            // Malformed message, ignore
          }
        }
      });

      socket.on('error', function (e) {
        wsErrors.add(true);
      });

      // Simulate audio packets at 500ms intervals
      // In the real system, audio goes through LiveKit → AudioBot → Deepgram.
      // Here we simulate the HTTP-based audio submission path and
      // the client-side WebSocket event flow.
      socket.setInterval(function () {
        if (!connected || packetsSent >= maxPackets) {
          return;
        }

        // Simulate audio data event
        // The actual audio goes through LiveKit, but we simulate
        // the equivalent load by sending audio-sized payloads
        const audioEvent = JSON.stringify([
          'meeting:audio',
          {
            meetingId: meetingId,
            chunk: AUDIO_CHUNK,
            sequence: packetsSent,
            timestamp: Date.now(),
            encoding: 'pcm16',
            sampleRate: 16000,
            channels: 1,
          },
        ]);
        socket.send(`42${audioEvent}`);
        audioPacketsSent.add(1);
        packetsSent++;

        // Every 10th packet, simulate translation request for 3 languages
        if (packetsSent % 10 === 0) {
          for (const lang of TRANSLATION_LANGUAGES) {
            const translationEvent = JSON.stringify([
              'meeting:request-translation',
              {
                meetingId: meetingId,
                targetLanguage: lang,
                text: `Sample transcript text packet ${packetsSent}`,
              },
            ]);
            socket.send(`42${translationEvent}`);
          }
        }
      }, AUDIO_INTERVAL_MS);

      // Keep the WebSocket open for the meeting duration
      socket.setTimeout(function () {
        // Leave meeting room before closing
        socket.send(`42${JSON.stringify(['meeting:leave-room', meetingId])}`);
        // Socket.IO disconnect: "41"
        socket.send('41');
        socket.close();
      }, MEETING_DURATION_S * 1000);
    });

    const wsOk = check(response, {
      'ws connected (101)': (r) => r && r.status === 101,
    });

    wsErrors.add(!wsOk);
  });

  // ── Step 6: End Meeting ────────────────────────────────

  group('End Meeting', function () {
    const { res, ok } = apiRequest(
      'POST',
      `${BASE_URL}/api/meetings/${meetingId}/end`,
      null,
      accessToken,
      meetingEndLatency
    );

    check(res, {
      'meeting ended (200)': (r) => r.status === 200,
    });

    meetingErrors.add(!ok);

    if (ok) {
      meetingsCompleted.add(1);
    }
  });

  // ── Step 7: Leave Meeting ──────────────────────────────

  group('Leave Meeting', function () {
    apiRequest('POST', `${BASE_URL}/api/meetings/leave`, {
      meetingId: meetingId,
    }, accessToken, null);
  });

  // Brief pause before next iteration
  sleep(1);
}

// ── Teardown: Final Health Check & Report ──────────────────

export function teardown(data) {
  const { accessToken } = data;

  // Scrape system health for final report
  const healthRes = http.get(`${BASE_URL}/api/system/health`, {
    headers: authHeaders(accessToken),
    timeout: '30s',
  });

  healthCheckLatency.add(healthRes.timings.duration);

  if (healthRes.status === 200) {
    try {
      const health = healthRes.json();
      console.log('=== Final System Health ===');
      console.log(JSON.stringify(health, null, 2));
    } catch (_) {
      console.log('Health response:', healthRes.body);
    }
  }

  // Scrape queue metrics
  const queueRes = http.get(`${BASE_URL}/api/system/queue-metrics`, {
    headers: authHeaders(accessToken),
    timeout: '30s',
  });

  if (queueRes.status === 200) {
    try {
      const queues = queueRes.json();
      console.log('=== Final Queue Metrics ===');
      console.log(JSON.stringify(queues, null, 2));
    } catch (_) {
      console.log('Queue metrics:', queueRes.body);
    }
  }

  // Scrape Prometheus metrics
  const metricsRes = http.get(`${BASE_URL}/api/system/metrics`, {
    headers: authHeaders(accessToken),
    timeout: '30s',
  });

  if (metricsRes.status === 200) {
    const lines = metricsRes.body.split('\n');
    const relevant = lines.filter(
      (l) =>
        l.includes('queue_waiting') ||
        l.includes('queue_active') ||
        l.includes('pipeline_') ||
        l.includes('ai_estimated_cost') ||
        l.includes('system_overall')
    );
    if (relevant.length > 0) {
      console.log('=== Prometheus Metric Highlights ===');
      relevant.forEach((l) => console.log(l));
    }
  }
}

// ── Health Monitor Scenario ────────────────────────────────
// Runs alongside the main scenario to continuously track
// queue backlog, CPU, and memory at 10-second intervals.

export function healthMonitor(data) {
  const { accessToken } = data;

  const { res } = apiRequest(
    'GET',
    `${BASE_URL}/api/system/health`,
    null,
    accessToken,
    healthCheckLatency
  );

  if (res.status === 200) {
    try {
      const health = res.json();

      // Extract queue backlog from health data
      if (health.data && health.data.queues) {
        let totalWaiting = 0;
        const queueData = health.data.queues;
        if (queueData.queues) {
          for (const q of queueData.queues) {
            totalWaiting += (q.waiting || 0);
          }
        }
        queueBacklog.add(totalWaiting);
      }

      // Extract system metrics
      if (health.data && health.data.system) {
        const sys = health.data.system;
        if (sys.cpuUsage !== undefined) {
          cpuUsage.add(sys.cpuUsage);
        }
        if (sys.memoryUsage !== undefined) {
          memoryUsage.add(sys.memoryUsage);
        }
      }
    } catch (_) {
      // Health parse failed
    }
  }

  // Also scrape backpressure status
  apiRequest('GET', `${BASE_URL}/api/system/backpressure`, null, accessToken, null);

  sleep(10);
}


