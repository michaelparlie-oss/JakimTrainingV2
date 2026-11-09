"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ICONS, Icon } from "./nav";

const main = [
  { href: "/", label: "Today", icon: ICONS.today },
  { href: "/week", label: "Week", icon: ICONS.week },
  { href: "/plan", label: "Plan", icon: ICONS.plan },
  { href: "/progress", label: "Progress", icon: ICONS.progress },
];
const secondary = [
  { href: "/checkpoints", label: "Checkpoints", icon: ICONS.checkpoints },
  { href: "/alerts", label: "Alerts", icon: ICONS.alerts },
  { href: "/log", label: "Pain & illness", icon: ICONS.log },
  { href: "/changes", label: "Plan changes", icon: ICONS.changes },
  { href: "/library", label: "Exercise library", icon: ICONS.library },
  { href: "/settings", label: "Settings", icon: ICONS.settings },
];

function useActive() {
  const p = usePathname();
  return (h: string) => (h === "/" ? p === "/" : p === h || p.startsWith(`${h}/`) || (h === "/week" && p.startsWith("/session")) || (h === "/week" && p.startsWith("/strength")));
}

/** Phone: bottom tab bar. */
export function BottomNav() {
  const p = usePathname();
  const active = useActive();
  if (p === "/login") return null;
  const more = /^\/(more|alerts|checkpoints|library|settings|log|changes)/.test(p);
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
      <ul className="mx-auto grid max-w-xl grid-cols-5">
        {[...main, { href: "/more", label: "More", icon: ICONS.more }].map((i) => {
          const on = i.href === "/more" ? more : active(i.href);
          return (
            <li key={i.href}>
              <Link href={i.href} className={`flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold ${on ? "text-accent" : "text-muted"}`}>
                <Icon d={i.icon} className="h-6 w-6" />
                {i.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Desktop: fixed left sidebar. */
export function Sidebar({ alerts, daysToRace, raceLabel }: { alerts: number; daysToRace: number; raceLabel: string }) {
  const p = usePathname();
  const active = useActive();
  if (p === "/login") return null;
  const Item = ({ href, label, icon, badge }: { href: string; label: string; icon: string; badge?: number }) => (
    <Link href={href} className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${active(href) ? "bg-accent-soft text-accent-strong" : "text-ink-2 hover:bg-slate-100 hover:text-ink"}`}>
      <Icon d={icon} />
      <span className="flex-1">{label}</span>
      {badge ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-900">{badge}</span> : null}
    </Link>
  );
  return (
    <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col border-r border-line bg-white lg:flex">
      <div className="flex items-center gap-3 px-5 py-5">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-accent text-sm font-extrabold text-white">42</div>
        <div>
          <div className="text-sm font-extrabold leading-tight">JAKIM 2027</div>
          <div className="text-xs text-muted">Training tracker</div>
        </div>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3">
        <div className="label px-3 pb-1 pt-2">Training</div>
        {main.map((i) => <Item key={i.href} {...i} />)}
        <div className="label px-3 pb-1 pt-5">Manage</div>
        {secondary.map((i) => <Item key={i.href} {...i} badge={i.href === "/alerts" ? alerts : undefined} />)}
      </nav>
      {daysToRace >= 0 && (
        <div className="m-3 rounded-xl bg-gradient-to-br from-teal-700 to-teal-900 p-4 text-white">
          <div className="text-xs font-semibold uppercase tracking-wider text-teal-100">Race day</div>
          <div className="mt-1 text-3xl font-extrabold tnum">{daysToRace}<span className="ml-1 text-sm font-semibold text-teal-100">days</span></div>
          <div className="text-xs text-teal-100">{raceLabel}</div>
        </div>
      )}
    </aside>
  );
}
