import type { Segment } from "@/lib/plan/schema";
import type { EffSession, OverrideRow, PlanSessionRow, Category, RunKind } from "./types";

export function toEffective(row: PlanSessionRow, ov?: OverrideRow | null): EffSession {
  const segments: Segment[] = row.segments_json ? JSON.parse(row.segments_json) : [];
  const base: EffSession = {
    id: row.id,
    plan_date: row.date,
    date: row.date,
    slot: row.slot as "AM" | "PM",
    week: row.week,
    phase: row.phase,
    category: row.category as Category,
    kind: (row.kind as RunKind) ?? null,
    title: row.title,
    plan_title: row.title,
    distance_km: row.distance_km,
    plan_distance_km: row.distance_km,
    est_duration_min: row.est_duration_min,
    zone_set: row.zone_set as EffSession["zone_set"],
    deload: row.deload_week,
    plan_deload: row.deload_week,
    optional: row.optional,
    template: row.template,
    segments,
    summary: row.summary,
    rpe_text: row.rpe_text,
    post_run_log: row.post_run_log_json ? JSON.parse(row.post_run_log_json) : [],
    skipped: false,
    override: null,
  };
  if (!ov) return base;
  return {
    ...base,
    date: ov.date ?? base.date,
    slot: (ov.slot as "AM" | "PM") ?? base.slot,
    skipped: ov.skipped,
    distance_km: ov.distance_km ?? base.distance_km,
    title: ov.title ?? base.title,
    segments: ov.segments_json ? JSON.parse(ov.segments_json) : base.segments,
    est_duration_min: ov.est_duration_min ?? base.est_duration_min,
    deload: ov.force_deload ?? base.deload,
    override: { reason: ov.reason, source: ov.source as "user" | "adaptation", change_id: ov.change_id },
  };
}

export function buildEffective(rows: PlanSessionRow[], overrides: OverrideRow[]): EffSession[] {
  const byId = new Map(overrides.map((o) => [o.plan_session_id, o]));
  return rows
    .map((r) => toEffective(r, byId.get(r.id)))
    .sort((a, b) => (a.date === b.date ? a.slot.localeCompare(b.slot) : a.date.localeCompare(b.date)));
}

/** Sum of planned distance of segments (distance-based only). */
export function segmentsDistanceKm(segs: Segment[]): number {
  return segs.reduce((t, s) => t + (s.distance_km ?? 0) * s.repeat, 0);
}

/**
 * Scale a run down to `targetKm`, cutting the easy/long ("steady") volume first and never
 * touching the quality reps unless there is nothing else left to cut.
 */
export function capSegments(segs: Segment[], targetKm: number): Segment[] {
  const out = segs.map((s) => ({ ...s }));
  let excess = segmentsDistanceKm(out) - targetKm;
  const order = ["steady", "cooldown", "warmup", "work"] as const;
  for (const kind of order) {
    for (const s of out) {
      if (excess <= 0.001) break;
      if (s.kind !== kind || s.distance_km == null || s.repeat !== 1) continue;
      const min = kind === "warmup" ? 1 : kind === "cooldown" ? 0.5 : 1;
      const cut = Math.min(excess, s.distance_km - min);
      if (cut > 0) {
        s.distance_km = Math.round((s.distance_km - cut) * 10) / 10;
        excess -= cut;
      }
    }
  }
  return out;
}
