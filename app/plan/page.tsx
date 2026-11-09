import Link from "next/link";
import { getDb } from "@/db/client";
import { ctx, planVM } from "@/lib/server/view";
import { fmtDate } from "@/lib/util/dates";
import { fmtKm } from "@/lib/util/format";
import { PageTitle } from "../_c/ui";

export default async function Plan() {
  const c = await ctx(await getDb());
  const weeks = planVM(c);
  const phases = [...new Set(weeks.map((w) => w.phase))];
  return (
    <>
      <PageTitle title="Plan" sub="31 weeks to JAKIM. Tap a week to open it." />
      {phases.map((p) => (
        <section key={p} className="mb-5">
          <h2 className="label mb-2">{p}</h2>
          <ul className="space-y-2">
            {weeks.filter((w) => w.phase === p).map((w) => (
              <li key={w.code}>
                <Link href={`/week?start=${w.start_date}`} className={`card block ${w.isCurrent ? "ring-2 ring-accent" : ""}`}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-bold">{w.code} <span className="font-normal text-muted">· {fmtDate(w.start_date)}</span></span>
                    <span className="text-sm">
                      {w.actual > 0 && <b>{fmtKm(w.actual)} / </b>}
                      {fmtKm(w.planned)}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1 text-xs">
                    {w.deload && <span className="rounded-full bg-violet-100 px-2 py-0.5 font-bold text-violet-800">Deload</span>}
                    {w.checkpoints.map((cp) => <span key={cp} className="rounded-full bg-yellow-200 px-2 py-0.5 font-bold text-yellow-900">{cp}</span>)}
                    {w.longest && <span className="rounded-full bg-slate-100 px-2 py-0.5">Long run {fmtKm(w.longest)}</span>}
                    {w.changed > 0 && <span className="rounded-full bg-sky-100 px-2 py-0.5 text-sky-900">{w.changed} changed</span>}
                    {w.skipped > 0 && <span className="rounded-full bg-slate-200 px-2 py-0.5">{w.skipped} run{w.skipped > 1 ? "s" : ""} skipped/dropped</span>}
                    {w.spikes > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-900">⚠️ 10% jump</span>}
                    {Math.abs(w.planned - w.planned_run_km) > 0.05 && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-muted">was {fmtKm(w.planned_run_km)}</span>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
