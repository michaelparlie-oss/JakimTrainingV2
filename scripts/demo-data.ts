/**
 * Loads a small, realistic demo history into data/app.db (no Strava needed) so every screen and
 * rule can be checked. Usage: APP_TODAY=2026-11-16 npm run demo
 */
import { openDb } from "@/db/client";
import { ensureSeeded } from "@/db/seed";
import * as t from "@/db/schema";
import { recompute } from "@/lib/server/recompute";
import { downsample, wellbeingWrites } from "@/lib/strava/sync";

(async () => {
const db = await openDb();
await ensureSeeded(db);
const lap = (m: number, pace: number, hr: number) => ({ distance: m, moving_time: Math.round((m / 1000) * pace), elapsed_time: Math.round((m / 1000) * pace), average_heartrate: hr });
function streams(blocks: [number, number, number][]) {
  const time = [0], distance = [0], heartrate = [blocks[0][2]];
  let tt = 0, d = 0;
  for (const [m, pace, hr] of blocks) { const end = d + m; while (d < end) { tt += 5; d = Math.min(end, d + (5000 / pace)); time.push(tt); distance.push(d); heartrate.push(hr + Math.round(Math.sin(tt / 60) * 2)); } }
  return { time, distance, heartrate };
}
const runs = [
  { id: 900001, date: "2026-11-01", km: 21.16, pace: 494, hr: 152, name: "Morning Run" },
  { id: 900002, date: "2026-11-07", km: 21.1, pace: 504, hr: 154, name: "Morning Run" },
  { id: 900003, date: "2026-11-09", km: 8.01, pace: 473, hr: 146, name: "Morning Run", st: streams([[8010, 473, 146]]) },
  { id: 900004, date: "2026-11-11", km: 9.5, pace: 480, hr: 160, name: "Astra pace reps", laps: [lap(2000, 505, 142), lap(2000, 446, 168), lap(330, 560, 152), lap(2000, 438, 173), lap(330, 560, 152), lap(2000, 433, 179), lap(840, 520, 150)] },
  { id: 900005, date: "2026-11-14", km: 16.1, pace: 492, hr: 151, name: "Long run", desc: "Hot. knee 5 bunion 2 rpe 6 carbs 45", st: streams([[12000, 500, 152], [4100, 452, 170]]) },
];
for (const r of runs) {
  const row = {
    id: r.id, start_date_local: `${r.date}T04:30:00Z`, local_date: r.date, sport_type: "Run", name: r.name, description: r.desc ?? null,
    distance_m: r.km * 1000, moving_time_s: Math.round(r.km * r.pace), elapsed_time_s: Math.round(r.km * r.pace) + 120, avg_hr: r.hr, max_hr: r.hr + 12,
    avg_speed: 1000 / r.pace, total_elevation_gain: 10, laps_json: r.laps ? JSON.stringify(r.laps) : null, streams_json: r.st ? JSON.stringify(downsample(r.st as never)) : null,
    raw_json: "{}", detail_fetched: true, synced_at: Math.floor(Date.now() / 1000),
  };
  await db.batch([db.insert(t.stravaActivity).values(row).onConflictDoUpdate({ target: t.stravaActivity.id, set: row }), ...wellbeingWrites(db, r.id, r.date, r.desc)] as never);
}
await db.insert(t.stravaActivity).values({ id: 900006, start_date_local: "2026-11-09T18:40:00Z", local_date: "2026-11-09", sport_type: "WeightTraining", name: "Evening Weight Training", distance_m: 0, moving_time_s: 2900, elapsed_time_s: 2900, avg_hr: 112, max_hr: 140, raw_json: "{}", detail_fetched: true, synced_at: 0 }).onConflictDoNothing().run();
const { alerts } = await recompute(db);
console.log(`Demo data loaded. ${alerts.length} alerts:`);
for (const a of alerts) console.log(` [${a.severity}] ${a.message}${a.proposal ? `  → ${a.proposal.title}` : ""}`);
})();
