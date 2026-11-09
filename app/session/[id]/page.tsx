import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { loadPlan } from "@/lib/plan/load";
import { ctx, toVM } from "@/lib/server/view";
import { loadStreams } from "@/lib/server/data";
import { isRunActivity } from "@/lib/match/types";
import { addDays, diffDays, fmtDate, weekdayShort } from "@/lib/util/dates";
import { fmtDuration, fmtKm, fmtPace, fmtPaceRange } from "@/lib/util/format";
import { clearManualLink, linkActivity, resync } from "@/app/actions";
import { AdjustPanel, PainLogForm } from "@/app/_c/Forms";
import { HrChart } from "@/app/_c/HrChart";
import { OverrideNote, PageTitle, ScoreRing, SegmentList, StatusPill, TargetBadge } from "@/app/_c/ui";
import { StrengthCard, ZoneBasis } from "@/app/_c/Cards";

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await getDb();
  const c = await ctx(db);
  const raw = c.sessions.find((s) => s.id === id);
  if (!raw) notFound();
  const s = toVM(c, raw);
  const a = s.activity;
  const plan = loadPlan();
  const maxDate = addDays(plan.meta.goal_race.date, -1);
  const nearby = c.acts.filter((x) => isRunActivity(x) && Math.abs(diffDays(s.date, x.local_date)) <= 3);
  const zones = s.zonesR.zones;
  const primary = s.kind === "long" ? zones.L : s.kind === "easy" ? zones.E : zones[s.segments.find((g) => g.kind === "work")?.zone ?? "E"];
  let chart: { min: number; hr: number; pace: number | null }[] = [];
  const st = a ? (await loadStreams(db, [a.id])).get(a.id) : undefined;
  if (st?.heartrate?.length) {
    const step = Math.max(1, Math.floor(st.time.length / 300));
    for (let i = 0; i < st.time.length; i += step) chart.push({ min: st.time[i] / 60, hr: st.heartrate![i], pace: null });
  } else chart = [];

  return (
    <>
      <PageTitle title={s.category === "strength" ? s.strength!.name : s.title} back={`/?date=${s.date}`} sub={<>{weekdayShort(s.date)} {fmtDate(s.date, { day: "numeric", month: "long", year: "numeric" })} · {s.slot} · Week {s.week}{s.date !== s.plan_date ? ` · planned for ${weekdayShort(s.plan_date)} ${fmtDate(s.plan_date)}` : ""}</>} />

      <div className="grid gap-5 lg:grid-cols-2 lg:items-start lg:gap-6">
      <div className="min-w-0 space-y-4">
      {s.category === "strength" && <StrengthCard s={s} />}

      {s.category === "run" && (
        <section className="card">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted">{fmtKm(s.distance_km)} · about {s.est_duration_min} min · RPE {s.rpe_text}</span>
            <StatusPill status={s.skipped ? "skipped" : s.match?.status ?? "pending"} />
          </div>
          <div className="mt-2"><TargetBadge kind={s.kind} /></div>
          {s.override && <OverrideNote reason={s.override.reason} source={s.override.source} />}
          {s.plan_title !== s.title && <p className="mt-1 text-xs text-muted">Plan as written: {s.plan_title} ({fmtKm(s.plan_distance_km)})</p>}
          <SegmentList segments={s.segments} zones={zones} />
          {s.summary && <p className="mt-2 text-sm">{s.summary}</p>}
          <ZoneBasis label={s.zonesR.label} />
        </section>
      )}
      {s.kind !== "race" && (
        <AdjustPanel id={s.id} date={s.date} category={s.category} skipped={s.skipped} distanceKm={s.distance_km} hasOverride={!!s.override} minDate={c.today < s.date ? c.today : s.date} maxDate={maxDate} />
      )}
      </div>
      <div className="min-w-0 space-y-4">
      {s.category === "run" && !a && (
        <section className="card text-center text-sm text-muted">No Strava run linked yet. It appears here after you sync{s.date > c.today ? " on the day" : ""}.</section>
      )}
      {a && s.match && (
        <section className="card">
          <h2 className="h2">How it went</h2>
          <p className="text-sm text-muted">
            <a className="underline" href={`https://www.strava.com/activities/${a.id}`} target="_blank" rel="noreferrer">{a.name ?? "Strava run"}</a> · {weekdayShort(a.local_date)} {fmtDate(a.local_date)} · {fmtKm(a.distance_m / 1000)} · {fmtDuration(a.moving_time_s)} moving · {fmtPace(a.moving_time_s / (a.distance_m / 1000))} /km{a.avg_hr ? ` · avg ♥ ${Math.round(a.avg_hr)}` : " · no HR data"}
          </p>
          <div className="mt-4 flex justify-around rounded-xl bg-slate-50 py-3">
            <ScoreRing score={s.match.overall_score} label="overall" />
            <ScoreRing score={s.match.distance_score} label="distance" />
            <ScoreRing score={s.match.hr_score} label="heart rate" />
            <ScoreRing score={s.match.pace_score} label="pace" />
          </div>
          {s.match.verdict && <p className="mt-3 font-medium">{s.match.verdict}</p>}
          {s.details?.flags.map((f, i) => <p key={i} className="mt-1 text-sm text-amber-800">• {f}</p>)}

          {s.details && s.details.reps.reps.length > 0 && (
            <div className="mt-4 overflow-x-auto">
              <h3 className="label mb-1">Reps (found from {s.details.reps.method === "laps" ? "watch laps" : s.details.reps.method === "streams" ? "the GPS stream" : "position on the route"})</h3>
              <table className="tbl rounded-lg border border-line">
                <thead><tr><th>#</th><th>Target</th><th>Actual</th><th>HR / max</th><th>Result</th></tr></thead>
                <tbody>
                  {s.details.reps.reps.map((r) => (
                    <tr key={r.rep_no}>
                      <td>{r.rep_no}</td>
                      <td>{fmtPaceRange(r.target_min, r.target_max) ?? r.zone}</td>
                      <td className="font-semibold">{fmtPace(r.pace_s_per_km)} /km</td>
                      <td className={r.hr_flag ? "font-bold text-rose-700" : ""}>{r.avg_hr ? Math.round(r.avg_hr) : "–"}{r.hr_max ? ` / ${r.hr_max}` : ""}</td>
                      <td className="whitespace-nowrap">{r.in_range == null ? "" : r.in_range ? "✓ on target" : (r.delta_s ?? 0) < 0 ? `${Math.round(-r.delta_s!)} s fast` : `${Math.round(r.delta_s!)} s slow`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {s.details?.reps.method === "manual" && <p className="mt-2 text-sm text-muted">Rep check: manual. The watch didn&apos;t record a lap per rep and no stream was available.</p>}
          {chart.length > 0 && (
            <div className="mt-4">
              <h3 className="label mb-1">Heart rate over time</h3>
              <HrChart data={chart} band={[primary.hr_min, primary.hr_max]} bandLabel={`${primary.name} ${primary.hr_min ?? ""}–${primary.hr_max ?? ""} bpm`} />
            </div>
          )}
          <form action={resync} className="mt-3"><input type="hidden" name="activity" value={a.id} /><button className="btn">Re-sync activity</button></form>
        </section>
      )}

      {s.category === "run" && (
        <section className="card">
          <h2 className="h2">Strava activity</h2>
          <p className="text-xs text-muted">{s.match?.manual_override ? "You set this link by hand." : "Matched automatically. Change it if the app picked the wrong run."}</p>
          <form action={linkActivity} className="mt-2 flex gap-2">
            <input type="hidden" name="session" value={s.id} />
            <select name="activity" defaultValue={a?.id ?? "none"} className="input">
              <option value="none">Not done (unlink)</option>
              {nearby.map((x) => <option key={x.id} value={x.id}>{weekdayShort(x.local_date)} {fmtDate(x.local_date)} · {fmtKm(x.distance_m / 1000)} · {x.name}</option>)}
            </select>
            <button className="btn">Save</button>
          </form>
          {s.match?.manual_override && (
            <form action={clearManualLink} className="mt-2"><input type="hidden" name="session" value={s.id} /><button className="text-sm font-semibold text-accent underline">Go back to automatic matching</button></form>
          )}
        </section>
      )}

      {s.category === "run" && a && (
        <section className="card">
          <h2 className="h2">Pain and effort for this run</h2>
          <PainLogForm date={a.local_date} activityId={a.id} />
        </section>
      )}

      </div>
      </div>
      <p className="mt-6 text-center text-xs text-muted"><Link href="/changes" className="underline">All plan changes</Link></p>
    </>
  );
}
