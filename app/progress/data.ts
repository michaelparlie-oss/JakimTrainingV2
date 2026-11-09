import type { DB } from "@/db/client";
import { isCountedRun } from "@/lib/adapt/types";
import { isRunActivity } from "@/lib/match/types";
import { loadPlan } from "@/lib/plan/load";
import { progressData } from "@/lib/server/progress";
import type { Ctx } from "@/lib/server/view";
import { addDays, diffDays } from "@/lib/util/dates";

/** Read-only view model for the Progress dashboard (built from data the app already computes). */
export interface WeekRow {
  code: string;
  start: string;
  phase: string;
  deload: boolean;
  past: boolean; // week has started
  current: boolean;
  planned: number;
  actual: number | null;
  runsDue: number;
  runsDone: number;
  avgScore: number | null;
  longPlanned: number | null;
  longActual: number | null;
  cap: number | null;
  effPace: number | null;
  kneeMax: number | null;
}

export interface RunRow {
  id: string;
  date: string;
  week: string;
  title: string;
  kind: string;
  plannedKm: number | null;
  actualKm: number | null;
  pace: number | null;
  hr: number | null;
  score: number | null;
  status: string;
  verdict: string | null;
}

export interface DashboardData {
  today: string;
  daysToRace: number;
  weeks: WeekRow[];
  runs: RunRow[];
  strength: { date: string; back_squat?: number; trap_bar_dl?: number; rdl?: number }[];
  knee: { date: string; x: number; knee: number; long: boolean }[];
  checkpoints: { id: string; test: string; date: string; on_track: string; target_s: number | null; result_s: number | null; result_hr: number | null }[];
}

export async function dashboardData(db: DB, c: Ctx): Promise<DashboardData> {
  const p = await progressData(db, c);
  const runsActs = c.acts.filter(isRunActivity);
  const actBy = new Map(runsActs.map((a) => [a.id, a]));

  const weeks: WeekRow[] = c.weeks.map((w, i) => {
    const end = addDays(w.start_date, 6);
    const ss = c.sessions.filter((s) => s.week === w.code && isCountedRun(s));
    const due = ss.filter((s) => s.date <= c.today);
    const done = due.filter((s) => ["done", "moved", "partial"].includes(c.matches.get(s.id)?.status ?? ""));
    const scores = ss.map((s) => c.matches.get(s.id)?.overall_score).filter((x): x is number => x != null);
    const eff = p.efficiency.find((e) => e.week === w.code);
    const knees = p.knee.filter((k) => k.date >= w.start_date && k.date <= end).map((k) => k.knee);
    return {
      code: w.code,
      start: w.start_date,
      phase: w.phase,
      deload: w.deload,
      past: w.start_date <= c.today,
      current: c.today >= w.start_date && c.today <= end,
      planned: p.weekly[i].planned,
      actual: p.weekly[i].actual,
      runsDue: due.length,
      runsDone: done.length,
      avgScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
      longPlanned: p.longRuns[i].planned,
      longActual: p.longRuns[i].actual,
      cap: p.longRuns[i].cap,
      effPace: eff?.pace ?? null,
      kneeMax: knees.length ? Math.max(...knees) : null,
    };
  });

  const runs: RunRow[] = c.sessions
    .filter((s) => s.category === "run" && s.date <= c.today && !s.optional)
    .map((s) => {
      const m = c.matches.get(s.id);
      const a = m?.strava_activity_id != null ? actBy.get(m.strava_activity_id) : undefined;
      return {
        id: s.id, date: a?.local_date ?? s.date, week: s.week, title: s.title, kind: s.kind ?? "",
        plannedKm: s.distance_km, actualKm: a ? Math.round(a.distance_m / 100) / 10 : null,
        pace: a && a.distance_m > 0 ? a.moving_time_s / (a.distance_m / 1000) : null,
        hr: a?.avg_hr ?? null, score: m?.overall_score ?? null,
        status: s.skipped ? "skipped" : m?.status ?? "pending", verdict: m?.verdict ?? null,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  return {
    today: c.today,
    daysToRace: diffDays(c.today, loadPlan().meta.goal_race.date),
    weeks,
    runs,
    strength: p.strength as DashboardData["strength"],
    knee: p.knee,
    checkpoints: p.checkpoints.map((cp) => ({
      id: cp.id, test: cp.test, date: cp.date, on_track: cp.on_track, target_s: cp.target_s,
      result_s: cp.result?.time_s ?? null, result_hr: cp.result?.avg_hr ?? null,
    })),
  };
}
