"use client";
import Link from "next/link";
import { useState } from "react";

export function LibrarySearch({ list }: { list: { key: string; name: string; category: string; purpose: string; equipment: string }[] }) {
  const [q, setQ] = useState("");
  const f = list.filter((x) => `${x.name} ${x.category} ${x.purpose} ${x.equipment}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search: squat, calf, knee…" className="input mb-3" />
      <ul className="space-y-2">
        {f.map((x) => (
          <li key={x.key}>
            <Link href={`/library/${x.key}`} className="card block">
              <div className="flex items-baseline justify-between gap-2"><span className="font-bold">{x.name}</span><span className="label">{x.category}</span></div>
              <p className="text-sm text-muted">{x.purpose}</p>
            </Link>
          </li>
        ))}
        {!f.length && <li className="text-center text-sm text-muted">No exercise matches “{q}”.</li>}
      </ul>
    </>
  );
}
