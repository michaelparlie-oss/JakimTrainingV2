import Link from "next/link";
import { getDb } from "@/db/client";
import { ctx, weekVM } from "@/lib/server/view";
import { addDays, fmtDate, mondayOf, weekdayShort } from "@/lib/util/dates";
import { fmtKm } from "@/lib/util/format";
import { StatusPill } from "../_c/ui";

export default async function Week({ searchParams }: { searchParams: Promise<{ start?: string }> }) {
  const c = await ctx(await getDb());
  const sp = await searchParams;
  const monday = mondayOf(sp.start && /^\d{4}-\d{2}-\d{2}$/.test(sp.start) ? sp.start : c.today);
  const w = weekVM(c, monday);
  const pct = w.plannedKm ? Math.min(100, (w.actualKm / w.plannedKm) * 100) : 0;
  return (
    <>
      <header className="mb-4 flex items-center justify-between">
        <Link href={`/week?start=${addDays(monday, -7)}`} className="px-2 text-xl text-muted" aria-label="Previous week">‹</Link>
        <div className="text-center">
          <h1 className="text-2xl font-extrabold">Week {w.codes.join(" + ") || "–"}</h1>
          <p className="text-sm text-muted">{fmtDate(monday)} – {fmtDate(addDays(monday, 6))}{w.planWeek ? ` · ${w.planWeek.phase}` : ""}</p>
        </div>
        <Link href={`/week?start=${addDays(monday, 7)}`} className="px-2 text-xl text-muted" aria-label="Next week">›</Link>
      </header>
      <section className="card mb-3">
        <div className="flex items-baseline justify-between">
          <span className="font-bold">Running: {fmtKm(w.actualKm)} done</span>
          <span className="text-sm text-muted">of {fmtKm(w.plannedKm)} planned</span>
        </div>
        <div className="mt-2 h-3 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-accent" style={{ width: `${pct}%` }} /></div>
        {w.deload && <p className="mt-2 inline-block rounded-full bg-violet-100 px-2 py-0.5 text-xs font-bold text-violet-800">Deload week: lighter on purpose</p>}
        {w.planWeek && Math.abs(w.planWeek.planned_run_km - w.plannedKm) > 0.05 && (
          <p className="mt-2 text-xs text-muted">Originally {fmtKm(w.planWeek.planned_run_km)}; adjusted by your changes.</p>
        )}
      </section>
      <ul className="space-y-2">
        {w.days.map((d) => (
          <li key={d.date}>
            <Link href={`/?date=${d.date}`} className={`card block ${d.date === c.today ? "ring-2 ring-accent" : ""}`}>
              <div className="flex items-baseline justify-between">
                <span className="font-bold">{weekdayShort(d.date)} {fmtDate(d.date)}</span>
                {!d.sessions.length && <span className="text-sm text-muted">Rest</span>}
              </div>
              <ul className="mt-1 space-y-1">
                {d.sessions.map((s) => (
                  <li key={s.id} className={`flex items-center justify-between gap-2 text-sm ${s.skipped ? "text-muted line-through" : ""}`}>
                    <span className="truncate">{s.category === "strength" ? s.strength?.name : s.title}{s.date !== s.plan_date ? " (moved)" : ""}</span>
                    {s.category === "run" && (
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="text-xs text-muted">{s.activity ? `${fmtKm(s.activity.distance_m / 1000)} / ` : ""}{fmtKm(s.distance_km)}</span>
                        <StatusPill status={s.skipped ? "skipped" : s.match?.status ?? "pending"} />
                      </span>
                    )}
                  </li>
                ))}
                {d.extras.map((a) => <li key={a.id} className="text-sm text-muted">+ extra run {fmtKm(a.distance_m / 1000)}</li>)}
              </ul>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
