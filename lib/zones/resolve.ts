import type { Zones } from "@/lib/plan/schema";
import { applyHrOverrides, type HrOverrides } from "./formula";
import { fmtPaceRange } from "@/lib/util/format";

export interface ZoneSetRow {
  id: string;
  label: string;
  basis_kind: string;
  basis_seconds: number | null;
  goal_time_s: number | null;
  effective_from_date: string | null;
  source: string;
  checkpoint_id: string | null;
  zones_json: string;
  active: boolean;
  created_at: number;
}

export interface ResolvedZones {
  id: string;
  label: string;
  source: string;
  zones: Zones;
}

/**
 * §8: latest checkpoint/goal-sourced set with effective_from_date ≤ date wins;
 * otherwise the plan's projected set named on the session (v1/v2/v3).
 */
export function resolveZones(
  date: string,
  planSetName: string,
  sets: ZoneSetRow[],
  hr: HrOverrides = {},
  mp?: { min: number; max: number } | null,
): ResolvedZones {
  const measured = sets
    .filter((s) => s.active && s.source !== "plan_json" && s.effective_from_date && s.effective_from_date <= date)
    .sort((a, b) =>
      a.effective_from_date === b.effective_from_date
        ? b.created_at - a.created_at
        : b.effective_from_date!.localeCompare(a.effective_from_date!),
    );
  const pick = measured[0] ?? sets.find((s) => s.id === planSetName && s.source === "plan_json");
  if (!pick) throw new Error(`No zone set for ${date} (${planSetName})`);
  let zones: Zones = applyHrOverrides(JSON.parse(pick.zones_json), hr);
  // MP depends only on the goal time (§8), so a changed goal applies to every zone set.
  if (mp) zones = { ...zones, MP: { ...zones.MP, pace_min_s_per_km: mp.min, pace_max_s_per_km: mp.max, pace_text: fmtPaceRange(mp.min, mp.max) } };
  return { id: pick.id, label: pick.label, source: pick.source, zones };
}
