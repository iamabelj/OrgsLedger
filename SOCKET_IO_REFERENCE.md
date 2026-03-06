# Quick Reference: Multilingual Meeting Socket.IO Events

## Client to Server Events

### `meeting:transcript:start`

**Purpose:** Initialize transcript capture for a participant

**Payload:**
```typescript
{
  meetingId: string;        // UUID of the meeting
  participantId: string;    // UUID of participant
  participantName: string;  // Display name
}
```

**Example:**
```typescript
socket.emit('meeting:transcript:start', {
  meetingId: 'meeting-123',
  participantId: 'participant-456',
  participantName: 'John Smith',
});
```

**Response Event:** `meeting:transcript:started`

**Error Event:** `transcript:error`

---

### `meeting:transcript:audio-chunk`

**Purpose:** Send audio data to be transcribed

**Payload:**
```typescript
{
  participantId: string;   // UUID of participant
  audioBuffer: Uint8Array; // Raw audio bytes (16-bit PCM, 16kHz)
}
```

**Example:**
```typescript
// After receiving audio from WebRTC
const audioBuffer = new Uint8Array(audioData);
socket.emit('meeting:transcript:audio-chunk', {
  participantId: 'participant-456',
  audioBuffer,
});
```

**Response Event:** None (sent continuously during meeting)

**Error Event:** `transcript:error`

---

### `meeting:transcript:stop`

**Purpose:** Stop transcript capture for a participant

**Payload:**
```typescript
{
  participantId?: string; // Optional - if not provided, stops all
}
```

**Example:**
```typescript
socket.emit('meeting:transcript:stop', {
  participantId: 'participant-456',
});
```

**Response Event:** None (cleanup happens automatically)

---

## Server to Client Events

### `translation:interim` (Real-time Subtitles)

**Purpose:** Broadcast interim transcripts with translations as participant is speaking

**Payload:**
```typescript
{
  speakerId: string;
  speakerName: string;
  originalText: string;           // What was spoken
  sourceLanguage: string;          // Language spoken (e.g., 'en', 'fr', 'de', 'zh')
  translations: {
    [language: string]: string;    // e.g., { 'en': 'Hello', 'fr': 'Bonjour' }
  };
  timestamp: number;               // Unix ms timestamp
}
```

**Example Received:**
```typescript
socket.on('translation:interim', (payload) => {
  // Show live subtitles
  console.log(`${payload.speakerName}: ${payload.originalText}`);
  
  // Get translation for current user's language
  const userLang = getUserLanguage(); // 'fr'
  if (payload.translations[userLang]) {
    showSubtitle(payload.translations[userLang]);
  }
});
```

**Frequency:** Multiple times per spoken phrase (as Deepgram streams interim results)

---

### `translation:result` (Final Transcript)

**Purpose:** Broadcast final transcript with translations when participant finishes speaking

**Payload:**
```typescript
{
  speakerId: string;
  speakerName: string;
  originalText: string;           // Complete spoken phrase
  sourceLanguage: string;          // Auto-detected language
  translations: {
    [language: string]: string;    // Translations to all meeting languages
  };
  timestamp: number;
  confidence?: number;             // Deepgram confidence (0-1)
}
```

**Example Received:**
```typescript
socket.on('translation:result', (payload) => {
  // Store final transcript
  console.log('Final from', payload.speakerName, ':', payload.originalText);
  
  // Broadcast to all users in their language
  broadcastTranscript(payload);
  
  // Store in chat/transcript history
  addToTranscriptHistory(payload);
});
```

**Frequency:** Once per completed phrase/sentence

---

### `transcript:stored`

**Purpose:** Confirmation that transcript was saved to database

**Payload:**
```typescript
{
  meetingId: string;
  speakerId: string;
  timestamp: number;
}
```

**Example Received:**
```typescript
socket.on('transcript:stored', (payload) => {
  console.log(`Transcript stored for meeting ${payload.meetingId}`);
});
```

---

## Server-Emitted Events (New)

### `meeting:transcript:started`

**Purpose:** Confirm transcript initialization successful

**Payload:**
```typescript
{
  contextId: string;       // Internal reference for this stream
  participantId: string;
  timestamp: number;
}
```

---

### `transcript:language-detected`

**Purpose:** Notify when language is auto-detected

**Payload:**
```typescript
{
  participantId: string;
  language: string;        // e.g., 'en', 'fr', 'de', 'zh'
  confidence: number;      // 0-1, Deepgram confidence
  timestamp: number;
}
```

---

### `transcript:error`

**Purpose:** Notify of transcript capture error

**Payload:**
```typescript
{
  participantId: string;
  error: string;           // Error message
  errorCode: string;       // e.g., 'DEEPGRAM_CONNECTION_FAILED'
  timestamp: number;
  canRecover: boolean;     // Whether system will attempt to reconnect
}
```

---

## Data Flow Example

### Complete Conversation Flow

```
TIME  │ CLIENT             │ SERVER                    │ DB
──────┼────────────────────┼──────────────────────────┼─────────────────
 0    │ meeting:started    │ notify participants      │
      │                    │                          │
 1    │ transcript:start   │ init Deepgram stream     │
      │ John Smith         │ start LiveKit listener   │
      │                    │                          │
 2    │ audio-chunk[100ms] │ send to Deepgram        │
 3    │ audio-chunk[100ms] │ send to Deepgram        │
 4    │ audio-chunk[100ms] │ send to Deepgram        │
      │                    │ ↓ Deepgram processes      │
 5    │                    │ translation:interim      │
      │                    │ "Hello ev..."            │
      │                    │ → broadcast all          │
 6    │ audio-chunk[100ms] │ send to Deepgram        │
 7    │ audio-chunk[100ms] │ send to Deepgram        │
      │                    │ ↓ Speech ends             │
 8    │                    │ translation:result       │
      │                    │ "Hello everyone"         │
      │                    │ + translations           │
      │                    │ → broadcast all          │
      │                    │ ↓ Store in DB             │
 9    │                    │ transcript:stored        │ INSERT
      │                    │ → notify stored          │ meeting_transcripts
      │                    │                          │
10    │ audio-chunk[100ms] │ (next speaker)          │
      │ (Marie speaks)     │                          │
```

---

## Implementation Examples

### React Native (Expo) Client

```typescript
import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';

export function MeetingTranscriptComponent({ meetingId, participantId, participantName }) {
  const socketRef = useRef(null);
  const [transcripts, setTranscripts] = useState<string[]>([]);
  const [liveSubtitle, setLiveSubtitle] = useState('');

  useEffect(() => {
    // Connect to Socket.IO
    socketRef.current = io('https://api.orgsledger.com');

    // Start transcript
    socketRef.current.emit('meeting:transcript:start', {
      meetingId,
      participantId,
      participantName,
    });

    // Listen for interim results
    socketRef.current.on('translation:interim', (payload) => {
      const userLang = getUserLanguage();
      setLiveSubtitle(
        payload.translations[userLang] || payload.originalText
      );
    });

    // Listen for final results
    socketRef.current.on('translation:result', (payload) => {
      const userLang = getUserLanguage();
      setTranscripts((prev) => [
        ...prev,
        `${payload.speakerName}: ${payload.translations[userLang] || payload.originalText}`,
      ]);
      setLiveSubtitle('');
    });

    // Listen for errors
    socketRef.current.on('transcript:error', (error) => {
      console.error('Transcript error:', error);
      // Attempt recovery or notify user
    });

    return () => {
      socketRef.current?.emit('meeting:transcript:stop');
      socketRef.current?.disconnect();
    };
  }, [meetingId, participantId, participantName]);

  // Send audio chunks (from WebRTC or device audio)
  const sendAudioChunk = (audioBuffer: Uint8Array) => {
    socketRef.current?.emit('meeting:transcript:audio-chunk', {
      participantId,
      audioBuffer,
    });
  };

  return (
    <View>
      {/* Live subtitle display */}
      {liveSubtitle && (
        <Text>{liveSubtitle}</Text>
      )}

      {/* Transcript history */}
      {transcripts.map((t, i) => (
        <Text key={i}>{t}</Text>
      ))}
    </View>
  );
}
```

### Node.js Server (Socket.IO Handler)

```typescript
import { registerMultilingualMeetingHandlers } from './services/multilingualMeeting.socket';

io.on('connection', (socket: Socket) => {
  const userId = socket.handshake.auth.userId; // JWT decoded user ID

  // Register handlers
  registerMultilingualMeetingHandlers(io, socket);

  socket.on('meeting:transcript:start', async (data) => {
    console.log(`=== Transcript Started ===`);
    console.log(`User: ${userId}`);
    console.log(`Meeting: ${data.meetingId}`);
    console.log(`Participant: ${data.participantName}`);

    // Handler processes and emits translation:interim/result events
  });

  socket.on('meeting:transcript:audio-chunk', async (data) => {
    console.log(`Audio chunk received for ${data.participantId} (${data.audioBuffer.length} bytes)`);
    
    // Audio is automatically sent to Deepgram by the handler
  });
});
```

---

## Supported Languages

Deepgram nova-2-general supports 50+ languages including:

| Language | Code | Example |
|----------|------|---------|
| English | `en` | "Hello everyone" |
| Spanish | `es` | "Hola a todos" |
| French | `fr` | "Bonjour à tous" |
| German | `de` | "Hallo zusammen" |
| Mandarin Chinese | `zh` | "大家好" |
| Japanese | `ja` | "皆さんこんにちは" |
| Korean | `ko` | "안녕하세요 여러분" |
| Russian | `ru` | "Привет всем" |
| Portuguese | `pt` | "Olá a todos" |
| Italian | `it` | "Ciao a tutti" |
| Dutch | `nl` | "Hallo iedereen" |
| Polish | `pl` | "Cześć wszystkich" |
| Turkish | `tr` | "Merhaba herkese" |
| Hindi | `hi` | "नमस्ते सभी को" |
| Arabic | `ar` | "مرحبا بالجميع" |

Full list: https://developers.deepgram.com/reference/get-supported-languages

---

## Performance Tips

### 1. Audio Chunk Size
```typescript
// Optimal: Send chunks of 1024 bytes at a time
const CHUNK_SIZE = 1024;
for (let i = 0; i < audioBuffer.length; i += CHUNK_SIZE) {
  const chunk = audioBuffer.slice(i, i + CHUNK_SIZE);
  socket.emit('meeting:transcript:audio-chunk', {
    participantId,
    audioBuffer: chunk,
  });
}
```

### 2. Handle Lost Connections
```typescript
socket.on('disconnect', () => {
  // Automatically cleans up transcripts
  console.log('Disconnected - transcripts stopped');
});

socket.on('connect_error', (error) => {
  console.error('Connection error:', error);
  // Attempt reconnect
});
```

### 3. Monitor Latency
```typescript
const startTime = Date.now();
socket.emit('meeting:transcript:audio-chunk', { /* ... */ });

socket.on('translation:interim', (payload) => {
  const latency = Date.now() - startTime;
  console.log(`Latency: ${latency}ms`);
  // Target: < 1500ms
});
```

### 4. Cache User Language Preference
```typescript
// Don't query DB on every transcript
const USER_LANGUAGE_CACHE = new Map<string, string>();

function getUserLanguage(userId: string): string {
  if (USER_LANGUAGE_CACHE.has(userId)) {
    return USER_LANGUAGE_CACHE.get(userId)!;
  }
  
  const lang = queryUserLanguageFromDB(userId);
  USER_LANGUAGE_CACHE.set(userId, lang);
  return lang;
}
```

---

## Debugging

### Enable Verbose Logging

In `apps/api/src/logger.ts`:
```typescript
const { createLogger, format, transports } = require('winston');

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'debug', // Set to 'debug' for verbose
  format: format.json(),
  transports: [
    new transports.File({ filename: 'logs/multilingual.log' }),
    new transports.Console(),
  ],
});
```

### Monitor Deepgram Requests

```bash
# SSH to VPS
tail -f logs/multilingual.log | grep -E "(Deepgram|DeepgramRealtimeService)"
```

Expected output:
```
[2026-03-05T14:23:45.123Z] DEBUG: DeepgramRealtimeService.createStream - streamId: stream_123
[2026-03-05T14:23:45.456Z] DEBUG: Deepgram connection established
[2026-03-05T14:23:47.789Z] DEBUG: Transcript received: "Hello everyone" (language: en)
[2026-03-05T14:23:48.123Z] DEBUG: Translation cached: en->fr (5ms)
```

### Check Translation Cache

```typescript
// In any service method:
console.log('Cache stats:', multilingualTranslationPipeline.getCacheStats());
// Output: { size: 42, hits: 156, misses: 23, hitRate: 0.871 }
```

---

## Frequently Asked Questions

**Q: Can I have both English and Deepgram STT simultaneously?**
A: Yes. The new pipeline is additive. Existing translation events from old pipeline will still work.

**Q: What if Deepgram is down?**
A: System logs error and stops sending transcripts. Meetings continue normally. No crash.

**Q: How many languages can a meeting support?**
A: Unlimited. System will translate to all languages present in the meeting.

**Q: Is audio stored or logged?**
A: No. Audio is streamed directly to Deepgram and discarded. Only transcripts are stored.

**Q: Can I customize translation languages?**
A: Yes. Users set their preferred language in settings. Queries user_language_preferences table.

**Q: What's the maximum latency?**
A: Target <1.5s from speech → transcript → translation → broadcast. May vary with network.

---

**Version:** 1.0.0
**Last Updated:** March 5, 2026
**Status:** Production Ready

