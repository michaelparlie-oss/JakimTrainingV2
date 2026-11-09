import type { Segment } from "@/lib/plan/schema";

export type Category = "run" | "strength" | "martial_arts" | "rest";
export type RunKind = "easy" | "long" | "quality" | "test" | "race";

/** A plan session after Mike's overrides are applied. Everything in the UI and engines uses this. */
export interface EffSession {
  id: string;
  plan_date: string; // date in the JSON plan
  date: string; // effective date (may be moved)
  slot: "AM" | "PM";
  week: string; // plan week code (does not change when moved)
  phase: string;
  category: Category;
  kind: RunKind | null;
  title: string;
  plan_title: string;
  distance_km: number | null;
  plan_distance_km: number | null;
  est_duration_min: number | null;
  zone_set: "v1" | "v2" | "v3";
  deload: boolean;
  plan_deload: boolean;
  optional: boolean;
  template: string | null;
  segments: Segment[];
  summary: string | null;
  rpe_text: string | null;
  post_run_log: string[];
  skipped: boolean;
  override: null | { reason: string; source: "user" | "adaptation"; change_id: number | null };
}

export interface OverrideRow {
  plan_session_id: string;
  date: string | null;
  slot: string | null;
  skipped: boolean;
  distance_km: number | null;
  title: string | null;
  segments_json: string | null;
  est_duration_min: number | null;
  force_deload: boolean | null;
  reason: string;
  source: string;
  change_id: number | null;
}

export interface PlanSessionRow {
  id: string;
  date: string;
  slot: string;
  week: string;
  phase: string;
  category: string;
  kind: string | null;
  title: string;
  distance_km: number | null;
  est_duration_min: number | null;
  zone_set: string;
  deload_week: boolean;
  optional: boolean;
  template: string | null;
  segments_json: string | null;
  summary: string | null;
  rpe_text: string | null;
  post_run_log_json: string | null;
}

export function isHardRun(s: Pick<EffSession, "category" | "kind">): boolean {
  return s.category === "run" && (s.kind === "quality" || s.kind === "long" || s.kind === "test" || s.kind === "race");
}

/** Planned runs that count for compliance (optional shake-outs and skipped runs excluded). */
export function isCountedRun(s: EffSession): boolean {
  return s.category === "run" && !s.optional && !s.skipped;
}
