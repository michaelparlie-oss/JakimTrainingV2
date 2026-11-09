import { describe, it, expect } from "vitest";
import { matchRuns } from "@/lib/match/match";
import { act, effective } from "./helpers";

const byId = (r: ReturnType<typeof matchRuns>, id: string) => r.statuses.find((s) => s.plan_session_id === id)!;

describe("matching (§7.1)", () => {
  const sessions = effective();

  it("same-day match: the real 9 Nov run (8.01 km) is done", () => {
    const a = act("2026-11-09", 8.01159, { id: 20914544144 });
    const r = matchRuns(sessions, [a], "2026-11-10");
    expect(byId(r, "2026-11-09-AM-run")).toMatchObject({ strava_activity_id: 20914544144, status: "done" });
  });

  it("±1 day onto a day with no planned run → moved", () => {
    const a = act("2026-11-12", 9.5); // Thu; quality was Wed 11 Nov, Thu has no run
    const r = matchRuns(sessions, [a], "2026-11-13");
    expect(byId(r, "2026-11-11-AM-run")).toMatchObject({ strava_activity_id: a.id, status: "moved" });
  });

  it("does not move onto a day that has its own planned run (good fit)", () => {
    const a = act("2026-11-13", 6); // Fri easy 6 km
    const r = matchRuns(sessions, [a], "2026-11-14");
    expect(byId(r, "2026-11-13-AM-run").status).toBe("done");
    expect(byId(r, "2026-11-14-AM-run").strava_activity_id).toBeNull();
  });

  it("dynamic swap: the long run done a day early is matched to the long run, not the easy run", () => {
    const longFri = act("2026-11-13", 16); // Sat long 16 km done on Fri
    const easySat = act("2026-11-14", 6); // and the Fri easy done on Sat
    const r = matchRuns(sessions, [longFri, easySat], "2026-11-15");
    expect(byId(r, "2026-11-14-AM-run")).toMatchObject({ strava_activity_id: longFri.id, status: "moved" });
    expect(byId(r, "2026-11-13-AM-run")).toMatchObject({ strava_activity_id: easySat.id, status: "moved" });
  });

  it("two runs on one day: closest distance wins, the other is extra", () => {
    const a = act("2026-11-09", 3), b = act("2026-11-09", 7.8);
    const r = matchRuns(sessions, [a, b], "2026-11-10");
    expect(byId(r, "2026-11-09-AM-run").strava_activity_id).toBe(b.id);
    expect(r.extras).toContain(a.id);
  });

  it("missed only after plan day + 1", () => {
    expect(byId(matchRuns(sessions, [], "2026-11-10"), "2026-11-09-AM-run").status).toBe("pending");
    expect(byId(matchRuns(sessions, [], "2026-11-11"), "2026-11-09-AM-run").status).toBe("missed");
  });

  it("partial below 85% of the distance", () => {
    const a = act("2026-11-09", 6);
    expect(byId(matchRuns(sessions, [a], "2026-11-10"), "2026-11-09-AM-run").status).toBe("partial");
  });

  it("optional shake-out never becomes missed", () => {
    expect(byId(matchRuns(sessions, [], "2026-12-05"), "2026-11-28-AM-run").status).toBe("pending");
  });

  it("matches a session Mike moved in the app on its new date", () => {
    const moved = effective([{ plan_session_id: "2026-11-13-AM-run", date: "2026-11-12", slot: null, skipped: false, distance_km: null, title: null, segments_json: null, est_duration_min: null, force_deload: null, reason: "moved", source: "user", change_id: null }]);
    const a = act("2026-11-12", 6);
    const r = matchRuns(moved, [a], "2026-11-13");
    expect(byId(r, "2026-11-13-AM-run")).toMatchObject({ strava_activity_id: a.id, status: "done" });
  });

  it("manual unlink and link win over automatic matching", () => {
    const a = act("2026-11-09", 8), b = act("2026-11-10", 5);
    const r = matchRuns(sessions, [a, b], "2026-11-12", [
      { plan_session_id: "2026-11-09-AM-run", strava_activity_id: b.id },
    ]);
    expect(byId(r, "2026-11-09-AM-run").strava_activity_id).toBe(b.id);
    expect(r.extras).toContain(a.id);
  });
});
