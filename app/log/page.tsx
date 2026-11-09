import { desc } from "drizzle-orm";
import { getDb } from "@/db/client";
import { wellbeingLog } from "@/db/schema";
import { getSetting } from "@/lib/server/settings";
import { fmtDate } from "@/lib/util/dates";
import { deleteWellbeing, setFever } from "../actions";
import { PainLogForm } from "../_c/Forms";
import { PageTitle } from "../_c/ui";
import { todayLocal } from "@/lib/util/dates";

export default async function Log() {
  const db = await getDb();
  const fever = await getSetting(db, "fever");
  const rows = await db.select().from(wellbeingLog).orderBy(desc(wellbeingLog.date), desc(wellbeingLog.created_at)).limit(60).all();
  return (
    <>
      <PageTitle title="Pain & illness" sub="Knee pain is the main safety signal in your plan." back="/more" />
      <div className="lg:grid lg:grid-cols-2 lg:gap-6 lg:items-start"><div>
      <section className={`card mb-4 ${fever?.active ? "border-rose-300 bg-rose-50" : ""}`}>
        <h2 className="h2">Ill or feverish?</h2>
        <p className="text-sm text-muted">Plan rule: no running until 24 h fever-free.</p>
        <form action={setFever} className="mt-2">
          <input type="hidden" name="on" value={fever?.active ? "0" : "1"} />
          <button className={`btn ${fever?.active ? "btn-primary" : "btn-danger"}`}>{fever?.active ? "Fever has gone (start the 24 h clock)" : "I have a fever / I'm ill"}</button>
        </form>
      </section>
      <section className="card mb-4">
        <h2 className="h2">Log today</h2>
        <p className="text-xs text-muted">Knee ≤ 3/10 that settles by next morning: carry on. Above 3/10, limping or worse next day: the next run becomes 30 min easy or rest.</p>
        <PainLogForm date={todayLocal()} />
      </section>
      </div><div>
      <h2 className="label mb-2">History</h2>
      <ul className="space-y-1">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center justify-between rounded-lg bg-white px-3 py-2 text-sm">
            <span>
              <b>{fmtDate(r.date)}</b>{" "}
              {r.knee_pain != null && <span className={r.knee_pain > 3 ? "font-bold text-rose-700" : ""}>knee {r.knee_pain}</span>}
              {r.bunion_pain != null && ` · bunion ${r.bunion_pain}`}{r.rpe != null && ` · RPE ${r.rpe}`}{r.carbs_g != null && ` · ${r.carbs_g} g carbs`}
              {r.note && <span className="block text-xs text-muted">{r.note}</span>}
              <span className="block text-[11px] text-muted">{r.source === "strava_description" ? "from Strava description" : "entered here"}</span>
            </span>
            {r.source === "manual" && <form action={deleteWellbeing}><input type="hidden" name="id" value={r.id} /><button className="text-xs text-muted underline">delete</button></form>}
          </li>
        ))}
        {!rows.length && <li className="text-sm text-muted">Nothing logged yet.</li>}
      </ul>
      </div></div>
    </>
  );
}
