import { loadPlan } from "@/lib/plan/load";
import { buildEffective } from "@/lib/adapt/effective";
import type { EffSession, OverrideRow, PlanSessionRow } from "@/lib/adapt/types";
import type { Act, Lap, Streams } from "@/lib/match/types";
import type { Zones } from "@/lib/plan/schema";

export const plan = loadPlan();
export const zonesV1: Zones = plan.zone_sets.v1.zones;

export function planRows(): PlanSessionRow[] {
  return plan.sessions.map((x) => ({
    id: x.id, date: x.date, slot: x.slot, week: x.week, phase: x.phase, category: x.category,
    kind: x.kind ?? null, title: x.title, distance_km: x.distance_km ?? null, est_duration_min: x.est_duration_min ?? null,
    zone_set: x.zone_set, deload_week: x.deload_week, optional: !!x.optional, template: x.template ?? null,
    segments_json: x.segments ? JSON.stringify(x.segments) : null, summary: x.summary ?? null, rpe_text: x.rpe ?? null,
    post_run_log_json: x.post_run_log ? JSON.stringify(x.post_run_log) : null,
  }));
}

export function effective(overrides: OverrideRow[] = []): EffSession[] {
  return buildEffective(planRows(), overrides);
}

export function session(id: string, sessions = effective()): EffSession {
  const s = sessions.find((x) => x.id === id);
  if (!s) throw new Error(id);
  return s;
}

let nextId = 1000;
export function act(date: string, km: number, extra: Partial<Act> = {}): Act {
  const pace = 480; // s/km
  return {
    id: nextId++, local_date: date, start_date_local: `${date}T05:00:00Z`, sport_type: "Run",
    distance_m: km * 1000, moving_time_s: Math.round(km * pace), elapsed_time_s: Math.round(km * pace) + 60,
    avg_hr: 145, max_hr: 158, avg_speed: 1000 / pace, laps: null, streams: null, ...extra,
  };
}

/** Synthetic 1 Hz streams from a list of [metres, pace s/km, hr] blocks. */
export function streamsFrom(blocks: [number, number, number][]): Streams {
  const time: number[] = [0], distance: number[] = [0], heartrate: number[] = [blocks[0][2]], moving: boolean[] = [true];
  let t = 0, d = 0;
  for (const [m, pace, hr] of blocks) {
    const v = 1000 / pace;
    const end = d + m;
    while (d < end - 1e-9) {
      t += 1; d = Math.min(end, d + v);
      time.push(t); distance.push(d); heartrate.push(hr); moving.push(true);
    }
  }
  return { time, distance, heartrate, moving };
}

export function lap(m: number, pace: number, hr: number): Lap {
  const tm = Math.round((m / 1000) * pace);
  return { distance: m, moving_time: tm, elapsed_time: tm, average_heartrate: hr };
}

export function actFromStreams(date: string, st: Streams, extra: Partial<Act> = {}): Act {
  const d = st.distance[st.distance.length - 1], t = st.time[st.time.length - 1];
  const hr = st.heartrate!.reduce((a, b) => a + b, 0) / st.heartrate!.length;
  return act(date, d / 1000, { moving_time_s: t, elapsed_time_s: t, avg_hr: hr, streams: st, ...extra });
}
