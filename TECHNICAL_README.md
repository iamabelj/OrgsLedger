# OrgsLedger — Technical Architecture Reference

> **Purpose**: Complete technical breakdown of the OrgsLedger codebase covering the real-time meeting engine (LiveKit), AI pipeline, transcription flow, and translation system.
>
> **Last updated**: June 2025 · LiveKit migration complete

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack](#2-tech-stack)
3. [Meeting System (LiveKit)](#3-meeting-system-livekit)
4. [Audio & Video Flow](#4-audio--video-flow)
5. [Transcription Pipeline](#5-transcription-pipeline)
6. [Translation Pipeline](#6-translation-pipeline)
7. [Minutes Generation (AI)](#7-minutes-generation-ai)
8. [WebSocket Events](#8-websocket-events)
9. [Org & User Model](#9-org--user-model)
10. [Performance Bottlenecks](#10-performance-bottlenecks)
11. [Mobile & Responsive Design](#11-mobile--responsive-design)
12. [Environment Variables](#12-environment-variables)
13. [File Structure](#13-file-structure)
14. [Current Known Issues](#14-current-known-issues)

---

## 1. Project Overview

OrgsLedger is a **multi-tenant organization management platform** with real-time AI-powered meeting capabilities. It targets churches, clubs, associations, and any formal organization that needs structured governance tooling.

### Core Feature Domains

| Domain | Description |
|--------|-------------|
| **Organizations** | Multi-org support, member roles, invitations, committees, executive boards |
| **Meetings** | Video/audio conferencing (LiveKit), live transcription, real-time translation (100+ languages), AI-generated minutes |
| **Financials** | Dues collection, fines, donations, expense tracking, multi-currency (USD/NGN), multi-gateway payments |
| **Chat** | Real-time messaging per org channel, Socket.IO-backed |
| **Events** | Organization events with RSVP tracking |
| **Polls** | Voting system with real-time tallying |
| **Documents** | Shared document storage per org |
| **Announcements** | Org-wide broadcast system |
| **Subscriptions** | Tiered plans (Free, Standard, Professional, Enterprise) with grace periods and feature gating |

### Meeting-Specific Features

- **Video conferencing** via self-hosted LiveKit with JWT token authentication
- **Audio-only mode** with reduced bandwidth config
- **Live speech-to-text** via Web Speech API (browser-native, client-side)
- **Real-time translation** to 100+ languages via GPT-4o-mini → Google Translate v2 fallback chain
- **Voice-to-voice** mode: STT → translate → TTS per participant
- **AI meeting minutes** via Google Cloud Speech-to-Text + OpenAI GPT-4o summarization
- **Meeting recordings** awareness (LiveKit recording, status broadcast via socket)
- **Raise hand**, **lobby/waiting room**, **meeting lock** controls
- **Transcript persistence** to PostgreSQL in real-time during live meetings

### AI Features

- **Translation wallet** — per-org credit system for translation API usage
- **AI wallet** — per-org credit system for minutes generation
- **AI Gateway proxy** — optional centralized proxy endpoint for all AI calls
- **Fallback chains** — every AI operation has at least 2 fallback providers

---

## 2. Tech Stack

### Frontend (`apps/mobile/`)

| Layer | Technology | Version | Notes |
|-------|-----------|---------|-------|
| Framework | React Native | 0.73.6 | Cross-platform (iOS, Android, Web) |
| Platform | Expo | ~50.0.0 | Managed workflow with EAS |
| Router | Expo Router | ~3.4.0 | File-based routing (`app/` directory) |
| State | Zustand | 4.5.0 | 4 stores: auth, org, notifications, subscriptions |
| HTTP | Axios | 1.6.5 | Token refresh interceptor in `src/api/client.ts` |
| Real-time | socket.io-client | 4.7.4 | Wrapper in `src/api/socket.ts` |
| Styling | React Native StyleSheet | — | Custom royal design system, no CSS framework |
| Video (Web) | LiveKit iframe | — | Embedded room in `meetings/[meetingId].tsx` |
| Video (Native) | expo-web-browser | — | Opens LiveKit room URL externally |
| STT | Web Speech API | — | Browser-native, web-only |
| TTS (Web) | SpeechSynthesis API | — | Browser-native with Chrome warm-up hack |
| TTS (Native) | expo-speech | — | Expo module for native platforms |
| Icons | @expo/vector-icons | — | MaterialCommunityIcons, Ionicons |
| Charts | react-native-chart-kit | — | Financial analytics |

**No CSS framework is used.** All styling is done through React Native `StyleSheet.create()` with a centralized design system in `apps/mobile/src/theme.ts`.

### Backend (`apps/api/`)

| Layer | Technology | Version | Notes |
|-------|-----------|---------|-------|
| Runtime | Node.js | 18+ | TypeScript 5.4 |
| Framework | Express | 4.18.2 | REST API |
| Real-time | Socket.IO | 4.7.4 | Bi-directional event system |
| ORM | Knex.js | 3.1.0 | Query builder, raw SQL migrations |
| Validation | Zod | 3.22.4 | Request body validation in routes |
| Auth | jsonwebtoken + bcryptjs | — | Access + refresh token pair |
| Logging | Winston | 3.11 | JSON in production, colorized in dev |
| AI | OpenAI SDK | 4.28 | GPT-4o (minutes), GPT-4o-mini (translation) |
| STT (Server) | @google-cloud/speech | 6.7 | Server-side transcription for AI minutes |
| Translation | Google Translate v2 | — | Via `@google-cloud/translate` |
| Email | Nodemailer | 6.9 | SMTP-based notifications |
| Push | firebase-admin | 12.0 | FCM push notifications |
| File Upload | Multer | 1.4.5 | Disk storage in `uploads/` |
| Rate Limiting | express-rate-limit | 7.1 | 4 tiers: global, auth, refresh, webhook |
| Security | Helmet | 7.1 | HTTP headers hardening |
| Scheduling | node-cron | 3.0 | Subscription expiry checks, automated tasks |

### Database

| Component | Technology | Notes |
|-----------|-----------|-------|
| Primary DB | PostgreSQL | via `pg` driver 8.12 |
| Cache/Queue | Redis | ioredis 5.3.2 (configured, minimal current usage) |
| Migrations | Knex migrations | 22 migration files, 39 active tables |
| Schema style | Raw SQL in migrations | No Prisma/Sequelize schema files |

### Deployment

| Component | Technology | Notes |
|-----------|-----------|-------|
| Containers | Docker Compose | Separate dev and prod compose files |
| Reverse Proxy | Nginx | SSL termination, SPA routing, LiveKit proxy |
| SSL | Let's Encrypt + Certbot | Auto-renewal via certbot container |
| CI/CD | Shell scripts | `deploy/build-production.sh`, `deploy/deploy.sh` |
| Domains | orgsledger.com (landing), app.orgsledger.com (API+SPA), livekit.orgsledger.com (LiveKit) |

### Monorepo Structure

```
Workspaces (package.json):
  - apps/api
  - packages/database
  - packages/shared
  - landing

Non-workspace (separate install):
  - apps/mobile (its own package.json, not in root workspaces)
```

---

## 3. Meeting System (LiveKit)

### Architecture Overview

LiveKit is the real-time media transport layer, replacing the previous Jitsi integration. On web, a LiveKit room is embedded via iframe pointing to the LiveKit room URL. On native, the room URL is opened via expo-web-browser. The backend generates JWT tokens (HS256) for authenticated room access.

**Key files:**
- `apps/api/src/services/livekit.service.ts` — JWT token generation, room naming, join config
- `apps/api/src/routes/meetings.ts` — Meeting CRUD, join endpoint, lifecycle management
- `apps/mobile/app/meetings/[meetingId].tsx` — Client-side LiveKit embed and meeting UI
- `docker-compose.prod.yml` — LiveKit Docker service
- `deploy/nginx.conf` — LiveKit reverse proxy configuration
- `deploy/livekit.yaml` — LiveKit server configuration

### Room Naming

```typescript
// apps/api/src/services/livekit.service.ts
static generateRoomName(orgId: number, meetingId: number): string {
  const orgHash = crypto.createHash('sha256')
    .update(`org-${orgId}-${process.env.JWT_SECRET || 'salt'}`)
    .digest('hex').substring(0, 12);
  const meetingHash = crypto.createHash('sha256')
    .update(`meeting-${meetingId}-${process.env.JWT_SECRET || 'salt'}`)
    .digest('hex').substring(0, 12);
  return `org_${orgHash}_meeting_${meetingHash}`;
}
```

Room names are **deterministic** — same org+meeting always produces the same room name. This means reconnecting to the same meeting always joins the same LiveKit room.

### JWT Token Generation

```typescript
// apps/api/src/services/livekit.service.ts
static generateLiveKitToken(payload: LiveKitTokenPayload): string {
  const now = Math.floor(Date.now() / 1000);
  const jwtPayload = {
    iss: config.livekit.apiKey,
    sub: payload.odId,
    exp: now + config.livekit.tokenExpirySeconds,
    nbf: now - 10,
    video: {
      roomJoin: true,
      room: payload.roomName,
      canPublish: true,
      canSubscribe: true,
      roomAdmin: payload.isModerator,
    },
    metadata: JSON.stringify({
      name: payload.userName,
      email: payload.userEmail,
      isModerator: payload.isModerator,
    }),
  };
  return jwt.sign(jwtPayload, config.livekit.apiSecret, { algorithm: 'HS256' });
}
```

The JWT is signed with `HS256` using `config.livekit.apiSecret`. **Moderator status** is determined by the user's membership role in the organization (`org_admin` or `executive` → moderator).

### Join Flow (Backend)

```typescript
// apps/api/src/routes/meetings.ts — POST /:orgId/:meetingId/join
router.post('/:orgId/:meetingId/join', authenticate, async (req, res) => {
  // 1. Validate meeting exists and is 'scheduled' or 'live'
  // 2. Verify user is a member of the organization
  // 3. Determine moderator status from membership role
  const isModerator = ['org_admin', 'executive'].includes(membership.role);

  // 4. Generate LiveKit JWT
  const livekitToken = LiveKitService.generateLiveKitToken({
    odId: odId.toString(),
    userName: `${user.first_name} ${user.last_name}`,
    userEmail: user.email,
    roomName,
    isModerator,
  });

  // 5. Build complete join config
  const joinConfig = LiveKitService.buildJoinConfig({
    roomName,
    token: livekitToken,
    userName: `${user.first_name} ${user.last_name}`,
    userEmail: user.email,
    meetingType: meeting.meeting_type,  // 'video' or 'audio'
    isModerator,
  });

  // 6. Log join event
  await db('meeting_join_logs').insert({ ... });

  // 7. Return config to client
  res.json({ joinConfig });
});
```

The `buildJoinConfig()` method assembles the LiveKit connection configuration:

```typescript
// apps/api/src/services/livekit.service.ts
static buildJoinConfig(options): LiveKitJoinConfig {
  return {
    url: config.livekit.url,          // 'wss://livekit.orgsledger.com'
    token: options.token,
    roomName: options.roomName,
    meetingType: options.meetingType,  // 'video' or 'audio'
    isModerator: options.isModerator,
    userInfo: {
      displayName: options.userName,
      email: options.userEmail,
    },
  };
}
```

### Join Flow (Client)

```typescript
// apps/mobile/app/meetings/[meetingId].tsx
const handleJoinMeeting = async () => {
  // 1. Call backend join endpoint
  const response = await api.meetings.join(orgId, meetingId);
  setJoinConfig(response.joinConfig);

  // 2. Platform-specific rendering
  if (Platform.OS === 'web') {
    setShowVideo(true);  // triggers LiveKit iframe render
  } else {
    // Open LiveKit room URL in system browser
    const url = `${joinConfig.url.replace('wss://', 'https://')}?token=${joinConfig.token}`;
    await WebBrowser.openBrowserAsync(url);
  }
};
```

### LiveKit Room Embedding (Web)

```typescript
// apps/mobile/app/meetings/[meetingId].tsx
const livekitConnUrl = useMemo(() => {
  if (!joinConfig?.url || !joinConfig?.token) return '';
  const base = joinConfig.url.replace('wss://', 'https://');
  return `${base}?token=${joinConfig.token}`;
}, [joinConfig]);
```

The LiveKit room is rendered via an `<iframe>` with `allow="camera;microphone;display-capture"` and responsive aspect ratio.

### Meeting Lifecycle

```
scheduled → live → ended
    │          │        │
    │          │        └─ POST /:orgId/:meetingId/end
    │          │             • sets status='ended'
    │          │             • broadcasts 'meeting:ended' via socket
    │          │             • calls forceDisconnectMeeting()
    │          │             • checks for transcripts → triggers aiService.processMinutes()
    │          │
    │          └─ POST /:orgId/:meetingId/start
    │               • sets status='live'
    │               • sets started_at=now
    │               • broadcasts 'meeting:started' via socket
    │
    └─ POST /:orgId/meetings (create)
         • inserts with status='scheduled'
         • generates room name via generateRoomName()
```

### Docker Deployment

```yaml
# docker-compose.prod.yml — LiveKit service
livekit:
  image: livekit/livekit-server:latest
  ports:
    - "7880:7880"    # HTTP/WebSocket
    - "7881:7881"    # WebRTC TCP
    - "7882:7882/udp" # WebRTC UDP
  volumes:
    - ./deploy/livekit.yaml:/etc/livekit.yaml
  command: ["--config", "/etc/livekit.yaml"]
```

### Nginx Proxy for LiveKit

```nginx
# deploy/nginx.conf
upstream livekit_backend { server livekit:7880; }

server {
    server_name livekit.orgsledger.com;
    
    location / {
        proxy_pass http://livekit_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_hide_header X-Frame-Options;
        add_header Content-Security-Policy "frame-ancestors 'self' https://app.orgsledger.com";
    }
}
```

### LiveKit Integration Points

| Integration Point | File | What It Does |
|---|---|---|
| `LiveKitService.generateRoomName()` | `services/livekit.service.ts` | Creates deterministic room names |
| `LiveKitService.generateLiveKitToken()` | `services/livekit.service.ts` | Signs JWT for LiveKit auth |
| `LiveKitService.buildJoinConfig()` | `services/livekit.service.ts` | Assembles url/token/roomName config |
| Join endpoint | `routes/meetings.ts` | Calls LiveKitService, returns joinConfig |
| `handleJoinMeeting()` | `meetings/[meetingId].tsx` | Client join flow, iframe/browser |
| `livekitConnUrl` useMemo | `meetings/[meetingId].tsx` | Builds iframe URL |
| iframe `<iframe>` render | `meetings/[meetingId].tsx` | Renders LiveKit room in web view |
| Docker service | `docker-compose.prod.yml` | 1 LiveKit container |
| Nginx proxy | `deploy/nginx.conf` | livekit.orgsledger.com proxy |
| Config env vars | `config.ts` | `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` |
| `meetings.jitsi_room_id` column | `migrations/001_initial.ts` | Stores room ID in DB (column name kept for compatibility) |

**LiveKit does NOT touch:**
- The transcription pipeline (uses Web Speech API, independent of LiveKit)
- The translation pipeline (uses Socket.IO, independent of LiveKit)
- The AI minutes pipeline (uses DB transcripts or server-side Google STT)
- Socket.IO events (completely separate transport from LiveKit)

---

## 4. Audio & Video Flow

### Architecture: Two Separate Audio Paths

OrgsLedger uses **two completely independent audio paths** that do not interact:

```
Path 1: LiveKit (WebRTC) ─── Handles audio/video conferencing
  • Managed by LiveKit server + embedded room
  • Audio goes: Mic → LiveKit → WebRTC → Other participants' speakers
  
Path 2: Web Speech API ─── Handles transcription & translation
  • Runs in the BROWSER alongside LiveKit
  • Mic → Web Speech API (local STT) → text → Socket.IO → server translate → Socket.IO → client TTS
  • Completely independent of LiveKit's audio pipeline
```

**This dual-path architecture means:**
1. The transcription/translation pipeline is independent of LiveKit
2. The browser microphone is shared between LiveKit and Web Speech API (both request `getUserMedia`)
3. There is no server-side audio routing — all audio is client-side

### Video Rendering

**Web**: LiveKit room renders inside an `<iframe>` with `allow="camera;microphone;display-capture"`. The iframe source URL includes the JWT token as a query parameter.

**Native (iOS/Android)**: The LiveKit room opens in the system browser via `expo-web-browser`. The user leaves the app to join the video call. There is no native SDK integration.

### Audio Output (TTS)

Text-to-speech for translations uses different engines per platform:

```typescript
// apps/mobile/src/components/ui/LiveTranslation.tsx

// Web: SpeechSynthesis API with Chrome warm-up
const speak = useCallback((text: string, lang: string) => {
  if (typeof window === 'undefined') return;
  window.speechSynthesis.cancel();
  setTimeout(() => {
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = getBcp47(lang);
    // Match voice by language
    const voices = window.speechSynthesis.getVoices();
    const match = voices.find(v => v.lang.startsWith(lang));
    if (match) utter.voice = match;
    utter.rate = 1.0;
    utter.pitch = 1.0;
    window.speechSynthesis.speak(utter);
  }, 50);  // 50ms delay after cancel() — Chrome fix
}, []);

// Native: expo-speech
import * as Speech from 'expo-speech';
Speech.speak(text, { language: getBcp47(lang), rate: 1.0 });
```

**Chrome TTS warm-up** (required because Chrome suspends SpeechSynthesis until user gesture):
```typescript
// On first user click/tap, fire a silent utterance to unlock TTS
const warmUp = new SpeechSynthesisUtterance('');
warmUp.volume = 0;
window.speechSynthesis.speak(warmUp);
```

---

## 5. Transcription Pipeline

### Overview

Transcription is **always client-side during live meetings** using the Web Speech API. Transcripts are sent to the server via Socket.IO, persisted to PostgreSQL, and then optionally reprocessed by the AI minutes pipeline after the meeting ends.

```
[Browser Mic]
    │
    ▼
[Web Speech API] ── SpeechRecognition (continuous, interim results)
    │
    │  final transcript text
    ▼
[Socket.IO] ── emit('translation:speech', { meetingId, text, language })
    │
    ▼
[Server: socket.ts] ── persistTranscript() + translate for other users
    │
    ▼
[PostgreSQL: meeting_transcripts] ── stored immediately (no batching)
```

### Client-Side STT

```typescript
// apps/mobile/src/components/ui/LiveTranslation.tsx
const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
recognition.continuous = true;
recognition.interimResults = true;
recognition.lang = getBcp47(myLanguage);  // e.g., 'en-US', 'fr-FR', 'yo'
recognition.maxAlternatives = 1;

recognition.onresult = (event) => {
  for (let i = event.resultIndex; i < event.results.length; i++) {
    if (event.results[i].isFinal) {
      const text = event.results[i][0].transcript.trim();
      if (text) {
        // Send to server for translation + persistence
        socketService.sendSpeechForTranslation(meetingId, text, myLanguage);
      }
    }
  }
};
```

**Limitations:**
- Web Speech API is **web-only** — no native iOS/Android STT
- Requires HTTPS or localhost
- Browser may throttle or stop recognition after extended periods
- Language support varies by browser/OS

### Server-Side Persistence

```typescript
// apps/api/src/socket.ts — top-level helper
const persistTranscript = async (
  meetingId: number,
  orgId: number,
  speakerId: number,
  speakerName: string,
  text: string,
  language: string,
  translations: Record<string, string>,
) => {
  try {
    await db('meeting_transcripts').insert({
      meeting_id: meetingId,
      org_id: orgId,
      speaker_id: speakerId,
      speaker_name: speakerName,
      original_text: text,
      source_lang: language,
      translations: JSON.stringify(translations),
      spoken_at: Date.now(),
    });
  } catch (err) {
    logger.error('[SOCKET] Failed to persist transcript', err);
  }
};
```

**Key design choice**: `persistTranscript()` is called **unconditionally** on every `translation:speech` event, regardless of whether translation succeeds. This ensures the transcript database is complete even if the translation service is down.

### Database Schema

```sql
-- meeting_transcripts table
CREATE TABLE meeting_transcripts (
  id              SERIAL PRIMARY KEY,
  meeting_id      INTEGER NOT NULL REFERENCES meetings(id),
  org_id          INTEGER NOT NULL REFERENCES organizations(id),
  speaker_id      INTEGER NOT NULL REFERENCES users(id),
  speaker_name    VARCHAR(255) NOT NULL,
  original_text   TEXT NOT NULL,
  source_lang     VARCHAR(10) NOT NULL,
  translations    JSONB DEFAULT '{}',     -- { "fr": "...", "es": "...", ... }
  spoken_at       BIGINT NOT NULL,        -- Unix timestamp (ms)
  created_at      TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_meeting_transcripts_meeting ON meeting_transcripts(meeting_id);
```

### Client Transcript Display

The meeting detail screen has a "Transcript" tab that displays stored transcripts:

```typescript
// apps/mobile/app/meetings/[meetingId].tsx
// Listens for real-time transcript additions
socket.on('transcript:stored', (data) => {
  setTranscripts(prev => [...prev, data]);
});

// Also fetches full transcript history on tab switch
const transcripts = await api.meetings.getTranscripts(orgId, meetingId);
```

---

## 6. Translation Pipeline

### Overview

The translation system is a **per-user routing system** where each participant's speech is translated into every other participant's preferred language simultaneously.

```
[Speaker A: English]
    │
    ▼  translation:speech → server
[Server: socket.ts]
    │
    ├─ persistTranscript() ──→ [DB]
    │
    ├─ meetingLanguages Map lookup
    │   │
    │   ├─ User B wants French   ──→ translateToMultiple(['fr'])
    │   ├─ User C wants Spanish  ──→ (batched in same call)
    │   └─ User A wants English  ──→ (skipped, same language)
    │
    ▼  translations returned
[Per-user Socket.IO emit]
    │
    ├─→ User B: translation:result { text: "Bonjour...", lang: "fr", ttsAvailable: true }
    └─→ User C: translation:result { text: "Hola...", lang: "es", ttsAvailable: false }
```

### Server Translation Handler

```typescript
// apps/api/src/socket.ts — 'translation:speech' handler
socket.on('translation:speech', async ({ meetingId, text, language }) => {
  const userId = socket.data.userId;
  const user = await db('users').where({ id: userId }).first();
  const speakerName = user ? `${user.first_name} ${user.last_name}` : `User ${userId}`;

  // Get the meeting's organization
  const meeting = await db('meetings').where({ id: meetingId }).first();
  if (!meeting) return;

  // Get all participants' language preferences for this meeting
  const langMap = meetingLanguages.get(meetingId);

  // 1. ALWAYS persist transcript (unconditional)
  // Collect translations as they complete for storage
  const translationsForStorage: Record<string, string> = {};

  // 2. Find unique target languages (exclude speaker's own language)
  const targetLanguages = new Set<string>();
  if (langMap) {
    for (const [uid, prefs] of langMap.entries()) {
      if (uid !== userId && prefs.language !== language) {
        targetLanguages.add(prefs.language);
      }
    }
  }

  // 3. Translate to all needed languages in parallel
  if (targetLanguages.size > 0) {
    const results = await translationService.translateToMultiple(
      text,
      Array.from(targetLanguages),
      language,
    );

    // 4. Route translated text to each user individually
    if (langMap) {
      for (const [uid, prefs] of langMap.entries()) {
        if (uid === userId) continue;
        const targetLang = prefs.language;
        const translatedText = targetLang === language ? text : results[targetLang];
        if (translatedText) {
          translationsForStorage[targetLang] = translatedText;
          io.to(`user:${uid}`).emit('translation:result', {
            meetingId,
            speakerName,
            originalText: text,
            translatedText,
            sourceLang: language,
            targetLang,
            ttsAvailable: isTtsSupported(targetLang) && prefs.receiveVoice,
          });
        }
      }
    }
  }

  // 5. Persist with all translations
  await persistTranscript(meetingId, meeting.org_id, userId, speakerName, text, language, translationsForStorage);
});
```

### In-Memory Language State

```typescript
// apps/api/src/socket.ts
const meetingLanguages = new Map<number, Map<number, {
  language: string;
  name: string;
  receiveVoice: boolean;
}>>();
```

This map tracks which language each user in each meeting wants to receive. It is populated by:
1. `meeting:join` — restores preferences from `user_language_preferences` table
2. `translation:set-language` — user changes language during meeting

```typescript
// apps/api/src/socket.ts — 'translation:set-language' handler
socket.on('translation:set-language', async ({ meetingId, language, receiveVoice }) => {
  const userId = socket.data.userId;
  
  // Update in-memory map
  if (!meetingLanguages.has(meetingId)) {
    meetingLanguages.set(meetingId, new Map());
  }
  const user = await db('users').where({ id: userId }).first();
  meetingLanguages.get(meetingId)!.set(userId, {
    language,
    name: user ? `${user.first_name} ${user.last_name}` : `User ${userId}`,
    receiveVoice: receiveVoice ?? true,
  });

  // Persist to DB for future meetings
  await db('user_language_preferences')
    .insert({
      user_id: userId,
      org_id: meeting.org_id,
      preferred_language: language,
      receive_voice: receiveVoice ?? true,
    })
    .onConflict(['user_id', 'org_id'])
    .merge();

  // Broadcast updated participant list
  const participants = [];
  for (const [uid, prefs] of meetingLanguages.get(meetingId)!.entries()) {
    participants.push({ userId: uid, language: prefs.language, name: prefs.name });
  }
  io.to(`meeting:${meetingId}`).emit('translation:participants', { meetingId, participants });
});
```

### Translation Service (Fallback Chain)

```typescript
// apps/api/src/services/translation.service.ts
class TranslationService {
  private cache = new Map<string, { text: string; timestamp: number }>();
  // Cache: 10min TTL, 2000 max entries

  async translateText(text: string, targetLang: string, sourceLang?: string): Promise<string> {
    // 1. Check cache
    const cacheKey = `${sourceLang || 'auto'}:${targetLang}:${text.slice(0, 200)}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < 600000) return cached.text;

    // 2. Try AI Proxy (centralized gateway)
    if (config.aiProxy.url && config.aiProxy.apiKey) {
      try { return await this.translateViaProxy(text, targetLang, sourceLang); }
      catch { /* fall through */ }
    }

    // 3. Try GPT-4o-mini direct
    if (config.ai.openaiApiKey) {
      try { return await this.translateViaOpenAI(text, targetLang, sourceLang); }
      catch { /* fall through */ }
    }

    // 4. Try Google Translate v2
    try { return await this.translateViaGoogle(text, targetLang, sourceLang); }
    catch { /* fall through */ }

    // 5. Passthrough — return original text
    return text;
  }

  async translateToMultiple(
    text: string,
    targetLangs: string[],
    sourceLang?: string,
  ): Promise<Record<string, string>> {
    // Parallel batches of 5
    const results: Record<string, string> = {};
    for (let i = 0; i < targetLangs.length; i += 5) {
      const batch = targetLangs.slice(i, i + 5);
      const translations = await Promise.all(
        batch.map(lang => this.translateText(text, lang, sourceLang))
      );
      batch.forEach((lang, idx) => { results[lang] = translations[idx]; });
    }
    return results;
  }
}
```

**GPT prompt for translation:**
```
System: You are a professional translator. Translate the following text from {sourceName} to {targetName}. Output ONLY the translated text, no explanations.
User: {text}
Model: gpt-4o-mini, temperature: 0
```

### TTS Support Check

```typescript
// packages/shared/src/languages.ts
export const TTS_SUPPORTED = new Set([
  'en', 'fr', 'es', 'de', 'it', 'pt', 'ru', 'zh', 'ja', 'ko',
  'ar', 'hi', 'nl', 'pl', 'sv', 'da', 'no', 'fi', 'tr', 'th',
  'vi', 'id', 'ms', 'cs', 'el', 'he', 'hu', 'ro', 'sk', 'uk',
  'bg', 'hr', 'sr', 'sl', 'et', 'lv', 'lt', 'ca', 'gl', 'eu',
  'cy', 'ga', 'af', 'sw', 'zu', 'xh', 'yo', 'ig', 'ha',
  // ... 100+ total
]);

export function isTtsSupported(languageCode: string): boolean {
  return TTS_SUPPORTED.has(languageCode);
}
```

The `ttsAvailable` flag in `translation:result` is `true` only when:
1. The target language is in the `TTS_SUPPORTED` set, AND
2. The receiving user has `receiveVoice: true` in their preferences

### Client-Side Translation Handling

```typescript
// apps/mobile/src/components/ui/LiveTranslation.tsx
socketService.on('translation:result', (data) => {
  if (data.meetingId !== meetingId) return;
  
  // Add to transcript display
  setMessages(prev => [...prev, {
    speaker: data.speakerName,
    original: data.originalText,
    translated: data.translatedText,
    lang: data.targetLang,
  }]);

  // Auto-speak if voice mode enabled
  if (speakEnabled && data.ttsAvailable) {
    speak(data.translatedText, data.targetLang);
  }
});
```

---

## 7. Minutes Generation (AI)

### Overview

AI minutes are generated **after a meeting ends** (not during). The pipeline:

```
Meeting ends (POST /:orgId/:meetingId/end)
    │
    ▼
Check: Has audio file? Has DB transcripts?
    │
    ├─ Audio file exists ──→ transcribeAudio() ──→ TranscriptSegment[]
    │                              │
    │                     ┌────────┴────────┐
    │                     │ AI Proxy STT    │
    │                     │ Google Cloud    │
    │                     │   Speech-to-Text│
    │                     │ Mock fallback   │
    │                     └────────┬────────┘
    │                              │
    ├─ DB transcripts exist ──→ getTranscriptsFromDB() ──→ TranscriptSegment[]
    │
    ▼
generateMinutes(segments)
    │
    ┌────┴────┐
    │ AI Proxy│
    │ GPT-4o  │  ──→ structured JSON output
    │ Mock    │
    └────┬────┘
         │
         ▼
Store in meeting_minutes table
    │
    ▼
Notify: Socket + Push + Email
```

### Trigger Point

```typescript
// apps/api/src/routes/meetings.ts — POST /:orgId/:meetingId/end
// After setting status='ended':
const audioPath = path.join(__dirname, '../../uploads/meetings', `${meetingId}.webm`);
const hasAudio = fs.existsSync(audioPath);
const transcriptCount = await db('meeting_transcripts')
  .where({ meeting_id: meetingId })
  .count('id as count').first();
const hasTranscripts = parseInt(transcriptCount?.count || '0') > 0;

if (hasAudio || hasTranscripts) {
  // Fire-and-forget — don't block the HTTP response
  const aiService = req.app.get('aiService') as AIService;
  aiService.processMinutes(meetingId, orgId).catch(err => {
    logger.error('[MINUTES] Background processing failed', err);
  });
}
```

### AI Service Pipeline

```typescript
// apps/api/src/services/ai.service.ts
class AIService {
  constructor(private io: Server) {}

  async processMinutes(meetingId: number, orgId: number) {
    // 1. Check AI wallet balance
    const wallet = await db('ai_wallet').where({ org_id: orgId }).first();
    if (!wallet || wallet.balance_minutes <= 0) {
      throw new Error('Insufficient AI credits');
    }

    // 2. Set status to 'processing'
    await db('meeting_minutes')
      .insert({ meeting_id: meetingId, org_id: orgId, status: 'processing' })
      .onConflict(['meeting_id']).merge();

    // 3. Notify clients
    this.io.to(`meeting:${meetingId}`).emit('meeting:minutes:processing', { meetingId });

    // 4. Get transcript segments (prefer audio, fallback to DB)
    let segments: TranscriptSegment[];
    const audioPath = `uploads/meetings/${meetingId}.webm`;
    if (fs.existsSync(audioPath)) {
      segments = await this.transcribeAudio(audioPath);
    } else {
      segments = await this.getTranscriptsFromDB(meetingId);
    }

    // 5. Generate structured minutes via LLM
    const minutes = await this.generateMinutes(segments, meeting.title);

    // 6. Store results
    await db('meeting_minutes')
      .where({ meeting_id: meetingId })
      .update({
        transcript: JSON.stringify(minutes.transcript),
        summary: minutes.summary,
        decisions: JSON.stringify(minutes.decisions),
        motions: JSON.stringify(minutes.motions),
        action_items: JSON.stringify(minutes.actionItems),
        contributions: JSON.stringify(minutes.contributions),
        status: 'completed',
        ai_credits_used: creditsUsed,
      });

    // 7. Deduct wallet
    await db('ai_wallet')
      .where({ org_id: orgId })
      .decrement('balance_minutes', creditsUsed);

    // 8. Notify: socket, push notification, email
    this.io.to(`meeting:${meetingId}`).emit('meeting:minutes:ready', {
      meetingId,
      summary: minutes.summary,
    });
  }
}
```

### Transcription Methods

**Server-side audio transcription** (Google Cloud Speech-to-Text):
```typescript
async transcribeAudio(audioPath: string): Promise<TranscriptSegment[]> {
  // Fallback chain: AI Proxy → Google Cloud STT → Mock
  
  // Google Cloud STT config:
  const request = {
    audio: { content: audioBuffer.toString('base64') },
    config: {
      encoding: 'WEBM_OPUS',
      sampleRateHertz: 48000,
      languageCode: 'en-US',
      enableWordTimeOffsets: true,
      enableAutomaticPunctuation: true,
      model: 'latest_long',
    },
  };
}
```

**DB transcript retrieval** (used when no audio file):
```typescript
async getTranscriptsFromDB(meetingId: number): Promise<TranscriptSegment[]> {
  const rows = await db('meeting_transcripts')
    .where({ meeting_id: meetingId })
    .orderBy('spoken_at', 'asc');

  return rows.map(row => ({
    speaker: row.speaker_name,
    text: row.original_text,
    timestamp: row.spoken_at,
    language: row.source_lang,
  }));
}
```

### GPT Summarization Prompt

```typescript
const systemPrompt = `You are an expert meeting secretary. Analyze the following meeting transcript and produce structured minutes.

Output valid JSON with this structure:
{
  "transcript": [{ "speaker": "...", "text": "...", "timestamp": ... }],
  "summary": "2-3 paragraph executive summary",
  "decisions": ["Decision 1", "Decision 2"],
  "motions": [{ "motion": "...", "movedBy": "...", "secondedBy": "...", "result": "..." }],
  "actionItems": [{ "task": "...", "assignee": "...", "deadline": "..." }],
  "contributions": [{ "speaker": "...", "keyPoints": ["..."] }]
}`;
```

### Meeting Minutes Schema

```sql
CREATE TABLE meeting_minutes (
  id              SERIAL PRIMARY KEY,
  meeting_id      INTEGER UNIQUE NOT NULL REFERENCES meetings(id),
  org_id          INTEGER NOT NULL REFERENCES organizations(id),
  transcript      JSONB,
  summary         TEXT,
  decisions       JSONB DEFAULT '[]',
  motions         JSONB DEFAULT '[]',
  action_items    JSONB DEFAULT '[]',
  contributions   JSONB DEFAULT '[]',
  status          VARCHAR(20) DEFAULT 'processing',  -- processing | completed | failed
  ai_credits_used DECIMAL(10,2) DEFAULT 0,
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);
```

---

## 8. WebSocket Events

### Server Setup

```typescript
// apps/api/src/index.ts
const server = createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000,
});
setupSocketIO(server);  // from socket.ts
```

### Authentication

```typescript
// apps/api/src/socket.ts
io.use(async (socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Authentication required'));
  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    socket.data.userId = decoded.userId;
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});
```

### Room Structure

| Room Pattern | Purpose | Joined When |
|---|---|---|
| `user:{userId}` | Per-user events (translation results, direct notifications) | On connect |
| `org:{orgId}` | Org-wide events (financial updates, announcements) | On connect (for each membership) |
| `channel:{channelId}` | Chat channel messages | Client calls `joinChannel()` |
| `meeting:{meetingId}` | Meeting events (join/leave, start/end, minutes) | Client calls `joinMeeting()` |
| `ledger:{orgId}` | Financial ledger updates | On connect (for each membership) |

### Complete Event Reference

#### Chat Events

| Event | Direction | Payload | Description |
|---|---|---|---|
| `chat:message` | Client→Server | `{ channelId, content, type?, replyTo? }` | Send a chat message |
| `chat:message` | Server→Client | `{ id, channelId, content, sender, timestamp }` | Receive a message |
| `chat:typing` | Client→Server | `{ channelId }` | User is typing |
| `chat:typing` | Server→Client | `{ channelId, userId, userName }` | Someone is typing |
| `chat:read` | Client→Server | `{ channelId, messageId }` | Mark messages as read |

#### Meeting Events

| Event | Direction | Payload | Description |
|---|---|---|---|
| `meeting:join` | Client→Server | `{ meetingId }` | Join meeting socket room |
| `meeting:join` | Server→Client | `{ meetingId, userId, userName }` | Participant joined notification |
| `meeting:leave` | Client→Server | `{ meetingId }` | Leave meeting socket room |
| `meeting:leave` | Server→Client | `{ meetingId, userId }` | Participant left notification |
| `meeting:started` | Server→Client | `{ meetingId }` | Meeting status changed to live |
| `meeting:ended` | Server→Client | `{ meetingId }` | Meeting status changed to ended |
| `meeting:raise-hand` | Client→Server | `{ meetingId, raised }` | Toggle hand raise |
| `meeting:raise-hand` | Server→Client | `{ meetingId, userId, userName, raised }` | Hand raise state change |
| `meeting:recording-started` | Client→Server | `{ meetingId }` | Recording has begun |
| `meeting:recording-started` | Server→Client | `{ meetingId, userId }` | Broadcast recording status |
| `meeting:recording-stopped` | Client→Server | `{ meetingId }` | Recording has ended |
| `meeting:recording-stopped` | Server→Client | `{ meetingId }` | Broadcast recording status |
| `meeting:lock` | Client→Server | `{ meetingId, locked }` | Lock/unlock meeting room |
| `meeting:lock` | Server→Client | `{ meetingId, locked, userId }` | Room lock state change |
| `meeting:audio-chunk` | Client→Server | `{ meetingId, chunk, mimeType }` | Raw audio chunk for server transcription |
| `meeting:force-disconnect` | Server→Client | `{ meetingId }` | Force all clients to leave (meeting ended) |
| `meeting:participant-joined` | Server→Client | `{ meetingId, userId, userName }` | Alias for join broadcast |
| `meeting:participant-left` | Server→Client | `{ meetingId, userId }` | Alias for leave broadcast |

#### Translation Events

| Event | Direction | Payload | Description |
|---|---|---|---|
| `translation:set-language` | Client→Server | `{ meetingId, language, receiveVoice }` | Set user's preferred language |
| `translation:speech` | Client→Server | `{ meetingId, text, language }` | Send speech text for translation |
| `translation:result` | Server→Client | `{ meetingId, speakerName, originalText, translatedText, sourceLang, targetLang, ttsAvailable }` | Translated text for this user |
| `translation:participants` | Server→Client | `{ meetingId, participants: [{userId, language, name}] }` | Updated participant language map |

#### Minutes Events

| Event | Direction | Payload | Description |
|---|---|---|---|
| `meeting:minutes:processing` | Server→Client | `{ meetingId }` | Minutes generation started |
| `meeting:minutes:ready` | Server→Client | `{ meetingId, summary }` | Minutes generation complete |
| `meeting:minutes:failed` | Server→Client | `{ meetingId, error }` | Minutes generation failed |

#### Financial Events

| Event | Direction | Payload | Description |
|---|---|---|---|
| `financial_update` | Server→Client | `{ orgId, type, data }` | Financial data changed |
| `payment_completed` | Server→Client | `{ orgId, paymentId, ... }` | Payment processed |
| `transcript:stored` | Server→Client | `{ meetingId, speakerName, text, lang }` | Transcript persisted to DB |

#### System Events

| Event | Direction | Payload | Description |
|---|---|---|---|
| `notification` | Server→Client | `{ id, type, title, body, data }` | Push notification via socket |
| `disconnect` | Auto | — | Cleanup: remove from meetingLanguages, broadcast leave |

### Client Socket Wrapper

```typescript
// apps/mobile/src/api/socket.ts
class SocketService {
  private socket: Socket | null = null;
  private listeners: Map<string, Set<Function>> = new Map();
  private joinedRooms: Set<string> = new Set();

  connect(token: string) {
    this.socket = io(API_URL, {
      auth: { token },
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });
    // Auto-rejoin rooms on reconnect
    this.socket.on('connect', () => {
      for (const room of this.joinedRooms) {
        this.socket!.emit('join', { room });
      }
    });
  }

  joinMeeting(meetingId: number) { this.emit('meeting:join', { meetingId }); }
  leaveMeeting(meetingId: number) { this.emit('meeting:leave', { meetingId }); }
  setTranslationLanguage(meetingId: number, language: string, receiveVoice: boolean) {
    this.emit('translation:set-language', { meetingId, language, receiveVoice });
  }
  sendSpeechForTranslation(meetingId: number, text: string, language: string) {
    this.emit('translation:speech', { meetingId, text, language });
  }
}

export const socketService = new SocketService();
```

---

## 9. Org & User Model

### Users Table

```sql
CREATE TABLE users (
  id                SERIAL PRIMARY KEY,
  first_name        VARCHAR(100) NOT NULL,
  last_name         VARCHAR(100) NOT NULL,
  email             VARCHAR(255) UNIQUE NOT NULL,
  password_hash     VARCHAR(255) NOT NULL,
  phone             VARCHAR(20),
  avatar_url        VARCHAR(500),
  is_verified       BOOLEAN DEFAULT FALSE,
  is_active         BOOLEAN DEFAULT TRUE,
  is_super_admin    BOOLEAN DEFAULT FALSE,
  verification_code VARCHAR(10),
  reset_token       VARCHAR(255),
  reset_expires     TIMESTAMP,
  fcm_token         VARCHAR(500),
  last_login        TIMESTAMP,
  created_at        TIMESTAMP DEFAULT NOW(),
  updated_at        TIMESTAMP DEFAULT NOW()
);
```

### Organizations Table

```sql
CREATE TABLE organizations (
  id              SERIAL PRIMARY KEY,
  name            VARCHAR(255) NOT NULL,
  description     TEXT,
  type            VARCHAR(50),          -- church, club, association, etc.
  logo_url        VARCHAR(500),
  invite_code     VARCHAR(20) UNIQUE,
  currency        VARCHAR(3) DEFAULT 'USD',
  country         VARCHAR(100),
  created_by      INTEGER REFERENCES users(id),
  is_active       BOOLEAN DEFAULT TRUE,
  settings        JSONB DEFAULT '{}',
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);
```

### Memberships (Roles)

```sql
CREATE TABLE memberships (
  id        SERIAL PRIMARY KEY,
  user_id   INTEGER NOT NULL REFERENCES users(id),
  org_id    INTEGER NOT NULL REFERENCES organizations(id),
  role      VARCHAR(20) NOT NULL DEFAULT 'member',
  status    VARCHAR(20) DEFAULT 'active',   -- active, suspended, removed
  joined_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, org_id)
);
```

**Role hierarchy** (defined in `constants.ts`):

| Role | Level | Permissions |
|---|---|---|
| `guest` | 0 | Read-only access |
| `member` | 1 | Standard org member |
| `executive` | 2 | Board/exec privileges, LiveKit moderator |
| `org_admin` | 3 | Full org management, LiveKit moderator |
| `super_admin` | 4 | System-wide admin (cross-org) |
| `developer` | 5 | System-level access |

Role checks in routes use middleware:

```typescript
// apps/api/src/middleware/authorization.ts
export const requireRole = (...roles: string[]) => {
  return async (req, res, next) => {
    const membership = await db('memberships')
      .where({ user_id: req.user.userId, org_id: req.params.orgId })
      .first();
    if (!membership || !roles.includes(membership.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    req.membership = membership;
    next();
  };
};
```

### Committees

```sql
CREATE TABLE committees (
  id          SERIAL PRIMARY KEY,
  org_id      INTEGER NOT NULL REFERENCES organizations(id),
  name        VARCHAR(255) NOT NULL,
  description TEXT,
  chair_id    INTEGER REFERENCES users(id),
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMP DEFAULT NOW()
);

CREATE TABLE committee_members (
  id            SERIAL PRIMARY KEY,
  committee_id  INTEGER NOT NULL REFERENCES committees(id),
  user_id       INTEGER NOT NULL REFERENCES users(id),
  role          VARCHAR(50) DEFAULT 'member',  -- chair, secretary, member
  joined_at     TIMESTAMP DEFAULT NOW(),
  UNIQUE(committee_id, user_id)
);
```

### Subscription System

```sql
CREATE TABLE subscriptions (
  id              SERIAL PRIMARY KEY,
  org_id          INTEGER NOT NULL REFERENCES organizations(id),
  plan            VARCHAR(50) NOT NULL,    -- free, standard, professional, enterprise
  status          VARCHAR(20) DEFAULT 'active',  -- active, expired, grace_period, suspended, cancelled
  gateway         VARCHAR(50),
  gateway_sub_id  VARCHAR(255),
  current_period_start TIMESTAMP,
  current_period_end   TIMESTAMP,
  grace_period_end     TIMESTAMP,
  amount          DECIMAL(10,2),
  currency        VARCHAR(3),
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);
```

Plans are defined in `constants.ts`: `free`, `standard`, `professional`, `enterprise`.

### Payment Gateways

Three gateways + manual bank transfer:

| Gateway | Config Key | Webhook Route |
|---|---|---|
| Stripe | `config.stripe.secretKey` | `POST /api/payments/webhook/stripe` |
| Paystack | `config.paystack.secretKey` | `POST /api/payments/webhook/paystack` |
| Flutterwave | `config.flutterwave.secretKey` | `POST /api/payments/webhook/flutterwave` |
| Bank Transfer | — | Manual confirmation by org admin |

### Financial Tables

```sql
-- Dues tracking
CREATE TABLE dues (
  id          SERIAL PRIMARY KEY,
  org_id      INTEGER NOT NULL REFERENCES organizations(id),
  name        VARCHAR(255) NOT NULL,
  amount      DECIMAL(10,2) NOT NULL,
  currency    VARCHAR(3) DEFAULT 'USD',
  frequency   VARCHAR(20),        -- monthly, quarterly, annual, one-time
  due_date    DATE,
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMP DEFAULT NOW()
);

-- Member payment records
CREATE TABLE member_dues (
  id          SERIAL PRIMARY KEY,
  due_id      INTEGER NOT NULL REFERENCES dues(id),
  user_id     INTEGER NOT NULL REFERENCES users(id),
  org_id      INTEGER NOT NULL REFERENCES organizations(id),
  amount_paid DECIMAL(10,2) DEFAULT 0,
  status      VARCHAR(20) DEFAULT 'pending',  -- pending, completed, partial, overdue
  paid_at     TIMESTAMP,
  UNIQUE(due_id, user_id)
);

-- Transaction ledger
CREATE TABLE transactions (
  id              SERIAL PRIMARY KEY,
  org_id          INTEGER NOT NULL REFERENCES organizations(id),
  user_id         INTEGER REFERENCES users(id),
  type            VARCHAR(50) NOT NULL,    -- dues, fine, donation, expense
  amount          DECIMAL(10,2) NOT NULL,
  currency        VARCHAR(3) DEFAULT 'USD',
  status          VARCHAR(20) DEFAULT 'pending',
  gateway         VARCHAR(50),
  gateway_ref     VARCHAR(255),
  description     TEXT,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMP DEFAULT NOW()
);
```

---

## 10. Performance Bottlenecks

### 1. Per-User Socket Iteration for Translation

**Problem**: Every `translation:speech` event iterates over all meeting participants to find unique target languages, translates, then iterates again to route results to individual sockets.

```typescript
// socket.ts — O(n) iteration per speech event
for (const [uid, prefs] of langMap.entries()) {
  if (uid !== userId && prefs.language !== language) {
    targetLanguages.add(prefs.language);
  }
}
// ... translate ...
for (const [uid, prefs] of langMap.entries()) {
  io.to(`user:${uid}`).emit('translation:result', { ... });
}
```

**Impact**: In a meeting with 50 participants speaking 10 languages, every speech event triggers 10 translation API calls + 50 individual socket emits. At high speech frequency, this creates a bottleneck.

**Mitigation ideas**: Batch by language group (emit to a `lang:fr:meeting:123` room instead of per-user), use Redis pub/sub for horizontal scaling.

### 2. In-Memory `meetingLanguages` Map

**Problem**: The `meetingLanguages` Map lives in Node.js process memory. If the server restarts, all language preferences are lost mid-meeting. If you scale to multiple API instances, each instance has its own incomplete map.

```typescript
const meetingLanguages = new Map<number, Map<number, { language, name, receiveVoice }>>();
```

**Impact**: Not horizontally scalable. Server restart during a live meeting silently drops all translation routing until users re-emit `translation:set-language`.

**Mitigation ideas**: Move to Redis hash (`HSET meeting:123:langs userId JSON`), restore from DB on reconnect.

### 3. Database Lookups Per Speech Event

**Problem**: Each `translation:speech` event does at minimum:
- `db('users').where({ id: userId }).first()` — get speaker name
- `db('meetings').where({ id: meetingId }).first()` — get org_id
- `db('meeting_transcripts').insert(...)` — persist transcript

That's 3 DB round-trips per speech event, which can be 1-3 per second per active speaker.

**Mitigation ideas**: Cache user names on socket connect (`socket.data.userName`), cache meeting→org mapping in memory, batch transcript inserts (e.g., flush every 2 seconds).

### 4. No Job Queue

**Problem**: AI minutes processing runs as a fire-and-forget `Promise` in the API process. If the server crashes during minutes generation, the job is lost. There's no retry mechanism, no dead letter queue.

```typescript
// routes/meetings.ts
aiService.processMinutes(meetingId, orgId).catch(err => {
  logger.error('[MINUTES] Background processing failed', err);
});
```

**Mitigation ideas**: Use BullMQ (Redis-backed job queue), add retry with exponential backoff, persist job state.

### 5. Translation Cache Limitations

**Problem**: Translation cache is in-memory (`Map`) with a max of 2000 entries and 10-minute TTL. It's per-process and not shared across instances.

**Mitigation ideas**: Move to Redis cache with configurable TTL.

### 6. No Connection Pooling Visibility

Knex connection pool is configured with defaults (min: 2, max: 10). Under high load with many concurrent meetings, the connection pool could be exhausted.

```typescript
// apps/api/src/db.ts
const db = knex({
  client: 'pg',
  connection: {
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.name,
  },
  pool: { min: 2, max: 10 },
});
```

---

## 11. Mobile & Responsive Design

### Design System

All styling uses a centralized royal design system in `apps/mobile/src/theme.ts`:

```typescript
// Core exports
export const Colors = { ... };         // 40+ named colors
export const Spacing = { ... };        // xxs(2) → xxxl(64)
export const FontSize = { ... };       // xs(10) → display(40)
export const FontWeight = { ... };     // regular(400) → extrabold(800)
export const BorderRadius = { ... };   // xs(4) → full(999)
export const Shadow = { ... };         // sm, md, lg, gold
export const Typography = { ... };     // display, h1-h4, body, caption, label, button, link
```

**Color palette**: Deep navy background (`#060D18`), ivory text (`#F0EDE5`), gold accents (`#C9A84C`). No light mode. Pure dark theme.

### Platform-Aware Styling

```typescript
// theme.ts — Shadow system handles web vs native
const makeShadow = (color, offsetY, opacity, radius, elevation) => {
  if (Platform.OS === 'web') {
    return { boxShadow: `0px ${offsetY}px ${radius}px rgba(...)` };
  }
  return {
    shadowColor: color,
    shadowOffset: { width: 0, height: offsetY },
    shadowOpacity: opacity,
    shadowRadius: radius,
    elevation,  // Android
  };
};
```

### Responsive Layout

The app uses custom responsive hooks and components:

```typescript
// apps/mobile/src/hooks/useResponsive.ts
export function useResponsive() {
  const { width } = useWindowDimensions();
  return {
    isMobile: width < 768,
    isTablet: width >= 768 && width < 1024,
    isDesktop: width >= 1024,
    width,
  };
}
```

**Key responsive components:**
- `ResponsiveScrollView` — adapts scroll behavior per platform
- `DrawerContext` — sidebar navigation for desktop, bottom tabs for mobile
- `ResponsiveContainer` — max-width wrapper for desktop

### Navigation Structure

File-based routing via Expo Router (`apps/mobile/app/`):

```
app/
├── _layout.tsx          → Root layout (auth provider, theme, socket init)
├── index.tsx            → Landing / login redirect
├── (auth)/
│   ├── login.tsx
│   ├── register.tsx
│   └── forgot-password.tsx
├── (tabs)/
│   ├── _layout.tsx      → Tab navigator (Home, Orgs, Chat, Profile)
│   ├── home.tsx
│   ├── organizations.tsx
│   ├── chat.tsx
│   └── profile.tsx
├── organization.tsx     → Single org dashboard
├── meetings/
│   ├── [meetingId].tsx   → Meeting detail + LiveKit embed
│   └── create.tsx        → Meeting creation form
├── financials/          → Dues, fines, donations, expenses
├── members/             → Member directory, invitations
├── admin/               → Org admin panel
├── events/              → Events CRUD
├── polls/               → Polls and voting
├── documents/           → Document management
├── announcements/       → Announcement broadcasting
├── chat/                → Chat channels and messaging
└── ...
```

### State Management (Zustand)

```typescript
// 4 stores in apps/mobile/src/stores/

// 1. useAuthStore — JWT tokens, user profile, login/logout
// 2. useOrgStore — current org, memberships, org switching
// 3. useNotificationStore — notification list, unread count, FCM
// 4. useSubscriptionStore — current plan, feature flags, billing
```

---

## 12. Environment Variables

All environment variables are defined in `apps/api/src/config.ts`:

### Database (PostgreSQL)

| Variable | Default | Description |
|---|---|---|
| `DB_HOST` | `localhost` | PostgreSQL host |
| `DB_PORT` | `5432` | PostgreSQL port |
| `DB_USER` | `postgres` | Database user |
| `DB_PASSWORD` | `password` | Database password (**fatal in prod if default**) |
| `DB_NAME` | `orgsledger` | Database name |

### Redis

| Variable | Default | Description |
|---|---|---|
| `REDIS_HOST` | `localhost` | Redis host |
| `REDIS_PORT` | `6379` | Redis port |
| `REDIS_PASSWORD` | — | Redis password (optional) |

### JWT Authentication

| Variable | Default | Description |
|---|---|---|
| `JWT_SECRET` | `dev-secret-...` | Access token signing key (**fatal in prod if default**) |
| `JWT_REFRESH_SECRET` | `dev-refresh-...` | Refresh token signing key (**fatal in prod if default**) |
| `JWT_EXPIRES_IN` | `24h` | Access token TTL |
| `JWT_REFRESH_EXPIRES_IN` | `7d` | Refresh token TTL |

### Payment Gateways

| Variable | Default | Description |
|---|---|---|
| `STRIPE_SECRET_KEY` | — | Stripe API secret |
| `STRIPE_WEBHOOK_SECRET` | — | Stripe webhook signing secret |
| `PAYSTACK_SECRET_KEY` | — | Paystack API secret |
| `FLUTTERWAVE_SECRET_KEY` | — | Flutterwave API secret |

### AI / Translation

| Variable | Default | Description |
|---|---|---|
| `OPENAI_API_KEY` | — | OpenAI API key (GPT-4o, GPT-4o-mini) |
| `GOOGLE_APPLICATION_CREDENTIALS` | — | Path to Google Cloud credentials JSON |

### AI Proxy (Optional)

| Variable | Default | Description |
|---|---|---|
| `AI_PROXY_URL` | — | Centralized AI proxy endpoint URL |
| `AI_PROXY_API_KEY` | — | AI proxy authentication key |

### AI Gateway (Optional)

| Variable | Default | Description |
|---|---|---|
| `AI_GATEWAY_URL` | — | AI gateway base URL |
| `AI_GATEWAY_API_KEY` | — | AI gateway API key |

### LiveKit Video Conferencing

| Variable | Default | Description |
|---|---|---|
| `LIVEKIT_URL` | — | LiveKit server WebSocket URL |
| `LIVEKIT_API_KEY` | `orgsledger` | API key for LiveKit token signing |
| `LIVEKIT_API_SECRET` | — | JWT signing secret |
| `LIVEKIT_TOKEN_EXPIRY` | `7200` | JWT token TTL in seconds |

### Email (SMTP)

| Variable | Default | Description |
|---|---|---|
| `SMTP_HOST` | — | SMTP server host |
| `SMTP_PORT` | `587` | SMTP port |
| `SMTP_USER` | — | SMTP username |
| `SMTP_PASS` | — | SMTP password |
| `SMTP_FROM` | `noreply@orgsledger.com` | From address |

### Push Notifications

| Variable | Default | Description |
|---|---|---|
| Firebase credentials | — | Via `GOOGLE_APPLICATION_CREDENTIALS` (shared with STT) |

### Server

| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | `development` | Environment mode |
| `PORT` | `3000` | API server port |
| `UPLOAD_DIR` | `uploads` | File upload directory |
| `RATE_NGN_PER_USD` | `1600` | Naira to USD exchange rate |

---

## 13. File Structure

```
OrgsLedger/
├── app.js                          # Legacy entry point (redirects to apps/api)
├── server.js                       # Legacy entry point
├── env.js                          # Legacy env loader
├── package.json                    # Root workspace config
├── tsconfig.base.json              # Shared TypeScript config
├── tsconfig.json                   # Root TypeScript config
├── docker-compose.yml              # Development Docker Compose
├── docker-compose.prod.yml         # Production Docker Compose (with LiveKit)
│
├── apps/
│   ├── api/                        # ===== BACKEND =====
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── jest.config.js
│   │   ├── Dockerfile
│   │   ├── app.js                  # Express app factory
│   │   ├── preview-server.js       # Dev preview server
│   │   ├── google-credentials.json # Google Cloud credentials
│   │   │
│   │   └── src/
│   │       ├── index.ts            # Server entry: Express + Socket.IO + routes
│   │       ├── config.ts           # All environment variable config
│   │       ├── constants.ts        # Roles, domains, rate limits, plans
│   │       ├── db.ts               # Knex PostgreSQL connection
│   │       ├── logger.ts           # Winston structured logging
│   │       ├── socket.ts           # Socket.IO event handlers (696 lines)
│   │       │
│   │       ├── controllers/
│   │       │   └── index.ts        # Controller barrel export
│   │       │
│   │       ├── middleware/
│   │       │   ├── audit.ts        # Audit logging middleware
│   │       │   ├── auth.ts         # JWT authentication middleware
│   │       │   ├── authorization.ts # Role-based authorization
│   │       │   ├── error-handler.ts # Global error handler
│   │       │   ├── metrics.ts      # Request metrics/timing
│   │       │   ├── multer.ts       # File upload config
│   │       │   ├── rate-limit.ts   # Rate limiting tiers
│   │       │   ├── request-logger.ts # HTTP request logging
│   │       │   └── validation.ts   # Zod validation middleware
│   │       │
│   │       ├── routes/
│   │       │   ├── admin.ts        # Super admin routes
│   │       │   ├── analytics.ts    # Organization analytics
│   │       │   ├── announcements.ts # Announcement CRUD
│   │       │   ├── auth.ts         # Login, register, verify, refresh
│   │       │   ├── chat.ts         # Chat channels and messages
│   │       │   ├── committees.ts   # Committee management
│   │       │   ├── documents.ts    # Document upload/download
│   │       │   ├── events.ts       # Event CRUD with RSVP
│   │       │   ├── expenses.ts     # Expense tracking
│   │       │   ├── financials.ts   # Dues, fines, donations, transactions
│   │       │   ├── meetings.ts     # Meeting CRUD + LiveKit + minutes
│   │       │   ├── notifications.ts # Push notification management
│   │       │   ├── observability.ts # Health checks, metrics endpoint
│   │       │   ├── organizations.ts # Org CRUD, members, invites
│   │       │   ├── payments.ts     # Payment processing, webhooks
│   │       │   ├── polls.ts        # Poll creation and voting
│   │       │   └── subscriptions.ts # Subscription plan management
│   │       │
│   │       ├── services/
│   │       │   ├── ai.service.ts       # AI minutes: STT + GPT summarization (534 lines)
│   │       │   ├── auth.service.ts     # Token generation, password hashing
│   │       │   ├── email.service.ts    # SMTP email sending
│   │       │   ├── fcm.service.ts      # Firebase push notifications
│   │       │   ├── livekit.service.ts  # LiveKit JWT, room naming, config
│   │       │   ├── payment.service.ts  # Multi-gateway payment processing
│   │       │   ├── scheduler.service.ts # node-cron scheduled tasks
│   │       │   └── translation.service.ts # Translation fallback chain (235 lines)
│   │       │
│   │       ├── utils/
│   │       │   ├── helpers.ts      # Utility functions
│   │       │   └── validators.ts   # Shared validation schemas
│   │       │
│   │       └── __tests__/          # Jest test suite
│   │           ├── audit-completeness.test.ts
│   │           ├── currency-handling.test.ts
│   │           ├── deduction.test.ts
│   │           ├── grace-period.test.ts
│   │           ├── ... (12+ test files)
│   │
│   └── mobile/                     # ===== FRONTEND =====
│       ├── package.json
│       ├── tsconfig.json
│       ├── app.json                # Expo config
│       ├── babel.config.js
│       ├── metro.config.js
│       ├── eas.json                # EAS Build config
│       ├── index.js                # Entry point
│       │
│       ├── app/                    # File-based routing (Expo Router)
│       │   ├── _layout.tsx         # Root layout: providers, socket init
│       │   ├── index.tsx           # Landing → auth redirect
│       │   ├── (auth)/
│       │   │   ├── login.tsx
│       │   │   ├── register.tsx
│       │   │   └── forgot-password.tsx
│       │   ├── (tabs)/
│       │   │   ├── _layout.tsx     # Tab navigator
│       │   │   ├── home.tsx
│       │   │   ├── organizations.tsx
│       │   │   ├── chat.tsx
│       │   │   └── profile.tsx
│       │   ├── organization.tsx
│       │   ├── meetings/
│       │   │   ├── [meetingId].tsx  # Meeting detail + LiveKit
│       │   │   └── create.tsx      # Meeting creation form
│       │   ├── financials/         # Dues, fines, donations, expenses
│       │   ├── members/            # Member directory
│       │   ├── admin/              # Org admin panel
│       │   ├── events/             # Events management
│       │   ├── polls/              # Polls and voting
│       │   ├── documents/          # Document management
│       │   ├── chat/               # Chat screens
│       │   ├── announcements.tsx
│       │   ├── notifications.tsx
│       │   ├── checkout.tsx
│       │   ├── create-org.tsx
│       │   ├── help.tsx
│       │   ├── invite/
│       │   └── legal/
│       │
│       ├── src/
│       │   ├── theme.ts            # Royal design system
│       │   ├── logo.ts             # SVG logo component
│       │   │
│       │   ├── api/
│       │   │   ├── client.ts       # Axios API client (511 lines)
│       │   │   └── socket.ts       # Socket.IO wrapper (151 lines)
│       │   │
│       │   ├── stores/
│       │   │   ├── authStore.ts    # Auth state (Zustand)
│       │   │   ├── orgStore.ts     # Organization state
│       │   │   ├── notificationStore.ts # Notifications
│       │   │   └── subscriptionStore.ts # Subscription state
│       │   │
│       │   ├── hooks/
│       │   │   ├── useResponsive.ts
│       │   │   ├── useSocket.ts
│       │   │   └── useNotifications.ts
│       │   │
│       │   ├── contexts/
│       │   │   ├── DrawerContext.tsx
│       │   │   └── SocketContext.tsx
│       │   │
│       │   ├── components/
│       │   │   └── ui/
│       │   │       ├── LiveTranslation.tsx  # Live translation UI (892 lines)
│       │   │       ├── ResponsiveScrollView.tsx
│       │   │       ├── ResponsiveContainer.tsx
│       │   │       └── ... (other UI components)
│       │   │
│       │   └── utils/
│       │       └── helpers.ts
│       │
│       └── web/
│           └── index.html          # Web entry HTML
│
├── packages/
│   ├── database/                   # ===== DATABASE PACKAGE =====
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts            # DB exports
│   │       ├── knexfile.ts         # Knex config
│   │       ├── migrate.ts          # Migration runner
│   │       ├── reset.ts            # DB reset utility
│   │       ├── seed.ts             # Seed data
│   │       ├── types.ts            # TypeScript type definitions
│   │       ├── types.d.ts          # Type declarations
│   │       ├── constants.ts        # DB constants
│   │       ├── verify.ts           # Schema verification
│   │       └── migrations/
│   │           ├── 001_initial.ts                    # Core tables
│   │           ├── 002_add_channels.ts               # Chat channels
│   │           ├── 003_add_meeting_fields.ts         # Meeting extensions
│   │           ├── 004_add_org_settings.ts           # Org settings JSONB
│   │           ├── 005_add_message_type.ts           # Message types
│   │           ├── 006_add_committees.ts             # Committees
│   │           ├── 007_add_notifications.ts          # Notifications
│   │           ├── 008_add_announcements.ts          # Announcements
│   │           ├── 009_add_events.ts                 # Events + RSVP
│   │           ├── 010_add_polls.ts                  # Polls + votes
│   │           ├── 011_add_documents.ts              # Documents
│   │           ├── 012_add_fines_donations.ts        # Fines, donations
│   │           ├── 013_add_transactions.ts           # Transaction ledger
│   │           ├── 014_add_meeting_attendance.ts     # Meeting attendance
│   │           ├── 015_add_analytics.ts              # Org analytics
│   │           ├── 016_add_meeting_transcripts.ts    # Transcripts
│   │           ├── 017_add_meeting_minutes.ts        # AI minutes
│   │           ├── 018_add_meeting_join_logs.ts      # Join logs
│   │           ├── 019_add_expenses.ts               # Expenses
│   │           ├── 020_add_subscriptions.ts          # Subscriptions
│   │           ├── 021_add_user_language_preferences.ts # Language prefs
│   │           └── 022_add_ai_translation_wallets.ts # AI/Translation wallets
│   │
│   └── shared/                     # ===== SHARED PACKAGE =====
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           └── index.ts            # Shared exports (languages, types)
│
├── landing/                        # ===== LANDING SITE =====
│   ├── index.html
│   ├── about.html
│   ├── admin.html
│   ├── package.json
│   ├── server.js
│   └── routes/
│       ├── admin.js
│       └── ai-proxy.js            # AI proxy endpoint for landing
│
├── deploy/                         # ===== DEPLOYMENT =====
│   ├── build-production.sh
│   ├── deploy.sh
│   ├── update.sh
│   ├── nginx.conf                  # Nginx config with LiveKit proxy
│   ├── nginx-initial.conf          # Initial Nginx (pre-SSL)
│   ├── livekit.yaml                # LiveKit server configuration
│   └── livekit-setup.md            # LiveKit deployment guide
│
├── scripts/
│   └── post-export-web.js          # Post-export build script
│
└── uploads/                        # File upload storage
```

---

## 14. Current Known Issues

### 1. TTS Browser Restrictions

Chrome suspends `SpeechSynthesis` until a user gesture. The current fix fires a silent utterance on first interaction, but this can fail if the user hasn't clicked anything before TTS is needed. Additionally, Chrome has an undocumented bug where `speechSynthesis.speak()` immediately after `speechSynthesis.cancel()` is silently dropped — a 50ms `setTimeout` is used as a workaround.

**File**: `apps/mobile/src/components/ui/LiveTranslation.tsx`

### 2. STT is Web-Only

`Web Speech API` (`SpeechRecognition`) is only available on web browsers. Native iOS/Android users cannot use live transcription or voice-to-voice translation. There is no native STT integration (no `expo-speech-recognition` or similar).

**Impact**: Native app users can join meetings via `expo-web-browser` (which opens LiveKit) but cannot participate in the transcription/translation pipeline.

### 3. No Background Job Queue

AI minutes processing, email sending, and push notifications all run as fire-and-forget promises in the API process. If the server crashes during processing, jobs are lost with no retry mechanism.

**Files**: `apps/api/src/services/ai.service.ts`, `apps/api/src/routes/meetings.ts`

### 4. In-Memory Translation State

The `meetingLanguages` Map exists only in the API process memory. This means:
- Server restart during a live meeting drops all translation routing
- Cannot scale to multiple API instances without sticky sessions
- No persistence of active meeting state

**File**: `apps/api/src/socket.ts`

### 5. Translation Cache is Per-Process

The `TranslationService` cache is an in-memory `Map` (2000 entries, 10min TTL). Not shared across instances, lost on restart.

**File**: `apps/api/src/services/translation.service.ts`

### 6. No Native Video SDK

LiveKit on native platforms opens in the system browser via `expo-web-browser`. Users leave the OrgsLedger app to join video calls. There is no embedded video experience on native. This means native users cannot see the meeting controls (raise hand, recording, language picker) while in the video call.

### 7. Single DB Write Per Speech Event

Every `translation:speech` event writes to `meeting_transcripts` synchronously. In a meeting with 20 active speakers each producing 1-2 speech events per second, that's 20-40 `INSERT` statements per second to a single table.

### 8. No Horizontal Scaling Story

The combination of in-memory state (meetingLanguages, translation cache), lack of Redis pub/sub for Socket.IO, and fire-and-forget AI jobs means the API cannot be scaled to multiple instances without significant refactoring.

### 9. `expo-web-browser` Disconnect

When native users open LiveKit via `expo-web-browser`, the OrgsLedger app may be backgrounded. Socket.IO connections can be dropped by the OS, meaning the user's `meeting:leave` event may not fire, leaving stale entries in `meetingLanguages`.

---

## Appendix A: Database Table Reference

**39 active tables** across 22 migrations:

| Table | Migration | Purpose |
|---|---|---|
| `users` | 001 | User accounts |
| `organizations` | 001 | Organizations |
| `memberships` | 001 | User↔Org role mapping |
| `meetings` | 001 | Meeting records |
| `agenda_items` | 001 | Meeting agenda |
| `dues` | 001 | Dues definitions |
| `member_dues` | 001 | Per-member dues tracking |
| `channels` | 002 | Chat channels |
| `messages` | 002 | Chat messages |
| `channel_members` | 002 | Channel membership |
| `committees` | 006 | Committees |
| `committee_members` | 006 | Committee membership |
| `notifications` | 007 | User notifications |
| `announcements` | 008 | Org announcements |
| `events` | 009 | Org events |
| `event_rsvps` | 009 | Event RSVP tracking |
| `polls` | 010 | Polls |
| `poll_options` | 010 | Poll answer options |
| `poll_votes` | 010 | Vote records |
| `documents` | 011 | Shared documents |
| `fines` | 012 | Fine definitions |
| `member_fines` | 012 | Per-member fines |
| `donations` | 012 | Donation records |
| `transactions` | 013 | Financial transaction ledger |
| `meeting_attendance` | 014 | Meeting attendance records |
| `org_analytics` | 015 | Organization analytics snapshots |
| `meeting_transcripts` | 016 | Live meeting transcripts |
| `meeting_minutes` | 017 | AI-generated meeting minutes |
| `meeting_join_logs` | 018 | Meeting join audit trail |
| `expenses` | 019 | Expense records |
| `expense_approvals` | 019 | Expense approval workflow |
| `subscriptions` | 020 | Org subscription plans |
| `subscription_history` | 020 | Subscription change log |
| `user_language_preferences` | 021 | Per-user language + TTS prefs |
| `ai_wallet` | 022 | AI minutes credit balance |
| `ai_usage_log` | 022 | AI credit usage history |
| `translation_wallet` | 022 | Translation credit balance |
| `translation_usage_log` | 022 | Translation usage history |
| `refresh_tokens` | 001 | JWT refresh token store |

---

## Appendix B: API Route Map

### Auth (`/api/auth`)
| Method | Path | Description |
|---|---|---|
| POST | `/register` | Create account |
| POST | `/login` | Login, returns JWT pair |
| POST | `/refresh` | Refresh access token |
| POST | `/verify-email` | Verify email with code |
| POST | `/forgot-password` | Send reset email |
| POST | `/reset-password` | Reset password with token |
| POST | `/change-password` | Change password (authenticated) |
| GET | `/me` | Get current user profile |
| PUT | `/me` | Update profile |
| POST | `/me/avatar` | Upload avatar |
| POST | `/me/fcm-token` | Register FCM push token |

### Organizations (`/api/organizations`)
| Method | Path | Description |
|---|---|---|
| POST | `/` | Create organization |
| GET | `/` | List user's organizations |
| GET | `/:orgId` | Get organization details |
| PUT | `/:orgId` | Update organization |
| POST | `/:orgId/invite` | Generate invite code |
| POST | `/join` | Join org via invite code |
| GET | `/:orgId/members` | List members |
| PUT | `/:orgId/members/:userId` | Update member role |
| DELETE | `/:orgId/members/:userId` | Remove member |

### Meetings (`/api/meetings`)
| Method | Path | Description |
|---|---|---|
| POST | `/:orgId` | Create meeting |
| GET | `/:orgId` | List org meetings |
| GET | `/:orgId/:meetingId` | Get meeting details |
| PUT | `/:orgId/:meetingId` | Update meeting |
| DELETE | `/:orgId/:meetingId` | Delete meeting |
| POST | `/:orgId/:meetingId/join` | Join meeting (get LiveKit config) |
| POST | `/:orgId/:meetingId/start` | Start meeting (set live) |
| POST | `/:orgId/:meetingId/end` | End meeting (trigger minutes) |
| GET | `/:orgId/:meetingId/transcripts` | Get meeting transcripts |
| GET | `/:orgId/:meetingId/minutes` | Get AI-generated minutes |
| POST | `/:orgId/:meetingId/minutes/generate` | Manually trigger minutes |
| GET | `/:orgId/:meetingId/attendance` | Get attendance records |

### Financials (`/api/financials`)
| Method | Path | Description |
|---|---|---|
| POST | `/:orgId/dues` | Create dues definition |
| GET | `/:orgId/dues` | List dues |
| POST | `/:orgId/dues/:dueId/pay` | Pay dues |
| GET | `/:orgId/transactions` | Transaction history |
| GET | `/:orgId/summary` | Financial summary |
| POST | `/:orgId/fines` | Create fine |
| POST | `/:orgId/donations` | Record donation |

### Payments (`/api/payments`)
| Method | Path | Description |
|---|---|---|
| POST | `/initialize` | Initialize payment flow |
| POST | `/verify` | Verify payment completion |
| POST | `/webhook/stripe` | Stripe webhook handler |
| POST | `/webhook/paystack` | Paystack webhook handler |
| POST | `/webhook/flutterwave` | Flutterwave webhook handler |

### Other Routes
| Base Path | Resource |
|---|---|
| `/api/chat` | Channels, messages |
| `/api/committees` | Committees, members |
| `/api/notifications` | User notifications |
| `/api/announcements` | Org announcements |
| `/api/events` | Events, RSVPs |
| `/api/polls` | Polls, voting |
| `/api/documents` | Document management |
| `/api/analytics` | Org analytics |
| `/api/expenses` | Expense tracking, approvals |
| `/api/subscriptions` | Plan management, billing |
| `/api/admin` | Super admin operations |
| `/api/observability` | Health check, metrics |

---

## Appendix C: LiveKit Migration — Completed

The following migration from Jitsi to LiveKit has been completed:

### Backend Changes (Done)

- [x] Replaced `jitsi.service.ts` with `livekit.service.ts` — JWT token generation using HS256
- [x] Updated `routes/meetings.ts` join endpoint to return LiveKit connection details
- [x] Updated `config.ts` — `config.livekit.{url, apiKey, apiSecret, tokenExpirySeconds}`
- [x] Updated `docker-compose.prod.yml` — removed 4 Jitsi containers, added single LiveKit container
- [x] Updated `deploy/nginx.conf` — replaced `meet.orgsledger.com` with `livekit.orgsledger.com` proxy
- [x] Created `deploy/livekit.yaml` server configuration
- [x] Created `deploy/livekit-setup.md` deployment guide
- [x] Updated `env.js` and `deploy/deploy.sh` — LiveKit env vars

### Frontend Changes (Done)

- [x] Replaced Jitsi iframe in `meetings/[meetingId].tsx` with LiveKit room embed
- [x] Updated `handleJoinMeeting()` — simplified flow, no domain reachability check needed
- [x] Added audio/video toggle buttons to toolbar
- [x] Created dedicated meeting report page at `/meetings/[meetingId]/report`
- [x] Fixed `Colors.cardDark` bug in `LiveTranslation.tsx` (was `undefined`)
- [x] Added responsive `aspectRatio: 16/9` video container (was hardcoded 320px)
- [x] Added `flexWrap` to control bar, `numberOfLines={1}` to tabs

### Performance Improvements (Done)

- [x] Created migration 023 with 7 missing database indexes
- [x] Parallelized 5 sequential queries in member detail endpoint
- [x] Added pagination to admin organizations endpoint

### Pipeline Preservation (Verified)

- [x] Transcription pipeline: Socket.IO based — unaffected
- [x] Translation pipeline: Socket.IO based — unaffected
- [x] Minutes pipeline: DB transcript path — unaffected
- [x] Socket events: All meeting events independent of video provider — unaffected
