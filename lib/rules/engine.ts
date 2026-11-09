import type { Zones } from "@/lib/plan/schema";
import type { EffSession } from "@/lib/adapt/types";
import { isCountedRun, isHardRun } from "@/lib/adapt/types";
import type { Action, WeekInfo } from "@/lib/adapt/actions";
import type { Act, MatchStatus } from "@/lib/match/types";
import { isRunActivity } from "@/lib/match/types";
import type { ScoreResult } from "@/lib/match/score";
import { addDays, diffDays, fmtDate, mondayOf, weekdayShort } from "@/lib/util/dates";
import { fmtKm } from "@/lib/util/format";

export type Severity = "info" | "warn" | "stop";

export interface ProposalOut {
  fingerprint: string;
  title: string;
  rationale: string;
  options: { label: string; action: Action }[];
}

export interface AlertOut {
  key: string;
  rule_id: string;
  severity: Severity;
  date: string;
  message: string;
  related_id: string | null;
  proposal?: ProposalOut;
}

export interface WellbeingEntry {
  date: string;
  knee_pain: number | null;
  bunion_pain: number | null;
  strava_activity_id: number | null;
  created_at: number;
}

export interface Snapshot {
  today: string;
  nowEpoch: number;
  sessions: EffSession[];
  statuses: MatchStatus[];
  activities: Act[];
  scores: Map<string, ScoreResult>;
  wellbeing: WellbeingEntry[];
  fever: { active: boolean; cleared_at: number | null } | null;
  weeks: WeekInfo[];
  zonesFor: (s: EffSession) => Zones;
  /** CP4 dress-rehearsal result, if entered. */
  cp4?: { date: string; avg_hr: number | null; suggest_pace_s: number | null } | null;
}

export const CP4_HR_LIMIT = 165;

export const SPIKE_LIMIT = 1.1; // Frandsen et al. 2025, BJSM
export const SPIKE_WINDOW_DAYS = 30;
export const KNEE_LIMIT = 3;
export const KNEE_REPEAT_DAYS = 14;
export const EASY_HR_DRIFT_PCT = 20;
export const FATIGUE_BPM = 5;
export const FATIGUE_PACE_BAND_S = 15;
/** How far ahead planned runs raise alerts/proposals (the Plan screen flags every week). */
export const LOOKAHEAD_DAYS = 7;
/** How far back completed runs raise alerts (so a backfill doesn't flood the alert list). */
export const LOOKBACK_DAYS = 7;

const SEVERITY_ORDER: Record<Severity, number> = { stop: 0, warn: 1, info: 2 };
export const sortAlerts = <T extends { severity: string }>(a: T[]) =>
  [...a].sort((x, y) => SEVERITY_ORDER[x.severity as Severity] - SEVERITY_ORDER[y.severity as Severity]);

// ---------------------------------------------------------------------------------------------
// Long-run spike: works for actual runs and for planned future runs, using real history where it exists.
// ---------------------------------------------------------------------------------------------

export interface DistancePoint {
  date: string;
  km: number;
  source: "actual" | "planned";
}

/** Distances that count as "your runs": actual runs before today; for today onwards, the effective plan
 *  (unless today's run has already been done). */
export function distanceHistory(snap: Pick<Snapshot, "today" | "sessions" | "statuses" | "activities">): DistancePoint[] {
  const pts: DistancePoint[] = snap.activities
    .filter(isRunActivity)
    .map((a) => ({ date: a.local_date, km: a.distance_m / 1000, source: "actual" as const }));
  const done = new Set(snap.statuses.filter((s) => s.strava_activity_id != null).map((s) => s.plan_session_id));
  for (const s of snap.sessions) {
    if (!isCountedRun(s) || s.date < snap.today || done.has(s.id) || s.distance_km == null) continue;
    pts.push({ date: s.date, km: s.distance_km, source: "planned" });
  }
  return pts;
}

export function longestBefore(history: DistancePoint[], date: string): number | null {
  const from = addDays(date, -SPIKE_WINDOW_DAYS);
  const win = history.filter((p) => p.date >= from && p.date < date);
  return win.length ? Math.max(...win.map((p) => p.km)) : null;
}

export interface SpikeResult {
  km: number;
  max30: number;
  pct_over: number;
  cap_km: number;
}

export function spikeCheck(km: number, max30: number | null): SpikeResult | null {
  if (max30 == null || max30 <= 0) return null;
  if (km <= SPIKE_LIMIT * max30 + 1e-9) return null;
  return { km, max30, pct_over: Math.round((km / max30 - 1) * 100), cap_km: Math.floor(SPIKE_LIMIT * max30 * 2) / 2 };
}

/** Spike status for every future planned run (shown on the Plan/Week screens). Race day is exempt. */
export function plannedSpikes(snap: Pick<Snapshot, "today" | "sessions" | "statuses" | "activities">): Map<string, SpikeResult> {
  const hist = distanceHistory(snap);
  const out = new Map<string, SpikeResult>();
  for (const s of snap.sessions) {
    if (!isCountedRun(s) || s.date < snap.today || s.kind === "race" || s.distance_km == null) continue;
    const r = spikeCheck(s.distance_km, longestBefore(hist, s.date));
    if (r) out.set(s.id, r);
  }
  return out;
}

const spikeMsg = (r: SpikeResult, lead: string) =>
  `${lead} is ${r.pct_over}% longer than your longest run in the last 30 days (${fmtKm(r.max30)}). Research links jumps over 10% to more overuse injuries. Consider capping at ${r.cap_km.toFixed(1)} km.`;

// ---------------------------------------------------------------------------------------------

export function runRules(snap: Snapshot): AlertOut[] {
  const out: AlertOut[] = [];
  const { today } = snap;
  const statusBy = new Map(snap.statuses.map((s) => [s.plan_session_id, s]));
  const actBy = new Map(snap.activities.map((a) => [a.id, a]));
  const runs = snap.activities.filter(isRunActivity);
  const upcoming = snap.sessions.filter(
    (s) => isCountedRun(s) && s.date >= today && !statusBy.get(s.id)?.strava_activity_id,
  );
  const nextRunAfter = (date: string, pred: (s: EffSession) => boolean = () => true) =>
    upcoming.find((s) => s.date > date && pred(s)) ?? upcoming.find((s) => s.date >= date && pred(s));

  // --- long_run_spike: actual runs (recent) ---
  const actualHist: DistancePoint[] = runs.map((a) => ({ date: a.local_date, km: a.distance_m / 1000, source: "actual" }));
  for (const a of runs) {
    if (diffDays(a.local_date, today) > LOOKBACK_DAYS) continue;
    const r = spikeCheck(a.distance_m / 1000, longestBefore(actualHist, a.local_date));
    if (r)
      out.push({
        key: `long_run_spike:act:${a.id}`,
        rule_id: "long_run_spike",
        severity: "warn",
        date: a.local_date,
        related_id: String(a.id),
        message: spikeMsg(r, `Your ${weekdayShort(a.local_date)} ${fmtDate(a.local_date)} run (${fmtKm(r.km)})`),
      });
  }
  // --- long_run_spike: planned runs in the next week, against real history ---
  const spikes = plannedSpikes(snap);
  for (const s of upcoming) {
    if (diffDays(today, s.date) > LOOKAHEAD_DAYS) continue;
    const r = spikes.get(s.id);
    if (!r) continue;
    out.push({
      key: `long_run_spike:plan:${s.id}`,
      rule_id: "long_run_spike",
      severity: "warn",
      date: s.date,
      related_id: s.id,
      message: spikeMsg(r, `${weekdayShort(s.date)}'s ${s.title} (${fmtKm(r.km)})`),
      proposal: {
        fingerprint: `spike:${s.id}:${r.cap_km}`,
        title: `Cap ${weekdayShort(s.date)}'s run at ${r.cap_km.toFixed(1)} km?`,
        rationale: `Your actual running in the last 30 days peaked at ${fmtKm(r.max30)}. Keeping each run within 10% of that limits the injury risk the plan is built around.`,
        options: [
          { label: `Cap at ${r.cap_km.toFixed(1)} km`, action: { type: "cap", session_id: s.id, km: r.cap_km } },
          { label: "Keep as planned", action: { type: "none" } },
        ],
      },
    });
  }

  // --- easy_hr_drift ---
  for (const s of snap.sessions) {
    if (s.kind !== "easy" && s.kind !== "long") continue;
    const sc = snap.scores.get(s.id);
    const st = statusBy.get(s.id);
    if (!sc || !st?.strava_activity_id) continue;
    const a = actBy.get(st.strava_activity_id);
    if (!a || diffDays(a.local_date, today) > LOOKBACK_DAYS) continue;
    const hr = sc.details.hr;
    if (hr?.method === "stream" && hr.pct_over != null && hr.pct_over > EASY_HR_DRIFT_PCT)
      out.push({
        key: `easy_hr_drift:${s.id}`,
        rule_id: "easy_hr_drift",
        severity: "info",
        date: a.local_date,
        related_id: s.id,
        message: `Easy run went too hard: ${Math.round(hr.pct_over)}% above ${hr.limit} bpm. Slow down or walk briefly next time.`,
      });
  }

  // --- knee rules ---
  const knee = snap.wellbeing.filter((w) => w.knee_pain != null && w.knee_pain > KNEE_LIMIT).sort((a, b) => a.date.localeCompare(b.date));
  const recentKnee = knee.filter((w) => diffDays(w.date, today) <= LOOKBACK_DAYS);
  for (const w of recentKnee) {
    const next = nextRunAfter(w.date);
    out.push({
      key: `knee_single:${w.date}:${w.created_at}`,
      rule_id: "knee_single",
      severity: "warn",
      date: w.date,
      related_id: next?.id ?? null,
      message: `Knee above 3/10 (${w.knee_pain}/10 on ${fmtDate(w.date)}). Make the next run 30 min easy or rest.`,
      proposal: next
        ? {
            fingerprint: `knee_single:${w.date}:${w.created_at}:${next.id}`,
            title: `Change ${weekdayShort(next.date)}'s run (${next.title})?`,
            rationale: "Plan rule: knee pain above 3/10, limping, or worse the next day → next run 30 min easy or rest.",
            options: [
              { label: "Make it 30 min easy", action: { type: "replace_easy", session_id: next.id, minutes: 30 } },
              { label: "Rest instead", action: { type: "skip", session_ids: [next.id] } },
              { label: "Knee has settled: keep it", action: { type: "none" } },
            ],
          }
        : undefined,
    });
  }
  for (let i = 1; i < knee.length; i++) {
    const a = knee[i - 1],
      b = knee[i];
    if (diffDays(a.date, b.date) > KNEE_REPEAT_DAYS || diffDays(b.date, today) > KNEE_REPEAT_DAYS) continue;
    const nextLong = nextRunAfter(b.date, (s) => s.kind === "long");
    out.push({
      key: `knee_repeat:${b.date}:${b.created_at}`,
      rule_id: "knee_repeat",
      severity: "stop",
      date: b.date,
      related_id: nextLong?.id ?? null,
      message: "Two knee-pain warnings in 2 weeks. Please see a physiotherapist before your next long run.",
      proposal: nextLong
        ? {
            fingerprint: `knee_repeat:${b.date}:${nextLong.id}`,
            title: `Hold ${weekdayShort(nextLong.date)} ${fmtDate(nextLong.date)}'s long run until you've seen a physio?`,
            rationale: "Two entries above 3/10 within 14 days. The plan asks for a physiotherapist check before the next long run.",
            options: [
              { label: "Replace it with 30 min easy", action: { type: "replace_easy", session_id: nextLong.id, minutes: 30 } },
              { label: "Physio cleared me: keep it", action: { type: "none" } },
            ],
          }
        : undefined,
    });
  }

  // --- missed_week: the most recent completed plan week ---
  const lastWeekStart = addDays(mondayOf(today), -7);
  const lastWeek = snap.weeks.find((w) => w.start_date === lastWeekStart);
  if (lastWeek) {
    const planned = snap.sessions.filter((s) => s.week === lastWeek.code && s.category === "run" && !s.optional);
    const missed = planned.filter((s) => ["missed", "skipped"].includes(statusBy.get(s.id)?.status ?? ""));
    if (planned.length && missed.length >= 3)
      out.push({
        key: `missed_week:${lastWeek.code}`,
        rule_id: "missed_week",
        severity: "warn",
        date: today,
        related_id: lastWeek.code,
        message: `You missed most of last week (${missed.length} of ${planned.length} runs in ${lastWeek.code}). Repeat it instead of moving on?`,
        proposal: {
          fingerprint: `missed_week:${lastWeek.code}`,
          title: `Repeat week ${lastWeek.code}?`,
          rationale: "Plan rule: missed a full week → repeat it (only if you confirm). Never double up. Race day and the taper stay fixed.",
          options: [
            { label: "Repeat week", action: { type: "repeat_week", week: lastWeek.code } },
            { label: "Continue", action: { type: "none" } },
          ],
        },
      });
  }

  // --- fatigue_hr ---
  const easyIds = new Set(snap.sessions.filter((s) => s.kind === "easy").map((s) => s.id));
  const easyRuns = snap.statuses
    .filter((s) => easyIds.has(s.plan_session_id) && s.strava_activity_id != null)
    .map((s) => actBy.get(s.strava_activity_id!))
    .filter((a): a is Act => !!a && a.avg_hr != null && a.distance_m > 0);
  const pace = (a: Act) => a.moving_time_s / (a.distance_m / 1000);
  const recent = easyRuns.filter((a) => diffDays(a.local_date, today) <= 6 && a.local_date <= today);
  if (recent.length >= 2) {
    const rp = recent.reduce((t, a) => t + pace(a), 0) / recent.length;
    const rh = recent.reduce((t, a) => t + a.avg_hr!, 0) / recent.length;
    const base = easyRuns.filter((a) => {
      const d = diffDays(a.local_date, today);
      return d >= 7 && d <= 34 && Math.abs(pace(a) - rp) <= FATIGUE_PACE_BAND_S;
    });
    if (base.length >= 2) {
      const bh = base.reduce((t, a) => t + a.avg_hr!, 0) / base.length;
      if (rh - bh >= FATIGUE_BPM) {
        const nextMon = addDays(mondayOf(today), 7);
        const wk = snap.weeks.find((w) => w.start_date === nextMon);
        const sorted = [...snap.weeks].sort((a, b) => a.start_date.localeCompare(b.start_date));
        const di = sorted.findIndex((w) => w.start_date > today && w.deload);
        const ratio =
          di > 0 ? Math.round((sorted[di].planned_run_km / sorted[di - 1].planned_run_km) * 20) / 20 : 0.75;
        out.push({
          key: `fatigue_hr:${mondayOf(today)}`,
          rule_id: "fatigue_hr",
          severity: "info",
          date: today,
          related_id: wk?.code ?? null,
          message: `Easy-run heart rate is up (${Math.round(rh)} vs ${Math.round(bh)} bpm at a similar pace). Consider taking the next deload week early.`,
          proposal:
            wk && !wk.deload && wk.phase !== "Taper"
              ? {
                  fingerprint: `fatigue_hr:${wk.code}`,
                  title: `Make next week (${wk.code}) a deload week?`,
                  rationale: `Runs drop to about ${Math.round(ratio * 100)}% (the same cut as your next planned deload) and strength sets are halved. The later deload stays in place.`,
                  options: [
                    { label: "Take the deload now", action: { type: "early_deload", week: wk.code, ratio } },
                    { label: "Keep going", action: { type: "none" } },
                  ],
                }
              : undefined,
        });
      }
    }
  }

  // --- fever ---
  if (snap.fever) {
    const clearedRecently = !snap.fever.active && snap.fever.cleared_at != null && snap.nowEpoch - snap.fever.cleared_at < 24 * 3600;
    if (snap.fever.active || clearedRecently) {
      const block = upcoming.filter((s) => diffDays(today, s.date) <= (snap.fever!.active ? 0 : 1) && s.date >= today);
      const until = clearedRecently
        ? new Date((snap.fever.cleared_at! + 24 * 3600) * 1000).toLocaleString("en-GB", { timeZone: "Asia/Jakarta", weekday: "short", hour: "2-digit", minute: "2-digit" })
        : null;
      out.push({
        key: `fever:${snap.fever.active ? "active" : `cleared:${snap.fever.cleared_at}`}`,
        rule_id: "fever",
        severity: "stop",
        date: today,
        related_id: null,
        message: until ? `No running until 24 h fever-free (from ${until}).` : "No running until 24 h fever-free.",
        proposal: block.length
          ? {
              fingerprint: `fever:${block.map((b) => b.id).join(",")}`,
              title: `Skip ${block.map((b) => `${weekdayShort(b.date)}'s run`).join(" and ")}?`,
              rationale: "Missed days are fine: carry on as written afterwards and don't make the runs up.",
              options: [
                { label: "Skip", action: { type: "skip", session_ids: block.map((b) => b.id) } },
                { label: "Not now", action: { type: "none" } },
              ],
            }
          : undefined,
      });
    }
  }

  // --- prompt_pain_log ---
  for (const s of snap.sessions) {
    if (!s.post_run_log.length) continue;
    const st = statusBy.get(s.id);
    if (!st?.strava_activity_id) continue;
    const a = actBy.get(st.strava_activity_id);
    if (!a || diffDays(a.local_date, today) > LOOKBACK_DAYS) continue;
    const logged = snap.wellbeing.some((w) => w.knee_pain != null && (w.strava_activity_id === a.id || w.date === a.local_date));
    if (!logged)
      out.push({
        key: `prompt_pain_log:${s.id}`,
        rule_id: "prompt_pain_log",
        severity: "info",
        date: a.local_date,
        related_id: s.id,
        message: `Log your knee and bunion score for ${weekdayShort(a.local_date)}'s ${s.kind === "long" ? "long run" : "run"}.`,
      });
  }

  // --- hard_back_to_back (dynamic: catches moves that put two hard runs on consecutive days) ---
  const hardAhead = snap.sessions.filter((s) => isCountedRun(s) && isHardRun(s) && s.date >= today && diffDays(today, s.date) <= 14);
  const doneHard = snap.statuses
    .filter((st) => st.strava_activity_id != null)
    .map((st) => ({ s: snap.sessions.find((x) => x.id === st.plan_session_id), a: actBy.get(st.strava_activity_id!) }))
    .filter((x) => x.s && x.a && isHardRun(x.s) && diffDays(x.a.local_date, today) <= 2)
    .map((x) => ({ id: x.s!.id, date: x.a!.local_date, title: x.s!.title }));
  const hardDays = [...doneHard, ...hardAhead.map((s) => ({ id: s.id, date: s.date, title: s.title }))];
  for (const later of hardAhead) {
    const prev = hardDays.find((h) => h.id !== later.id && diffDays(h.date, later.date) === 1);
    if (!prev || later.kind === "race" || later.kind === "test") continue;
    const runDays = new Set(snap.sessions.filter((s) => s.category === "run" && !s.skipped).map((s) => s.date));
    let free: string | null = null;
    for (let k = 1; k <= 2; k++) {
      const d = addDays(later.date, k);
      if (!runDays.has(d) && !hardDays.some((h) => Math.abs(diffDays(h.date, d)) === 1 && h.id !== later.id)) {
        free = d;
        break;
      }
    }
    out.push({
      key: `hard_back_to_back:${prev.id}:${later.id}:${later.date}`,
      rule_id: "hard_back_to_back",
      severity: "info",
      date: later.date,
      related_id: later.id,
      message: `Two hard runs on back-to-back days: ${weekdayShort(prev.date)} (${prev.title}) and ${weekdayShort(later.date)} (${later.title}). Your plan always leaves an easier day between them.`,
      proposal: free
        ? {
            fingerprint: `b2b:${later.id}:${free}`,
            title: `Move ${later.title} to ${weekdayShort(free)} ${fmtDate(free)}?`,
            rationale: "Keeps one easier day between hard sessions, as the plan is written.",
            options: [
              { label: `Move to ${weekdayShort(free)}`, action: { type: "move", session_id: later.id, date: free } },
              { label: "Keep as is", action: { type: "none" } },
            ],
          }
        : undefined,
    });
  }

  // --- cp4_hr: dress rehearsal heart rate (§8) ---
  if (snap.cp4?.avg_hr != null && snap.cp4.avg_hr >= CP4_HR_LIMIT) {
    const p = snap.cp4.suggest_pace_s;
    out.push({
      key: `cp4_hr:${snap.cp4.date}`,
      rule_id: "cp4_hr",
      severity: "warn",
      date: snap.cp4.date,
      related_id: "CP4",
      message:
        `Average HR on the marathon-pace part was ${Math.round(snap.cp4.avg_hr)} bpm (target: under ${CP4_HR_LIMIT}). ` +
        (p != null
          ? `Race at the pace that kept HR under ${CP4_HR_LIMIT}: about ${Math.floor(Math.round(p) / 60)}:${String(Math.round(p) % 60).padStart(2, "0")} /km.`
          : `No kilometre of the MP part stayed under ${CP4_HR_LIMIT} bpm, so race slower than you did in the rehearsal.`),
    });
  }

  return sortAlerts(out);
}
