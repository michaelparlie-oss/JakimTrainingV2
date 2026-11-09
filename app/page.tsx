import Link from "next/link";
import { getDb } from "@/db/client";
import { wellbeingLog } from "@/db/schema";
import { isCountedRun } from "@/lib/adapt/types";
import { loadPlan } from "@/lib/plan/load";
import { activeAlerts, ctx, currentWeekCode, dayVM, weekVM } from "@/lib/server/view";
import { getSetting } from "@/lib/server/settings";
import { getToken } from "@/lib/strava/oauth";
import { shouldAutoSync } from "@/lib/strava/sync";
import { addDays, diffDays, fmtDate, mondayOf, weekdayShort } from "@/lib/util/dates";
import { fmtKm } from "@/lib/util/format";
import { AlertBanner } from "./_c/Alerts";
import { RunCard, SimpleCard, StrengthCard } from "./_c/Cards";
import { AutoSync, SyncButton } from "./_c/SyncButton";
import { Badge, Bar } from "./_c/ui";

const DONE = ["done", "moved", "partial"];

export default async function Today({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const db = await getDb();
  const sp = await searchParams;
  const c = await ctx(db);
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : c.today;
  const plan = loadPlan();
  const [tok, autoSync, alerts, fever, wellbeing] = await Promise.all([
    getToken(db), shouldAutoSync(db), activeAlerts(db), getSetting(db, "fever"), db.select().from(wellbeingLog).all(),
  ]);
  const connected = !!tok;

  const day = dayVM(c, date);
  const wk = currentWeekCode({ ...c, today: date });
  const week = weekVM(c, mondayOf(date));
  const toRace = diffDays(date, plan.meta.goal_race.date);
  const toAstra = diffDays(date, plan.meta.tune_up_race.date);
  const runs = day.sessions.filter((s) => s.category === "run");
  const strength = day.sessions.filter((s) => s.category === "strength");
  const other = day.sessions.filter((s) => s.category === "martial_arts" || s.category === "rest");
  const blocked = fever?.active || alerts.some((a) => a.rule_id === "fever");
  const weekRuns = week.days.flatMap((d) => d.sessions).filter((s) => isCountedRun(s));
  const weekDone = weekRuns.filter((s) => DONE.includes(s.match?.status ?? "")).length;

  return (
    <>
      {/* Header */}
      <header className="mb-5 lg:mb-7">
        <div className="flex items-center justify-between gap-3">
          <Link href={`/?date=${addDays(date, -1)}`} className="btn h-10 w-10 shrink-0 px-0 text-lg lg:hidden" aria-label="Previous day">‹</Link>
          <div className="min-w-0 text-center lg:text-left">
            <div className="kicker">{wk ? `Week ${wk.code} · ${wk.phase}` : ""}{week.deload ? " · deload week" : ""}</div>
            <h1 className="text-2xl font-extrabold tracking-tight lg:text-3xl">{date === c.today ? "Today" : fmtDate(date, { weekday: "long" })}</h1>
            <p className="text-sm text-muted">{fmtDate(date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
          </div>
          <Link href={`/?date=${addDays(date, 1)}`} className="btn h-10 w-10 shrink-0 px-0 text-lg lg:hidden" aria-label="Next day">›</Link>
          <div className="hidden items-center gap-2 lg:flex">
            <Link href={`/?date=${addDays(date, -1)}`} className="btn" aria-label="Previous day">‹ Prev</Link>
            {date !== c.today && <Link href="/" className="btn">Today</Link>}
            <Link href={`/?date=${addDays(date, 1)}`} className="btn" aria-label="Next day">Next ›</Link>
          </div>
        </div>
        {date !== c.today && <Link href="/" className="mt-2 block text-center text-sm font-semibold text-accent lg:hidden">Back to today</Link>}
      </header>

      <AutoSync enabled={autoSync} />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-6">
        {/* Main column */}
        <div className="min-w-0 space-y-4">
          <AlertBanner alerts={alerts} />
          {blocked && runs.length > 0 && (
            <div className="rounded-2xl border border-rose-300 bg-rose-50 p-3 text-sm font-semibold text-rose-900">⛔ No running until 24 h fever-free. <Link href="/log" className="underline">Update illness status</Link></div>
          )}
          {runs.map((s) => (
            <RunCard key={s.id} s={s} today={c.today} painLogged={wellbeing.some((w) => w.knee_pain != null && (w.strava_activity_id === s.activity?.id || w.date === s.activity?.local_date))} />
          ))}
          {strength.map((s) => <StrengthCard key={s.id} s={s} />)}
          {other.map((s) => <SimpleCard key={s.id} s={s} />)}
          {!day.sessions.length && (
            <div className="card py-10 text-center"><div className="text-3xl">🌿</div><h2 className="mt-2 text-lg font-bold">Rest day</h2><p className="text-sm text-muted">Optional: an easy walk or mobility.</p></div>
          )}
          {day.movedAway.map((s) => (
            <p key={s.id} className="text-center text-xs text-muted">“{s.plan_title}” was moved to <Link className="underline" href={`/?date=${s.date}`}>{fmtDate(s.date, { weekday: "short", day: "numeric", month: "short" })}</Link>.</p>
          ))}
          {day.extras.map((a) => (
            <div key={a.id} className="card text-sm"><b>Extra run:</b> {fmtKm(a.distance_m / 1000)} ({a.name}). Counted in your weekly km.</div>
          ))}
          {day.otherActs.map((a) => (
            <div key={a.id} className="card text-sm text-muted">Watch: {a.sport_type === "WeightTraining" ? "weight training" : "workout"} {Math.round(a.moving_time_s / 60)} min{a.avg_hr ? `, ♥ ${Math.round(a.avg_hr)} bpm` : ""}.</div>
          ))}
        </div>

        {/* Right rail */}
        <aside className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {toRace >= 0 && (
              <div className="rounded-[14px] bg-gradient-to-br from-teal-700 to-teal-900 p-4 text-white">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-teal-100">JAKIM</div>
                <div className="text-3xl font-extrabold tnum">{toRace}</div>
                <div className="text-xs text-teal-100">days · 13 Jun</div>
              </div>
            )}
            {toAstra >= 0 ? (
              <div className="rounded-[14px] bg-gradient-to-br from-indigo-600 to-indigo-800 p-4 text-white">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-indigo-100">Astra HM</div>
                <div className="text-3xl font-extrabold tnum">{toAstra}</div>
                <div className="text-xs text-indigo-100">days · 29 Nov</div>
              </div>
            ) : (
              <div className="card">
                <div className="label">Phase</div>
                <div className="mt-1 text-lg font-extrabold">{wk?.phase ?? "–"}</div>
                <div className="text-xs text-muted">Week {wk?.code ?? "–"}</div>
              </div>
            )}
          </div>

          <section className="card">
            <div className="flex items-baseline justify-between">
              <h2 className="h2">This week</h2>
              <Link href={`/week?start=${mondayOf(date)}`} className="text-xs font-semibold text-accent hover:underline">Open week →</Link>
            </div>
            <div className="mt-3 flex items-baseline justify-between">
              <span className="text-2xl font-extrabold tnum">{fmtKm(week.actualKm)}</span>
              <span className="text-xs text-muted">of {fmtKm(week.plannedKm)} planned</span>
            </div>
            <Bar value={week.actualKm} max={week.plannedKm} className="mt-2" />
            <div className="mt-3 flex items-center justify-between text-xs text-muted">
              <span>Runs done <b className="text-ink tnum">{weekDone}/{weekRuns.length}</b></span>
              {week.deload && <Badge tone="violet">Deload</Badge>}
            </div>
            <ol className="mt-4 grid grid-cols-7 gap-1">
              {week.days.map((d) => {
                const run = d.sessions.find((s) => s.category === "run" && !s.optional);
                const st = run ? (run.skipped ? "skipped" : run.match?.status ?? "pending") : null;
                const dot = st == null ? "bg-slate-100" : DONE.includes(st) ? "bg-emerald-500" : st === "missed" ? "bg-rose-400" : st === "skipped" ? "bg-slate-300" : "bg-white ring-2 ring-inset ring-sky-400";
                const label = st == null ? "rest" : DONE.includes(st) ? "done" : st;
                return (
                  <li key={d.date}>
                    <Link href={`/?date=${d.date}`} className={`flex flex-col items-center gap-1 rounded-lg py-1.5 ${d.date === date ? "bg-accent-soft" : "hover:bg-slate-50"}`} title={`${weekdayShort(d.date)}: ${run ? run.title : "rest"} (${label})`}>
                      <span className={`text-[10px] font-semibold ${d.date === c.today ? "text-accent" : "text-muted"}`}>{weekdayShort(d.date).slice(0, 2)}</span>
                      <span className={`h-3 w-3 rounded-full ${dot}`} />
                      <span className="text-[10px] tnum text-ink-2">{run?.distance_km ? Math.round(run.distance_km) : "·"}</span>
                    </Link>
                  </li>
                );
              })}
            </ol>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted">
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" />done</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full ring-2 ring-inset ring-sky-400" />planned</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-rose-400" />missed</span>
              <span>numbers = planned km</span>
            </div>
          </section>

          <section className="card space-y-2">
            <h2 className="h2">Quick actions</h2>
            <div className="flex flex-col gap-2">
              {connected ? <SyncButton /> : <Link href="/settings" className="btn btn-primary">Connect Strava</Link>}
              <Link href="/log" className="btn">Log pain or illness</Link>
              <Link href="/progress" className="btn">View progress</Link>
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}
