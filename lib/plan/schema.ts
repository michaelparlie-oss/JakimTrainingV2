import { z } from "zod";

export const ZONE_CODES = ["E", "L", "REC", "MP", "HMP", "T", "I", "ST", "H", "RACE"] as const;
export type ZoneCode = (typeof ZONE_CODES)[number];

const nullableNum = z.number().nullable();

export const ZoneSchema = z.object({
  code: z.enum(ZONE_CODES),
  name: z.string(),
  pace_min_s_per_km: nullableNum,
  pace_max_s_per_km: nullableNum,
  pace_text: z.string().nullable(),
  hr_min: nullableNum,
  hr_max: nullableNum,
  primary_target: z.enum(["HR", "pace", "feel", "plan"]),
  feel: z.string(),
});
export type Zone = z.infer<typeof ZoneSchema>;
export type Zones = Record<ZoneCode, Zone>;

const ZonesSchema = z.object(
  Object.fromEntries(ZONE_CODES.map((c) => [c, ZoneSchema])) as Record<ZoneCode, typeof ZoneSchema>,
);

export const ZoneSetSchema = z.object({
  label: z.string(),
  basis_10k_s: z.number(),
  used_for: z.string(),
  zones: ZonesSchema,
});

const ZoneRuleSchema = z.object({
  ref: z.enum(["p10", "phm", "goal_mp"]).nullable(),
  lo: nullableNum,
  hi: nullableNum,
  hr: z.tuple([nullableNum, nullableNum]),
});

export const CheckpointSchema = z.object({
  id: z.enum(["CP1", "CP2", "CP3", "CP4"]),
  date: z.string(),
  test: z.string(),
  on_track: z.string(),
  action: z.string(),
});
export type Checkpoint = z.infer<typeof CheckpointSchema>;

export const MetaSchema = z.object({
  athlete: z.string(),
  timezone: z.string(),
  units: z.string(),
  created: z.string(),
  version: z.number(),
  goal_race: z.object({
    name: z.string(),
    date: z.string(),
    distance_km: z.number(),
    goal_time: z.string(),
    goal_pace_s_per_km: z.number(),
  }),
  tune_up_race: z.object({ name: z.string(), date: z.string(), location: z.string(), goal: z.string() }),
  devices: z.array(z.string()),
  run_days: z.array(z.string()),
  strength_days: z.array(z.string()),
  prs_at_creation: z.record(z.string(), z.string()),
  hr_zones_strava: z.record(z.string(), z.any()),
  zone_formula: z.object({
    description: z.string(),
    rules: z.object(
      Object.fromEntries(ZONE_CODES.map((c) => [c, ZoneRuleSchema])) as Record<ZoneCode, typeof ZoneRuleSchema>,
    ),
    current_reference: z.record(z.string(), z.string()),
    note_v3: z.string().optional(),
  }),
  rules: z.record(z.string(), z.string()),
  checkpoints: z.array(CheckpointSchema),
});

export const TemplateItemSchema = z.object({
  exercise: z.string(),
  sets: z.number().int().positive(),
  reps: z.string(),
  rest_s: z.number(),
  rpe: nullableNum,
  note: z.string(),
});
export type TemplateItem = z.infer<typeof TemplateItemSchema>;

export const StrengthTemplateSchema = z.object({
  name: z.string(),
  minutes: z.number(),
  intent: z.string(),
  items: z.array(TemplateItemSchema),
});
export type StrengthTemplate = z.infer<typeof StrengthTemplateSchema>;

export const ExerciseSchema = z.object({
  name: z.string(),
  category: z.string(),
  equipment: z.string(),
  purpose: z.string(),
  how: z.array(z.string()),
  cues: z.array(z.string()),
  mistakes: z.array(z.string()),
  start: z.string(),
  progress: z.string(),
  easier: z.string(),
  harder: z.string(),
});
export type Exercise = z.infer<typeof ExerciseSchema>;

export const WeekSchema = z.object({
  code: z.string(),
  zone_set: z.enum(["v1", "v2", "v3"]),
  phase: z.string(),
  deload: z.boolean(),
  start: z.string(),
  planned_run_km: z.number(),
});
export type Week = z.infer<typeof WeekSchema>;

export const SegmentSchema = z
  .object({
    kind: z.enum(["warmup", "work", "cooldown", "steady", "strides", "race"]),
    zone: z.enum(ZONE_CODES),
    repeat: z.number().int().positive(),
    distance_km: z.number().positive().optional(),
    duration_s: z.number().positive().optional(),
    recovery: z.object({ zone: z.enum(ZONE_CODES), duration_s: z.number().positive() }).optional(),
    note: z.string().optional(),
  })
  .refine((s) => (s.distance_km === undefined) !== (s.duration_s === undefined), {
    message: "A segment must have exactly one of distance_km or duration_s",
  });
export type Segment = z.infer<typeof SegmentSchema>;

const dateRe = /^\d{4}-\d{2}-\d{2}$/;

export const SessionSchema = z
  .object({
    id: z.string(),
    date: z.string().regex(dateRe),
    weekday: z.string(),
    slot: z.enum(["AM", "PM"]),
    week: z.string(),
    phase: z.string(),
    deload_week: z.boolean(),
    zone_set: z.enum(["v1", "v2", "v3"]),
    category: z.enum(["run", "strength", "martial_arts", "rest"]),
    kind: z.enum(["easy", "long", "quality", "test", "race"]).optional(),
    title: z.string(),
    distance_km: z.number().optional(),
    est_duration_min: z.number().optional(),
    rpe: z.string().optional(),
    segments: z.array(SegmentSchema).optional(),
    summary: z.string().optional(),
    optional: z.boolean().optional(),
    post_run_log: z.array(z.string()).optional(),
    template: z.string().optional(),
    status_hint: z.string().optional(),
  })
  .refine((s) => s.category !== "run" || (s.kind && s.distance_km !== undefined && s.segments), {
    message: "Run sessions need kind, distance_km and segments",
  })
  .refine((s) => s.category !== "strength" || !!s.template, { message: "Strength sessions need a template" });
export type PlanSession = z.infer<typeof SessionSchema>;

export const PlanSchema = z
  .object({
    meta: MetaSchema,
    zone_sets: z.object({ v1: ZoneSetSchema, v2: ZoneSetSchema, v3: ZoneSetSchema }),
    strength_templates: z.record(z.string(), StrengthTemplateSchema),
    exercises: z.record(z.string(), ExerciseSchema),
    weeks: z.array(WeekSchema),
    sessions: z.array(SessionSchema),
  })
  .superRefine((p, ctx) => {
    p.sessions.forEach((s, i) => {
      if (s.template && !p.strength_templates[s.template])
        ctx.addIssue({ code: "custom", path: ["sessions", i, "template"], message: `Unknown template ${s.template}` });
      if (!p.weeks.some((w) => w.code === s.week))
        ctx.addIssue({ code: "custom", path: ["sessions", i, "week"], message: `Unknown week ${s.week}` });
    });
    for (const [k, t] of Object.entries(p.strength_templates))
      t.items.forEach((it, j) => {
        if (!p.exercises[it.exercise])
          ctx.addIssue({
            code: "custom",
            path: ["strength_templates", k, "items", j, "exercise"],
            message: `Unknown exercise ${it.exercise}`,
          });
      });
  });
export type Plan = z.infer<typeof PlanSchema>;
