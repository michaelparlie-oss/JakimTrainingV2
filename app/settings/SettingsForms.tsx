"use client";
import { useActionState } from "react";
import { changePasscode, saveHrZones } from "@/app/actions";

export function HrForm({ zones, custom }: { zones: { code: string; name: string; min: number | null; max: number | null }[]; custom: boolean }) {
  const [s, act, pending] = useActionState(saveHrZones, null);
  return (
    <form action={act} className="mt-2 space-y-1">
      {zones.map((z) => (
        <div key={z.code} className="grid grid-cols-[1fr_5rem_5rem] items-center gap-2">
          <span className="text-sm"><b>{z.code}</b> {z.name}</span>
          <input name={`${z.code}_min`} defaultValue={z.min ?? ""} placeholder="min" inputMode="numeric" className="input" />
          <input name={`${z.code}_max`} defaultValue={z.max ?? ""} placeholder="max" inputMode="numeric" className="input" />
        </div>
      ))}
      <div className="flex gap-2 pt-2">
        <button className="btn btn-primary" disabled={pending}>Save</button>
        {custom && <button className="btn" name="reset" value="1" disabled={pending}>Reset to plan</button>}
      </div>
      {s && <p className="text-sm text-emerald-700">{s.message}</p>}
    </form>
  );
}

export function PasscodeForm() {
  const [s, act, pending] = useActionState(changePasscode, null);
  return (
    <form action={act} className="mt-2 space-y-2">
      <input name="p1" type="password" placeholder="New passcode" className="input" autoComplete="new-password" />
      <input name="p2" type="password" placeholder="Repeat" className="input" autoComplete="new-password" />
      <button className="btn" disabled={pending}>Change passcode</button>
      {s && <p className={`text-sm ${s.ok ? "text-emerald-700" : "text-rose-700"}`}>{s.message}</p>}
    </form>
  );
}
