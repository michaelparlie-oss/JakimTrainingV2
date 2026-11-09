import { eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import { stravaToken } from "@/db/schema";
import { STRAVA_OAUTH, type FetchFn } from "./client";

export const SCOPES = "read,activity:read_all";
export const REFRESH_MARGIN_S = 5 * 60;

export function stravaConfig() {
  return {
    clientId: process.env.STRAVA_CLIENT_ID ?? "",
    clientSecret: process.env.STRAVA_CLIENT_SECRET ?? "",
    redirectUri: process.env.STRAVA_REDIRECT_URI ?? "http://localhost:3000/api/strava/callback",
  };
}

export function authorizeUrl(state: string): string {
  const c = stravaConfig();
  const q = new URLSearchParams({
    client_id: c.clientId,
    response_type: "code",
    redirect_uri: c.redirectUri,
    approval_prompt: "auto",
    scope: SCOPES,
    state,
  });
  return `${STRAVA_OAUTH}/authorize?${q}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  athlete?: { id: number };
}

async function tokenRequest(body: Record<string, string>, f: FetchFn): Promise<TokenResponse> {
  const c = stravaConfig();
  const res = await f(`${STRAVA_OAUTH}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, ...body }).toString(),
  });
  if (!res.ok) throw new Error(`Strava token request failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as TokenResponse;
}

export async function exchangeCode(db: DB, code: string, scope: string, f: FetchFn = fetch): Promise<void> {
  const t = await tokenRequest({ code, grant_type: "authorization_code" }, f);
  const row = { id: 1, athlete_id: t.athlete?.id ?? null, access_token: t.access_token, refresh_token: t.refresh_token, expires_at: t.expires_at, scope };
  await db.insert(stravaToken).values(row).onConflictDoUpdate({ target: stravaToken.id, set: row }).run();
}

export async function getToken(db: DB) {
  return (await db.select().from(stravaToken).where(eq(stravaToken.id, 1)).get()) ?? null;
}

/** Refresh before every call if the token expires within 5 minutes; always store the newest refresh token. */
export async function validAccessToken(db: DB, f: FetchFn = fetch, nowS = () => Math.floor(Date.now() / 1000)): Promise<string> {
  const tok = await getToken(db);
  if (!tok) throw new Error("Strava is not connected.");
  if (tok.expires_at - nowS() >= REFRESH_MARGIN_S) return tok.access_token;
  const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: tok.refresh_token }, f);
  await db.update(stravaToken)
    .set({ access_token: t.access_token, refresh_token: t.refresh_token, expires_at: t.expires_at })
    .where(eq(stravaToken.id, 1))
    .run();
  return t.access_token;
}

export async function disconnect(db: DB, f: FetchFn = fetch): Promise<void> {
  const tok = await getToken(db);
  if (tok) {
    try {
      await f(`${STRAVA_OAUTH}/deauthorize`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ access_token: tok.access_token }).toString(),
      });
    } catch {
      /* offline: still forget the token locally */
    }
  }
  await db.delete(stravaToken).run();
}
