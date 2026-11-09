import Link from "next/link";
import { getDb } from "@/db/client";
import { wellbeingLog } from "@/db/schema";
import { loadPlan } from "@/lib/plan/load";
import { activeAlerts, ctx, currentWeekCode, dayVM } from "@/lib/server/view";
import { getSetting } from "@/lib/server/settings";
import { getToken } from "@/lib/strava/oauth";
import { shouldAutoSync } from "@/lib/strava/sync";
import { addDays, diffDays, fmtDate, mondayOf } from "@/lib/util/dates";
import { fmtKm } from "@/lib/util/format";
import { AlertBanner } from "./_c/Alerts";
import { RunCard, SimpleCard, StrengthCard } from "./_c/Cards";
import { AutoSync, SyncButton } from "./_c/SyncButton";
import { weekVM } from "@/lib/server/view";

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

  return (
    <>
      <header className="mb-4">
        <div className="flex items-center justify-between">
          <Link href={`/?date=${addDays(date, -1)}`} className="px-2 text-xl text-muted" aria-label="Previous day">‹</Link>
          <div className="text-center">
            <h1 className="text-2xl font-extrabold">{date === c.today ? "Today" : fmtDate(date, { weekday: "long" })}</h1>
            <p className="text-sm text-muted">{fmtDate(date, { weekday: "short", day: "numeric", month: "long", year: "numeric" })}{wk ? ` · Week ${wk.code} · ${wk.phase}` : ""}</p>
          </div>
          <Link href={`/?date=${addDays(date, 1)}`} className="px-2 text-xl text-muted" aria-label="Next day">›</Link>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-center">
          {toRace >= 0 && <div className="rounded-xl bg-accent px-2 py-2 text-white"><div className="text-2xl font-extrabold">{toRace}</div><div className="text-xs">days to JAKIM (13 Jun)</div></div>}
          {toAstra >= 0 ? (
            <div className="rounded-xl bg-indigo-600 px-2 py-2 text-white"><div className="text-2xl font-extrabold">{toAstra}</div><div className="text-xs">days to Astra HM (29 Nov)</div></div>
          ) : (
            <Link href="/week" className="rounded-xl bg-white px-2 py-2 border border-line"><div className="text-lg font-extrabold">{fmtKm(week.actualKm)} <span className="text-sm font-medium text-muted">/ {fmtKm(week.plannedKm)}</span></div><div className="text-xs text-muted">this week, done / planned</div></Link>
          )}
        </div>
        {date !== c.today && <Link href="/" className="mt-2 block text-center text-sm font-semibold text-accent">Back to today</Link>}
      </header>

      <AutoSync enabled={autoSync} />
      <AlertBanner alerts={alerts} />

      {blocked && runs.length > 0 && (
        <div className="mb-3 rounded-2xl border border-rose-300 bg-rose-50 p-3 text-sm font-semibold text-rose-900">⛔ No running until 24 h fever-free. <Link href="/log" className="underline">Update illness status</Link></div>
      )}

      <div className="space-y-3">
        {runs.map((s) => (
          <RunCard key={s.id} s={s} today={c.today} painLogged={wellbeing.some((w) => w.knee_pain != null && (w.strava_activity_id === s.activity?.id || w.date === s.activity?.local_date))} />
        ))}
        {strength.map((s) => <StrengthCard key={s.id} s={s} />)}
        {other.map((s) => <SimpleCard key={s.id} s={s} />)}
        {!day.sessions.length && (
          <div className="card text-center"><h2 className="text-lg font-bold">Rest.</h2><p className="text-sm text-muted">Optional: walk or mobility.</p></div>
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

      <div className="mt-6 flex flex-col items-center gap-2">
        {connected ? <SyncButton /> : <Link href="/settings" className="btn btn-primary">Connect Strava</Link>}
        <Link href="/log" className="text-sm font-semibold text-accent">Log pain or illness</Link>
      </div>
    </>
  );
}
