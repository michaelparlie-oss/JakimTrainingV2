import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db/client";
import * as t from "@/db/schema";

function csv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}

export async function GET(req: NextRequest) {
  const db = await getDb();
  const fmt = req.nextUrl.searchParams.get("format") ?? "json";
  const runs = await db.select({ id: t.stravaActivity.id, date: t.stravaActivity.local_date, sport: t.stravaActivity.sport_type, name: t.stravaActivity.name, distance_m: t.stravaActivity.distance_m, moving_time_s: t.stravaActivity.moving_time_s, avg_hr: t.stravaActivity.avg_hr }).from(t.stravaActivity).all();
  const data = {
    runs,
    matches: await db.select({ plan_session_id: t.sessionMatch.plan_session_id, strava_activity_id: t.sessionMatch.strava_activity_id, status: t.sessionMatch.status, overall_score: t.sessionMatch.overall_score, verdict: t.sessionMatch.verdict }).from(t.sessionMatch).all(),
    strength: await db.select().from(t.strengthLog).all(),
    wellbeing: await db.select().from(t.wellbeingLog).all(),
    checkpoints: await db.select().from(t.checkpointResult).all(),
    plan_changes: await db.select().from(t.planChange).all(),
    overrides: await db.select().from(t.sessionOverride).all(),
  };
  const stamp = new Date().toISOString().slice(0, 10);
  if (fmt === "csv") {
    const table = (req.nextUrl.searchParams.get("table") ?? "runs") as keyof typeof data;
    const rows = (data[table] ?? []) as Record<string, unknown>[];
    return new NextResponse(csv(rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="jakim-${table}-${stamp}.csv"` } });
  }
  return new NextResponse(JSON.stringify(data, null, 2), { headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="jakim-export-${stamp}.json"` } });
}
