import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { loadEffective, zoneResolver } from "@/lib/server/data";
import { strengthItems } from "@/lib/server/view";

/**
 * Phase-2 hook for a WorkoutKit iPhone app: effective sessions (after Mike's changes) with every
 * segment's distance or duration, pace range in s/km and HR range, from the zone set active that day.
 */
export async function GET(req: NextRequest) {
  const db = await getDb();
  const from = req.nextUrl.searchParams.get("from") ?? "0000-00-00";
  const to = req.nextUrl.searchParams.get("to") ?? "9999-99-99";
  const zr = await zoneResolver(db);
  const sessions = (await loadEffective(db))
    .filter((s) => s.date >= from && s.date <= to)
    .map((s) => {
      const z = zr(s);
      return {
        id: s.id, date: s.date, slot: s.slot, week: s.week, category: s.category, kind: s.kind, title: s.title,
        distance_km: s.distance_km, est_duration_min: s.est_duration_min, skipped: s.skipped, optional: s.optional,
        changed: s.override ? { reason: s.override.reason, plan_date: s.plan_date } : null,
        zone_set: { id: z.id, label: z.label },
        segments: s.segments.map((g) => {
          const zz = z.zones[g.zone];
          const rec = g.recovery ? z.zones[g.recovery.zone] : null;
          return {
            kind: g.kind, zone: g.zone, repeat: g.repeat,
            distance_m: g.distance_km != null ? Math.round(g.distance_km * 1000) : null,
            duration_s: g.duration_s ?? null,
            pace_s_per_km: zz.pace_min_s_per_km != null ? [zz.pace_min_s_per_km, zz.pace_max_s_per_km] : null,
            hr_bpm: zz.hr_min != null || zz.hr_max != null ? [zz.hr_min, zz.hr_max] : null,
            primary_target: zz.primary_target,
            recovery: g.recovery ? { duration_s: g.recovery.duration_s, zone: g.recovery.zone, hr_max: rec?.hr_max ?? null } : null,
            note: g.note ?? null,
          };
        }),
        strength: s.category === "strength" ? strengthItems(s) : null,
      };
    });
  return NextResponse.json({ timezone: "Asia/Jakarta", sessions });
}
