import { desc } from "drizzle-orm";
import { getDb } from "@/db/client";
import * as t from "@/db/schema";
import { activeAlerts } from "@/lib/server/view";
import { fmtDate } from "@/lib/util/dates";
import { AlertCard } from "../_c/Alerts";
import { PageTitle } from "../_c/ui";

export default async function Alerts() {
  const db = await getDb();
  const open = await activeAlerts(db);
  const past = (await db.select().from(t.alert).orderBy(desc(t.alert.created_at)).limit(40).all()).filter((a) => a.dismissed || a.resolved);
  return (
    <>
      <PageTitle title="Alerts" sub="Safety checks run after every sync, log and plan change." back="/more" />
      <div className="lg:max-w-3xl space-y-2">
        {open.map((a) => <AlertCard key={a.id} a={a} />)}
        {!open.length && <p className="card text-center text-sm text-muted">No open alerts. Nice.</p>}
      </div>
      {past.length > 0 && (
        <section className="mt-6">
          <h2 className="label mb-2">Earlier</h2>
          <ul className="space-y-1 text-sm text-muted">
            {past.map((a) => <li key={a.id}>{fmtDate(a.date)} · {a.message} <i>({a.resolved ? "no longer applies" : "dismissed"})</i></li>)}
          </ul>
        </section>
      )}
    </>
  );
}
