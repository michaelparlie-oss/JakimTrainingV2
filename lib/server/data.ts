import { asc, inArray } from "drizzle-orm";
import type { DB } from "@/db/client";
import * as t from "@/db/schema";
import { buildEffective } from "@/lib/adapt/effective";
import type { EffSession, OverrideRow } from "@/lib/adapt/types";
import type { WeekInfo } from "@/lib/adapt/actions";
import type { Act, Streams, Lap } from "@/lib/match/types";
import { loadPlan } from "@/lib/plan/load";
import { parseGoal, MARATHON_KM } from "@/lib/zones/formula";
import { resolveZones, type ResolvedZones, type ZoneSetRow } from "@/lib/zones/resolve";
import { getSettings } from "./settings";

export async function loadOverrides(db: DB): Promise<OverrideRow[]> {
  return db.select().from(t.sessionOverride).all();
}

export async function loadEffective(db: DB): Promise<EffSession[]> {
  const [rows, ov] = await Promise.all([db.select().from(t.planSession).all(), loadOverrides(db)]);
  return buildEffective(rows, ov);
}

export async function loadWeeks(db: DB): Promise<WeekInfo[]> {
  return db.select().from(t.planWeek).orderBy(asc(t.planWeek.start_date)).all();
}

/** Activity columns without the heavy streams/raw JSON (those are loaded only when needed). */
const light = {
  id: t.stravaActivity.id, start_date_local: t.stravaActivity.start_date_local, local_date: t.stravaActivity.local_date,
  sport_type: t.stravaActivity.sport_type, name: t.stravaActivity.name, description: t.stravaActivity.description,
  distance_m: t.stravaActivity.distance_m, moving_time_s: t.stravaActivity.moving_time_s, elapsed_time_s: t.stravaActivity.elapsed_time_s,
  avg_hr: t.stravaActivity.avg_hr, max_hr: t.stravaActivity.max_hr, avg_speed: t.stravaActivity.avg_speed,
  laps_json: t.stravaActivity.laps_json, detail_fetched: t.stravaActivity.detail_fetched, synced_at: t.stravaActivity.synced_at,
};

type LightRow = { [K in keyof typeof light]: (typeof t.stravaActivity.$inferSelect)[K] };

export function rowToAct(r: LightRow & { streams_json?: string | null }): Act {
  return {
    id: r.id, local_date: r.local_date, start_date_local: r.start_date_local, sport_type: r.sport_type, name: r.name,
    description: r.description, distance_m: r.distance_m ?? 0, moving_time_s: r.moving_time_s ?? 0, elapsed_time_s: r.elapsed_time_s ?? 0,
    avg_hr: r.avg_hr, max_hr: r.max_hr, avg_speed: r.avg_speed,
    laps: r.laps_json ? (JSON.parse(r.laps_json) as Lap[]) : null,
    streams: r.streams_json ? (JSON.parse(r.streams_json) as Streams) : null,
  };
}

export async function loadActivities(db: DB): Promise<Act[]> {
  return (await db.select(light).from(t.stravaActivity).orderBy(asc(t.stravaActivity.start_date_local)).all()).map(rowToAct);
}

export async function loadStreams(db: DB, ids: number[]): Promise<Map<number, Streams>> {
  if (!ids.length) return new Map();
  const rows = await db.select({ id: t.stravaActivity.id, s: t.stravaActivity.streams_json }).from(t.stravaActivity).where(inArray(t.stravaActivity.id, ids)).all();
  return new Map(rows.filter((r) => r.s).map((r) => [r.id, JSON.parse(r.s!) as Streams]));
}

export async function loadZoneSets(db: DB): Promise<ZoneSetRow[]> {
  return db.select().from(t.zoneSet).all();
}

export async function goalTimeS(db: DB): Promise<number> {
  const { goal_time_s } = await getSettings(db, ["goal_time_s"]);
  return goal_time_s ?? parseGoal(loadPlan().meta.goal_race.goal_time);
}

export type ZoneResolver = (s: Pick<EffSession, "date" | "zone_set">) => ResolvedZones;

export async function zoneResolver(db: DB): Promise<ZoneResolver> {
  const [sets, st] = await Promise.all([loadZoneSets(db), getSettings(db, ["hr_overrides", "goal_time_s"])]);
  const rule = loadPlan().meta.zone_formula.rules.MP;
  const goal = st.goal_time_s;
  const mp = goal != null && rule.lo != null && rule.hi != null
    ? { min: Math.round(goal / MARATHON_KM + rule.lo), max: Math.round(goal / MARATHON_KM + rule.hi) }
    : null;
  const cache = new Map<string, ResolvedZones>();
  return (s) => {
    const k = `${s.date}|${s.zone_set}`;
    if (!cache.has(k)) cache.set(k, resolveZones(s.date, s.zone_set, sets, st.hr_overrides, mp));
    return cache.get(k)!;
  };
}
