export const STRAVA_API = "https://www.strava.com/api/v3";
export const STRAVA_OAUTH = "https://www.strava.com/oauth";

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;
export type SleepFn = (ms: number) => Promise<void>;

export interface RateState {
  short_usage: number;
  short_limit: number;
  daily_usage: number;
  daily_limit: number;
}

/** Thrown when Strava says "wait" for longer than this caller is willing to block. Sync stores progress and resumes later. */
export class RateLimitPause extends Error {
  constructor(public resumeAt: Date, public reason: string) {
    super(`Strava rate limit: ${reason}; resume at ${resumeAt.toISOString()}`);
  }
}

export class StravaError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** 15-minute windows reset at :00, :15, :30, :45; the daily limit at midnight UTC. */
export function nextWindow(now: Date): Date {
  const d = new Date(now);
  d.setUTCSeconds(0, 0);
  d.setUTCMinutes(Math.floor(d.getUTCMinutes() / 15) * 15 + 15);
  return new Date(d.getTime() + 2000);
}
export function nextUtcMidnight(now: Date): Date {
  const d = new Date(now);
  d.setUTCHours(24, 0, 5, 0);
  return d;
}

function pair(h: string | null): [number, number] | null {
  if (!h) return null;
  const p = h.split(",").map((x) => Number(x.trim()));
  return p.length >= 2 && p.every(Number.isFinite) ? [p[0], p[1]] : null;
}

/** Most constraining of the overall and read (non-upload) limits. */
export function readRate(headers: Headers): RateState | null {
  const cands: RateState[] = [];
  for (const [l, u] of [
    ["x-ratelimit-limit", "x-ratelimit-usage"],
    ["x-readratelimit-limit", "x-readratelimit-usage"],
  ]) {
    const lim = pair(headers.get(l)),
      use = pair(headers.get(u));
    if (lim && use) cands.push({ short_limit: lim[0], daily_limit: lim[1], short_usage: use[0], daily_usage: use[1] });
  }
  if (!cands.length) return null;
  return cands.sort((a, b) => b.short_usage / b.short_limit - a.short_usage / a.short_limit)[0];
}

export const PAUSE_AT = 0.8;

export interface ClientOpts {
  getAccessToken: () => Promise<string>;
  fetch?: FetchFn;
  sleep?: SleepFn;
  now?: () => Date;
  /** Longest wait (ms) this client will block for before throwing RateLimitPause. */
  maxWaitMs?: number;
  onRate?: (r: RateState) => void;
}

export class StravaClient {
  private f: FetchFn;
  private sleep: SleepFn;
  private now: () => Date;
  private pauseUntil: Date | null = null;
  calls = 0;

  constructor(private o: ClientOpts) {
    this.f = o.fetch ?? ((u, i) => fetch(u, i));
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = o.now ?? (() => new Date());
  }

  private async waitUntil(t: Date, reason: string) {
    const ms = t.getTime() - this.now().getTime();
    if (ms <= 0) return;
    if (ms > (this.o.maxWaitMs ?? 16 * 60 * 1000)) throw new RateLimitPause(t, reason);
    await this.sleep(ms);
  }

  async get<T>(path: string, query: Record<string, string | number> = {}): Promise<T> {
    const qs = new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)])).toString();
    const url = `${STRAVA_API}${path}${qs ? `?${qs}` : ""}`;
    for (let attempt = 0; attempt < 4; attempt++) {
      if (this.pauseUntil) {
        await this.waitUntil(this.pauseUntil, "approaching the 15-minute limit");
        this.pauseUntil = null;
      }
      const token = await this.o.getAccessToken();
      const res = await this.f(url, { headers: { Authorization: `Bearer ${token}` } });
      this.calls++;
      const rate = readRate(res.headers);
      if (rate) {
        this.o.onRate?.(rate);
        if (rate.daily_usage >= rate.daily_limit) this.pauseUntil = nextUtcMidnight(this.now());
        else if (rate.short_usage >= PAUSE_AT * rate.short_limit) this.pauseUntil = nextWindow(this.now());
      }
      if (res.status === 429) {
        const daily = rate && rate.daily_usage >= rate.daily_limit;
        await this.waitUntil(daily ? nextUtcMidnight(this.now()) : nextWindow(this.now()), "429 Too Many Requests");
        this.pauseUntil = null;
        continue;
      }
      if (!res.ok) throw new StravaError(res.status, `Strava ${res.status} on ${path}: ${(await res.text()).slice(0, 200)}`);
      return (await res.json()) as T;
    }
    throw new StravaError(429, `Strava kept rate-limiting ${path}`);
  }
}
