import type { EffSession } from "@/lib/adapt/types";
import { diffDays } from "@/lib/util/dates";
import { isRunActivity, type Act, type MatchStatus } from "./types";

export interface ManualLink {
  plan_session_id: string;
  strava_activity_id: number | null; // null = manually unlinked
}

/** A run counts as a "clear fit" for a neighbouring day's session within this relative distance error. */
export const SWAP_GOOD_FIT = 0.2;
/** …and as a "poor fit" for its own day's session beyond this error. */
export const SWAP_POOR_FIT = 0.5;
const MOVE_PENALTY = 0.35;

const relDiff = (a: Act, s: EffSession) =>
  s.distance_km ? Math.abs(a.distance_m / 1000 - s.distance_km) / s.distance_km : 0;

/**
 * §7.1 matching on the EFFECTIVE plan (sessions Mike moved are matched on their new date).
 *  1. Same-day candidates first; with several, the smallest |distance − planned| / planned wins.
 *  2. ±1 day only onto a day with no planned run → status "moved".
 *     Dynamic exception (DECISIONS.md): if a run fits its own day's session poorly (> 50 % off) but a
 *     neighbouring day's session well (≤ 20 % off) — e.g. the long run done on Friday instead of
 *     Saturday — it is matched to the neighbour as "moved" instead.
 *  3. Unmatched counted runs become "missed" once plan day + 1 has passed.
 *  Pairs are assigned greedily by cost, so each run and each session is used at most once.
 */
export function matchRuns(
  sessions: EffSession[],
  activities: Act[],
  today: string,
  manual: ManualLink[] = [],
): { statuses: MatchStatus[]; extras: number[] } {
  const runs = activities.filter(isRunActivity);
  const planned = sessions.filter((s) => s.category === "run");
  const active = planned.filter((s) => !s.skipped);
  const manualBy = new Map(manual.map((m) => [m.plan_session_id, m]));
  const usedActs = new Set<number>(manual.filter((m) => m.strava_activity_id != null).map((m) => m.strava_activity_id!));
  const assigned = new Map<string, { act: Act; moved: boolean }>();
  const byId = new Map(runs.map((r) => [r.id, r]));
  for (const [sid, m] of manualBy) {
    const a = m.strava_activity_id != null ? byId.get(m.strava_activity_id) : undefined;
    if (a) assigned.set(sid, { act: a, moved: false });
  }

  const countedOn = (d: string) => active.filter((s) => !s.optional && s.date === d);
  type Pair = { s: EffSession; a: Act; cost: number; moved: boolean };
  const pairs: Pair[] = [];
  for (const s of active) {
    if (manualBy.has(s.id)) continue;
    for (const a of runs) {
      if (usedActs.has(a.id)) continue;
      const gap = diffDays(s.date, a.local_date);
      if (gap === 0) {
        pairs.push({ s, a, cost: relDiff(a, s) + (s.optional ? 10 : 0), moved: false });
      } else if (Math.abs(gap) === 1 && !s.optional) {
        const own = countedOn(a.local_date);
        const free = own.length === 0;
        const ownBest = own.length ? Math.min(...own.map((o) => relDiff(a, o))) : Infinity;
        const swap = !free && ownBest > SWAP_POOR_FIT && relDiff(a, s) <= SWAP_GOOD_FIT;
        if (free || swap) pairs.push({ s, a, cost: relDiff(a, s) + MOVE_PENALTY, moved: true });
      }
    }
  }
  pairs.sort((x, y) => x.cost - y.cost || Number(x.moved) - Number(y.moved));
  for (const p of pairs) {
    if (assigned.has(p.s.id) || usedActs.has(p.a.id)) continue;
    assigned.set(p.s.id, { act: p.a, moved: p.moved });
    usedActs.add(p.a.id);
  }

  const statuses: MatchStatus[] = planned.map((s) => {
    const m = manualBy.get(s.id);
    const hit = assigned.get(s.id);
    if (hit) {
      const ratio = s.distance_km ? hit.act.distance_m / 1000 / s.distance_km : 1;
      const status = hit.moved || hit.act.local_date !== s.date ? "moved" : ratio >= 0.85 ? "done" : "partial";
      return { plan_session_id: s.id, strava_activity_id: hit.act.id, status, manual: !!m };
    }
    if (s.skipped) return { plan_session_id: s.id, strava_activity_id: null, status: "skipped", manual: !!m };
    const over = diffDays(s.date, today) >= 2;
    return { plan_session_id: s.id, strava_activity_id: null, status: over && !s.optional ? "missed" : "pending", manual: !!m };
  });
  return { statuses, extras: runs.filter((r) => !usedActs.has(r.id)).map((r) => r.id) };
}
