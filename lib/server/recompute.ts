import crypto from "node:crypto";
import { and, eq, notInArray, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import * as t from "@/db/schema";
import { matchRuns, type ManualLink } from "@/lib/match/match";
import { scoreRun, type ScoreResult } from "@/lib/match/score";
import type { Act } from "@/lib/match/types";
import type { EffSession } from "@/lib/adapt/types";
import type { Zones } from "@/lib/plan/schema";
import { runRules, type AlertOut } from "@/lib/rules/engine";
import { todayLocal, nowEpoch } from "@/lib/util/dates";
import { loadActivities, loadEffective, loadStreams, loadWeeks, zoneResolver } from "./data";
import { getSettings } from "./settings";

export async function loadManualLinks(db: DB): Promise<ManualLink[]> {
  return (await db.select().from(t.sessionMatch).where(eq(t.sessionMatch.manual_override, true)).all()).map((m) => ({
    plan_session_id: m.plan_session_id,
    strava_activity_id: m.strava_activity_id,
  }));
}

/** Everything a score depends on. Same key → reuse the stored score (no need to reload GPS streams). */
export function scoreKey(s: EffSession, a: Act, zones: Zones, hasStreams: boolean): string {
  return crypto
    .createHash("sha1")
    .update(JSON.stringify([s.kind, s.distance_km, s.segments, zones, a.id, a.distance_m, a.moving_time_s, a.avg_hr, a.laps?.length ?? 0, hasStreams, 2]))
    .digest("hex");
}

/**
 * Re-derive everything that depends on actual training: matches, scores, alerts and proposals.
 * Runs after every sync, log entry and schedule change, so the app always reflects what Mike
 * actually did and the plan as it now stands. Reads ~8 queries, writes in one batch.
 */
export async function recompute(db: DB, today = todayLocal()): Promise<{ alerts: AlertOut[] }> {
  const [sessions, acts, manual, zr, weeks, wellbeing, st, prevMatches, cp4Row, streamFlags] = await Promise.all([
    loadEffective(db),
    loadActivities(db),
    loadManualLinks(db),
    zoneResolver(db),
    loadWeeks(db),
    db.select().from(t.wellbeingLog).all(),
    getSettings(db, ["fever", "cp4"]),
    db.select().from(t.sessionMatch).all(),
    db.select().from(t.checkpointResult).where(eq(t.checkpointResult.checkpoint_id, "CP4")).get(),
    db.select({ id: t.stravaActivity.id, has: sql<number>`streams_json is not null` }).from(t.stravaActivity).all(),
  ]);
  const hasStreams = new Map(streamFlags.map((r) => [r.id, !!r.has]));
  const { statuses } = matchRuns(sessions, acts, today, manual);
  const sBy = new Map(sessions.map((s) => [s.id, s]));
  const aBy = new Map(acts.map((a) => [a.id, a]));
  const prevBy = new Map(prevMatches.map((m) => [m.plan_session_id, m]));
  const scores = new Map<string, ScoreResult>();
  const now = nowEpoch();

  // Work out which matches need (re)scoring; load streams only for those.
  const plan = statuses
    .filter((st) => st.status !== "pending" || st.manual)
    .map((st) => {
      const s = sBy.get(st.plan_session_id)!;
      const a = st.strava_activity_id != null ? aBy.get(st.strava_activity_id) : undefined;
      const zones = zr(s).zones;
      const key = a ? scoreKey(s, a, zones, hasStreams.get(a.id) ?? false) : null;
      const prev = prevBy.get(s.id);
      const reuse = !!a && !!prev && prev.score_key === key && prev.strava_activity_id === a.id && !!prev.details_json;
      return { st, s, a, zones, key, prev, reuse };
    });
  const need = plan.filter((p) => p.a && !p.reuse).map((p) => p.a!.id);
  const streams = await loadStreams(db, need);

  const writes = [];
  for (const p of plan) {
    let sc: ScoreResult | null = null;
    if (p.a && p.reuse) {
      sc = {
        distance_ratio: p.prev!.distance_ratio!, distance_score: p.prev!.distance_score!, hr_score: p.prev!.hr_score, pace_score: p.prev!.pace_score,
        overall_score: p.prev!.overall_score!, verdict: p.prev!.verdict ?? "", details: JSON.parse(p.prev!.details_json!),
      };
    } else if (p.a) {
      sc = scoreRun(p.s, { ...p.a, streams: streams.get(p.a.id) ?? null }, p.zones);
    }
    if (sc) scores.set(p.s.id, sc);
    const row = {
      plan_session_id: p.s.id, strava_activity_id: p.st.strava_activity_id, status: p.st.status,
      distance_ratio: sc?.distance_ratio ?? null, distance_score: sc?.distance_score ?? null, pace_score: sc?.pace_score ?? null,
      hr_score: sc?.hr_score ?? null, overall_score: sc?.overall_score ?? null, verdict: sc?.verdict ?? null,
      details_json: sc ? JSON.stringify(sc.details) : null, score_key: p.key, matched_at: now, manual_override: p.st.manual,
    };
    writes.push(db.insert(t.sessionMatch).values(row).onConflictDoUpdate({ target: t.sessionMatch.plan_session_id, set: row }));
  }
  const keep = plan.map((p) => p.s.id);
  writes.unshift(keep.length ? db.delete(t.sessionMatch).where(notInArray(t.sessionMatch.plan_session_id, keep)) : db.delete(t.sessionMatch));

  const alerts = runRules({
    today, nowEpoch: now, sessions, statuses, activities: acts, scores, wellbeing, fever: st.fever, weeks,
    zonesFor: (s) => zr(s).zones,
    cp4: cp4Row ? { date: cp4Row.date, avg_hr: cp4Row.avg_hr, suggest_pace_s: st.cp4?.suggest_pace_s ?? null } : null,
  });

  // Alerts and proposals: upsert by key / fingerprint; the alert links to its proposal by fingerprint.
  const keys = alerts.map((a) => a.key);
  const fps = alerts.filter((a) => a.proposal).map((a) => a.proposal!.fingerprint);
  for (const a of alerts) {
    if (a.proposal) {
      writes.push(
        db.insert(t.proposal)
          .values({ fingerprint: a.proposal.fingerprint, created_at: now, rule_id: a.rule_id, date: a.date, title: a.proposal.title, rationale: a.proposal.rationale, options_json: JSON.stringify(a.proposal.options) })
          .onConflictDoUpdate({ target: t.proposal.fingerprint, set: { status: sql`case when ${t.proposal.status} = 'expired' then 'pending' else ${t.proposal.status} end` } }),
      );
    }
    const pid = a.proposal ? sql`(select id from proposal where fingerprint = ${a.proposal.fingerprint})` : null;
    writes.push(
      db.insert(t.alert)
        .values({ key: a.key, created_at: now, date: a.date, rule_id: a.rule_id, severity: a.severity, message: a.message, related_id: a.related_id, proposal_id: pid as never })
        .onConflictDoUpdate({ target: t.alert.key, set: { message: a.message, severity: a.severity, related_id: a.related_id, proposal_id: pid as never, resolved: false } }),
    );
  }
  // Conditions that no longer hold (a capped run, a moved session…) resolve their alerts; stale proposals expire.
  writes.push(keys.length ? db.update(t.alert).set({ resolved: true }).where(notInArray(t.alert.key, keys)) : db.update(t.alert).set({ resolved: true }));
  writes.push(
    fps.length
      ? db.update(t.proposal).set({ status: "expired" }).where(and(eq(t.proposal.status, "pending"), notInArray(t.proposal.fingerprint, fps)))
      : db.update(t.proposal).set({ status: "expired" }).where(eq(t.proposal.status, "pending")),
  );
  await db.batch(writes as never);
  return { alerts };
}

