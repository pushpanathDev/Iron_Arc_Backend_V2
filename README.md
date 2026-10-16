# Iron Arc Backend

The server behind the Iron Arc fitness app: workouts, body weight, custom
exercises, achievements, and AI training plans with a plan coach. The app signs
in with Firebase; this server checks that sign-in and keeps everything in
Postgres. The Groq API key lives here, never in the app.

**Stack:** Node 22, Express 5, Prisma 7 with Postgres (Supabase), Firebase Admin
(sign-in checks), Groq (AI), zod (request validation). Hosted on Render.

## Run it locally

```bash
npm install          # also generates the Prisma client
cp .env.example .env # then fill it in (see the comments in the file)
npm run dev          # restarts on every save; http://localhost:3000
```

Check it's up: `curl http://localhost:3000/api/health`. The response includes
`"database": "connected"` once Postgres answers.

```bash
npm test             # node --test: every *.test.js, no database or Firebase needed
npm run lint         # ESLint
npm run db:migrate   # create and apply a migration after changing prisma/schema.prisma
```

## How a request flows

```
src/app.js                  security headers, JSON body (50 kb), routes, 404, error handler
 └ routes/*Routes.js        one file per area: sign-in check, validation, then one service call
    ├ middleware/           authMiddleware (Firebase token → req.user), validation (zod),
    │                       rateLimiter, adminMiddleware (x-admin-key), errorHandler
    └ services/*Service.js  the work: database reads and writes, AI calls
       └ utils/             pure helpers: plan prompts, validation and diffs, exercise list,
                            achievement maths, paging. No database, easy to test.
```

- **Signing in.** Every route except `/api/health` and `/api/admin` needs
  `Authorization: Bearer <Firebase ID token>`. `authMiddleware` checks it and
  creates or updates the user's row, so `req.user.dbUser` is always the
  signed-in user. Writes also need a verified email.
- **Errors.** Services throw `HttpError(status, message)` for anything the user
  should see ("Plan not found.", "The coach couldn't answer right now…").
  `errorHandler` turns every error into `{ success: false, message }`; anything
  unexpected is a 500 that hides the details in production. Express 5 passes
  errors from async routes along by itself, so routes have no try/catch.
- **Achievements.** Saving a workout, a weight, a plan or a custom exercise
  checks the badges for that event and returns any new ones as `newlyUnlocked`.
  Badges are never taken back. The catalog is in `utils/achievementDefinitions.js`.

## AI plans

- **`services/aiClient.js`** is the only file that calls Groq: one prompt in, one
  JSON object out, with retries (it waits as long as Groq asks after a 429).
- **Plans are written one week at a time.** `utils/planSchedule.js` decides the
  week (which days, which session, e.g. Push / Pull / Legs twice on Mon–Sat), the
  plan length (8 weeks; 12 for block progression) and the lighter weeks (every
  4th). The AI only fills in the exercises, and a day it leaves out gets the same
  session from another day. "Next week" then writes each following week from
  this one and the user's log.
- **`utils/planPrompts.js`** has the prompts: week 1, next week, swap, coach.
- **`utils/exerciseDatabase.js`** is the list of exercises plans may use. Every
  prompt offers only the exercises the user's equipment allows. It also decides
  the order within a session and finds replacements.
- **`utils/planValidator.js`** checks and tidies every plan the AI returns before
  it's saved (made-up exercises replaced, sensible sets and rest, session order).
- **The coach chat** is stored inside the plan (`planData._chatHistory`, the last
  40 messages). Every plan change made by the AI is added there with a plain-words
  list of what changed (`utils/planDiff.js`), so the app can show it later.
- The AI only ever sees training facts, never the user's name or email
  (`utils/anonymizer.js`).
- Groq's free tier allows about 8,000 tokens a minute, so the coach and next
  week send one compact week, not the whole plan (`utils/planChat.js`).

## API

All responses are `{ success, data?, message? }`. Paged lists also return
`total`, `page`, `limit`, `totalPages`.

| Area | Endpoints |
|------|-----------|
| Health | `GET /api/health` (public) |
| User | `POST /api/user/sync` · `GET /api/user/profile` · `PATCH /api/user/profile` · `DELETE /api/user/account` (needs a sign-in from the last 5 minutes) |
| Workouts | `POST /api/workouts` · `POST /api/workouts/batch` (a whole session, all or nothing) · `GET /api/workouts` · `GET`/`PATCH`/`DELETE /api/workouts/:id` |
| Body weight | `POST /api/weights` (one entry per day) · `GET /api/weights` · `GET /api/weights/latest` · `DELETE /api/weights/:id` |
| Custom exercises | `POST /api/exercises` · `GET /api/exercises` · `DELETE /api/exercises/:id` |
| Achievements | `GET /api/achievements` |
| Plans | `GET /api/plans` · `POST /api/plans/generate` · `GET /api/plans/:id` · `POST /api/plans/:id/recalibrate` (next week) · `POST /api/plans/:id/substitute` · `PATCH /api/plans/:id/name` · `PATCH /api/plans/:id/activate` · `DELETE /api/plans/:id` · `POST /api/plans/:id/chat` |
| Admin | `GET /api/admin/users` · `DELETE /api/admin/user/:uid` · `POST /api/admin/user/:uid/disable` (header `x-admin-key`; `:uid` is the Firebase UID) |

**Rate limits:** 200 requests per 15 minutes per user across the API; 5 plan
generations or "next week"s per hour (`MAX_PLAN_GENERATIONS_PER_HOUR`); 30 coach
messages per hour (`MAX_PLAN_CHATS_PER_HOUR`); 30 admin requests per 15 minutes
per IP.

## Database

The schema is `prisma/schema.prisma`; every change is a migration in
`prisma/migrations`, applied on deploy. Workouts and weights are soft-deleted
(`deletedAt`); deleting a user removes everything of theirs. One rule lives only
in SQL: a user has at most one active plan (`plans_one_active_per_user_idx`).

## Deploying (Render)

Pushing to the deployed branch builds and starts the service. In the Render
dashboard:

- **Build command:** `npm ci && npx prisma migrate deploy`
- **Start command:** `node src/app.js`
- **Health check path:** `/api/health`
- **Environment:** the variables in `.env.example`, with `NODE_ENV=production`.

On the free plan the server sleeps after 15 idle minutes; an uptime monitor
calling `/api/health` every 10 minutes keeps it awake.
