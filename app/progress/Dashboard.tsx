"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Bar, CartesianGrid, ComposedChart, Line, LineChart, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from "recharts";
import type { DashboardData, WeekRow } from "./data";

// ---------- tokens (validated palette: series 1–3 on white; see globals.css) ----------
const C = { s1: "#2a78d6", s2: "#eb6834", s3: "#1baf7a", target: "#475569", grid: "#eceae4", axis: "#898781", critical: "#d03b3b" };
const axis = { stroke: C.axis, tickLine: false, axisLine: { stroke: "#d6d4cc" }, fontSize: 11 } as const;

const pace = (s: number | null | undefined) => (s == null ? "–" : `${Math.floor(Math.round(s) / 60)}:${String(Math.round(s) % 60).padStart(2, "0")}`);
const km = (v: number | null | undefined, d = 1) => (v == null ? "–" : v.toFixed(d));
const dur = (s: number | null) => (s == null ? "–" : `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`);
const shortDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

type Range = "4" | "8" | "12" | "todate" | "all";
const RANGES: [Range, string][] = [["4", "4 weeks"], ["8", "8 weeks"], ["12", "12 weeks"], ["todate", "Plan to date"], ["all", "Full plan"]];

// ---------- building blocks ----------
function TipBox({ title, rows }: { title: string; rows: { label: string; value: string; color?: string; dash?: boolean }[] }) {
  return (
    <div className="min-w-44 rounded-lg border border-line bg-white px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 font-bold text-ink">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center justify-between gap-4 py-0.5">
          <span className="flex items-center gap-1.5 text-ink-2">
            {r.color && <Swatch color={r.color} dash={r.dash} />}
            {r.label}
          </span>
          <span className="font-semibold tnum text-ink">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

function Swatch({ color, dash, dot }: { color: string; dash?: boolean; dot?: boolean }) {
  if (dot) return <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color }} />;
  return <span className="inline-block h-0.5 w-3.5" style={{ background: dash ? `repeating-linear-gradient(90deg, ${color} 0 4px, transparent 4px 7px)` : color, height: dash ? 2 : 3, borderRadius: 2 }} />;
}

interface Col<T> { key: string; label: string; num?: boolean; get: (r: T) => React.ReactNode }

function DataTable<T>({ cols, rows, max }: { cols: Col<T>[]; rows: T[]; max?: number }) {
  const [all, setAll] = useState(false);
  const shown = max && !all ? rows.slice(0, max) : rows;
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="tbl">
          <thead><tr>{cols.map((c) => <th key={c.key} className={c.num ? "num" : ""}>{c.label}</th>)}</tr></thead>
          <tbody>
            {shown.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c.key} className={c.num ? "num" : ""}>{c.get(r)}</td>)}</tr>)}
            {!rows.length && <tr><td colSpan={cols.length} className="py-6 text-center text-muted">No data in this range yet.</td></tr>}
          </tbody>
        </table>
      </div>
      {max && rows.length > max && (
        <button className="w-full border-t border-line py-2 text-xs font-semibold text-accent hover:bg-slate-50" onClick={() => setAll((a) => !a)}>
          {all ? "Show fewer" : `Show all ${rows.length}`}
        </button>
      )}
    </div>
  );
}

function ChartCard<T>({ title, sub, legend, cols, rows, empty, className = "", children }: {
  title: string; sub?: string; legend?: { label: string; color: string; dash?: boolean; dot?: boolean }[];
  cols: Col<T>[]; rows: T[]; empty?: string | null; className?: string; children: React.ReactNode;
}) {
  const [view, setView] = useState<"chart" | "table">("chart");
  return (
    <section className={`card-flush flex flex-col ${className}`}>
      <div className="flex items-start justify-between gap-3 px-4 pt-4 lg:px-5">
        <div className="min-w-0">
          <h2 className="h2">{title}</h2>
          {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
        </div>
        <div className="seg shrink-0" role="group" aria-label="View">
          <button aria-pressed={view === "chart"} onClick={() => setView("chart")}>Chart</button>
          <button aria-pressed={view === "table"} onClick={() => setView("table")}>Table</button>
        </div>
      </div>
      {view === "chart" && legend && legend.length > 1 && !empty && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 pt-2 text-xs text-ink-2 lg:px-5">
          {legend.map((l) => <span key={l.label} className="flex items-center gap-1.5"><Swatch {...l} />{l.label}</span>)}
        </div>
      )}
      <div className="flex-1 px-2 pb-3 pt-2 lg:px-3">
        {view === "table" ? (
          <div className="px-2"><DataTable cols={cols} rows={rows} /></div>
        ) : empty ? (
          <div className="grid h-56 place-items-center rounded-lg bg-slate-50 px-6 text-center text-sm text-muted">{empty}</div>
        ) : (
          <div className="h-56 lg:h-64">{children}</div>
        )}
      </div>
    </section>
  );
}

function Kpi({ label, value, unit, note, tone = "neutral" }: { label: string; value: string; unit?: string; note?: string; tone?: "neutral" | "good" | "warn" | "bad" }) {
  const t = { neutral: ["", "text-muted"], good: ["▲ ", "text-good-ink"], warn: ["● ", "text-amber-700"], bad: ["▼ ", "text-red-700"] }[tone];
  return (
    <div className="card">
      <div className="label">{label}</div>
      <div className="mt-1 text-2xl font-extrabold tracking-tight tnum lg:text-[1.65rem]">
        {value}{unit && <span className="ml-1 text-sm font-semibold text-muted">{unit}</span>}
      </div>
      {note && <div className={`mt-0.5 text-xs font-medium ${t[1]}`}>{t[0]}{note}</div>}
    </div>
  );
}

const STATUS: Record<string, [string, string]> = {
  done: ["Done", "bg-emerald-50 text-emerald-800"], moved: ["Other day", "bg-sky-50 text-sky-800"], partial: ["Partial", "bg-amber-50 text-amber-800"],
  missed: ["Missed", "bg-rose-50 text-rose-800"], skipped: ["Skipped", "bg-slate-100 text-slate-700"], pending: ["Pending", "bg-slate-100 text-slate-600"],
};
function Pill({ s }: { s: string }) {
  const [l, c] = STATUS[s] ?? [s, "bg-slate-100"];
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${c}`}>{l}</span>;
}
function ScoreCell({ v }: { v: number | null }) {
  if (v == null) return <span className="text-faint">–</span>;
  const r = Math.round(v);
  return (
    <span className="inline-flex items-center gap-2">
      <span className="tnum font-semibold">{r}</span>
      <span className="hidden h-1.5 w-14 overflow-hidden rounded-full bg-slate-100 sm:inline-block"><span className="block h-full rounded-full bg-series-1" style={{ width: `${r}%` }} /></span>
    </span>
  );
}

// ---------- dashboard ----------
export function Dashboard({ data }: { data: DashboardData }) {
  const [range, setRange] = useState<Range>("8");
  const cur = Math.max(0, data.weeks.findIndex((w) => w.current) >= 0 ? data.weeks.findIndex((w) => w.current) : data.weeks.filter((w) => w.past).length - 1);

  const weeks: WeekRow[] = useMemo(() => {
    if (range === "all") return data.weeks;
    if (range === "todate") return data.weeks.slice(0, cur + 1);
    const n = Number(range);
    return data.weeks.slice(Math.max(0, cur - n + 1), cur + 1);
  }, [range, data.weeks, cur]);

  const from = weeks[0]?.start ?? data.today;
  const to = weeks.length ? (range === "all" ? "9999" : data.today) : data.today;
  const pastWeeks = weeks.filter((w) => w.past);
  const runs = data.runs.filter((r) => r.date >= from && r.date <= to);
  const strength = data.strength.filter((s) => s.date >= from && s.date <= to);
  const knee = data.knee.filter((k) => k.date >= from && k.date <= to);

  // KPIs over weeks that have started
  const plannedToDate = pastWeeks.reduce((t, w) => t + w.planned, 0);
  const actual = pastWeeks.reduce((t, w) => t + (w.actual ?? 0), 0);
  const due = pastWeeks.reduce((t, w) => t + w.runsDue, 0);
  const doneN = pastWeeks.reduce((t, w) => t + w.runsDone, 0);
  const scored = runs.filter((r) => r.score != null);
  const avgScore = scored.length ? scored.reduce((t, r) => t + r.score!, 0) / scored.length : null;
  const longest = Math.max(0, ...runs.map((r) => r.actualKm ?? 0));
  const effs = pastWeeks.filter((w) => w.effPace != null);
  const effDelta = effs.length >= 2 ? effs[0].effPace! - effs[effs.length - 1].effPace! : null;
  const kneeMax = knee.length ? Math.max(...knee.map((k) => k.knee)) : null;
  const kneeHigh = knee.filter((k) => k.knee > 3).length;
  const volPct = plannedToDate > 0 ? Math.round((actual / plannedToDate) * 100) : null;

  const curCode = data.weeks[cur]?.code;
  const weekTick = (c: string) => c;
  const runCols: Col<(typeof runs)[number]>[] = [
    { key: "d", label: "Date", get: (r) => <span className="whitespace-nowrap">{shortDate(r.date)}</span> },
    { key: "s", label: "Session", get: (r) => <Link style={{ minWidth: 180, display: "inline-block" }} href={`/session/${r.id}`} className="font-medium text-ink hover:text-accent hover:underline">{r.title}</Link> },
    { key: "st", label: "Status", get: (r) => <Pill s={r.status} /> },
    { key: "p", label: "Plan km", num: true, get: (r) => km(r.plannedKm) },
    { key: "a", label: "Actual km", num: true, get: (r) => km(r.actualKm) },
    { key: "pa", label: "Pace /km", num: true, get: (r) => pace(r.pace) },
    { key: "hr", label: "Avg HR", num: true, get: (r) => (r.hr ? Math.round(r.hr) : "–") },
    { key: "sc", label: "Score", get: (r) => <ScoreCell v={r.score} /> },
  ];

  return (
    <div className="space-y-5 lg:space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="seg overflow-x-auto" role="group" aria-label="Date range">
          {RANGES.map(([k, l]) => <button key={k} aria-pressed={range === k} onClick={() => setRange(k)}>{l}</button>)}
        </div>
        <p className="text-xs text-muted">
          {weeks.length ? `${weeks[0].code} – ${weeks[weeks.length - 1].code} · ${shortDate(weeks[0].start)} to ${range === "all" ? "13 Jun" : shortDate(data.today)}` : ""}
        </p>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Distance" value={km(actual)} unit="km" note={volPct != null ? `${volPct}% of ${km(plannedToDate, 0)} km planned` : "No runs yet"} tone={volPct == null ? "neutral" : volPct >= 90 ? "good" : volPct >= 70 ? "warn" : "bad"} />
        <Kpi label="Runs completed" value={`${doneN}/${due}`} note={due ? `${Math.round((doneN / due) * 100)}% of runs due` : "None due yet"} tone={!due ? "neutral" : doneN / due >= 0.85 ? "good" : doneN / due >= 0.6 ? "warn" : "bad"} />
        <Kpi label="Avg run score" value={avgScore != null ? String(Math.round(avgScore)) : "–"} unit={avgScore != null ? "/100" : undefined} note={scored.length ? `${scored.length} scored runs` : "Scores appear after sync"} tone={avgScore == null ? "neutral" : avgScore >= 80 ? "good" : avgScore >= 60 ? "warn" : "bad"} />
        <Kpi label="Longest run" value={longest ? km(longest) : "–"} unit={longest ? "km" : undefined} note={pastWeeks.length && pastWeeks[pastWeeks.length - 1].cap ? `Next cap ${km(pastWeeks[pastWeeks.length - 1].cap)} km` : undefined} />
        <Kpi label="Easy-run efficiency" value={effDelta != null ? `${effDelta >= 0 ? "−" : "+"}${Math.abs(Math.round(effDelta))}` : "–"} unit={effDelta != null ? "s/km" : undefined} note={effDelta == null ? "Needs 2+ weeks of data" : effDelta >= 0 ? "Faster at the same HR" : "Slower at the same HR"} tone={effDelta == null ? "neutral" : effDelta >= 0 ? "good" : "warn"} />
        <Kpi label="Knee pain (max)" value={kneeMax != null ? String(kneeMax) : "–"} unit={kneeMax != null ? "/10" : undefined} note={kneeMax == null ? "Nothing logged" : kneeHigh ? `${kneeHigh} day${kneeHigh > 1 ? "s" : ""} above 3/10` : "All at or below 3/10"} tone={kneeMax == null ? "neutral" : kneeHigh ? "bad" : "good"} />
      </div>

      {/* Charts */}
      <div className="grid gap-5 lg:grid-cols-2 lg:gap-6">
        <ChartCard
          className="lg:col-span-2"
          title="Weekly volume"
          sub="Kilometres run each week against the plan."
          legend={[{ label: "Actual km", color: C.s1 }, { label: "Planned km", color: C.target, dash: true }]}
          rows={weeks}
          cols={[
            { key: "w", label: "Week", get: (w) => w.code },
            { key: "s", label: "Starts", get: (w) => shortDate(w.start) },
            { key: "p", label: "Planned km", num: true, get: (w) => km(w.planned) },
            { key: "a", label: "Actual km", num: true, get: (w) => km(w.actual) },
            { key: "d", label: "Runs done", num: true, get: (w) => (w.past ? `${w.runsDone}/${w.runsDue}` : "–") },
          ]}
        >
          <ResponsiveContainer>
            <ComposedChart data={weeks} margin={{ top: 22, right: 8, left: -16, bottom: 0 }} barCategoryGap="22%">
              <CartesianGrid stroke={C.grid} vertical={false} />
              <XAxis dataKey="code" {...axis} tickFormatter={weekTick} interval="preserveStartEnd" />
              <YAxis {...axis} width={44} />
              {curCode && weeks.some((w) => w.code === curCode) && <ReferenceLine x={curCode} stroke="#cbd5e1" strokeDasharray="3 3" label={{ value: "This week", position: "top", fontSize: 10, fill: C.axis }} />}
              <Tooltip cursor={{ fill: "rgba(15,23,42,0.04)" }} content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const w = payload[0].payload as WeekRow;
                return <TipBox title={`Week ${w.code} · ${shortDate(w.start)}${w.deload ? " · deload" : ""}`} rows={[
                  { label: "Actual", value: `${km(w.actual)} km`, color: C.s1 },
                  { label: "Planned", value: `${km(w.planned)} km`, color: C.target, dash: true },
                  { label: "Runs done", value: w.past ? `${w.runsDone}/${w.runsDue}` : "–" },
                ]} />;
              }} />
              <Bar dataKey="actual" fill={C.s1} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
              <Line dataKey="planned" stroke={C.target} strokeWidth={2} strokeDasharray="5 4" dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Long-run progression"
          sub="Longest run each week. Stay under the orange line (30-day max + 10%)."
          legend={[{ label: "Your longest", color: C.s1 }, { label: "Planned long run", color: C.target, dash: true }, { label: "Safe cap", color: C.s2 }]}
          rows={weeks}
          cols={[
            { key: "w", label: "Week", get: (w) => w.code },
            { key: "p", label: "Planned km", num: true, get: (w) => km(w.longPlanned) },
            { key: "a", label: "Longest km", num: true, get: (w) => km(w.longActual) },
            { key: "c", label: "Cap km", num: true, get: (w) => km(w.cap) },
          ]}
        >
          <ResponsiveContainer>
            <LineChart data={weeks} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid stroke={C.grid} vertical={false} />
              <XAxis dataKey="code" {...axis} interval="preserveStartEnd" />
              <YAxis {...axis} width={44} />
              <Tooltip content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const w = payload[0].payload as WeekRow;
                return <TipBox title={`Week ${w.code}`} rows={[
                  { label: "Your longest", value: `${km(w.longActual)} km`, color: C.s1 },
                  { label: "Planned", value: `${km(w.longPlanned)} km`, color: C.target, dash: true },
                  { label: "Safe cap", value: `${km(w.cap)} km`, color: C.s2 },
                ]} />;
              }} />
              <Line dataKey="longPlanned" stroke={C.target} strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls isAnimationActive={false} />
              <Line dataKey="cap" stroke={C.s2} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
              <Line dataKey="longActual" stroke={C.s1} strokeWidth={2} dot={{ r: 4, fill: C.s1, stroke: "#fff", strokeWidth: 2 }} connectNulls isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Plan completion & run quality"
          sub="Share of due runs completed, and the average run score (both out of 100)."
          legend={[{ label: "Completed %", color: C.s1 }, { label: "Avg score", color: C.s2 }]}
          rows={pastWeeks}
          empty={pastWeeks.some((w) => w.runsDue) ? null : "Appears once your first runs are due."}
          cols={[
            { key: "w", label: "Week", get: (w) => w.code },
            { key: "d", label: "Completed", num: true, get: (w) => (w.runsDue ? `${Math.round((w.runsDone / w.runsDue) * 100)}%` : "–") },
            { key: "s", label: "Avg score", num: true, get: (w) => w.avgScore ?? "–" },
          ]}
        >
          <ResponsiveContainer>
            <ComposedChart data={pastWeeks.map((w) => ({ ...w, pct: w.runsDue ? Math.round((w.runsDone / w.runsDue) * 100) : null }))} margin={{ top: 8, right: 8, left: -16, bottom: 0 }} barCategoryGap="28%">
              <CartesianGrid stroke={C.grid} vertical={false} />
              <XAxis dataKey="code" {...axis} interval="preserveStartEnd" />
              <YAxis {...axis} width={44} domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} />
              <Tooltip cursor={{ fill: "rgba(15,23,42,0.04)" }} content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const w = payload[0].payload as WeekRow & { pct: number | null };
                return <TipBox title={`Week ${w.code}`} rows={[
                  { label: "Completed", value: w.pct != null ? `${w.pct}% (${w.runsDone}/${w.runsDue})` : "–", color: C.s1 },
                  { label: "Avg score", value: w.avgScore != null ? `${w.avgScore}/100` : "–", color: C.s2 },
                ]} />;
              }} />
              <Bar dataKey="pct" fill={C.s1} radius={[4, 4, 0, 0]} maxBarSize={26} isAnimationActive={false} />
              <Line dataKey="avgScore" stroke={C.s2} strokeWidth={2} dot={{ r: 4, fill: C.s2, stroke: "#fff", strokeWidth: 2 }} connectNulls isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Easy-run efficiency"
          sub="Average pace on easy runs at HR 145–155. Higher on the chart = faster = fitter."
          rows={pastWeeks.filter((w) => w.effPace != null)}
          empty={pastWeeks.some((w) => w.effPace != null) ? null : "Appears after easy runs with average HR 145–155 bpm."}
          cols={[{ key: "w", label: "Week", get: (w) => w.code }, { key: "p", label: "Pace /km", num: true, get: (w) => pace(w.effPace) }]}
        >
          <ResponsiveContainer>
            <LineChart data={pastWeeks.filter((w) => w.effPace != null)} margin={{ top: 8, right: 8, left: -4, bottom: 0 }}>
              <CartesianGrid stroke={C.grid} vertical={false} />
              <XAxis dataKey="code" {...axis} />
              <YAxis {...axis} width={48} reversed domain={["dataMin - 10", "dataMax + 10"]} tickFormatter={pace} />
              <Tooltip content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const w = payload[0].payload as WeekRow;
                return <TipBox title={`Week ${w.code}`} rows={[{ label: "Easy pace", value: `${pace(w.effPace)} /km`, color: C.s1 }]} />;
              }} />
              <Line dataKey="effPace" stroke={C.s1} strokeWidth={2} dot={{ r: 4, fill: C.s1, stroke: "#fff", strokeWidth: 2 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Strength: top set"
          sub="Heaviest working set per session."
          legend={[{ label: "Back squat", color: C.s1 }, { label: "Trap-bar deadlift", color: C.s2 }, { label: "Romanian deadlift", color: C.s3 }]}
          rows={strength}
          empty={strength.length ? null : "Log back squat, trap-bar deadlift or RDL sets to see this."}
          cols={[
            { key: "d", label: "Date", get: (r) => shortDate(r.date) },
            { key: "b", label: "Back squat kg", num: true, get: (r) => r.back_squat ?? "–" },
            { key: "t", label: "Trap-bar kg", num: true, get: (r) => r.trap_bar_dl ?? "–" },
            { key: "r", label: "RDL kg", num: true, get: (r) => r.rdl ?? "–" },
          ]}
        >
          <ResponsiveContainer>
            <LineChart data={strength} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid stroke={C.grid} vertical={false} />
              <XAxis dataKey="date" {...axis} tickFormatter={shortDate} />
              <YAxis {...axis} width={44} />
              <Tooltip content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const r = payload[0].payload as DashboardData["strength"][number];
                return <TipBox title={shortDate(r.date)} rows={[
                  { label: "Back squat", value: r.back_squat != null ? `${r.back_squat} kg` : "–", color: C.s1 },
                  { label: "Trap-bar deadlift", value: r.trap_bar_dl != null ? `${r.trap_bar_dl} kg` : "–", color: C.s2 },
                  { label: "Romanian deadlift", value: r.rdl != null ? `${r.rdl} kg` : "–", color: C.s3 },
                ]} />;
              }} />
              <Line dataKey="back_squat" stroke={C.s1} strokeWidth={2} dot={{ r: 4, fill: C.s1, stroke: "#fff", strokeWidth: 2 }} connectNulls isAnimationActive={false} />
              <Line dataKey="trap_bar_dl" stroke={C.s2} strokeWidth={2} dot={{ r: 4, fill: C.s2, stroke: "#fff", strokeWidth: 2 }} connectNulls isAnimationActive={false} />
              <Line dataKey="rdl" stroke={C.s3} strokeWidth={2} dot={{ r: 4, fill: C.s3, stroke: "#fff", strokeWidth: 2 }} connectNulls isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Knee pain"
          sub="Each logged score. Above the red line (3/10) the plan eases the next run."
          legend={[{ label: "Other days", color: C.s1, dot: true }, { label: "Long-run days", color: C.s2, dot: true }]}
          rows={knee}
          empty={knee.length ? null : "No knee scores yet. Log them after long runs."}
          cols={[{ key: "d", label: "Date", get: (k) => shortDate(k.date) }, { key: "k", label: "Knee /10", num: true, get: (k) => k.knee }, { key: "l", label: "Long run?", get: (k) => (k.long ? "Yes" : "–") }]}
        >
          <ResponsiveContainer>
            <ScatterChart margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid stroke={C.grid} vertical={false} />
              <XAxis dataKey="x" type="number" domain={["dataMin - 86400000", "dataMax + 86400000"]} {...axis} tickFormatter={(x) => shortDate(new Date(x).toISOString().slice(0, 10))} />
              <YAxis dataKey="knee" domain={[0, 10]} ticks={[0, 2, 4, 6, 8, 10]} {...axis} width={44} />
              <ZAxis range={[70, 70]} />
              <ReferenceLine y={3} stroke={C.critical} strokeDasharray="4 3" label={{ value: "Limit 3/10", position: "insideTopRight", fontSize: 10, fill: C.critical }} />
              <Tooltip content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const k = payload[0].payload as DashboardData["knee"][number];
                return <TipBox title={shortDate(k.date)} rows={[{ label: k.long ? "Knee (long-run day)" : "Knee", value: `${k.knee}/10`, color: k.long ? C.s2 : C.s1 }]} />;
              }} />
              <Scatter data={knee.filter((k) => !k.long)} fill={C.s1} stroke="#fff" strokeWidth={2} isAnimationActive={false} />
              <Scatter data={knee.filter((k) => k.long)} fill={C.s2} stroke="#fff" strokeWidth={2} isAnimationActive={false} />
            </ScatterChart>
          </ResponsiveContainer>
        </ChartCard>

        <section className="card-flush">
          <div className="px-4 pb-2 pt-4 lg:px-5"><h2 className="h2">Checkpoints</h2><p className="mt-0.5 text-xs text-muted">Results reset your pace zones.</p></div>
          <ul className="divide-y divide-line">
            {data.checkpoints.map((cp) => {
              const ok = cp.result_s != null && cp.target_s != null ? cp.result_s <= cp.target_s : cp.result_hr != null ? cp.result_hr < 165 : null;
              return (
                <li key={cp.id} className="flex items-center justify-between gap-3 px-4 py-3 lg:px-5">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold"><span className="mr-1.5 rounded bg-yellow-100 px-1.5 py-0.5 text-[11px] font-bold text-yellow-900">{cp.id}</span>{cp.test}</div>
                    <div className="mt-0.5 text-xs text-muted">{shortDate(cp.date)} · target {cp.on_track}</div>
                  </div>
                  <div className="text-right text-sm">
                    {cp.result_s != null ? <b className="tnum">{dur(cp.result_s)}</b> : cp.result_hr != null ? <b className="tnum">{Math.round(cp.result_hr)} bpm</b> : <span className="text-faint">–</span>}
                    {ok != null && <div className={`text-[11px] font-semibold ${ok ? "text-good-ink" : "text-amber-700"}`}>{ok ? "✓ on track" : "● off target"}</div>}
                  </div>
                </li>
              );
            })}
          </ul>
          <Link href="/checkpoints" className="block border-t border-line py-2.5 text-center text-xs font-semibold text-accent hover:bg-slate-50">Enter a result →</Link>
        </section>
      </div>

      {/* Tables */}
      <div>
        <section className="card-flush">
          <div className="flex items-baseline justify-between px-4 pb-2 pt-4 lg:px-5">
            <h2 className="h2">Runs</h2>
            <span className="text-xs text-muted">{runs.length} in range · tap a run for details</span>
          </div>
          <DataTable cols={runCols} rows={runs} max={12} />
        </section>
      </div>
    </div>
  );
}
