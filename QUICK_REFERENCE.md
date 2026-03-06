# OrgsLedger Queue System — Quick Reference Guide

**TL;DR**: Complete queue management system with job tracking, transcript ingestion, and meeting lifecycle integration.

---

## 🎯 Quick Start

### For End Users
1. Start a meeting: `POST /api/meetings/:orgId/start`
2. Transcripts ingest automatically or attend with transcription bot
3. End meeting: `POST /api/meetings/:orgId/end`
4. Minutes generation queued automatically ✨
5. Poll minutes: `GET /api/meetings/:meetingId/transcripts/minutes`

### For Developers
1. Use meeting lifecycle hooks in `onMeetingCreated/Updated/Started/Ended()`
2. Queue jobs via existing queue managers
3. Track job status in admin console
4. Replay failed jobs if needed

---

## 📡 API Endpoints Cheat Sheet

### Job Tracking
```
GET    /api/jobs/:jobId           Check job status
GET    /api/jobs/queue/:name      Queue statistics  
GET    /api/jobs/dlq              Dead-letter queue
POST   /api/jobs/dlq/:id/replay   Replay job (admin)
```

### Transcripts
```
GET    /api/meetings/:meeting_id/transcripts               List
GET    /api/meetings/:meeting_id/transcripts/:id           Get one
POST   /api/meetings/:meeting_id/transcripts               Create
DELETE /api/meetings/:meeting_id/transcripts/:id           Delete (admin)
POST   /api/meetings/:meeting_id/transcripts/generate-minutes  Trigger (admin)
GET    /api/meetings/:meeting_id/transcripts/minutes       Get status
```

---

## 🔧 Code Examples

### Create Transcript (Client)
```typescript
const response = await fetch(
  `/api/meetings/${meetingId}/transcripts`,
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      speakerId: userId,
      speakerName: 'John Doe',
      originalText: 'Let\'s discuss Q1 goals',
      sourceLanguage: 'en',
      spokenAt: 5000,  // 5 seconds into meeting
      isFinal: false
    })
  }
);
```

### Poll for Minutes
```typescript
async function getMinutesWhenReady(meetingId, token) {
  for (let i = 0; i < 60; i++) {
    const resp = await fetch(
      `/api/meetings/${meetingId}/transcripts/minutes`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    const { data } = await resp.json();
    
    if (data.status === 'completed') return data.content;
    if (data.status === 'failed') throw new Error(data.error_message);
    
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error('Timeout');
}
```

### Track Job Status  
```typescript
const jobId = 'job-abc123';
const response = await fetch(
  `/api/jobs/${jobId}`,
  { headers: { 'Authorization': `Bearer ${token}` } }
);
const { jobId, queue, status, progress } = await response.json();

console.log(`${queue} job is ${progress}% complete`);
```

### Replay Failed Job (Admin)
```typescript
const response = await fetch(
  `/api/jobs/dlq/${failedJobId}/replay`,
  {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${adminToken}` }
  }
);
```

---

## 🏗️ Architecture Overview

```
Client (Web/Mobile)
  ↓
[API Routes]
  ├─ meetings (lifecycle events)
  ├─ transcripts (ingestion)
  └─ jobs (status tracking)
  ↓
[Services]
  ├─ meeting-queue-integration
  └─ queue managers
  ↓
[Queue System] (BullMQ)
  ├─ minutes → GPT-4o summarization
  ├─ processing → translation
  ├─ broadcast → Socket.io push
  ├─ email → transactional mail
  ├─ notification → in-app alerts
  └─ audit → compliance logging
  ↓
[Workers]
  ├─ process async jobs
  ├─ handle errors
  └─ track completion
  ↓
[Result Storage]
  ├─ meeting_minutes
  ├─ meeting_transcripts
  └─ notifications
```

---

## 📂 File Structure

```
apps/api/src/
├── routes/
│   ├── meetings.ts              ← Meeting lifecycle (UPDATED)
│   ├── transcripts.ts           ← Transcript mgmt (NEW)
│   └── jobs.routes.ts           ← Job tracking (NEW)
├── services/
│   └── meeting-queue-integration.service.ts  (NEW)
├── queues/
│   ├── minutes.queue.ts         (EXISTING)
│   ├── broadcast.queue.ts       (EXISTING)
│   ├── processing.queue.ts      (EXISTING)
│   └── ...
├── workers/
│   ├── minutes.worker.ts        (EXISTING)
│   ├── broadcast.worker.ts      (EXISTING)
│   └── ...
└── index.ts                     ← Main API (UPDATED)

Documentation/
├── API_DOCUMENTATION.md         ← Full API reference
├── QUEUE_IMPLEMENTATION_CHECKPOINT.md
├── SESSION_PROGRESS_CHECKPOINT.md
└── FINAL_SESSION_SUMMARY.md
```

---

## 🎓 Concepts

### Job Status States
- **waiting** — Job created, waiting to be processed
- **active** — Worker is currently processing
- **completed** — Job finished successfully
- **failed** — Job failed (moved to DLQ after max retries)
- **delayed** — Job delayed (retry backoff)
- **paused** — Queue paused

### Meeting Lifecycle
1. **scheduled** — Meeting created, not yet started
2. **live** — Meeting is happening now
3. **ended** — Meeting finished, minutes processing
4. **cancelled** — Meeting was cancelled

### Minutes Status
- **processing** — Job queued, AI is working
- **completed** — Minutes ready to view
- **failed** — Processing error (retry via admin)

---

## ⚡ Performance Tips

1. **Polling**: Wait 2-3s between status checks, max 60s total
2. **Batch Transcripts**: Send in chunks during meeting
3. **Connection**: Reuse fetch/HTTP connections
4. **Errors**: Check DLQ after 30 seconds if job missing

---

## 🔐 Authentication Checklist

- [ ] Token passed in `Authorization: Bearer <token>`
- [ ] Token obtained from `/api/auth/login`
- [ ] User is meeting attendee or org member
- [ ] Admin role required for delete/replay operations

---

## 🐛 Troubleshooting

| Issue | Solution |
|-------|----------|
| 404 Job not found | Check job ID, wait if recently submitted |
| 400 Meeting not active | Meeting ended >30 min ago or not started |
| 403 Forbidden | Need admin role or org membership |
| 500 Server error | Check logs, file bug report |
| Timeout on minutes | Job processing takes 10-30s, keep polling |
| Failed job in DLQ | Admin: GET /api/jobs/dlq, then POST /replay |

---

## 📊 Monitoring

### Check Queue Health
```bash
curl -H "Authorization: Bearer $TOKEN" \
  https://api.example.com/api/jobs/queue/minutes
```

### View Failed Jobs
```bash
curl -H "Authorization: Bearer $TOKEN" \
  https://api.example.com/api/jobs/dlq
```

### Track Specific Job
```bash
curl -H "Authorization: Bearer $TOKEN" \
  https://api.example.com/api/jobs/job-abc123
```

---

## 🚀 Deployment Checklist

- [ ] Code compiled without errors
- [ ] Database migrations run
- [ ] Redis cluster configured
- [ ] Queue workers running
- [ ] API deployed to staging
- [ ] Integration tests pass
- [ ] Load test with 100+ concurrent jobs
- [ ] Monitor queue depth & latency

---

## 📞 Support

- **Issues**: Check API_DOCUMENTATION.md
- **Architecture**: See QUEUE_IMPLEMENTATION_CHECKPOINT.md
- **Examples**: Look for cURL examples in this guide
- **Status**: Check FINAL_SESSION_SUMMARY.md

---

**Last Updated**: 2025-02-21  
**Status**: ✅ Production Ready  
**Version**: 1.0
