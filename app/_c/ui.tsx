import Link from "next/link";
import type { Segment, Zone, Zones } from "@/lib/plan/schema";
import { fmtHrRange, fmtKm, fmtPaceRange, fmtDuration } from "@/lib/util/format";
import { GLOSSARY } from "./glossary";
import { Tip } from "./Tip";

export function Explain({ term, children }: { term: keyof typeof GLOSSARY | string; children?: React.ReactNode }) {
  const text = GLOSSARY[term];
  if (!text) return <>{children ?? term}</>;
  return (
    <Tip label={children ?? term} className="underline decoration-dotted decoration-muted underline-offset-2">
      {text}
    </Tip>
  );
}

const ZONE_COLORS: Record<string, string> = {
  E: "bg-emerald-100 text-emerald-800", L: "bg-emerald-100 text-emerald-800", REC: "bg-slate-100 text-slate-700",
  MP: "bg-sky-100 text-sky-800", HMP: "bg-indigo-100 text-indigo-800", T: "bg-amber-100 text-amber-800",
  I: "bg-orange-100 text-orange-800", ST: "bg-fuchsia-100 text-fuchsia-800", H: "bg-rose-100 text-rose-800", RACE: "bg-yellow-100 text-yellow-900",
};

export function ZoneChip({ zone }: { zone: Zone }) {
  const pace = fmtPaceRange(zone.pace_min_s_per_km, zone.pace_max_s_per_km);
  const hr = fmtHrRange(zone.hr_min, zone.hr_max);
  return (
    <Tip
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${ZONE_COLORS[zone.code] ?? ""}`}
      label={<>{zone.code} <span className="font-medium">{zone.name}</span> ⓘ</>}
    >
        <b>{zone.name}.</b> {zone.feel}
        {pace && <span className="mt-1 block">Pace: {pace}</span>}
        {hr && <span className="block">Heart rate: {hr}</span>}
        <span className="mt-1 block text-muted">Main target: {zone.primary_target === "HR" ? "heart rate" : zone.primary_target === "pace" ? "pace (HR is a ceiling)" : zone.primary_target === "feel" ? "effort/feel" : "the race plan"}</span>
    </Tip>
  );
}

const SEG_LABEL: Record<Segment["kind"], string> = { warmup: "Warm-up", work: "Work", cooldown: "Cool-down", steady: "Run", strides: "Strides", race: "Race" };

export function segLen(s: Segment) {
  return s.distance_km != null ? fmtKm(s.distance_km) : fmtDuration(s.duration_s!);
}

export function SegmentList({ segments, zones }: { segments: Segment[]; zones: Zones }) {
  return (
    <ol className="mt-3 space-y-2">
      {segments.map((s, i) => {
        const z = zones[s.zone];
        const pace = fmtPaceRange(z.pace_min_s_per_km, z.pace_max_s_per_km);
        const hr = fmtHrRange(z.hr_min, z.hr_max);
        return (
          <li key={i} className="rounded-xl bg-slate-50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold">
                {SEG_LABEL[s.kind]}: {s.repeat > 1 ? `${s.repeat} × ` : ""}
                {segLen(s)}
              </span>
              <ZoneChip zone={z} />
            </div>
            <div className="mt-1 text-sm">
              {pace && <span className="mr-3">⏱ {pace}</span>}
              {hr && <span>♥ {hr}</span>}
              {!pace && !hr && <span className="text-muted">{z.feel}</span>}
            </div>
            {s.recovery && (
              <div className="mt-1 text-xs text-muted">
                Between reps: <Explain term="recovery">{fmtDuration(s.recovery.duration_s)} {zones[s.recovery.zone].name.toLowerCase()}</Explain>
                {zones[s.recovery.zone].hr_max ? ` (HR under ${zones[s.recovery.zone].hr_max})` : ""}
              </div>
            )}
            {s.note && <div className="mt-1 text-xs text-muted">{s.note}</div>}
          </li>
        );
      })}
    </ol>
  );
}

export function TargetBadge({ kind }: { kind: string | null }) {
  const hr = kind === "easy" || kind === "long";
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-bold ${hr ? "bg-emerald-600 text-white" : "bg-indigo-600 text-white"}`}>
      <Explain term={hr ? "HR" : "quality"}>{hr ? "Today HR wins: keep it easy" : "Today pace wins: HR is a ceiling"}</Explain>
    </span>
  );
}

const STATUS: Record<string, [string, string]> = {
  done: ["Done", "bg-emerald-100 text-emerald-800"],
  partial: ["Partly done", "bg-amber-100 text-amber-800"],
  moved: ["Done (other day)", "bg-sky-100 text-sky-800"],
  missed: ["Missed", "bg-rose-100 text-rose-800"],
  skipped: ["Skipped", "bg-slate-200 text-slate-700"],
  pending: ["Planned", "bg-slate-100 text-slate-600"],
};
export function StatusPill({ status }: { status: string }) {
  const [l, c] = STATUS[status] ?? [status, "bg-slate-100"];
  return <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${c}`}>{l}</span>;
}

export function ScoreRing({ score, label, size = 64 }: { score: number | null; label: string; size?: number }) {
  if (score == null) return null;
  const v = Math.max(0, Math.min(100, Math.round(score)));
  const r = (size - 8) / 2, c = 2 * Math.PI * r;
  const col = v >= 80 ? "var(--color-good)" : v >= 50 ? "var(--color-warn)" : "var(--color-critical)";
  const word = v >= 80 ? "good" : v >= 50 ? "fair" : "low";
  return (
    <div className="flex flex-col items-center gap-1" title={`${label}: ${v}/100 (${word})`}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#eef0f3" strokeWidth={6} />
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={col} strokeWidth={6} strokeLinecap="round" strokeDasharray={`${(v / 100) * c} ${c}`} />
        </svg>
        <span className="absolute inset-0 grid place-items-center text-base font-extrabold tnum">{v}</span>
      </div>
      <span className="text-[11px] font-medium text-muted">{label}</span>
    </div>
  );
}

export function PageTitle({ title, sub, back, actions }: { title: string; sub?: React.ReactNode; back?: string; actions?: React.ReactNode }) {
  return (
    <header className="mb-5 lg:mb-7">
      {back && <Link href={back} className="mb-1 inline-block text-sm font-semibold text-accent hover:underline">← Back</Link>}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold tracking-tight lg:text-3xl">{title}</h1>
          {sub && <div className="mt-0.5 text-sm text-muted">{sub}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

/** Card with a header row (title, optional subtitle and right-side controls). */
export function Panel({ title, sub, right, children, className = "", flush = false }: { title?: React.ReactNode; sub?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string; flush?: boolean }) {
  return (
    <section className={`${flush ? "card-flush" : "card"} ${className}`}>
      {(title || right) && (
        <div className={`flex flex-wrap items-start justify-between gap-2 ${flush ? "px-4 pt-4 lg:px-5 lg:pt-5" : ""} mb-3`}>
          <div className="min-w-0">
            {title && <h2 className="h2">{title}</h2>}
            {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
          </div>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

/** Headline metric. `delta` text is always written out (never colour alone). */
export function Kpi({ label, value, unit, sub, tone = "neutral", hint }: { label: string; value: React.ReactNode; unit?: string; sub?: React.ReactNode; tone?: "neutral" | "good" | "warn" | "bad"; hint?: string }) {
  const toneCls = { neutral: "text-muted", good: "text-good-ink", warn: "text-amber-700", bad: "text-red-700" }[tone];
  const icon = { neutral: "", good: "▲ ", warn: "● ", bad: "▼ " }[tone];
  return (
    <div className="card flex flex-col gap-1" title={hint}>
      <div className="label">{label}</div>
      <div className="text-2xl font-extrabold tracking-tight lg:text-[1.7rem]">
        {value}
        {unit && <span className="ml-1 text-sm font-semibold text-muted">{unit}</span>}
      </div>
      {sub && <div className={`text-xs font-medium ${toneCls}`}>{icon}{sub}</div>}
    </div>
  );
}

export function Bar({ value, max, className = "" }: { value: number; max: number; className?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className={`h-2 overflow-hidden rounded-full bg-slate-100 ${className}`} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-series-1" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Badge({ children, tone = "slate" }: { children: React.ReactNode; tone?: "slate" | "violet" | "yellow" | "sky" | "amber" | "teal" | "rose" }) {
  const cls = {
    slate: "bg-slate-100 text-slate-700", violet: "bg-violet-100 text-violet-800", yellow: "bg-yellow-100 text-yellow-900",
    sky: "bg-sky-100 text-sky-900", amber: "bg-amber-100 text-amber-900", teal: "bg-teal-50 text-teal-800", rose: "bg-rose-100 text-rose-800",
  }[tone];
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold ${cls}`}>{children}</span>;
}

export function OverrideNote({ reason, source }: { reason: string; source: string }) {
  return (
    <div className="mt-2 rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900">
      <b>{source === "adaptation" ? "Adjusted (you accepted a suggestion):" : "Changed by you:"}</b> {reason}
    </div>
  );
}
