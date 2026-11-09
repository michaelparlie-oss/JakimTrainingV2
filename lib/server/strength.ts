import { desc, inArray } from "drizzle-orm";
import type { DB } from "@/db/client";
import * as t from "@/db/schema";
import type { StrengthItemVM } from "./view";

export interface Prefill {
  exercise: string;
  last_weight: number | null;
  last_date: number | null;
  ready_to_progress: boolean;
  current: { set_no: number; weight_kg: number | null; reps: number | null; rpe: number | null }[];
}

/** Leading integer of a reps string ("8 per leg" → 8). Time- or distance-based reps return null. */
export function targetReps(reps: string): number | null {
  if (/\d+\s*(s|m)\b/.test(reps)) return null;
  const m = /^(\d+)/.exec(reps.trim());
  return m ? Number(m[1]) : null;
}

/**
 * Brief §10.5: pre-fill last session's weight; "Ready to progress" when last session's sets all hit
 * their reps at RPE ≤ the template RPE.
 */
export async function strengthPrefill(db: DB, sessionId: string, items: StrengthItemVM[]): Promise<Prefill[]> {
  const keys = items.map((i) => i.exercise);
  const all = keys.length ? await db.select().from(t.strengthLog).where(inArray(t.strengthLog.exercise_key, keys)).orderBy(desc(t.strengthLog.logged_at)).all() : [];
  return items.map((it) => {
    const mine = all.filter((l) => l.exercise_key === it.exercise);
    const current = mine.filter((l) => l.plan_session_id === sessionId).sort((a, b) => a.set_no - b.set_no);
    const prevSession = mine.find((l) => l.plan_session_id !== sessionId)?.plan_session_id;
    const prev = prevSession ? mine.filter((l) => l.plan_session_id === prevSession) : [];
    const weights = prev.map((p) => p.weight_kg).filter((w): w is number => w != null);
    const target = targetReps(it.reps);
    const ready =
      prev.length > 0 && target != null && it.rpe != null &&
      prev.every((p) => (p.reps ?? 0) >= target && p.rpe != null && p.rpe <= it.rpe!);
    return {
      exercise: it.exercise,
      last_weight: weights.length ? Math.max(...weights) : null,
      last_date: prev[0]?.logged_at ?? null,
      ready_to_progress: ready,
      current: current.map((c) => ({ set_no: c.set_no, weight_kg: c.weight_kg, reps: c.reps, rpe: c.rpe })),
    };
  });
}
