// ============================================================
// Meeting Module — Unit Tests
// Tests: Create, Join, Leave, End, Cancel meeting operations
// ============================================================

// ── Mock Database ─────────────────────────────────────────────
const mockDbReturning = jest.fn();
const mockDbUpdate = jest.fn();
const mockDbInsert = jest.fn();
const mockDbWhere = jest.fn();
const mockDbFirst = jest.fn();
const mockDbCount = jest.fn();
const mockDbOrderBy = jest.fn();
const mockDbOffset = jest.fn();
const mockDbLimit = jest.fn();
const mockDbClone = jest.fn();
const mockDbClear = jest.fn();

const chainBase: any = {};
Object.assign(chainBase, {
  where: mockDbWhere.mockReturnValue(chainBase),
  first: mockDbFirst,
  insert: mockDbInsert.mockReturnValue(chainBase),
  update: mockDbUpdate.mockReturnValue(chainBase),
  returning: mockDbReturning,
  count: mockDbCount.mockReturnValue(chainBase),
  orderBy: mockDbOrderBy.mockReturnValue(chainBase),
  offset: mockDbOffset.mockReturnValue(chainBase),
  limit: mockDbLimit,
  clone: mockDbClone.mockReturnValue(chainBase),
  clear: mockDbClear.mockReturnValue(chainBase),
});

const mockDb: any = jest.fn(() => chainBase);
mockDb.fn = { now: jest.fn(() => new Date().toISOString()) };
mockDb.raw = jest.fn();
mockDb.schema = { hasTable: jest.fn().mockResolvedValue(true) };

jest.mock('../db', () => ({ __esModule: true, default: mockDb }));
jest.mock('../logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../config', () => ({
  config: {
    jwt: { secret: 'test-secret-min-32-chars!!' },
    redis: { url: 'redis://localhost:6379' },
  },
}));
jest.mock('../services/registry', () => ({
  services: { get: jest.fn(() => null), register: jest.fn() },
}));

// Mock the meeting cache service to avoid Redis dependency in tests
jest.mock('../modules/meeting/services/meeting-cache.service', () => ({
  setActiveMeetingState: jest.fn().mockResolvedValue(undefined),
  getActiveMeetingState: jest.fn().mockResolvedValue(null),
  removeActiveMeetingState: jest.fn().mockResolvedValue(undefined),
  updateMeetingParticipants: jest.fn().mockResolvedValue(undefined),
  isMeetingActive: jest.fn().mockResolvedValue(false),
}));

// Mock the event bus service to avoid Redis dependency in tests
jest.mock('../modules/meeting/services/event-bus.service', () => ({
  publishEvent: jest.fn().mockResolvedValue(undefined),
  subscribe: jest.fn().mockResolvedValue(() => {}),
  EVENT_CHANNELS: { MEETING_EVENTS: 'meeting.events' },
}));

import { MeetingService } from '../modules/meeting/services/meeting.service';
import { Meeting, MeetingStatus } from '../modules/meeting/models';

// ── Test Setup ────────────────────────────────────────────────

const testOrgId = '11111111-1111-1111-1111-111111111111';
const testHostId = '22222222-2222-2222-2222-222222222222';
const testUserId = '33333333-3333-3333-3333-333333333333';
const testMeetingId = '44444444-4444-4444-4444-444444444444';

function createMockMeetingRow(overrides: Partial<any> = {}) {
  const now = new Date().toISOString();
  return {
    id: testMeetingId,
    organization_id: testOrgId,
    host_id: testHostId,
    title: 'Test Meeting',
    description: 'A test meeting',
    status: 'scheduled' as MeetingStatus,
    participants: JSON.stringify([{
      userId: testHostId,
      role: 'host',
      joinedAt: now,
    }]),
    settings: JSON.stringify({
      maxParticipants: 100,
      allowRecording: false,
      waitingRoom: false,
      muteOnEntry: true,
      allowScreenShare: true,
    }),
    scheduled_at: null,
    started_at: null,
    ended_at: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe('Meeting Service', () => {
  let service: MeetingService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MeetingService();
  });

  // ── Create Meeting ─────────────────────────────────────────

  describe('create()', () => {
    it('should create a meeting successfully', async () => {
      const mockRow = createMockMeetingRow();
      mockDbReturning.mockResolvedValue([mockRow]);

      const meeting = await service.create(testHostId, {
        organizationId: testOrgId,
        title: 'Test Meeting',
        description: 'A test meeting',
      });

      expect(meeting).toBeDefined();
      expect(meeting.id).toBe(testMeetingId);
      expect(meeting.organizationId).toBe(testOrgId);
      expect(meeting.hostId).toBe(testHostId);
      expect(meeting.status).toBe('scheduled');
      expect(meeting.participants).toHaveLength(1);
      expect(meeting.participants[0].role).toBe('host');
      expect(mockDbInsert).toHaveBeenCalled();
    });

    it('should include custom settings when provided', async () => {
      const mockRow = createMockMeetingRow({
        settings: JSON.stringify({
          maxParticipants: 50,
          allowRecording: true,
          waitingRoom: true,
          muteOnEntry: false,
          allowScreenShare: false,
        }),
      });
      mockDbReturning.mockResolvedValue([mockRow]);

      const meeting = await service.create(testHostId, {
        organizationId: testOrgId,
        settings: {
          maxParticipants: 50,
          allowRecording: true,
          waitingRoom: true,
          muteOnEntry: false,
          allowScreenShare: false,
        },
      });

      expect(meeting.settings.maxParticipants).toBe(50);
      expect(meeting.settings.allowRecording).toBe(true);
    });
  });

  // ── Get Meeting by ID ──────────────────────────────────────

  describe('getById()', () => {
    it('should return null for non-existent meeting', async () => {
      mockDbFirst.mockResolvedValue(undefined);

      const meeting = await service.getById('non-existent-id');

      expect(meeting).toBeNull();
    });

    it('should return meeting when found', async () => {
      const mockRow = createMockMeetingRow();
      mockDbFirst.mockResolvedValue(mockRow);

      const meeting = await service.getById(testMeetingId);

      expect(meeting).toBeDefined();
      expect(meeting?.id).toBe(testMeetingId);
    });
  });

  // ── Start Meeting ──────────────────────────────────────────

  describe('start()', () => {
    it('should start a scheduled meeting', async () => {
      const mockRow = createMockMeetingRow({ status: 'scheduled' });
      mockDbFirst.mockResolvedValue(mockRow);
      
      const startedRow = createMockMeetingRow({
        status: 'active',
        started_at: new Date().toISOString(),
      });
      mockDbReturning.mockResolvedValue([startedRow]);

      const meeting = await service.start(testMeetingId, testHostId);

      expect(meeting.status).toBe('active');
      expect(meeting.startedAt).toBeDefined();
    });

    it('should reject non-host trying to start', async () => {
      const mockRow = createMockMeetingRow();
      mockDbFirst.mockResolvedValue(mockRow);

      await expect(service.start(testMeetingId, testUserId))
        .rejects.toThrow('Only the host can start the meeting');
    });

    it('should reject starting an already active meeting', async () => {
      const mockRow = createMockMeetingRow({ status: 'active' });
      mockDbFirst.mockResolvedValue(mockRow);

      await expect(service.start(testMeetingId, testHostId))
        .rejects.toThrow('Cannot start meeting with status: active');
    });
  });

  // ── Join Meeting ────────────────────────────────────────────

  describe('join()', () => {
    it('should add participant to active meeting (Redis only, no DB write)', async () => {
      const mockRow = createMockMeetingRow({ status: 'active' });
      mockDbFirst.mockResolvedValue(mockRow);

      const meeting = await service.join(testMeetingId, testUserId, 'Test User');

      // join() should NOT call db().update() - only updates Redis
      expect(mockDbUpdate).not.toHaveBeenCalled();
      
      // Should return meeting with updated participants
      expect(meeting.participants).toHaveLength(2);
      expect(meeting.participants[1].userId).toBe(testUserId);
      expect(meeting.participants[1].role).toBe('participant');
    });

    it('should reject joining ended meeting', async () => {
      const mockRow = createMockMeetingRow({ status: 'ended' });
      mockDbFirst.mockResolvedValue(mockRow);

      await expect(service.join(testMeetingId, testUserId))
        .rejects.toThrow('Cannot join meeting with status: ended');
    });

    it('should auto-start meeting when host joins scheduled meeting', async () => {
      const mockRow = createMockMeetingRow({ status: 'scheduled' });
      mockDbFirst.mockResolvedValue(mockRow);
      
      const activeRow = createMockMeetingRow({
        status: 'active',
        started_at: new Date().toISOString(),
      });
      mockDbReturning.mockResolvedValue([activeRow]);

      const meeting = await service.join(testMeetingId, testHostId);

      expect(meeting.status).toBe('active');
    });
  });

  // ── Leave Meeting ───────────────────────────────────────────

  describe('leave()', () => {
    it('should mark participant as left (Redis only, no DB write)', async () => {
      const now = new Date().toISOString();
      const mockRow = createMockMeetingRow({
        status: 'active',
        participants: JSON.stringify([
          { userId: testHostId, role: 'host', joinedAt: now },
          { userId: testUserId, role: 'participant', joinedAt: now },
        ]),
      });
      mockDbFirst.mockResolvedValue(mockRow);

      // Reset mock to verify no DB update is called
      mockDbUpdate.mockClear();
      
      const meeting = await service.leave(testMeetingId, testUserId);

      // leave() should NOT call db().update() when participant leaves
      // (only updates Redis during active meeting)
      expect(mockDbUpdate).not.toHaveBeenCalled();
      
      // Should return meeting with leftAt set
      const leftParticipant = meeting.participants.find(p => p.userId === testUserId);
      expect(leftParticipant?.leftAt).toBeDefined();
    });

    it('should end meeting when all participants leave', async () => {
      const now = new Date().toISOString();
      const mockRow = createMockMeetingRow({
        status: 'active',
        participants: JSON.stringify([
          { userId: testHostId, role: 'host', joinedAt: now },
        ]),
      });
      mockDbFirst
        .mockResolvedValueOnce(mockRow)  // First call for leave
        .mockResolvedValueOnce(mockRow); // Second call for end
      
      const endedRow = createMockMeetingRow({
        status: 'ended',
        ended_at: now,
      });
      mockDbReturning.mockResolvedValue([endedRow]);

      const meeting = await service.leave(testMeetingId, testHostId);

      expect(meeting.status).toBe('ended');
    });
  });

  // ── End Meeting ─────────────────────────────────────────────

  describe('end()', () => {
    it('should end an active meeting', async () => {
      const mockRow = createMockMeetingRow({ status: 'active' });
      mockDbFirst.mockResolvedValue(mockRow);
      
      const endedRow = createMockMeetingRow({
        status: 'ended',
        ended_at: new Date().toISOString(),
      });
      mockDbReturning.mockResolvedValue([endedRow]);

      const meeting = await service.end(testMeetingId, testHostId);

      expect(meeting.status).toBe('ended');
      expect(meeting.endedAt).toBeDefined();
    });

    it('should reject non-host trying to end', async () => {
      const mockRow = createMockMeetingRow({ status: 'active' });
      mockDbFirst.mockResolvedValue(mockRow);

      await expect(service.end(testMeetingId, testUserId))
        .rejects.toThrow('Only the host can end the meeting');
    });
  });

  // ── Cancel Meeting ──────────────────────────────────────────

  describe('cancel()', () => {
    it('should cancel a scheduled meeting', async () => {
      const mockRow = createMockMeetingRow({ status: 'scheduled' });
      mockDbFirst.mockResolvedValue(mockRow);
      
      const cancelledRow = createMockMeetingRow({
        status: 'cancelled',
        ended_at: new Date().toISOString(),
      });
      mockDbReturning.mockResolvedValue([cancelledRow]);

      const meeting = await service.cancel(testMeetingId, testHostId);

      expect(meeting.status).toBe('cancelled');
    });

    it('should reject cancelling an active meeting', async () => {
      const mockRow = createMockMeetingRow({ status: 'active' });
      mockDbFirst.mockResolvedValue(mockRow);

      await expect(service.cancel(testMeetingId, testHostId))
        .rejects.toThrow('Can only cancel scheduled meetings');
    });
  });

  // ── List Meetings ───────────────────────────────────────────

  describe('listByOrganization()', () => {
    it('should return paginated meeting list', async () => {
      const mockRows = [
        createMockMeetingRow({ id: 'meeting-1' }),
        createMockMeetingRow({ id: 'meeting-2' }),
      ];
      // Mock the clone().count().first() chain
      mockDbClone.mockReturnValue({
        count: jest.fn().mockReturnValue({
          first: jest.fn().mockResolvedValue({ count: '2' }),
        }),
      });
      mockDbLimit.mockResolvedValue(mockRows);

      const result = await service.listByOrganization(testOrgId, {
        page: 1,
        limit: 10,
      });

      expect(result.total).toBe(2);
      expect(result.meetings).toHaveLength(2);
    });

    it('should filter by status', async () => {
      const mockRows = [createMockMeetingRow({ status: 'active' })];
      mockDbClone.mockReturnValue({
        count: jest.fn().mockReturnValue({
          first: jest.fn().mockResolvedValue({ count: '1' }),
        }),
      });
      mockDbLimit.mockResolvedValue(mockRows);

      const result = await service.listByOrganization(testOrgId, {
        status: 'active',
      });

      expect(result.meetings[0].status).toBe('active');
    });
  });
});
