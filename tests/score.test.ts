import { describe, it, expect } from "vitest";
import { distanceScore, scoreRun } from "@/lib/match/score";
import { repsFromLaps, repsFromStreams } from "@/lib/match/reps";
import { act, actFromStreams, lap, session, streamsFrom, zonesV1 } from "./helpers";

const quality = session("2026-11-11-AM-run"); // 2 km E, 3×2 km HMP / 2 min REC, 1.1 km E

describe("distance score", () => {
  it("100 between 0.95 and 1.10, 0 at 0.5 and 1.5", () => {
    expect(distanceScore(1)).toBe(100);
    expect(distanceScore(0.95)).toBe(100);
    expect(distanceScore(1.1)).toBe(100);
    expect(distanceScore(0.5)).toBe(0);
    expect(distanceScore(1.5)).toBeCloseTo(0);
    expect(distanceScore(0.725)).toBeCloseTo(50);
  });
});

describe("rep detection (§7.3)", () => {
  it("laps first: one lap per step, warm-up lap is not mistaken for a rep", () => {
    const laps = [lap(2000, 500, 140), lap(2000, 448, 168), lap(300, 560, 150), lap(2000, 440, 172), lap(300, 560, 150), lap(2000, 452, 174), lap(1100, 510, 150)];
    const reps = repsFromLaps(quality.segments, laps, zonesV1)!;
    expect(reps.map((r) => Math.round(r.pace_s_per_km!))).toEqual([448, 440, 452]);
    expect(reps.map((r) => r.in_range)).toEqual([true, true, true]); // 440 is within the ±5 s tolerance
  });

  it("falls back to streams: fastest non-overlapping 2 km windows after the warm-up", () => {
    const st = streamsFrom([[2000, 500, 140], [2000, 450, 168], [300, 570, 150], [2000, 435, 171], [300, 570, 150], [2000, 433, 172], [1100, 510, 150]]);
    const reps = repsFromStreams(quality.segments, st, zonesV1)!;
    expect(reps).toHaveLength(3);
    expect(reps.map((r) => Math.round(r.pace_s_per_km!))).toEqual([450, 435, 433]);
  });

  it("verdict names fast reps", () => {
    const st = streamsFrom([[2000, 500, 140], [2000, 450, 168], [300, 570, 150], [2000, 433, 171], [300, 570, 150], [2000, 433, 172], [1100, 510, 150]]);
    const s = scoreRun(quality, actFromStreams("2026-11-11", st), zonesV1);
    expect(s.details.reps.method).toBe("streams");
    expect(s.pace_score).toBeCloseTo(100 / 3);
    expect(s.verdict).toBe("Reps 2 and 3 were 12 s/km faster than target; slow down next time.");
    expect(s.overall_score).toBeCloseTo(0.3 * 100 + 0.7 * (100 / 3));
  });

  it("no laps or streams → manual rep check, distance still scored", () => {
    const s = scoreRun(quality, act("2026-11-11", 9.5), zonesV1);
    expect(s.details.reps.method).toBe("manual");
    expect(s.overall_score).toBe(100);
  });
});

describe("HR-first scoring for easy runs", () => {
  const easy = session("2026-11-09-AM-run");
  it("% of moving time under the E max", () => {
    const st = streamsFrom([[6000, 480, 150], [2000, 480, 160]]);
    const s = scoreRun(easy, actFromStreams("2026-11-09", st), zonesV1);
    expect(s.hr_score!).toBeCloseTo(75, 0);
    expect(s.verdict).toMatch(/Easy run went too hard: 25% of the time above 155 bpm/);
  });
  it("average HR fallback (the real 9 Nov run: avg 146 bpm) and the verdict", () => {
    const s = scoreRun(easy, act("2026-11-09", 8.01, { avg_hr: 145.7 }), zonesV1);
    expect(s.hr_score).toBe(100);
    expect(s.overall_score).toBe(100);
    expect(s.verdict).toMatch(/^Easy run done right/);
  });
  it("no HR → distance only", () => {
    const s = scoreRun(easy, act("2026-11-09", 8, { avg_hr: null }), zonesV1);
    expect(s.hr_score).toBeNull();
    expect(s.verdict).toMatch(/No HR data/);
  });
  it("long run allows +5 bpm in the final hour", () => {
    const long = session("2026-11-14-AM-run"); // 12 km L + 4 km HMP
    // 7740 s total; the final hour starts at 4140 s, so 1800 of the 5940 s at L pace (HR 158) get the 160 allowance.
    const st = streamsFrom([[12000, 495, 158], [4000, 450, 170]]);
    const s = scoreRun(long, actFromStreams("2026-11-14", st), zonesV1);
    expect(s.details.hr!.pct_under!).toBeCloseTo((1800 / 5940) * 100, 0);
  });
});
