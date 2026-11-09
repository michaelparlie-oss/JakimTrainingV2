# DECISIONS

Choices made where the brief was silent or ambiguous. The simplest option that keeps Mike safe was chosen each time.

## The dynamic plan (adaptive layer)

1. **The JSON plan is never edited.** Every change sits in `session_override` (one row per session: new date, skipped, capped distance, replacement segments, forced deload) and is logged in `plan_change` with the previous state, so **every change can be undone** (More → Plan changes). The "effective plan" (`lib/adapt/effective.ts`) = JSON + overrides. Every screen, the matcher, the rules engine, the zone resolver and `/api/sessions` read the effective plan.
2. **Two sources of change.**
   - *Mike changes the schedule*: move (date picker), skip, shorten, "make it 30 min easy", reset. Moving onto a day that already has a session of the same category in the same slot **swaps** the two, so there are never two runs in one slot. Nothing can move past race day, and race day can't move.
   - *The engine suggests a change* (a "proposal") when his actual training differs from the plan. **Nothing changes until he taps an option** (brief §9). Proposals: cap a run (long-run spike vs. *actual* history), 30 min easy or rest after knee > 3/10, hold the next long run after two knee warnings, repeat a missed week, take a deload early (fatigue HR), skip runs while feverish, move a hard run that ended up back-to-back with another.
3. **`recompute()` after everything.** After every sync, log, schedule change, checkpoint and setting change, matching, scoring, alerts and proposals are rebuilt. Alerts whose condition no longer holds (e.g. after a cap or a move) resolve themselves; stale proposals expire; answering a proposal closes its alert, and Undo reopens it.
4. **Spike check uses real history.** For a future run on day *d*, "your runs" = actual Strava runs before today + the effective plan from today on. If Mike runs less than planned, the next long run gets a cap proposal at `floor(1.1 × max30 × 2) / 2` km. Alerts are raised for the next 7 days only; the Plan screen flags every week. **Race day is exempt** (the 42.2 km race is the only planned session that exceeds 110% of the plan's own 30-day maximum, which is by design). Without any history in the window, nothing is flagged.
5. **Matching swap exception (§7.1).** The brief's rule "±1 day only onto a day with no planned run" is kept, with one addition: if a run is a poor fit for its own day's session (> 50% distance error) but a clear fit for the neighbour's (≤ 20%), it matches the neighbour as `moved`. Typical case: the 16 km long run done on Friday and the 6 km easy run on Saturday. Without this, the long run would be scored as a 270% easy run. Matching is a greedy assignment by cost (relative distance error, +0.35 for a day move).
6. **Repeat week (`missed_week`).** Weeks from the missed one up to the taper shift +7 days. To keep race day and the taper fixed, the **latest pre-taper week that holds no checkpoint is dropped** (marked skipped, with the reason shown). With the current plan that is S11, because S12 holds CP4 (22 May). It is refused, with an explanation, if the missed week is in the taper or is the last pre-taper week. Checkpoints in the shifted weeks move with their week, and the CP pages use the effective date. If accepted mid-week, early repeated days may already be in the past, and the summary says so.
7. **Early deload (`fatigue_hr`).** Next week's runs are capped to the ratio of the *next planned deload week's* km to the week before it (taken from the plan, e.g. B4/B3 = 0.84, B8/B7 = 0.70). Strength sets are halved. Race/test runs are untouched. The originally planned deload stays in place.
8. **Hard back-to-back** (`hard_back_to_back`, info). Not in the brief's rule table; added because moves can create it. It's labelled as a *plan convention* ("your plan always leaves an easier day between them"), not as a research finding.
9. **Missed sessions are never made up** (plan rule "never double up"). Skipping shows that reminder; no rule adds volume.

## Matching and scoring

10. Extra runs (unmatched) aren't stored in `session_match` (its PK is the plan session); they're derived at read time and always count in weekly km.
11. HR compliance for E/L runs counts only the E/L parts of the run, mapped by distance along the planned segments. Strides, fast finishes and recoveries are excluded. The long run allows +5 bpm in the final hour, from `zones.L.feel` ("allow HR up to 160 in the final hour").
12. Rep delta is measured from the nearest edge of the target range; "in range" allows ±5 s/km. HR flag = rep average > zone `hr_max` + 3.
13. Continuous blocks (race segments, a long run's fast finish) are evaluated by position along the route from the stream. Tests/races with zone `RACE` have no pace target, so they score on distance only.
14. **Apple Watch laps (§7.3 request to verify).** Mike's 9 Nov run (Strava 20914544144, 8.01 km, avg HR 146) has **one single lap** for the whole run: it was an open run, not a custom workout. So for now stream-based rep detection is what will work. If he builds custom workouts on the watch (phase 2), laps-first will take over. Re-check this after his first synced quality run.

## Zones

15. All three plan sets reproduce exactly from the formula (unit tests): v1 from 4142 s, v2 from 3990 s, **v3 from the HM 8640 s directly** (`phm = T_HM/21.0975`, `T10 = T_HM/2.10975^1.06`). Rounding: `Math.round` of the unrounded offsets.
16. **Goal changes apply to MP everywhere** at resolution time, because MP depends only on the goal. This avoids a frozen "goal" zone set overriding later v2/v3 projections. Goal history is kept in settings.
17. **CP3 goal options.** The brief says "2:24–2:30 → goal 5:00–5:10 (MP 7:10–7:20)", but 5:00–5:10 is actually MP 7:07–7:21. The app offers 5:00, 5:05 and 5:10 with their true MP shown, plus "keep 4:59", and changes nothing until Mike taps.
18. A checkpoint set is effective from the day after the checkpoint's *effective* date. Re-entering a result deactivates the earlier set for that checkpoint. The sanity guard compares with the set active on that day.
19. CP4 suggestion = average pace of the 1 km splits in the MP part whose average HR was < 165 (needs the linked run's stream). Otherwise the app says no km stayed under 165, so race slower.

## Strava

20. Detail (`/activities/{id}`) includes laps, so `/laps` is called only if absent. Streams only for runs that match a planned run. List re-reads the last 7 days on every sync because Apple Health → Strava uploads can arrive late.
21. Rate limits: the stricter of overall/read headers is used; ≥ 80% of the 15-min limit → wait for the next :00/:15/:30/:45 (+2 s). 429 → same. Daily limit → wait for UTC midnight. On Netlify the client never waits: it stores `paused` with `resume_at` and the next sync after that time resumes (see 30). Self-hosted, it waits up to 60 s in-call.
22. `WeightTraining`/`Workout` are stored and shown as "Watch: weight training 48 min". Walks are ignored.

## Other

23. Auth: an HMAC-signed, HTTP-only cookie (30 days) checked in `proxy.ts` (Next 16's renamed middleware). Changing the passcode in Settings doesn't log out existing cookies; rotate `SESSION_SECRET` for that.
24. `APP_TODAY=YYYY-MM-DD` pretends today is that date (for acceptance checks and demos). Today also accepts `?date=`.
25. Strength: only ticked sets are saved. "Ready to progress" needs a numeric rep target; timed/distance items ("30 s per side", "20 m") never show it.
26. Deload halving uses `ceil(sets/2)` on every template except `L_P1`, `ACT`, `MOB`. A forced (early) deload sets the session's deload flag.

## Hosting: Netlify + Turso (free)

27. **Database = libsql.** The same code talks to a local SQLite file (`file:data/app.db`, native driver) or to Turso over HTTP (`@libsql/client/web`: pure `fetch`, so no native code in serverless functions). The driver is chosen from `TURSO_DATABASE_URL`.
28. **Few round trips.** Each page runs its queries in parallel (8–14 in total, measured), and every set of writes is one `batch` (atomic). GPS streams are left out of normal reads and stored at ≤ 2,500 points (about every 5 s on a 3-hour run). Scores are cached by a hash of everything they depend on (`session_match.score_key`), so streams are reloaded only when a run or its targets change.
29. **Migrations and plan are bundled.** `db/migrations/*.sql` are embedded in `db/migrations.generated.ts` (`npm run db:generate` regenerates it) and applied on first use, tracked in `__app_migrations`. The plan JSON is imported at build time; the DB is seeded when its hash changes.
30. **Sync in steps.** Serverless functions are cut off after about 10 s, so one sync call stops after about 7 s and returns `partial`. The app's Sync button and auto-sync call it again until `ok`. A scheduled Netlify function (every 30 min) calls `/api/strava/sync?loop=1` with `x-cron-secret`. On Strava's rate limit the sync doesn't sleep: it stores `paused` with `resume_at`, and the next call after that time resumes. A `running` flag younger than 30 s prevents overlapping syncs.
31. Docker self-hosting still works, with either Turso or a local file.
