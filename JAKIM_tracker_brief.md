# JAKIM 2027 Training Tracker: Build Brief for Claude Code

**Owner:** Mike (single user) · **Created:** 9 Nov 2026 · **Timezone:** Asia/Jakarta (UTC+7) · **Units:** metric, pace in mm:ss per km
**Companion file (required):** `jakim_plan_2027.json`, the complete training plan. It is the source of truth for every session, zone, strength menu and exercise. Do not re-type plan content into code.

---

## 0. TL;DR

Build a small, single-user web app that:

1. Shows **today's session** (run or strength) with exact pace and HR targets, warm-up, intervals and the strength menu, using `jakim_plan_2027.json`.
2. Pulls Mike's runs from **Strava** (recorded on an Apple Watch, synced to Strava). It matches each run to the planned session and scores it: distance, pace and HR against target.
3. Lets Mike **log strength sets** (weight × reps × RPE) and a **knee/bunion pain score**.
4. Applies the plan's **safety rules**: long-run spike warning, knee-pain escalation, easy-run HR drift, missed-session handling.
5. Recalculates **pace zones** when a checkpoint result (race or time trial) is entered.
6. Shows **progress**: weekly km planned vs actual, long-run progression, easy-run efficiency trend, checkpoint results.

Every architecture choice below is already decided, so the app can be built without asking Mike anything. If something is truly ambiguous, choose the simplest option and write the choice in `DECISIONS.md`.

---

## 1. Context

- Goal race: **JAKIM full marathon, Sun 13 Jun 2027**, goal **4:59:00** (7:05 /km).
- Tune-up: **Astra Half Marathon, Sun 29 Nov 2026** (BSD), goal sub-2:40.
- Plan: 31 weeks from Mon 9 Nov 2026. Phases: Astra block (A1–A3), Recovery (R1–R2), Base (B1–B11), Build (S1–S12), Taper (T1–T3).
- Runs on Mon, Wed, Fri and Sat (long run). Strength on Mon PM and Wed PM. Optional Muay Thai/boxing on Tue.
- Device: Apple Watch Workout app → Strava (via Apple Health). **The app reads runs only from Strava.**
- Known issues: knee pain after about 21 km and a bunion. Pain logging and the pain rules are core features, not extras.
- Mike is a beginner at structured training. All copy in the UI must be plain English and must explain itself. Use `exercises[*].how/cues/mistakes` and `zone_sets.*.zones[*].feel` from the JSON.

---

## 2. Goals and non-goals

**Goals (v1)**
- Read-only plan display for every day of the 31 weeks.
- Strava OAuth plus automatic sync of runs.
- Automatic session matching and a compliance score per run.
- Manual strength logging and a pain/RPE log.
- Rules engine with in-app alerts (banner on Today plus an Alerts page).
- Zone recalculation from checkpoint results, versioned.
- Progress charts.
- Runs locally with one command, plus an optional Docker deploy.

**Non-goals (v1)**
- No multi-user accounts, no social features, no payments.
- No writing back to Strava (read-only scopes).
- No native iOS or watch app in v1. A WorkoutKit app is phase 2 (§13).
- No plan generation or AI coaching inside the app. The plan comes from the JSON.

---

## 3. Tech stack (decided)

| Layer | Choice | Why |
| --- | --- | --- |
| Framework | **Next.js (App Router) + TypeScript**, current stable | One codebase for UI and API routes |
| DB | **SQLite** through **Drizzle ORM** (`better-sqlite3`) | Single user, a file DB, zero ops |
| Validation | **Zod** schemas for the plan JSON and Strava responses | Fail loudly on bad data |
| UI | **Tailwind CSS**; mobile-first (used on a phone at the gym or track) | Fast to build |
| Charts | **Recharts** | Simple line and bar charts |
| Dates | **date-fns** + **date-fns-tz**, everything in `Asia/Jakarta` | Plan dates are local dates |
| Tests | **Vitest** for logic; Playwright smoke test optional | Matching and rules must be unit-tested |
| Auth (app) | One passcode in env `APP_PASSCODE`, stored as an HTTP-only session cookie | Single user; the app may be reachable on a VPS |
| Deploy | `npm run dev` locally; `Dockerfile` + volume for `data/app.db` for a VPS (Fly.io, Railway or similar) | SQLite needs a persistent volume. Don't use serverless hosting without one |

Repository layout:

```
/app            (routes: today, week, calendar, session/[id], strength/[id], library, progress, checkpoints, alerts, settings, api/*)
/lib/plan       (load + validate jakim_plan_2027.json, zone resolver)
/lib/strava     (oauth, client with rate-limit handling, sync, description parser)
/lib/match      (session matching + compliance scoring)
/lib/rules      (rules engine)
/lib/zones      (zone formulas + recalculation)
/db             (drizzle schema + migrations)
/data           (jakim_plan_2027.json, app.db)
/tests          (vitest + fixtures)
DECISIONS.md, README.md, .env.example
```

---

## 4. The plan file: `jakim_plan_2027.json`

Load it at startup. Validate it with Zod and import it into SQLite with an idempotent seed (`npm run seed`). Top-level keys:

| Key | Contents |
| --- | --- |
| `meta` | athlete, timezone, goal race, tune-up race, run/strength days, PRs at creation, `hr_zones_strava`, `zone_formula` (rules + description), `rules` (text of every safety rule), `checkpoints` (CP1–CP4) |
| `zone_sets` | `v1` (current), `v2` (projected after CP2), `v3` (projected after CP3). Each has `label`, `basis_10k_s`, `used_for`, `zones{E,L,REC,MP,HMP,T,I,ST,H,RACE}` with `pace_min_s_per_km`, `pace_max_s_per_km`, `pace_text`, `hr_min`, `hr_max`, `primary_target` (`HR`, `pace`, `feel` or `plan`), `feel` |
| `strength_templates` | keyed templates (`A_P0`, `B_P0`, `ACT`, `L_P1`, `A_B1`, `B_B1`, `A_B2`, `B_B2`, `A_S`, `B_S`, `A_T1`, `L_T2`, `MOB`). Each has `name`, `minutes`, `intent`, `items[]` of `{exercise, sets, reps, rest_s, rpe, note}` |
| `exercises` | keyed library: `name, category, equipment, purpose, how[], cues[], mistakes[], start, progress, easier, harder` |
| `weeks` | 31 rows: `code, zone_set, phase, deload, start (Monday), planned_run_km` |
| `sessions` | 207 rows (124 runs, 54 strength, 28 optional martial arts, 1 rest) |

**Session object.** Fields vary by category.

```json
{
  "id": "2026-11-11-AM-run",
  "date": "2026-11-11", "weekday": "Wed", "slot": "AM",
  "week": "A1", "phase": "Astra block", "deload_week": false, "zone_set": "v1",
  "category": "run",               // run | strength | martial_arts | rest
  "kind": "quality",               // easy | long | quality | test | race   (runs only)
  "title": "Astra pace: 3×2 km @ Astra pace / 2 min jog",
  "distance_km": 9.5, "est_duration_min": 77, "rpe": "6–8",
  "segments": [
    {"kind": "warmup",  "zone": "E",   "repeat": 1, "distance_km": 2, "note": "Then 5 min drills…"},
    {"kind": "work",    "zone": "HMP", "repeat": 3, "distance_km": 2, "recovery": {"zone": "REC", "duration_s": 120}},
    {"kind": "cooldown","zone": "E",   "repeat": 1, "distance_km": 1.1}
  ],
  "summary": "…",
  "optional": false,               // true for optional shake-outs and martial arts
  "post_run_log": ["knee_pain_0_10","bunion_pain_0_10","rpe","fuel_g_carbs"]   // long runs only
}
```

Strength sessions carry `template` (a key into `strength_templates`) and a `title` that may include "(deload: half the sets)". When `deload_week` is true and the template is not `L_P1`, `ACT` or `MOB`, the UI must **display every exercise with `ceil(sets/2)`**.

A segment has either `distance_km` or `duration_s`, never both. `segments[].zone` resolves to pace and HR through the **active zone set** (see §8). Never hard-code paces.

---

## 5. Data model (SQLite via Drizzle)

```
plan_session(id PK, date, slot, week, phase, category, kind, title, distance_km, est_duration_min,
             zone_set, deload_week, optional, template, segments_json, summary, rpe_text)
plan_week(code PK, start_date, phase, zone_set, deload, planned_run_km)

zone_set(id PK, label, basis_kind ['10k','hm','projection'], basis_seconds, created_at,
         effective_from_date, source ['plan_json','checkpoint'], zones_json)
-- Active zone set for a date = the latest zone_set with effective_from_date <= date and source='checkpoint';
-- if none, fall back to the plan's projected set named in plan_session.zone_set.

strava_token(id=1, athlete_id, access_token, refresh_token, expires_at, scope)
strava_activity(id PK (Strava id), start_date_local, sport_type, name, description, distance_m,
                moving_time_s, elapsed_time_s, avg_hr, max_hr, avg_speed, total_elevation_gain,
                laps_json, streams_json NULL, raw_json, synced_at)

session_match(plan_session_id PK, strava_activity_id NULL, status ['done','partial','missed','moved','extra'],
              distance_ratio, pace_score, hr_score, overall_score, details_json, matched_at, manual_override BOOL)

strength_log(id PK, plan_session_id, exercise_key, set_no, reps, weight_kg, rpe, note, logged_at)
wellbeing_log(id PK, date, source ['strava_description','manual'], strava_activity_id NULL,
              knee_pain INT 0-10 NULL, bunion_pain INT 0-10 NULL, rpe INT 1-10 NULL, carbs_g INT NULL, note)
checkpoint_result(id PK, checkpoint_id ['CP1'..'CP4'] , date, test_kind ['hm','10k','mp_rehearsal'],
                  time_s NULL, avg_hr NULL, strava_activity_id NULL, created_at)
alert(id PK, created_at, date, rule_id, severity ['info','warn','stop'], message, related_id, dismissed BOOL)
```

---

## 6. Strava integration

**App registration.** Mike creates an API app at `https://www.strava.com/settings/api`. Env vars: `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_REDIRECT_URI` (e.g. `http://localhost:3000/api/strava/callback`). New apps start in single-player mode, which is enough for one athlete.

**OAuth (authorization code).**
- Authorize: `https://www.strava.com/oauth/authorize?client_id=…&response_type=code&redirect_uri=…&approval_prompt=auto&scope=read,activity:read_all`
- Token exchange and refresh: `POST https://www.strava.com/oauth/token` with `grant_type=authorization_code` or `grant_type=refresh_token`.
- Store `access_token`, `refresh_token` and `expires_at`. Refresh **before every call** if `expires_at - now < 5 min`. Strava may rotate the refresh token, so always persist the newest one.

**Endpoints used (base `https://www.strava.com/api/v3`).**
| Purpose | Endpoint |
| --- | --- |
| List runs since a date | `GET /athlete/activities?after=<epoch>&before=<epoch>&per_page=100&page=n` |
| Activity detail (description, laps) | `GET /activities/{id}` |
| Laps | `GET /activities/{id}/laps` |
| Streams for scoring | `GET /activities/{id}/streams?keys=time,distance,heartrate,velocity_smooth,moving&key_by_type=true` |
| Zones (verify HR zones) | `GET /athlete/zones` |

**Rate limits.** Strava's published defaults are 200 requests per 15 min and 2,000 per day overall, with a separate non-upload (read) limit of 100 per 15 min and 1,000 per day. The 15-minute window resets at :00, :15, :30 and :45, and the daily limit at midnight UTC. Usage comes back in the `X-RateLimit-*` and `X-ReadRateLimit-*` headers. Source: <https://developers.strava.com/docs/rate-limits/>.
- Read those headers on every response. If 15-minute usage is ≥ 80% of the limit, pause sync until the next window.
- On a 429, back off until the next 15-minute boundary.
- **Sync strategy:** (a) a "Sync now" button; (b) auto-sync on app open if the last sync is more than 30 min old; (c) initial backfill from **2026-10-01**. Fetch the activity list (1–2 calls), then detail, laps and streams **only for new Run activities that match a planned run**. Cache streams in `streams_json`. Never re-fetch an activity that has already been processed unless the user presses "Re-sync activity".
- Webhooks are optional (phase 1.5). Strava recommends them over polling at scale; polling is fine for one user.

**Filter.** Only `sport_type in (Run, TrailRun, VirtualRun)` count as runs. Store `WeightTraining` and `Workout` activities too, so strength sessions can show watch time and HR when present.

**Description parser.** Mike adds a line such as `knee 2 bunion 1 rpe 5 carbs 60` to the Strava description. Parse case-insensitively with the regex `/(knee|bunion|rpe|carbs)\s*[:=]?\s*(\d{1,3})/gi`. Write the values to `wellbeing_log` (`source='strava_description'`), clamping pain to 0–10 and RPE to 1–10. If nothing parses after a long run, show the prompt "Log knee score for Saturday's long run".

**API terms.** This is a personal, single-athlete app showing Mike his own data. Before deploying, Claude Code should link Strava's API Agreement in the README and keep the app private (passcode). Don't send Strava data to third-party services.

---

## 7. Matching and compliance

### 7.1 Matching a Strava run to a planned run
For each planned **run** session (excluding `optional`):
1. Candidates are Strava runs whose `start_date_local` date equals the plan date.
2. If there are none, look at ±1 day. A candidate there gets `status='moved'`, but only if no planned run exists on that day.
3. With several candidates, choose the one with the smallest `|distance − planned| / planned`. A second run on the same day counts as `extra`, and its distance still goes into weekly totals.
4. If nothing matches by the end of the plan day plus 1 day, the status becomes `missed`.
5. Allow a manual override in the UI (link or unlink an activity).

### 7.2 Scores (0–100)
- **Distance:** `ratio = actual/planned`. Score 100 if 0.95–1.10; scales linearly to 0 at 0.5 or 1.5. Status `done` if ratio ≥ 0.85, otherwise `partial`.
- **For E/L sessions, HR comes first:** HR score = % of moving time with HR ≤ zone `hr_max` (using the heartrate stream; if no stream, use avg HR ≤ hr_max → 100, else 50). Pace is shown, not scored.
- **For quality, test and race sessions, pace comes first:** identify work reps (see 7.3). Pace score = % of work reps whose average pace falls within `[pace_min, pace_max]`, allowing ±5 s/km. Flag any rep whose average HR goes above `hr_max + 3` (informational).
- **Overall:** E/L = 0.5·distance + 0.5·HR. Quality = 0.3·distance + 0.7·pace.
- Show a plain-English verdict, for example "Easy run done right: 92% of the time under 155 bpm" or "Reps 2 and 3 were 12 s/km faster than target; slow down next time."

### 7.3 Finding work reps
1. **Laps first:** if the activity has laps whose count is at least `repeat` of the work segment, and lap distances or durations are within ±15% of the work segment, treat matching laps as reps. (Apple Watch custom workouts usually create a lap per interval; verify with Mike's first synced quality run and record what you find in `DECISIONS.md`.)
2. **Fallback, streams:** after the warm-up distance, slide a window of the work segment's length (distance or time) over `velocity_smooth`, greedily picking the fastest non-overlapping windows, `repeat` times.
3. If neither works, show the rep check as "manual" and still score distance.

---

## 8. Zones: resolution and recalculation

**Resolution.** For a session on date *d*, use the latest `checkpoint`-sourced zone set with `effective_from_date ≤ d`. If none exists, use the plan's projected set named in `plan_session.zone_set` (v1, v2 or v3). The UI must always show which set is active, e.g. "Paces based on your 10K of 1:05:48 (6 Feb)".

**Formula** (`meta.zone_formula`). Every pace zone is `ref_pace + [lo, hi]` seconds per km:
- `p10 = T10 / 10`, where T10 is the 10K time in seconds.
- `phm = T10 × (21.0975/10)^1.06 / 21.0975` (Riegel). If the test was a half marathon, use `phm = T_HM / 21.0975`, and derive `T10 = T_HM / (21.0975/10)^1.06`.
- `goal_mp = goal_time / 42.195` (default 4:59:00). MP does not change with tests unless the goal changes.
- Offsets: E +56/+106 from p10, L +66/+96, REC +116/+176, T +6/+16, I −9/+1, ST −84/−54, HMP +12/+22 from phm, MP −5/+5 from goal_mp. HR ranges are fixed per zone (see JSON).

**On entering a checkpoint result:**
- **CP1 Astra HM** (29 Nov) → new set from the HM, effective 30 Nov.
- **CP2 10K TT** (6 Feb) → new set, effective 7 Feb.
- **CP3 HM TT** (17 Apr) → new set, effective 18 Apr. Also apply the goal rule: ≤ 2:24 keep 4:59; 2:24–2:30 offer a goal of 5:00–5:10 (MP 7:10–7:20); > 2:30 offer a goal of about 5:15. **Ask Mike to confirm before changing the goal.**
- **CP4 dress rehearsal** (22 May): record avg HR on the MP part. If ≥ 165, warn and suggest racing at the pace that kept HR < 165.
- **Sanity guard:** if a new set would make any zone more than 25 s/km faster than the previous set, ask for confirmation, since it may be a typo or a GPS error.

Unit-test the formulas against the JSON: v1 from 4142 s must reproduce `zone_sets.v1.zones` exactly (rounded to the second).

---

## 9. Rules engine (alerts)

Run after every sync and every manual log. Every rule is in `meta.rules`; implement them exactly:

| Rule id | Trigger | Severity | Message (plain English) |
| --- | --- | --- | --- |
| `long_run_spike` | Any run (planned or actual) > 110% of the longest run in the previous 30 days | warn | "This run is X% longer than your longest run in the last 30 days. Research links jumps over 10% to more overuse injuries. Consider capping at Y km." |
| `easy_hr_drift` | E/L run with > 20% of moving time above the zone HR max | info | "Easy run went too hard: Z% above 155 bpm. Slow down or walk briefly next time." |
| `knee_single` | knee_pain > 3 | warn | "Knee above 3/10. Make the next run 30 min easy or rest." |
| `knee_repeat` | two entries with knee_pain > 3 within 14 days | stop | "Two knee-pain warnings in 2 weeks. Please see a physiotherapist before your next long run." |
| `missed_week` | ≥ 3 planned runs in one plan week `missed` | warn | "You missed most of last week. Repeat it instead of moving on? [Repeat week] [Continue]" (Repeat = shift every future session by +7 days only after confirmation; never past race day, and if a shift would compress the taper, refuse and explain) |
| `fatigue_hr` | 7-day avg HR on E runs ≥ 5 bpm above the trailing 28-day avg at similar pace (±15 s/km) | info | "Easy-run heart rate is up. Consider taking the next deload week early." |
| `fever` | manual "ill/fever" toggle | stop | "No running until 24 h fever-free." |
| `prompt_pain_log` | long run synced with no knee value | info | "Log your knee and bunion score for this run." |

Show alerts as a banner on Today (highest severity first) and on the Alerts page with Dismiss. Never auto-modify the plan without a confirmation tap.

---

## 10. Screens

All screens are mobile-first, with a bottom nav: **Today · Week · Plan · Progress · More**.

1. **Today**
   - **Header:** date, week code and phase, and a days-to-race countdown (JAKIM and, until 29 Nov, Astra).
   - **Run card:** title; total km and estimated time; a segment list where every segment shows a pace range and an HR range from the active zone set. Each segment has a zone chip that opens the zone's `feel` text. Warm-up drills note. "Which target wins today: HR (easy) or pace (quality)" badge.
   - **Strength card** (PM): template name and intent, then an exercise list with sets × reps, rest, RPE and the deload halving applied. Tapping an exercise opens its library page. "Start logging" opens the strength logger.
   - **Status** after sync: matched activity, scores, verdict and a pain-log prompt.
   - Rest day: "Rest. Optional: walk or mobility."
2. **Week:** 7 day cards with planned vs done; weekly km planned vs actual; deload badge.
3. **Plan:** 31 weeks grouped by phase; tap a week to open Week. Checkpoint dates highlighted.
4. **Session detail** (`/session/[id]`): full segments; after the run, the rep table (planned vs actual pace and HR per rep) and an HR-over-time chart with the zone band shaded.
5. **Strength logger** (`/strength/[id]`): for each exercise, rows per set with a weight (kg) stepper (±2.5) and reps and RPE pickers, pre-filled with last session's weight for that exercise. Show a "Ready to progress (+2.5–5 kg)" hint when last session's sets all hit their reps at RPE ≤ the template RPE.
6. **Exercise library:** search plus a card per exercise (purpose, numbered how-to, cues, mistakes, start load, progress, easier/harder).
7. **Progress:**
   - Weekly km, planned vs actual: bars plus a planned line.
   - Long-run distance over time, with a 30-day-max+10% band.
   - **Easy-run efficiency:** average pace on E runs where avg HR is 145–155, by week. A falling line is good.
   - Checkpoint results vs targets.
   - Strength: top set weight over time for back squat, trap-bar deadlift and RDL.
   - Knee pain scatter by date, with long-run days marked.
8. **Checkpoints:** CP1–CP4 cards (target, result entry with time or activity link, resulting zone set, goal decision).
9. **Alerts:** list plus dismiss.
10. **Settings:** Strava connect/disconnect and last sync; HR zones (editable, defaults from JSON); goal time; active zone set history; export (JSON/CSV of logs); passcode change.

Copy rules: no jargon without a tap-to-explain. Always show pace as `m:ss /km`, distance to 0.1 km, HR in bpm.

---

## 11. Milestones and acceptance criteria

**M1. Plan viewer.** Seed from JSON; Today, Week, Plan, Session detail and Library work with no Strava.
- On 2026-11-11, Today shows "Astra pace: 3×2 km…" with HMP 7:25–7:35 and HR 163–175, plus the "Strength B – Astra block (short)" card with 5 exercises.
- On 2027-01-04 (deload week B4), Strength A shows halved sets (e.g. goblet squat 2 × 10).
- Weekly planned km equals `weeks[].planned_run_km` for all 31 weeks.

**M2. Strava connect and sync.** OAuth, token refresh, backfill from 2026-10-01, run filter, description parser, rate-limit handling.
- After connecting, the 9 Nov run (Strava id 20914544144, 8.01 km) appears and matches `2026-11-09-AM-run` with status `done`.
- A mocked 429 makes the sync wait and resume without crashing.

**M3. Matching and scoring.** §7 algorithms, verdict text, manual link/unlink.
- Unit tests: same-day match, ±1-day move, two runs on one day, missed, partial; lap-based and stream-based rep detection with fixtures.

**M4. Strength and wellbeing logging.** Strength logger with prefill and a progression hint; manual pain log.

**M5. Rules engine and alerts.** All rules in §9 with unit tests, including spike detection on planned future runs (none of the planned long runs violates it; add a test that a 30 km run after a 20 km max triggers it).

**M6. Zones and checkpoints.** Formulas, versioned zone sets, CP entry flow, goal-change confirmation, sanity guard.
- Entering 10K = 1:06:30 on 6 Feb gives T = 6:45–6:55 and E = 7:35–8:25, matching `zone_sets.v2`.

**M7. Progress charts.** All charts in §10.7 render with real and mock data.

**M8. Packaging.** README (setup, Strava app creation, env vars, seed, run, backup `data/app.db`), `.env.example`, Dockerfile, `DECISIONS.md`.

Definition of done: `npm test` passes, `npm run build` passes, and the M1–M7 acceptance checks have been run and noted in the README.

---

## 12. Security and privacy

- Secrets only in `.env.local` / Docker env; never commit them. Add `.env*` and `data/*.db` to `.gitignore`.
- A passcode gates every page and API route. Tokens stay server-side.
- Health-adjacent data (pain scores) stays in the local DB; no analytics, no third-party scripts.
- Provide "Delete all my data" in Settings, which wipes the DB except the plan.

---

## 13. Phase 2 (don't build in v1, but keep the code ready)

- **Apple Watch workouts through WorkoutKit:** a small SwiftUI iPhone app that reads `/api/sessions?from=&to=` and uses WorkoutKit to create custom workouts (warm-up, work and recovery blocks with pace or HR alerts) and schedule them into the watch's Workout app. Apple introduced this at WWDC23 (<https://developer.apple.com/videos/play/wwdc2023-10016>). Expose a clean JSON endpoint in v1 so this is easy later: each segment with distance or duration, pace range in s/km and an HR range.
- Calendar export (`.ics`) of all sessions with instructions in the description.
- Strava webhooks instead of polling.
- Plan editing in the app (v1 treats the JSON as read-only; a new plan version = re-seed).

---

## 14. Default decisions (so you don't need to ask)

- Week starts Monday. A "plan day" is the local date in Asia/Jakarta.
- A run counts toward the plan day it started on (local time).
- Optional sessions (`optional: true`) never count as missed.
- Martial arts sessions are display-only check-offs.
- If HR data is missing, score pace and distance only and show "no HR data".
- If the plan JSON fails validation, refuse to start and print the Zod error path.
- Distances in the JSON are kilometres. Strava distances are metres, so convert at the boundary.
- Pace display rounds to whole seconds; scoring uses unrounded values.

---

## 15. Files handed over

- `jakim_plan_2027.json`: the plan (validate; don't edit by hand).
- `JAKIM_tracker_brief.md`: this file.
- The human-readable plan lives in Mike's doc "JAKIM 2027 Marathon Plan — Sub-5:00". If the doc and the JSON ever disagree, **the JSON wins** for the app.

## 16. References used in this brief

- Strava API rate limits: <https://developers.strava.com/docs/rate-limits/>
- Strava API getting started (single-player mode, OAuth): <https://developers.strava.com/docs/getting-started/>
- Apple WorkoutKit (WWDC23 session 10016): <https://developer.apple.com/videos/play/wwdc2023-10016>
- Apple Support, custom workouts and alerts on Apple Watch: <https://support.apple.com/guide/watch/apd66fcd5c5c>
- Long-run spike rule: Frandsen JSB et al. (2025) Br J Sports Med 59(17):1203–1210, doi:10.1136/bjsports-2024-109380
