import { eq } from "drizzle-orm";
import type { DB } from "./client";
import * as s from "./schema";
import { loadPlan, planHash } from "@/lib/plan/load";
import type { Plan } from "@/lib/plan/schema";

/** Idempotent import of the plan (one batched write). Logs, overrides and matches are never touched. */
export async function seedPlan(db: DB, plan: Plan = loadPlan(), hash = planHash()): Promise<{ sessions: number; weeks: number }> {
  const q = [];
  for (const w of plan.weeks) {
    const row = { code: w.code, start_date: w.start, phase: w.phase, zone_set: w.zone_set, deload: w.deload, planned_run_km: w.planned_run_km };
    q.push(db.insert(s.planWeek).values(row).onConflictDoUpdate({ target: s.planWeek.code, set: row }));
  }
  for (const x of plan.sessions) {
    const row = {
      id: x.id, date: x.date, slot: x.slot, week: x.week, phase: x.phase, category: x.category, kind: x.kind ?? null,
      title: x.title, distance_km: x.distance_km ?? null, est_duration_min: x.est_duration_min ?? null, zone_set: x.zone_set,
      deload_week: x.deload_week, optional: !!x.optional, template: x.template ?? null,
      segments_json: x.segments ? JSON.stringify(x.segments) : null, summary: x.summary ?? null, rpe_text: x.rpe ?? null,
      post_run_log_json: x.post_run_log ? JSON.stringify(x.post_run_log) : null,
    };
    q.push(db.insert(s.planSession).values(row).onConflictDoUpdate({ target: s.planSession.id, set: row }));
  }
  for (const [id, zs] of Object.entries(plan.zone_sets)) {
    const row = { id, label: zs.label, basis_kind: "projection", basis_seconds: zs.basis_10k_s, goal_time_s: null, created_at: Math.floor(Date.now() / 1000), effective_from_date: null, source: "plan_json", checkpoint_id: null, zones_json: JSON.stringify(zs.zones), active: true };
    const { created_at: _c, ...upd } = row;
    q.push(db.insert(s.zoneSet).values(row).onConflictDoUpdate({ target: s.zoneSet.id, set: upd }));
  }
  const v = JSON.stringify(hash);
  q.push(db.insert(s.setting).values({ key: "plan_hash", value_json: v }).onConflictDoUpdate({ target: s.setting.key, set: { value_json: v } }));
  await db.batch(q as never);
  return { sessions: plan.sessions.length, weeks: plan.weeks.length };
}

export async function ensureSeeded(db: DB): Promise<void> {
  const hash = planHash();
  const row = await db.select().from(s.setting).where(eq(s.setting.key, "plan_hash")).get();
  if (!row || JSON.parse(row.value_json) !== hash) await seedPlan(db, loadPlan(), hash);
}
