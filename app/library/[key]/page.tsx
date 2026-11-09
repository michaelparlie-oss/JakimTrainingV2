import { notFound } from "next/navigation";
import { loadPlan } from "@/lib/plan/load";
import { PageTitle } from "@/app/_c/ui";

export default async function ExercisePage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const e = loadPlan().exercises[key];
  if (!e) notFound();
  const Row = ({ k, v }: { k: string; v: string }) => (<div><dt className="label">{k}</dt><dd className="text-sm">{v}</dd></div>);
  return (
    <>
      <PageTitle title={e.name} sub={`${e.category} · ${e.equipment}`} back="/library" />
      <section className="card space-y-4">
        <p className="font-medium">{e.purpose}</p>
        <div><h2 className="label">How to do it</h2><ol className="mt-1 list-decimal space-y-1 pl-5 text-sm">{e.how.map((h, i) => <li key={i}>{h}</li>)}</ol></div>
        <div><h2 className="label">Cues to think about</h2><ul className="mt-1 list-disc space-y-1 pl-5 text-sm">{e.cues.map((h, i) => <li key={i}>{h}</li>)}</ul></div>
        <div><h2 className="label">Common mistakes</h2><ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-rose-800">{e.mistakes.map((h, i) => <li key={i}>{h}</li>)}</ul></div>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Row k="Starting load" v={e.start} />
          <Row k="How to progress" v={e.progress} />
          <Row k="Easier option" v={e.easier} />
          <Row k="Harder option" v={e.harder} />
        </dl>
      </section>
    </>
  );
}
