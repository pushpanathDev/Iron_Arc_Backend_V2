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
npm run eval         # the coach eval: real conversations with the real model (needs GROQ_API_KEY)
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
- **`utils/exerciseDatabase.js`** is the list of exercises plans may use (95, each
  named exactly as in the app's catalogue). Every prompt offers only the exercises
  the user's equipment allows and their "Go easy on" areas don't rule out (each
  exercise lists the joints it loads hard). It also decides the order within a
  session and finds the closest replacements. "Go easy on → Other" (`avoidNote`) is
  the user's own words, sent to the AI only as data; one with a danger sign gets
  the safety reply instead of being saved.
- **`utils/planValidator.js`** checks and tidies every plan the AI returns before
  it's saved (made-up or ruled-out exercises replaced, sensible sets and rest,
  session order).
- **The coach chat** is stored inside the plan (`planData._chatHistory`, the last
  40 messages). Every plan change made by the AI is added there with a plain-words
  list of what changed (`utils/planDiff.js`), so the app can show it later.
- The AI only ever sees training facts, never the user's name or email
  (`utils/anonymizer.js`).
- Groq's free tier allows about 8,000 tokens a minute, so the coach and next
  week send one compact week, not the whole plan (`utils/planChat.js`).
- **Coach changes are suggestions.** A change from the chat waits in
  `planData._pendingChange` until the user applies it; applying checks it again
  against the plan as it is then.

### Keeping the coach safe

- **Prompts:** the rules live only in the system message; what the user typed is
  fenced in its own tags and cleaned (`utils/aiText.js`), and replies must match a
  strict shape (`utils/aiReplies.js`).
- **Who may use it** (`middleware/coachAccess.js`, `utils/healthCheck.js`): adults
  who did the health check (8 yes/no questions on the PAR-Q+ topics, plus agreeing
  to the AI terms). Any "yes" turns on **Safe mode**: at most 4 sets, 8+ reps, 60 s
  rest, small steps up (`planValidator`'s `SAFE_LIMITS`), and the prompt's SAFE
  MODE rules. The AI is told only that Safe mode is on, never the answers.
- **Before the AI** (`utils/safetyTriage.js`): danger signs (chest pain, fainting,
  an acute injury, crisis or eating-disorder signs) get a fixed reply, without an
  AI call.
- **After the AI:** a reply with a calorie target, a dose or drugs, or one that
  quotes the coach's own instructions, is replaced; every plan goes through the
  validator's hard limits.
- **Budgets** (`services/aiBudget.js`): AI calls and tokens per user per day, and a
  daily cap for everyone (`AI_USER_DAILY_CALLS`, `AI_USER_DAILY_TOKENS`,
  `AI_DAILY_TOKEN_BUDGET`).
- **Users' say** (`services/aiReportService.js`): reports (reviewed by an admin)
  and thumbs up/down on replies.

### Evaluating the coach

`npm run eval` sends every conversation in `evals/coachCases.js` through the real
chat service and model, with an in-memory database, and grades each reply by
rules (`evals/graders.js`): no plan change for a question, a rest day kept, Safe
mode limits, no calorie targets, no leaked instructions, and so on. It fails if a
critical case fails or under 85% pass. Results go to `evals/results/`. In GitHub
Actions it runs on pull requests that change the coach, every Monday and by hand
(`.github/workflows/coach-eval.yml`, needs the `GROQ_API_KEY` secret). Replies
users rate thumbs down (`GET /api/admin/ai-feedback`) make good new cases.

## Iron Arc Pro

The coach chat and unlimited new AI plans are Pro (`utils/billing.js`). Free
accounts get one new AI plan every 30 days (counted from `plan_generations`, so
deleting a plan doesn't give it back), and next week and swaps on any plan.

- **Plans:** monthly ₹149 or yearly ₹1,199. The first subscription starts with a
  7-day free trial that leads into the chosen plan: once per person, even after
  deleting the account. Only a keyed hash of the email is kept for that
  (`trial_claims`, `utils/trialClaims.js`, `TRIAL_CLAIM_SECRET`).
- **Test payments:** nothing is charged. A checkout writes a receipt with
  `provider: "test"` (`services/billingService.js`); a renewal is recorded when
  the subscription is next read. The provider is kept in one place so Google Play
  Billing can take over.
- **One at a time:** every billing change locks the user's row; a checkout carries
  a key from the app, so a double-tapped Pay starts one subscription.
- **Cancel** keeps Pro until the period ends. **Change plan** switches monthly ↔
  yearly from the next renewal.
- **`PRO_GATE=off`** opens every AI feature to everyone (to deploy before the app
  that has the Pro screen); Pro itself still works.
- **Welcome email:** a new member gets "Welcome to the Pro club" with the receipt
  (`emails/proWelcome.js`, sent through Resend by `services/emailService.js`; a test
  receipt says so). It never holds up a checkout, and a repeated Pay sends none.
  Needs `RESEND_API_KEY` and `EMAIL_FROM`; replies go to `EMAIL_REPLY_TO`.
- **Welcome email** (`emails/welcome.js`, `services/welcomeService.js`): every new account,
  once, when the profile save that completes onboarding comes from a verified email.
  Marked in `users.welcomed_at` first (accounts from before it were marked by its
  migration); a failed send is taken back so the next save tries again.
- **Other Pro emails** (`emails/proLifecycle.js`): "still Pro until" after a cancel; the
  receipt when a renewal is recorded (the next time the subscription is read, so
  usually when the person next opens the app); and "your trial ends soon" two days
  before a trial turns paid, from `POST /api/admin/jobs/trial-reminders`, which
  `.github/workflows/daily-jobs.yml` calls every morning (needs the `ADMIN_SECRET_KEY`
  secret and the `BACKEND_URL` variable in GitHub). Each goes once.
- **Testing the trial again:** `POST /api/admin/user/:uid/subscription/reset`.

## API

All responses are `{ success, data?, message? }`. Paged lists also return
`total`, `page`, `limit`, `totalPages`.

| Area | Endpoints |
|------|-----------|
| Health | `GET /api/health` (public) |
| App | `GET /api/app/version` (public): the latest release, for the in-app update prompt |
| User | `POST /api/user/sync` · `GET /api/user/profile` · `PATCH /api/user/profile` · `PATCH /api/user/preferences` (theme, kg/lb, reps, bars; applied on sign-in) · `PUT /api/user/health-check` · `DELETE /api/user/account` (needs a sign-in from the last 5 minutes) |
| Workouts | `POST /api/workouts` · `POST /api/workouts/batch` (a whole session, all or nothing) · `GET /api/workouts` · `GET`/`PATCH`/`DELETE /api/workouts/:id` |
| Body weight | `POST /api/weights` (one entry per day) · `GET /api/weights` · `GET /api/weights/latest` · `DELETE /api/weights/:id` |
| Custom exercises | `POST /api/exercises` · `GET /api/exercises` · `DELETE /api/exercises/:id` |
| Achievements | `GET /api/achievements` |
| Billing | `GET /api/billing` · `POST /api/billing/checkout` · `POST /api/billing/cancel` · `POST /api/billing/resume` · `POST /api/billing/change-plan` |
| Plans | `GET /api/plans` · `POST /api/plans/generate` · `GET /api/plans/:id` · `POST /api/plans/:id/recalibrate` (next week) · `POST /api/plans/:id/substitute` · `PATCH /api/plans/:id/name` · `PATCH /api/plans/:id/activate` · `DELETE /api/plans/:id` · `POST /api/plans/:id/chat` · `POST /api/plans/:id/chat/report` · `POST /api/plans/:id/chat/feedback` · `POST /api/plans/:id/proposals/:proposalId/apply` · `…/dismiss` |
| Admin | `GET /api/admin/users` · `DELETE /api/admin/user/:uid` · `POST /api/admin/user/:uid/disable` · `GET /api/admin/ai-reports` · `POST /api/admin/ai-reports/:id/reviewed` · `GET /api/admin/ai-feedback` · `POST /api/admin/user/:uid/subscription/reset` · `POST /api/admin/jobs/trial-reminders` (header `x-admin-key`; `:uid` is the Firebase UID) |

Generate, next week, swap and chat are for adults who did the health check (403 `COACH_ADULTS_ONLY` or `HEALTH_CHECK_REQUIRED`); chat needs Pro (`PRO_REQUIRED`) and a new plan needs Pro or the free one (`PLAN_LIMIT_REACHED`). The profile includes `pro` and `freePlan`.

**Rate limits:** 200 requests per 15 minutes per user across the API; 5 plan
generations or "next week"s per hour (`MAX_PLAN_GENERATIONS_PER_HOUR`); 30 coach
messages per hour (`MAX_PLAN_CHATS_PER_HOUR`); 30 admin requests per 15 minutes
per IP.

## Releasing an app update

The app asks `GET /api/app/version` on start, and the answer comes from the
latest GitHub release of [Iron_Arc-app](https://github.com/pushpanathDev/Iron_Arc-app)
(`src/utils/appRelease.js`, read at most every 10 minutes). So publishing a
release there is the whole update, with nothing to change here:

1. Tag `vX.Y.Z` (the app's version), with the APK attached as `Iron-Arc-X.Y.Z.apk`.
2. "What's new" is its bullet points (the bold part of each, up to 8).
3. Tick **Set as the latest release**.

Older apps are offered it, then must update 3 days after it was published
(`APP_UPDATE_GRACE_DAYS`); `APP_MIN_VERSION` makes anything older update at
once. Setting `APP_LATEST_VERSION` switches to manual control (see `.env.example`).
Render needs `GITHUB_TOKEN` (read-only, public repositories): without it GitHub's
60-an-hour limit for Render's shared address runs out and it answers 403.

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
