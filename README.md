# 🏋️ Iron Arc Backend

Backend server for the **Iron Arc** fitness app — Gemini AI planning engine and Firebase Admin operations.

## What This Server Does

| Job | Description |
|-----|-------------|
| **Gemini API Proxy** | Secures the Gemini API key — React Native app cannot hold it safely |
| **AI Planning Engine** | Generates and recalibrates personalised fitness plans using Gemini 1.5 Flash |
| **Firebase Admin Ops** | Admin user deletion, user management (Firebase Admin SDK is server-only) |

---

## Tech Stack

- **Runtime:** Node.js 18+
- **Framework:** Express.js
- **AI:** Google Gemini 1.5 Flash (free tier) via `@google/generative-ai`
- **Auth:** Firebase Admin SDK (server-side JWT verification)
- **Database:** Cloud Firestore via Firebase Admin SDK
- **Deployment:** Render.com (free tier)
- **Keep-alive:** UptimeRobot pinging `GET /api/health` every 10 minutes

---

## Quick Start

### 1. Clone and Install

```bash
git clone <your-repo-url>
cd iron-arc-backend
npm install
```

### 2. Configure Environment Variables

```bash
cp .env.example .env
```

Edit `.env` with your actual values:

| Variable | Where to Get It |
|----------|----------------|
| `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/app/apikey) |
| `FIREBASE_PROJECT_ID` | Firebase Console → Project Settings → General |
| `FIREBASE_CLIENT_EMAIL` | Firebase Console → Project Settings → Service Accounts |
| `FIREBASE_PRIVATE_KEY` | Firebase Console → Project Settings → Service Accounts → Generate New Private Key (copy the `private_key` field from the downloaded JSON) |
| `ADMIN_SECRET_KEY` | Generate a long random string (e.g. `openssl rand -hex 32`) |

> ⚠️ **FIREBASE_PRIVATE_KEY:** Wrap in double quotes in `.env`. The key contains `\n` characters that must be preserved.

### 3. Run Development Server

```bash
npm run dev
```

Server starts at `http://localhost:3000`.

### 4. Verify It's Working

```bash
curl http://localhost:3000/api/health
```

Expected response:
```json
{
  "success": true,
  "app": "Iron Arc Backend",
  "status": "healthy",
  "timestamp": "...",
  "uptime": 5
}
```

---

## API Endpoints

### Health Check
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/health` | None | Keep-alive for UptimeRobot |

### Planning Engine (requires Firebase ID token)
| Method | Endpoint | Auth | Rate Limit | Description |
|--------|----------|------|------------|-------------|
| POST | `/api/plan/generate` | Bearer token | 5/hour | Generate a new AI fitness plan |
| POST | `/api/plan/recalibrate` | Bearer token | 5/hour | Recalibrate existing plan based on performance |
| POST | `/api/plan/substitute` | Bearer token | 30/min | Get a substitute for one exercise |

### Admin (requires `x-admin-key` header)
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/admin/users` | Admin key | List all users (paginated) |
| DELETE | `/api/admin/user/:userId` | Admin key | Completely delete a user |
| POST | `/api/admin/user/:userId/disable` | Admin key | Soft-ban a user |

---

## Authentication

### For Plan Routes (React Native App)
The app sends the Firebase ID token in the `Authorization` header:
```
Authorization: Bearer <firebase_id_token>
```

### For Admin Routes
Admin requests use a static secret key:
```
x-admin-key: <ADMIN_SECRET_KEY>
```

---

## Firestore Data Structure

```
Firestore
├── users/{userId}/                    ← root user document
│   ├── profile/data                   ← user profile (subcollection → fixed doc)
│   ├── workouts/{workoutId}           ← workout sessions
│   └── weights/{weightId}             ← weight log entries
├── exerciseCatalog/v1                 ← remote exercise overrides
└── adminUsers/allowlist               ← admin user IDs
```

> ⚠️ **Important:** Profile is at `users/{userId}/profile/data` — NOT `users/{userId}/profile`

---

## Deployment to Render.com

### 1. Push to GitHub
```bash
git init
git add .
git commit -m "Initial Iron Arc Backend"
git remote add origin <your-github-repo-url>
git push -u origin main
```

### 2. Create Render Web Service
1. Go to [render.com](https://render.com) → New → Web Service
2. Connect your GitHub repo
3. Settings:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Environment:** Node
4. Add all environment variables from `.env` (use the Render dashboard)

> 💡 The `render.yaml` file in this repo auto-configures most settings if you use Render Blueprints.

### 3. Set Up UptimeRobot (Prevent Cold Starts)
1. Go to [uptimerobot.com](https://uptimerobot.com)
2. Create account (free)
3. Add Monitor:
   - **Type:** HTTP(s)
   - **URL:** `https://your-app-name.onrender.com/api/health`
   - **Monitoring Interval:** 10 minutes
4. This prevents Render's free tier from spinning down (which causes 30-60s cold starts)

---

## React Native App Integration

Copy `services/backendApi.js` to your Iron Arc React Native app. It provides:

```javascript
import {
  generateWorkoutPlan,
  recalibrateWeeklyPlan,
  substituteExercise,
  checkBackendHealth,
} from './services/backendApi';
```

Update the `BASE_URL` in that file once your Render deployment is live.

---

## Edge Cases Handled

| # | Edge Case | How It's Handled |
|---|-----------|-----------------|
| EC-01 | Gemini returns fenced JSON | Stripped with regex |
| EC-02 | Gemini returns malformed JSON | Retry up to 3× with backoff |
| EC-03 | Gemini hallucinates exercise IDs | Substituted from server DB |
| EC-04 | Gemini API rate limit | Exponential backoff |
| EC-05 | Firebase private key newlines | `replace(/\\n/g, '\n')` |
| EC-06 | Nodemon re-init Firebase | `admin.apps.length` guard |
| EC-07 | Wrong profile path | Explicit subcollection path |
| EC-08 | Null height/weight | Graceful prompt handling |
| EC-09 | New user (no history) | Conservative plan generation |
| EC-10 | Expired JWT | 401 with re-login message |
| EC-11 | Auth user already deleted | Treated as success |
| EC-12 | Large subcollection (>500 docs) | Batched deletes (400/batch) |
| EC-13 | Partial admin delete failure | 207 with detailed errors |
| EC-14 | Plan generation spam | 5 requests/hour per user |
| EC-15 | Oversized payload | 50kb body limit |
| EC-16 | Render free tier sleep | UptimeRobot ping |
| EC-17 | No active plan on recalibrate | 404 with clear message |
| EC-18 | PII sent to Gemini | Anonymizer strips all PII |

---

## Project Structure

```
iron-arc-backend/
├── src/
│   ├── config/
│   │   ├── firebase.js           ← Firebase Admin SDK init
│   │   └── gemini.js             ← Gemini client init
│   ├── middleware/
│   │   ├── authMiddleware.js     ← Firebase JWT verification
│   │   ├── adminMiddleware.js    ← Admin secret key check
│   │   ├── rateLimiter.js        ← Per-user rate limiting
│   │   └── errorHandler.js       ← Global error handler
│   ├── routes/
│   │   ├── planRoutes.js         ← Planning engine endpoints
│   │   ├── adminRoutes.js        ← Admin user management endpoints
│   │   └── healthRoutes.js       ← UptimeRobot keep-alive endpoint
│   ├── services/
│   │   ├── planningService.js    ← Planning engine orchestration
│   │   ├── geminiService.js      ← Gemini prompt builders + retry logic
│   │   └── adminService.js       ← Firebase Admin delete + list
│   ├── utils/
│   │   ├── exerciseDatabase.js   ← Server-side exercise list + validation
│   │   ├── planValidator.js      ← Validates + sanitizes Gemini JSON output
│   │   └── anonymizer.js         ← Strips PII before sending to Gemini
│   └── app.js                    ← Express app entry point
├── services/
│   └── backendApi.js             ← React Native app integration file
├── .env.example                  ← Environment template (committed)
├── .gitignore
├── package.json
├── render.yaml                   ← Render.com deployment config
└── README.md                     ← This file
```

---

## License

MIT
