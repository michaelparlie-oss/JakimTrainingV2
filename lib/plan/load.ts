import fs from "node:fs";
import crypto from "node:crypto";
import bundled from "@/data/jakim_plan_2027.json";
import { PlanSchema, type Plan } from "./schema";

export class PlanValidationError extends Error {}

let cached: { plan: Plan; hash: string } | null = null;

function validate(raw: unknown, where: string): Plan {
  const res = PlanSchema.safeParse(raw);
  if (!res.success) {
    const lines = res.error.issues.map((i) => `  at ${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new PlanValidationError(`Plan JSON failed validation (${where}):\n${lines.join("\n")}`);
  }
  return res.data;
}

/**
 * The plan is bundled at build time (data/jakim_plan_2027.json), so serverless functions need no file access.
 * PLAN_PATH, if set, loads another file instead. Throws with every Zod error path if invalid (brief §14).
 */
function load(): { plan: Plan; hash: string } {
  if (cached) return cached;
  const raw = process.env.PLAN_PATH ? JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ process.env.PLAN_PATH, "utf8")) : bundled;
  const plan = validate(raw, process.env.PLAN_PATH ?? "data/jakim_plan_2027.json");
  cached = { plan, hash: crypto.createHash("sha256").update(JSON.stringify(raw)).digest("hex") };
  return cached;
}

export function loadPlan(): Plan {
  return load().plan;
}

export function planHash(): string {
  return load().hash;
}
