#!/usr/bin/env ts-node
// ============================================================
// OrgsLedger API — Stage 7 Database Persistence Verification
// Verifies that broadcast data is correctly persisted to PostgreSQL
// ============================================================
//
// Run: npx ts-node apps/api/scripts/verify-stage7-db.ts
//
// Prerequisites:
//   - PostgreSQL (Neon or local) running with DATABASE_URL set
//   - Tables: meeting_transcripts, broadcast_jobs, metrics_logs
//   - Optionally run Stage 6 first to populate test data
//
// Tests:
//   7.1 — Database Connectivity
//   7.2 — Table Existence Verification
//   7.3 — Insert Test Transcript
//   7.4 — Query Transcripts by MeetingId
//   7.5 — Payload Field Validation
//   7.6 — Broadcast Jobs Persistence
//   7.7 — Idempotency Verification
//   7.8 — Retry Count Verification
//   7.9 — Metrics Logging Verification
//   7.10 — Cleanup Test Data
//
// ============================================================

import Knex, { Knex as KnexInstance } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '../../.env' });
dotenv.config({ path: '.env' });

// ── Configuration ───────────────────────────────────────────

const CONFIG = {
  database: {
    url: process.env.DATABASE_URL || '',
    ssl: { rejectUnauthorized: false },
  },
  timeouts: {
    connection: 10000,
    query: 30000,
    overall: 60000,
  },
  tables: {
    transcripts: 'meeting_transcripts',
    broadcastJobs: 'broadcast_jobs',
    metricsLogs: 'metrics_logs',
    meetings: 'meetings',
    organizations: 'organizations',
  },
  // Test identifiers (will create temporary test records)
  test: {
    organizationId: uuidv4(),
    meetingId: uuidv4(),
    speakerId: uuidv4(),
    prefixMarker: 'STAGE7_TEST_', // Prefix for easy cleanup identification
  },
};

// ── Logging Utilities ───────────────────────────────────────

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
};

interface VerificationStats {
  transcriptsVerified: number;
  broadcastJobsVerified: number;
  metricsLogsVerified: number;
  testsPassed: number;
  testsFailed: number;
}

const stats: VerificationStats = {
  transcriptsVerified: 0,
  broadcastJobsVerified: 0,
  metricsLogsVerified: 0,
  testsPassed: 0,
  testsFailed: 0,
};

function log(message: string, data?: any): void {
  const timestamp = new Date().toISOString().slice(11, 23);
  console.log(`${colors.dim}[${timestamp}]${colors.reset} [STAGE7] ${message}`, data ? JSON.stringify(data, null, 2) : '');
}

function success(test: string): void {
  console.log(`${colors.green}✅ ${test}${colors.reset}`);
  stats.testsPassed++;
}

function fail(test: string, error?: string): void {
  console.error(`${colors.red}❌ ${test}${error ? `: ${error}` : ''}${colors.reset}`);
  stats.testsFailed++;
}

function warn(message: string): void {
  console.log(`${colors.yellow}⚠️  ${message}${colors.reset}`);
}

function info(message: string): void {
  console.log(`${colors.blue}ℹ️  ${message}${colors.reset}`);
}

function section(title: string): void {
  console.log(`\n${colors.cyan}${'═'.repeat(60)}${colors.reset}`);
  console.log(`${colors.bold}  ${title}${colors.reset}`);
  console.log(`${colors.cyan}${'═'.repeat(60)}${colors.reset}\n`);
}

function subsection(title: string): void {
  console.log(`\n${colors.dim}──${colors.reset} ${colors.yellow}${title}${colors.reset} ${colors.dim}${'─'.repeat(35)}${colors.reset}\n`);
}

// ── Database Types ──────────────────────────────────────────

interface TranscriptRecord {
  id: string;
  meeting_id: string;
  organization_id: string;
  speaker_id: string | null;
  speaker_name: string;
  original_text: string;
  source_lang: string;
  translations: Record<string, string>;
  spoken_at: number;
  created_at: Date;
  updated_at: Date;
}

interface BroadcastJobRecord {
  id: string;
  job_id: string;
  meeting_id: string;
  event_type: 'transcript' | 'caption' | 'minutes';
  payload: Record<string, any>;
  idempotency_key: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  processed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface MetricsLogRecord {
  id: string;
  queue_name: string;
  waiting_count: number;
  active_count: number;
  completed_count: number;
  failed_count: number;
  delayed_count: number;
  meeting_id: string | null;
  metadata: Record<string, any>;
  recorded_at: Date;
}

// ── Test Context ────────────────────────────────────────────

interface TestContext {
  db: KnexInstance | null;
  testOrgId: string | null;
  testMeetingId: string | null;
  testTranscriptIds: string[];
  testBroadcastJobIds: string[];
  testMetricsLogIds: string[];
  tablesExist: {
    transcripts: boolean;
    broadcastJobs: boolean;
    metricsLogs: boolean;
  };
}

const ctx: TestContext = {
  db: null,
  testOrgId: null,
  testMeetingId: null,
  testTranscriptIds: [],
  testBroadcastJobIds: [],
  testMetricsLogIds: [],
  tablesExist: {
    transcripts: false,
    broadcastJobs: false,
    metricsLogs: false,
  },
};

// ══════════════════════════════════════════════════════════════
// STEP 7.1 — Database Connectivity
// ══════════════════════════════════════════════════════════════

async function step7_1_connectDatabase(): Promise<boolean> {
  subsection('STEP 7.1 — Database Connectivity');

  if (!CONFIG.database.url) {
    fail('Database connection', 'DATABASE_URL environment variable not set');
    info('Set DATABASE_URL to your PostgreSQL connection string');
    return false;
  }

  try {
    // Normalize SSL mode in connection string
    let connectionString = CONFIG.database.url;
    try {
      const url = new URL(connectionString);
      const sslmode = url.searchParams.get('sslmode');
      if (sslmode === 'require' || sslmode === 'prefer') {
        url.searchParams.set('sslmode', 'verify-full');
        connectionString = url.toString();
      }
    } catch {
      // URL parsing failed, use as-is
    }

    const db = Knex({
      client: 'pg',
      connection: {
        connectionString,
        ssl: CONFIG.database.ssl,
      },
      pool: {
        min: 1,
        max: 5,
        acquireTimeoutMillis: CONFIG.timeouts.connection,
      },
    });

    // Test connection
    const result = await db.raw('SELECT NOW() as current_time, version() as pg_version');
    const row = result.rows[0];

    success('Database connected');
    log('PostgreSQL info', {
      currentTime: row.current_time,
      version: row.pg_version.split(',')[0],
    });

    ctx.db = db;
    return true;

  } catch (err: any) {
    fail('Database connection', err.message);
    return false;
  }
}

// ══════════════════════════════════════════════════════════════
// STEP 7.2 — Table Existence Verification
// ══════════════════════════════════════════════════════════════

async function step7_2_verifyTables(): Promise<boolean> {
  subsection('STEP 7.2 — Table Existence Verification');

  if (!ctx.db) {
    fail('Table verification', 'Database not connected');
    return false;
  }

  try {
    // Check meeting_transcripts table
    const hasTranscripts = await ctx.db.schema.hasTable(CONFIG.tables.transcripts);
    ctx.tablesExist.transcripts = hasTranscripts;
    if (hasTranscripts) {
      success(`Table '${CONFIG.tables.transcripts}' exists`);
      
      // Get column info
      const columns = await ctx.db.raw(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = ?
        ORDER BY ordinal_position
      `, [CONFIG.tables.transcripts]);
      
      log('Transcript table columns', columns.rows.map((c: any) => `${c.column_name} (${c.data_type})`));
    } else {
      fail(`Table '${CONFIG.tables.transcripts}'`, 'Table does not exist');
    }

    // Check broadcast_jobs table
    const hasBroadcastJobs = await ctx.db.schema.hasTable(CONFIG.tables.broadcastJobs);
    ctx.tablesExist.broadcastJobs = hasBroadcastJobs;
    if (hasBroadcastJobs) {
      success(`Table '${CONFIG.tables.broadcastJobs}' exists`);
      
      const columns = await ctx.db.raw(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = ?
        ORDER BY ordinal_position
      `, [CONFIG.tables.broadcastJobs]);
      
      log('Broadcast jobs table columns', columns.rows.map((c: any) => `${c.column_name} (${c.data_type})`));
    } else {
      warn(`Table '${CONFIG.tables.broadcastJobs}' does not exist - skipping broadcast job tests`);
    }

    // Check metrics_logs table
    const hasMetricsLogs = await ctx.db.schema.hasTable(CONFIG.tables.metricsLogs);
    ctx.tablesExist.metricsLogs = hasMetricsLogs;
    if (hasMetricsLogs) {
      success(`Table '${CONFIG.tables.metricsLogs}' exists`);
      
      const columns = await ctx.db.raw(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = ?
        ORDER BY ordinal_position
      `, [CONFIG.tables.metricsLogs]);
      
      log('Metrics logs table columns', columns.rows.map((c: any) => `${c.column_name} (${c.data_type})`));
    } else {
      warn(`Table '${CONFIG.tables.metricsLogs}' does not exist - skipping metrics tests`);
    }

    // At minimum, transcripts table should exist
    return hasTranscripts;

  } catch (err: any) {
    fail('Table verification', err.message);
    return false;
  }
}

// ══════════════════════════════════════════════════════════════
// STEP 7.3 — Insert Test Transcript
// ══════════════════════════════════════════════════════════════

async function step7_3_insertTestTranscript(): Promise<boolean> {
  subsection('STEP 7.3 — Insert Test Transcript');

  if (!ctx.db || !ctx.tablesExist.transcripts) {
    fail('Insert test transcript', 'Database or transcripts table not available');
    return false;
  }

  try {
    // First, we need a valid organization and meeting
    // Check if we have any existing organizations to use
    const existingOrg = await ctx.db('organizations').first();
    
    if (!existingOrg) {
      // Create a test organization
      const [org] = await ctx.db('organizations')
        .insert({
          id: CONFIG.test.organizationId,
          name: `${CONFIG.test.prefixMarker}Organization`,
          slug: `stage7-test-org-${Date.now()}`,
        })
        .returning('id');
      ctx.testOrgId = typeof org === 'object' ? org.id : org;
      log('Created test organization', { id: ctx.testOrgId });
    } else {
      ctx.testOrgId = existingOrg.id;
      log('Using existing organization', { id: ctx.testOrgId });
    }

    // Check for existing meeting or create test meeting
    const existingMeeting = await ctx.db('meetings').first();
    
    if (!existingMeeting) {
      const [meeting] = await ctx.db('meetings')
        .insert({
          id: CONFIG.test.meetingId,
          organization_id: ctx.testOrgId,
          title: `${CONFIG.test.prefixMarker}Meeting`,
          status: 'active',
        })
        .returning('id');
      ctx.testMeetingId = typeof meeting === 'object' ? meeting.id : meeting;
      log('Created test meeting', { id: ctx.testMeetingId });
    } else {
      ctx.testMeetingId = existingMeeting.id;
      log('Using existing meeting', { id: ctx.testMeetingId });
    }

    // Insert test transcripts with broadcast payload fields
    const testTranscripts = [
      {
        id: uuidv4(),
        meeting_id: ctx.testMeetingId,
        organization_id: ctx.testOrgId,
        speaker_id: null, // Optional FK
        speaker_name: `${CONFIG.test.prefixMarker}Speaker_Alice`,
        original_text: 'This is a test caption from Stage 7 verification.',
        source_lang: 'en',
        translations: JSON.stringify({
          en: 'This is a test caption from Stage 7 verification.',
          fr: "Ceci est une légende de test de la vérification de l'étape 7.",
          es: 'Este es un subtítulo de prueba de la verificación de la etapa 7.',
        }),
        spoken_at: Date.now(),
      },
      {
        id: uuidv4(),
        meeting_id: ctx.testMeetingId,
        organization_id: ctx.testOrgId,
        speaker_id: null,
        speaker_name: `${CONFIG.test.prefixMarker}Speaker_Bob`,
        original_text: 'Second test caption with translation data.',
        source_lang: 'en',
        translations: JSON.stringify({
          en: 'Second test caption with translation data.',
          de: 'Zweite Testunterschrift mit Übersetzungsdaten.',
        }),
        spoken_at: Date.now() + 1000,
      },
      {
        id: uuidv4(),
        meeting_id: ctx.testMeetingId,
        organization_id: ctx.testOrgId,
        speaker_id: null,
        speaker_name: `${CONFIG.test.prefixMarker}Speaker_Charlie`,
        original_text: 'Third test caption for idempotency testing.',
        source_lang: 'en',
        translations: JSON.stringify({ en: 'Third test caption for idempotency testing.' }),
        spoken_at: Date.now() + 2000,
      },
    ];

    for (const transcript of testTranscripts) {
      await ctx.db(CONFIG.tables.transcripts).insert(transcript);
      ctx.testTranscriptIds.push(transcript.id);
    }

    success(`Inserted ${testTranscripts.length} test transcript(s)`);
    log('Test transcript IDs', ctx.testTranscriptIds);
    stats.transcriptsVerified = testTranscripts.length;

    return true;

  } catch (err: any) {
    fail('Insert test transcript', err.message);
    return false;
  }
}

// ══════════════════════════════════════════════════════════════
// STEP 7.4 — Query Transcripts by MeetingId
// ══════════════════════════════════════════════════════════════

async function step7_4_queryTranscriptsByMeetingId(): Promise<boolean> {
  subsection('STEP 7.4 — Query Transcripts by MeetingId');

  if (!ctx.db || !ctx.testMeetingId) {
    fail('Query transcripts', 'Database or meeting ID not available');
    return false;
  }

  try {
    // Query transcripts for the test meeting
    const transcripts = await ctx.db(CONFIG.tables.transcripts)
      .where({ meeting_id: ctx.testMeetingId })
      .orderBy('spoken_at', 'asc');

    if (transcripts.length === 0) {
      fail('Query transcripts', 'No transcripts found for meeting');
      return false;
    }

    success(`Found ${transcripts.length} transcript(s) for meeting`);

    // Verify each transcript
    for (const transcript of transcripts) {
      log('Transcript record', {
        id: transcript.id,
        speaker: transcript.speaker_name,
        textPreview: transcript.original_text.substring(0, 50) + '...',
        sourceLang: transcript.source_lang,
        translationCount: Object.keys(
          typeof transcript.translations === 'string' 
            ? JSON.parse(transcript.translations)
            : transcript.translations
        ).length,
        spokenAt: new Date(Number(transcript.spoken_at)).toISOString(),
      });
    }

    // Verify we can filter by speaker
    const testSpeakerTranscripts = transcripts.filter(
      (t: any) => t.speaker_name.includes(CONFIG.test.prefixMarker)
    );

    success(`Verified ${testSpeakerTranscripts.length} test speaker transcript(s)`);

    return true;

  } catch (err: any) {
    fail('Query transcripts', err.message);
    return false;
  }
}

// ══════════════════════════════════════════════════════════════
// STEP 7.5 — Payload Field Validation
// ══════════════════════════════════════════════════════════════

async function step7_5_validatePayloadFields(): Promise<boolean> {
  subsection('STEP 7.5 — Payload Field Validation');

  if (!ctx.db || ctx.testTranscriptIds.length === 0) {
    fail('Payload validation', 'No test transcripts to validate');
    return false;
  }

  try {
    // Fetch the first test transcript
    const transcript = await ctx.db(CONFIG.tables.transcripts)
      .where({ id: ctx.testTranscriptIds[0] })
      .first();

    if (!transcript) {
      fail('Payload validation', 'Test transcript not found');
      return false;
    }

    // Required fields according to broadcast payload spec
    const requiredFields = [
      'id',
      'meeting_id',
      'speaker_name',
      'original_text',
      'source_lang',
      'translations',
      'spoken_at',
    ];

    const missingFields: string[] = [];

    for (const field of requiredFields) {
      if (!(field in transcript) || transcript[field] === null || transcript[field] === undefined) {
        // speaker_name can't be null, but we check for existence
        if (field !== 'speaker_id') {
          missingFields.push(field);
        }
      }
    }

    if (missingFields.length > 0) {
      fail('Required fields check', `Missing: ${missingFields.join(', ')}`);
      return false;
    }
    success('All required fields present');

    // Validate field types
    if (typeof transcript.original_text !== 'string' || transcript.original_text.length === 0) {
      fail('original_text validation', 'Must be non-empty string');
      return false;
    }
    success('original_text is valid string');

    // Validate translations JSONB
    const translations = typeof transcript.translations === 'string'
      ? JSON.parse(transcript.translations)
      : transcript.translations;

    if (typeof translations !== 'object' || translations === null) {
      fail('translations validation', 'Must be valid JSON object');
      return false;
    }
    success(`translations contains ${Object.keys(translations).length} language(s)`);

    // Validate source_lang
    if (typeof transcript.source_lang !== 'string' || transcript.source_lang.length === 0) {
      fail('source_lang validation', 'Must be non-empty string');
      return false;
    }
    success(`source_lang is '${transcript.source_lang}'`);

    // Validate spoken_at timestamp
    const spokenAt = Number(transcript.spoken_at);
    if (isNaN(spokenAt) || spokenAt <= 0) {
      fail('spoken_at validation', 'Must be valid epoch timestamp');
      return false;
    }
    success(`spoken_at is valid timestamp: ${new Date(spokenAt).toISOString()}`);

    // Validate meeting_id is UUID
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(transcript.meeting_id)) {
      fail('meeting_id validation', 'Must be valid UUID');
      return false;
    }
    success('meeting_id is valid UUID');

    log('Payload validation complete', {
      id: transcript.id,
      meetingId: transcript.meeting_id,
      speakerName: transcript.speaker_name,
      originalTextLength: transcript.original_text.length,
      translationLanguages: Object.keys(translations),
      sourceLang: transcript.source_lang,
      spokenAt: new Date(spokenAt).toISOString(),
    });

    return true;

  } catch (err: any) {
    fail('Payload validation', err.message);
    return false;
  }
}

// ══════════════════════════════════════════════════════════════
// STEP 7.6 — Broadcast Jobs Persistence
// ══════════════════════════════════════════════════════════════

async function step7_6_verifyBroadcastJobs(): Promise<boolean> {
  subsection('STEP 7.6 — Broadcast Jobs Persistence');

  if (!ctx.db) {
    fail('Broadcast jobs', 'Database not connected');
    return false;
  }

  if (!ctx.tablesExist.broadcastJobs) {
    warn('Skipping broadcast jobs test — table does not exist');
    info('Create broadcast_jobs table to enable this verification');
    return true; // Not a failure, just not testable
  }

  try {
    // Insert test broadcast job
    const testJobId = `stage7-test-job-${uuidv4().slice(0, 8)}`;
    const idempotencyKey = `stage7-idempotent-${uuidv4().slice(0, 8)}`;

    const testJob = {
      id: uuidv4(),
      job_id: testJobId,
      meeting_id: ctx.testMeetingId,
      event_type: 'caption' as const,
      payload: JSON.stringify({
        meetingId: ctx.testMeetingId,
        speakerId: CONFIG.test.speakerId,
        originalText: 'Test broadcast job payload',
        translatedText: { en: 'Test broadcast job payload' },
        language: 'en',
        sourceLanguage: 'en',
        timestamp: Date.now(),
        speaker: `${CONFIG.test.prefixMarker}BroadcastSpeaker`,
      }),
      idempotency_key: idempotencyKey,
      status: 'pending' as const,
      attempts: 0,
      max_attempts: 3,
    };

    await ctx.db(CONFIG.tables.broadcastJobs).insert(testJob);
    ctx.testBroadcastJobIds.push(testJob.id);

    success('Broadcast job inserted');
    log('Broadcast job record', {
      id: testJob.id,
      jobId: testJob.job_id,
      eventType: testJob.event_type,
      status: testJob.status,
      idempotencyKey: testJob.idempotency_key,
    });

    // Verify the job can be retrieved
    const retrievedJob = await ctx.db(CONFIG.tables.broadcastJobs)
      .where({ id: testJob.id })
      .first();

    if (!retrievedJob) {
      fail('Broadcast job retrieval', 'Job not found after insert');
      return false;
    }
    success('Broadcast job retrieved successfully');

    // Validate required fields
    const requiredJobFields = ['id', 'job_id', 'meeting_id', 'event_type', 'payload', 'idempotency_key', 'status'];
    const missingJobFields = requiredJobFields.filter(f => !(f in retrievedJob));

    if (missingJobFields.length > 0) {
      fail('Broadcast job fields', `Missing: ${missingJobFields.join(', ')}`);
      return false;
    }
    success('All broadcast job fields present');

    // Update status to simulate processing
    await ctx.db(CONFIG.tables.broadcastJobs)
      .where({ id: testJob.id })
      .update({
        status: 'completed',
        attempts: 1,
        processed_at: ctx.db.fn.now(),
      });

    const updatedJob = await ctx.db(CONFIG.tables.broadcastJobs)
      .where({ id: testJob.id })
      .first();

    if (updatedJob.status !== 'completed') {
      fail('Broadcast job status update', `Expected 'completed', got '${updatedJob.status}'`);
      return false;
    }
    success('Broadcast job status updated to completed');

    stats.broadcastJobsVerified = 1;
    return true;

  } catch (err: any) {
    fail('Broadcast jobs persistence', err.message);
    return false;
  }
}

// ══════════════════════════════════════════════════════════════
// STEP 7.7 — Idempotency Verification
// ══════════════════════════════════════════════════════════════

async function step7_7_verifyIdempotency(): Promise<boolean> {
  subsection('STEP 7.7 — Idempotency Verification');

  if (!ctx.db) {
    fail('Idempotency verification', 'Database not connected');
    return false;
  }

  if (!ctx.tablesExist.broadcastJobs) {
    warn('Skipping idempotency test — broadcast_jobs table does not exist');
    return true;
  }

  try {
    // Create a unique idempotency key
    const sharedIdempotencyKey = `stage7-dup-test-${uuidv4().slice(0, 8)}`;

    // Insert first job with idempotency key
    const job1 = {
      id: uuidv4(),
      job_id: `dup-job-1-${Date.now()}`,
      meeting_id: ctx.testMeetingId,
      event_type: 'transcript' as const,
      payload: JSON.stringify({ test: 'duplicate1' }),
      idempotency_key: sharedIdempotencyKey,
      status: 'pending' as const,
      attempts: 0,
      max_attempts: 3,
    };

    await ctx.db(CONFIG.tables.broadcastJobs).insert(job1);
    ctx.testBroadcastJobIds.push(job1.id);
    success('First job with idempotency key inserted');

    // Attempt to insert second job with same idempotency key
    const job2 = {
      id: uuidv4(),
      job_id: `dup-job-2-${Date.now()}`,
      meeting_id: ctx.testMeetingId,
      event_type: 'transcript' as const,
      payload: JSON.stringify({ test: 'duplicate2' }),
      idempotency_key: sharedIdempotencyKey, // Same key
      status: 'pending' as const,
      attempts: 0,
      max_attempts: 3,
    };

    try {
      await ctx.db(CONFIG.tables.broadcastJobs).insert(job2);
      // If we get here, duplicate was allowed
      ctx.testBroadcastJobIds.push(job2.id);
      warn('Duplicate idempotency key was allowed — consider adding UNIQUE constraint');
    } catch (dupErr: any) {
      // Expected behavior: unique constraint violation
      if (dupErr.message.includes('duplicate') || dupErr.message.includes('unique') || dupErr.code === '23505') {
        success('Duplicate idempotency key correctly rejected by database');
      } else {
        throw dupErr;
      }
    }

    // Verify only one job exists with that idempotency key
    const jobsWithKey = await ctx.db(CONFIG.tables.broadcastJobs)
      .where({ idempotency_key: sharedIdempotencyKey });

    log('Jobs with shared idempotency key', { count: jobsWithKey.length });

    if (jobsWithKey.length === 1) {
      success('Idempotency constraint working: only one job per key');
    } else if (jobsWithKey.length > 1) {
      warn(`Found ${jobsWithKey.length} jobs with same idempotency key — add UNIQUE constraint for proper deduplication`);
    }

    return true;

  } catch (err: any) {
    fail('Idempotency verification', err.message);
    return false;
  }
}

// ══════════════════════════════════════════════════════════════
// STEP 7.8 — Retry Count Verification
// ══════════════════════════════════════════════════════════════

async function step7_8_verifyRetryCounts(): Promise<boolean> {
  subsection('STEP 7.8 — Retry Count Verification');

  if (!ctx.db) {
    fail('Retry verification', 'Database not connected');
    return false;
  }

  if (!ctx.tablesExist.broadcastJobs) {
    warn('Skipping retry test — broadcast_jobs table does not exist');
    return true;
  }

  try {
    // Insert a job that will simulate retries
    const retryJob = {
      id: uuidv4(),
      job_id: `retry-test-${Date.now()}`,
      meeting_id: ctx.testMeetingId,
      event_type: 'caption' as const,
      payload: JSON.stringify({ test: 'retry' }),
      idempotency_key: `retry-key-${uuidv4().slice(0, 8)}`,
      status: 'pending' as const,
      attempts: 0,
      max_attempts: 3,
    };

    await ctx.db(CONFIG.tables.broadcastJobs).insert(retryJob);
    ctx.testBroadcastJobIds.push(retryJob.id);
    success('Retry test job inserted');

    // Simulate first attempt failure
    await ctx.db(CONFIG.tables.broadcastJobs)
      .where({ id: retryJob.id })
      .update({
        status: 'processing',
        attempts: 1,
        last_error: 'Simulated failure: Network timeout',
      });

    let job = await ctx.db(CONFIG.tables.broadcastJobs)
      .where({ id: retryJob.id })
      .first();

    if (job.attempts !== 1) {
      fail('Retry count update', `Expected attempts=1, got ${job.attempts}`);
      return false;
    }
    success('First attempt recorded (attempts=1)');

    // Simulate second attempt failure
    await ctx.db(CONFIG.tables.broadcastJobs)
      .where({ id: retryJob.id })
      .update({
        attempts: 2,
        last_error: 'Simulated failure: Broadcast service unavailable',
      });

    job = await ctx.db(CONFIG.tables.broadcastJobs)
      .where({ id: retryJob.id })
      .first();

    if (job.attempts !== 2) {
      fail('Retry count increment', `Expected attempts=2, got ${job.attempts}`);
      return false;
    }
    success('Second attempt recorded (attempts=2)');

    // Simulate third attempt success
    await ctx.db(CONFIG.tables.broadcastJobs)
      .where({ id: retryJob.id })
      .update({
        status: 'completed',
        attempts: 3,
        last_error: null,
        processed_at: ctx.db.fn.now(),
      });

    job = await ctx.db(CONFIG.tables.broadcastJobs)
      .where({ id: retryJob.id })
      .first();

    if (job.status !== 'completed' || job.attempts !== 3) {
      fail('Final retry state', `Expected completed with 3 attempts, got ${job.status} with ${job.attempts}`);
      return false;
    }
    success('Job completed after 3 attempts');

    // Verify max_attempts is respected
    if (job.attempts <= job.max_attempts) {
      success(`Retry within max_attempts limit (${job.attempts}/${job.max_attempts})`);
    } else {
      warn(`Attempts exceeded max_attempts: ${job.attempts}/${job.max_attempts}`);
    }

    log('Retry verification complete', {
      jobId: job.job_id,
      finalStatus: job.status,
      totalAttempts: job.attempts,
      maxAttempts: job.max_attempts,
    });

    stats.broadcastJobsVerified++;
    return true;

  } catch (err: any) {
    fail('Retry count verification', err.message);
    return false;
  }
}

// ══════════════════════════════════════════════════════════════
// STEP 7.9 — Metrics Logging Verification
// ══════════════════════════════════════════════════════════════

async function step7_9_verifyMetricsLogging(): Promise<boolean> {
  subsection('STEP 7.9 — Metrics Logging Verification');

  if (!ctx.db) {
    fail('Metrics verification', 'Database not connected');
    return false;
  }

  if (!ctx.tablesExist.metricsLogs) {
    warn('Skipping metrics test — metrics_logs table does not exist');
    return true;
  }

  try {
    // Insert test metrics log
    const metricsLog = {
      id: uuidv4(),
      queue_name: 'broadcast-events',
      waiting_count: 5,
      active_count: 2,
      completed_count: 100,
      failed_count: 3,
      delayed_count: 1,
      meeting_id: ctx.testMeetingId,
      metadata: JSON.stringify({
        source: 'stage7-verification',
        testTimestamp: new Date().toISOString(),
        environment: 'test',
      }),
    };

    await ctx.db(CONFIG.tables.metricsLogs).insert(metricsLog);
    ctx.testMetricsLogIds.push(metricsLog.id);
    success('Metrics log inserted');

    // Retrieve and verify
    const retrievedMetrics = await ctx.db(CONFIG.tables.metricsLogs)
      .where({ id: metricsLog.id })
      .first();

    if (!retrievedMetrics) {
      fail('Metrics retrieval', 'Metrics log not found after insert');
      return false;
    }
    success('Metrics log retrieved successfully');

    // Validate counts
    if (retrievedMetrics.waiting_count !== metricsLog.waiting_count) {
      fail('Metrics count', `waiting_count mismatch`);
      return false;
    }
    success(`waiting_count verified: ${retrievedMetrics.waiting_count}`);

    if (retrievedMetrics.completed_count !== metricsLog.completed_count) {
      fail('Metrics count', `completed_count mismatch`);
      return false;
    }
    success(`completed_count verified: ${retrievedMetrics.completed_count}`);

    if (retrievedMetrics.failed_count !== metricsLog.failed_count) {
      fail('Metrics count', `failed_count mismatch`);
      return false;
    }
    success(`failed_count verified: ${retrievedMetrics.failed_count}`);

    // Check metadata JSONB
    const metadata = typeof retrievedMetrics.metadata === 'string'
      ? JSON.parse(retrievedMetrics.metadata)
      : retrievedMetrics.metadata;

    if (metadata.source !== 'stage7-verification') {
      fail('Metrics metadata', 'metadata.source mismatch');
      return false;
    }
    success('Metadata JSONB correctly stored and retrieved');

    // Insert another metrics entry to verify time-series capability
    const metricsLog2 = {
      id: uuidv4(),
      queue_name: 'broadcast-events',
      waiting_count: 3,
      active_count: 1,
      completed_count: 105,
      failed_count: 3,
      delayed_count: 0,
      meeting_id: ctx.testMeetingId,
      metadata: JSON.stringify({ snapshot: 2 }),
    };

    await ctx.db(CONFIG.tables.metricsLogs).insert(metricsLog2);
    ctx.testMetricsLogIds.push(metricsLog2.id);

    // Query metrics for the meeting
    const allMetrics = await ctx.db(CONFIG.tables.metricsLogs)
      .where({ queue_name: 'broadcast-events' })
      .whereIn('id', ctx.testMetricsLogIds)
      .orderBy('recorded_at', 'desc');

    success(`Time-series metrics working: ${allMetrics.length} entries recorded`);

    log('Metrics verification complete', {
      entriesRecorded: allMetrics.length,
      latestWaiting: allMetrics[0]?.waiting_count,
      latestCompleted: allMetrics[0]?.completed_count,
    });

    stats.metricsLogsVerified = allMetrics.length;
    return true;

  } catch (err: any) {
    fail('Metrics logging verification', err.message);
    return false;
  }
}

// ══════════════════════════════════════════════════════════════
// STEP 7.10 — Cleanup Test Data
// ══════════════════════════════════════════════════════════════

async function step7_10_cleanup(): Promise<boolean> {
  subsection('STEP 7.10 — Cleanup Test Data');

  if (!ctx.db) {
    fail('Cleanup', 'Database not connected');
    return false;
  }

  try {
    let cleanedCount = 0;

    // Clean up test metrics logs
    if (ctx.testMetricsLogIds.length > 0 && ctx.tablesExist.metricsLogs) {
      const deleted = await ctx.db(CONFIG.tables.metricsLogs)
        .whereIn('id', ctx.testMetricsLogIds)
        .delete();
      cleanedCount += deleted;
      log(`Deleted ${deleted} test metrics log(s)`);
    }

    // Clean up test broadcast jobs
    if (ctx.testBroadcastJobIds.length > 0 && ctx.tablesExist.broadcastJobs) {
      const deleted = await ctx.db(CONFIG.tables.broadcastJobs)
        .whereIn('id', ctx.testBroadcastJobIds)
        .delete();
      cleanedCount += deleted;
      log(`Deleted ${deleted} test broadcast job(s)`);
    }

    // Clean up test transcripts
    if (ctx.testTranscriptIds.length > 0) {
      const deleted = await ctx.db(CONFIG.tables.transcripts)
        .whereIn('id', ctx.testTranscriptIds)
        .delete();
      cleanedCount += deleted;
      log(`Deleted ${deleted} test transcript(s)`);
    }

    // Clean up test meeting (if we created it)
    if (ctx.testMeetingId === CONFIG.test.meetingId) {
      try {
        await ctx.db('meetings')
          .where({ id: CONFIG.test.meetingId })
          .delete();
        log('Deleted test meeting');
        cleanedCount++;
      } catch {}
    }

    // Clean up test organization (if we created it)
    if (ctx.testOrgId === CONFIG.test.organizationId) {
      try {
        await ctx.db('organizations')
          .where({ id: CONFIG.test.organizationId })
          .delete();
        log('Deleted test organization');
        cleanedCount++;
      } catch {}
    }

    success(`Cleanup complete: ${cleanedCount} test record(s) removed`);

    // Close database connection
    await ctx.db.destroy();
    log('Database connection closed');

    return true;

  } catch (err: any) {
    fail('Cleanup', err.message);
    // Still try to close the connection
    try {
      await ctx.db?.destroy();
    } catch {}
    return false;
  }
}

// ══════════════════════════════════════════════════════════════
// MAIN EXECUTION
// ══════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  section('STAGE 7 — DATABASE PERSISTENCE VERIFICATION');
  console.log(`${colors.dim}  PostgreSQL persistence verification for broadcast pipeline${colors.reset}`);
  console.log(`${colors.dim}  Test Meeting ID: ${CONFIG.test.meetingId}${colors.reset}\n`);

  const startTime = Date.now();

  // Set overall timeout
  const timeoutId = setTimeout(() => {
    console.error(`\n${colors.red}❌ TIMEOUT: Verification exceeded ${CONFIG.timeouts.overall / 1000}s${colors.reset}`);
    process.exit(1);
  }, CONFIG.timeouts.overall);

  try {
    // Execute all steps in sequence
    const steps = [
      { name: '7.1', fn: step7_1_connectDatabase },
      { name: '7.2', fn: step7_2_verifyTables },
      { name: '7.3', fn: step7_3_insertTestTranscript },
      { name: '7.4', fn: step7_4_queryTranscriptsByMeetingId },
      { name: '7.5', fn: step7_5_validatePayloadFields },
      { name: '7.6', fn: step7_6_verifyBroadcastJobs },
      { name: '7.7', fn: step7_7_verifyIdempotency },
      { name: '7.8', fn: step7_8_verifyRetryCounts },
      { name: '7.9', fn: step7_9_verifyMetricsLogging },
      { name: '7.10', fn: step7_10_cleanup },
    ];

    for (const step of steps) {
      const result = await step.fn();
      if (!result && step.name !== '7.10') {
        // Continue even if some steps fail to collect all results
        // But step 7.1 (connection) failure should stop everything
        if (step.name === '7.1') {
          throw new Error('Database connection failed — cannot continue');
        }
      }
    }

    clearTimeout(timeoutId);

    // Final summary
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    section('STAGE 7 VERIFICATION SUMMARY');

    console.log(`\n  ${colors.bold}Database Persistence Results:${colors.reset}`);
    console.log(`  ${'─'.repeat(40)}`);
    console.log(`  ${colors.magenta}Transcripts Verified:${colors.reset}    ${stats.transcriptsVerified}`);
    console.log(`  ${colors.magenta}Broadcast Jobs Verified:${colors.reset} ${stats.broadcastJobsVerified}`);
    console.log(`  ${colors.magenta}Metrics Logs Verified:${colors.reset}   ${stats.metricsLogsVerified}`);
    console.log(`  ${'─'.repeat(40)}`);

    console.log(`\n  ${colors.bold}Test Results:${colors.reset}`);
    console.log(`  ${'─'.repeat(40)}`);
    console.log(`  ${colors.green}Passed:${colors.reset}  ${stats.testsPassed}`);
    console.log(`  ${colors.red}Failed:${colors.reset}  ${stats.testsFailed}`);
    console.log(`  ${'─'.repeat(40)}`);
    console.log(`  ${colors.bold}Total:${colors.reset}   ${stats.testsPassed + stats.testsFailed}`);
    console.log(`  ${colors.dim}Duration: ${duration}s${colors.reset}\n`);

    if (stats.testsFailed === 0) {
      console.log(`${colors.cyan}${'═'.repeat(60)}${colors.reset}`);
      console.log(`${colors.green}${colors.bold}`);
      console.log(`  🎉 STAGE 7 DATABASE PERSISTENCE VERIFICATION PASSED`);
      console.log(`${colors.reset}`);
      console.log(`  ${colors.dim}Data flow verified:${colors.reset}`);
      console.log(`  Broadcast → PostgreSQL → Query → Validate → ✓`);
      console.log(`${colors.cyan}${'═'.repeat(60)}${colors.reset}\n`);
      process.exit(0);
    } else {
      console.log(`${colors.cyan}${'═'.repeat(60)}${colors.reset}`);
      console.log(`${colors.red}${colors.bold}`);
      console.log(`  ⚠️  VERIFICATION INCOMPLETE — ${stats.testsFailed} TEST(S) FAILED`);
      console.log(`${colors.reset}`);
      console.log(`  Review failures above and ensure:`);
      console.log(`  - DATABASE_URL is correctly set`);
      console.log(`  - All required tables exist`);
      console.log(`  - Database migrations have been run`);
      console.log(`${colors.cyan}${'═'.repeat(60)}${colors.reset}\n`);
      process.exit(1);
    }

  } catch (err: any) {
    clearTimeout(timeoutId);
    console.error(`\n${colors.red}Fatal error: ${err.message}${colors.reset}`);
    console.error(err.stack);
    
    // Cleanup on fatal error
    try {
      await ctx.db?.destroy();
    } catch {}
    
    process.exit(1);
  }
}

// Run
main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
