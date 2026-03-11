// ============================================================
// OrgsLedger API — Shard Router Unit Tests
// ============================================================

// Mock the logger to avoid real logging during tests
jest.mock('../logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock the db module to prevent jest.setup.ts teardown from failing
jest.mock('../db', () => ({
  __esModule: true,
  default: { destroy: jest.fn() },
}));

import {
  murmurhash3,
  getShardForMeeting,
  getQueueForMeeting,
  buildQueueName,
  getAllQueueNames,
  getAllShardedQueueNames,
  parseQueueName,
  NUM_SHARDS,
  QUEUE_TYPES,
} from '../scaling/shard-router';

// ── MurmurHash3 Tests ───────────────────────────────────────

describe('murmurhash3', () => {
  it('should return a 32-bit unsigned integer', () => {
    const hash = murmurhash3('test-meeting-id');
    expect(hash).toBeGreaterThanOrEqual(0);
    expect(hash).toBeLessThanOrEqual(0xffffffff);
    expect(Number.isInteger(hash)).toBe(true);
  });

  it('should be deterministic — same input always produces the same hash', () => {
    const id = 'meeting-abc-123-def-456';
    const hash1 = murmurhash3(id);
    const hash2 = murmurhash3(id);
    const hash3 = murmurhash3(id);
    expect(hash1).toBe(hash2);
    expect(hash2).toBe(hash3);
  });

  it('should produce different hashes for different inputs', () => {
    const hash1 = murmurhash3('meeting-1');
    const hash2 = murmurhash3('meeting-2');
    const hash3 = murmurhash3('meeting-3');
    // While collisions are theoretically possible, they should be
    // extremely rare for these simple distinct inputs
    expect(hash1).not.toBe(hash2);
    expect(hash2).not.toBe(hash3);
    expect(hash1).not.toBe(hash3);
  });

  it('should handle empty string', () => {
    const hash = murmurhash3('');
    expect(hash).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(hash)).toBe(true);
  });

  it('should handle very long strings', () => {
    const longId = 'a'.repeat(10000);
    const hash = murmurhash3(longId);
    expect(hash).toBeGreaterThanOrEqual(0);
    expect(hash).toBeLessThanOrEqual(0xffffffff);
  });

  it('should produce different hashes with different seeds', () => {
    const key = 'same-meeting-id';
    const hash1 = murmurhash3(key, 0);
    const hash2 = murmurhash3(key, 42);
    expect(hash1).not.toBe(hash2);
  });

  it('should produce well-distributed hashes for sequential IDs', () => {
    const shardCounts = new Array(NUM_SHARDS).fill(0);
    const totalIds = 10000;

    for (let i = 0; i < totalIds; i++) {
      const hash = murmurhash3(`meeting-${i}`);
      const shard = hash % NUM_SHARDS;
      shardCounts[shard]++;
    }

    // Each shard should have roughly totalIds / NUM_SHARDS meetings
    const expectedPerShard = totalIds / NUM_SHARDS;
    const tolerance = expectedPerShard * 0.3; // Allow 30% deviation

    for (let i = 0; i < NUM_SHARDS; i++) {
      expect(shardCounts[i]).toBeGreaterThan(expectedPerShard - tolerance);
      expect(shardCounts[i]).toBeLessThan(expectedPerShard + tolerance);
    }
  });
});

// ── getShardForMeeting Tests ────────────────────────────────

describe('getShardForMeeting', () => {
  it('should return a valid shard ID within range', () => {
    const { shardId } = getShardForMeeting('meeting-xyz');
    expect(shardId).toBeGreaterThanOrEqual(0);
    expect(shardId).toBeLessThan(NUM_SHARDS);
    expect(Number.isInteger(shardId)).toBe(true);
  });

  it('should be deterministic — same meetingId always maps to same shard', () => {
    const meetingId = 'deterministic-meeting-test-001';
    const result1 = getShardForMeeting(meetingId);
    const result2 = getShardForMeeting(meetingId);
    const result3 = getShardForMeeting(meetingId);
    expect(result1.shardId).toBe(result2.shardId);
    expect(result2.shardId).toBe(result3.shardId);
  });

  it('should distribute meetings across shards', () => {
    const shards = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const { shardId } = getShardForMeeting(`meeting-distribution-${i}`);
      shards.add(shardId);
    }
    // With 200 meetings and 16 (default) shards, all shards should be used
    expect(shards.size).toBe(NUM_SHARDS);
  });

  it('should handle UUID-style meeting IDs', () => {
    const uuidId = '550e8400-e29b-41d4-a716-446655440000';
    const { shardId } = getShardForMeeting(uuidId);
    expect(shardId).toBeGreaterThanOrEqual(0);
    expect(shardId).toBeLessThan(NUM_SHARDS);
  });
});

// ── getQueueForMeeting Tests ────────────────────────────────

describe('getQueueForMeeting', () => {
  it('should return correct shardId and queueName for transcript', () => {
    const result = getQueueForMeeting('meeting-001', 'transcript');
    expect(result.shardId).toBeGreaterThanOrEqual(0);
    expect(result.shardId).toBeLessThan(NUM_SHARDS);
    expect(result.queueName).toBe(`transcript-jobs-shard-${result.shardId}`);
  });

  it('should return correct shardId and queueName for translation', () => {
    const result = getQueueForMeeting('meeting-001', 'translation');
    expect(result.shardId).toBeGreaterThanOrEqual(0);
    expect(result.queueName).toBe(`translation-jobs-shard-${result.shardId}`);
  });

  it('should return correct shardId and queueName for broadcast', () => {
    const result = getQueueForMeeting('meeting-001', 'broadcast');
    expect(result.shardId).toBeGreaterThanOrEqual(0);
    expect(result.queueName).toBe(`broadcast-jobs-shard-${result.shardId}`);
  });

  it('should map the same meetingId to the same shard across all queue types', () => {
    const meetingId = 'cross-queue-consistency-test';
    const transcript = getQueueForMeeting(meetingId, 'transcript');
    const translation = getQueueForMeeting(meetingId, 'translation');
    const broadcast = getQueueForMeeting(meetingId, 'broadcast');

    // Same meetingId → same shardId regardless of queue type
    expect(transcript.shardId).toBe(translation.shardId);
    expect(translation.shardId).toBe(broadcast.shardId);

    // Queue names differ by prefix but share the shard suffix
    expect(transcript.queueName).toContain(`shard-${transcript.shardId}`);
    expect(translation.queueName).toContain(`shard-${transcript.shardId}`);
    expect(broadcast.queueName).toContain(`shard-${transcript.shardId}`);
  });

  it('should be deterministic across repeated calls', () => {
    const meetingId = 'stability-test-meeting';
    const results = Array.from({ length: 50 }, () =>
      getQueueForMeeting(meetingId, 'transcript'),
    );
    const first = results[0];
    for (const r of results) {
      expect(r.shardId).toBe(first.shardId);
      expect(r.queueName).toBe(first.queueName);
    }
  });
});

// ── buildQueueName Tests ────────────────────────────────────

describe('buildQueueName', () => {
  it('should build correct queue names', () => {
    expect(buildQueueName('transcript', 0)).toBe('transcript-jobs-shard-0');
    expect(buildQueueName('translation', 5)).toBe('translation-jobs-shard-5');
    expect(buildQueueName('broadcast', 15)).toBe('broadcast-jobs-shard-15');
  });
});

// ── getAllQueueNames Tests ───────────────────────────────────

describe('getAllQueueNames', () => {
  it('should return NUM_SHARDS queue names for each type', () => {
    for (const queueType of QUEUE_TYPES) {
      const names = getAllQueueNames(queueType);
      expect(names).toHaveLength(NUM_SHARDS);
    }
  });

  it('should produce sequential shard names', () => {
    const names = getAllQueueNames('transcript');
    for (let i = 0; i < NUM_SHARDS; i++) {
      expect(names[i]).toBe(`transcript-jobs-shard-${i}`);
    }
  });

  it('should produce unique queue names', () => {
    const names = getAllQueueNames('translation');
    const unique = new Set(names);
    expect(unique.size).toBe(NUM_SHARDS);
  });
});

// ── getAllShardedQueueNames Tests ────────────────────────────

describe('getAllShardedQueueNames', () => {
  it('should return all queues across all types', () => {
    const names = getAllShardedQueueNames();
    expect(names).toHaveLength(QUEUE_TYPES.length * NUM_SHARDS);
  });

  it('should contain names from every queue type', () => {
    const names = getAllShardedQueueNames();
    expect(names.some((n: string) => n.startsWith('transcript-jobs'))).toBe(true);
    expect(names.some((n: string) => n.startsWith('translation-jobs'))).toBe(true);
    expect(names.some((n: string) => n.startsWith('broadcast-jobs'))).toBe(true);
  });

  it('should have all unique names', () => {
    const names = getAllShardedQueueNames();
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });
});

// ── parseQueueName Tests ────────────────────────────────────

describe('parseQueueName', () => {
  it('should parse valid transcript queue names', () => {
    const result = parseQueueName('transcript-jobs-shard-3');
    expect(result).toEqual({ queueType: 'transcript', shardId: 3 });
  });

  it('should parse valid translation queue names', () => {
    const result = parseQueueName('translation-jobs-shard-0');
    expect(result).toEqual({ queueType: 'translation', shardId: 0 });
  });

  it('should parse valid broadcast queue names', () => {
    const result = parseQueueName('broadcast-jobs-shard-15');
    expect(result).toEqual({ queueType: 'broadcast', shardId: 15 });
  });

  it('should return null for invalid queue names', () => {
    expect(parseQueueName('invalid-queue')).toBeNull();
    expect(parseQueueName('transcript-jobs-shard-')).toBeNull();
    expect(parseQueueName('')).toBeNull();
    expect(parseQueueName('some-random-string')).toBeNull();
  });

  it('should return null for out-of-range shard IDs', () => {
    expect(parseQueueName(`transcript-jobs-shard-${NUM_SHARDS}`)).toBeNull();
    expect(parseQueueName('transcript-jobs-shard-9999')).toBeNull();
  });

  it('should roundtrip with buildQueueName', () => {
    for (const queueType of QUEUE_TYPES) {
      for (let shard = 0; shard < NUM_SHARDS; shard++) {
        const name = buildQueueName(queueType, shard);
        const parsed = parseQueueName(name);
        expect(parsed).toEqual({ queueType, shardId: shard });
      }
    }
  });
});

// ── NUM_SHARDS Configuration Tests ──────────────────────────

describe('NUM_SHARDS', () => {
  it('should be a positive integer', () => {
    expect(NUM_SHARDS).toBeGreaterThan(0);
    expect(Number.isInteger(NUM_SHARDS)).toBe(true);
  });

  it('should default to 16 when env var is not set', () => {
    // NUM_SHARDS is evaluated at module load time.
    // In the test environment QUEUE_NUM_SHARDS is not set, so it defaults to 16.
    expect(NUM_SHARDS).toBe(16);
  });
});

// ── Consistency Stress Test ─────────────────────────────────

describe('shard routing consistency (stress)', () => {
  it('should produce identical results over 1000 calls for the same meetingId', () => {
    const meetingId = 'stress-test-meeting-id-abc-123';
    const expected = getQueueForMeeting(meetingId, 'transcript');

    for (let i = 0; i < 1000; i++) {
      const result = getQueueForMeeting(meetingId, 'transcript');
      expect(result.shardId).toBe(expected.shardId);
      expect(result.queueName).toBe(expected.queueName);
    }
  });

  it('should distribute 50,000 meetings reasonably across shards', () => {
    const shardCounts = new Array(NUM_SHARDS).fill(0);

    for (let i = 0; i < 50000; i++) {
      const { shardId } = getShardForMeeting(`meeting-${i}-${Math.random().toString(36).slice(2, 10)}`);
      shardCounts[shardId]++;
    }

    const expectedPerShard = 50000 / NUM_SHARDS;
    const maxDeviation = expectedPerShard * 0.15; // Allow 15% deviation

    for (let i = 0; i < NUM_SHARDS; i++) {
      expect(shardCounts[i]).toBeGreaterThan(expectedPerShard - maxDeviation);
      expect(shardCounts[i]).toBeLessThan(expectedPerShard + maxDeviation);
    }
  });
});
