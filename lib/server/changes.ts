import { desc, eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import * as t from "@/db/schema";
import { planAction, type Action, type ActionPlan } from "@/lib/adapt/actions";
import { loadPlan } from "@/lib/plan/load";
import { todayLocal, nowEpoch } from "@/lib/util/dates";
import { loadEffective, loadOverrides, loadWeeks, zoneResolver } from "./data";
import { recompute } from "./recompute";

export async function previewAction(db: DB, action: Action, source: "user" | "adaptation" = "user"): Promise<ActionPlan> {
  const [sessions, overrides, weeks, zr] = await Promise.all([loadEffective(db), loadOverrides(db), loadWeeks(db), zoneResolver(db)]);
  const meta = loadPlan().meta;
  return planAction(action, {
    sessions,
    overrides: new Map(overrides.map((o) => [o.plan_session_id, o])),
    weeks,
    today: todayLocal(),
    raceDate: meta.goal_race.date,
    checkpointDates: meta.checkpoints.map((c) => c.date),
    zonesFor: (s) => zr(s).zones,
    source,
  });
}

/** Apply a plan change. Every change is logged with the previous state so it can be undone. */
export async function applyAction(
  db: DB,
  action: Action,
  opts: { source?: "user" | "adaptation"; proposalId?: number; kind?: string } = {},
): Promise<ActionPlan & { changeId?: number }> {
  const plan = await previewAction(db, action, opts.source ?? "user");
  if (!plan.ok || !plan.changes.length) {
    if (plan.ok) await recompute(db);
    return plan;
  }
  const now = nowEpoch();
  const existing = new Map((await loadOverrides(db)).map((o) => [o.plan_session_id, o]));
  const before = plan.changes.map((c) => ({ plan_session_id: c.session_id, override: existing.get(c.session_id) ?? null }));
  const changeId = (
    await db.insert(t.planChange)
      .values({ created_at: now, kind: opts.kind ?? action.type, summary: plan.summary, before_json: JSON.stringify(before), proposal_id: opts.proposalId ?? null })
      .returning({ id: t.planChange.id })
      .get()
  ).id;
  const writes = [];
  for (const c of plan.changes) {
    if (c.next === null) writes.push(db.delete(t.sessionOverride).where(eq(t.sessionOverride.plan_session_id, c.session_id)));
    else {
      const row = { ...c.next, plan_session_id: c.session_id, change_id: changeId, updated_at: now };
      writes.push(db.insert(t.sessionOverride).values(row).onConflictDoUpdate({ target: t.sessionOverride.plan_session_id, set: row }));
    }
    // A moved/edited session is re-matched from scratch.
    writes.push(db.delete(t.sessionMatch).where(eq(t.sessionMatch.plan_session_id, c.session_id)));
  }
  await db.batch(writes as never);
  await recompute(db);
  return { ...plan, changeId };
}

export async function undoChange(db: DB, changeId: number): Promise<boolean> {
  const ch = await db.select().from(t.planChange).where(eq(t.planChange.id, changeId)).get();
  if (!ch || ch.undone) return false;
  const before = JSON.parse(ch.before_json) as { plan_session_id: string; override: typeof t.sessionOverride.$inferSelect | null }[];
  const writes = [];
  for (const b of before) {
    writes.push(db.delete(t.sessionOverride).where(eq(t.sessionOverride.plan_session_id, b.plan_session_id)));
    if (b.override) writes.push(db.insert(t.sessionOverride).values(b.override));
    writes.push(db.delete(t.sessionMatch).where(eq(t.sessionMatch.plan_session_id, b.plan_session_id)));
  }
  writes.push(db.update(t.planChange).set({ undone: true }).where(eq(t.planChange.id, changeId)));
  if (ch.proposal_id) {
    writes.push(db.update(t.proposal).set({ status: "pending", decided_at: null, chosen_option: null }).where(eq(t.proposal.id, ch.proposal_id)));
    writes.push(db.update(t.alert).set({ dismissed: false }).where(eq(t.alert.proposal_id, ch.proposal_id)));
  }
  await db.batch(writes as never);
  await recompute(db);
  return true;
}

/** Mike taps an option on a proposal. Option actions of type "none" decline it without changing the plan. */
export async function decideProposal(db: DB, proposalId: number, optionIdx: number): Promise<ActionPlan> {
  const p = await db.select().from(t.proposal).where(eq(t.proposal.id, proposalId)).get();
  if (!p || p.status !== "pending") return { ok: false, summary: "This suggestion is no longer open.", changes: [], error: "closed" };
  const options = JSON.parse(p.options_json) as { label: string; action: Action }[];
  const opt = options[optionIdx];
  if (!opt) return { ok: false, summary: "Unknown option.", changes: [], error: "option" };
  let res: ActionPlan = { ok: true, summary: "Kept the plan as written.", changes: [] };
  if (opt.action.type !== "none") {
    res = await applyAction(db, opt.action, { source: "adaptation", proposalId, kind: p.rule_id });
    if (!res.ok) return res;
  }
  // Either way the question is answered, so its alert closes. Undo reopens it.
  await db.batch([
    db.update(t.proposal).set({ status: opt.action.type === "none" ? "declined" : "accepted", decided_at: nowEpoch(), chosen_option: optionIdx }).where(eq(t.proposal.id, proposalId)),
    db.update(t.alert).set({ dismissed: true }).where(eq(t.alert.proposal_id, proposalId)),
  ] as never);
  return res;
}

export async function recentChanges(db: DB, limit = 30) {
  return db.select().from(t.planChange).orderBy(desc(t.planChange.id)).limit(limit).all();
}
