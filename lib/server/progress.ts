import { asc } from "drizzle-orm";
import type { DB } from "@/db/client";
import * as t from "@/db/schema";
import { isCountedRun } from "@/lib/adapt/types";
import { isRunActivity } from "@/lib/match/types";
import { loadPlan } from "@/lib/plan/load";
import { SPIKE_LIMIT, longestBefore } from "@/lib/rules/engine";
import { addDays, mondayOf } from "@/lib/util/dates";
import { parseDuration } from "@/lib/util/format";
import type { Ctx } from "./view";

export const STRENGTH_TRACKED = ["back_squat", "trap_bar_dl", "rdl"];

export async function progressData(db: DB, c: Ctx) {
  const [results, logs, wl] = await Promise.all([
    db.select().from(t.checkpointResult).all(),
    db.select().from(t.strengthLog).orderBy(asc(t.strengthLog.logged_at)).all(),
    db.select().from(t.wellbeingLog).all(),
  ]);
  const runs = c.acts.filter(isRunActivity);
  // Weekly km: planned (effective plan) vs actual.
  const weekly = c.weeks.map((w) => {
    const end = addDays(w.start_date, 6);
    return {
      week: w.code,
      start: w.start_date,
      planned: Math.round(c.sessions.filter((s) => s.week === w.code && isCountedRun(s)).reduce((x, s) => x + (s.distance_km ?? 0), 0) * 10) / 10,
      actual: w.start_date <= c.today ? Math.round(runs.filter((a) => a.local_date >= w.start_date && a.local_date <= end).reduce((x, a) => x + a.distance_m / 1000, 0) * 10) / 10 : null,
    };
  });

  // Long runs: actual longest run per week vs planned long run, with the 30-day max + 10% band.
  const hist = runs.map((a) => ({ date: a.local_date, km: a.distance_m / 1000, source: "actual" as const }));
  const longRuns = c.weeks.map((w) => {
    const end = addDays(w.start_date, 6);
    const plannedLong = c.sessions.filter((s) => s.week === w.code && (s.kind === "long" || s.kind === "race" || s.kind === "test") && !s.skipped).map((s) => s.distance_km ?? 0);
    const actual = runs.filter((a) => a.local_date >= w.start_date && a.local_date <= end).map((a) => a.distance_m / 1000);
    const m = w.start_date <= c.today ? longestBefore(hist, end) : null;
    return {
      week: w.code,
      planned: plannedLong.length ? Math.max(...plannedLong) : null,
      actual: actual.length ? Math.round(Math.max(...actual) * 10) / 10 : null,
      cap: m != null ? Math.round(m * SPIKE_LIMIT * 10) / 10 : null,
    };
  });

  // Easy-run efficiency: average pace on easy runs with avg HR 145–155, by week. Falling = fitter.
  const easyIds = new Set(c.sessions.filter((s) => s.kind === "easy").map((s) => s.id));
  const easyActs = [...c.matches.values()]
    .filter((m) => easyIds.has(m.plan_session_id) && m.strava_activity_id != null)
    .map((m) => runs.find((a) => a.id === m.strava_activity_id))
    .filter((a): a is NonNullable<typeof a> => !!a && a.avg_hr != null && a.avg_hr >= 145 && a.avg_hr <= 155 && a.distance_m > 0);
  const byWeek = new Map<string, number[]>();
  for (const a of easyActs) {
    const k = mondayOf(a.local_date);
    byWeek.set(k, [...(byWeek.get(k) ?? []), a.moving_time_s / (a.distance_m / 1000)]);
  }
  const efficiency = [...byWeek.entries()].sort().map(([wk, p]) => ({ week: c.weeks.find((w) => w.start_date === wk)?.code ?? wk.slice(5), pace: Math.round(p.reduce((x, y) => x + y, 0) / p.length), n: p.length }));

  // Checkpoints vs targets.
  const checkpoints = loadPlan().meta.checkpoints.map((cp) => {
    const r = results.find((x) => x.checkpoint_id === cp.id);
    const target = /([\d:]{4,})/.exec(cp.on_track)?.[1];
    return { ...cp, target_s: target ? parseDuration(target.length <= 5 && cp.id !== "CP4" ? `${target}:00` : target) : null, result: r ?? null };
  });

  // Strength: top set weight over time.
  const sDate = new Map(c.sessions.map((s) => [s.id, s.date]));
  const strengthMap = new Map<string, Record<string, number | string>>();
  for (const l of logs) {
    if (!STRENGTH_TRACKED.includes(l.exercise_key) || l.weight_kg == null) continue;
    const d = sDate.get(l.plan_session_id) ?? new Date(l.logged_at * 1000).toISOString().slice(0, 10);
    const row = strengthMap.get(d) ?? { date: d };
    row[l.exercise_key] = Math.max(Number(row[l.exercise_key] ?? 0), l.weight_kg);
    strengthMap.set(d, row);
  }
  const strength = [...strengthMap.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));

  // Knee pain by date, long-run days marked.
  const longDates = new Set(c.sessions.filter((s) => s.kind === "long" || s.kind === "race" || s.kind === "test").map((s) => s.date));
  const knee = wl.filter((w) => w.knee_pain != null).map((w) => ({ date: w.date, x: new Date(`${w.date}T00:00:00Z`).getTime(), knee: w.knee_pain!, long: longDates.has(w.date) }));

  return { weekly, longRuns, efficiency, checkpoints, strength, knee };
}
