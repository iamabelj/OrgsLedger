# OrgsLedger — Post-Deployment Verification Checklist

## After pushing to GitHub and restarting on Hostinger

Run through this checklist to verify everything is working:

## 1. Prerequisites

Before checking anything, ensure these were done on Hostinger:

- [ ] **Pulled latest code from GitHub** (either auto-deploy or manual pull)
- [ ] **Ran "NPM Install"** via hPanel Node.js interface (installs landing dependencies)
- [ ] **Restarted the application** via hPanel Node.js interface

## 2. Gateway Status Check

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

- [ ] **Status shows `gatewayLoaded: true`**

**If `gatewayLoaded: false`:**
```json
{
  "success": false,
  "gatewayLoaded": false,
  "error": "Cannot find module 'pg'",
  "note": "Landing dependencies may not be installed..."
}
```

**Action**: Landing dependencies not installed!
```powershell
# On Hostinger hPanel:
# 1. Node.js → Select app
# 2. Click "Run NPM Install" (this will install landing workspace)
# 3. Click "Restart"
# 4. Check status again
```

## 3. Environment Variables Check

Verify these are set in hPanel → Node.js → Environment Variables:

- [ ] `NODE_ENV` = `production`
- [ ] `PORT` = `3000`
- [ ] `DATABASE_URL` = *(your Neon.tech connection string)*
- [ ] `JWT_SECRET` = *(64+ char random string)*
- [ ] `GATEWAY_JWT_SECRET` = *(64+ char random string, different from JWT_SECRET)*
- [ ] `ADMIN_EMAIL` = `abel@globull.dev` (or your email)
- [ ] `ADMIN_PASSWORD` = *(secure password)*
- [ ] `CORS_ORIGINS` = `https://orgsledger.com,https://app.orgsledger.com`

**After adding/changing env vars, always restart the app!**

## 4. Developer Dashboard Access

Try accessing the dashboard:

**URLs (all should work):**
- `https://app.orgsledger.com/developer/admin`
- `https://orgsledger.com/developer/admin`

- [ ] **Page loads and shows login form**

**If 404 Not Found:** Gateway not loaded properly (check #2)

## 5. Login Test

1. Open developer tools (F12) → Network tab
2. Try logging in with credentials from env vars:
   - Email: value of `ADMIN_EMAIL`
   - Password: value of `ADMIN_PASSWORD`

**Check Network tab for POST request:**
```
POST https://orgsledger.com/api/admin/login
Status: 200 OK
Response: { "token": "eyJ...", "email": "..." }
```

- [ ] **Login succeeds and returns token**
- [ ] **Dashboard loads (Overview page shows)**

**If 401 Unauthorized:** Email/password don't match env vars

**If 500 Internal Server Error:** Check server logs for database error

## 6. API Calls Test

After successful login, check Network tab for API calls:

**Organizations request:**
```
GET https://app.orgsledger.com/api/subscriptions/admin/organizations
Authorization: Bearer eyJ...
Status: 200 OK
Response: { "success": true, "organizations": [...] }
```

- [ ] **API calls return 200 OK**
- [ ] **Organizations list displays**
- [ ] **Stats load correctly**

**If 403 Forbidden:**
- Check `GATEWAY_JWT_SECRET` is set in env vars
- Logout and login again (get fresh token)
- Check server logs for auth errors

**If 401 Unauthorized:**
- Token expired — logout and login again
- Clear browser localStorage and login again

## 7. Database Operations Test

Try creating/editing something:

### Test 1: View Organizations
- [ ] **Organizations page loads**
- [ ] **Can see list of organizations**

### Test 2: View Subscriptions
- [ ] **Subscriptions page loads**
- [ ] **Can see list of subscriptions**

### Test 3: Edit Organization Status
1. Go to Organizations page
2. Click "Suspend" or "Activate" button on any org
3. Check Network tab for response

- [ ] **API call succeeds (200 OK)**
- [ ] **Status updates immediately in UI**
- [ ] **Verify in database that change was saved**

### Test 4: Adjust Wallet
1. Go to AI & Wallets page
2. Click "+ AI" or "+ Trans" button
3. Enter hours and reason
4. Submit

- [ ] **API call succeeds**
- [ ] **Balance updates immediately**
- [ ] **Verify in database**

## 8. Server Logs Check

**On Hostinger hPanel:**
- Node.js → Select app → View Logs

**Look for:**
- [ ] `✓ Landing gateway mounted (orgsledger.com: root, all: /developer)`
- [ ] No errors like `Cannot find module 'pg'`
- [ ] No errors like `GATEWAY_JWT_SECRET not set`

**If you see errors:**
- `Landing gateway FAILED to load` → Dependencies not installed
- `Cannot find module 'pg'` → Run NPM Install again
- `GATEWAY_JWT_SECRET not set` → Add env var and restart

## 9. Main App Health Check

**Test main API:**
- Open: `https://app.orgsledger.com/health`
- Expected: `{ "status": "ok", ... }`

**Test main app (user side):**
- Open: `https://app.orgsledger.com`
- Should show login page for regular users
- Try logging in as a regular user
- Verify app works normally

- [ ] **Main app still works (not broken by landing changes)**
- [ ] **Users can login and use features**

## 10. Final Verification

All green? Then everything should be working!

**Developer dashboard checklist:**
- [ ] Can access `/developer/admin`
- [ ] Can login with admin credentials
- [ ] Can view organizations list
- [ ] Can view subscriptions list
- [ ] Can edit organization status (suspend/activate)
- [ ] Can adjust AI/translation wallets
- [ ] Can view revenue analytics
- [ ] Can view risk monitor alerts
- [ ] Can edit subscription plans
- [ ] Changes save to database and persist

**If ALL checks pass**, the developer dashboard is fully functional! 🎉

## Troubleshooting

If any check fails, see [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) for detailed debugging steps.

**Common issues:**
1. **Landing not loading** → Dependencies not installed → Run NPM Install
2. **403 errors** → GATEWAY_JWT_SECRET not set → Add env var + restart
3. **Changes not saving** → Database connection issue → Check DATABASE_URL
4. **Login fails** → Wrong password → Check ADMIN_PASSWORD env var
5. **404 errors** → Old code still running → Pull latest + restart

## Quick Diagnostic Commands

**Check if gateway is loaded:**
```
curl https://app.orgsledger.com/api/gateway-status
```

**Check health:**
```
curl https://app.orgsledger.com/health
```

**Check if admin login works:**
```powershell
curl -X POST https://orgsledger.com/api/admin/login `
  -H "Content-Type: application/json" `
  -d '{"email":"abel@globull.dev","password":"YOUR_PASSWORD"}'
```

Should return: `{"token":"eyJ...","email":"..."}`

---

## Need Help?

1. Check server logs first (hPanel → Node.js → View Logs)
2. Read [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)
3. Check browser DevTools Console + Network tab
4. Verify all environment variables are set correctly
