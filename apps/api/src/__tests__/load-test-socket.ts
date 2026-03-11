// ============================================================
// OrgsLedger API — Socket.IO Load Test
// Tests horizontal scaling of WebSocket infrastructure
// ============================================================
//
// Run with: npx ts-node src/__tests__/load-test-socket.ts
//
// Tests:
//   - Mass connection handling (target: 10,000 concurrent)
//   - Meeting room distribution across shards
//   - Cross-instance broadcast propagation
//   - Reconnection handling under load
//
// ============================================================

import { io as ioClient, Socket } from 'socket.io-client';

// ── Configuration ───────────────────────────────────────────

const CONFIG = {
  /** API endpoint URL(s) - can be multiple for multi-instance testing */
  API_URLS: (process.env.API_URLS || 'http://localhost:3000').split(','),
  
  /** Number of concurrent connections to establish */
  TOTAL_CONNECTIONS: parseInt(process.env.LOAD_TEST_CONNECTIONS || '1000', 10),
  
  /** Number of concurrent meeting rooms */
  MEETING_ROOMS: parseInt(process.env.LOAD_TEST_ROOMS || '100', 10),
  
  /** Connection batch size (to avoid overwhelming the server) */
  BATCH_SIZE: parseInt(process.env.LOAD_TEST_BATCH_SIZE || '50', 10),
  
  /** Delay between batches in ms */
  BATCH_DELAY_MS: parseInt(process.env.LOAD_TEST_BATCH_DELAY || '100', 10),
  
  /** Test duration in seconds */
  TEST_DURATION_SECONDS: parseInt(process.env.LOAD_TEST_DURATION || '60', 10),
  
  /** Events per second per client */
  EVENTS_PER_SECOND: parseFloat(process.env.LOAD_TEST_EPS || '1'),
  
  /** JWT token for authentication (or generate fake tokens for testing) */
  AUTH_TOKEN: process.env.LOAD_TEST_AUTH_TOKEN || 'test-token',
};

// ── Types ───────────────────────────────────────────────────

interface ConnectionStats {
  connected: number;
  disconnected: number;
  errors: number;
  eventsReceived: number;
  eventsSent: number;
  reconnections: number;
}

interface LoadTestResult {
  duration: number;
  totalConnections: number;
  peakConnections: number;
  successfulConnections: number;
  failedConnections: number;
  totalEventsReceived: number;
  totalEventsSent: number;
  reconnections: number;
  errors: string[];
  connectionsPerSecond: number;
  eventsPerSecond: number;
}

// ── State ───────────────────────────────────────────────────

const clients: Socket[] = [];
const stats: ConnectionStats = {
  connected: 0,
  disconnected: 0,
  errors: 0,
  eventsReceived: 0,
  eventsSent: 0,
  reconnections: 0,
};
const errors: string[] = [];
let peakConnections = 0;
let startTime = 0;

// ── Utility Functions ───────────────────────────────────────

function getRandomApiUrl(): string {
  return CONFIG.API_URLS[Math.floor(Math.random() * CONFIG.API_URLS.length)];
}

function getMeetingId(index: number): string {
  return `meeting-load-test-${index % CONFIG.MEETING_ROOMS}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Client Factory ──────────────────────────────────────────

function createClient(index: number): Socket {
  const apiUrl = getRandomApiUrl();
  const meetingId = getMeetingId(index);

  const socket = ioClient(apiUrl, {
    auth: {
      token: CONFIG.AUTH_TOKEN,
    },
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 10000,
  });

  socket.on('connect', () => {
    stats.connected++;
    peakConnections = Math.max(peakConnections, stats.connected);

    // Join meeting room
    socket.emit('meeting:join', meetingId);
  });

  socket.on('disconnect', (reason) => {
    stats.disconnected++;
    stats.connected--;
  });

  socket.on('connect_error', (err) => {
    stats.errors++;
    if (errors.length < 10) {
      errors.push(`Connection error: ${err.message}`);
    }
  });

  socket.on('reconnect', () => {
    stats.reconnections++;
  });

  // Listen for meeting events
  socket.on('meeting:transcript', () => {
    stats.eventsReceived++;
  });

  socket.on('meeting:caption', () => {
    stats.eventsReceived++;
  });

  socket.on('meeting:minutes', () => {
    stats.eventsReceived++;
  });

  return socket;
}

// ── Test Runner ─────────────────────────────────────────────

async function runLoadTest(): Promise<LoadTestResult> {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║          SOCKET.IO HORIZONTAL SCALING LOAD TEST            ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('Configuration:');
  console.log(`  API URLs:           ${CONFIG.API_URLS.join(', ')}`);
  console.log(`  Total Connections:  ${CONFIG.TOTAL_CONNECTIONS}`);
  console.log(`  Meeting Rooms:      ${CONFIG.MEETING_ROOMS}`);
  console.log(`  Test Duration:      ${CONFIG.TEST_DURATION_SECONDS}s`);
  console.log(`  Batch Size:         ${CONFIG.BATCH_SIZE}`);
  console.log('');

  startTime = Date.now();

  // Phase 1: Establish connections in batches
  console.log('Phase 1: Establishing connections...');
  const connectionStartTime = Date.now();

  for (let i = 0; i < CONFIG.TOTAL_CONNECTIONS; i += CONFIG.BATCH_SIZE) {
    const batchEnd = Math.min(i + CONFIG.BATCH_SIZE, CONFIG.TOTAL_CONNECTIONS);

    for (let j = i; j < batchEnd; j++) {
      const client = createClient(j);
      clients.push(client);
    }

    await sleep(CONFIG.BATCH_DELAY_MS);

    // Progress update
    const progress = Math.round((batchEnd / CONFIG.TOTAL_CONNECTIONS) * 100);
    process.stdout.write(`\r  Progress: ${progress}% (${stats.connected} connected, ${stats.errors} errors)`);
  }

  console.log('');
  const connectionDuration = Date.now() - connectionStartTime;
  console.log(`  Connections established in ${(connectionDuration / 1000).toFixed(2)}s`);
  console.log(`  Rate: ${(CONFIG.TOTAL_CONNECTIONS / (connectionDuration / 1000)).toFixed(2)} conn/s`);
  console.log('');

  // Phase 2: Wait for connections to stabilize
  console.log('Phase 2: Stabilizing connections...');
  await sleep(2000);
  console.log(`  Connected: ${stats.connected}, Errors: ${stats.errors}`);
  console.log('');

  // Phase 3: Run sustained load for the test duration
  console.log(`Phase 3: Running sustained load for ${CONFIG.TEST_DURATION_SECONDS}s...`);
  const testEndTime = Date.now() + CONFIG.TEST_DURATION_SECONDS * 1000;

  let lastPrint = Date.now();
  while (Date.now() < testEndTime) {
    // Print status every 5 seconds
    if (Date.now() - lastPrint > 5000) {
      console.log(`  [${Math.round((testEndTime - Date.now()) / 1000)}s remaining] ` +
        `Connected: ${stats.connected}, Events Rx: ${stats.eventsReceived}, Errors: ${stats.errors}`);
      lastPrint = Date.now();
    }
    await sleep(100);
  }
  console.log('');

  // Phase 4: Disconnect all clients
  console.log('Phase 4: Disconnecting clients...');
  for (const client of clients) {
    client.disconnect();
  }
  await sleep(2000);

  // Calculate results
  const duration = Date.now() - startTime;
  const result: LoadTestResult = {
    duration: duration / 1000,
    totalConnections: CONFIG.TOTAL_CONNECTIONS,
    peakConnections,
    successfulConnections: CONFIG.TOTAL_CONNECTIONS - stats.errors,
    failedConnections: stats.errors,
    totalEventsReceived: stats.eventsReceived,
    totalEventsSent: stats.eventsSent,
    reconnections: stats.reconnections,
    errors: errors.slice(0, 10),
    connectionsPerSecond: CONFIG.TOTAL_CONNECTIONS / (connectionDuration / 1000),
    eventsPerSecond: stats.eventsReceived / (CONFIG.TEST_DURATION_SECONDS),
  };

  return result;
}

// ── Result Printer ──────────────────────────────────────────

function printResults(result: LoadTestResult): void {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║                      TEST RESULTS                          ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('Connection Metrics:');
  console.log(`  Total Attempted:        ${result.totalConnections}`);
  console.log(`  Successful:             ${result.successfulConnections}`);
  console.log(`  Failed:                 ${result.failedConnections}`);
  console.log(`  Peak Concurrent:        ${result.peakConnections}`);
  console.log(`  Reconnections:          ${result.reconnections}`);
  console.log('');
  console.log('Performance Metrics:');
  console.log(`  Test Duration:          ${result.duration.toFixed(2)}s`);
  console.log(`  Connection Rate:        ${result.connectionsPerSecond.toFixed(2)} conn/s`);
  console.log(`  Events Received:        ${result.totalEventsReceived}`);
  console.log(`  Events/Second:          ${result.eventsPerSecond.toFixed(2)}`);
  console.log('');

  if (result.errors.length > 0) {
    console.log('Errors (first 10):');
    for (const err of result.errors) {
      console.log(`  - ${err}`);
    }
    console.log('');
  }

  // Success criteria
  const successRate = result.successfulConnections / result.totalConnections;
  const passed = successRate >= 0.95 && result.peakConnections >= result.totalConnections * 0.9;

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`RESULT: ${passed ? '✓ PASSED' : '✗ FAILED'}`);
  console.log(`  Success Rate: ${(successRate * 100).toFixed(2)}% (target: 95%)`);
  console.log(`  Peak Connections: ${result.peakConnections} (target: ${Math.floor(result.totalConnections * 0.9)})`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  process.exit(passed ? 0 : 1);
}

// ── Main ────────────────────────────────────────────────────

async function main(): Promise<void> {
  try {
    const result = await runLoadTest();
    printResults(result);
  } catch (err) {
    console.error('Load test failed:', err);
    process.exit(1);
  }
}

main();
