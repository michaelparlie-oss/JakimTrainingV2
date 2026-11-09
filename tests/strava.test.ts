import { describe, it, expect } from "vitest";
import { parseDescription } from "@/lib/strava/parse";
import { StravaClient, RateLimitPause, nextWindow, readRate } from "@/lib/strava/client";
import { openDb } from "@/db/client";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { seedPlan } from "@/db/seed";
import { stravaToken, sessionMatch, wellbeingLog } from "@/db/schema";
import { syncStrava } from "@/lib/strava/sync";
import { eq } from "drizzle-orm";

describe("description parser", () => {
  it("parses the agreed line", () => {
    expect(parseDescription("Felt ok. knee 2 bunion 1 rpe 5 carbs 60")).toEqual({ knee_pain: 2, bunion_pain: 1, rpe: 5, carbs_g: 60 });
  });
  it("is case-insensitive, accepts : and =, clamps", () => {
    expect(parseDescription("KNEE: 14, Bunion=0, RPE 0")).toEqual({ knee_pain: 10, bunion_pain: 0, rpe: 1, carbs_g: null });
  });
  it("returns null when nothing parses", () => {
    expect(parseDescription("Morning run")).toBeNull();
    expect(parseDescription(null)).toBeNull();
  });
});

const hdr = (usage: string, limit = "200,2000") =>
  new Headers({ "x-ratelimit-limit": limit, "x-ratelimit-usage": usage, "x-readratelimit-limit": "100,1000", "x-readratelimit-usage": usage });
const json = (body: unknown, status = 200, headers = hdr("10,50")) => new Response(JSON.stringify(body), { status, headers });

describe("rate limits", () => {
  it("reads the most constraining header pair", () => {
    expect(readRate(hdr("85,300"))).toMatchObject({ short_usage: 85, short_limit: 100 });
  });
  it("next window is the next quarter hour", () => {
    expect(nextWindow(new Date("2026-11-09T04:07:30Z")).toISOString()).toBe("2026-11-09T04:15:02.000Z");
  });
  it("a 429 waits until the next window and then resumes", async () => {
    const waits: number[] = [];
    let n = 0;
    const c = new StravaClient({
      getAccessToken: async () => "t",
      now: () => new Date("2026-11-09T04:07:30Z"),
      sleep: async (ms) => { waits.push(ms); },
      fetch: async () => (++n === 1 ? json({ message: "Rate Limit Exceeded" }, 429, hdr("101,300")) : json([{ id: 1 }])),
    });
    await expect(c.get("/athlete/activities")).resolves.toEqual([{ id: 1 }]);
    expect(waits).toEqual([7.5 * 60 * 1000 + 2000]);
  });
  it("pauses before the next call at ≥ 80% usage", async () => {
    const waits: number[] = [];
    const c = new StravaClient({ getAccessToken: async () => "t", now: () => new Date("2026-11-09T04:10:00Z"), sleep: async (ms) => { waits.push(ms); }, fetch: async () => json([], 200, hdr("80,300")) });
    await c.get("/a");
    expect(waits).toEqual([]);
    await c.get("/b");
    expect(waits).toEqual([5 * 60 * 1000 + 2000]);
  });
  it("throws RateLimitPause instead of blocking longer than allowed", async () => {
    const c = new StravaClient({ getAccessToken: async () => "t", maxWaitMs: 0, now: () => new Date("2026-11-09T04:10:00Z"), fetch: async () => json({}, 429, hdr("101,300")) });
    await expect(c.get("/a")).rejects.toBeInstanceOf(RateLimitPause);
  });
});

describe("sync (M2) against a mocked Strava", () => {
  function mockStrava(opts: { first429?: boolean } = {}) {
    let calls = 0;
    const log: string[] = [];
    const run = {
      id: 20914544144, name: "Morning Run", sport_type: "Run", start_date: "2026-11-08T21:21:29Z", start_date_local: "2026-11-09T04:21:29Z",
      distance: 8011.59, moving_time: 3786, elapsed_time: 4063, average_heartrate: 145.708, max_heartrate: 158, average_speed: 2.116,
    };
    const walk = { ...run, id: 20889203851, sport_type: "Walk", start_date_local: "2026-11-07T08:25:08Z", distance: 282 };
    const f = async (url: string, init?: RequestInit) => {
      calls++;
      log.push(url.replace("https://www.strava.com", ""));
      if (url.includes("/oauth/token")) {
        const body = String(init?.body);
        expect(body).toContain("grant_type=refresh_token");
        return json({ access_token: "new-access", refresh_token: "rotated-refresh", expires_at: 9999999999 });
      }
      if (opts.first429 && calls === 2) return json({ message: "Rate Limit Exceeded" }, 429, hdr("101,300"));
      if (url.includes("/athlete/activities")) return json([run, walk]);
      if (url.endsWith(`/activities/${run.id}`)) return json({ ...run, description: "knee 2 bunion 1 rpe 4", laps: [{ distance: 8007.74, moving_time: 3784, elapsed_time: 4063, average_heartrate: 145.7 }] });
      if (url.includes("/streams")) return json({ time: { data: [0, 1] }, distance: { data: [0, 2] }, heartrate: { data: [140, 141] } });
      return json({}, 404);
    };
    return { f, log };
  }

  async function freshDb() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jakim-"));
    const db = await openDb(`file:${path.join(dir, "t.db")}`);
    await seedPlan(db);
    await db.insert(stravaToken).values({ id: 1, access_token: "old", refresh_token: "r1", expires_at: 1, scope: "read,activity:read_all" }).run();
    return db;
  }

  it("refreshes the token, stores the rotated refresh token, matches the 9 Nov run as done, parses the description", async () => {
    process.env.APP_TODAY = "2026-11-10";
    const db = await freshDb();
    const { f, log } = mockStrava();
    const r = await syncStrava(db, { fetch: f as typeof fetch });
    expect(r.status).toBe("ok");
    expect((await db.select().from(stravaToken).get())!.refresh_token).toBe("rotated-refresh");
    const m = (await db.select().from(sessionMatch).where(eq(sessionMatch.plan_session_id, "2026-11-09-AM-run")).get())!;
    expect(m).toMatchObject({ strava_activity_id: 20914544144, status: "done" });
    expect(await db.select().from(wellbeingLog).get()).toMatchObject({ knee_pain: 2, bunion_pain: 1, rpe: 4, source: "strava_description" });
    expect(log.some((u) => u.includes("20889203851"))).toBe(false); // walks are not stored or fetched
    // A second sync does not re-fetch processed activities.
    const before = log.length;
    // (the first sync left status idle, so the next call isn't treated as busy)
    await syncStrava(db, { fetch: f as typeof fetch });
    expect(log.slice(before).filter((u) => u.includes("/activities/2"))).toEqual([]);
    delete process.env.APP_TODAY;
  });

  it("a mocked 429 makes the sync wait and resume without crashing", async () => {
    process.env.APP_TODAY = "2026-11-10";
    const db = await freshDb();
    const waits: number[] = [];
    const { f } = mockStrava({ first429: true });
    const r = await syncStrava(db, { fetch: f as typeof fetch, sleep: async (ms) => { waits.push(ms); }, maxWaitMs: Infinity });
    expect(waits.length).toBe(1);
    expect(r.status).toBe("ok");
    expect((await db.select().from(sessionMatch).where(eq(sessionMatch.plan_session_id, "2026-11-09-AM-run")).get())!.status).toBe("done");
    delete process.env.APP_TODAY;
  });

  it("on serverless a 429 pauses the sync (no blocking wait) and the next call resumes", async () => {
    process.env.APP_TODAY = "2026-11-10";
    const db = await freshDb();
    const { f } = mockStrava({ first429: true });
    const r1 = await syncStrava(db, { fetch: f as typeof fetch, maxWaitMs: 0 });
    expect(r1.status).toBe("paused");
    const r2 = await syncStrava(db, { fetch: f as typeof fetch, force: true });
    expect(r2.status).toBe("ok");
    delete process.env.APP_TODAY;
  });

  it("stops at the time budget with 'partial' and finishes on the next call; the score is cached", async () => {
    process.env.APP_TODAY = "2026-11-10";
    const db = await freshDb();
    const { f } = mockStrava();
    const r1 = await syncStrava(db, { fetch: f as typeof fetch, budgetMs: -1 });
    expect(r1).toMatchObject({ status: "partial", detailed: 0, remaining: 1 });
    const r2 = await syncStrava(db, { fetch: f as typeof fetch });
    expect(r2).toMatchObject({ status: "ok", detailed: 1, remaining: 0 });
    const m = (await db.select().from(sessionMatch).where(eq(sessionMatch.plan_session_id, "2026-11-09-AM-run")).get())!;
    expect(m.score_key).toBeTruthy();
    delete process.env.APP_TODAY;
  });
});
