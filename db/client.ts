import type { Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql/web";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import path from "node:path";
import * as schema from "./schema";
import { MIGRATIONS } from "./migrations.generated";
import { ensureSeeded } from "./seed";

export type DB = LibSQLDatabase<typeof schema>;

const g = globalThis as unknown as { __jakimDb?: Promise<DB> };

/**
 * TURSO_DATABASE_URL (libsql://… or https://…) → Turso over HTTP (Netlify, any host).
 * Otherwise a local SQLite file (DATABASE_PATH, default data/app.db) for development and Docker.
 */
export function dbUrl(): string {
  if (process.env.TURSO_DATABASE_URL) return process.env.TURSO_DATABASE_URL;
  const file = process.env.DATABASE_PATH ?? path.join(/*turbopackIgnore: true*/ process.cwd(), "data", "app.db");
  return file.startsWith("file:") || file === ":memory:" ? file : `file:${file}`;
}

async function makeClient(url: string): Promise<Client> {
  const authToken = process.env.TURSO_AUTH_TOKEN || undefined;
  if (url.startsWith("file:")) {
    const fs = await import("node:fs");
    fs.mkdirSync(path.dirname(url.slice(5)), { recursive: true });
    const { createClient } = await import("@libsql/client"); // native SQLite, local files only
    return createClient({ url });
  }
  const { createClient } = await import("@libsql/client/web"); // pure fetch: no native code in serverless
  return createClient({ url, authToken }) as unknown as Client;
}

/** Applies the embedded SQL migrations once (tracked in __app_migrations). */
export async function migrate(client: Client): Promise<void> {
  await client.execute("CREATE TABLE IF NOT EXISTS __app_migrations (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)");
  const done = new Set((await client.execute("SELECT id FROM __app_migrations")).rows.map((r) => String(r.id)));
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    await client.batch(
      [...m.statements.map((sql) => ({ sql, args: [] })), { sql: "INSERT INTO __app_migrations (id, applied_at) VALUES (?, ?)", args: [m.id, Date.now()] }],
      "write",
    );
  }
}

export async function openDb(url = dbUrl()): Promise<DB> {
  const client = await makeClient(url);
  if (url.startsWith("file:")) await client.execute("PRAGMA journal_mode = WAL");
  await migrate(client);
  return drizzle(client as never, { schema }) as unknown as DB;
}

/** Process-wide DB (one per warm serverless instance). Seeds the plan on first use. */
export function getDb(): Promise<DB> {
  if (!g.__jakimDb) {
    g.__jakimDb = (async () => {
      const db = await openDb();
      await ensureSeeded(db);
      return db;
    })().catch((e) => {
      g.__jakimDb = undefined;
      throw e;
    });
  }
  return g.__jakimDb;
}
