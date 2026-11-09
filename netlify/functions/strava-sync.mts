import type { Config } from "@netlify/functions";

/**
 * Every 30 minutes: ask the app to sync with Strava (resumable, ~20 s max per run).
 * Needs CRON_SECRET set in the site's environment variables. URL is provided by Netlify.
 */
export default async () => {
  const base = process.env.URL;
  const secret = process.env.CRON_SECRET;
  if (!base || !secret) return new Response("URL or CRON_SECRET missing", { status: 500 });
  const res = await fetch(`${base}/api/strava/sync?loop=1`, { method: "POST", headers: { "x-cron-secret": secret } });
  const body = await res.text();
  console.log(`strava-sync ${res.status}: ${body.slice(0, 300)}`);
  return new Response(body, { status: res.status });
};

export const config: Config = { schedule: "*/30 * * * *" };
