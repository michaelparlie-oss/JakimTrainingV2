import { eq, inArray } from "drizzle-orm";
import type { DB } from "@/db/client";
import { setting } from "@/db/schema";
import type { HrOverrides } from "@/lib/zones/formula";

export interface Settings {
  goal_time_s: number | null; // null = plan goal
  hr_overrides: HrOverrides;
  fever: { active: boolean; cleared_at: number | null } | null;
  last_sync_at: number | null;
  sync_state: { status: "idle" | "running" | "partial" | "paused" | "error"; message?: string; resume_at?: string; at?: number } | null;
  passcode_hash: string | null;
  rate: { short_usage: number; short_limit: number; daily_usage: number; daily_limit: number } | null;
  goal_history: { at: number; goal_s: number; reason: string }[];
  cp4: { suggest_pace_s: number | null } | null;
}

const DEFAULTS: Settings = {
  goal_time_s: null, hr_overrides: {}, fever: null, last_sync_at: null, sync_state: null,
  passcode_hash: null, rate: null, goal_history: [], cp4: null,
};

export async function getSetting<K extends keyof Settings>(db: DB, key: K): Promise<Settings[K]> {
  const r = await db.select().from(setting).where(eq(setting.key, key)).get();
  return r ? (JSON.parse(r.value_json) as Settings[K]) : DEFAULTS[key];
}

/** Several settings in one query. */
export async function getSettings<K extends keyof Settings>(db: DB, keys: K[]): Promise<Pick<Settings, K>> {
  const rows = await db.select().from(setting).where(inArray(setting.key, keys)).all();
  const out = {} as Pick<Settings, K>;
  for (const k of keys) {
    const r = rows.find((x) => x.key === k);
    out[k] = r ? JSON.parse(r.value_json) : DEFAULTS[k];
  }
  return out;
}

export function setSettingQuery<K extends keyof Settings>(db: DB, key: K, value: Settings[K]) {
  const v = JSON.stringify(value);
  return db.insert(setting).values({ key, value_json: v }).onConflictDoUpdate({ target: setting.key, set: { value_json: v } });
}

export async function setSetting<K extends keyof Settings>(db: DB, key: K, value: Settings[K]): Promise<void> {
  await setSettingQuery(db, key, value).run();
}
