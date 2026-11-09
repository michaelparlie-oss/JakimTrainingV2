import Link from "next/link";
import { getDb } from "@/db/client";
import { ctx, planVM } from "@/lib/server/view";
import { fmtDate } from "@/lib/util/dates";
import { fmtKm } from "@/lib/util/format";
import { Badge, PageTitle } from "../_c/ui";

const PHASE_COLOR: Record<string, string> = {
  "Astra block": "bg-indigo-500", Recovery: "bg-slate-400", Base: "bg-teal-600", Build: "bg-amber-500", Taper: "bg-rose-500",
};

export default async function Plan() {
  const c = await ctx(await getDb());
  const weeks = planVM(c);
  const phases = [...new Set(weeks.map((w) => w.phase))];
  const maxKm = Math.max(...weeks.map((w) => Math.max(w.planned, w.actual)));
  const curIdx = weeks.findIndex((w) => w.isCurrent);
  const totalPlanned = weeks.reduce((t, w) => t + w.planned, 0);
  const totalActual = weeks.reduce((t, w) => t + w.actual, 0);

  const Flags = ({ w }: { w: (typeof weeks)[number] }) => (
    <div className="flex flex-wrap gap-1">
      {w.deload && <Badge tone="violet">Deload</Badge>}
      {w.checkpoints.map((cp) => <Badge key={cp} tone="yellow">{cp}</Badge>)}
      {w.changed > 0 && <Badge tone="sky">{w.changed} changed</Badge>}
      {w.skipped > 0 && <Badge>{w.skipped} skipped</Badge>}
      {w.spikes > 0 && <Badge tone="amber">⚠ 10% jump</Badge>}
    </div>
  );

  return (
    <>
      <PageTitle title="Training plan" sub={`31 weeks · ${fmtKm(totalPlanned)} planned · ${fmtKm(totalActual)} run so far`} />

      {/* Phase timeline */}
      <section className="card mb-5">
        <div className="flex h-9 overflow-hidden rounded-lg">
          {phases.map((p) => {
            const n = weeks.filter((w) => w.phase === p).length;
            return (
              <div key={p} className={`${PHASE_COLOR[p] ?? "bg-slate-400"} flex items-center justify-center border-r-2 border-white px-1 text-[11px] font-bold text-white last:border-r-0`} style={{ width: `${(n / weeks.length) * 100}%` }} title={`${p}: ${n} weeks`}>
                <span className="truncate">{p}</span>
              </div>
            );
          })}
        </div>
        <div className="relative mt-1 h-4">
          {curIdx >= 0 && (
            <div className="absolute -translate-x-1/2 text-[10px] font-bold text-accent" style={{ left: `${((curIdx + 0.5) / weeks.length) * 100}%` }}>▲ now</div>
          )}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          {phases.map((p) => <span key={p} className="flex items-center gap-1.5"><span className={`h-2.5 w-2.5 rounded-sm ${PHASE_COLOR[p]}`} />{p} · {weeks.filter((w) => w.phase === p).length} wk</span>)}
        </div>
      </section>

      {/* Desktop table */}
      <section className="card-flush hidden lg:block">
        <table className="tbl">
          <thead>
            <tr><th>Week</th><th>Starts</th><th>Phase</th><th className="num">Planned</th><th className="num">Actual</th><th style={{ width: "22%" }}>Volume</th><th className="num">Long run</th><th>Notes</th></tr>
          </thead>
          <tbody>
            {weeks.map((w) => (
              <tr key={w.code} className={w.isCurrent ? "bg-accent-soft/50" : ""}>
                <td><Link href={`/week?start=${w.start_date}`} className="font-bold text-ink hover:text-accent hover:underline">{w.code}</Link>{w.isCurrent && <span className="ml-2 text-[10px] font-bold uppercase text-accent">now</span>}</td>
                <td className="whitespace-nowrap text-ink-2">{fmtDate(w.start_date)}</td>
                <td><span className="flex items-center gap-1.5 text-ink-2"><span className={`h-2 w-2 rounded-sm ${PHASE_COLOR[w.phase]}`} />{w.phase}</span></td>
                <td className="num">{w.planned.toFixed(1)}</td>
                <td className="num">{w.actual > 0 ? <b>{w.actual.toFixed(1)}</b> : <span className="text-faint">–</span>}</td>
                <td>
                  <div className="relative h-2.5 rounded-full bg-slate-100" title={`Planned ${w.planned.toFixed(1)} km, actual ${w.actual.toFixed(1)} km`}>
                    <div className="absolute inset-y-0 left-0 rounded-full bg-slate-300" style={{ width: `${(w.planned / maxKm) * 100}%` }} />
                    {w.actual > 0 && <div className="absolute inset-y-0.5 left-0 rounded-full bg-series-1" style={{ width: `${(w.actual / maxKm) * 100}%` }} />}
                  </div>
                </td>
                <td className="num">{w.longest ? `${w.longest.toFixed(1)}` : "–"}</td>
                <td><Flags w={w} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex gap-4 border-t border-line px-4 py-2 text-[11px] text-muted">
          <span className="flex items-center gap-1.5"><span className="h-2 w-4 rounded-full bg-slate-300" />planned km</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-4 rounded-full bg-series-1" />actual km</span>
          <span>All distances in km</span>
        </div>
      </section>

      {/* Phone: cards by phase */}
      <div className="lg:hidden">
        {phases.map((p) => (
          <section key={p} className="mb-5">
            <h2 className="label mb-2">{p}</h2>
            <ul className="space-y-2">
              {weeks.filter((w) => w.phase === p).map((w) => (
                <li key={w.code}>
                  <Link href={`/week?start=${w.start_date}`} className={`card block ${w.isCurrent ? "ring-2 ring-accent" : ""}`}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-bold">{w.code} <span className="font-normal text-muted">· {fmtDate(w.start_date)}</span></span>
                      <span className="text-sm tnum">{w.actual > 0 && <b>{fmtKm(w.actual)} / </b>}{fmtKm(w.planned)}</span>
                    </div>
                    <div className="mt-2"><Flags w={w} /></div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}
