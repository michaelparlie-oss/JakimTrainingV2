"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { syncNow } from "@/app/actions";

/** Calls the resumable sync step until Strava is up to date (each step stays under the serverless time limit). */
async function runSync(onStep: (msg: string) => void) {
  for (let i = 0; i < 12; i++) {
    const r = await syncNow();
    onStep(r.message);
    if (r.status !== "partial") return r;
  }
}

export function SyncButton({ label = "Sync now" }: { label?: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-center gap-1">
      <button className="btn" disabled={pending} onClick={() => start(async () => { await runSync(setMsg); })}>
        {pending ? "Syncing with Strava…" : label}
      </button>
      {msg && <p className="text-center text-xs text-muted">{msg}</p>}
    </div>
  );
}

/** Auto-sync on app open when the last sync is > 30 min old (decided on the server). */
export function AutoSync({ enabled }: { enabled: boolean }) {
  const ran = useRef(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled || ran.current) return;
    ran.current = true;
    setMsg("Checking Strava for new runs…");
    runSync(setMsg).then(() => setTimeout(() => setMsg(null), 4000)).catch(() => setMsg(null));
  }, [enabled]);
  return msg ? <p className="mb-2 rounded-lg bg-white px-3 py-1 text-center text-xs text-muted">{msg}</p> : null;
}
