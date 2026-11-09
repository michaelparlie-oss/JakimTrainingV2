"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "Today", icon: "M3 12l9-8 9 8M5 10v10h14V10" },
  { href: "/week", label: "Week", icon: "M4 6h16M4 12h16M4 18h16" },
  { href: "/plan", label: "Plan", icon: "M5 4h14v16H5zM9 8h6M9 12h6M9 16h4" },
  { href: "/progress", label: "Progress", icon: "M4 20V10M10 20V4M16 20v-7M22 20H2" },
  { href: "/more", label: "More", icon: "M5 12h.01M12 12h.01M19 12h.01" },
];

export function BottomNav() {
  const p = usePathname();
  if (p === "/login") return null;
  const active = (h: string) => (h === "/" ? p === "/" : p.startsWith(h) || (h === "/more" && /^\/(alerts|checkpoints|library|settings|log|changes)/.test(p)));
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-white/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
      <ul className="mx-auto grid max-w-xl grid-cols-5">
        {items.map((i) => (
          <li key={i.href}>
            <Link href={i.href} className={`flex flex-col items-center gap-0.5 py-2 text-xs font-semibold ${active(i.href) ? "text-accent" : "text-muted"}`}>
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d={i.icon} /></svg>
              {i.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
