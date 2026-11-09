import Link from "next/link";
import { decide, dismissAlert } from "@/app/actions";
import type { AlertVM as A } from "@/lib/server/view";

const SEV: Record<string, string> = {
  stop: "border-rose-300 bg-rose-50 text-rose-950",
  warn: "border-amber-300 bg-amber-50 text-amber-950",
  info: "border-sky-200 bg-sky-50 text-sky-950",
};
const ICON: Record<string, string> = { stop: "⛔", warn: "⚠️", info: "ℹ️" };

export function AlertCard({ a, compact = false }: { a: A; compact?: boolean }) {
  return (
    <div className={`rounded-2xl border p-3 ${SEV[a.severity]}`}>
      <div className="flex items-start gap-2">
        <span aria-hidden>{ICON[a.severity]}</span>
        <p className="flex-1 text-sm font-medium">{a.message}</p>
        {!compact && (
          <form action={dismissAlert}>
            <input type="hidden" name="id" value={a.id} />
            <button className="text-xs font-semibold underline" aria-label="Dismiss">Dismiss</button>
          </form>
        )}
      </div>
      {a.proposal && (
        <div className="mt-3 rounded-xl bg-white/70 p-3">
          <p className="text-sm font-bold">{a.proposal.title}</p>
          <p className="mt-1 text-xs opacity-80">{a.proposal.rationale}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {a.proposal.options.map((o, i) => (
              <form key={i} action={decide}>
                <input type="hidden" name="proposal" value={a.proposal!.id} />
                <input type="hidden" name="option" value={i} />
                <button className={`btn ${i === 0 ? "btn-primary" : ""}`}>{o.label}</button>
              </form>
            ))}
          </div>
          <p className="mt-2 text-[11px] opacity-70">Nothing changes until you tap. You can undo any change under More → Plan changes.</p>
        </div>
      )}
    </div>
  );
}

export function AlertBanner({ alerts, max = 2 }: { alerts: A[]; max?: number }) {
  if (!alerts.length) return null;
  return (
    <section className="mb-4 space-y-2">
      {alerts.slice(0, max).map((a) => (
        <AlertCard key={a.id} a={a} />
      ))}
      {alerts.length > max && (
        <Link href="/alerts" className="block text-center text-sm font-semibold text-accent">
          {alerts.length - max} more alert{alerts.length - max > 1 ? "s" : ""} →
        </Link>
      )}
    </section>
  );
}
