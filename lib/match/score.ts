import type { Zones } from "@/lib/plan/schema";
import type { EffSession } from "@/lib/adapt/types";
import { fmtPace, fmtKm, fmtDuration } from "@/lib/util/format";
import type { Act, RepDetection, Streams } from "./types";
import { detectReps, planLayout } from "./reps";

/** Extra bpm allowed in the final hour of long runs: zones.L.feel says "allow HR up to 160 in the final hour" (155 + 5). */
export const LONG_RUN_FINAL_HOUR_ALLOWANCE = 5;

/** §7.2: 100 within 0.95–1.10, linear to 0 at 0.5 and 1.5. */
export function distanceScore(ratio: number): number {
  if (ratio >= 0.95 && ratio <= 1.1) return 100;
  if (ratio < 0.95) return Math.max(0, ((ratio - 0.5) / 0.45) * 100);
  return Math.max(0, ((1.5 - ratio) / 0.4) * 100);
}

export interface HrCheck {
  method: "stream" | "average" | "none";
  limit: number | null;
  pct_under: number | null; // % of counted moving time at or below the limit
  pct_over: number | null;
}

/**
 * % of moving time at or below the zone HR max, counting only easy/long steps (E, L).
 * Strides and fast finishes are excluded because a different target applies there.
 */
export function hrCompliance(session: EffSession, act: Act, zones: Zones): HrCheck {
  const primary = session.kind === "long" ? "L" : "E";
  const limit = zones[primary].hr_max;
  const st: Streams | null = act.streams;
  if (st?.heartrate?.length && st.time?.length && st.distance?.length && limit != null) {
    const layout = planLayout(session.segments, zones);
    const totalMoving = act.moving_time_s || st.time[st.time.length - 1];
    let movingSoFar = 0,
      under = 0,
      counted = 0;
    for (let k = 1; k < st.time.length; k++) {
      const dt = st.time[k] - st.time[k - 1];
      if (dt <= 0 || dt > 30) continue; // pauses
      if (st.moving && st.moving[k] === false) continue;
      movingSoFar += dt;
      const dm = st.distance[k];
      const piece = layout.find((p) => dm >= p.start_m && dm < p.end_m) ?? layout[layout.length - 1];
      if (!piece || piece.is_recovery || (piece.zone !== "E" && piece.zone !== "L")) continue;
      const zl = zones[piece.zone as "E" | "L"].hr_max ?? limit;
      const allow = piece.zone === "L" && totalMoving - movingSoFar <= 3600 ? LONG_RUN_FINAL_HOUR_ALLOWANCE : 0;
      counted += dt;
      if (st.heartrate[k] <= zl + allow) under += dt;
    }
    if (counted > 0) {
      const pct = (under / counted) * 100;
      return { method: "stream", limit, pct_under: pct, pct_over: 100 - pct };
    }
  }
  if (act.avg_hr != null && limit != null) {
    const ok = act.avg_hr <= limit;
    return { method: "average", limit, pct_under: ok ? 100 : 50, pct_over: null };
  }
  return { method: "none", limit, pct_under: null, pct_over: null };
}

export interface ScoreResult {
  distance_ratio: number;
  distance_score: number;
  hr_score: number | null;
  pace_score: number | null;
  overall_score: number;
  verdict: string;
  details: {
    primary: "HR" | "pace";
    hr: HrCheck | null;
    reps: RepDetection;
    actual_km: number;
    planned_km: number;
    avg_pace_s_per_km: number | null;
    moving_time_s: number;
    flags: string[];
  };
}

function listNums(n: number[]): string {
  if (n.length === 1) return `Rep ${n[0]}`;
  return `Reps ${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;
}

export function scoreRun(session: EffSession, act: Act, zones: Zones): ScoreResult {
  const planned = session.distance_km ?? 0;
  const actualKm = act.distance_m / 1000;
  const ratio = planned > 0 ? actualKm / planned : 1;
  const dScore = distanceScore(ratio);
  const avgPace = act.distance_m > 0 ? act.moving_time_s / (act.distance_m / 1000) : null;
  const flags: string[] = [];
  const reps = detectReps(session.segments, act, zones);
  const hrFirst = session.kind === "easy" || session.kind === "long";

  if (ratio < 0.85) flags.push(`Only ${Math.round(ratio * 100)}% of the planned distance.`);
  for (const r of reps.reps) if (r.hr_flag) flags.push(`Rep ${r.rep_no}: average HR ${Math.round(r.avg_hr!)} bpm was above the ${r.hr_max} bpm ceiling.`);

  if (hrFirst) {
    const hr = hrCompliance(session, act, zones);
    const hrScore = hr.pct_under;
    const overall = hrScore == null ? dScore : 0.5 * dScore + 0.5 * hrScore;
    const label = session.kind === "long" ? "Long run" : "Easy run";
    let verdict: string;
    if (hr.method === "none") verdict = `${label}: ${fmtKm(actualKm)} at ${fmtPace(avgPace)} /km. No HR data, so only distance was scored.`;
    else if (hr.method === "average")
      verdict =
        act.avg_hr! <= hr.limit!
          ? `${label} done right: average HR ${Math.round(act.avg_hr!)} bpm, under ${hr.limit} bpm. (No second-by-second HR, so this uses the average.)`
          : `${label} went too hard: average HR ${Math.round(act.avg_hr!)} bpm, above ${hr.limit} bpm. Slow down or walk briefly next time.`;
    else if (hrScore! >= 80) verdict = `${label} done right: ${Math.round(hrScore!)}% of the time under ${hr.limit} bpm.`;
    else verdict = `${label} went too hard: ${Math.round(hr.pct_over!)}% of the time above ${hr.limit} bpm. Slow down or walk briefly next time.`;
    if (ratio < 0.85) verdict += ` You covered ${fmtKm(actualKm)} of ${fmtKm(planned)}.`;
    const fast = reps.reps.filter((r) => r.in_range !== null);
    if (fast.length) {
      const r = fast[0];
      verdict += ` Fast finish: ${fmtPace(r.pace_s_per_km)} /km (target ${fmtPace(r.target_min)}–${fmtPace(r.target_max)}).`;
    }
    return {
      distance_ratio: ratio,
      distance_score: dScore,
      hr_score: hrScore,
      pace_score: null,
      overall_score: overall,
      verdict,
      details: { primary: "HR", hr, reps, actual_km: actualKm, planned_km: planned, avg_pace_s_per_km: avgPace, moving_time_s: act.moving_time_s, flags },
    };
  }

  const scorable = reps.reps.filter((r) => r.in_range !== null);
  const paceScore = scorable.length ? (scorable.filter((r) => r.in_range).length / scorable.length) * 100 : null;
  const overall = paceScore == null ? dScore : 0.3 * dScore + 0.7 * paceScore;
  let verdict: string;
  if (reps.method === "manual") verdict = `Couldn't find the reps automatically (no matching laps or streams). Distance ${fmtKm(actualKm)} scored; check the reps yourself.`;
  else if (!scorable.length)
    verdict = `${fmtKm(actualKm)} in ${fmtDuration(act.moving_time_s)} (${fmtPace(avgPace)} /km). No pace target to score for this session.`;
  else {
    const fastR = scorable.filter((r) => (r.delta_s ?? 0) < 0);
    const slowR = scorable.filter((r) => (r.delta_s ?? 0) > 0);
    const parts: string[] = [];
    if (!fastR.length && !slowR.length) parts.push(`All ${scorable.length} reps on target. Well judged.`);
    if (fastR.length) {
      const avg = Math.round(-fastR.reduce((t, r) => t + r.delta_s!, 0) / fastR.length);
      parts.push(`${listNums(fastR.map((r) => r.rep_no))} ${fastR.length === 1 ? "was" : "were"} ${avg} s/km faster than target; slow down next time.`);
    }
    if (slowR.length) {
      const avg = Math.round(slowR.reduce((t, r) => t + r.delta_s!, 0) / slowR.length);
      parts.push(`${listNums(slowR.map((r) => r.rep_no))} ${slowR.length === 1 ? "was" : "were"} ${avg} s/km slower than target.`);
    }
    verdict = parts.join(" ");
  }
  return {
    distance_ratio: ratio,
    distance_score: dScore,
    hr_score: null,
    pace_score: paceScore,
    overall_score: overall,
    verdict,
    details: { primary: "pace", hr: null, reps, actual_km: actualKm, planned_km: planned, avg_pace_s_per_km: avgPace, moving_time_s: act.moving_time_s, flags },
  };
}
