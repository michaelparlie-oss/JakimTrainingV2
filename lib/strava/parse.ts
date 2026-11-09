export interface ParsedWellbeing {
  knee_pain: number | null;
  bunion_pain: number | null;
  rpe: number | null;
  carbs_g: number | null;
}

const RE = /(knee|bunion|rpe|carbs)\s*[:=]?\s*(\d{1,3})/gi;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Parse "knee 2 bunion 1 rpe 5 carbs 60" from a Strava description (brief §6). Null if nothing found. */
export function parseDescription(text: string | null | undefined): ParsedWellbeing | null {
  if (!text) return null;
  const out: ParsedWellbeing = { knee_pain: null, bunion_pain: null, rpe: null, carbs_g: null };
  let found = false;
  for (const m of text.matchAll(RE)) {
    const v = Number(m[2]);
    found = true;
    switch (m[1].toLowerCase()) {
      case "knee": out.knee_pain = clamp(v, 0, 10); break;
      case "bunion": out.bunion_pain = clamp(v, 0, 10); break;
      case "rpe": out.rpe = clamp(v, 1, 10); break;
      case "carbs": out.carbs_g = v; break;
    }
  }
  return found ? out : null;
}
