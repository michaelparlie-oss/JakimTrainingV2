import Link from "next/link";
import type { SessionVM } from "@/lib/server/view";
import { fmtDuration, fmtKm, fmtPace } from "@/lib/util/format";
import { fmtDate, weekdayShort } from "@/lib/util/dates";
import { Explain, OverrideNote, ScoreRing, SegmentList, StatusPill, TargetBadge } from "./ui";
import { PainLogForm } from "./Forms";

export function ZoneBasis({ label }: { label: string }) {
  return <p className="mt-2 text-xs text-muted">Paces based on: {label.replace(/^Current: /, "")}</p>;
}

export function RunCard({ s, today, painLogged }: { s: SessionVM; today: string; painLogged?: boolean }) {
  const st = s.match?.status ?? "pending";
  const a = s.activity;
  return (
    <article className={`card ${s.skipped ? "opacity-60" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="label">{s.slot} run · {s.kind === "long" ? <Explain term="long run">long run</Explain> : s.kind === "quality" ? <Explain term="quality">quality</Explain> : s.kind}{s.optional ? " · optional" : ""}</div>
          <h2 className="mt-0.5 text-lg font-bold leading-snug">{s.title}</h2>
        </div>
        <StatusPill status={s.skipped ? "skipped" : st} />
      </div>
      <div className="mt-1 text-sm text-muted">
        {fmtKm(s.distance_km)} · about {s.est_duration_min ?? "?"} min · <Explain term="RPE">RPE</Explain> {s.rpe_text}
      </div>
      <div className="mt-2"><TargetBadge kind={s.kind} /></div>
      {s.override && <OverrideNote reason={s.override.reason} source={s.override.source} />}
      {s.spike && !a && (
        <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          ⚠️ <Explain term="spike">{s.spike.pct_over}% longer</Explain> than your longest run in the last 30 days ({fmtKm(s.spike.max30)}). Consider capping at {s.spike.cap_km.toFixed(1)} km.
        </div>
      )}
      <SegmentList segments={s.segments} zones={s.zonesR.zones} />
      {s.summary && s.summary !== s.title && <p className="mt-2 text-sm">{s.summary}</p>}
      <ZoneBasis label={s.zonesR.label} />

      {a && s.match && (
        <div className="mt-3 rounded-xl border border-line p-3">
          <div className="flex items-center justify-between">
            <div className="text-sm">
              <b>{fmtKm(a.distance_m / 1000)}</b> in {fmtDuration(a.moving_time_s)} · {fmtPace(a.moving_time_s / (a.distance_m / 1000))} /km
              {a.avg_hr ? ` · ♥ ${Math.round(a.avg_hr)} bpm` : " · no HR data"}
              {a.local_date !== s.date && <span className="block text-xs text-muted">Run on {weekdayShort(a.local_date)} {fmtDate(a.local_date)}</span>}
            </div>
            <div className="flex gap-3">
              <ScoreRing score={s.match.overall_score} label="score" />
            </div>
          </div>
          {s.match.verdict && <p className="mt-2 text-sm font-medium">{s.match.verdict}</p>}
          {s.details?.flags.map((f, i) => <p key={i} className="mt-1 text-xs text-amber-800">• {f}</p>)}
        </div>
      )}
      {a && s.post_run_log.length > 0 && !painLogged && (
        <div className="mt-3 rounded-xl bg-amber-50 p-3">
          <p className="text-sm font-semibold">Log your knee and bunion score for this run</p>
          <p className="text-xs text-muted">Or add a line like “knee 2 bunion 1 rpe 5 carbs 60” to the Strava description.</p>
          <PainLogForm date={a.local_date} activityId={a.id} compact />
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Link href={`/session/${s.id}`} className="btn">Details & change</Link>
        {st === "pending" && s.date === today && !s.skipped && <span className="self-center text-xs text-muted">Syncs from Strava after your run.</span>}
      </div>
    </article>
  );
}

export function StrengthCard({ s }: { s: SessionVM }) {
  const t = s.strength!;
  return (
    <article className={`card ${s.skipped ? "opacity-60" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="label">{s.slot} strength · {t.minutes} min</div>
          <h2 className="mt-0.5 text-lg font-bold">{t.name}</h2>
        </div>
        {s.skipped && <StatusPill status="skipped" />}
      </div>
      <p className="mt-1 text-sm text-muted">{t.intent}</p>
      {t.deload_applied && (
        <p className="mt-2 rounded-lg bg-violet-50 px-3 py-2 text-xs text-violet-900">
          <Explain term="deload">Deload week</Explain>: half the sets (shown below).
        </p>
      )}
      {s.override && <OverrideNote reason={s.override.reason} source={s.override.source} />}
      <ul className="mt-3 divide-y divide-line">
        {t.items.map((it, i) => (
          <li key={i} className="py-2">
            <Link href={`/library/${it.exercise}`} className="flex items-baseline justify-between gap-2">
              <span className="font-semibold text-accent">{it.exercise_name}</span>
              <span className="whitespace-nowrap text-sm">
                {it.display_sets} × {it.reps}
                {it.halved && <s className="ml-1 text-xs text-muted">{it.sets}</s>}
              </span>
            </Link>
            <div className="text-xs text-muted">
              {it.rest_s ? `Rest ${it.rest_s >= 60 ? `${it.rest_s / 60} min` : `${it.rest_s} s`}` : "No rest needed"}
              {it.rpe ? ` · RPE ${it.rpe}` : ""}
              {it.note ? ` · ${it.note}` : ""}
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex gap-2">
        <Link href={`/strength/${s.id}`} className="btn btn-primary">Start logging</Link>
        <Link href={`/session/${s.id}`} className="btn">Move or skip</Link>
      </div>
    </article>
  );
}

export function SimpleCard({ s }: { s: SessionVM }) {
  return (
    <article className={`card ${s.skipped ? "opacity-60" : ""}`}>
      <div className="label">{s.slot} · {s.category === "martial_arts" ? "optional martial arts" : s.category}</div>
      <h2 className="mt-0.5 font-bold">{s.title}</h2>
      {s.est_duration_min ? <p className="text-sm text-muted">{s.est_duration_min} min. Display only: never counts as missed.</p> : null}
    </article>
  );
}
