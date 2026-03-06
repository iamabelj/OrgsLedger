# Risk Matrix & Prioritization

## Issue Priority Map

```
               HIGH SEVERITY
                     ↑
        5 (Critical)  │  3 (Critical)
    Audio Format      │  AIService Call
    Deepgram Fails    │  Minutes Gen Fails
                     │
        6 (Critical)  │  4 (Critical)
    Language Detect   │  TranslationService
    Always Null       │  All Translations Fail
                     │
        7 (Medium)    │  8 (Medium)
    No Reconnect      │  Sequential DB
    Transcript Stops  │  300 Queries
                     │
        2 (Medium)    │  1 (Low)
    No Error CB       │  Type Safety
    Silent Fail       │  split() access
    ────────────────────────────────→ DEPLOYMENT IMPACT
        LOW            MEDIUM           HIGH
```

---

## Severity Grid

| Rank | Issue | Severity | Deployability | Fix Time | Impact |
|------|-------|----------|---------------|----------|--------|
| 1 | 5. Audio Format Conversion | 🔴 CRITICAL | ❌ Blocks | 2-4h | No transcription works |
| 2 | 3. AIService.generateMeetingMinutes() | 🔴 CRITICAL | ❌ Blocks | 30m | Minutes gen fails |
| 3 | 4. TranslationService.translate() | 🔴 CRITICAL | ❌ Blocks | 30m | Zero translations |
| 4 | 6. Language Detection Path | 🔴 CRITICAL | ❌ Blocks | 30m | Default lang only |
| 5 | 2. sendAudioChunk() Route | 🔴 CRITICAL | ❌ Blocks | 15m | Audio chunks fail |
| 6 | 7. No Stream Reconnection | 🟠 MEDIUM | ⚠️ Deploy, monitor | 1h | Transcript stops |
| 7 | 8. Sequential DB Queries | 🟠 MEDIUM | ⚠️ Deploy, monitor | 1h | 300 users slow |
| 8 | 1. Error Callback Missing | 🟡 LOW-MED | ⚠️ Deploy, monitor | 30m | Silent fails |
| 9 | 9. Nil-safe access | 🟡 LOW | ✅ Deploy | 15m | Edge case crash |
| 10 | 10. RoomClient unused | 🟡 LOW | ✅ Deploy | 0m | Code smell |

---

## Blockers vs. Warning Items

### 🔴 BLOCKERS (Must Fix Before ANY Testing)

```
[1] Audio Format: Opus → PCM 16kHz
    └─ Deepgram cannot process Opus audio
    └─ Fix required: ~2-4 hours
    └─ Test with Deepgram API validation

[2] AIService.generateMeetingMinutes()
    └─ Method doesn't exist
    └─ Fix required: Call processMinutes() instead
    └─ Time: 30 minutes

[3] TranslationService.translate()
    └─ Function doesn't exist
    └─ Fix required: Call translateText() instead
    └─ Time: 30 minutes

[4] Language Detection Path
    └─ Always returns null
    └─ Fix required: Correct response path
    └─ Time: 30 minutes (plus API validation)

[5] sendAudioChunk() Route
    └─ Method doesn't exist
    └─ Fix required: Call liveKitAudioBridgeService instead
    └─ Time: 15 minutes
```

**Total Blocker Fix Time: ~4 hours**

---

### 🟠 WARNINGS (Fix Before Production)

```
[6] No Stream Reconnection
    ├─ Risk: Transcript stops silently
    ├─ Symptom: Participant continues speaking, no error shown
    ├─ Fix: Add exponential backoff retry logic
    └─ Time: 1 hour

[7] Sequential DB Queries on Join
    ├─ Risk: Latency spikes at 100+ participants
    ├─ Symptom: Meeting join takes 2-5 seconds per person
    ├─ Fix: Batch queries or implement caching
    └─ Time: 1 hour

[8] No Error Callback to Client
    ├─ Risk: Client unaware of transcription failure
    ├─ Symptom: User thinks they're recording, they're not
    ├─ Fix: Emit socket error event on failure
    └─ Time: 30 minutes
```

**Total Warning Fix Time: ~2.5 hours**

---

## Implementation Sequence

### SEQUENCE 1: BLOCKERS (Must Do First)

**Do in this order** (each builds on previous):

```
Step 1 (15m): Fix sendAudioChunk() route
    └─ File: multilingualMeeting.socket.ts line 77
    └─ Change: meetingTranscriptHandler → liveKitAudioBridgeService
    └─ Validate: Imports correct

Step 2 (30m): Fix TranslationService.translate()
    └─ File: multilingualTranslation.service.ts line 60
    └─ Change: Add import for translateText
    └─ Validate: Function signature matches

Step 3 (30m): Fix AIService.generateMeetingMinutes()
    └─ File: multilingualMeeting.socket.ts line 195
    └─ Change: Call processMinutes() with organizationId
    └─ Validate: Meeting fetch succeeds

Step 4 (2-4h): Fix Audio Format Conversion
    └─ File: livekitAudioBridge.service.ts
    └─ Add: Opus decoder library
    └─ Implement: 48kHz → 16kHz PCM conversion
    └─ Test: With real Deepgram API

Step 5 (30m): Fix Language Detection
    └─ File: deepgramRealtime.service.ts line 207
    └─ Change: Response path to correct value
    └─ Test: Against Deepgram response samples
    └─ Validate: Returns actual languages
```

**After these steps:** System can start without errors

---

### SEQUENCE 2: WARNINGS (Before Production)

```
Step 6 (1h): Add Stream Reconnection
    └─ File: deepgramRealtime.service.ts
    └─ Add: Retry counter and backoff logic
    └─ Max retries: 3
    └─ Test: Kill connection, verify reconnect attempt

Step 7 (30m): Add Client Error Callback
    └─ File: multilingualMeeting.socket.ts line 67
    └─ Add: socket.emit('meeting:transcript:error', ...)
    └─ Test: Simulate processing failure

Step 8 (1h): Optimize DB Queries
    └─ File: multilingualMeeting.socket.ts lines 30-39
    └─ Option A: Use Promise.all() for batch
    └─ Option B: Add caching layer
    └─ Test: 100 concurrent joins
```

**After these steps:** Production-ready

---

## Risk Probability × Impact Matrix

```
                IMPACT (Severity)
                     ↑
         Low     Med     High    Critical
         │       │       │       │
    High │   8   │  6,7  │      │  5
    Prob │       │       │      │
         │       │       │      │  
    Med  │  9,10 │  1    │  3,4 │  2,3,4
         │       │       │      │
    Low  │       │       │      │  5
         │       │       │      │
         └──────────────────────────→
```

### Legend:
- **Blockers (Red):** 2,3,4,5 — Fix immediately, before any deploy
- **Warnings (Orange):** 6,7,8 — Fix before production
- **Cosmetic (Yellow):** 9,10 — Fix eventually

---

## Recommended Action Plan

### Week 1: Fixes

```
Monday:
  ├─ 9:00-10:00  → Fix 5 blocker API calls (Steps 1-3)
  ├─ 10:00-14:00 → Add audio format conversion (Step 4)  
  ├─ 14:00-15:00 → Test with Deepgram API
  └─ 15:00-16:00 → Fix language path (Step 5)

Tuesday:
  ├─ 9:00-10:00  → TypeScript compile + unit tests
  ├─ 10:00-12:00 → Add reconnection logic (Step 6)
  ├─ 12:00-13:00 → Add client error callbacks (Step 7)
  └─ 13:00-14:00 → Optimize DB queries (Step 8)

Wednesday-Friday: Integration Testing
  ├─ Real Deepgram API tests
  ├─ Real translation service tests  
  ├─ Load testing (50, 100, 300 participants)
  ├─ Latency measurements
  └─ Memory profiling
```

---

## Quality Gates

### ✅ Ready for Testing When:
- [ ] All 5 blockers fixed
- [ ] TypeScript compiles without errors
- [ ] Deepgram API call validates (authentication works)
- [ ] Audio format test passes (Opus → PCM verified)
- [ ] TranslationService integration passes
- [ ] AIService integration passes

### ✅ Ready for Production Deploy When:
- [ ] All blockers + warnings fixed
- [ ] Integration tests pass (real APIs)
- [ ] Load test passes (300 concurrent)
- [ ] Latency < 1.5s (measured)
- [ ] Memory stable < 100MB (300 participants)
- [ ] Zero crashes in 24h monitoring
- [ ] Error recovery working (reconnection verified)
- [ ] Security audit passed

---

## Rollback Plan

If critical issues discovered after deploy:

```
Immediate Rollback (< 5 min):
1. SSH to VPS
2. git revert HEAD
3. npm install
4. pm2 restart orgsledger

Effect: Removes all multilingual features
Result: System reverts to previous state (Google STT only)
Impact: Users see transcript disabled, meetings continue normally
```

---

## Success Criteria

| Criterion | Target | Measurement |
|-----------|--------|-------------|
| All blockers fixed | 100% | Code review checklist |
| TypeScript errors | 0 | `npm run build` clean |
| Unit test pass rate | 100% | `npm test` green |
| Integration tests pass | 100% | Real API calls work |
| Load test (300 users) | Pass | No crashes, < 150MB memory |
| Latency (speech → broadcast) | < 1.5s | Measured with timer |
| Error recovery | Working | Simulated failure test |
| Backward compatibility | 100% | Old clients still work |

---

## Sign-Off

Once all items checked and gates passed, team can approve for production deployment.

**Current Status:** ❌ BLOCKED — 5 critical issues prevent deployment  
**Estimated Fix Time:** 4-6 hours (blockers + warnings)  
**Estimated Testing Time:** 8-12 hours (integration + load)  
**Total Time to Production:** 12-18 hours

---

**Generated:** March 5, 2026  
**Status:** Audit Complete  
**Next Step:** Apply blocker fixes

