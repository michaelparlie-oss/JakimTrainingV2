import Link from "next/link";
import { getDb } from "@/db/client";
import { loadPlan } from "@/lib/plan/load";
import { goalTimeS, zoneResolver } from "@/lib/server/data";
import { getSettings } from "@/lib/server/settings";
import { getToken, stravaConfig } from "@/lib/strava/oauth";
import { todayLocal } from "@/lib/util/dates";
import { fmtDuration, fmtPace } from "@/lib/util/format";
import { MARATHON_KM } from "@/lib/zones/formula";
import { confirmGoal, deleteAllData, disconnectStrava } from "../actions";
import { PageTitle } from "../_c/ui";
import { SyncButton } from "../_c/SyncButton";
import { HrForm, PasscodeForm } from "./SettingsForms";

export default async function Settings({ searchParams }: { searchParams: Promise<{ strava?: string; deleted?: string }> }) {
  const sp = await searchParams;
  const db = await getDb();
  const [tok, s, goal, zr] = await Promise.all([getToken(db), getSettings(db, ["last_sync_at", "sync_state", "rate", "hr_overrides"]), goalTimeS(db), zoneResolver(db)]);
  const { last_sync_at: last, sync_state: st, rate, hr_overrides: hr } = s;
  const active = zr({ date: todayLocal(), zone_set: "v1" });
  const zones = active.zones;
  const cfg = stravaConfig();
  const plan = loadPlan();
  return (
    <>
      <PageTitle title="Settings" back="/more" />
      {sp.deleted && <p className="mb-3 rounded-lg bg-emerald-50 p-3 text-sm">All your data was deleted. The plan is still here.</p>}
      {sp.strava === "error" && <p className="mb-3 rounded-lg bg-rose-50 p-3 text-sm">Strava connection failed. Check the client ID, secret and redirect URI.</p>}
      {sp.strava === "scope" && <p className="mb-3 rounded-lg bg-rose-50 p-3 text-sm">Please allow “View data about your private activities” so the app can read your runs.</p>}

      <section className="card mb-3">
        <h2 className="h2">Strava</h2>
        {tok ? (
          <>
            <p className="text-sm">Connected{tok.athlete_id ? ` (athlete ${tok.athlete_id})` : ""}. Read-only: the app never writes to Strava.</p>
            <p className="text-xs text-muted">Last sync: {last ? new Date(last * 1000).toLocaleString("en-GB", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" }) : "never"}{st?.message ? ` · ${st.message}` : ""}</p>
            {rate && <p className="text-xs text-muted">API use this 15 min: {rate.short_usage}/{rate.short_limit}; today {rate.daily_usage}/{rate.daily_limit}</p>}
            <div className="mt-2 flex gap-2"><SyncButton /><form action={disconnectStrava}><button className="btn">Disconnect</button></form></div>
          </>
        ) : cfg.clientId ? (
          <a href="/api/strava/connect" className="btn btn-primary mt-2">Connect with Strava</a>
        ) : (
          <p className="text-sm text-muted">Set STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET and STRAVA_REDIRECT_URI in .env.local (see README), then restart.</p>
        )}
      </section>

      <section className="card mb-3">
        <h2 className="h2">Goal time</h2>
        <p className="text-sm">Now: <b>{fmtDuration(goal)}</b> → marathon pace {fmtPace(goal / MARATHON_KM)} /km (MP zone {zones.MP.pace_text}). Plan goal: {plan.meta.goal_race.goal_time}.</p>
        <form action={confirmGoal} className="mt-2 flex gap-2">
          <input name="goal" placeholder="4:59:00" className="input" />
          <input type="hidden" name="reason" value="Changed in Settings" />
          <button className="btn">Change goal</button>
        </form>
        <p className="mt-1 text-xs text-muted">Changes only marathon pace. The plan suggests a goal change after Checkpoint 3.</p>
      </section>

      <section className="card mb-3">
        <h2 className="h2">Heart-rate zones</h2>
        <p className="text-xs text-muted">Defaults come from the plan. Change only if a physiologist or a lab test gave you different numbers.</p>
        <HrForm zones={["E", "L", "REC", "MP", "HMP", "T", "I"].map((c) => ({ code: c, name: zones[c as keyof typeof zones].name, min: zones[c as keyof typeof zones].hr_min, max: zones[c as keyof typeof zones].hr_max }))} custom={Object.keys(hr).length > 0} />
      </section>

      <section className="card mb-3">
        <h2 className="h2">Active paces</h2>
        <p className="text-xs text-muted">Today&apos;s zone set: {active.label}. <Link href="/checkpoints" className="underline">History</Link></p>
      </section>

      <section className="card mb-3">
        <h2 className="h2">Export</h2>
        <div className="mt-2 flex flex-wrap gap-2">
          <a className="btn" href="/api/export?format=json">All logs (JSON)</a>
          <a className="btn" href="/api/export?format=csv&table=runs">Runs (CSV)</a>
          <a className="btn" href="/api/export?format=csv&table=strength">Strength (CSV)</a>
          <a className="btn" href="/api/export?format=csv&table=wellbeing">Pain log (CSV)</a>
        </div>
      </section>

      <section className="card mb-3"><h2 className="h2">Passcode</h2><PasscodeForm /></section>

      <section className="card mb-3 border-rose-200">
        <h2 className="h2 text-rose-800">Delete all my data</h2>
        <p className="text-xs text-muted">Removes logs, Strava data and tokens, changes and results. The training plan stays. This cannot be undone.</p>
        <form action={deleteAllData} className="mt-2 flex gap-2">
          <input name="confirm" placeholder="Type DELETE" className="input" />
          <button className="btn btn-danger">Delete</button>
        </form>
      </section>
      <p className="text-center text-xs text-muted">Strava data is used under the <a className="underline" href="https://www.strava.com/legal/api" target="_blank" rel="noreferrer">Strava API Agreement</a>. It stays on this server.</p>
    </>
  );
}
