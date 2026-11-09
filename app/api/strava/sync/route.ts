import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { syncStrava } from "@/lib/strava/sync";

/**
 * One resumable sync step. Called by the app (login cookie) or by the scheduled function
 * (netlify/functions/strava-sync.mts) with the header `x-cron-secret: $CRON_SECRET`.
 * With ?loop=1 it keeps stepping until done or ~20 s have passed.
 */
export async function POST(req: NextRequest) {
  const db = await getDb();
  const loop = req.nextUrl.searchParams.get("loop") === "1";
  const started = Date.now();
  let r = await syncStrava(db);
  while (loop && r.status === "partial" && Date.now() - started < 20_000) r = await syncStrava(db);
  return NextResponse.json(r);
}
