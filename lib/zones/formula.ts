import type { Plan, Zone, ZoneCode, Zones } from "@/lib/plan/schema";
import { ZONE_CODES } from "@/lib/plan/schema";
import { fmtPaceRange } from "@/lib/util/format";

export const HM_KM = 21.0975;
export const MARATHON_KM = 42.195;
export const RIEGEL_EXP = 1.06;
const RIEGEL_FACTOR = Math.pow(HM_KM / 10, RIEGEL_EXP);

export type ZoneBasis =
  | { kind: "10k"; seconds: number }
  | { kind: "hm"; seconds: number };

export interface RefPaces {
  t10: number; // 10K time, s (unrounded)
  p10: number; // s/km
  phm: number; // s/km
  goal_mp: number; // s/km
}

/** Reference paces per meta.zone_formula. */
export function refPaces(basis: ZoneBasis, goalTimeS: number): RefPaces {
  let t10: number, phm: number;
  if (basis.kind === "10k") {
    t10 = basis.seconds;
    phm = (t10 * RIEGEL_FACTOR) / HM_KM;
  } else {
    phm = basis.seconds / HM_KM;
    t10 = basis.seconds / RIEGEL_FACTOR;
  }
  return { t10, p10: t10 / 10, phm, goal_mp: goalTimeS / MARATHON_KM };
}

export type HrOverrides = Partial<Record<ZoneCode, { hr_min: number | null; hr_max: number | null }>>;

/**
 * Build a complete zone set. Names, feel text and primary targets come from the plan's v1 zones;
 * offsets and HR ranges come from meta.zone_formula.rules. Nothing is hard-coded here.
 */
export function computeZones(plan: Plan, basis: ZoneBasis, goalTimeS: number, hr: HrOverrides = {}): Zones {
  const refs = refPaces(basis, goalTimeS);
  const rules = plan.meta.zone_formula.rules;
  const template = plan.zone_sets.v1.zones;
  const out = {} as Zones;
  for (const code of ZONE_CODES) {
    const r = rules[code];
    const t = template[code];
    let min: number | null = null,
      max: number | null = null;
    if (r.ref && r.lo != null && r.hi != null) {
      const ref = refs[r.ref];
      min = Math.round(ref + r.lo);
      max = Math.round(ref + r.hi);
    }
    const hrO = hr[code];
    const z: Zone = {
      ...t,
      pace_min_s_per_km: min,
      pace_max_s_per_km: max,
      pace_text: fmtPaceRange(min, max),
      hr_min: hrO ? hrO.hr_min : r.hr[0],
      hr_max: hrO ? hrO.hr_max : r.hr[1],
    };
    out[code] = z;
  }
  return out;
}

/** Apply HR overrides from Settings to any zone set (plan or checkpoint). */
export function applyHrOverrides(zones: Zones, hr: HrOverrides): Zones {
  const out = { ...zones };
  for (const [code, o] of Object.entries(hr) as [ZoneCode, { hr_min: number | null; hr_max: number | null }][]) {
    if (o && out[code]) out[code] = { ...out[code], hr_min: o.hr_min, hr_max: o.hr_max };
  }
  return out;
}

/** Largest amount (s/km) by which any pace zone in `next` is faster than in `prev`. */
export function maxSpeedup(prev: Zones, next: Zones): { code: ZoneCode | null; seconds: number } {
  let best: { code: ZoneCode | null; seconds: number } = { code: null, seconds: 0 };
  for (const code of ZONE_CODES) {
    const a = prev[code]?.pace_min_s_per_km,
      b = next[code]?.pace_min_s_per_km;
    if (a == null || b == null) continue;
    if (a - b > best.seconds) best = { code, seconds: a - b };
  }
  return best;
}

export const SANITY_GUARD_S = 25;

export function parseGoal(txt: string): number {
  const [h, m, s] = txt.split(":").map(Number);
  return h * 3600 + m * 60 + (s || 0);
}

/** CP3 goal rule (brief §8). Returns the suggestion; the app must ask before applying it. */
export function cp3GoalAdvice(hmSeconds: number): {
  verdict: "keep" | "adjust" | "reset";
  options_s: number[];
  message: string;
} {
  if (hmSeconds <= 2 * 3600 + 24 * 60)
    return { verdict: "keep", options_s: [], message: "On track. Keep the 4:59:00 goal." };
  if (hmSeconds <= 2 * 3600 + 30 * 60)
    return {
      verdict: "adjust",
      options_s: [5 * 3600, 5 * 3600 + 5 * 60, 5 * 3600 + 10 * 60],
      message: "Half marathon between 2:24 and 2:30. The plan suggests a goal of 5:00–5:10.",
    };
  return {
    verdict: "reset",
    options_s: [5 * 3600 + 15 * 60],
    message: "Half marathon slower than 2:30. The plan suggests a goal of about 5:15.",
  };
}
