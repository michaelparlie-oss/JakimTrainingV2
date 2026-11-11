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
  // Several smaller batches: friendlier to request-size limits on hosted databases.
  for (let i = 0; i < q.length; i += 60) await db.batch(q.slice(i, i + 60) as never);
  return { sessions: plan.sessions.length, weeks: plan.weeks.length };
}

/**
 * Seeds the plan when its hash changes. When an existing plan was replaced (a new plan JSON was
 * deployed), stored matches and scores were computed against the old sessions, so re-derive them
 * now; otherwise a run keeps its old analysis (e.g. 3×2 km reps after the session became 2×3 km)
 * until the next sync or log entry. Returns true when the plan was (re)seeded.
 */
export async function ensureSeeded(db: DB, plan: Plan = loadPlan(), hash = planHash()): Promise<boolean> {
  const row = await db.select().from(s.setting).where(eq(s.setting.key, "plan_hash")).get();
  if (row && JSON.parse(row.value_json) === hash) return false;
  await seedPlan(db, plan, hash);
  if (row) {
    try {
      // Dynamic import: recompute pulls in the server data layer, which must not load at DB-module init.
      const { recompute } = await import("@/lib/server/recompute");
      await recompute(db);
    } catch (e) {
      console.error("[seed] plan updated but re-scoring failed; the next sync will retry:", e instanceof Error ? e.message : e);
    }
  }
  return true;
}
