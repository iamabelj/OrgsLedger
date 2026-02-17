# Jitsi Secure-Domain Setup for OrgsLedger

## Overview

OrgsLedger uses Jitsi with **token-based authentication** (`authentication = "token"`).
Every participant **must** present a backend-issued JWT to join a meeting.
The meeting creator and org admins join as **moderators** (`affiliation: "owner"`).
Regular members join as **participants** (`affiliation: "member"`).

No anonymous/guest access is allowed. The public fallback has been removed.

---

## 1. Environment Variables (env.js / Server Environment)

```env
JITSI_DOMAIN=meet.orgsledger.com        # Must match Prosody VirtualHost
JITSI_APP_ID=orgsledger                  # Must match app_id in Prosody
JITSI_APP_SECRET=<your-secret-here>      # Must match app_secret in Prosody (min 32 chars)
JITSI_TOKEN_EXPIRY=7200                  # 2 hours (in seconds)
```

**Critical:** `JITSI_DOMAIN`, `JITSI_APP_ID`, and `JITSI_APP_SECRET` must be
identical on both the OrgsLedger API server and the Jitsi/Prosody server.

---

## 2. Prosody Configuration

File: `/etc/prosody/conf.avail/meet.orgsledger.com.cfg.lua`
(or in Docker: `ENABLE_AUTH=1`, `AUTH_TYPE=jwt` in `.env`)

```lua
-- ============================================================
-- Prosody config for OrgsLedger Jitsi (token auth)
-- ============================================================

plugin_paths = { "/usr/share/jitsi-meet/prosody-plugins/" }

-- Main virtualhost — requires JWT authentication
VirtualHost "meet.orgsledger.com"
    authentication = "token"
    app_id = "orgsledger"                    -- Must match JITSI_APP_ID
    app_secret = "<your-secret-here>"        -- Must match JITSI_APP_SECRET
    allow_empty_token = false                -- NEVER allow empty tokens

    ssl = {
        key = "/etc/prosody/certs/meet.orgsledger.com.key";
        certificate = "/etc/prosody/certs/meet.orgsledger.com.crt";
    }

    modules_enabled = {
        "bosh";
        "pubsub";
        "ping";
        "speakerstats";
        "turncredentials";
        "conference_duration";
        "muc_lobby_rooms";
        "av_moderation";
        "token_verification";          -- Verifies JWT claims (aud, iss, sub, room)
        "token_affiliation";           -- Maps context.user.affiliation to XMPP role
    }

    c2s_require_encryption = false
    lobby_muc = "lobby.meet.orgsledger.com"
    main_muc = "conference.meet.orgsledger.com"

-- !! NO guest/anonymous virtualhost !!
-- Do NOT add:
--   VirtualHost "guest.meet.orgsledger.com"
--       authentication = "anonymous"
-- This would allow unauthenticated joins bypassing JWT.

-- MUC (Multi-User Chat) component for conference rooms
Component "conference.meet.orgsledger.com" "muc"
    restrict_room_creation = true
    storage = "memory"
    modules_enabled = {
        "muc_meeting_id";
        "muc_domain_mapper";
        "token_verification";
        "token_affiliation";           -- Grants moderator to affiliation="owner"
    }
    admins = { "focus@auth.meet.orgsledger.com" }
    muc_room_locking = false
    muc_room_default_public_jids = true

-- Lobby MUC for waiting room feature
Component "lobby.meet.orgsledger.com" "muc"
    restrict_room_creation = true
    storage = "memory"
    muc_room_locking = false
    muc_room_default_public_jids = true

-- Internal components (focus, speakerstats, etc.)
Component "internal.auth.meet.orgsledger.com" "muc"
    storage = "memory"
    modules_enabled = { "ping"; }
    admins = { "focus@auth.meet.orgsledger.com", "jvb@auth.meet.orgsledger.com" }
    muc_room_locking = false
    muc_room_default_public_jids = true

VirtualHost "auth.meet.orgsledger.com"
    ssl = {
        key = "/etc/prosody/certs/auth.meet.orgsledger.com.key";
        certificate = "/etc/prosody/certs/auth.meet.orgsledger.com.crt";
    }
    authentication = "internal_hashed"   -- Only for Jicofo/JVB service accounts

Component "focus.meet.orgsledger.com" "client_proxy"
    target_address = "focus@auth.meet.orgsledger.com"

Component "speakerstats.meet.orgsledger.com" "speakerstats_component"
    muc_component = "conference.meet.orgsledger.com"

Component "conferenceduration.meet.orgsledger.com" "conference_duration_component"
    muc_component = "conference.meet.orgsledger.com"

Component "avmoderation.meet.orgsledger.com" "av_moderation_component"
    muc_component = "conference.meet.orgsledger.com"
```

### Key Points
- `authentication = "token"` on main VirtualHost — all XMPP connections require JWT
- `allow_empty_token = false` — reject connections without a token
- `token_verification` module — validates `aud`, `iss`, `sub`, `room`, `exp`
- `token_affiliation` module — reads `context.user.affiliation` from JWT:
  - `"owner"` → XMPP owner/moderator role
  - `"member"` → XMPP participant role
- `authentication = "internal_hashed"` ONLY on `auth.` subdomain (Jicofo/JVB service accounts)
- **No `guest.` virtualhost** — prevents anonymous bypass

---

## 3. Docker Compose (.env for jitsi-docker)

If using the official `jitsi/docker-jitsi-meet` Docker setup:

```env
# Authentication
ENABLE_AUTH=1
AUTH_TYPE=jwt
JWT_APP_ID=orgsledger
JWT_APP_SECRET=<your-secret-here>

# Do NOT enable guest access
ENABLE_GUESTS=0

# Token modules
JWT_ACCEPTED_ISSUERS=orgsledger
JWT_ACCEPTED_AUDIENCES=jitsi

# Domain
XMPP_DOMAIN=meet.orgsledger.com
XMPP_AUTH_DOMAIN=auth.meet.orgsledger.com
XMPP_MUC_DOMAIN=conference.meet.orgsledger.com
XMPP_INTERNAL_MUC_DOMAIN=internal.auth.meet.orgsledger.com

# Token affiliation (grants moderator based on JWT)
JWT_TOKEN_AUTH_MODULE=token_verification
XMPP_MODULES=token_affiliation

# Lobby / waiting room
ENABLE_LOBBY=1
```

---

## 4. JWT Payload (Generated by OrgsLedger API)

### Moderator (meeting creator / org admin)
```json
{
  "aud": "jitsi",
  "iss": "orgsledger",
  "sub": "meet.orgsledger.com",
  "room": "org_abc123def456_meeting_xyz789012345",
  "exp": 1739890800,
  "iat": 1739883600,
  "nbf": 1739883590,
  "context": {
    "user": {
      "id": "user-uuid",
      "name": "John Doe",
      "email": "john@example.com",
      "avatar": "",
      "affiliation": "owner",
      "moderator": true
    },
    "features": {
      "recording": true,
      "livestreaming": false,
      "transcription": false
    }
  },
  "moderator": true
}
```

### Participant (regular member)
```json
{
  "aud": "jitsi",
  "iss": "orgsledger",
  "sub": "meet.orgsledger.com",
  "room": "org_abc123def456_meeting_xyz789012345",
  "exp": 1739890800,
  "iat": 1739883600,
  "nbf": 1739883590,
  "context": {
    "user": {
      "id": "user-uuid",
      "name": "Jane Smith",
      "email": "jane@example.com",
      "avatar": "",
      "affiliation": "member",
      "moderator": false
    },
    "features": {
      "recording": false,
      "livestreaming": false,
      "transcription": false
    }
  },
  "moderator": false
}
```

### Claim Mapping
| JWT Claim | Value | Read By |
|-----------|-------|---------|
| `aud` | `"jitsi"` | Prosody `token_verification` |
| `iss` | `"orgsledger"` (= `app_id`) | Prosody `token_verification` |
| `sub` | `"meet.orgsledger.com"` (= domain) | Prosody `token_verification` |
| `room` | exact room name | Prosody `token_verification` |
| `exp` | Unix timestamp | Prosody `token_verification` |
| `context.user.affiliation` | `"owner"` / `"member"` | Prosody `token_affiliation` |
| `context.user.moderator` | `true` / `false` | Jicofo |
| `moderator` (top-level) | `true` / `false` | lib-jitsi-meet (legacy) |

---

## 5. Frontend Embed Flow

1. User clicks "Join Video Call" / "Join Audio Call"
2. Frontend calls `POST /api/meetings/:orgId/:meetingId/join`
3. Backend validates user/org/meeting, determines moderator status
4. Backend generates JWT with all claims, returns `joinConfig`
5. Frontend builds URL: `https://meet.orgsledger.com/ROOM?jwt=TOKEN#config...`
6. On web: renders in `<iframe>` with `allow="camera; microphone"`
7. On native: opens in `WebBrowser` (Expo in-app browser)
8. Jitsi web app extracts JWT from `?jwt=` query param
9. Prosody validates JWT claims → grants XMPP role based on `affiliation`
10. Creator joins as moderator, others join as participants

---

## 6. Debug Verification Checklist

### Server-Side
- [ ] `JITSI_APP_SECRET` is set and >= 32 characters
- [ ] `JITSI_APP_ID` matches Prosody's `app_id` exactly
- [ ] `JITSI_DOMAIN` matches Prosody's VirtualHost exactly
- [ ] API logs show: `Jitsi JWT generated for user ..., moderator=true, affiliation=owner`
- [ ] No log: `JITSI_APP_SECRET is not configured`
- [ ] Join endpoint returns `joinConfig.jwt` (non-empty string)
- [ ] Decode JWT at https://jwt.io — verify all claims match docs above

### Prosody
- [ ] `authentication = "token"` on main VirtualHost
- [ ] `allow_empty_token = false`
- [ ] `token_verification` module enabled on VirtualHost AND MUC component
- [ ] `token_affiliation` module enabled on VirtualHost AND MUC component
- [ ] No `guest.` VirtualHost with `authentication = "anonymous"`
- [ ] `app_id` and `app_secret` match env vars exactly (no trailing whitespace!)
- [ ] Prosody logs: no `Token verification failed` errors
- [ ] Prosody logs: `Authenticated user ... as owner` for creators

### Jicofo
- [ ] Jicofo reads `context.user.moderator` from JWT
- [ ] First join with `moderator: true` gets moderator role immediately
- [ ] No "waiting for moderator" message for creators

### Frontend
- [ ] API response includes `jwt` field (non-empty)
- [ ] Jitsi URL contains `?jwt=` query parameter
- [ ] No login/authentication dialog appears
- [ ] Creator sees moderator controls (mute all, lobby, kick)
- [ ] Regular member does NOT see moderator controls
- [ ] Different rooms for different meetings (check room name in URL)

### Network
- [ ] HTTPS certificate valid on `meet.orgsledger.com`
- [ ] CORS allows `orgsledger.com` to embed `meet.orgsledger.com` iframe
- [ ] Jitsi server's `config.js` does NOT set `anonymousdomain`
- [ ] No `X-Frame-Options: DENY` header on Jitsi server (blocks iframe)

---

## 7. Jitsi Web Config (config.js on Jitsi server)

Ensure your Jitsi server's `/etc/jitsi/meet/meet.orgsledger.com-config.js` includes:

```javascript
var config = {
    hosts: {
        domain: 'meet.orgsledger.com',
        // !! Do NOT set anonymousdomain !!
        // anonymousdomain: 'guest.meet.orgsledger.com',  // REMOVE THIS
        muc: 'conference.meet.orgsledger.com',
        focus: 'focus.meet.orgsledger.com',
    },
    // Enable token auth
    tokenAuthUrl: true,
    // Other settings...
};
```

**Remove or comment out `anonymousdomain`** — it would allow unauthenticated joins.

---

## 8. Common Errors & Solutions

| Error | Cause | Fix |
|-------|-------|-----|
| "You have been disconnected" | Invalid JWT (wrong secret) | Verify `JITSI_APP_SECRET` matches exactly |
| Login prompt appears | `allow_empty_token` not set / guest domain enabled | Set `allow_empty_token = false`, remove guest VirtualHost |
| "Waiting for moderator" | `token_affiliation` not loaded / `affiliation` missing | Enable `token_affiliation` module, verify JWT has `context.user.affiliation: "owner"` |
| "Meeting not available" | `sub` claim doesn't match VirtualHost | Verify `JITSI_DOMAIN` matches Prosody VirtualHost exactly |
| Token expired | Token TTL too short / clock skew | Increase `JITSI_TOKEN_EXPIRY` to 7200, sync server clocks (NTP) |
| "Could not verify oauthParams" | `aud` or `iss` mismatch | Verify `aud: "jitsi"` and `iss` matches `app_id` |
