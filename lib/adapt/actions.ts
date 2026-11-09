import type { Segment, Zones } from "@/lib/plan/schema";
import { addDays, diffDays, fmtDate, weekdayShort } from "@/lib/util/dates";
import { capSegments, segmentsDistanceKm } from "./effective";
import type { EffSession, OverrideRow } from "./types";

export type Action =
  | { type: "cap"; session_id: string; km: number }
  | { type: "replace_easy"; session_id: string; minutes: number }
  | { type: "skip"; session_ids: string[] }
  | { type: "unskip"; session_id: string }
  | { type: "move"; session_id: string; date: string }
  | { type: "repeat_week"; week: string }
  | { type: "early_deload"; week: string; ratio: number }
  | { type: "reset"; session_id: string }
  | { type: "none" };

export interface WeekInfo {
  code: string;
  start_date: string;
  phase: string;
  deload: boolean;
  planned_run_km: number;
}

export type OverridePatch = Omit<OverrideRow, "plan_session_id" | "change_id">;

export interface Change {
  session_id: string;
  next: OverridePatch | null; // null = back to the plan as written
}

export interface ActionPlan {
  ok: boolean;
  summary: string;
  changes: Change[];
  error?: string;
}

export interface ActionCtx {
  sessions: EffSession[]; // effective plan
  overrides: Map<string, OverrideRow>;
  weeks: WeekInfo[];
  today: string;
  raceDate: string;
  zonesFor: (s: EffSession) => Zones;
  source: "user" | "adaptation";
  /** meta.checkpoints dates (CP1–CP4). Weeks holding one are never dropped. */
  checkpointDates?: string[];
}

const baseOf = (ctx: ActionCtx, id: string): OverridePatch => {
  const o = ctx.overrides.get(id);
  return {
    date: o?.date ?? null,
    slot: o?.slot ?? null,
    skipped: o?.skipped ?? false,
    distance_km: o?.distance_km ?? null,
    title: o?.title ?? null,
    segments_json: o?.segments_json ?? null,
    est_duration_min: o?.est_duration_min ?? null,
    force_deload: o?.force_deload ?? null,
    reason: o?.reason ?? "",
    source: ctx.source,
  };
};

const get = (ctx: ActionCtx, id: string) => {
  const s = ctx.sessions.find((x) => x.id === id);
  if (!s) throw new Error(`Unknown session ${id}`);
  return s;
};

const round1 = (x: number) => Math.round(x * 10) / 10;
const fail = (error: string): ActionPlan => ({ ok: false, summary: error, changes: [], error });

/** Estimated minutes for a run at the middle of its zones' pace ranges. */
export function estimateMinutes(segs: Segment[], zones: Zones): number {
  let s = 0;
  for (const g of segs) {
    const z = zones[g.zone];
    const mid = z.pace_min_s_per_km != null && z.pace_max_s_per_km != null ? (z.pace_min_s_per_km + z.pace_max_s_per_km) / 2 : 480;
    s += g.repeat * (g.distance_km != null ? g.distance_km * mid : g.duration_s!);
    if (g.recovery) s += (g.repeat - 1) * g.recovery.duration_s;
  }
  return Math.round(s / 60);
}

function cap(ctx: ActionCtx, id: string, km: number, why: string): Change {
  const s = get(ctx, id);
  const segs = capSegments(s.segments, km);
  const newKm = round1(segmentsDistanceKm(segs) || km);
  return {
    session_id: id,
    next: {
      ...baseOf(ctx, id),
      distance_km: newKm,
      segments_json: JSON.stringify(segs),
      title: `${s.plan_title} (capped at ${newKm.toFixed(1)} km)`,
      est_duration_min: estimateMinutes(segs, ctx.zonesFor(s)),
      reason: why,
    },
  };
}

export function planAction(action: Action, ctx: ActionCtx): ActionPlan {
  switch (action.type) {
    case "none":
      return { ok: true, summary: "Kept the plan as written.", changes: [] };

    case "cap": {
      const s = get(ctx, action.session_id);
      const ch = cap(ctx, s.id, action.km, `Capped to stay within 10% of your longest run in the last 30 days.`);
      return { ok: true, summary: `${fmtDate(s.date)} ${s.plan_title}: capped at ${ch.next!.distance_km} km.`, changes: [ch] };
    }

    case "replace_easy": {
      const s = get(ctx, action.session_id);
      const z = ctx.zonesFor(s).E;
      const mid = z.pace_min_s_per_km != null && z.pace_max_s_per_km != null ? (z.pace_min_s_per_km + z.pace_max_s_per_km) / 2 : 495;
      const km = round1((action.minutes * 60) / mid);
      const segs: Segment[] = [{ kind: "steady", zone: "E", repeat: 1, duration_s: action.minutes * 60, note: "Stop if the knee goes above 3/10." }];
      return {
        ok: true,
        summary: `${fmtDate(s.date)}: ${s.plan_title} → easy ${action.minutes} min.`,
        changes: [
          {
            session_id: s.id,
            next: {
              ...baseOf(ctx, s.id),
              distance_km: km,
              segments_json: JSON.stringify(segs),
              title: `Easy ${action.minutes} min (knee check, replaces "${s.plan_title}")`,
              est_duration_min: action.minutes,
              reason: "Knee pain above 3/10: next run made 30 min easy (plan rule).",
            },
          },
        ],
      };
    }

    case "skip": {
      const changes = action.session_ids.map((id) => ({
        session_id: id,
        next: { ...baseOf(ctx, id), skipped: true, reason: baseOf(ctx, id).reason || "Skipped" },
      }));
      return { ok: true, summary: `Skipped ${changes.length} session${changes.length > 1 ? "s" : ""}.`, changes };
    }

    case "unskip": {
      const b = baseOf(ctx, action.session_id);
      const next = { ...b, skipped: false };
      const empty = !next.date && !next.slot && next.distance_km == null && !next.segments_json && !next.title && next.force_deload == null;
      return { ok: true, summary: "Session restored.", changes: [{ session_id: action.session_id, next: empty ? null : next }] };
    }

    case "reset":
      return { ok: true, summary: "Session reset to the plan as written.", changes: [{ session_id: action.session_id, next: null }] };

    case "move": {
      const s = get(ctx, action.session_id);
      const to = action.date;
      if (to > ctx.raceDate) return fail("Sessions can't be moved past race day.");
      if (s.kind === "race") return fail("Race day is fixed and can't be moved.");
      if (to === s.date) return { ok: true, summary: "No change.", changes: [] };
      const changes: Change[] = [{ session_id: s.id, next: { ...baseOf(ctx, s.id), date: to === s.plan_date ? null : to, reason: `Moved from ${weekdayShort(s.date)} ${fmtDate(s.date)}` } }];
      // Same category already on the target day and slot → swap them so Mike never has two runs in one slot.
      const clash = ctx.sessions.find((x) => x.id !== s.id && x.date === to && x.slot === s.slot && x.category === s.category && !x.skipped);
      let summary = `${s.plan_title}: moved to ${weekdayShort(to)} ${fmtDate(to)}.`;
      if (clash) {
        if (clash.kind === "race") return fail("That day is race day.");
        changes.push({ session_id: clash.id, next: { ...baseOf(ctx, clash.id), date: s.date === clash.plan_date ? null : s.date, reason: `Swapped with "${s.plan_title}"` } });
        summary = `Swapped ${weekdayShort(s.date)} and ${weekdayShort(to)}: ${s.plan_title} ↔ ${clash.plan_title}.`;
      }
      return { ok: true, summary, changes };
    }

    case "repeat_week": {
      const r = planRepeatWeek(action.week, ctx);
      return r;
    }

    case "early_deload": {
      const week = ctx.sessions.filter((s) => s.week === action.week);
      if (!week.length) return fail(`Week ${action.week} not found.`);
      const changes: Change[] = [];
      for (const s of week) {
        if (s.category === "strength") {
          changes.push({ session_id: s.id, next: { ...baseOf(ctx, s.id), force_deload: true, reason: "Deload taken early (easy-run heart rate was up)." } });
        } else if (s.category === "run" && s.distance_km && s.kind !== "race" && s.kind !== "test") {
          const km = Math.max(3, Math.round(s.distance_km * action.ratio * 2) / 2);
          const ch = cap(ctx, s.id, km, "Deload taken early (easy-run heart rate was up).");
          ch.next!.title = `${s.plan_title} (early deload: ${ch.next!.distance_km} km)`;
          changes.push(ch);
        }
      }
      return { ok: true, summary: `Week ${action.week} turned into a deload week (runs about ${Math.round(action.ratio * 100)}% of planned, strength sets halved).`, changes };
    }
  }
}

/**
 * Missed-week rule: repeat the missed week by shifting it and the following weeks +7 days.
 * Race day and the taper never move, so the latest pre-taper week without a checkpoint is dropped.
 * Refuses (and explains) if that would compress the taper.
 */
export function planRepeatWeek(code: string, ctx: ActionCtx): ActionPlan {
  const weeks = [...ctx.weeks].sort((a, b) => a.start_date.localeCompare(b.start_date));
  const wi = weeks.findIndex((w) => w.code === code);
  if (wi < 0) return fail(`Week ${code} not found.`);
  const taperIdx = weeks.findIndex((w) => w.phase === "Taper");
  if (weeks[wi].phase === "Taper" || taperIdx < 0 || wi >= taperIdx - 1)
    return fail(
      `Repeating ${code} would push the plan into the taper. Race day and the taper stay fixed, so carry on as written (and don't double up).`,
    );
  const cps = new Set(ctx.checkpointDates ?? []);
  const hasCheckpoint = (c: string) =>
    ctx.sessions.some((s) => s.week === c && (s.kind === "test" || s.kind === "race" || cps.has(s.plan_date)));
  let dropIdx = -1;
  for (let k = taperIdx - 1; k > wi; k--) {
    if (!hasCheckpoint(weeks[k].code)) {
      dropIdx = k;
      break;
    }
  }
  if (dropIdx < 0) return fail(`No week left that can be dropped without losing a checkpoint or compressing the taper. Carry on as written.`);
  const shifting = new Set(weeks.slice(wi, dropIdx).map((w) => w.code));
  const changes: Change[] = [];
  for (const s of ctx.sessions) {
    if (shifting.has(s.week)) {
      const to = addDays(s.date, 7);
      if (to >= weeks[taperIdx].start_date) return fail("This shift would compress the taper, so it was refused.");
      changes.push({ session_id: s.id, next: { ...baseOf(ctx, s.id), date: to === s.plan_date ? null : to, reason: `Shifted +7 days to repeat week ${code}` } });
    } else if (s.week === weeks[dropIdx].code) {
      changes.push({ session_id: s.id, next: { ...baseOf(ctx, s.id), skipped: true, reason: `Dropped to keep race day and the taper fixed after repeating ${code}` } });
    }
  }
  const days = diffDays(weeks[wi].start_date, ctx.today);
  const note = days > 7 ? " Some repeated sessions are already in the past." : "";
  return {
    ok: true,
    summary: `Repeating ${code}: weeks ${weeks[wi].code}–${weeks[dropIdx - 1].code} move one week later and ${weeks[dropIdx].code} is dropped. Race day and the taper are unchanged.${note}`,
    changes,
  };
}
