// Runs in proxy.ts and in server actions: Web Crypto only (no node:crypto).
export const COOKIE = "jakim_session";
export const MAX_AGE_S = 60 * 60 * 24 * 30;

const enc = new TextEncoder();

function secret(): string {
  const s = process.env.SESSION_SECRET || (process.env.APP_PASSCODE ? `derived:${process.env.APP_PASSCODE}` : "");
  return s;
}

async function hmac(data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256(txt: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(txt));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function makeSessionToken(nowS = Math.floor(Date.now() / 1000)): Promise<string> {
  const payload = `v1.${nowS}`;
  return `${payload}.${await hmac(payload)}`;
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function verifySessionToken(tok: string | undefined, nowS = Math.floor(Date.now() / 1000)): Promise<boolean> {
  if (!tok || !secret()) return false;
  const parts = tok.split(".");
  if (parts.length !== 3) return false;
  const issued = Number(parts[1]);
  if (!Number.isFinite(issued) || nowS - issued > MAX_AGE_S) return false;
  return safeEqual(parts[2], await hmac(`${parts[0]}.${parts[1]}`));
}
