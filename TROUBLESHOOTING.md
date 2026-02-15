# OrgsLedger — Troubleshooting Guide

## Developer Dashboard Not Working

### Symptoms
- Can't access `/developer/admin`
- Login page doesn't appear
- Login succeeds but API calls fail with 403 errors
- Changes to organizations/subscriptions not saved

### Diagnostic Steps

#### 1. Check Gateway Status

Open in browser: `https://app.orgsledger.com/api/gateway-status`

**Expected response:**
```json
{
  "success": true,
  "gatewayLoaded": true,
  "adminDashboard": "/developer/admin",
  "loginEndpoint": "/api/admin/login"
}
```

**If `gatewayLoaded: false`:**
```json
{
  "success": false,
  "gatewayLoaded": false,
  "error": "Cannot find module 'pg'",
  "note": "Landing dependencies may not be installed..."
}
```

**Fix**: Landing dependencies not installed.

**Solution**:
```powershell
# On local machine:
cd c:\Users\Globull\Desktop\OrgsLedger
npm install --workspace=landing

# Rebuild and deploy:
cd apps/api
npx tsc
cd ../..
git add -A
git commit -m "fix: install landing dependencies"
git push origin main

# On Hostinger hPanel:
# 1. Go to Node.js app
# 2. Click "Run NPM Install"
# 3. Click "Restart"
```

#### 2. Check Environment Variables

**Required env vars on Hostinger:**

| Variable | Purpose | Where to check |
|----------|---------|----------------|
| `GATEWAY_JWT_SECRET` | Signs developer admin tokens | hPanel → Node.js → Environment Variables |
| `ADMIN_EMAIL` | Developer dashboard login email | Should match your login email |
| `ADMIN_PASSWORD` | Developer dashboard login password | Should match your password |
| `DATABASE_URL` | Database connection | Must be Neon.tech pooled connection string |

**If missing**: Add via hPanel → Node.js → Environment Variables → Add → Restart app

#### 3. Check Login Endpoint

Open browser DevTools (F12) → Network tab

Try logging in at `https://orgsledger.com/developer/admin`

**Expected request:**
```
POST https://orgsledger.com/api/admin/login
Status: 200 OK
Response: { "token": "eyJ...", "email": "..." }
```

**If 404 Not Found**: Gateway not loaded (see #1)

**If 401 Unauthorized**: Wrong email/password (check env vars)

**If 500 Internal Server Error**: Database connection issue

#### 4. Check API Calls

After successful login, DevTools should show:

**Request:**
```
GET https://app.orgsledger.com/api/subscriptions/admin/organizations
Authorization: Bearer eyJ...
```

**Expected:**
```
Status: 200 OK
Response: { "success": true, "organizations": [...] }
```

**If 403 Forbidden (Developer admin access required)**:
- Token verification failed
- `GATEWAY_JWT_SECRET` mismatch between landing server and API server
- Token not being sent (check localStorage: `gw_token`)

**Solution**: Ensure `GATEWAY_JWT_SECRET` is set AND IDENTICAL in both:
1. Landing server (orgsledger.com)
2. Main API server (app.orgsledger.com)

Since both are the same Node.js app, this should happen automatically via `env.js`.

**If 401 Unauthorized**: Token expired or invalid — logout and login again

#### 5. Check Server Logs

**On Hostinger hPanel:**
1. Node.js → Select app → View Logs
2. Look for errors like:
   - `Landing gateway FAILED to load`
   - `Cannot find module 'pg'`
   - `GATEWAY_JWT_SECRET not set`

## Common Issues

### Issue: "Landing dependencies may not be installed"

**Cause**: `landing/` was not in workspaces, so `npm install` didn't install its dependencies

**Fix**: 
1. Ensure `landing` is in root `package.json` workspaces array ✅ (already fixed)
2. Run `npm install` again
3. Redeploy

### Issue: "Changes not saving to database"

**Symptoms**: Can read organizations, but updates/creates don't persist

**Possible causes**:
1. **Database URL wrong** — check `DATABASE_URL` in env vars
2. **Network error** — Neon.tech might be down (check neon.tech status)
3. **Validation errors** — check browser DevTools Console for error messages
4. **Token expired** — logout and login again

**Solution**:
- Open DevTools → Network tab
- Try creating/updating an organization
- Check the API response for error details

### Issue: "403 Developer admin access required"

**Cause**: 
- `GATEWAY_JWT_SECRET` not set
- `GATEWAY_JWT_SECRET` mismatch between login and API verification
- Token signed with wrong secret

**Fix**:
1. Check env vars: `GATEWAY_JWT_SECRET` must be set
2. Logout and login again (get fresh token)
3. Check `env.js` has both `JWT_SECRET` AND `GATEWAY_JWT_SECRET`
4. Restart Node.js app after changing env vars

### Issue: Paystack/Stripe payments not working

**Cause**: Payment gateway keys not set

**Solution**: Add env vars:
- `STRIPE_SECRET_KEY`
- `PAYSTACK_SECRET_KEY`
- `PAYSTACK_PUBLIC_KEY`

### Issue: AI features not working

**Cause**: OpenAI API key not set

**Solution**: Add env var `OPENAI_API_KEY`

## Quick Diagnostic Checklist

Run through this list in order:

- [ ] Gateway status shows `gatewayLoaded: true`
- [ ] Can access `/developer/admin` page (HTML loads)
- [ ] Login works and returns a token
- [ ] Token is stored in localStorage as `gw_token`
- [ ] API calls include `Authorization: Bearer <token>` header
- [ ] API calls return 200 OK (not 401/403)
- [ ] Database changes are saved (check via SQL query)
- [ ] Environment variables are all set correctly
- [ ] Server logs show no errors

## Need More Help?

1. Check server logs: hPanel → Node.js → View Logs
2. Check browser console: F12 → Console tab
3. Check network requests: F12 → Network tab
4. Check database directly: Neon.tech → Query Editor

## Architecture Reference

```
┌─────────────────────────────────────────────────────────────┐
│                  Single Node.js Application                  │
│                    (server.js → apps/api)                    │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  Domain: app.orgsledger.com                                  │
│  ├─ /api/*           → Main API (organizations, chat, etc.) │
│  ├─ /developer/admin → Developer Dashboard                   │
│  └─ /*               → Web App (React SPA)                   │
│                                                               │
│  Domain: orgsledger.com                                      │
│  ├─ /                → Landing page (marketing)              │
│  ├─ /developer/admin → Developer Dashboard (same as above)   │
│  └─ /api/admin/*     → Gateway admin API (login, clients)    │
│                                                               │
└─────────────────────────────────────────────────────────────┘
                              ↓
                    ┌─────────────────────┐
                    │   Neon.tech (DB)    │
                    │   PostgreSQL        │
                    └─────────────────────┘
```

**Key points:**
- Same app serves both domains (domain-based routing)
- Landing server (`landing/server.js`) is mounted as middleware
- Developer dashboard accessible on both domains at `/developer/admin`
- Gateway admin routes only respond on orgsledger.com domain
