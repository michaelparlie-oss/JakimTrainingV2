"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, inArray, ne } from "drizzle-orm";
import { getDb } from "@/db/client";
import * as t from "@/db/schema";
import { COOKIE, MAX_AGE_S, makeSessionToken, sha256 } from "@/lib/auth";
import { applyAction, decideProposal, undoChange } from "@/lib/server/changes";
import { recompute } from "@/lib/server/recompute";
import { getSetting, setSetting } from "@/lib/server/settings";
import { enterCheckpoint, setGoal, undoCheckpoint, type CpId } from "@/lib/server/checkpoints";
import { disconnect } from "@/lib/strava/oauth";
import { resyncActivity, syncStrava, type SyncResult } from "@/lib/strava/sync";
import { nowEpoch, todayLocal } from "@/lib/util/dates";
import { parseDuration } from "@/lib/util/format";
import type { ZoneCode } from "@/lib/plan/schema";
import type { Action } from "@/lib/adapt/actions";

const done = (path = "/") => revalidatePath(path === "/" ? "/" : path, "layout");
const str = (f: FormData, k: string) => (f.get(k) as string | null)?.trim() ?? "";
const num = (f: FormData, k: string) => {
  const v = str(f, k);
  return v === "" ? null : Number(v);
};

export type ActionState = { ok: boolean; message: string; changeId?: number } | null;

// ---------- auth ----------
export async function login(_: ActionState, f: FormData): Promise<ActionState> {
  const pass = str(f, "passcode");
  const stored = await getSetting(await getDb(), "passcode_hash");
  const envPass = process.env.APP_PASSCODE;
  if (!stored && !envPass) return { ok: false, message: "Set APP_PASSCODE in .env.local first." };
  const ok = stored ? (await sha256(pass)) === stored : pass === envPass;
  if (!ok) return { ok: false, message: "Wrong passcode." };
  (await cookies()).set(COOKIE, await makeSessionToken(), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" && !process.env.ALLOW_HTTP, maxAge: MAX_AGE_S, path: "/" });
  const next = str(f, "next");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}

export async function logout() {
  (await cookies()).delete(COOKIE);
  redirect("/login");
}

export async function changePasscode(_: ActionState, f: FormData): Promise<ActionState> {
  const p1 = str(f, "p1"), p2 = str(f, "p2");
  if (p1.length < 4) return { ok: false, message: "Use at least 4 characters." };
  if (p1 !== p2) return { ok: false, message: "The two passcodes don't match." };
  await setSetting(await getDb(), "passcode_hash", await sha256(p1));
  return { ok: true, message: "Passcode changed. Use it next time you log in." };
}

// ---------- adaptive plan ----------
export async function decide(f: FormData) {
  await decideProposal(await getDb(), Number(f.get("proposal")), Number(f.get("option")));
  done();
}

export async function dismissAlert(f: FormData) {
  await (await getDb()).update(t.alert).set({ dismissed: true }).where(eq(t.alert.id, Number(f.get("id")))).run();
  done();
}

export async function adjustSession(_: ActionState, f: FormData): Promise<ActionState> {
  const id = str(f, "id");
  let action: Action;
  switch (str(f, "op")) {
    case "move": {
      const date = str(f, "date");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, message: "Pick a date." };
      action = { type: "move", session_id: id, date };
      break;
    }
    case "skip": action = { type: "skip", session_ids: [id] }; break;
    case "unskip": action = { type: "unskip", session_id: id }; break;
    case "cap": {
      const km = num(f, "km");
      if (!km || km < 1) return { ok: false, message: "Enter a distance in km." };
      action = { type: "cap", session_id: id, km };
      break;
    }
    case "easy30": action = { type: "replace_easy", session_id: id, minutes: Number(f.get("minutes") ?? 30) }; break;
    case "reset": action = { type: "reset", session_id: id }; break;
    default: return { ok: false, message: "Unknown change." };
  }
  const r = await applyAction(await getDb(), action);
  done();
  return { ok: r.ok, message: r.summary, changeId: r.changeId };
}

export async function undo(f: FormData) {
  await undoChange(await getDb(), Number(f.get("id")));
  done();
}

// ---------- matching ----------
export async function linkActivity(f: FormData) {
  const db = await getDb();
  const sid = str(f, "session");
  const aid = str(f, "activity");
  const activity = aid === "" || aid === "none" ? null : Number(aid);
  const row = { plan_session_id: sid, strava_activity_id: activity, status: activity ? "done" : "missed", matched_at: nowEpoch(), manual_override: true, score_key: null };
  const q = [];
  // An activity links to one session only.
  if (activity != null) q.push(db.delete(t.sessionMatch).where(and(eq(t.sessionMatch.strava_activity_id, activity), ne(t.sessionMatch.plan_session_id, sid))));
  q.push(db.insert(t.sessionMatch).values(row).onConflictDoUpdate({ target: t.sessionMatch.plan_session_id, set: row }));
  await db.batch(q as never);
  await recompute(db);
  done();
}

export async function clearManualLink(f: FormData) {
  const db = await getDb();
  await db.delete(t.sessionMatch).where(eq(t.sessionMatch.plan_session_id, str(f, "session"))).run();
  await recompute(db);
  done();
}

// ---------- Strava ----------
/** One resumable sync step; the client calls it again while the result is "partial". */
export async function syncNow(): Promise<SyncResult> {
  const r = await syncStrava(await getDb());
  done();
  return r;
}

export async function resync(f: FormData) {
  await resyncActivity(await getDb(), Number(f.get("activity")));
  done();
}

export async function disconnectStrava() {
  await disconnect(await getDb());
  done();
}

// ---------- logs ----------
export async function logWellbeing(_: ActionState, f: FormData): Promise<ActionState> {
  const db = await getDb();
  const clamp = (v: number | null, lo: number, hi: number) => (v == null || Number.isNaN(v) ? null : Math.min(hi, Math.max(lo, Math.round(v))));
  const row = {
    date: str(f, "date") || todayLocal(),
    source: "manual",
    strava_activity_id: num(f, "activity"),
    knee_pain: clamp(num(f, "knee"), 0, 10),
    bunion_pain: clamp(num(f, "bunion"), 0, 10),
    rpe: clamp(num(f, "rpe"), 1, 10),
    carbs_g: num(f, "carbs"),
    note: str(f, "note") || null,
    created_at: nowEpoch(),
  };
  if (row.knee_pain == null && row.bunion_pain == null && row.rpe == null && row.carbs_g == null && !row.note) return { ok: false, message: "Nothing to save." };
  await db.insert(t.wellbeingLog).values(row).run();
  await recompute(db);
  done();
  return { ok: true, message: row.knee_pain != null && row.knee_pain > 3 ? "Saved. Knee above 3/10: check the suggestion on Today." : "Saved." };
}

export async function deleteWellbeing(f: FormData) {
  const db = await getDb();
  await db.delete(t.wellbeingLog).where(eq(t.wellbeingLog.id, Number(f.get("id")))).run();
  await recompute(db);
  done();
}

export async function setFever(f: FormData) {
  const db = await getDb();
  const on = str(f, "on") === "1";
  await setSetting(db, "fever", on ? { active: true, cleared_at: null } : { active: false, cleared_at: nowEpoch() });
  await recompute(db);
  done();
}

export async function saveStrength(_: ActionState, f: FormData): Promise<ActionState> {
  const db = await getDb();
  const sid = str(f, "session");
  const rows: (typeof t.strengthLog.$inferInsert)[] = [];
  for (const [k, v] of f.entries()) {
    const m = /^w\|(.+)\|(\d+)$/.exec(k);
    if (!m) continue;
    const [, ex, setNo] = m;
    const reps = num(f, `r|${ex}|${setNo}`);
    const checked = str(f, `d|${ex}|${setNo}`) === "on";
    if (!checked) continue; // only ticked sets count
    rows.push({ plan_session_id: sid, exercise_key: ex, set_no: Number(setNo), weight_kg: v === "" ? null : Number(v), reps, rpe: num(f, `p|${ex}|${setNo}`), note: null, logged_at: nowEpoch() });
  }
  const q = [db.delete(t.strengthLog).where(eq(t.strengthLog.plan_session_id, sid))];
  if (rows.length) q.push(db.insert(t.strengthLog).values(rows) as never);
  await db.batch(q as never);
  done();
  return { ok: true, message: `Saved ${rows.length} set${rows.length === 1 ? "" : "s"}.` };
}

// ---------- checkpoints & zones ----------
export async function checkpoint(_: ActionState, f: FormData): Promise<ActionState & { needsConfirm?: boolean; goalOptions?: number[] }> {
  const cp = str(f, "cp") as CpId;
  const time = str(f, "time");
  const r = await enterCheckpoint(await getDb(), cp, {
    time_s: time ? parseDuration(time) : null,
    avg_hr: num(f, "avg_hr"),
    strava_activity_id: num(f, "activity"),
    confirm: str(f, "confirm") === "1",
  });
  done();
  if (r.status === "needs_confirm") return { ok: false, message: r.message, needsConfirm: true };
  if (r.status === "error") return { ok: false, message: r.message };
  const adv = r.goal_advice;
  return { ok: true, message: adv ? `${r.message} ${adv.message}` : r.message, goalOptions: adv?.options_s };
}

export async function clearCheckpoint(f: FormData) {
  await undoCheckpoint(await getDb(), str(f, "cp") as CpId);
  done();
}

export async function confirmGoal(f: FormData) {
  const g = str(f, "goal");
  const s = /^\d+$/.test(g) ? Number(g) : parseDuration(g);
  if (s && s > 3 * 3600 && s < 7 * 3600) await setGoal(await getDb(), s, str(f, "reason") || "Changed in the app");
  done();
}

export async function saveHrZones(_: ActionState, f: FormData): Promise<ActionState> {
  const codes: ZoneCode[] = ["E", "L", "REC", "MP", "HMP", "T", "I"];
  const o: Record<string, { hr_min: number | null; hr_max: number | null }> = {};
  for (const c of codes) {
    const lo = num(f, `${c}_min`), hi = num(f, `${c}_max`);
    if (lo != null || hi != null) o[c] = { hr_min: lo, hr_max: hi };
  }
  const db = await getDb();
  await setSetting(db, "hr_overrides", str(f, "reset") === "1" ? {} : o);
  await recompute(db);
  done();
  return { ok: true, message: "Heart-rate zones saved." };
}

export async function deleteAllData(f: FormData) {
  if (str(f, "confirm") !== "DELETE") return;
  const db = await getDb();
  await db.batch([
    ...[t.strengthLog, t.wellbeingLog, t.checkpointResult, t.alert, t.proposal, t.sessionMatch, t.sessionOverride, t.planChange, t.stravaActivity, t.stravaToken].map((tbl) => db.delete(tbl)),
    db.delete(t.zoneSet).where(ne(t.zoneSet.source, "plan_json")),
    db.delete(t.setting).where(inArray(t.setting.key, ["goal_time_s", "hr_overrides", "fever", "last_sync_at", "sync_state", "rate", "goal_history", "cp4"])),
  ] as never);
  await recompute(db);
  done();
  redirect("/settings?deleted=1");
}
