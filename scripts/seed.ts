import { openDb, dbUrl } from "@/db/client";
import { seedPlan } from "@/db/seed";
import { loadPlan, PlanValidationError } from "@/lib/plan/load";

(async () => {
  try {
    const plan = loadPlan();
    const db = await openDb();
    const r = await seedPlan(db, plan);
    console.log(`Seeded ${r.weeks} weeks and ${r.sessions} sessions into ${dbUrl().replace(/\?.*/, "")}`);
  } catch (e) {
    if (e instanceof PlanValidationError) {
      console.error(e.message);
      process.exit(1);
    }
    throw e;
  }
})();
