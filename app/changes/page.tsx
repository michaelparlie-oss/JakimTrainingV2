import { getDb } from "@/db/client";
import { recentChanges } from "@/lib/server/changes";
import { undo } from "../actions";
import { PageTitle } from "../_c/ui";

export default async function Changes() {
  const rows = await recentChanges(await getDb(), 100);
  return (
    <>
      <PageTitle title="Plan changes" sub="The plan file is never edited. These changes sit on top of it, and each one can be undone." back="/more" />
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.id} className={`card ${r.undone ? "opacity-50" : ""}`}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-medium">{r.summary}</p>
                <p className="text-xs text-muted">{new Date(r.created_at * 1000).toLocaleString("en-GB", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" })} · {r.proposal_id ? "accepted suggestion" : "your change"}{r.undone ? " · undone" : ""}</p>
              </div>
              {!r.undone && (
                <form action={undo}><input type="hidden" name="id" value={r.id} /><button className="btn">Undo</button></form>
              )}
            </div>
          </li>
        ))}
        {!rows.length && <li className="card text-center text-sm text-muted">No changes yet: you&apos;re following the plan as written.</li>}
      </ul>
    </>
  );
}
