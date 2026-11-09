import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { loadPlan } from "@/lib/plan/load";
import { ctx, toVM } from "@/lib/server/view";
import { strengthPrefill, targetReps } from "@/lib/server/strength";
import { fmtDate, weekdayShort } from "@/lib/util/dates";
import { PageTitle } from "@/app/_c/ui";
import { StrengthLogger } from "./StrengthLogger";

export default async function StrengthPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await getDb();
  const c = await ctx(db);
  const raw = c.sessions.find((s) => s.id === id && s.category === "strength");
  if (!raw) notFound();
  const s = toVM(c, raw);
  const t = s.strength!;
  const pre = await strengthPrefill(db, id, t.items);
  const ex = loadPlan().exercises;
  return (
    <>
      <PageTitle title={t.name} back={`/?date=${s.date}`} sub={`${weekdayShort(s.date)} ${fmtDate(s.date)} · ${t.intent}`} />
      {t.deload_applied && <p className="mb-3 rounded-lg bg-violet-50 px-3 py-2 text-sm text-violet-900">Deload week: half the sets.</p>}
      <StrengthLogger
        sessionId={id}
        items={t.items.map((it, i) => ({
          key: it.exercise,
          name: it.exercise_name,
          sets: it.display_sets,
          reps: it.reps,
          target: targetReps(it.reps),
          rpe: it.rpe,
          rest_s: it.rest_s,
          note: it.note,
          progress: ex[it.exercise]?.progress ?? "",
          start: ex[it.exercise]?.start ?? "",
          pre: pre[i],
        }))}
      />
    </>
  );
}
