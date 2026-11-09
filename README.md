# JAKIM 2027 Training Tracker

A private, single-user web app for Mike's 31-week plan to the **JAKIM full marathon (Sun 13 Jun 2027, goal 4:59:00)**. It shows today's session with exact pace and HR targets, pulls runs from Strava, scores each run against the plan, logs strength and knee/bunion pain, runs the plan's safety rules, and **adapts the plan** when the training doesn't go as written.

## The plan adapts

The JSON plan stays the source of truth and is never edited. On top of it:

| When… | The app… |
| --- | --- |
| You run a session on another day | Matches it anyway (±1 day, or a clear swap like the long run on Friday and the easy run on Saturday) |
| You move, skip or shorten a session | Re-checks the rest of the plan: swaps clashing runs, warns about hard runs back-to-back, re-checks long-run jumps |
| You ran less than planned (or skipped a long run) | Checks the next week's runs against your **actual** longest run in 30 days and offers a cap |
| Knee > 3/10 (Strava description or manual log) | Offers "make the next run 30 min easy" or "rest". Two in 14 days → stop: see a physio before the next long run |
| You missed most of a week | Offers to repeat it, keeping race day and the taper fixed (drops a later non-checkpoint week) |
| Easy-run HR is up ≥ 5 bpm | Offers to take a deload week early |
| Fever | Blocks running until 24 h fever-free and offers to skip those runs |
| You enter a checkpoint result | Recomputes every pace zone from the day after; after CP3 offers a goal change |

Nothing changes until you tap. Every change can be undone (More → Plan changes). Details: `DECISIONS.md`.

## Deploy free: Netlify + Turso

The app runs on **Netlify** (free tier) and keeps its data in **Turso** (free hosted SQLite). Plan for about 20 minutes. You need GitHub, Netlify, Turso and Strava accounts.

**1. Put the code on GitHub.** Create a private repository and push this folder to it (or ask Claude to do it).

**2. Create the Turso database.**
1. Sign up at https://turso.tech (free plan).
2. Create a database (e.g. `jakim`). Pick the **US East** location, close to where Netlify runs its functions.
3. Copy its **URL** (`libsql://jakim-<you>.turso.io`) and create a **token** (dashboard → database → "Create token", or `turso db tokens create jakim`).

**3. Create the Netlify site.**
1. Netlify → **Add new site → Import an existing project** → choose the GitHub repo. The build settings come from `netlify.toml`, so leave them as they are.
2. Before deploying, open **Site configuration → Environment variables** and add:

| Variable | Value |
| --- | --- |
| `APP_PASSCODE` | your passcode |
| `SESSION_SECRET` | a long random string |
| `TURSO_DATABASE_URL` | from step 2 |
| `TURSO_AUTH_TOKEN` | from step 2 |
| `CRON_SECRET` | another long random string |
| `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET` | from step 4 |
| `STRAVA_REDIRECT_URI` | `https://<your-site>.netlify.app/api/strava/callback` |

3. Deploy. Note the site address (`https://<your-site>.netlify.app`). You can rename the site under Site configuration → Site details.

**4. Create the Strava API app.**
1. Go to https://www.strava.com/settings/api and create an app (single-player mode is fine).
2. **Authorization Callback Domain:** `<your-site>.netlify.app` (no `https://`, no path).
3. Put the Client ID and Client Secret into the Netlify variables from step 3, then **Deploys → Trigger deploy** so they take effect.

**5. Use it.** Open the site, log in with your passcode, then Settings → **Connect with Strava** → allow "View data about your private activities". The first sync backfills from 1 Oct 2026 in a few short steps. After that:
- Today syncs when you open it (if the last sync is > 30 min old), or press **Sync now**.
- The scheduled function `netlify/functions/strava-sync.mts` syncs every 30 minutes, even when the app is closed.

The database tables and the plan are created automatically on the first visit.

**Logging pain from the watch:** add a line like `knee 2 bunion 1 rpe 5 carbs 60` to the Strava activity description. The next sync picks it up.

The app uses read-only Strava scopes (`read,activity:read_all`), keeps Strava data in your own Turso database, and is passcode-protected, in line with the [Strava API Agreement](https://www.strava.com/legal/api). Rate limits: https://developers.strava.com/docs/rate-limits/.

**Backup:** Settings → Export (JSON/CSV), or `turso db shell jakim .dump > backup.sql`.

## Run locally

Requirements: Node 22+.

```bash
npm install
```

```bash
cp .env.example .env.local
```

Set `APP_PASSCODE` and `SESSION_SECRET`. Leave `TURSO_*` empty to use a local file (`data/app.db`). For Strava, use `STRAVA_REDIRECT_URI=http://localhost:3000/api/strava/callback` and set the Strava app's callback domain to `localhost`.

```bash
npm run dev
```

Open http://localhost:3000.

### Demo data (no Strava needed)

```bash
APP_TODAY=2026-11-16 npm run demo
```

```bash
APP_TODAY=2026-11-16 npm run dev
```

This loads five runs shaped like real history (two 21 km runs, an easy run, a lap-per-rep quality session, and a long run tagged `knee 5`), so Today shows the knee suggestion and Session shows the rep table and HR chart. Don't run it against your real Turso database.

### Environment variables

| Var | Purpose |
| --- | --- |
| `APP_PASSCODE` | Login passcode (can be changed later in Settings) |
| `SESSION_SECRET` | Signs the login cookie |
| `STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET` / `STRAVA_REDIRECT_URI` | Strava OAuth |
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | Turso database. If empty, the local file `DATABASE_PATH` (default `data/app.db`) |
| `CRON_SECRET` | Lets the scheduled sync function call `/api/strava/sync` |
| `PLAN_PATH` | Optional: load a different plan JSON instead of the bundled one |
| `APP_TODAY` | Optional: pretend today is `YYYY-MM-DD` |

### Self-hosting with Docker (optional)

`Dockerfile` builds a standalone server. Use Turso, or mount a volume at `/app/data` for the SQLite file.

## Tests and checks

```bash
npm test
```

```bash
npm run build
```

`npm test` runs 59 Vitest tests: zone formulas against all three JSON zone sets, matching, rep detection (laps and streams), scoring, every rule, the adaptive actions (cap, swap, repeat week, taper refusal, early deload), the description parser, rate-limit handling, and a mocked end-to-end Strava sync (including the serverless pause/resume and time-budget steps).

### Acceptance checks (run on 9 Nov 2026)

| | Check | Result |
| --- | --- | --- |
| M1 | 11 Nov: "Astra pace: 3×2 km…", HMP 7:25–7:35, HR 163–175, "Strength B – Astra block (short)" with 5 exercises | ✅ Playwright on `APP_TODAY=2026-11-11` |
| M1 | 4 Jan (B4 deload): Strength A halved, goblet squat 2 × 10 | ✅ Playwright |
| M1 | Weekly planned km = `weeks[].planned_run_km` for all 31 weeks | ✅ (optional shake-out excluded) |
| M2 | 9 Nov run 20914544144 (8.01 km) → `2026-11-09-AM-run` done | ✅ mocked-Strava test; numbers match the real activity |
| M2 | Mocked 429 → waits, resumes, no crash | ✅ test |
| M3 | Same-day, ±1 day move, two runs one day, missed, partial; laps and stream reps | ✅ tests |
| M4 | Strength logger prefill + progression hint; manual pain log | ✅ built; checked in browser |
| M5 | All rules incl. 30 km after 20 km max; no planned long run triggers the spike rule (with real pre-plan history) | ✅ tests |
| M6 | 10K 1:06:30 → T 6:45–6:55, E 7:35–8:25 (= v2); v1 and v3 reproduce exactly | ✅ tests |
| M7 | Progress charts render (demo data) | ✅ browser |
| M8 | README, `.env.example`, Netlify config, Dockerfile, DECISIONS.md | ✅ Netlify-mode build run against a local server speaking Turso's HTTP protocol; the full browser flow passed. Not yet run on a real Netlify site or a real Turso database, and the Docker image has not been built (no Docker daemon here). |

## Layout

```
app/          screens (Today, Week, Plan, Session, Strength, Library, Progress, Checkpoints, Alerts, Settings, Log, Changes) + api/*
lib/plan      plan loading and Zod validation (the app refuses to start on a bad plan and prints the Zod path)
lib/adapt     effective plan (overrides) and adaptive actions
lib/match     matching, rep detection, scoring
lib/rules     rules engine (alerts + proposals)
lib/zones     zone formula and resolution
lib/strava    OAuth, rate-limited client, sync, description parser
lib/server    DB orchestration (recompute, changes, checkpoints, views)
db/           Drizzle schema, migrations (embedded into db/migrations.generated.ts)
netlify/      scheduled Strava sync function
tests/        Vitest
```

Phase 2 (WorkoutKit): `GET /api/sessions?from=YYYY-MM-DD&to=YYYY-MM-DD` already returns the effective sessions with each segment's distance/duration, pace range (s/km) and HR range.
