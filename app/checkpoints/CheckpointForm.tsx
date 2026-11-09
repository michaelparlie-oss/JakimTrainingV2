"use client";
import { useActionState, useState } from "react";
import { checkpoint } from "@/app/actions";

const fmt = (s: number) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

export function CheckpointForm({ cp, kind, candidates, hasResult }: { cp: string; kind: "time" | "hr"; candidates: { id: number; label: string; time: number }[]; hasResult: boolean }) {
  const [s, act, pending] = useActionState(checkpoint, null);
  const [time, setTime] = useState("");
  const [open, setOpen] = useState(!hasResult);
  if (!open) return <button className="mt-2 text-sm font-semibold text-accent underline" onClick={() => setOpen(true)}>Enter a new result</button>;
  return (
    <form action={act} className="mt-3 space-y-2">
      <input type="hidden" name="cp" value={cp} />
      {s && "needsConfirm" in s && s.needsConfirm && <input type="hidden" name="confirm" value="1" />}
      {candidates.length > 0 && (
        <label className="block"><span className="label">Strava run (optional)</span>
          <select name="activity" className="input mt-1" onChange={(e) => { const c = candidates.find((x) => String(x.id) === e.target.value); if (c && kind === "time") setTime(fmt(c.time)); }}>
            <option value="">–</option>
            {candidates.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
      )}
      {kind === "time" ? (
        <label className="block"><span className="label">Finish time (h:mm:ss)</span><input name="time" value={time} onChange={(e) => setTime(e.target.value)} placeholder="1:06:30" className="input mt-1" inputMode="numeric" /></label>
      ) : (
        <label className="block"><span className="label">Average HR on the MP part (bpm)</span><input name="avg_hr" type="number" placeholder="leave empty to read it from the linked run" className="input mt-1" /></label>
      )}
      {kind === "time" && <p className="text-xs text-muted">Use the official or watch time for the test distance itself (for a time trial, not including warm-up).</p>}
      <button className={`btn w-full ${s && "needsConfirm" in s && s.needsConfirm ? "btn-danger" : "btn-primary"}`} disabled={pending}>{s && "needsConfirm" in s && s.needsConfirm ? "Yes, save anyway" : "Save result"}</button>
      {s && <p className={`text-sm ${s.ok ? "text-emerald-700" : "text-rose-700"}`}>{s.message}</p>}
    </form>
  );
}
