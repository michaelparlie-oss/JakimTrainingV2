"use client";
import { useEffect, useRef, useState } from "react";

/** Tap-to-explain popover. Valid inside <p> (unlike <details>), closes on outside tap. */
export function Tip({ label, children, className = "" }: { label: React.ReactNode; children: React.ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", h);
    return () => document.removeEventListener("pointerdown", h);
  }, [open]);
  return (
    <span ref={ref} className="relative inline-block">
      <button type="button" aria-expanded={open} onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o); }} className={className}>
        {label}
      </button>
      {open && (
        <span role="tooltip" className="absolute left-0 z-30 mt-1 block w-64 rounded-lg border border-line bg-white p-3 text-left text-xs font-normal normal-case tracking-normal text-ink shadow-lg">
          {children}
        </span>
      )}
    </span>
  );
}
