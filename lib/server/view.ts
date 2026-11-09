import { and, desc, eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import * as t from "@/db/schema";
import { loadPlan } from "@/lib/plan/load";
import type { TemplateItem } from "@/lib/plan/schema";
import type { EffSession } from "@/lib/adapt/types";
import { isCountedRun } from "@/lib/adapt/types";
import type { Act } from "@/lib/match/types";
import { isRunActivity } from "@/lib/match/types";
import type { ScoreResult } from "@/lib/match/score";
import { plannedSpikes, sortAlerts, type SpikeResult } from "@/lib/rules/engine";
import { addDays, mondayOf, todayLocal } from "@/lib/util/dates";
import type { ResolvedZones } from "@/lib/zones/resolve";
import { loadActivities, loadEffective, loadWeeks, zoneResolver, type ZoneResolver } from "./data";
import type { WeekInfo } from "@/lib/adapt/actions";
import { loadManualLinks } from "./recompute";
import { matchRuns } from "@/lib/match/match";

/** Templates that are already light; they are never halved in deload weeks (brief §4). */
export const NO_HALVING = ["L_P1", "ACT", "MOB"];

export type MatchRow = typeof t.sessionMatch.$inferSelect;

export interface StrengthItemVM extends TemplateItem {
  display_sets: number;
  halved: boolean;
  exercise_name: string;
}

export interface SessionVM extends EffSession {
  zonesR: ResolvedZones;
  match: MatchRow | null;
  activity: Act | null;
  details: ScoreResult["details"] | null;
  spike: SpikeResult | null;
  strength: { name: string; minutes: number; intent: string; items: StrengthItemVM[]; deload_applied: boolean } | null;
}

export function strengthItems(s: Pick<EffSession, "template" | "deload">) {
  const plan = loadPlan();
  if (!s.template) return null;
  const tpl = plan.strength_templates[s.template];
  const halve = s.deload && !NO_HALVING.includes(s.template);
  return {
    name: tpl.name,
    minutes: tpl.minutes,
    intent: tpl.intent,
    deload_applied: halve,
    items: tpl.items.map((it) => ({
      ...it,
      display_sets: halve ? Math.ceil(it.sets / 2) : it.sets,
      halved: halve && Math.ceil(it.sets / 2) !== it.sets,
      exercise_name: plan.exercises[it.exercise]?.name ?? it.exercise,
    })),
  };
}

export interface Ctx {
  today: string;
  sessions: EffSession[];
  acts: Act[];
  matches: Map<string, MatchRow>;
  spikes: Map<string, SpikeResult>;
  zr: ZoneResolver;
  weeks: WeekInfo[];
}

export async function ctx(db: DB): Promise<Ctx> {
  const today = todayLocal();
  const [sessions, acts, matchRows, manual, zr, weeks] = await Promise.all([
    loadEffective(db), loadActivities(db), db.select().from(t.sessionMatch).all(), loadManualLinks(db), zoneResolver(db), loadWeeks(db),
  ]);
  const matches = new Map(matchRows.map((m) => [m.plan_session_id, m]));
  const { statuses } = matchRuns(sessions, acts, today, manual);
  return { today, sessions, acts, matches, spikes: plannedSpikes({ today, sessions, statuses, activities: acts }), zr, weeks };
}

export function toVM(c: Ctx, s: EffSession): SessionVM {
  const m = c.matches.get(s.id) ?? null;
  const a = m?.strava_activity_id != null ? c.acts.find((x) => x.id === m.strava_activity_id) ?? null : null;
  return {
    ...s,
    zonesR: c.zr(s),
    match: m,
    activity: a,
    details: m?.details_json ? JSON.parse(m.details_json) : null,
    spike: c.spikes.get(s.id) ?? null,
    strength: s.category === "strength" ? strengthItems(s) : null,
  };
}

export function dayVM(c: Ctx, date: string) {
  const sessions = c.sessions.filter((s) => s.date === date).map((s) => toVM(c, s));
  const movedAway = c.sessions.filter((s) => s.plan_date === date && s.date !== date);
  const runsThatDay = c.acts.filter((a) => a.local_date === date && isRunActivity(a));
  const matchedIds = new Set([...c.matches.values()].map((m) => m.strava_activity_id));
  const extras = runsThatDay.filter((a) => !matchedIds.has(a.id));
  const otherActs = c.acts.filter((a) => a.local_date === date && !isRunActivity(a));
  return { date, sessions, movedAway, extras, otherActs };
}

export function weekVM(c: Ctx, monday: string) {
  const days = Array.from({ length: 7 }, (_, i) => dayVM(c, addDays(monday, i)));
  const end = addDays(monday, 6);
  const inWeek = c.sessions.filter((s) => s.date >= monday && s.date <= end);
  const plannedKm = inWeek.filter(isCountedRun).reduce((x, s) => x + (s.distance_km ?? 0), 0);
  const actualKm = c.acts.filter((a) => isRunActivity(a) && a.local_date >= monday && a.local_date <= end).reduce((x, a) => x + a.distance_m / 1000, 0);
  const codes = [...new Set(inWeek.map((s) => s.week))];
  const pw = c.weeks.find((w) => w.start_date === monday) ?? null;
  return { monday, days, plannedKm, actualKm, codes, planWeek: pw, deload: inWeek.some((s) => s.deload && s.category === "strength") || !!pw?.deload };
}

export function planVM(c: Ctx) {
  const weeks = c.weeks;
  const cps = loadPlan().meta.checkpoints;
  return weeks.map((w) => {
    const ss = c.sessions.filter((s) => s.week === w.code);
    const end = addDays(w.start_date, 6);
    const planned = ss.filter(isCountedRun).reduce((x, s) => x + (s.distance_km ?? 0), 0);
    const actual = c.acts.filter((a) => isRunActivity(a) && a.local_date >= w.start_date && a.local_date <= end).reduce((x, a) => x + a.distance_m / 1000, 0);
    const long = ss.filter((s) => s.kind === "long" && !s.skipped).map((s) => s.distance_km ?? 0);
    return {
      ...w,
      planned,
      actual,
      changed: ss.filter((s) => s.override).length,
      skipped: ss.filter((s) => s.skipped && s.category === "run").length,
      spikes: ss.filter((s) => c.spikes.has(s.id)).length,
      checkpoints: cps.filter((cp) => ss.some((s) => s.plan_date === cp.date)).map((cp) => cp.id),
      longest: long.length ? Math.max(...long) : null,
      shiftedDates: ss.some((s) => s.date !== s.plan_date),
      isCurrent: c.today >= w.start_date && c.today <= end,
    };
  });
}

export type AlertVM = Awaited<ReturnType<typeof activeAlerts>>[number];

export async function activeAlerts(db: DB) {
  const [rows, propRows] = await Promise.all([
    db.select().from(t.alert).where(and(eq(t.alert.dismissed, false), eq(t.alert.resolved, false))).orderBy(desc(t.alert.date)).all(),
    db.select().from(t.proposal).where(eq(t.proposal.status, "pending")).all(),
  ]);
  const props = new Map(propRows.map((p) => [p.id, p]));
  return sortAlerts(rows).map((a) => {
    const p = a.proposal_id ? props.get(a.proposal_id) : undefined;
    return { ...a, proposal: p && p.status === "pending" ? { ...p, options: JSON.parse(p.options_json) as { label: string }[] } : null };
  });
}

export function currentWeekCode(c: Ctx): { code: string; phase: string } | null {
  const mon = mondayOf(c.today);
  const s = c.sessions.find((x) => x.date >= mon && x.date <= addDays(mon, 6));
  return s ? { code: s.week, phase: s.phase } : null;
}
