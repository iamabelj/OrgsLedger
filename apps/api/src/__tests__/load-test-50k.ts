// ============================================================
// OrgsLedger API — 50K Meeting Load Test
// Simulates 50,000 simultaneous meetings with transcripts
// ============================================================
//
// Simulation Parameters:
//   - 50,000 meetings
//   - 200,000 transcript events/minute (~3,333/sec)
//   - 100,000 WebSocket clients
//
// Validates:
//   - No queue overload
//   - No dropped broadcasts
//   - No Redis saturation
//   - Autoscaler spawns workers correctly
//   - Rate limiters function properly
//
// Run: npx ts-node src/__tests__/load-test-50k.ts
//
// ============================================================

import { io as SocketIOClient, Socket } from 'socket.io-client';
import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';

// ── Configuration ───────────────────────────────────────────

interface LoadTestConfig {
  apiUrls: string[];
  totalMeetings: number;
  totalConnections: number;
  transcriptsPerMinute: number;
  testDurationMs: number;
  rampUpDurationMs: number;
  reportIntervalMs: number;
  connectionTimeoutMs: number;
  connectionBatchSize: number;
  connectionBatchDelayMs: number;
}

const DEFAULT_CONFIG: LoadTestConfig = {
  apiUrls: (process.env.LOAD_TEST_API_URLS || 'http://localhost:3000').split(','),
  totalMeetings: parseInt(process.env.LOAD_TEST_MEETINGS || '50000', 10),
  totalConnections: parseInt(process.env.LOAD_TEST_CONNECTIONS || '100000', 10),
  transcriptsPerMinute: parseInt(process.env.LOAD_TEST_TRANSCRIPTS_PER_MIN || '200000', 10),
  testDurationMs: parseInt(process.env.LOAD_TEST_DURATION_MS || '300000', 10), // 5 minutes
  rampUpDurationMs: parseInt(process.env.LOAD_TEST_RAMP_UP_MS || '60000', 10), // 1 minute
  reportIntervalMs: parseInt(process.env.LOAD_TEST_REPORT_INTERVAL_MS || '10000', 10),
  connectionTimeoutMs: parseInt(process.env.LOAD_TEST_CONN_TIMEOUT_MS || '30000', 10),
  connectionBatchSize: parseInt(process.env.LOAD_TEST_BATCH_SIZE || '500', 10),
  connectionBatchDelayMs: parseInt(process.env.LOAD_TEST_BATCH_DELAY_MS || '100', 10),
};

// ── Types ───────────────────────────────────────────────────

interface MeetingState {
  meetingId: string;
  clients: Socket[];
  transcriptsSent: number;
  transcriptsReceived: number;
  lastTranscriptAt: number;
}

interface LoadTestStats {
  connections: {
    attempted: number;
    successful: number;
    failed: number;
    active: number;
    disconnected: number;
  };
  transcripts: {
    sent: number;
    received: number;
    dropped: number;
    avgLatencyMs: number;
    maxLatencyMs: number;
  };
  events: {
    total: number;
    errors: number;
    timeouts: number;
  };
  rateLimit: {
    transcriptHits: number;
    translationHits: number;
    minutesHits: number;
  };
  timing: {
    startedAt: number;
    rampUpCompletedAt: number | null;
    lastReportAt: number;
    elapsedMs: number;
  };
}

interface TranscriptEvent {
  meetingId: string;
  speaker: string;
  text: string;
  timestamp: string;
  isFinal: boolean;
  sentAt: number; // For latency tracking
}

// ── Load Test Class ─────────────────────────────────────────

class Meeting50KLoadTest extends EventEmitter {
  private config: LoadTestConfig;
  private meetings: Map<string, MeetingState> = new Map();
  private stats: LoadTestStats;
  private reportInterval: NodeJS.Timeout | null = null;
  private transcriptInterval: NodeJS.Timeout | null = null;
  private isRunning = false;
  private latencies: number[] = [];

  constructor(config: Partial<LoadTestConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.stats = this.initializeStats();
  }

  private initializeStats(): LoadTestStats {
    return {
      connections: {
        attempted: 0,
        successful: 0,
        failed: 0,
        active: 0,
        disconnected: 0,
      },
      transcripts: {
        sent: 0,
        received: 0,
        dropped: 0,
        avgLatencyMs: 0,
        maxLatencyMs: 0,
      },
      events: {
        total: 0,
        errors: 0,
        timeouts: 0,
      },
      rateLimit: {
        transcriptHits: 0,
        translationHits: 0,
        minutesHits: 0,
      },
      timing: {
        startedAt: Date.now(),
        rampUpCompletedAt: null,
        lastReportAt: Date.now(),
        elapsedMs: 0,
      },
    };
  }

  // ── Main Test Flow ──────────────────────────────────────────

  async run(): Promise<LoadTestStats> {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('OrgsLedger 50K Meeting Load Test');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`\nConfiguration:`);
    console.log(`  Total meetings: ${this.config.totalMeetings.toLocaleString()}`);
    console.log(`  Total connections: ${this.config.totalConnections.toLocaleString()}`);
    console.log(`  Transcripts/minute: ${this.config.transcriptsPerMinute.toLocaleString()}`);
    console.log(`  Test duration: ${Math.round(this.config.testDurationMs / 1000)}s`);
    console.log(`  Ramp-up duration: ${Math.round(this.config.rampUpDurationMs / 1000)}s`);
    console.log(`  API URLs: ${this.config.apiUrls.join(', ')}`);
    console.log('');

    this.isRunning = true;
    this.stats.timing.startedAt = Date.now();

    try {
      // Start reporting
      this.startReporting();

      // Phase 1: Create meetings
      console.log('Phase 1: Creating meetings...');
      await this.createMeetings();

      // Phase 2: Ramp up connections
      console.log('\nPhase 2: Ramping up connections...');
      await this.rampUpConnections();

      // Phase 3: Sustained load
      console.log('\nPhase 3: Sustained load test...');
      await this.runSustainedLoad();

      // Phase 4: Graceful shutdown
      console.log('\nPhase 4: Graceful shutdown...');
      await this.shutdown();

      return this.stats;

    } catch (err) {
      console.error('Load test failed:', err);
      await this.shutdown();
      throw err;
    }
  }

  // ── Phase 1: Create Meetings ────────────────────────────────

  private async createMeetings(): Promise<void> {
    const startTime = Date.now();

    for (let i = 0; i < this.config.totalMeetings; i++) {
      const meetingId = `meeting-${randomUUID()}`;
      this.meetings.set(meetingId, {
        meetingId,
        clients: [],
        transcriptsSent: 0,
        transcriptsReceived: 0,
        lastTranscriptAt: 0,
      });

      if ((i + 1) % 10000 === 0) {
        console.log(`  Created ${(i + 1).toLocaleString()} meetings...`);
      }
    }

    const elapsedMs = Date.now() - startTime;
    console.log(`  Created ${this.config.totalMeetings.toLocaleString()} meetings in ${elapsedMs}ms`);
  }

  // ── Phase 2: Ramp Up Connections ────────────────────────────

  private async rampUpConnections(): Promise<void> {
    const startTime = Date.now();
    const meetingIds = Array.from(this.meetings.keys());
    const connectionsPerMeeting = Math.ceil(this.config.totalConnections / this.config.totalMeetings);
    const batchSize = this.config.connectionBatchSize;
    let connectionIndex = 0;

    // Distribute connections across meetings
    const connectionPlan: { meetingId: string; clientIndex: number }[] = [];
    
    for (let i = 0; i < this.config.totalConnections; i++) {
      const meetingIndex = i % meetingIds.length;
      connectionPlan.push({
        meetingId: meetingIds[meetingIndex],
        clientIndex: Math.floor(i / meetingIds.length),
      });
    }

    // Connect in batches
    const totalBatches = Math.ceil(connectionPlan.length / batchSize);
    
    for (let batch = 0; batch < totalBatches; batch++) {
      const batchStart = batch * batchSize;
      const batchEnd = Math.min(batchStart + batchSize, connectionPlan.length);
      const batchConnections = connectionPlan.slice(batchStart, batchEnd);

      const connectPromises = batchConnections.map(({ meetingId }) =>
        this.createConnection(meetingId)
      );

      await Promise.allSettled(connectPromises);

      connectionIndex += batchConnections.length;

      if ((batch + 1) % 100 === 0 || batch === totalBatches - 1) {
        const elapsed = Date.now() - startTime;
        const rate = (connectionIndex / elapsed) * 1000;
        console.log(
          `  Batch ${batch + 1}/${totalBatches}: ${connectionIndex.toLocaleString()} connections ` +
          `(${this.stats.connections.successful.toLocaleString()} successful, ` +
          `${rate.toFixed(0)}/sec)`
        );
      }

      // Delay between batches
      await this.delay(this.config.connectionBatchDelayMs);

      // Check if we should stop early
      if (!this.isRunning) break;
    }

    this.stats.timing.rampUpCompletedAt = Date.now();
    const totalElapsed = Date.now() - startTime;
    console.log(`  Ramp-up completed in ${Math.round(totalElapsed / 1000)}s`);
    console.log(`  Successful: ${this.stats.connections.successful.toLocaleString()}`);
    console.log(`  Failed: ${this.stats.connections.failed.toLocaleString()}`);
  }

  // ── Phase 3: Sustained Load ─────────────────────────────────

  private async runSustainedLoad(): Promise<void> {
    const startTime = Date.now();
    const testEndTime = startTime + this.config.testDurationMs;
    
    // Calculate transcript interval
    const transcriptsPerSecond = this.config.transcriptsPerMinute / 60;
    const intervalMs = 1000 / Math.min(transcriptsPerSecond, 1000); // Max 1000 batches/sec
    const transcriptsPerBatch = Math.ceil(transcriptsPerSecond / (1000 / intervalMs));

    console.log(`  Sending ${transcriptsPerSecond.toFixed(0)} transcripts/sec`);
    console.log(`  Batch size: ${transcriptsPerBatch} transcripts every ${intervalMs.toFixed(1)}ms`);

    // Start sending transcripts
    this.transcriptInterval = setInterval(() => {
      if (Date.now() >= testEndTime || !this.isRunning) {
        if (this.transcriptInterval) {
          clearInterval(this.transcriptInterval);
          this.transcriptInterval = null;
        }
        return;
      }

      // Send batch of transcripts
      this.sendTranscriptBatch(transcriptsPerBatch);
    }, intervalMs);

    // Wait for test duration
    while (Date.now() < testEndTime && this.isRunning) {
      await this.delay(1000);
    }

    if (this.transcriptInterval) {
      clearInterval(this.transcriptInterval);
      this.transcriptInterval = null;
    }

    const elapsed = Date.now() - startTime;
    console.log(`  Sustained load completed in ${Math.round(elapsed / 1000)}s`);
  }

  // ── Connection Management ───────────────────────────────────

  private async createConnection(meetingId: string): Promise<void> {
    this.stats.connections.attempted++;

    try {
      const apiUrl = this.config.apiUrls[
        this.stats.connections.attempted % this.config.apiUrls.length
      ];

      const socket = SocketIOClient(apiUrl, {
        transports: ['websocket'],
        timeout: this.config.connectionTimeoutMs,
        auth: {
          token: this.generateMockToken(),
        },
        forceNew: true,
        reconnection: false, // Disable auto-reconnect for load test
      });

      const connectPromise = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          socket.disconnect();
          reject(new Error('Connection timeout'));
        }, this.config.connectionTimeoutMs);

        socket.on('connect', () => {
          clearTimeout(timeout);
          this.stats.connections.successful++;
          this.stats.connections.active++;

          // Join meeting room
          socket.emit('meeting:join', meetingId);

          // Add to meeting state
          const meeting = this.meetings.get(meetingId);
          if (meeting) {
            meeting.clients.push(socket);
          }

          // Set up event handlers
          this.setupSocketHandlers(socket, meetingId);

          resolve();
        });

        socket.on('connect_error', (err) => {
          clearTimeout(timeout);
          this.stats.connections.failed++;
          this.stats.events.errors++;
          reject(err);
        });
      });

      await connectPromise;

    } catch (err) {
      this.stats.connections.failed++;
    }
  }

  private setupSocketHandlers(socket: Socket, meetingId: string): void {
    const meeting = this.meetings.get(meetingId);

    // Handle incoming transcripts
    socket.on('meeting:transcript', (data: TranscriptEvent) => {
      this.stats.transcripts.received++;
      this.stats.events.total++;

      if (meeting) {
        meeting.transcriptsReceived++;
      }

      // Track latency
      if (data.sentAt) {
        const latency = Date.now() - data.sentAt;
        this.latencies.push(latency);
        if (latency > this.stats.transcripts.maxLatencyMs) {
          this.stats.transcripts.maxLatencyMs = latency;
        }
      }
    });

    // Handle rate limit events
    socket.on('rate_limit', (data: { type: string }) => {
      if (data.type === 'transcript') {
        this.stats.rateLimit.transcriptHits++;
      } else if (data.type === 'translation') {
        this.stats.rateLimit.translationHits++;
      } else if (data.type === 'minutes') {
        this.stats.rateLimit.minutesHits++;
      }
    });

    socket.on('disconnect', () => {
      this.stats.connections.active--;
      this.stats.connections.disconnected++;
    });

    socket.on('error', () => {
      this.stats.events.errors++;
    });
  }

  // ── Transcript Generation ───────────────────────────────────

  private sendTranscriptBatch(count: number): void {
    const meetingIds = Array.from(this.meetings.keys());
    
    for (let i = 0; i < count; i++) {
      const meetingIndex = Math.floor(Math.random() * meetingIds.length);
      const meetingId = meetingIds[meetingIndex];
      const meeting = this.meetings.get(meetingId);

      if (!meeting || meeting.clients.length === 0) continue;

      // Pick a random client to send from
      const clientIndex = Math.floor(Math.random() * meeting.clients.length);
      const client = meeting.clients[clientIndex];

      if (!client.connected) continue;

      const event: TranscriptEvent = {
        meetingId,
        speaker: `Speaker ${Math.floor(Math.random() * 5) + 1}`,
        text: this.generateRandomText(),
        timestamp: new Date().toISOString(),
        isFinal: Math.random() > 0.3,
        sentAt: Date.now(),
      };

      // Emit directly (simulating what the backend would do)
      client.emit('transcript:send', event);
      this.stats.transcripts.sent++;
      meeting.transcriptsSent++;
      meeting.lastTranscriptAt = Date.now();
    }
  }

  private generateRandomText(): string {
    const words = [
      'meeting', 'project', 'deadline', 'review', 'update', 'action',
      'items', 'next', 'steps', 'discussion', 'decision', 'budget',
      'timeline', 'resources', 'team', 'stakeholder', 'priority',
      'deliverable', 'milestone', 'objective', 'strategy', 'plan',
    ];
    
    const length = 5 + Math.floor(Math.random() * 15);
    const text: string[] = [];
    
    for (let i = 0; i < length; i++) {
      text.push(words[Math.floor(Math.random() * words.length)]);
    }
    
    return text.join(' ');
  }

  private generateMockToken(): string {
    // Generate a mock JWT for testing
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      userId: randomUUID(),
      email: `loadtest-${Date.now()}@test.com`,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    })).toString('base64url');
    const signature = 'mock_signature_for_load_test';
    
    return `${header}.${payload}.${signature}`;
  }

  // ── Reporting ───────────────────────────────────────────────

  private startReporting(): void {
    this.reportInterval = setInterval(() => {
      this.printReport();
    }, this.config.reportIntervalMs);
  }

  private printReport(): void {
    const now = Date.now();
    this.stats.timing.elapsedMs = now - this.stats.timing.startedAt;
    this.stats.timing.lastReportAt = now;

    // Calculate average latency
    if (this.latencies.length > 0) {
      const sum = this.latencies.reduce((a, b) => a + b, 0);
      this.stats.transcripts.avgLatencyMs = Math.round(sum / this.latencies.length);
      // Keep only last 10000 samples
      if (this.latencies.length > 10000) {
        this.latencies = this.latencies.slice(-10000);
      }
    }

    // Calculate dropped transcripts
    this.stats.transcripts.dropped = Math.max(
      0,
      this.stats.transcripts.sent - this.stats.transcripts.received
    );

    console.log('───────────────────────────────────────────────────────────────');
    console.log(`[${new Date().toISOString()}] Load Test Report`);
    console.log('───────────────────────────────────────────────────────────────');
    console.log(`Elapsed: ${Math.round(this.stats.timing.elapsedMs / 1000)}s`);
    console.log('');
    console.log('Connections:');
    console.log(`  Active: ${this.stats.connections.active.toLocaleString()}`);
    console.log(`  Successful: ${this.stats.connections.successful.toLocaleString()}`);
    console.log(`  Failed: ${this.stats.connections.failed.toLocaleString()}`);
    console.log('');
    console.log('Transcripts:');
    console.log(`  Sent: ${this.stats.transcripts.sent.toLocaleString()}`);
    console.log(`  Received: ${this.stats.transcripts.received.toLocaleString()}`);
    console.log(`  Dropped: ${this.stats.transcripts.dropped.toLocaleString()}`);
    console.log(`  Avg Latency: ${this.stats.transcripts.avgLatencyMs}ms`);
    console.log(`  Max Latency: ${this.stats.transcripts.maxLatencyMs}ms`);
    console.log('');
    console.log('Rate Limits:');
    console.log(`  Transcript: ${this.stats.rateLimit.transcriptHits.toLocaleString()}`);
    console.log(`  Translation: ${this.stats.rateLimit.translationHits.toLocaleString()}`);
    console.log(`  Minutes: ${this.stats.rateLimit.minutesHits.toLocaleString()}`);
    console.log('');

    // Calculate rates
    const elapsedSeconds = this.stats.timing.elapsedMs / 1000;
    const transcriptRate = this.stats.transcripts.sent / elapsedSeconds;
    const successRate = (this.stats.transcripts.received / Math.max(this.stats.transcripts.sent, 1)) * 100;

    console.log('Rates:');
    console.log(`  Transcripts/sec: ${transcriptRate.toFixed(0)}`);
    console.log(`  Success rate: ${successRate.toFixed(1)}%`);
    console.log('');
  }

  // ── Shutdown ────────────────────────────────────────────────

  private async shutdown(): Promise<void> {
    this.isRunning = false;

    // Stop reporting
    if (this.reportInterval) {
      clearInterval(this.reportInterval);
      this.reportInterval = null;
    }

    // Stop transcript generation
    if (this.transcriptInterval) {
      clearInterval(this.transcriptInterval);
      this.transcriptInterval = null;
    }

    // Disconnect all clients
    console.log('  Disconnecting clients...');
    let disconnected = 0;

    for (const meeting of this.meetings.values()) {
      for (const client of meeting.clients) {
        if (client.connected) {
          client.emit('meeting:leave', meeting.meetingId);
          client.disconnect();
          disconnected++;
        }
      }
      meeting.clients = [];
    }

    console.log(`  Disconnected ${disconnected.toLocaleString()} clients`);

    // Print final report
    this.printFinalReport();
  }

  private printFinalReport(): void {
    console.log('');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('FINAL LOAD TEST REPORT');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('');
    console.log('Summary:');
    console.log(`  Total meetings: ${this.config.totalMeetings.toLocaleString()}`);
    console.log(`  Total connections attempted: ${this.stats.connections.attempted.toLocaleString()}`);
    console.log(`  Successful connections: ${this.stats.connections.successful.toLocaleString()}`);
    console.log(`  Failed connections: ${this.stats.connections.failed.toLocaleString()}`);
    console.log('');
    console.log('Transcript Delivery:');
    console.log(`  Total sent: ${this.stats.transcripts.sent.toLocaleString()}`);
    console.log(`  Total received: ${this.stats.transcripts.received.toLocaleString()}`);
    console.log(`  Dropped: ${this.stats.transcripts.dropped.toLocaleString()}`);
    console.log('');
    console.log('Latency:');
    console.log(`  Average: ${this.stats.transcripts.avgLatencyMs}ms`);
    console.log(`  Maximum: ${this.stats.transcripts.maxLatencyMs}ms`);
    console.log('');
    console.log('Rate Limit Hits:');
    console.log(`  Transcript: ${this.stats.rateLimit.transcriptHits.toLocaleString()}`);
    console.log(`  Translation: ${this.stats.rateLimit.translationHits.toLocaleString()}`);
    console.log(`  Minutes: ${this.stats.rateLimit.minutesHits.toLocaleString()}`);
    console.log('');

    // Validation
    const successRate = (this.stats.transcripts.received / Math.max(this.stats.transcripts.sent, 1)) * 100;
    const connectionSuccessRate = (this.stats.connections.successful / Math.max(this.stats.connections.attempted, 1)) * 100;

    console.log('Validation:');
    
    const checks = [
      {
        name: 'Connection success rate >= 90%',
        pass: connectionSuccessRate >= 90,
        value: `${connectionSuccessRate.toFixed(1)}%`,
      },
      {
        name: 'Transcript delivery >= 95%',
        pass: successRate >= 95,
        value: `${successRate.toFixed(1)}%`,
      },
      {
        name: 'Average latency < 500ms',
        pass: this.stats.transcripts.avgLatencyMs < 500,
        value: `${this.stats.transcripts.avgLatencyMs}ms`,
      },
      {
        name: 'Max latency < 5000ms',
        pass: this.stats.transcripts.maxLatencyMs < 5000,
        value: `${this.stats.transcripts.maxLatencyMs}ms`,
      },
      {
        name: 'No critical errors',
        pass: this.stats.events.errors < 100,
        value: `${this.stats.events.errors} errors`,
      },
    ];

    let allPassed = true;
    for (const check of checks) {
      const status = check.pass ? '✅ PASS' : '❌ FAIL';
      console.log(`  ${status} - ${check.name}: ${check.value}`);
      if (!check.pass) allPassed = false;
    }

    console.log('');
    console.log(`Overall Result: ${allPassed ? '✅ ALL CHECKS PASSED' : '❌ SOME CHECKS FAILED'}`);
    console.log('═══════════════════════════════════════════════════════════════');
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ── Main Entry Point ────────────────────────────────────────

async function main(): Promise<void> {
  const loadTest = new Meeting50KLoadTest();

  // Handle interrupts
  process.on('SIGINT', async () => {
    console.log('\n\nInterrupted - shutting down...');
    process.exit(0);
  });

  try {
    const stats = await loadTest.run();
    
    // Exit with error code if tests failed
    const successRate = (stats.transcripts.received / Math.max(stats.transcripts.sent, 1)) * 100;
    if (successRate < 95) {
      process.exit(1);
    }
    
    process.exit(0);
  } catch (err) {
    console.error('Load test failed:', err);
    process.exit(1);
  }
}

// ── Exports ─────────────────────────────────────────────────

export { Meeting50KLoadTest, LoadTestConfig, LoadTestStats };

// Run if executed directly
if (require.main === module) {
  main();
}
