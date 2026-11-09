import { getDb } from "@/db/client";
import { progressData } from "@/lib/server/progress";
import { ctx } from "@/lib/server/view";
import { fmtDuration } from "@/lib/util/format";
import { Explain, PageTitle } from "../_c/ui";
import { Efficiency, Knee, LongRuns, Strength, WeeklyKm } from "./Charts";

function Empty({ text }: { text: string }) {
  return <p className="rounded-lg bg-slate-50 p-4 text-center text-sm text-muted">{text}</p>;
}

export default async function Progress() {
  const db = await getDb();
  const c = await ctx(db);
  const d = await progressData(db, c);
  return (
    <>
      <PageTitle title="Progress" />
      <section className="card mb-3"><h2 className="h2">Weekly km: planned vs actual</h2><WeeklyKm data={d.weekly} /></section>
      <section className="card mb-3">
        <h2 className="h2">Long runs</h2>
        <p className="text-xs text-muted">Orange = the most your next run should be (<Explain term="spike">10% over your longest run in 30 days</Explain>).</p>
        <LongRuns data={d.longRuns} />
      </section>
      <section className="card mb-3">
        <h2 className="h2">Easy-run efficiency</h2>
        <p className="text-xs text-muted">Average pace on easy runs where average HR was 145–155 bpm. Faster pace at the same heart rate means you&apos;re getting fitter (the chart is upside down, so up is good).</p>
        {d.efficiency.length ? <Efficiency data={d.efficiency} /> : <Empty text="Appears after a few easy runs with average HR 145–155." />}
      </section>
      <section className="card mb-3">
        <h2 className="h2">Checkpoints</h2>
        <ul className="mt-2 divide-y divide-line text-sm">
          {d.checkpoints.map((cp) => (
            <li key={cp.id} className="flex justify-between py-2">
              <span><b>{cp.id}</b> {cp.test}<span className="block text-xs text-muted">Target {cp.on_track}</span></span>
              <span className="text-right">
                {cp.result ? (cp.result.time_s ? <b>{fmtDuration(cp.result.time_s)}</b> : <b>{Math.round(cp.result.avg_hr ?? 0)} bpm</b>) : <span className="text-muted">–</span>}
                {cp.result && cp.target_s && cp.result.time_s && <span className={`block text-xs ${cp.result.time_s <= cp.target_s ? "text-emerald-700" : "text-amber-700"}`}>{cp.result.time_s <= cp.target_s ? "on track" : `${fmtDuration(cp.result.time_s - cp.target_s)} over`}</span>}
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section className="card mb-3">
        <h2 className="h2">Strength: top set</h2>
        {d.strength.length ? <Strength data={d.strength} /> : <Empty text="Log back squat, trap-bar deadlift or RDL sets to see this." />}
      </section>
      <section className="card mb-3">
        <h2 className="h2">Knee pain</h2>
        {d.knee.length ? <Knee data={d.knee} /> : <Empty text="No knee scores yet. Log them after long runs." />}
      </section>
    </>
  );
}
