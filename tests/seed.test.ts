import { describe, it, expect, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { eq } from "drizzle-orm";
import { openDb } from "@/db/client";
import { ensureSeeded, seedPlan } from "@/db/seed";
import { sessionMatch, stravaActivity } from "@/db/schema";
import { recompute } from "@/lib/server/recompute";
import { planHash } from "@/lib/plan/load";
import type { Plan } from "@/lib/plan/schema";
import { plan, streamsFrom } from "./helpers";

const ID = "2026-11-11-AM-run";

/** The plan as it was before 11 Nov became 2×3 km: 3×2 km HMP / 2 min jog, 1.1 km cool-down. */
function oldPlan(): Plan {
  const p: Plan = JSON.parse(JSON.stringify(plan));
  const s = p.sessions.find((x) => x.id === ID)!;
  s.title = "Astra pace: 3×2 km @ Astra pace / 2 min jog";
  s.segments = [
    { kind: "warmup", zone: "E", repeat: 1, distance_km: 2 },
    { kind: "work", zone: "HMP", repeat: 3, distance_km: 2, recovery: { zone: "REC", duration_s: 120 } },
    { kind: "cooldown", zone: "E", repeat: 1, distance_km: 1.1 },
  ] as never;
  return p;
}

async function repsFor(db: Awaited<ReturnType<typeof openDb>>) {
  const m = (await db.select().from(sessionMatch).where(eq(sessionMatch.plan_session_id, ID)).get())!;
  return JSON.parse(m.details_json!).reps.reps as unknown[];
}

afterEach(() => { delete process.env.APP_TODAY; });

describe("plan updates re-score stored runs", () => {
  it("a new plan JSON replaces the old analysis without waiting for a sync", async () => {
    process.env.APP_TODAY = "2026-11-12";
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jakim-seed-"));
    const db = await openDb(`file:${path.join(dir, "t.db")}`);
    await seedPlan(db, oldPlan(), "old-hash");

    // Tonight's run: 2 km easy, 2×3 km with a 3 min jog, easy finish.
    const st = streamsFrom([[2000, 500, 140], [3000, 450, 171], [350, 570, 150], [3000, 445, 173], [1200, 510, 150]]);
    const km = st.distance[st.distance.length - 1] / 1000;
    await db.insert(stravaActivity).values({
      id: 20946605758, start_date_local: "2026-11-11T18:54:46Z", local_date: "2026-11-11", sport_type: "Run",
      distance_m: km * 1000, moving_time_s: st.time[st.time.length - 1], elapsed_time_s: st.time[st.time.length - 1],
      avg_hr: 161, max_hr: 181, avg_speed: (km * 1000) / st.time[st.time.length - 1],
      streams_json: JSON.stringify(st), detail_fetched: true, synced_at: 1,
    }).run();

    await recompute(db);
    expect(await repsFor(db)).toHaveLength(3); // scored against the old 3×2 km session

    expect(await ensureSeeded(db, plan, planHash())).toBe(true);
    expect(await repsFor(db)).toHaveLength(2); // re-scored against 2×3 km straight away

    expect(await ensureSeeded(db, plan, planHash())).toBe(false); // same plan: no work
  });
});
