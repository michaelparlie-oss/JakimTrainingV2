import { describe, it, expect } from "vitest";
import { planAction, type ActionCtx } from "@/lib/adapt/actions";
import { buildEffective, capSegments, segmentsDistanceKm } from "@/lib/adapt/effective";
import type { OverrideRow } from "@/lib/adapt/types";
import { effective, plan, planRows, zonesV1 } from "./helpers";

const weeks = plan.weeks.map((w) => ({ code: w.code, start_date: w.start, phase: w.phase, deload: w.deload, planned_run_km: w.planned_run_km }));
const ctx = (today = "2026-11-10", sessions = effective()): ActionCtx => ({
  sessions, overrides: new Map(), weeks, today, raceDate: "2027-06-13", zonesFor: () => zonesV1, source: "user",
  checkpointDates: plan.meta.checkpoints.map((c) => c.date),
});
/** Apply an ActionPlan to the plan rows, as the server does. */
function apply(p: ReturnType<typeof planAction>): ReturnType<typeof effective> {
  const ov: OverrideRow[] = p.changes.filter((c) => c.next).map((c) => ({ ...c.next!, plan_session_id: c.session_id, change_id: 1 }));
  return buildEffective(planRows(), ov);
}

describe("adaptive actions", () => {
  it("cap trims steady volume first and keeps quality reps", () => {
    const long = effective().find((s) => s.id === "2026-11-14-AM-run")!; // 12 L + 4 HMP
    const segs = capSegments(long.segments, 13);
    expect(segmentsDistanceKm(segs)).toBeCloseTo(13);
    expect(segs[1]).toMatchObject({ kind: "work", distance_km: 4 });
  });

  it("move swaps with the run already on that day", () => {
    const p = planAction({ type: "move", session_id: "2026-11-13-AM-run", date: "2026-11-14" }, ctx());
    const e = apply(p);
    expect(e.find((s) => s.id === "2026-11-13-AM-run")!.date).toBe("2026-11-14");
    expect(e.find((s) => s.id === "2026-11-14-AM-run")!.date).toBe("2026-11-13");
    expect(p.summary).toMatch(/Swapped/);
  });

  it("race day cannot be moved and nothing moves past it", () => {
    expect(planAction({ type: "move", session_id: "2027-06-13-AM-run", date: "2027-06-14" }, ctx()).ok).toBe(false);
    expect(planAction({ type: "move", session_id: "2027-06-11-AM-run", date: "2027-06-14" }, ctx()).ok).toBe(false);
  });

  it("replace with 30 min easy", () => {
    const e = apply(planAction({ type: "replace_easy", session_id: "2026-11-14-AM-run", minutes: 30 }, ctx()));
    const s = e.find((x) => x.id === "2026-11-14-AM-run")!;
    expect(s.segments).toEqual([expect.objectContaining({ zone: "E", duration_s: 1800 })]);
    expect(s.est_duration_min).toBe(30);
  });

  it("repeat week shifts the following weeks +7 days, keeps race day and taper, drops the last free pre-taper week", () => {
    const p = planAction({ type: "repeat_week", week: "B5" }, ctx("2027-01-18"));
    expect(p.ok).toBe(true);
    const e = apply(p);
    const b5 = e.filter((s) => s.week === "B5");
    expect(b5[0].date).toBe("2027-01-18");
    expect(e.find((s) => s.kind === "race" && s.week === "T3")!.date).toBe("2027-06-13");
    expect(e.filter((s) => s.phase === "Taper").every((s) => s.date === s.plan_date)).toBe(true);
    expect(e.filter((s) => s.week === "S11").every((s) => s.skipped)).toBe(true); // S12 holds CP4, so S11 is dropped
    expect(e.find((s) => s.id.startsWith("2027-02-06") && s.kind === "test")!.date).toBe("2027-02-13"); // CP2 moves with its week
    const lastPreTaper = e.filter((s) => s.phase !== "Taper" && !s.skipped).map((s) => s.date).sort().pop()!;
    expect(lastPreTaper < "2027-05-24").toBe(true);
  });

  it("repeat week refuses when it would compress the taper", () => {
    const p = planAction({ type: "repeat_week", week: "S12" }, ctx("2027-05-24"));
    expect(p.ok).toBe(false);
    expect(p.error).toMatch(/taper/);
    expect(planAction({ type: "repeat_week", week: "T1" }, ctx("2027-05-31")).ok).toBe(false);
  });

  it("early deload scales runs and halves strength sets", () => {
    const e = apply(planAction({ type: "early_deload", week: "B5", ratio: 0.75 }, ctx("2027-01-10")));
    const runs = e.filter((s) => s.week === "B5" && s.category === "run");
    const total = runs.reduce((t, s) => t + (s.distance_km ?? 0), 0);
    expect(total).toBeLessThan(44 * 0.8);
    expect(e.filter((s) => s.week === "B5" && s.category === "strength").every((s) => s.deload)).toBe(true);
  });
});
