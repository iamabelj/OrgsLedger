// Quick verification script for shard distribution
// Run with: npx ts-node src/__tests__/verify-shard-distribution.ts

import { getShardIndex, SHARDED_QUEUE_TYPES, QUEUE_SHARD_COUNTS } from '../queues/queue-manager';

const TOTAL_MEETINGS = 1000;

interface ShardCounts {
  [key: number]: number;
}

const shardCounts: Record<string, ShardCounts> = {
  transcript: {},
  translation: {},
  broadcast: {},
  minutes: {},
};

// Generate random meeting IDs and track shard distribution
for (let i = 0; i < TOTAL_MEETINGS; i++) {
  const meetingId = `meeting-${Math.random().toString(36).substring(2, 15)}`;

  const transcriptShard = getShardIndex(meetingId, SHARDED_QUEUE_TYPES.TRANSCRIPT_EVENTS);
  const translationShard = getShardIndex(meetingId, SHARDED_QUEUE_TYPES.TRANSLATION_JOBS);
  const broadcastShard = getShardIndex(meetingId, SHARDED_QUEUE_TYPES.BROADCAST_EVENTS);
  const minutesShard = getShardIndex(meetingId, SHARDED_QUEUE_TYPES.MINUTES_GENERATION);

  shardCounts.transcript[transcriptShard] = (shardCounts.transcript[transcriptShard] || 0) + 1;
  shardCounts.translation[translationShard] = (shardCounts.translation[translationShard] || 0) + 1;
  shardCounts.broadcast[broadcastShard] = (shardCounts.broadcast[broadcastShard] || 0) + 1;
  shardCounts.minutes[minutesShard] = (shardCounts.minutes[minutesShard] || 0) + 1;
}

console.log('\n=== SHARD DISTRIBUTION (' + TOTAL_MEETINGS + ' random meetings) ===\n');
console.log('Shard configuration:');
console.log('  TRANSCRIPT:', QUEUE_SHARD_COUNTS.transcript, 'shards');
console.log('  TRANSLATION:', QUEUE_SHARD_COUNTS.translation, 'shards');
console.log('  BROADCAST:', QUEUE_SHARD_COUNTS.broadcast, 'shards');
console.log('  MINUTES:', QUEUE_SHARD_COUNTS.minutes, 'shards');
console.log('');

const typeToShardCount: Record<string, number> = {
  transcript: QUEUE_SHARD_COUNTS.transcript,
  translation: QUEUE_SHARD_COUNTS.translation,
  broadcast: QUEUE_SHARD_COUNTS.broadcast,
  minutes: QUEUE_SHARD_COUNTS.minutes,
};

let allBalanced = true;

for (const [type, counts] of Object.entries(shardCounts)) {
  const shardCount = typeToShardCount[type];
  const expected = TOTAL_MEETINGS / shardCount;
  const values = Object.values(counts) as number[];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const spread = ((max - min) / expected * 100).toFixed(1);
  const usedShards = Object.keys(counts).length;

  console.log(type.toUpperCase() + ' (' + shardCount + ' shards):');
  console.log('  Expected per shard: ~' + expected.toFixed(1));
  console.log('  Actual range: ' + min + ' - ' + max + ' (spread: ' + spread + '%)');
  console.log('  Average: ' + avg.toFixed(1));
  console.log('  All shards used: ' + (usedShards === shardCount ? 'YES ✓' : 'NO (' + usedShards + '/' + shardCount + ')'));

  // Check if distribution is within acceptable range (no shard has > 2x expected)
  if (max > expected * 2 || min < expected * 0.5) {
    console.log('  ⚠️  UNBALANCED DISTRIBUTION');
    allBalanced = false;
  } else {
    console.log('  ✓ Balanced');
  }
  console.log('');
}

// Test determinism - same meetingId should always route to same shard
console.log('=== DETERMINISM TEST ===\n');
const testMeetingId = 'meeting-test-12345-abc';
const shard1 = getShardIndex(testMeetingId, SHARDED_QUEUE_TYPES.TRANSCRIPT_EVENTS);
const shard2 = getShardIndex(testMeetingId, SHARDED_QUEUE_TYPES.TRANSCRIPT_EVENTS);
const shard3 = getShardIndex(testMeetingId, SHARDED_QUEUE_TYPES.TRANSCRIPT_EVENTS);

console.log('Meeting ID:', testMeetingId);
console.log('Shard calls: ', shard1, shard2, shard3);
console.log('Deterministic:', shard1 === shard2 && shard2 === shard3 ? 'YES ✓' : 'NO ✗');
console.log('');

// Show sample shard assignments
console.log('=== SAMPLE SHARD ASSIGNMENTS ===\n');
const sampleMeetings = [
  'meeting-001',
  'meeting-002',
  'meeting-003',
  'meeting-abc',
  'meeting-xyz',
];

console.log('MeetingID'.padEnd(20) + 'Transcript'.padEnd(12) + 'Translation'.padEnd(12) + 'Broadcast'.padEnd(12) + 'Minutes');
console.log('-'.repeat(68));

for (const meetingId of sampleMeetings) {
  const t = getShardIndex(meetingId, SHARDED_QUEUE_TYPES.TRANSCRIPT_EVENTS);
  const tr = getShardIndex(meetingId, SHARDED_QUEUE_TYPES.TRANSLATION_JOBS);
  const b = getShardIndex(meetingId, SHARDED_QUEUE_TYPES.BROADCAST_EVENTS);
  const m = getShardIndex(meetingId, SHARDED_QUEUE_TYPES.MINUTES_GENERATION);
  console.log(meetingId.padEnd(20) + String(t).padEnd(12) + String(tr).padEnd(12) + String(b).padEnd(12) + String(m));
}

console.log('\n=== RESULT ===');
console.log(allBalanced ? '✓ All queue types have BALANCED shard distribution' : '✗ Some queue types have UNBALANCED distribution');
