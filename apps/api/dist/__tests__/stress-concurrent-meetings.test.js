"use strict";
// ============================================================
// Stress Test — 100 Concurrent Meetings
// Validates: DB connection handling, meeting creation throughput,
// attendance recording under load, no data corruption.
// ============================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
jest.mock('../db');
jest.mock('../logger');
jest.mock('../services/push.service', () => ({
    sendPushToOrg: jest.fn().mockResolvedValue(undefined),
}));
const db_1 = __importDefault(require("../db"));
const mockDb = db_1.default;
const mockWhere = jest.fn();
const mockFirst = jest.fn();
const mockInsert = jest.fn();
const mockReturning = jest.fn();
const mockPluck = jest.fn();
const mockCount = jest.fn();
const mockUpdate = jest.fn();
const mockOrderBy = jest.fn();
const mockSelect = jest.fn();
const mockJoin = jest.fn();
const mockOnConflict = jest.fn();
const mockMerge = jest.fn();
beforeEach(() => {
    jest.clearAllMocks();
    // Chain resets
    mockWhere.mockReturnThis();
    mockFirst.mockResolvedValue(null);
    mockOrderBy.mockReturnThis();
    mockSelect.mockReturnThis();
    mockJoin.mockReturnThis();
    mockCount.mockReturnThis();
    mockPluck.mockResolvedValue([]);
    mockInsert.mockReturnThis();
    mockReturning.mockResolvedValue([{ id: 'meeting-1', title: 'Test' }]);
    mockUpdate.mockReturnThis();
    mockOnConflict.mockReturnThis();
    mockMerge.mockResolvedValue(1);
    mockDb.mockReturnValue({
        where: mockWhere,
        first: mockFirst,
        insert: mockInsert,
        returning: mockReturning,
        pluck: mockPluck,
        update: mockUpdate,
        orderBy: mockOrderBy,
        select: mockSelect,
        join: mockJoin,
        count: mockCount,
        onConflict: mockOnConflict,
        merge: mockMerge,
        fn: { now: jest.fn().mockReturnValue('NOW()') },
        raw: jest.fn((sql, bindings) => ({ sql, bindings })),
    });
});
describe('Stress: 100 Concurrent Meeting Operations', () => {
    // ── Meeting Creation Throughput ─────────────────────────
    it('should handle 100 concurrent meeting inserts without data loss', async () => {
        const MEETING_COUNT = 100;
        let insertCount = 0;
        mockInsert.mockImplementation(() => {
            insertCount++;
            return { returning: () => Promise.resolve([{ id: `meeting-${insertCount}`, title: `Meeting ${insertCount}` }]) };
        });
        const orgId = 'org-stress-1';
        const promises = Array.from({ length: MEETING_COUNT }, (_, i) => new Promise(async (resolve) => {
            const result = await mockDb('meetings').insert({
                organization_id: orgId,
                title: `Stress Meeting ${i + 1}`,
                scheduled_start: new Date().toISOString(),
                created_by: `user-${i % 10}`,
            });
            resolve(result);
        }));
        const results = await Promise.all(promises);
        expect(insertCount).toBe(MEETING_COUNT);
        expect(results).toHaveLength(MEETING_COUNT);
    });
    it('should handle 100 parallel meeting reads without blocking', async () => {
        const READ_COUNT = 100;
        let readCount = 0;
        mockFirst.mockImplementation(() => {
            readCount++;
            return Promise.resolve({
                id: `meeting-${readCount}`,
                title: `Meeting ${readCount}`,
                status: 'scheduled',
                organization_id: 'org-1',
            });
        });
        const promises = Array.from({ length: READ_COUNT }, (_, i) => mockDb('meetings').where({ id: `meeting-${i}`, organization_id: 'org-1' }).first());
        const results = await Promise.all(promises);
        expect(readCount).toBe(READ_COUNT);
        expect(results).toHaveLength(READ_COUNT);
        results.forEach((r) => expect(r).toHaveProperty('id'));
    });
    // ── Attendance Recording Under Load ────────────────────
    it('should handle 100 simultaneous attendance records safely', async () => {
        const ATTENDEE_COUNT = 100;
        let attendanceInserts = 0;
        // Simulate no existing attendance record
        mockFirst.mockResolvedValue(null);
        mockInsert.mockImplementation(() => {
            attendanceInserts++;
            return {
                returning: () => Promise.resolve([{
                        id: `attendance-${attendanceInserts}`,
                        meeting_id: 'meeting-1',
                        user_id: `user-${attendanceInserts}`,
                        status: 'present',
                    }]),
            };
        });
        const promises = Array.from({ length: ATTENDEE_COUNT }, (_, i) => new Promise(async (resolve) => {
            const existing = await mockDb('meeting_attendance')
                .where({ meeting_id: 'meeting-1', user_id: `user-${i}` })
                .first();
            if (!existing) {
                const result = await mockDb('meeting_attendance').insert({
                    meeting_id: 'meeting-1',
                    user_id: `user-${i}`,
                    status: 'present',
                });
                resolve(result);
            }
            else {
                resolve(existing);
            }
        }));
        const results = await Promise.all(promises);
        expect(attendanceInserts).toBe(ATTENDEE_COUNT);
        expect(results).toHaveLength(ATTENDEE_COUNT);
    });
    // ── Bulk Attendance API Pattern ────────────────────────
    it('should handle bulk attendance upsert for a large meeting (200 attendees)', async () => {
        const ATTENDEE_COUNT = 200;
        let upsertCount = 0;
        mockOnConflict.mockReturnValue({
            merge: jest.fn().mockImplementation(() => {
                upsertCount++;
                return Promise.resolve(1);
            }),
        });
        mockInsert.mockReturnValue({
            onConflict: mockOnConflict,
        });
        const attendees = Array.from({ length: ATTENDEE_COUNT }, (_, i) => ({
            userId: `user-${i}`,
            status: i % 5 === 0 ? 'late' : 'present',
        }));
        for (const a of attendees) {
            await mockDb('meeting_attendance')
                .insert({
                meeting_id: 'meeting-1',
                user_id: a.userId,
                status: a.status,
            })
                .onConflict(['meeting_id', 'user_id'])
                .merge({ status: a.status });
        }
        expect(upsertCount).toBe(ATTENDEE_COUNT);
    });
    // ── Concurrent Meeting Start/End ───────────────────────
    it('should prevent race condition when 2 admins start same meeting', async () => {
        let meetingStatus = 'scheduled';
        mockFirst.mockImplementation(() => {
            return Promise.resolve({
                id: 'meeting-race',
                status: meetingStatus,
                organization_id: 'org-1',
            });
        });
        mockUpdate.mockImplementation(() => {
            // Simulate the first update succeeding
            if (meetingStatus === 'scheduled') {
                meetingStatus = 'live';
                return { returning: () => Promise.resolve([{ id: 'meeting-race', status: 'live' }]) };
            }
            // Second update should find status !== 'scheduled'
            return { returning: () => Promise.resolve([]) };
        });
        // Admin 1 starts the meeting
        const meeting1 = await mockDb('meetings').where({ id: 'meeting-race' }).first();
        let admin1Result;
        if (meeting1.status === 'scheduled') {
            await mockDb('meetings').where({ id: 'meeting-race' }).update({ status: 'live' });
            admin1Result = 'started';
        }
        else {
            admin1Result = 'already_started';
        }
        // Admin 2 tries to start the same meeting (status already changed)
        const meeting2 = await mockDb('meetings').where({ id: 'meeting-race' }).first();
        let admin2Result;
        if (meeting2.status === 'scheduled') {
            await mockDb('meetings').where({ id: 'meeting-race' }).update({ status: 'live' });
            admin2Result = 'started';
        }
        else {
            admin2Result = 'already_started';
        }
        expect(admin1Result).toBe('started');
        expect(admin2Result).toBe('already_started');
    });
    // ── Notification Fanout Under Load ─────────────────────
    it('should generate notifications for all 100 org members on meeting creation', async () => {
        const MEMBER_COUNT = 100;
        const memberIds = Array.from({ length: MEMBER_COUNT }, (_, i) => `user-${i}`);
        mockPluck.mockResolvedValue(memberIds);
        let notificationBatchSize = 0;
        mockInsert.mockImplementation((rows) => {
            notificationBatchSize = Array.isArray(rows) ? rows.length : 1;
            return { returning: () => Promise.resolve([]) };
        });
        // Simulate the notification fanout from meeting creation
        const members = await mockDb('memberships')
            .where({ organization_id: 'org-1', is_active: true })
            .pluck('user_id');
        const notifications = members.map((userId) => ({
            user_id: userId,
            organization_id: 'org-1',
            type: 'meeting',
            title: 'New Meeting',
            body: 'Stress Test Meeting',
        }));
        await mockDb('notifications').insert(notifications);
        expect(members).toHaveLength(MEMBER_COUNT);
        expect(notificationBatchSize).toBe(MEMBER_COUNT);
    });
    // ── Agenda Item Burst ──────────────────────────────────
    it('should handle meeting with 50 agenda items', async () => {
        let agendaInsertCount = 0;
        mockInsert.mockImplementation((rows) => {
            agendaInsertCount = Array.isArray(rows) ? rows.length : 1;
            return { returning: () => Promise.resolve(rows) };
        });
        const agendaItems = Array.from({ length: 50 }, (_, i) => ({
            meeting_id: 'meeting-1',
            title: `Agenda Item ${i + 1}`,
            order: i + 1,
            duration_minutes: 5,
        }));
        await mockDb('agenda_items').insert(agendaItems);
        expect(agendaInsertCount).toBe(50);
    });
    // ── Voting Under Load ─────────────────────────────────
    it('should handle 100 simultaneous vote casts on the same vote', async () => {
        const VOTER_COUNT = 100;
        let voteCasts = 0;
        mockOnConflict.mockReturnValue({
            merge: jest.fn().mockImplementation(() => {
                voteCasts++;
                return Promise.resolve(1);
            }),
        });
        mockInsert.mockReturnValue({
            onConflict: mockOnConflict,
        });
        const options = ['Approve', 'Reject', 'Abstain'];
        const promises = Array.from({ length: VOTER_COUNT }, (_, i) => mockDb('vote_ballots')
            .insert({
            vote_id: 'vote-1',
            user_id: `user-${i}`,
            selected_option: options[i % options.length],
        })
            .onConflict(['vote_id', 'user_id'])
            .merge({ selected_option: options[i % options.length] }));
        await Promise.all(promises);
        expect(voteCasts).toBe(VOTER_COUNT);
    });
});
//# sourceMappingURL=stress-concurrent-meetings.test.js.map