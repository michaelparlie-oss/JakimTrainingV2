import { getDb } from "@/db/client";
import { loadPlan } from "@/lib/plan/load";
import { checkpointResults, checkpointSession, type CpId } from "@/lib/server/checkpoints";
import { goalTimeS, loadActivities, loadEffective, loadZoneSets } from "@/lib/server/data";
import { isRunActivity } from "@/lib/match/types";
import { cp3GoalAdvice, MARATHON_KM } from "@/lib/zones/formula";
import { diffDays, fmtDate } from "@/lib/util/dates";
import { fmtDuration, fmtKm, fmtPace } from "@/lib/util/format";
import { clearCheckpoint, confirmGoal } from "../actions";
import { Explain, PageTitle } from "../_c/ui";
import { CheckpointForm } from "./CheckpointForm";

export default async function Checkpoints() {
  const db = await getDb();
  const plan = loadPlan();
  const [results, sets, allActs, goal, sessions] = await Promise.all([checkpointResults(db), loadZoneSets(db), loadActivities(db), goalTimeS(db), loadEffective(db)]);
  const acts = allActs.filter(isRunActivity);
  return (
    <>
      <PageTitle title="Checkpoints" sub={<>Each <Explain term="checkpoint">checkpoint</Explain> resets your paces from what you can actually run.</>} back="/more" />
      <p className="mb-3 text-sm">Current goal: <b>{fmtDuration(goal)}</b> (marathon pace {fmtPace(goal / MARATHON_KM)} /km)</p>
      <div className="space-y-3">
        {plan.meta.checkpoints.map((cp) => {
          const { date, session } = checkpointSession(sessions, cp.id as CpId);
          const r = results.find((x) => x.checkpoint_id === cp.id);
          const zs = r?.zone_set_id ? sets.find((s) => s.id === r.zone_set_id) : null;
          const candidates = acts.filter((a) => Math.abs(diffDays(date, a.local_date)) <= 2);
          const advice = cp.id === "CP3" && r?.time_s ? cp3GoalAdvice(r.time_s) : null;
          return (
            <section key={cp.id} className="card">
              <div className="flex items-baseline justify-between">
                <h2 className="h2">{cp.id}: {cp.test}</h2>
                <span className="text-sm text-muted">{fmtDate(date, { weekday: "short", day: "numeric", month: "short" })}</span>
              </div>
              <p className="text-sm">On track: <b>{cp.on_track}</b>. {cp.action}.</p>
              {session && date !== cp.date && <p className="text-xs text-muted">Moved from {fmtDate(cp.date)} by your plan changes.</p>}
              {r ? (
                <div className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm">
                  <p><b>Result:</b> {r.time_s ? fmtDuration(r.time_s) : ""}{r.avg_hr ? ` · avg HR ${Math.round(r.avg_hr)} bpm` : ""}</p>
                  {zs && <p className="mt-1">New paces from {fmtDate(zs.effective_from_date!)}: {(() => { const z = JSON.parse(zs.zones_json); return `Easy ${z.E.pace_text}, Tempo ${z.T.pace_text}, HM ${z.HMP.pace_text}`; })()}</p>}
                  {advice && advice.verdict !== "keep" && (
                    <div className="mt-2 rounded-lg bg-white p-2">
                      <p className="font-semibold">{advice.message} Change your goal?</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {advice.options_s.map((g) => (
                          <form key={g} action={confirmGoal}>
                            <input type="hidden" name="goal" value={g} /><input type="hidden" name="reason" value={`CP3 result ${fmtDuration(r.time_s!)}`} />
                            <button className={`btn ${goal === g ? "btn-primary" : ""}`}>{fmtDuration(g)} ({fmtPace(g / MARATHON_KM)} /km)</button>
                          </form>
                        ))}
                        <form action={confirmGoal}><input type="hidden" name="goal" value={4 * 3600 + 59 * 60} /><input type="hidden" name="reason" value="Kept 4:59 after CP3" /><button className="btn">Keep 4:59:00</button></form>
                      </div>
                      <p className="mt-1 text-xs text-muted">Only marathon pace (MP) changes. Your other zones come from the test itself.</p>
                    </div>
                  )}
                  {advice?.verdict === "keep" && <p className="mt-1 font-semibold text-emerald-800">{advice.message}</p>}
                  <form action={clearCheckpoint} className="mt-2"><input type="hidden" name="cp" value={cp.id} /><button className="text-xs underline">Remove this result</button></form>
                </div>
              ) : null}
              <CheckpointForm cp={cp.id} kind={cp.id === "CP4" ? "hr" : "time"} candidates={candidates.map((a) => ({ id: a.id, label: `${fmtDate(a.local_date)} · ${fmtKm(a.distance_m / 1000)} · ${fmtDuration(a.moving_time_s)}${a.avg_hr ? ` · ♥ ${Math.round(a.avg_hr)}` : ""}`, time: a.elapsed_time_s }))} hasResult={!!r} />
            </section>
          );
        })}
      </div>
      <section className="card mt-4">
        <h2 className="h2">Zone set history</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {sets.sort((a, b) => (a.effective_from_date ?? a.id).localeCompare(b.effective_from_date ?? b.id)).map((s) => (
            <li key={s.id} className={s.active ? "" : "text-muted line-through"}>
              <b>{s.source === "plan_json" ? `Plan ${s.id}` : s.checkpoint_id}</b>: {s.label}{s.effective_from_date ? `, from ${fmtDate(s.effective_from_date)}` : ""}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted">Plan sets (v1–v3) are projections. A measured result always takes over from its effective date.</p>
      </section>
    </>
  );
}
