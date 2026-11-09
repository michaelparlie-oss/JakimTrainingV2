import { and, desc, eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import * as t from "@/db/schema";
import { loadPlan } from "@/lib/plan/load";
import type { Zones } from "@/lib/plan/schema";
import type { EffSession } from "@/lib/adapt/types";
import { computeZones, cp3GoalAdvice, maxSpeedup, SANITY_GUARD_S, type ZoneBasis } from "@/lib/zones/formula";
import { addDays, nowEpoch } from "@/lib/util/dates";
import { fmtDuration, fmtPace } from "@/lib/util/format";
import { repsByPosition } from "@/lib/match/reps";
import { goalTimeS, loadEffective, loadStreams, zoneResolver } from "./data";
import { recompute } from "./recompute";
import { getSetting, setSetting } from "./settings";

export type CpId = "CP1" | "CP2" | "CP3" | "CP4";
export const CP_KIND: Record<CpId, "hm" | "10k" | "mp_rehearsal"> = { CP1: "hm", CP2: "10k", CP3: "hm", CP4: "mp_rehearsal" };

/** The checkpoint's session as it now stands (repeat-week shifts move checkpoints too). */
export function checkpointSession(sessions: EffSession[], cp: CpId) {
  const meta = loadPlan().meta.checkpoints.find((c) => c.id === cp)!;
  const s = sessions.find((x) => x.plan_date === meta.date && x.category === "run");
  return { meta, session: s ?? null, date: s?.date ?? meta.date };
}

export interface CheckpointEntry {
  time_s?: number | null;
  avg_hr?: number | null;
  strava_activity_id?: number | null;
  confirm?: boolean;
}

export type CheckpointOutcome =
  | { status: "needs_confirm"; message: string }
  | { status: "saved"; message: string; zone_set_id?: string; goal_advice?: ReturnType<typeof cp3GoalAdvice> }
  | { status: "error"; message: string };

/** Average HR on the MP part and the average pace of its 1 km splits that stayed under 165 bpm (CP4). */
export async function cp4Analysis(db: DB, sessions: EffSession[], activityId: number | null | undefined) {
  const none = { avg_hr: null as number | null, suggest_pace_s: null as number | null };
  if (!activityId) return none;
  const st = (await loadStreams(db, [activityId])).get(activityId);
  const { session } = checkpointSession(sessions, "CP4");
  if (!st || !session) return none;
  const zones = (await zoneResolver(db))(session).zones;
  const mpPart = repsByPosition(session.segments, st, zones, (s) => s.zone === "MP")?.[0];
  if (!mpPart) return none;
  const { time, distance, heartrate } = st;
  const startM = session.segments.slice(0, session.segments.findIndex((s) => s.zone === "MP")).reduce((x, s) => x + (s.distance_km ?? 0) * 1000 * s.repeat, 0);
  const splits: { pace: number; hr: number }[] = [];
  for (let m = startM; m + 1000 <= startM + mpPart.distance_m + 1; m += 1000) {
    const i = distance.findIndex((d) => d >= m), j = distance.findIndex((d) => d >= m + 1000);
    if (i < 0 || j <= i || !heartrate) continue;
    splits.push({ pace: time[j] - time[i], hr: heartrate.slice(i, j + 1).reduce((a, b) => a + b, 0) / (j - i + 1) });
  }
  const ok = splits.filter((s) => s.hr < 165);
  return { avg_hr: mpPart.avg_hr, suggest_pace_s: ok.length ? ok.reduce((a, s) => a + s.pace, 0) / ok.length : null };
}

export async function enterCheckpoint(db: DB, cp: CpId, e: CheckpointEntry): Promise<CheckpointOutcome> {
  const sessions = await loadEffective(db);
  const { date } = checkpointSession(sessions, cp);
  const kind = CP_KIND[cp];
  if (kind === "mp_rehearsal") {
    const a = await cp4Analysis(db, sessions, e.strava_activity_id);
    const avg = e.avg_hr ?? a.avg_hr;
    if (avg == null) return { status: "error", message: "Enter the average HR for the MP part, or link the run so it can be read from Strava." };
    await db.batch([
      db.delete(t.checkpointResult).where(eq(t.checkpointResult.checkpoint_id, cp)),
      db.insert(t.checkpointResult).values({ checkpoint_id: cp, date, test_kind: kind, time_s: e.time_s ?? null, avg_hr: avg, strava_activity_id: e.strava_activity_id ?? null, created_at: nowEpoch() }),
    ] as never);
    await setSetting(db, "cp4", { suggest_pace_s: a.suggest_pace_s });
    await recompute(db);
    return {
      status: "saved",
      message: avg >= 165
        ? `Average HR ${Math.round(avg)} bpm is at or above 165.${a.suggest_pace_s ? ` Race at about ${fmtPace(a.suggest_pace_s)} /km, the pace that kept HR under 165.` : ""}`
        : `Average HR ${Math.round(avg)} bpm: under 165, on track.`,
    };
  }
  if (!e.time_s || e.time_s < 600) return { status: "error", message: "Enter a finish time like 1:06:30." };
  const basis: ZoneBasis = { kind, seconds: e.time_s };
  const [hr, goal, zr] = await Promise.all([getSetting(db, "hr_overrides"), goalTimeS(db), zoneResolver(db)]);
  const next: Zones = computeZones(loadPlan(), basis, goal, hr);
  const effective = addDays(date, 1);
  const session = sessions.find((s) => s.date >= effective && s.category === "run");
  const prev = zr(session ?? { date: effective, zone_set: "v1" }).zones;
  const jump = maxSpeedup(prev, next);
  if (jump.seconds > SANITY_GUARD_S && !e.confirm)
    return {
      status: "needs_confirm",
      message: `This result makes your ${jump.code} pace ${Math.round(jump.seconds)} s/km faster than before. That is a big jump: check for a typo or a GPS error. Save anyway?`,
    };
  const id = `${cp}-${nowEpoch()}`;
  const label = `${cp} ${kind === "hm" ? "half marathon" : "10K"} ${fmtDuration(e.time_s)} (${new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })})`;
  await db.batch([
    db.update(t.zoneSet).set({ active: false }).where(and(eq(t.zoneSet.checkpoint_id, cp), eq(t.zoneSet.source, "checkpoint"))),
    db.insert(t.zoneSet).values({ id, label, basis_kind: kind, basis_seconds: e.time_s, goal_time_s: goal, created_at: nowEpoch(), effective_from_date: effective, source: "checkpoint", checkpoint_id: cp, zones_json: JSON.stringify(next), active: true }),
    db.delete(t.checkpointResult).where(eq(t.checkpointResult.checkpoint_id, cp)),
    db.insert(t.checkpointResult).values({ checkpoint_id: cp, date, test_kind: kind, time_s: e.time_s, avg_hr: e.avg_hr ?? null, strava_activity_id: e.strava_activity_id ?? null, zone_set_id: id, created_at: nowEpoch() }),
  ] as never);
  await recompute(db);
  return { status: "saved", zone_set_id: id, message: `New paces from ${label}, used from ${effective}.`, goal_advice: cp === "CP3" ? cp3GoalAdvice(e.time_s) : undefined };
}

/** Only after Mike confirms (CP3 rule or Settings). MP changes everywhere; other zones don't. */
export async function setGoal(db: DB, goal_s: number, reason: string) {
  const hist = [...(await getSetting(db, "goal_history"))];
  hist.push({ at: nowEpoch(), goal_s, reason });
  await setSetting(db, "goal_history", hist);
  await setSetting(db, "goal_time_s", goal_s);
  await recompute(db);
}

export async function undoCheckpoint(db: DB, cp: CpId) {
  await db.batch([
    db.update(t.zoneSet).set({ active: false }).where(eq(t.zoneSet.checkpoint_id, cp)),
    db.delete(t.checkpointResult).where(eq(t.checkpointResult.checkpoint_id, cp)),
  ] as never);
  await recompute(db);
}

export async function checkpointResults(db: DB) {
  return db.select().from(t.checkpointResult).orderBy(desc(t.checkpointResult.created_at)).all();
}
