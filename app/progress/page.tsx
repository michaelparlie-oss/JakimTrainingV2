import { getDb } from "@/db/client";
import { ctx } from "@/lib/server/view";
import { PageTitle } from "../_c/ui";
import { Dashboard } from "./Dashboard";
import { dashboardData } from "./data";

export default async function Progress() {
  const db = await getDb();
  const data = await dashboardData(db, await ctx(db));
  return (
    <>
      <PageTitle
        title="Progress"
        sub={`Training analytics · ${data.daysToRace >= 0 ? `${data.daysToRace} days to JAKIM` : "race complete"}`}
      />
      <Dashboard data={data} />
    </>
  );
}
