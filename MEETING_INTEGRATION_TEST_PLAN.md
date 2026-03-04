# Meeting Integration Test Plan

## Manual Testing Checklist

This document guides manual validation of the meeting environment (web + mobile) across language selection, transcription, translation, and minutes generation.

---

## Prerequisites

- [ ] API server running locally
- [ ] Web app available at `http://localhost:3000` or configured domain
- [ ] Mobile app running in Expo or build
- [ ] Test organization created with AI features enabled
- [ ] Google Cloud Speech-to-Text credentials configured
- [ ] OpenAI API keys configured for translations

---

## Test 1: Language Picker Visibility (Web)

**Objective**: Confirm language picker modal appears on meeting join

**Steps**:
1. Open web app → Sign in as admin
2. Create new meeting → Title: "Language Test"
3. Click "Join Meeting"
4. **EXPECTED**: 
   - [ ] Language picker modal appears overlay
   - [ ] Shows 10 popular languages (English, Spanish, French, etc.)
   - [ ] Search box visible for hidden languages
   - [ ] Current selection highlighted (default: English)

**Success Criteria**: Modal visible, English highlighted, can close/re-open via language button on control bar

---

## Test 2: Language Selection (Web)

**Objective**: Confirm language selection is stored and sent to server

**Steps**:
1. From Test 1, language picker is open
2. Click "Español" (Spanish)
3. **Monitor browser DevTools → Network tab**:
   - [ ] Look for WebSocket message: `translation:set-language`
   - Payload should contain: `{ meetingId: "...", language: "es", receiveVoice: true }`
4. Modal should close
5. Language button on control bar should show "ES" (Spanish code)

**Success Criteria**: Socket event emitted, modal closes, control bar updates

---

## Test 3: Language Selection (Mobile)

**Objective**: Confirm language picker works on React Native and emits socket event

**Steps**:
1. Open mobile app → Sign in
2. Create/join meeting with same meeting ID as Test 2 (or different)
3. **EXPECTED**: Language picker modal appears on first join
4. Search for "Français"
5. Tap "Français"
6. **Monitor mobile DevTools / Console**:
   - [ ] Socket event log: `[LANGUAGE] Emitting translation:set-language`
   - [ ] Modal closes and FR button visible on control bar

**Success Criteria**: Modal appears, language selection persists, control bar updates

---

## Test 4: STT Language Binding (Web)

**Objective**: Confirm microphone input uses selected language (not hardcoded 'en')

**Steps**:
1. From Test 2, language is set to Spanish (ES)
2. Click **Transcribe** button on control bar
3. **Monitor browser console for logs**:
   - [ ] Should see: `[TRANSCRIPTION] Started (using LiveKit mic track, mimeType=..., lang=es)`
   - [ ] Should **NOT** see `lang=en` (hardcoded)
4. Speak a sentence in English: *"Hello, my name is John"*
5. Wait 1-2 seconds for STT to process
6. **Check Network tab → WebSocket messages**:
   - [ ] `socketClient.startAudioStream()` called with language parameter
   - [ ] Google STT should receive language code `es-ES` (BCP-47 mapping)

**Success Criteria**: Console log shows correct language, not hardcoded 'en'

---

## Test 5: STT Language Binding (Mobile)

**Objective**: Confirm mobile STT receives language parameter from user selection

**Steps**:
1. From Test 3, language is set to French (FR)
2. Enable AI (if toggle exists) or ensure AI is enabled
3. Speak into microphone: *"Bonjour, comment ça va?"*
4. **Check console / DevTools**:
   - [ ] Message: `[STT] Starting audio stream: lang=fr`
   - [ ] Language code should be `fr-FR`, not hardcoded

**Success Criteria**: Mobile logs show correct language code

---

## Test 6: Transcript Persistence (Interim vs. Final)

**Objective**: Confirm only final transcripts are persisted (interim skipped)

**Steps**:
1. Both web and mobile speaking in their selected languages (Test 4-5)
2. Stop speaking → wait for STT to finalize
3. **Check database or API response**:
   - [ ] Interim transcripts should NOT appear in `/transcripts` endpoint
   - [ ] Only final transcripts should be stored
4. Fetch transcripts: `GET /meetings/{orgId}/{meetingId}/transcripts?limit=50&offset=0`
   - [ ] Response includes: `{ data: [...], total: N, limit: 50, offset: 0 }`

**Success Criteria**: Only finals in DB, pagination metadata returned

---

## Test 7: Transcript with Translation

**Objective**: Confirm transcripts include translations to selected languages

**Steps**:
1. Wait 30 seconds after Test 6 (background translation processing)
2. Fetch transcripts again: `GET /meetings/{orgId}/{meetingId}/transcripts`
3. **Examine response**:
   ```json
   {
     "id": "...",
     "speaker_name": "Web User",
     "original_text": "Hello, my name is John",
     "source_lang": "en",
     "translations": {
       "en": "Hello, my name is John",
       "es": "Hola, mi nombre es John",
       "fr": "Bonjour, mon nom est Jean"
     }
   }
   ```
   - [ ] `source_lang` is language SPOKEN (not selected language)
   - [ ] `translations` includes all active participants' target languages
   - [ ] Spanish user should see English text translated to Spanish
   - [ ] French user should see English text translated to French

**Success Criteria**: Translations present, mapping correct (spoken lang → target langs)

---

## Test 8: Pagination (Large Meeting)

**Objective**: Confirm pagination works for meetings with 100+ transcripts

**Steps**:
1. Have both web and mobile users continuously speak for 2-3 minutes
2. Generate 100+ transcript entries
3. **Fetch Page 1**: `GET /transcripts?limit=50&offset=0`
   - [ ] Returns 50 items
   - [ ] `total` indicates 100+
4. **Fetch Page 2**: `GET /transcripts?limit=50&offset=50`
   - [ ] Returns next 50 items
   - [ ] Items are ordered by `spoken_at` ascending
5. **Mobile client renders**:
   - [ ] Transcript panel scrolls smoothly (FlatList virtualization)
   - [ ] No lag when 200+ items are visible
   - [ ] Only visible rows rendered (scroll performance)

**Success Criteria**: Pagination returns correct chunks, mobile renders smoothly

---

## Test 9: Minutes Generation

**Objective**: Confirm minutes include transcripts in multiple languages

**Steps**:
1. Both web and mobile users finish speaking (Test 8 complete)
2. Click **Minutes** tab on sidebar
3. **Monitor minutes generation**:
   - [ ] Status shows "Generating..." → "Ready"
4. **Examine generated minutes**:
   - [ ] Includes high-level summary
   - [ ] Action items extracted
   - [ ] Key points listed
   - [ ] References to transcripts in multiple languages

**Success Criteria**: Minutes generated, includes multi-language transcripts

---

## Test 10: Language Change Mid-Meeting

**Objective**: Confirm users can change language selection mid-meeting

**Steps**:
1. From Test 4, language is Spanish (ES), control bar shows "ES"
2. Click language button on control bar
3. **EXPECTED**: Language picker modal opens again
4. Select "Deutsch" (German)
5. **Monitor**:
   - [ ] New socket event emitted: `translation:set-language` with `language: "de"`
   - [ ] Control bar shows "DE"
6. Speak again: *"This is in English, but I selected German"*
7. **Check transcript**:
   - [ ] New transcripts should include German translation (not Spanish)

**Success Criteria**: Mid-meeting language change works, translations respect new preference

---

## Test 11: Performance Metrics

**Objective**: Confirm latency improvements from Phase 2 optimizations

**Benchmarks** (measure with browser DevTools / Network tab):

| Metric | Target | Measurement |
|--------|--------|-------------|
| STT speech → transcript time | <500ms | Time from stopped speaking to transcript visible |
| Translation generation | <2s | Time from final speech to translations populated |
| Minutes generation | <5s | Time from end meeting to minutes ready |
| Pagination query | <50ms | Network time for `/transcripts?limit=50` |
| Mobile list scroll (100 items) | 60fps | Smooth scroll without frame drops |

**Steps**:
1. Open browser DevTools → Performance tab
2. Record while speaking → transcripts → minutes generation
3. Note timestamps and mark any bottlenecks

**Success Criteria**: All metrics within targets

---

## Test 12: Cross-Platform Communication

**Objective**: Confirm web and mobile users see each other's transcriptions

**Steps**:
1. **Web user** speaks in Spanish (selected ES)
2. **Mobile user** watches transcript panel
3. **EXPECTED**: Web user's transcript appears in mobile panel within 2s
4. **Web user** can see translation to German (if mobile selected DE)
5. **Mobile user** speaks in German
6. **Web user** sees English → German translation on transcript panel

**Success Criteria**: Transcripts sync across clients, translations are cross-platform

---

## Test 13: Error Handling

**Objective**: Confirm graceful error handling

**Scenarios**:
1. **STT error**: Disable microphone permission mid-meeting
   - [ ] Error message appears: *"Microphone permission denied"*
   - [ ] Can re-enable without crashing app

2. **Translation error**: Simulate API rate limit
   - [ ] Error message: *"Translation limit exceeded"*
   - [ ] Transcript still persists without translation

3. **Minutes generation error**: Simulate API failure
   - [ ] Error state shows: *"Failed to generate minutes"*
   - [ ] Retry button available
   - [ ] Original transcripts still accessible

**Success Criteria**: No crashes, graceful fallbacks

---

## Summary Checklist

- [ ] Test 1: Language picker visible (web)
- [ ] Test 2: Language selection emits socket event (web)
- [ ] Test 3: Language picker works (mobile)
- [ ] Test 4: STT receives language param (web)
- [ ] Test 5: STT receives language param (mobile)
- [ ] Test 6: Pagination API working
- [ ] Test 7: Transcripts include translations
- [ ] Test 8: Pagination renders smoothly (100+ items)
- [ ] Test 9: Minutes generated with content
- [ ] Test 10: Mid-meeting language change works
- [ ] Test 11: Performance metrics within targets
- [ ] Test 12: Cross-platform transcripts sync
- [ ] Test 13: Error handling graceful

---

## Failure Resolution

If any test fails:

1. **Language picker not visible**: 
   - Check: `showLanguagePicker` state initialized to `true` in GlobalMeetingOverlay.tsx
   - Fix: `setShowLanguagePicker(true)` in render condition

2. **Socket event not emitted**:
   - Check: `handleSelectLanguage()` calls `socketClient.emit('translation:set-language', ...)`
   - Fix: Verify socketClient is initialized before meeting join

3. **STT not receiving language**:
   - Check: `socketClient.startAudioStream(meetingId, selectedLanguage, 'WEBM_OPUS')`
   - Fix: Verify `selectedLanguage` state is correctly bound

4. **Pagination not working**:
   - Check: API route accepts `?limit=50&offset=0` query params
   - Fix: Verify routes/meetings.ts GET /:orgId/:meetingId/transcripts updated

5. **Mobile list lag**:
   - Check: TranscriptPanel uses FlatList, not ScrollView
   - Fix: Replace ScrollView.map() with FlatList component

---

## Notes

- Tests should run in order (Test 1 → 13)
- Each test depends on previous state (meeting still active)
- Use same meeting across all tests for continuity
- Record network logs for post-test analysis
- Take screenshots of UI at each step for documentation

---

**Total estimated time**: 30-45 minutes for full suite
