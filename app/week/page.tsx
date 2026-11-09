import Link from "next/link";
import { getDb } from "@/db/client";
import { isCountedRun } from "@/lib/adapt/types";
import { ctx, weekVM, type SessionVM } from "@/lib/server/view";
import { addDays, fmtDate, mondayOf, weekdayShort } from "@/lib/util/dates";
import { fmtKm, fmtPace } from "@/lib/util/format";
import { Badge, Bar, PageTitle, StatusPill } from "../_c/ui";

const DONE = ["done", "moved", "partial"];
const CAT: Record<string, string> = { run: "border-l-series-1", strength: "border-l-violet-400", martial_arts: "border-l-slate-300", rest: "border-l-slate-200" };

function SessionChip({ s }: { s: SessionVM }) {
  const status = s.skipped ? "skipped" : s.match?.status ?? "pending";
  const title = s.category === "strength" ? s.strength?.name ?? s.title : s.title;
  return (
    <Link href={s.category === "strength" ? `/strength/${s.id}` : `/session/${s.id}`} className={`block rounded-lg border border-line border-l-4 ${CAT[s.category]} bg-white p-2 text-xs hover:border-slate-300 hover:shadow-sm ${s.skipped ? "opacity-60" : ""}`}>
      <div className="font-semibold uppercase tracking-wide text-[10px] text-muted">{s.slot} · {s.category === "martial_arts" ? "optional" : s.category === "run" ? s.kind : s.category}</div>
      <div className={`mt-1 font-semibold leading-snug text-ink ${s.skipped ? "line-through" : ""}`}>{title}</div>
      {s.category === "run" && (
        <div className="mt-1 text-[11px] text-muted tnum">
          {s.activity ? <><b className="text-ink">{fmtKm(s.activity.distance_m / 1000)}</b> of {fmtKm(s.distance_km)} · {fmtPace(s.activity.moving_time_s / (s.activity.distance_m / 1000))}/km</> : fmtKm(s.distance_km)}
          {s.match?.overall_score != null && <span className="ml-1">· score {Math.round(s.match.overall_score)}</span>}
        </div>
      )}
      {s.category === "run" && !s.optional && <div className="mt-1.5"><StatusPill status={status} /></div>}
      {s.date !== s.plan_date && <div className="mt-1 text-[10px] font-semibold text-sky-700">Moved</div>}
    </Link>
  );
}

export default async function Week({ searchParams }: { searchParams: Promise<{ start?: string }> }) {
  const c = await ctx(await getDb());
  const sp = await searchParams;
  const monday = mondayOf(sp.start && /^\d{4}-\d{2}-\d{2}$/.test(sp.start) ? sp.start : c.today);
  const w = weekVM(c, monday);
  const runs = w.days.flatMap((d) => d.sessions).filter((s) => isCountedRun(s));
  const done = runs.filter((s) => DONE.includes(s.match?.status ?? "")).length;
  const scores = runs.map((s) => s.match?.overall_score).filter((x): x is number => x != null);
  const strength = w.days.flatMap((d) => d.sessions).filter((s) => s.category === "strength" && !s.skipped).length;

  return (
    <>
      <PageTitle
        title={`Week ${w.codes.join(" + ") || "–"}`}
        sub={<>{fmtDate(monday, { day: "numeric", month: "long" })} – {fmtDate(addDays(monday, 6), { day: "numeric", month: "long", year: "numeric" })}{w.planWeek ? ` · ${w.planWeek.phase}` : ""}</>}
        actions={
          <>
            <Link href={`/week?start=${addDays(monday, -7)}`} className="btn" aria-label="Previous week">‹ Prev</Link>
            {monday !== mondayOf(c.today) && <Link href="/week" className="btn">This week</Link>}
            <Link href={`/week?start=${addDays(monday, 7)}`} className="btn" aria-label="Next week">Next ›</Link>
          </>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="card col-span-2">
          <div className="flex items-baseline justify-between">
            <span className="label">Running volume</span>
            {w.deload && <Badge tone="violet">Deload week</Badge>}
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-extrabold tnum">{fmtKm(w.actualKm)}</span>
            <span className="text-sm text-muted">of {fmtKm(w.plannedKm)} planned</span>
          </div>
          <Bar value={w.actualKm} max={w.plannedKm} className="mt-2" />
          {w.planWeek && Math.abs(w.planWeek.planned_run_km - w.plannedKm) > 0.05 && <p className="mt-2 text-xs text-muted">Originally {fmtKm(w.planWeek.planned_run_km)}; adjusted by your changes.</p>}
        </div>
        <div className="card"><div className="label">Runs done</div><div className="mt-1 text-2xl font-extrabold tnum">{done}<span className="text-base text-muted">/{runs.length}</span></div><div className="text-xs text-muted">{strength} strength session{strength === 1 ? "" : "s"}</div></div>
        <div className="card"><div className="label">Avg score</div><div className="mt-1 text-2xl font-extrabold tnum">{scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : "–"}<span className="text-base text-muted">{scores.length ? "/100" : ""}</span></div><div className="text-xs text-muted">{scores.length} scored run{scores.length === 1 ? "" : "s"}</div></div>
      </div>

      {/* Desktop: calendar grid */}
      <div className="hidden gap-3 lg:grid lg:grid-cols-7">
        {w.days.map((d) => (
          <div key={d.date} className={`flex min-h-56 flex-col rounded-[14px] border p-2.5 ${d.date === c.today ? "border-accent bg-accent-soft/40" : "border-line bg-slate-50/60"}`}>
            <Link href={`/?date=${d.date}`} className="mb-2 flex items-baseline justify-between px-0.5">
              <span className={`text-xs font-bold uppercase tracking-wide ${d.date === c.today ? "text-accent" : "text-muted"}`}>{weekdayShort(d.date)}</span>
              <span className="text-lg font-extrabold tnum">{Number(d.date.slice(8))}</span>
            </Link>
            <div className="flex flex-1 flex-col gap-2">
              {d.sessions.map((s) => <SessionChip key={s.id} s={s} />)}
              {d.extras.map((a) => <div key={a.id} className="rounded-lg border border-dashed border-line p-2 text-[11px] text-muted">+ extra run {fmtKm(a.distance_m / 1000)}</div>)}
              {!d.sessions.length && <div className="grid flex-1 place-items-center text-xs text-faint">Rest</div>}
            </div>
          </div>
        ))}
      </div>

      {/* Phone: list */}
      <ul className="space-y-2 lg:hidden">
        {w.days.map((d) => (
          <li key={d.date} className={`card ${d.date === c.today ? "ring-2 ring-accent" : ""}`}>
            <Link href={`/?date=${d.date}`} className="flex items-baseline justify-between">
              <span className="font-bold">{weekdayShort(d.date)} {fmtDate(d.date)}</span>
              {!d.sessions.length && <span className="text-sm text-muted">Rest</span>}
            </Link>
            {d.sessions.length > 0 && <div className="mt-2 space-y-2">{d.sessions.map((s) => <SessionChip key={s.id} s={s} />)}</div>}
            {d.extras.map((a) => <div key={a.id} className="mt-2 text-sm text-muted">+ extra run {fmtKm(a.distance_m / 1000)}</div>)}
          </li>
        ))}
      </ul>
    </>
  );
}
