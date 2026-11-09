import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { authorizeUrl } from "@/lib/strava/oauth";

export async function GET() {
  const state = crypto.randomUUID();
  (await cookies()).set("strava_state", state, { httpOnly: true, sameSite: "lax", maxAge: 600, path: "/" });
  return NextResponse.redirect(authorizeUrl(state));
}
