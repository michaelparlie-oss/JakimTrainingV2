import { sqliteTable, text, integer, real, uniqueIndex, index } from "drizzle-orm/sqlite-core";

// ---- Plan (seeded from data/jakim_plan_2027.json; read-only) ----
export const planSession = sqliteTable(
  "plan_session",
  {
    id: text("id").primaryKey(),
    date: text("date").notNull(),
    slot: text("slot").notNull(),
    week: text("week").notNull(),
    phase: text("phase").notNull(),
    category: text("category").notNull(),
    kind: text("kind"),
    title: text("title").notNull(),
    distance_km: real("distance_km"),
    est_duration_min: real("est_duration_min"),
    zone_set: text("zone_set").notNull(),
    deload_week: integer("deload_week", { mode: "boolean" }).notNull(),
    optional: integer("optional", { mode: "boolean" }).notNull().default(false),
    template: text("template"),
    segments_json: text("segments_json"),
    summary: text("summary"),
    rpe_text: text("rpe_text"),
    post_run_log_json: text("post_run_log_json"),
  },
  (t) => [index("plan_session_date").on(t.date)],
);

export const planWeek = sqliteTable("plan_week", {
  code: text("code").primaryKey(),
  start_date: text("start_date").notNull(),
  phase: text("phase").notNull(),
  zone_set: text("zone_set").notNull(),
  deload: integer("deload", { mode: "boolean" }).notNull(),
  planned_run_km: real("planned_run_km").notNull(),
});

export const zoneSet = sqliteTable("zone_set", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  basis_kind: text("basis_kind").notNull(), // '10k' | 'hm' | 'projection'
  basis_seconds: real("basis_seconds"),
  goal_time_s: integer("goal_time_s"),
  created_at: integer("created_at").notNull(),
  effective_from_date: text("effective_from_date"),
  source: text("source").notNull(), // 'plan_json' | 'checkpoint' | 'goal'
  checkpoint_id: text("checkpoint_id"),
  zones_json: text("zones_json").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

// ---- Adaptive layer: the plan JSON is never edited; changes are overrides on top of it ----
export const sessionOverride = sqliteTable("session_override", {
  plan_session_id: text("plan_session_id").primaryKey(),
  date: text("date"), // moved to this date
  slot: text("slot"),
  skipped: integer("skipped", { mode: "boolean" }).notNull().default(false),
  distance_km: real("distance_km"),
  title: text("title"),
  segments_json: text("segments_json"),
  est_duration_min: real("est_duration_min"),
  force_deload: integer("force_deload", { mode: "boolean" }),
  reason: text("reason").notNull(),
  source: text("source").notNull(), // 'user' | 'adaptation'
  change_id: integer("change_id"),
  updated_at: integer("updated_at").notNull(),
});

/** Every plan change (user edit or accepted proposal), with the previous override state so it can be undone. */
export const planChange = sqliteTable("plan_change", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  created_at: integer("created_at").notNull(),
  kind: text("kind").notNull(), // move | swap | skip | unskip | cap | replace | repeat_week | early_deload | reset
  summary: text("summary").notNull(),
  before_json: text("before_json").notNull(), // [{plan_session_id, override|null}]
  proposal_id: integer("proposal_id"),
  undone: integer("undone", { mode: "boolean" }).notNull().default(false),
});

/** Adjustments suggested by the adaptive engine. Nothing changes until Mike taps an option. */
export const proposal = sqliteTable(
  "proposal",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    fingerprint: text("fingerprint").notNull(),
    created_at: integer("created_at").notNull(),
    rule_id: text("rule_id").notNull(),
    date: text("date").notNull(),
    title: text("title").notNull(),
    rationale: text("rationale").notNull(),
    options_json: text("options_json").notNull(), // [{label, action}]
    status: text("status").notNull().default("pending"), // pending | accepted | declined | expired
    decided_at: integer("decided_at"),
    chosen_option: integer("chosen_option"),
  },
  (t) => [uniqueIndex("proposal_fp").on(t.fingerprint)],
);

// ---- Strava ----
export const stravaToken = sqliteTable("strava_token", {
  id: integer("id").primaryKey(),
  athlete_id: integer("athlete_id"),
  access_token: text("access_token").notNull(),
  refresh_token: text("refresh_token").notNull(),
  expires_at: integer("expires_at").notNull(),
  scope: text("scope"),
});

export const stravaActivity = sqliteTable(
  "strava_activity",
  {
    id: integer("id").primaryKey(),
    start_date_local: text("start_date_local").notNull(),
    local_date: text("local_date").notNull(),
    sport_type: text("sport_type").notNull(),
    name: text("name"),
    description: text("description"),
    distance_m: real("distance_m"),
    moving_time_s: integer("moving_time_s"),
    elapsed_time_s: integer("elapsed_time_s"),
    avg_hr: real("avg_hr"),
    max_hr: real("max_hr"),
    avg_speed: real("avg_speed"),
    total_elevation_gain: real("total_elevation_gain"),
    laps_json: text("laps_json"),
    streams_json: text("streams_json"),
    raw_json: text("raw_json"),
    detail_fetched: integer("detail_fetched", { mode: "boolean" }).notNull().default(false),
    synced_at: integer("synced_at").notNull(),
  },
  (t) => [index("activity_local_date").on(t.local_date)],
);

export const sessionMatch = sqliteTable("session_match", {
  plan_session_id: text("plan_session_id").primaryKey(),
  strava_activity_id: integer("strava_activity_id"),
  status: text("status").notNull(), // done | partial | missed | moved | skipped
  distance_ratio: real("distance_ratio"),
  distance_score: real("distance_score"),
  pace_score: real("pace_score"),
  hr_score: real("hr_score"),
  overall_score: real("overall_score"),
  verdict: text("verdict"),
  details_json: text("details_json"),
  /** Hash of everything the score depends on; unchanged key → the stored score is reused (no stream reload). */
  score_key: text("score_key"),
  matched_at: integer("matched_at").notNull(),
  manual_override: integer("manual_override", { mode: "boolean" }).notNull().default(false),
});

// ---- Logs ----
export const strengthLog = sqliteTable("strength_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  plan_session_id: text("plan_session_id").notNull(),
  exercise_key: text("exercise_key").notNull(),
  set_no: integer("set_no").notNull(),
  reps: integer("reps"),
  weight_kg: real("weight_kg"),
  rpe: real("rpe"),
  note: text("note"),
  logged_at: integer("logged_at").notNull(),
});

export const wellbeingLog = sqliteTable("wellbeing_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull(),
  source: text("source").notNull(), // strava_description | manual
  strava_activity_id: integer("strava_activity_id"),
  knee_pain: integer("knee_pain"),
  bunion_pain: integer("bunion_pain"),
  rpe: integer("rpe"),
  carbs_g: integer("carbs_g"),
  note: text("note"),
  created_at: integer("created_at").notNull(),
});

export const checkpointResult = sqliteTable("checkpoint_result", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  checkpoint_id: text("checkpoint_id").notNull(),
  date: text("date").notNull(),
  test_kind: text("test_kind").notNull(), // hm | 10k | mp_rehearsal
  time_s: integer("time_s"),
  avg_hr: real("avg_hr"),
  strava_activity_id: integer("strava_activity_id"),
  zone_set_id: text("zone_set_id"),
  note: text("note"),
  created_at: integer("created_at").notNull(),
});

export const alert = sqliteTable(
  "alert",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    key: text("key").notNull(),
    created_at: integer("created_at").notNull(),
    date: text("date").notNull(),
    rule_id: text("rule_id").notNull(),
    severity: text("severity").notNull(), // info | warn | stop
    message: text("message").notNull(),
    related_id: text("related_id"),
    proposal_id: integer("proposal_id"),
    dismissed: integer("dismissed", { mode: "boolean" }).notNull().default(false),
    resolved: integer("resolved", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [uniqueIndex("alert_key").on(t.key)],
);

export const setting = sqliteTable("setting", {
  key: text("key").primaryKey(),
  value_json: text("value_json").notNull(),
});
