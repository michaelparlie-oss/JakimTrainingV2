"use client";
import Link from "next/link";
import { useActionState, useState } from "react";
import { saveStrength } from "@/app/actions";
import type { Prefill } from "@/lib/server/strength";

interface Item { key: string; name: string; sets: number; reps: string; target: number | null; rpe: number | null; rest_s: number; note: string; progress: string; start: string; pre: Prefill }

function SetRow({ item, n }: { item: Item; n: number }) {
  const cur = item.pre.current.find((c) => c.set_no === n);
  const [w, setW] = useState<number | null>(cur?.weight_kg ?? item.pre.last_weight);
  const [r, setR] = useState<number | null>(cur?.reps ?? item.target);
  const [p, setP] = useState<number | null>(cur?.rpe ?? null);
  const [done, setDone] = useState(!!cur);
  const step = (d: number) => setW((x) => Math.max(0, Math.round(((x ?? 0) + d) * 10) / 10));
  return (
    <div className={`grid grid-cols-[2rem_1fr_auto] items-center gap-2 border-t border-line py-2 ${done ? "bg-emerald-50/50" : ""}`}>
      <label className="flex flex-col items-center text-xs">
        <input type="checkbox" name={`d|${item.key}|${n}`} checked={done} onChange={(e) => setDone(e.target.checked)} className="h-5 w-5 accent-teal-700" />
        {n}
      </label>
      <div className="flex items-center gap-1">
        <button type="button" className="btn px-2" onClick={() => step(-2.5)} aria-label="−2.5 kg">−</button>
        <input name={`w|${item.key}|${n}`} value={w ?? ""} onChange={(e) => setW(e.target.value === "" ? null : Number(e.target.value))} inputMode="decimal" className="input w-16 text-center" placeholder="kg" />
        <button type="button" className="btn px-2" onClick={() => step(2.5)} aria-label="+2.5 kg">+</button>
        <span className="text-xs text-muted">kg</span>
      </div>
      <div className="flex items-center gap-1">
        <select name={`r|${item.key}|${n}`} value={r ?? ""} onChange={(e) => setR(e.target.value === "" ? null : Number(e.target.value))} className="input w-16 px-1" aria-label="Reps">
          <option value="">reps</option>
          {Array.from({ length: 30 }, (_, i) => i + 1).map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <select name={`p|${item.key}|${n}`} value={p ?? ""} onChange={(e) => setP(e.target.value === "" ? null : Number(e.target.value))} className="input w-16 px-1" aria-label="RPE">
          <option value="">RPE</option>
          {[5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10].map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
      </div>
    </div>
  );
}

export function StrengthLogger({ sessionId, items }: { sessionId: string; items: Item[] }) {
  const [s, act, pending] = useActionState(saveStrength, null);
  return (
    <form action={act} className="space-y-3">
      <input type="hidden" name="session" value={sessionId} />
      <p className="text-xs text-muted">Tick each set when done. Weight is pre-filled from last time; ± changes it by 2.5 kg. RPE 7 = about 3 reps left in the tank, 8 = about 2.</p>
      {items.map((it) => (
        <section key={it.key} className="card">
          <div className="flex items-baseline justify-between gap-2">
            <Link href={`/library/${it.key}`} className="font-bold text-accent">{it.name}</Link>
            <span className="whitespace-nowrap text-sm">{it.sets} × {it.reps}{it.rpe ? ` @ RPE ${it.rpe}` : ""}</span>
          </div>
          <p className="text-xs text-muted">Rest {it.rest_s ? `${it.rest_s} s` : "none"}{it.note ? ` · ${it.note}` : ""}</p>
          {it.pre.ready_to_progress && <p className="mt-1 rounded-lg bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-900">Ready to progress (+2.5–5 kg). {it.progress}</p>}
          {!it.pre.last_weight && <p className="mt-1 text-xs text-muted">First time? Start: {it.start}</p>}
          {it.target == null && <p className="mt-1 text-xs text-muted">Timed or distance-based: tick when done; reps optional.</p>}
          <div className="mt-2">
            {Array.from({ length: it.sets }, (_, i) => <SetRow key={i} item={it} n={i + 1} />)}
          </div>
        </section>
      ))}
      <div className="sticky bottom-20 z-10">
        <button className="btn btn-primary w-full shadow-lg" disabled={pending}>{pending ? "Saving…" : "Save session"}</button>
        {s && <p className={`mt-1 rounded-lg bg-white px-2 py-1 text-center text-sm ${s.ok ? "text-emerald-700" : "text-rose-700"}`}>{s.message}</p>}
      </div>
    </form>
  );
}
