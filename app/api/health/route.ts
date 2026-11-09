import { NextResponse, type NextRequest } from "next/server";
import { sql } from "drizzle-orm";

/** Hide URLs and anything that looks like a token before showing an error. */
function clean(e: unknown): string {
  const m = e instanceof Error ? `${e.name}: ${e.message}${e.cause ? ` (cause: ${String((e.cause as Error).message ?? e.cause)})` : ""}` : String(e);
  return m
    .replace(/(libsql|https?|wss?):\/\/[^\s"')]+/g, "<url>")
    .replace(/[A-Za-z0-9_-]{24,}(\.[A-Za-z0-9_-]+)*/g, "<hidden>")
    .slice(0, 600);
}

/**
 * Public health check. /api/health?db=1 also tests the database step by step and reports timings
 * (no data, URLs or tokens are shown). Used to diagnose a new deploy.
 */
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("db") !== "1") return NextResponse.json({ ok: true });
  const env = {
    TURSO_DATABASE_URL: process.env.TURSO_DATABASE_URL ? `set (${process.env.TURSO_DATABASE_URL.split(":")[0]}://…)` : "MISSING",
    TURSO_AUTH_TOKEN: process.env.TURSO_AUTH_TOKEN ? `set (${process.env.TURSO_AUTH_TOKEN.length} chars)` : "MISSING",
    APP_PASSCODE: process.env.APP_PASSCODE ? "set" : "MISSING",
    SESSION_SECRET: process.env.SESSION_SECRET ? "set" : "MISSING",
    CRON_SECRET: process.env.CRON_SECRET ? "set" : "MISSING",
    STRAVA_CLIENT_ID: process.env.STRAVA_CLIENT_ID ? "set" : "missing (needed only for Strava)",
  };
  const steps: { step: string; ms: number; ok: boolean; info?: string }[] = [];
  const time = async <T,>(step: string, fn: () => Promise<T>, info?: (r: T) => string) => {
    const t0 = Date.now();
    try {
      const r = await fn();
      steps.push({ step, ms: Date.now() - t0, ok: true, info: info?.(r) });
      return r;
    } catch (e) {
      steps.push({ step, ms: Date.now() - t0, ok: false, info: clean(e) });
      throw e;
    }
  };
  try {
    const { openDb } = await time("load database module", () => import("@/db/client"));
    const db = await time("connect + create tables", () => openDb());
    const { ensureSeeded } = await import("@/db/seed");
    await time("import training plan", () => ensureSeeded(db));
    await time("read plan", () => db.all<{ n: number }>(sql`select count(*) as n from plan_session`), (r) => `${r[0]?.n} sessions`);
    const { ctx } = await import("@/lib/server/view");
    await time("build Today data", () => ctx(db), (c) => `${c.sessions.length} sessions, ${c.acts.length} activities, today ${c.today}`);
    return NextResponse.json({ ok: true, env, steps });
  } catch {
    return NextResponse.json({ ok: false, env, steps }, { status: 500 });
  }
}
