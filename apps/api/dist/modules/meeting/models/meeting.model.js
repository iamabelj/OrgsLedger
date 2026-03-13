"use strict";
// ============================================================
// OrgsLedger API — Meeting Model
// Type definitions for meeting entities
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.meetingFromRow = meetingFromRow;
exports.meetingToRow = meetingToRow;
/**
 * Convert database row to Meeting entity
 */
function meetingFromRow(row) {
    return {
        id: row.id,
        organizationId: row.organization_id,
        hostId: row.host_id,
        title: row.title,
        description: row.description,
        status: row.status,
        participants: typeof row.participants === 'string'
            ? JSON.parse(row.participants)
            : row.participants,
        settings: typeof row.settings === 'string'
            ? JSON.parse(row.settings)
            : row.settings,
        scheduledAt: row.scheduled_at,
        startedAt: row.started_at,
        endedAt: row.ended_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
/**
 * Convert Meeting entity to database row format
 */
function meetingToRow(meeting) {
    const row = {};
    if (meeting.id !== undefined)
        row.id = meeting.id;
    if (meeting.organizationId !== undefined)
        row.organization_id = meeting.organizationId;
    if (meeting.hostId !== undefined)
        row.host_id = meeting.hostId;
    if (meeting.title !== undefined)
        row.title = meeting.title;
    if (meeting.description !== undefined)
        row.description = meeting.description;
    if (meeting.status !== undefined)
        row.status = meeting.status;
    if (meeting.participants !== undefined) {
        row.participants = JSON.stringify(meeting.participants);
    }
    if (meeting.settings !== undefined) {
        row.settings = JSON.stringify(meeting.settings);
    }
    if (meeting.scheduledAt !== undefined)
        row.scheduled_at = meeting.scheduledAt;
    if (meeting.startedAt !== undefined)
        row.started_at = meeting.startedAt;
    if (meeting.endedAt !== undefined)
        row.ended_at = meeting.endedAt;
    return row;
}
//# sourceMappingURL=meeting.model.js.map