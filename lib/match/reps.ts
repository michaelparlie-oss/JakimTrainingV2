import type { Segment, Zones } from "@/lib/plan/schema";
import type { Act, Lap, RepDetection, RepResult, Streams } from "./types";

export const PACE_TOLERANCE_S = 5;
export const LAP_TOLERANCE = 0.15;
export const REP_HR_MARGIN = 3;

/** Mid-zone pace, or a 7:30/km fallback, used only to estimate the distance of time-based steps. */
function midPace(zones: Zones, code: string): number {
  const z = zones[code as keyof Zones];
  if (z?.pace_min_s_per_km != null && z.pace_max_s_per_km != null) return (z.pace_min_s_per_km + z.pace_max_s_per_km) / 2;
  return 450;
}

export interface LayoutPiece {
  segment_index: number;
  zone: string;
  kind: Segment["kind"];
  is_recovery: boolean;
  start_m: number;
  end_m: number;
}

/** Where each planned step sits along the run, in metres (time-based steps estimated from zone pace). */
export function planLayout(segs: Segment[], zones: Zones): LayoutPiece[] {
  const out: LayoutPiece[] = [];
  let at = 0;
  segs.forEach((s, i) => {
    for (let r = 0; r < s.repeat; r++) {
      const len = s.distance_km != null ? s.distance_km * 1000 : ((s.duration_s ?? 0) / midPace(zones, s.zone)) * 1000;
      out.push({ segment_index: i, zone: s.zone, kind: s.kind, is_recovery: false, start_m: at, end_m: at + len });
      at += len;
      if (s.recovery && r < s.repeat - 1) {
        const rl = (s.recovery.duration_s / midPace(zones, s.recovery.zone)) * 1000;
        out.push({ segment_index: i, zone: s.recovery.zone, kind: s.kind, is_recovery: true, start_m: at, end_m: at + rl });
        at += rl;
      }
    }
  });
  return out;
}

function makeRep(
  segIdx: number,
  repNo: number,
  seg: Segment,
  zones: Zones,
  distance_m: number,
  duration_s: number,
  hr: number | null,
): RepResult {
  const z = zones[seg.zone];
  const pace = distance_m > 0 ? duration_s / (distance_m / 1000) : null;
  const min = z?.pace_min_s_per_km ?? null;
  const max = z?.pace_max_s_per_km ?? null;
  let inRange: boolean | null = null,
    delta: number | null = null;
  if (pace != null && min != null && max != null) {
    if (pace < min - PACE_TOLERANCE_S) delta = pace - min;
    else if (pace > max + PACE_TOLERANCE_S) delta = pace - max;
    else delta = 0;
    inRange = delta === 0;
  }
  const hrMax = z?.hr_max ?? null;
  return {
    segment_index: segIdx,
    rep_no: repNo,
    zone: seg.zone,
    target_min: min,
    target_max: max,
    pace_s_per_km: pace,
    avg_hr: hr,
    hr_max: hrMax,
    distance_m,
    duration_s,
    in_range: inRange,
    delta_s: delta,
    hr_flag: hr != null && hrMax != null && hr > hrMax + REP_HR_MARGIN,
  };
}

const workSegments = (segs: Segment[]) =>
  segs.map((s, i) => ({ s, i })).filter(({ s }) => s.kind === "work");

/** 7.3 step 1: one lap per interval (Apple Watch custom workouts). */
export function repsFromLaps(segs: Segment[], laps: Lap[], zones: Zones): RepResult[] | null {
  const work = workSegments(segs);
  if (!work.length || !laps.length) return null;
  const lapStart: number[] = [];
  laps.reduce((acc, l, k) => ((lapStart[k] = acc), acc + l.distance), 0);
  const reps: RepResult[] = [];
  let lastLap = -1;
  let repNo = 0;
  for (const { s, i } of work) {
    const before = segs.slice(0, i).reduce((t, x) => t + (x.distance_km ?? 0) * 1000 * x.repeat, 0);
    const target = s.distance_km != null ? s.distance_km * 1000 : s.duration_s!;
    const metric = (l: Lap) => (s.distance_km != null ? l.distance : l.moving_time);
    const cands = laps
      .map((l, k) => ({ l, k }))
      .filter(({ l, k }) => k > lastLap && lapStart[k] >= 0.85 * before && Math.abs(metric(l) - target) / target <= LAP_TOLERANCE);
    if (cands.length < s.repeat) return null;
    const pace = (l: Lap) => l.moving_time / Math.max(l.distance, 1);
    const chosen = [...cands].sort((a, b) => pace(a.l) - pace(b.l)).slice(0, s.repeat).sort((a, b) => a.k - b.k);
    for (const { l, k } of chosen) {
      reps.push(makeRep(i, ++repNo, s, zones, l.distance, l.moving_time, l.average_heartrate ?? null));
      lastLap = Math.max(lastLap, k);
    }
  }
  return reps;
}

function avgHr(st: Streams, i: number, j: number): number | null {
  if (!st.heartrate?.length) return null;
  let sum = 0,
    n = 0;
  for (let k = i; k <= j && k < st.heartrate.length; k++) {
    sum += st.heartrate[k];
    n++;
  }
  return n ? sum / n : null;
}

/** 7.3 step 2: fastest non-overlapping windows of the rep length, after the warm-up. */
export function repsFromStreams(segs: Segment[], st: Streams, zones: Zones): RepResult[] | null {
  const work = workSegments(segs);
  const { time: t, distance: d } = st;
  if (!work.length || !t?.length || !d?.length || t.length !== d.length) return null;
  const n = t.length;
  const reps: RepResult[] = [];
  let regionStart = 0; // sample index
  let repNo = 0;
  for (const { s, i } of work) {
    const before = segs.slice(0, i).reduce((acc, x) => acc + (x.distance_km ?? 0) * 1000 * x.repeat, 0);
    while (regionStart < n && d[regionStart] < 0.9 * before) regionStart++;
    const byDist = s.distance_km != null;
    const L = byDist ? s.distance_km! * 1000 : s.duration_s!;
    const used: [number, number][] = [];
    const found: { i: number; j: number }[] = [];
    for (let r = 0; r < s.repeat; r++) {
      let best: { i: number; j: number; score: number } | null = null;
      let j = regionStart;
      for (let a = regionStart; a < n; a++) {
        if (j < a) j = a;
        while (j < n && (byDist ? d[j] - d[a] : t[j] - t[a]) < L) j++;
        if (j >= n) break;
        if (used.some(([u0, u1]) => a <= u1 && j >= u0)) continue;
        // score = seconds per metre (lower is faster)
        const score = (t[j] - t[a]) / Math.max(d[j] - d[a], 1);
        if (!best || score < best.score) best = { i: a, j, score };
      }
      if (!best) return null;
      used.push([best.i, best.j]);
      found.push({ i: best.i, j: best.j });
    }
    found.sort((a, b) => a.i - b.i);
    for (const w of found) {
      reps.push(makeRep(i, ++repNo, s, zones, d[w.j] - d[w.i], t[w.j] - t[w.i], avgHr(st, w.i, w.j)));
    }
    regionStart = found[found.length - 1].j;
  }
  return reps;
}

/** Continuous blocks (race segments, a long run's fast finish): evaluate by position along the route. */
export function repsByPosition(segs: Segment[], st: Streams, zones: Zones, pick: (s: Segment) => boolean): RepResult[] | null {
  const { time: t, distance: d } = st;
  if (!t?.length || !d?.length) return null;
  const reps: RepResult[] = [];
  let at = 0,
    repNo = 0;
  segs.forEach((s, idx) => {
    const len = (s.distance_km ?? 0) * 1000 * s.repeat;
    if (pick(s) && s.distance_km != null && s.repeat === 1) {
      const i = d.findIndex((x) => x >= at);
      let j = d.findIndex((x) => x >= at + len);
      if (j < 0) j = d.length - 1;
      if (i >= 0 && j > i) reps.push(makeRep(idx, ++repNo, s, zones, d[j] - d[i], t[j] - t[i], avgHr(st, i, j)));
    }
    at += len;
  });
  return reps.length ? reps : null;
}

export function detectReps(segs: Segment[], act: Act, zones: Zones): RepDetection {
  const hasWork = segs.some((s) => s.kind === "work");
  if (hasWork) {
    if (act.laps?.length) {
      const r = repsFromLaps(segs, act.laps, zones);
      if (r) return { method: "laps", reps: r };
    }
    if (act.streams) {
      const r = repsFromStreams(segs, act.streams, zones);
      if (r) return { method: "streams", reps: r };
    }
    return { method: "manual", reps: [] };
  }
  if (segs.some((s) => s.kind === "race")) {
    if (act.streams) {
      const r = repsByPosition(segs, act.streams, zones, (s) => s.kind === "race");
      if (r) return { method: "position", reps: r };
    }
    return { method: "manual", reps: [] };
  }
  return { method: "none", reps: [] };
}
