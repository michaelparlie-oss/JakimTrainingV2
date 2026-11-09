import { formatInTimeZone } from "date-fns-tz";

export const TZ = "Asia/Jakarta";

/** Today's plan day (local date in Asia/Jakarta). APP_TODAY overrides it for demos/acceptance checks. */
export function todayLocal(now: Date = new Date()): string {
  const o = process.env.APP_TODAY;
  if (o && /^\d{4}-\d{2}-\d{2}$/.test(o)) return o;
  return formatInTimeZone(now, TZ, "yyyy-MM-dd");
}

export function nowEpoch(): number {
  return Math.floor(Date.now() / 1000);
}

const toUTC = (d: string) => new Date(`${d}T00:00:00Z`);

export function addDays(d: string, n: number): string {
  const t = toUTC(d);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

/** b − a in whole days. */
export function diffDays(a: string, b: string): number {
  return Math.round((toUTC(b).getTime() - toUTC(a).getTime()) / 86400000);
}

export function weekdayShort(d: string): string {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][toUTC(d).getUTCDay()];
}

/** Monday of the week containing d. */
export function mondayOf(d: string): string {
  const wd = toUTC(d).getUTCDay();
  return addDays(d, wd === 0 ? -6 : 1 - wd);
}

export function fmtDate(d: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }): string {
  return toUTC(d).toLocaleDateString("en-GB", { ...opts, timeZone: "UTC" });
}

/** Local date part of a Strava start_date_local ("2026-11-09T04:21:29Z" — Strava marks local time with Z). */
export function localDateOf(startDateLocal: string): string {
  return startDateLocal.slice(0, 10);
}

/** Epoch seconds for local midnight of a plan date in Asia/Jakarta (UTC+7, no DST). */
export function epochOfLocalDate(d: string): number {
  return Math.floor(new Date(`${d}T00:00:00+07:00`).getTime() / 1000);
}
