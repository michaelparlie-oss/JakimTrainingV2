import { and, eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import * as t from "@/db/schema";
import { matchRuns } from "@/lib/match/match";
import { isRunActivity } from "@/lib/match/types";
import { epochOfLocalDate, localDateOf, nowEpoch, todayLocal } from "@/lib/util/dates";
import { loadActivities, loadEffective } from "@/lib/server/data";
import { recompute, loadManualLinks } from "@/lib/server/recompute";
import { getSettings, setSetting } from "@/lib/server/settings";
import { RateLimitPause, StravaClient, type FetchFn, type SleepFn } from "./client";
import { getToken, validAccessToken } from "./oauth";
import { parseDescription } from "./parse";

export const BACKFILL_FROM = "2026-10-01";
/** Re-list this many days before the newest activity: Apple Health → Strava uploads can arrive late. */
export const RELIST_OVERLAP_DAYS = 7;
export const AUTO_SYNC_AFTER_S = 30 * 60;
export const STORED_SPORTS = ["Run", "TrailRun", "VirtualRun", "WeightTraining", "Workout"];
/** Serverless functions are cut off after ~10 s, so one sync call stops itself after this and reports "partial". */
export const DEFAULT_BUDGET_MS = 7000;
/** Streams are stored at ≤ this many points (≈ every 5 s on a 3 h run): plenty for scoring, small to read. */
export const MAX_STREAM_POINTS = 2500;

interface SummaryActivity {
  id: number; name: string; sport_type: string; start_date: string; start_date_local: string; distance: number;
  moving_time: number; elapsed_time: number; average_heartrate?: number; max_heartrate?: number; average_speed?: number; total_elevation_gain?: number;
}
interface DetailActivity extends SummaryActivity { description?: string | null; laps?: unknown[] }
type StreamSet = Record<string, { data: unknown[] }>;

export interface SyncDeps {
  fetch?: FetchFn;
  sleep?: SleepFn;
  now?: () => Date;
  /** Longest in-call wait for a rate-limit window. 0 on serverless: store "paused" and resume on the next call. */
  maxWaitMs?: number;
  budgetMs?: number;
  force?: boolean;
}

export interface SyncResult {
  status: "ok" | "partial" | "paused" | "error" | "busy" | "disconnected";
  listed: number;
  detailed: number;
  remaining: number;
  calls: number;
  message: string;
  resume_at?: string;
}

export function downsample(st: Record<string, unknown[]>, max = MAX_STREAM_POINTS): Record<string, unknown[]> {
  const n = (st.time ?? st.distance ?? []).length;
  if (n <= max) return st;
  const k = Math.ceil(n / max);
  const idx: number[] = [];
  for (let i = 0; i < n; i += k) idx.push(i);
  if (idx[idx.length - 1] !== n - 1) idx.push(n - 1);
  return Object.fromEntries(Object.entries(st).map(([key, arr]) => [key, idx.map((i) => arr[i])]));
}

function summaryRow(a: SummaryActivity) {
  return {
    id: a.id, start_date_local: a.start_date_local, local_date: localDateOf(a.start_date_local), sport_type: a.sport_type, name: a.name,
    distance_m: a.distance, moving_time_s: a.moving_time, elapsed_time_s: a.elapsed_time, avg_hr: a.average_heartrate ?? null,
    max_hr: a.max_heartrate ?? null, avg_speed: a.average_speed ?? null, total_elevation_gain: a.total_elevation_gain ?? null,
    raw_json: JSON.stringify(a), synced_at: nowEpoch(),
  };
}

export function wellbeingWrites(db: DB, activityId: number, date: string, description: string | null | undefined) {
  const p = parseDescription(description);
  const q = [db.delete(t.wellbeingLog).where(and(eq(t.wellbeingLog.strava_activity_id, activityId), eq(t.wellbeingLog.source, "strava_description")))];
  if (p) q.push(db.insert(t.wellbeingLog).values({ date, source: "strava_description", strava_activity_id: activityId, ...p, note: null, created_at: nowEpoch() }) as never);
  return q;
}

/** Full detail (description + laps) and streams for one activity. */
export async function fetchDetail(db: DB, client: StravaClient, id: number) {
  const d = await client.get<DetailActivity>(`/activities/${id}`);
  const laps = d.laps ?? (await client.get<unknown[]>(`/activities/${id}/laps`));
  let streams: Record<string, unknown[]> | null = null;
  if (isRunActivity(d)) {
    try {
      const s = await client.get<StreamSet>(`/activities/${id}/streams`, { keys: "time,distance,heartrate,velocity_smooth,moving", key_by_type: "true" });
      streams = downsample(Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v.data])));
    } catch (e) {
      if (e instanceof RateLimitPause) throw e;
      streams = null; // e.g. a manual activity without GPS
    }
  }
  await db.batch([
    db.update(t.stravaActivity)
      .set({ description: d.description ?? null, laps_json: laps ? JSON.stringify(laps) : null, streams_json: streams ? JSON.stringify(streams) : null, detail_fetched: true })
      .where(eq(t.stravaActivity.id, id)),
    ...wellbeingWrites(db, id, localDateOf(d.start_date_local), d.description),
  ] as never);
}

function clientFor(db: DB, deps: SyncDeps) {
  const f = deps.fetch ?? ((u: string, i?: RequestInit) => fetch(u, i));
  return new StravaClient({
    getAccessToken: () => validAccessToken(db, f),
    fetch: f,
    sleep: deps.sleep,
    now: deps.now,
    maxWaitMs: deps.maxWaitMs ?? (process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME ? 0 : 60_000),
    onRate: (r) => void setSetting(db, "rate", r),
  });
}

/**
 * One resumable sync step: list new activities, then fetch detail/laps/streams for new runs that match a
 * planned run, until the time budget runs out. Returns "partial" when more is left: call it again.
 */
export async function syncStrava(db: DB, deps: SyncDeps = {}): Promise<SyncResult> {
  const base = { listed: 0, detailed: 0, remaining: 0, calls: 0 };
  if (!(await getToken(db))) return { ...base, status: "disconnected", message: "Strava is not connected." };
  const st = await getSettings(db, ["sync_state"]);
  const now = (deps.now ?? (() => new Date()))();
  if (!deps.force && st.sync_state?.status === "paused" && st.sync_state.resume_at && new Date(st.sync_state.resume_at) > now)
    return { ...base, status: "paused", message: st.sync_state.message ?? "Paused by Strava's rate limit.", resume_at: st.sync_state.resume_at };
  if (!deps.force && st.sync_state?.status === "running" && st.sync_state.at && nowEpoch() - st.sync_state.at < 30)
    return { ...base, status: "busy", message: "A sync is already running." };

  const started = Date.now();
  const budget = deps.budgetMs ?? DEFAULT_BUDGET_MS;
  const client = clientFor(db, deps);
  await setSetting(db, "sync_state", { status: "running", at: nowEpoch() });
  let listed = 0, detailed = 0, remaining = 0;
  try {
    // 1. List (1–2 calls normally).
    const dates = (await db.select({ d: t.stravaActivity.local_date }).from(t.stravaActivity).all()).map((r) => r.d).sort();
    const newest = dates[dates.length - 1];
    const after = newest ? Math.max(epochOfLocalDate(BACKFILL_FROM), epochOfLocalDate(newest) - RELIST_OVERLAP_DAYS * 86400) : epochOfLocalDate(BACKFILL_FROM);
    for (let page = 1; page < 50; page++) {
      const list = await client.get<SummaryActivity[]>("/athlete/activities", { after, per_page: 100, page });
      const keep = list.filter((a) => STORED_SPORTS.includes(a.sport_type));
      if (keep.length)
        await db.batch(keep.map((a) => { const row = summaryRow(a); return db.insert(t.stravaActivity).values(row).onConflictDoUpdate({ target: t.stravaActivity.id, set: row }); }) as never);
      listed += keep.length;
      if (list.length < 100) break;
    }
    // 2. Detail + laps + streams only for unprocessed runs that match a planned run.
    const today = todayLocal();
    const [sessions, acts, manual, pendingRows] = await Promise.all([
      loadEffective(db), loadActivities(db), loadManualLinks(db),
      db.select({ id: t.stravaActivity.id }).from(t.stravaActivity).where(eq(t.stravaActivity.detail_fetched, false)).all(),
    ]);
    const matched = new Set(matchRuns(sessions, acts, today, manual).statuses.filter((s) => s.strava_activity_id != null).map((s) => s.strava_activity_id!));
    const pending = pendingRows.filter((a) => matched.has(a.id)).sort((a, b) => b.id - a.id); // newest first
    for (const a of pending) {
      if (Date.now() - started > budget) break;
      await fetchDetail(db, client, a.id);
      detailed++;
    }
    remaining = pending.length - detailed;
    await recompute(db, today);
    const partial = remaining > 0;
    const msg = partial ? `Analysed ${detailed} runs; ${remaining} more to go.` : `Up to date: ${listed} activities checked, ${detailed} new runs analysed.`;
    await setSetting(db, "sync_state", { status: partial ? "partial" : "idle", message: msg, at: nowEpoch() });
    if (!partial) await setSetting(db, "last_sync_at", nowEpoch());
    return { status: partial ? "partial" : "ok", listed, detailed, remaining, calls: client.calls, message: msg };
  } catch (e) {
    await recompute(db).catch(() => undefined);
    if (e instanceof RateLimitPause) {
      const msg = `Paused by Strava's rate limit; resumes after ${e.resumeAt.toLocaleTimeString("en-GB", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" })}.`;
      await setSetting(db, "sync_state", { status: "paused", message: msg, resume_at: e.resumeAt.toISOString(), at: nowEpoch() });
      return { status: "paused", listed, detailed, remaining, calls: client.calls, message: msg, resume_at: e.resumeAt.toISOString() };
    }
    const msg = e instanceof Error ? e.message : String(e);
    await setSetting(db, "sync_state", { status: "error", message: msg, at: nowEpoch() });
    return { status: "error", listed, detailed, remaining, calls: client.calls, message: msg };
  }
}

/** Force a fresh fetch of one activity ("Re-sync activity"). */
export async function resyncActivity(db: DB, id: number, deps: SyncDeps = {}) {
  await fetchDetail(db, clientFor(db, deps), id);
  await recompute(db);
}

export async function shouldAutoSync(db: DB): Promise<boolean> {
  if (!(await getToken(db))) return false;
  const { last_sync_at, sync_state } = await getSettings(db, ["last_sync_at", "sync_state"]);
  if (sync_state?.status === "paused" && sync_state.resume_at && new Date(sync_state.resume_at) > new Date()) return false;
  if (sync_state?.status === "partial") return true;
  return !last_sync_at || nowEpoch() - last_sync_at > AUTO_SYNC_AFTER_S;
}
