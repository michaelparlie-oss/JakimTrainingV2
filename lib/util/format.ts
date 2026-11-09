/** m:ss for a pace in s/km (rounded to whole seconds for display; scoring uses raw values). */
export function fmtPace(sPerKm: number | null | undefined): string {
  if (sPerKm == null || !isFinite(sPerKm)) return "–";
  const s = Math.round(sPerKm);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function fmtPaceRange(min: number | null, max: number | null): string | null {
  if (min == null || max == null) return null;
  return `${fmtPace(min)}–${fmtPace(max)} /km`;
}

export function fmtHrRange(min: number | null, max: number | null): string | null {
  if (min == null && max == null) return null;
  if (min == null) return `under ${max} bpm`;
  if (max == null) return `over ${min} bpm`;
  return `${min}–${max} bpm`;
}

export function fmtKm(km: number | null | undefined): string {
  if (km == null) return "–";
  return `${(Math.round(km * 10) / 10).toFixed(1)} km`;
}

/** h:mm:ss or m:ss */
export function fmtDuration(totalS: number | null | undefined): string {
  if (totalS == null) return "–";
  const s = Math.round(totalS);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

/** Parse "1:06:30", "66:30", "4:59:00" → seconds. */
export function parseDuration(txt: string): number | null {
  const parts = txt.trim().split(":").map((p) => Number(p));
  if (!parts.length || parts.some((p) => !Number.isFinite(p) || p < 0)) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}
