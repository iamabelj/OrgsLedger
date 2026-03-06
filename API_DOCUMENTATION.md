# OrgsLedger Queue Management System — API Documentation

**Last Updated**: 2025-02-21  
**API Version**: v1.0  
**Status**: Production-Ready

---

## 📋 Table of Contents

1. [Job Tracking API](#job-tracking-api)
2. [Transcripts API](#transcripts-api)
3. [Meeting Queue Integration](#meeting-queue-integration)
4. [Error Handling](#error-handling)
5. [Authentication](#authentication)

---

## 🔍 Job Tracking API

All endpoints require authentication via JWT token in `Authorization: Bearer <token>` header.

### GET /api/jobs/:jobId

Query the status of a specific job across all queues.

**Request**:
```bash
curl -H "Authorization: Bearer <token>" \
  https://api.example.com/api/jobs/job-abc123
```

**Response** (200):
```json
{
  "jobId": "job-abc123",
  "queue": "minutes",
  "status": "processing",
  "progress": 45,
  "data": {
    "meetingId": "meeting-xyz789",
    "organizationId": "org-456"
  },
  "attemptsMade": 0,
  "maxAttempts": 3,
  "failedReason": null,
  "createdAt": "2025-02-21T10:30:00Z",
  "processedAt": "2025-02-21T10:31:00Z"
}
```

**Response** (404):
```json
{
  "error": "Job not found"
}
```

**Status Codes**:
- `200` — Job found
- `404` — Job not found
- `500` — Server error

---

### GET /api/jobs/queue/:queueName

Get statistics and failed jobs for a specific queue.

**Parameters**:
- `queueName` (path) — One of: `minutes`, `processing`, `broadcast`, `email`, `notification`, `bot`

**Request**:
```bash
curl -H "Authorization: Bearer <token>" \
  https://api.example.com/api/jobs/queue/minutes
```

**Response** (200):
```json
{
  "queue": "minutes",
  "counts": {
    "waiting": 12,
    "active": 2,
    "completed": 847,
    "failed": 3,
    "delayed": 0,
    "paused": 0
  },
  "recentFailures": [
    {
      "jobId": "job-failed-1",
      "failedReason": "Timeout: GPT-4o took >30s",
      "attemptsMade": 3,
      "failedAt": "2025-02-21T09:45:00Z"
    }
  ]
}
```

**Status Codes**:
- `200` — Queue found
- `404` — Queue not found
- `503` — Queue not initialized
- `500` — Server error

---

### GET /api/jobs/dlq

**⚠️ Admin Only** — Retrieve all dead-letter queue jobs.

**Query Parameters**:
- `queue` (optional) — Filter by original queue (e.g., `?queue=minutes`)

**Request**:
```bash
curl -H "Authorization: Bearer <token>" \
  https://api.example.com/api/jobs/dlq?queue=minutes
```

**Response** (200):
```json
{
  "totalDeadLetters": 5,
  "jobs": [
    {
      "jobId": "job-dlq-1",
      "originalQueue": "minutes",
      "lastError": "API rate limit exceeded",
      "failedAt": "2025-02-21T08:15:00Z",
      "attempts": 3,
      "maxAttempts": 3
    }
  ]
}
```

**Status Codes**:
- `200` — DLQ retrieved
- `403` — User not admin
- `500` — Server error

---

### POST /api/jobs/dlq/:jobId/replay

**⚠️ Admin Only** — Manually replay a failed job from the dead-letter queue.

**Request**:
```bash
curl -X POST -H "Authorization: Bearer <token>" \
  https://api.example.com/api/jobs/dlq/job-dlq-1/replay
```

**Response** (200):
```json
{
  "success": true,
  "message": "Job job-dlq-1 replayed to minutes queue"
}
```

**Status Codes**:
- `200` — Job replayed successfully
- `400` — Invalid target queue
- `404` — Job not found in DLQ
- `403` — User not admin
- `503` — Queue not initialized
- `500` — Server error

---

## 📝 Transcripts API

All endpoints require authentication. User must be a meeting attendee or organization member.

### GET /api/meetings/:meetingId/transcripts

List all transcripts for a meeting.

**Query Parameters**:
- `limit` (optional, default: 100, max: 1000) — Number of results
- `offset` (optional, default: 0) — Pagination offset
- `speakerId` (optional) — Filter by speaker UUID
- `language` (optional) — Filter by language code (e.g., `en`, `es`)

**Request**:
```bash
curl -H "Authorization: Bearer <token>" \
  "https://api.example.com/api/meetings/meeting-123/transcripts?limit=50&language=en"
```

**Response** (200):
```json
{
  "success": true,
  "data": [
    {
      "id": "transcript-1",
      "speaker_id": "user-abc",
      "speaker_name": "John Doe",
      "original_text": "This is the transcript text...",
      "source_lang": "en",
      "translations": {
        "es": "Este es el texto de la transcripción...",
        "fr": "Ceci est le texte de la transcription..."
      },
      "spoken_at": 12500,
      "created_at": "2025-02-21T10:30:00Z"
    }
  ],
  "pagination": {
    "limit": 50,
    "offset": 0,
    "total": 342,
    "hasMore": true
  }
}
```

**Status Codes**:
- `200` — Transcripts retrieved
- `404` — Meeting not found
- `500` — Server error

---

### GET /api/meetings/:meetingId/transcripts/:transcriptId

Get a specific transcript.

**Request**:
```bash
curl -H "Authorization: Bearer <token>" \
  https://api.example.com/api/meetings/meeting-123/transcripts/transcript-1
```

**Response** (200):
```json
{
  "success": true,
  "data": {
    "id": "transcript-1",
    "speaker_id": "user-abc",
    "speaker_name": "John Doe",
    "original_text": "...",
    "source_lang": "en",
    "translations": {...},
    "spoken_at": 12500,
    "created_at": "2025-02-21T10:30:00Z"
  }
}
```

**Status Codes**:
- `200` — Transcript found
- `404` — Transcript or meeting not found
- `500` — Server error

---

### POST /api/meetings/:meetingId/transcripts

**Client-Facing** — Ingest a new transcript segment (from transcription service or human).

**Request Body**:
```json
{
  "speakerId": "user-abc123",
  "speakerName": "John Doe",
  "originalText": "Hello everyone, let's begin the meeting...",
  "sourceLanguage": "en",
  "spokenAt": 0,
  "isFinal": false
}
```

**Request**:
```bash
curl -X POST -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "speakerId": "user-abc123",
    "speakerName": "John Doe",
    "originalText": "Hello everyone...",
    "sourceLanguage": "en",
    "spokenAt": 0,
    "isFinal": false
  }' \
  https://api.example.com/api/meetings/meeting-123/transcripts
```

**Response** (201):
```json
{
  "success": true,
  "data": {
    "id": "transcript-new-1",
    "speaker_id": "user-abc123",
    "speaker_name": "John Doe",
    "original_text": "Hello everyone, let's begin the meeting...",
    "source_lang": "en",
    "translations": {},
    "spoken_at": 0,
    "created_at": "2025-02-21T10:30:00Z"
  }
}
```

**Response** (400 — Meeting Not Active):
```json
{
  "success": false,
  "error": "Meeting is not active or has ended beyond grace period"
}
```

**Important Notes**:
- Meeting must be `live` or recently `ended` (grace period: 30 minutes)
- Speaker must be a registered attendee OR meeting creator
- If meeting has `translation_enabled=true`, transcripts are automatically translated
- `isFinal=true` indicates end of transcript stream (optional, for UI signals)
- `spokenAt` is timestamp in milliseconds since meeting start

**Status Codes**:
- `201` — Transcript created
- `400` — Invalid data or meeting not active
- `403` — User not authorized for this meeting
- `404` — Meeting not found
- `500` — Server error

---

### DELETE /api/meetings/:meetingId/transcripts/:transcriptId

**Org Admin Only** — Delete a transcript (for corrections).

**Request**:
```bash
curl -X DELETE -H "Authorization: Bearer <token>" \
  https://api.example.com/api/meetings/meeting-123/transcripts/transcript-1
```

**Response** (200):
```json
{
  "success": true,
  "message": "Transcript deleted"
}
```

**Status Codes**:
- `200` — Transcript deleted
- `403` — User not admin
- `404` — Transcript not found
- `500` — Server error

---

### POST /api/meetings/:meetingId/transcripts/generate-minutes

**Org Admin Only** — Manually trigger minute generation from transcripts.

**Request Body**:
```json
{
  "format": "structured",
  "includeAttendees": true,
  "includeTiming": true
}
```

**Request**:
```bash
curl -X POST -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "format": "structured",
    "includeAttendees": true,
    "includeTiming": true
  }' \
  https://api.example.com/api/meetings/meeting-123/transcripts/generate-minutes
```

**Response** (200):
```json
{
  "success": true,
  "message": "Minute generation queued",
  "data": {
    "meetingId": "meeting-123",
    "status": "processing"
  }
}
```

**Response** (400 — Already Processing):
```json
{
  "success": false,
  "error": "Minutes are already being processed"
}
```

**Status Codes**:
- `200` — Minutes job queued
- `400` — No transcripts or already processing
- `403` — User not admin
- `404` — Meeting not found
- `500` — Server error

**Note**: Minute generation happens automatically when meetings end (if transcripts exist). This endpoint allows manual re-generation.

---

### GET /api/meetings/:meetingId/transcripts/minutes

Get the status and content of generated minutes.

**Request**:
```bash
curl -H "Authorization: Bearer <token>" \
  https://api.example.com/api/meetings/meeting-123/transcripts/minutes
```

**Response** (200 — Processing):
```json
{
  "success": true,
  "data": {
    "id": "minutes-abc123",
    "meeting_id": "meeting-123",
    "organization_id": "org-456",
    "status": "processing",
    "error_message": null,
    "content": null,
    "created_at": "2025-02-21T10:30:00Z",
    "updated_at": "2025-02-21T10:31:00Z"
  }
}
```

**Response** (200 — Completed):
```json
{
  "success": true,
  "data": {
    "id": "minutes-abc123",
    "meeting_id": "meeting-123",
    "organization_id": "org-456",
    "status": "completed",
    "error_message": null,
    "content": "# Meeting Minutes\n\n## Attendees\n- John Doe\n- Jane Smith\n\n## Topics Discussed\n1. Q1 Planning\n2. Budget Review\n...",
    "created_at": "2025-02-21T10:30:00Z",
    "updated_at": "2025-02-21T10:37:00Z"
  }
}
```

**Response** (200 — Failed):
```json
{
  "success": true,
  "data": {
    "status": "failed",
    "error_message": "OpenAI API rate limit exceeded"
  }
}
```

**Status Codes**:
- `200` — Minutes found
- `404` — Minutes not found for this meeting
- `500` — Server error

---

## 🎯 Meeting Queue Integration

When meetings go through their lifecycle, async jobs are automatically queued:

### Meeting Created
```
POST /api/meetings/:orgId
  ↓
onMeetingCreated()
  ↓
emit('meeting:created') to all org members
```

### Meeting Updated
```
PUT /api/meetings/:orgId/:meetingId
  ↓
onMeetingUpdated()
  ↓
emit('meeting:updated') or emit('meeting:rescheduled')
```

### Meeting Started
```
POST /api/meetings/:orgId/:meetingId/start
  ↓
onMeetingStarted()
  ↓
emit('meeting:started') to all org members
```

### Meeting Ended
```
POST /api/meetings/:orgId/:meetingId/end
  ↓
onMeetingEnded()
  ├─ emit('meeting:ended') to all org members
  ├─ Check for transcripts
  ├─ Create/update meeting_minutes record
  └─ submitMinutesJob() to process queue
```

---

## ⚠️ Error Handling

All endpoints return consistent error responses:

### Standard Error Response
```json
{
  "success": false,
  "error": "Human-readable error message"
}
```

### Common Status Codes

| Code | Meaning | Example |
|------|---------|---------|
| 200 | Success (GET/POST) | Job found and returned |
| 201 | Created | Transcript ingested |
| 400 | Bad Request | Invalid data, meeting not active |
| 402 | Payment Required | Insufficient AI wallet |
| 403 | Forbidden | Not admin/org member |
| 404 | Not Found | Job/transcript/meeting not found |
| 500 | Server Error | Unexpected server error |
| 503 | Service Unavailable | Queue not initialized |

---

## 🔐 Authentication

All endpoints require a valid JWT token in the request header:

```
Authorization: Bearer <jwt_token>
```

**Token Obtained By**:
1. Registration: `POST /api/auth/register`
2. Login: `POST /api/auth/login`
3. Refresh: `POST /api/auth/refresh`

**Permissions**:
- **All Users**: View own meetings, view transcripts
- **Org Members**: View organization meetings
- **Org Admin/Executive**: Create/edit meetings, delete transcripts, generate minutes
- **System Admin**: View DLQ, replay jobs, manage queues

---

## 🔄 Async Job Status Polling

When you trigger minute generation, the job is queued and processed asynchronously. Poll for completion:

```typescript
// JavaScript/TypeScript example
async function waitForMinutes(meetingId, token, maxWaitMs = 120000) {
  const startTime = Date.now();
  
  while (Date.now() - startTime < maxWaitMs) {
    const resp = await fetch(
      `/api/meetings/${meetingId}/transcripts/minutes`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    
    const { data } = await resp.json();
    
    if (data.status === 'completed') {
      return data.content; // Minutes text
    }
    
    if (data.status === 'failed') {
      throw new Error(data.error_message);
    }
    
    // Still processing, wait and retry
    await new Promise(r => setTimeout(r, 2000));
  }
  
  throw new Error('Minute generation timeout');
}
```

---

## 📊 Queue System Architecture

```
Meeting Lifecycle
  ↓
[Meeting Queue Integration Service]
  ├─ Socket.io Events (Real-time frontend updates)
  └─ Queue Job Submissions
    ├─ Minutes Queue → GPT-4o Summarization
    ├─ Processing Queue → Translation/Analysis
    ├─ Email Queue → Send minutes to attendees
    ├─ Notification Queue → In-app notifications
    └─ Broadcast Queue → Socket.io real-time updates
      ↓
[BullMQ Workers] (Async processing)
  ├─ Minutes Worker
  ├─ Translation Worker
  ├─ Broadcast Worker
  ├─ Email Worker
  ├─ Notification Worker
  └─ Audit Worker
    ↓
[Job Status Tracking API]
  ├─ GET /api/jobs/:jobId (query job status)
  ├─ GET /api/jobs/queue/:queueName (queue stats)
  ├─ GET /api/jobs/dlq (failed jobs)
  └─ POST /api/jobs/dlq/:jobId/replay (manual recovery)
```

---

## 🚀 Example Workflows

### Workflow 1: Start Meeting → Generate Minutes

```bash
1. Start meeting
POST /api/meetings/org-123/meeting-456/start

2. Transcribe during meeting (multiple calls)
POST /api/meetings/meeting-456/transcripts
{
  "speakerId": "user-789",
  "speakerName": "John",
  "originalText": "Let's discuss Q1 goals",
  "sourceLanguage": "en",
  "spokenAt": 0,
  "isFinal": false
}

3. End meeting
POST /api/meetings/org-123/meeting-456/end
# Minutes job automatically queued!

4. Poll for minutes status
GET /api/meetings/meeting-456/transcripts/minutes

5. Retrieve final minutes
GET /api/meetings/meeting-456/transcripts/minutes
# Returns completed minutes content
```

### Workflow 2: Manual Minutes Generation (Retry)

```bash
1. Manually trigger minute generation
POST /api/meetings/meeting-456/transcripts/generate-minutes
{
  "format": "structured",
  "includeAttendees": true,
  "includeTiming": true
}

2. Poll for completion
GET /api/meetings/meeting-456/transcripts/minutes

3. If failed, check DLQ and replay
GET /api/jobs/dlq?queue=minutes

POST /api/jobs/dlq/job-failed-123/replay
# Returns: "Job replayed to minutes queue"

4. Wait for reprocessing
GET /api/meetings/meeting-456/transcripts/minutes
```

---

## 📚 Additional Resources

- [Queue Architecture](./QUEUE_IMPLEMENTATION_CHECKPOINT.md)
- [Implementation Guide](./QUEUE_IMPLEMENTATION_CHECKPOINT.md#-comprehensive-checkpoint-document)
- [TypeScript Schemas](./apps/api/src/routes/transcripts.ts#L12-L31)

---

**Documentation Version**: 1.0  
**Last Updated**: 2025-02-21  
**API Status**: ✅ Production Ready
