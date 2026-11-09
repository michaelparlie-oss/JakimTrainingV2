import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { exchangeCode } from "@/lib/strava/oauth";

export async function GET(req: NextRequest) {
  const u = req.nextUrl;
  const jar = await cookies();
  const back = (q: string) => NextResponse.redirect(new URL(`/settings?strava=${q}`, req.url));
  if (u.searchParams.get("error") || !u.searchParams.get("code")) return back("error");
  if (u.searchParams.get("state") !== jar.get("strava_state")?.value) return back("error");
  jar.delete("strava_state");
  const scope = u.searchParams.get("scope") ?? "";
  if (!scope.includes("activity:read_all") && !scope.includes("activity:read")) return back("scope");
  try {
    await exchangeCode(await getDb(), u.searchParams.get("code")!, scope);
  } catch {
    return back("error");
  }
  // Today auto-syncs on open (backfill from 2026-10-01, resumed in steps).
  return NextResponse.redirect(new URL("/?connected=1", req.url));
}
