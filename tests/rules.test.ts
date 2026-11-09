import { describe, it, expect } from "vitest";
import { runRules, plannedSpikes, spikeCheck, type Snapshot } from "@/lib/rules/engine";
import { matchRuns } from "@/lib/match/match";
import { scoreRun } from "@/lib/match/score";
import { act, actFromStreams, effective, plan, session, streamsFrom, zonesV1 } from "./helpers";
import type { Act } from "@/lib/match/types";
import type { EffSession } from "@/lib/adapt/types";

const weeks = plan.weeks.map((w) => ({ code: w.code, start_date: w.start, phase: w.phase, deload: w.deload, planned_run_km: w.planned_run_km }));
// Mike's real pre-plan runs (Strava, Oct–Nov 2026): distances only.
const prePlan = [["2026-10-18", 10.0], ["2026-10-24", 17.0], ["2026-11-01", 21.16], ["2026-11-07", 21.1]].map(([d, k]) => act(d as string, k as number));

function snap(today: string, opts: Partial<Snapshot> & { acts?: Act[]; sessions?: EffSession[] } = {}): Snapshot {
  const sessions = opts.sessions ?? effective();
  const activities = opts.acts ?? [];
  const { statuses } = matchRuns(sessions, activities, today);
  const scores = new Map();
  for (const st of statuses) if (st.strava_activity_id) {
    const s = sessions.find((x) => x.id === st.plan_session_id)!;
    scores.set(s.id, scoreRun(s, activities.find((a) => a.id === st.strava_activity_id)!, zonesV1));
  }
  return { today, nowEpoch: Math.floor(new Date(`${today}T12:00:00+07:00`).getTime() / 1000), sessions, statuses, activities, scores, wellbeing: [], fever: null, weeks, zonesFor: () => zonesV1, ...opts };
}
const ids = (a: ReturnType<typeof runRules>) => a.map((x) => x.rule_id);

describe("long_run_spike", () => {
  it("a 30 km run after a 20 km max triggers it, with a cap at 22 km", () => {
    const r = spikeCheck(30, 20)!;
    expect(r.pct_over).toBe(50);
    expect(r.cap_km).toBe(22);
    const alerts = runRules(snap("2027-01-10", { acts: [act("2026-12-20", 20), act("2027-01-09", 30)] }));
    const a = alerts.find((x) => x.rule_id === "long_run_spike")!;
    expect(a.message).toMatch(/50% longer than your longest run in the last 30 days.*capping at 22.0 km/);
  });

  it("none of the planned long runs violates it (with Mike's real pre-plan history)", () => {
    const sp = plannedSpikes(snap("2026-11-09", { acts: prePlan }));
    const longs = [...sp.keys()].filter((id) => session(id).kind === "long");
    expect(longs).toEqual([]);
  });

  it("is dynamic: skipping a long run makes the next one too big and proposes a cap", () => {
    // Real history ends at 21.1 km on 7 Nov; if Mike runs only short runs through Dec, the plan's 22 km long run needs a cap.
    const s = effective();
    const acts = [act("2026-12-01", 5), act("2026-12-05", 10), act("2026-12-12", 12), act("2026-12-14", 6), act("2026-12-16", 8)];
    const target = s.find((x) => x.kind === "long" && x.date >= "2026-12-17")!;
    const alerts = runRules(snap("2026-12-17", { acts, sessions: s.filter((x) => x.date >= "2026-12-17" || x.category !== "run") }));
    const a = alerts.find((x) => x.rule_id === "long_run_spike" && x.related_id === target.id)!;
    expect(a).toBeTruthy();
    expect(a.proposal!.options[0].action).toMatchObject({ type: "cap", session_id: target.id, km: 13 });
  });
});

describe("easy_hr_drift", () => {
  it("flags > 20% of time above the HR max", () => {
    const st = streamsFrom([[5000, 480, 150], [3000, 480, 162]]);
    const alerts = runRules(snap("2026-11-10", { acts: [actFromStreams("2026-11-09", st)] }));
    expect(alerts.find((a) => a.rule_id === "easy_hr_drift")!.message).toBe("Easy run went too hard: 38% above 155 bpm. Slow down or walk briefly next time.");
  });
});

describe("knee rules", () => {
  const w = (date: string, knee: number, created = 1) => ({ date, knee_pain: knee, bunion_pain: 0, strava_activity_id: null, created_at: created });
  it("knee > 3 warns and proposes 30 min easy or rest for the next run", () => {
    const alerts = runRules(snap("2026-11-14", { wellbeing: [w("2026-11-14", 4)] }));
    const a = alerts.find((x) => x.rule_id === "knee_single")!;
    expect(a.severity).toBe("warn");
    expect(a.related_id).toBe("2026-11-16-AM-run");
    expect(a.proposal!.options.map((o) => o.action.type)).toEqual(["replace_easy", "skip", "none"]);
  });
  it("knee = 3 does not warn", () => {
    expect(ids(runRules(snap("2026-11-14", { wellbeing: [w("2026-11-14", 3)] })))).not.toContain("knee_single");
  });
  it("two entries > 3 within 14 days → stop", () => {
    const alerts = runRules(snap("2026-11-20", { wellbeing: [w("2026-11-09", 5, 1), w("2026-11-20", 4, 2)] }));
    const a = alerts.find((x) => x.rule_id === "knee_repeat")!;
    expect(a.severity).toBe("stop");
    expect(alerts[0].rule_id).toBe("knee_repeat"); // highest severity first
  });
  it("two entries 15 days apart → no stop", () => {
    expect(ids(runRules(snap("2026-11-24", { wellbeing: [w("2026-11-09", 5), w("2026-11-24", 5)] })))).not.toContain("knee_repeat");
  });
});

describe("missed_week", () => {
  it("≥ 3 missed runs last week → repeat-week proposal", () => {
    const alerts = runRules(snap("2026-12-21", { acts: [] })); // B1 (14–20 Dec) all missed
    const a = alerts.find((x) => x.rule_id === "missed_week")!;
    expect(a.related_id).toBe("B1");
    expect(a.proposal!.options[0].action).toEqual({ type: "repeat_week", week: "B1" });
  });
  it("one missed run does not trigger it", () => {
    const acts = [act("2026-12-16", 9), act("2026-12-18", 6), act("2026-12-19", 16)];
    expect(ids(runRules(snap("2026-12-21", { acts })))).not.toContain("missed_week");
  });
});

describe("fatigue_hr", () => {
  it("7-day easy HR ≥ 5 bpm above the 28-day baseline at similar pace → early deload proposal", () => {
    const easy = effective().filter((s) => s.kind === "easy" && s.date >= "2026-12-14" && s.date <= "2027-01-10");
    const acts = easy.map((s) => act(s.date, s.distance_km!, { avg_hr: s.date >= "2027-01-04" ? 152 : 145 }));
    const alerts = runRules(snap("2027-01-10", { acts }));
    const a = alerts.find((x) => x.rule_id === "fatigue_hr")!;
    expect(a).toBeTruthy();
    expect(a.proposal!.options[0].action).toMatchObject({ type: "early_deload", week: "B5" });
  });
});

describe("fever, pain-log prompt, back-to-back", () => {
  it("fever → stop and skip proposal for today's run", () => {
    const a = runRules(snap("2026-11-11", { fever: { active: true, cleared_at: null } })).find((x) => x.rule_id === "fever")!;
    expect(a.severity).toBe("stop");
    expect(a.proposal!.options[0].action).toEqual({ type: "skip", session_ids: ["2026-11-11-AM-run"] });
  });
  it("fever cleared 12 h ago still blocks", () => {
    const now = Math.floor(new Date("2026-11-11T12:00:00+07:00").getTime() / 1000);
    expect(ids(runRules(snap("2026-11-11", { fever: { active: false, cleared_at: now - 12 * 3600 } })))).toContain("fever");
    expect(ids(runRules(snap("2026-11-11", { fever: { active: false, cleared_at: now - 25 * 3600 } })))).not.toContain("fever");
  });
  it("long run synced without a knee score → prompt", () => {
    const alerts = runRules(snap("2026-11-15", { acts: [act("2026-11-14", 16)] }));
    expect(alerts.find((a) => a.rule_id === "prompt_pain_log")!.message).toBe("Log your knee and bunion score for Sat's long run.");
  });
  it("moving the quality run next to the long run raises a back-to-back warning with a move proposal", () => {
    const s = effective([{ plan_session_id: "2026-11-11-AM-run", date: "2026-11-13", slot: null, skipped: false, distance_km: null, title: null, segments_json: null, est_duration_min: null, force_deload: null, reason: "m", source: "user", change_id: null }]);
    const a = runRules(snap("2026-11-10", { sessions: s })).find((x) => x.rule_id === "hard_back_to_back")!;
    expect(a.related_id).toBe("2026-11-14-AM-run");
    expect(a.proposal!.options[0].action).toEqual({ type: "move", session_id: "2026-11-14-AM-run", date: "2026-11-15" });
  });
});
