"use client";
import { useActionState, useState } from "react";
import { adjustSession, logWellbeing, undo, type ActionState } from "@/app/actions";

function Msg({ s }: { s: ActionState }) {
  if (!s) return null;
  return <p className={`mt-2 text-sm font-medium ${s.ok ? "text-emerald-700" : "text-rose-700"}`}>{s.message}</p>;
}

function Scale({ name, label, min = 0, max = 10 }: { name: string; label: string; min?: number; max?: number }) {
  const [v, setV] = useState<number | null>(null);
  return (
    <fieldset className="mt-2">
      <legend className="label">{label}{v != null ? `: ${v}` : ""}</legend>
      <input type="hidden" name={name} value={v ?? ""} />
      <div className="mt-1 grid grid-cols-11 gap-1">
        {Array.from({ length: max - min + 1 }, (_, i) => i + min).map((n) => (
          <button type="button" key={n} onClick={() => setV(n)} className={`h-9 rounded-md border text-sm font-semibold ${v === n ? (n > 3 && name !== "rpe" ? "border-rose-600 bg-rose-600 text-white" : "border-accent bg-accent text-white") : "border-line bg-white"}`}>
            {n}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function PainLogForm({ date, activityId, compact = false }: { date: string; activityId?: number; compact?: boolean }) {
  const [s, act, pending] = useActionState(logWellbeing, null);
  if (s?.ok) return <Msg s={s} />;
  return (
    <form action={act} className="mt-2">
      <input type="hidden" name="date" value={date} />
      {activityId && <input type="hidden" name="activity" value={activityId} />}
      <Scale name="knee" label="Knee pain (0 = none, 10 = worst)" />
      <Scale name="bunion" label="Bunion pain" />
      {!compact && (
        <>
          <Scale name="rpe" label="How hard was it (RPE 1–10)" min={1} max={10} />
          <label className="mt-2 block"><span className="label">Carbs eaten during the run (g)</span><input name="carbs" type="number" inputMode="numeric" className="input mt-1" /></label>
          <label className="mt-2 block"><span className="label">Note</span><input name="note" className="input mt-1" placeholder="e.g. limping next morning?" /></label>
        </>
      )}
      <button className="btn btn-primary mt-3 w-full" disabled={pending}>Save</button>
      <Msg s={s} />
    </form>
  );
}

export function AdjustPanel({ id, date, category, skipped, distanceKm, hasOverride, minDate, maxDate }: { id: string; date: string; category: string; skipped: boolean; distanceKm: number | null; hasOverride: boolean; minDate: string; maxDate: string }) {
  const [s, act, pending] = useActionState(adjustSession, null);
  return (
    <section className="card mt-4">
      <h2 className="h2">Change this session</h2>
      <p className="text-xs text-muted">Life happens. Changes apply only to this plan; the JSON plan stays as written and you can undo any change. The app re-checks the rest of your plan after every change.</p>
      <form action={act} className="mt-3 flex items-end gap-2">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="op" value="move" />
        <label className="flex-1"><span className="label">Move to</span><input type="date" name="date" defaultValue={date} min={minDate} max={maxDate} className="input mt-1" /></label>
        <button className="btn" disabled={pending}>Move</button>
      </form>
      <p className="mt-1 text-[11px] text-muted">If another {category === "run" ? "run" : "session"} is already on that day, the two swap.</p>
      {category === "run" && distanceKm && (
        <form action={act} className="mt-3 flex items-end gap-2">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="op" value="cap" />
          <label className="flex-1"><span className="label">Shorten to (km)</span><input type="number" step="0.5" min="1" max={distanceKm} name="km" defaultValue={distanceKm} className="input mt-1" /></label>
          <button className="btn" disabled={pending}>Shorten</button>
        </form>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {category === "run" && (
          <form action={act}>
            <input type="hidden" name="id" value={id} /><input type="hidden" name="op" value="easy30" /><input type="hidden" name="minutes" value="30" />
            <button className="btn" disabled={pending}>Make it 30 min easy</button>
          </form>
        )}
        <form action={act}>
          <input type="hidden" name="id" value={id} /><input type="hidden" name="op" value={skipped ? "unskip" : "skip"} />
          <button className="btn" disabled={pending}>{skipped ? "Un-skip" : "Skip (can't make it)"}</button>
        </form>
        {hasOverride && (
          <form action={act}>
            <input type="hidden" name="id" value={id} /><input type="hidden" name="op" value="reset" />
            <button className="btn" disabled={pending}>Back to the plan as written</button>
          </form>
        )}
      </div>
      <Msg s={s} />
      {s?.ok && s.changeId && (
        <form action={undo} className="mt-1">
          <input type="hidden" name="id" value={s.changeId} />
          <button className="text-sm font-semibold text-accent underline">Undo</button>
        </form>
      )}
      <p className="mt-2 text-[11px] text-muted">Skipped a run? Carry on as written: don't make it up later (plan rule: never double up).</p>
    </section>
  );
}
