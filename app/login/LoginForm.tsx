"use client";
import { useActionState } from "react";
import { login } from "@/app/actions";

export function LoginForm({ next }: { next: string }) {
  const [s, act, pending] = useActionState(login, null);
  return (
    <form action={act} className="card space-y-3">
      <input type="hidden" name="next" value={next} />
      <label className="block"><span className="label">Passcode</span><input name="passcode" type="password" autoFocus autoComplete="current-password" className="input mt-1" /></label>
      <button className="btn btn-primary w-full" disabled={pending}>Unlock</button>
      {s && !s.ok && <p className="text-sm text-rose-700">{s.message}</p>}
    </form>
  );
}
