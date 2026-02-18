# LiveKit Setup for OrgsLedger

## Overview

OrgsLedger uses **LiveKit** for real-time video/audio conferencing with **token-based authentication**.
All participants receive backend-issued tokens — no external login is required.

## Architecture

```text
Client → API (POST /meetings/:orgId/:meetingId/join)
       → API validates JWT, membership, meeting status
       → API generates LiveKit access token
       → Client connects to LiveKit server with token
       → LiveKit handles media transport
```

## Environment Variables

```bash
# LiveKit server WebSocket URL
LIVEKIT_URL=wss://livekit.orgsledger.com

# API key (must match LiveKit server config)
LIVEKIT_API_KEY=orgsledger

# API secret (must match LiveKit server config — min 32 chars)
LIVEKIT_API_SECRET=<your-secret-here>

# Token expiry in seconds (default: 2 hours)
LIVEKIT_TOKEN_EXPIRY=7200
```

## LiveKit Server Config

Located at `deploy/livekit.yaml`. The API key and secret defined there must
match the environment variables above.

## Docker Deployment

LiveKit runs as a single container in `docker-compose.prod.yml`:

```yaml
livekit:
  image: livekit/livekit-server:latest
  ports:
    - "7880:7880"     # HTTP / WebSocket
    - "7881:7881"     # RTC/TCP
    - "7882:7882/udp" # RTC/UDP
  volumes:
    - ./deploy/livekit.yaml:/etc/livekit.yaml:ro
  command: ["--config", "/etc/livekit.yaml"]
```

## Nginx Proxy

LiveKit WebSocket connections are proxied through Nginx at `livekit.orgsledger.com`:

```nginx
upstream livekit_backend {
    server livekit:7880;
}

server {
    listen 443 ssl;
    server_name livekit.orgsledger.com;
    # ... SSL + proxy_pass config
}
```

## DNS Requirements

Add an A record for `livekit.orgsledger.com` pointing to your server IP.

## Token Flow

1. User clicks "Join Meeting" in the app
2. Frontend calls `POST /meetings/:orgId/:meetingId/join`
3. Backend validates:
   - User is authenticated (JWT)
   - User belongs to the organization
   - Meeting exists and is in `live` status
   - Meeting capacity not exceeded
4. Backend generates LiveKit access token with:
   - `roomName` = `org_<orgId>_meeting_<meetingId>` (deterministic)
   - `canPublish` = true (video + audio)
   - `roomAdmin` = true (for moderators only)
5. Frontend connects to LiveKit with the token
6. No external login prompt appears at any point

## Moderator Roles

- **Meeting creator** → always moderator (roomAdmin)
- **Org admins / executives** → moderator (fallback)
- **Regular members** → participant (publish + subscribe only)

## Security

- Tokens are short-lived (2 hours default)
- Room names are deterministic and tenant-isolated
- No anonymous access — all connections require valid tokens
- Token validation is performed by LiveKit server using shared secret
