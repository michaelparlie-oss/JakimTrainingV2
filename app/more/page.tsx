import Link from "next/link";
import { getDb } from "@/db/client";
import { activeAlerts } from "@/lib/server/view";
import { logout } from "../actions";
import { PageTitle } from "../_c/ui";

export default async function More() {
  const n = (await activeAlerts(await getDb())).length;
  const links = [
    ["/alerts", "Alerts & suggestions", n ? `${n} open` : "All clear"],
    ["/log", "Log pain or illness", "Knee, bunion, RPE, fever"],
    ["/checkpoints", "Checkpoints", "Astra HM, 10K, HM trial, dress rehearsal"],
    ["/changes", "Plan changes", "Everything you moved, skipped or accepted (with undo)"],
    ["/library", "Exercise library", "How to do each exercise"],
    ["/settings", "Settings", "Strava, heart-rate zones, goal, export"],
  ];
  return (
    <>
      <PageTitle title="More" />
      <ul className="grid gap-2 lg:grid-cols-2">
        {links.map(([href, t, sub]) => (
          <li key={href}><Link href={href} className="card flex items-center justify-between"><span><b>{t}</b><span className="block text-sm text-muted">{sub}</span></span><span className="text-muted">›</span></Link></li>
        ))}
      </ul>
      <form action={logout} className="mt-6 text-center"><button className="text-sm font-semibold text-muted underline">Log out</button></form>
    </>
  );
}
