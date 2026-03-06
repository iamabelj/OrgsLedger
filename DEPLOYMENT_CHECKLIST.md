# Checklist: Multilingual Meeting Pipeline Configuration

## Quick Setup (Est. Time: 15 minutes)

### Pre-Integration (5 min)

- [ ] **Get Deepgram API Key**
  - Visit: https://console.deepgram.com
  - Sign up or log in
  - Generate API key from dashboard
  - Copy key to clipboard

- [ ] **Verify Environment Setup**
  - [ ] Node.js 16+ installed (`node --version`)
  - [ ] npm 8+ installed (`npm --version`)
  - [ ] Location: `c:\Users\Globull\Desktop\OrgsLedger`

### Step 1: Install Dependencies (3 min)

```powershell
cd c:\Users\Globull\Desktop\OrgsLedger\apps\api
npm install
npm install @deepgram/sdk
```

**Verify:**
```powershell
npm list @deepgram/sdk
```
Expected output: `@deepgram/sdk@3.x.x`

- [ ] Deepgram SDK installed successfully

### Step 2: Configure Environment Variables (2 min)

Edit: `apps/api/.env`

Add/Update:
```
DEEPGRAM_API_KEY=sk_live_xxxxxxxxxxxxxxxxxxxxxx
```

**Optional (for production emails):**
```
SMTP_USER=your_email@provider.com
SMTP_PASS=your_app_password
```

- [ ] DEEPGRAM_API_KEY added to .env
- [ ] File saved

### Step 3: Integrate Socket.IO Handlers (3 min)

Edit: `apps/api/src/socket.ts`

Find the `setupSocketIO` function and add this import at the top:

```typescript
import { registerMultilingualMeetingHandlers } from './services/multilingualMeeting.socket';
```

Inside the `io.on('connection', ...)` block, add:

```typescript
// Register multilingual meeting handlers
registerMultilingualMeetingHandlers(io, socket);
```

Example:
```typescript
io.on('connection', (socket: Socket) => {
  // ... existing handlers ...
  
  // Register multilingual meeting handlers
  registerMultilingualMeetingHandlers(io, socket);
});
```

- [ ] Import statement added
- [ ] registerMultilingualMeetingHandlers call added
- [ ] socket.ts file saved
- [ ] No syntax errors (check Problems panel)

### Step 4: Test Installation (2 min)

```powershell
cd c:\Users\Globull\Desktop\OrgsLedger\apps\api
npm run build
```

Expected result: No errors

- [ ] TypeScript compilation successful
- [ ] No type errors in multilingual services

## Integration Verification (Est. Time: 10 minutes)

### Verify File Creation

All 6 files should exist:

```powershell
# Check from workspace root:
ls apps/api/src/services/deepgramRealtime.service.ts
ls apps/api/src/services/livekitAudioBridge.service.ts
ls apps/api/src/services/multilingualTranslation.service.ts
ls apps/api/src/services/meetingTranscript.handler.ts
ls apps/api/src/services/multilingualMeeting.socket.ts
ls scripts/test-multilingual-meeting.ts
```

- [ ] deepgramRealtime.service.ts exists
- [ ] livekitAudioBridge.service.ts exists
- [ ] multilingualTranslation.service.ts exists
- [ ] meetingTranscript.handler.ts exists
- [ ] multilingualMeeting.socket.ts exists
- [ ] test-multilingual-meeting.ts exists

### Run Test Suite

```powershell
cd c:\Users\Globull\Desktop\OrgsLedger\apps\api
npx ts-node ../../scripts/test-multilingual-meeting.ts
```

Expected output:
```
========================================
Multilingual Meeting Pipeline Test
========================================
...
Total Tests: 4
✅ Passed: 4
Success Rate: 100%
```

- [ ] Test script runs without errors
- [ ] All 4 language tests pass
- [ ] Translation pipeline working correctly

### Start API Server

```powershell
cd c:\Users\Globull\Desktop\OrgsLedger\apps\api
npm start
```

Expected logs:
```
[INFO] Socket.IO server initialized
[INFO] Multilingual handlers registered
[INFO] Deepgram service ready
```

Check console for errors:

- [ ] Server starts without errors
- [ ] No "undefined" or "cannot find module" errors
- [ ] Socket.IO logs show handlers registered

## Database Verification (Est. Time: 5 minutes)

### Check Required Tables

```sql
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('meeting_transcripts', 'user_language_preferences', 'meeting_minutes');
```

- [ ] meeting_transcripts table exists
- [ ] user_language_preferences table exists
- [ ] meeting_minutes table exists

### Verify Table Structure

```sql
-- meeting_transcripts columns
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'meeting_transcripts';

-- Should have: id, meeting_id, speaker_id, speaker_name, original_text, language, confidence, created_at
```

- [ ] All required columns present
- [ ] Table supports new language column

## Production Readiness Checklist

### Code Quality

- [ ] TypeScript compilation passes (`npm run build`)
- [ ] No console warns or errors on startup
- [ ] Deepgram model: nova-2-general verified in deepgramRealtime.service.ts
- [ ] Error handling implemented (check service logs on failure)
- [ ] Winston logger integration verified

### Configuration

- [ ] DEEPGRAM_API_KEY set and validated
- [ ] LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET configured (exists already)
- [ ] Translation service API keys available (Google or OpenAI)
- [ ] Database connection string verified
- [ ] Socket.IO CORS configured for client domain

### Performance

- [ ] Translation cache LRU implementation verified
- [ ] One-stream-per-speaker model confirmed
- [ ] Deepgram batch size: 1024 bytes verified
- [ ] Socket broadcast tested with 5+ clients
- [ ] Database query performance validated

### Security

- [ ] JWT verification on Socket.IO events working
- [ ] Meeting membership validation in registerMultilingualMeetingHandlers
- [ ] Deepgram API key not logged in console
- [ ] Transcript access control verified
- [ ] User language preferences isolated by user

### Monitoring

- [ ] Winston logs configured for multilingual events
- [ ] Health check endpoint responding
- [ ] Active transcript count tracked
- [ ] Translation cache hit rate monitored
- [ ] Error metrics captured

## Deployment Checklist

### Before Deployment

- [ ] All pre-integration steps complete
- [ ] Code compiles successfully
- [ ] Local tests passing
- [ ] Git status clean (`git status`)

### Deployment Steps

```powershell
# From workspace root
cd c:\Users\Globull\Desktop\OrgsLedger

# Verify everything
npm run build

# Commit changes
git add apps/api/src/services/deepgramRealtime.service.ts
git add apps/api/src/services/livekitAudioBridge.service.ts
git add apps/api/src/services/multilingualTranslation.service.ts
git add apps/api/src/services/meetingTranscript.handler.ts
git add apps/api/src/services/multilingualMeeting.socket.ts
git add scripts/test-multilingual-meeting.ts
git add apps/api/.env  # If updating DEEPGRAM_API_KEY
git commit -m "feat: add multilingual meeting pipeline with Deepgram STT"

# Push to GitHub
git push origin main
```

- [ ] Changes committed
- [ ] Commit message clear
- [ ] Pushed to GitHub

### VPS Deployment

```bash
# SSH to VPS
ssh user@your-vps-ip

# Navigate to app
cd /opt/orgsledger

# Pull latest
git pull origin main

# Install new dependencies
npm install

# Restart API
pm2 restart orgsledger

# Verify
pm2 logs orgsledger | grep -E "(Deepgram|multilingual|transcript)"
```

- [ ] Git pull successful
- [ ] Dependencies installed
- [ ] Server restarted
- [ ] No errors in logs

## Post-Deployment Verification (Est. Time: 15 minutes)

### Test with Real Meeting

1. Start a meeting in the app
2. Add 2+ participants
3. Enable meeting transcript
4. Speak test phrase: "Hello, this is a test meeting."
5. Verify:

- [ ] Transcript initiated (Socket event received)
- [ ] Real-time subtitles appear (translation:interim)
- [ ] Final transcript stored (transcript:stored event)
- [ ] Language auto-detected correctly
- [ ] Translations appear in participant languages
- [ ] No server errors in logs

### Verify Database Recording

```sql
-- Check recent transcripts
SELECT * FROM meeting_transcripts 
ORDER BY created_at DESC 
LIMIT 5;
```

Expected columns populated:
- meeting_id: ✅
- speaker_id: ✅
- speaker_name: ✅
- original_text: ✅
- language: ✅ (auto-detected)
- confidence: ✅
- created_at: ✅

- [ ] Transcripts appearing in database
- [ ] Language field populated (not NULL)
- [ ] Confidence scores recorded

### Test Multilingual Features

In meeting with 2 speakers (different languages):

- [ ] Speaker 1 speaks in French → detected as French
- [ ] Speaker 2 speaks in German → detected as German
- [ ] Translations broadcast to other languages
- [ ] Translation cache working (check logs for cache hits)

### Monitor Performance

```powershell
# SSH to VPS and check metrics
tail -f /opt/orgsledger/logs/app.log | grep -E "(Deepgram|cache|stream)"
```

Expected patterns:
```
[INFO] Created Deepgram stream stream_uuid_1
[DEBUG] Cache hit: 5 (text_hash_1 -> en)
[DEBUG] Translation completed: 320ms latency
[INFO] Transcript stored: meeting_id_1 - speaker_1
```

- [ ] Deepgram streams created successfully
- [ ] Translation cache showing hits
- [ ] Latency under 1.5s
- [ ] No stream reconnection loops

## Rollback Plan (If Issues)

If critical issues prevent meetings:

### Immediate Rollback

```bash
# SSH to VPS
ssh user@your-vps-ip
cd /opt/orgsledger

# Revert to previous commit
git revert HEAD
npm install
pm2 restart orgsledger
```

- [ ] Previous version deployed
- [ ] Server restarted
- [ ] Meetings functional again

### Issue Investigation

Before rolling back, collect:
1. Recent logs: `pm2 logs orgsledger > logs.txt`
2. Deepgram API status
3. Database connection status
4. Socket.IO connection logs

## Success Criteria

All items must be ✅:

- [ ] TypeScript compilation: ✅ No errors
- [ ] Test suite: ✅ 4/4 pass
- [ ] Socket.IO handlers: ✅ Registered
- [ ] Deepgram API: ✅ Connected
- [ ] Database: ✅ Transcripts stored
- [ ] Translation: ✅ Working in multiple languages
- [ ] Performance: ✅ Latency < 1.5s
- [ ] Backward compatibility: ✅ Existing events working
- [ ] VPS deployment: ✅ Successful
- [ ] User testing: ✅ Works in real meetings

## Support Resources

| Issue | Resource |
|-------|----------|
| Deepgram API errors | https://developers.deepgram.com/reference/authentication |
| Socket.IO debugging | Check browser DevTools > Network > WS |
| Database issues | Check logs for SQL errors |
| Performance tuning | See MULTILINGUAL_MEETING_INTEGRATION.md |

---

**Last Updated:** March 5, 2026
**Status:** Ready for Integration
**Estimated Total Time:** 30-45 minutes

