import { describe, it, expect } from "vitest";
import { loadPlan } from "@/lib/plan/load";
import { computeZones, maxSpeedup, cp3GoalAdvice, parseGoal } from "@/lib/zones/formula";
import { ZONE_CODES } from "@/lib/plan/schema";

const plan = loadPlan();
const goal = parseGoal(plan.meta.goal_race.goal_time);

function expectSame(computed: ReturnType<typeof computeZones>, expected: typeof plan.zone_sets.v1.zones) {
  for (const c of ZONE_CODES) {
    expect([c, computed[c].pace_min_s_per_km, computed[c].pace_max_s_per_km]).toEqual([
      c, expected[c].pace_min_s_per_km, expected[c].pace_max_s_per_km,
    ]);
    expect([c, computed[c].hr_min, computed[c].hr_max]).toEqual([c, expected[c].hr_min, expected[c].hr_max]);
    expect(computed[c].pace_text).toEqual(expected[c].pace_text);
  }
}

describe("zone formula", () => {
  it("v1 from 10K 4142 s reproduces zone_sets.v1 exactly", () => {
    expectSame(computeZones(plan, { kind: "10k", seconds: 4142 }, goal), plan.zone_sets.v1.zones);
  });
  it("v2 from 10K 1:06:30 (M6 acceptance): T 6:45–6:55, E 7:35–8:25", () => {
    const z = computeZones(plan, { kind: "10k", seconds: 3990 }, goal);
    expectSame(z, plan.zone_sets.v2.zones);
    expect(z.T.pace_text).toBe("6:45–6:55 /km");
    expect(z.E.pace_text).toBe("7:35–8:25 /km");
  });
  it("v3 from HM 2:24:00 reproduces zone_sets.v3 (HM used directly for phm)", () => {
    expectSame(computeZones(plan, { kind: "hm", seconds: 8640 }, goal), plan.zone_sets.v3.zones);
  });
  it("MP follows the goal time, not the test", () => {
    const z = computeZones(plan, { kind: "10k", seconds: 3990 }, parseGoal("5:10:00"));
    expect(z.MP.pace_min_s_per_km).toBe(Math.round(18600 / 42.195 - 5));
  });
  it("sanity guard measures the biggest speed-up", () => {
    const a = computeZones(plan, { kind: "10k", seconds: 4142 }, goal);
    const b = computeZones(plan, { kind: "10k", seconds: 3600 }, goal);
    expect(maxSpeedup(a, b).seconds).toBeGreaterThan(25);
    expect(maxSpeedup(a, computeZones(plan, { kind: "10k", seconds: 3990 }, goal)).seconds).toBeLessThanOrEqual(25);
  });
  it("CP3 goal rule", () => {
    expect(cp3GoalAdvice(8640).verdict).toBe("keep");
    expect(cp3GoalAdvice(8800).verdict).toBe("adjust");
    expect(cp3GoalAdvice(9100).verdict).toBe("reset");
  });
});
