import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import "./globals.css";
import { BottomNav, Sidebar } from "./_c/BottomNav";
import { loadPlan } from "@/lib/plan/load";
import { diffDays, todayLocal } from "@/lib/util/dates";

export const metadata: Metadata = { title: "JAKIM 2027 Tracker", description: "Mike's marathon plan, synced with Strava" };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0f766e" };

/** Open-alert count for the sidebar badge. Never blocks the page (e.g. on the login screen). */
async function alertCount(): Promise<number> {
  try {
    const [{ getDb }, { activeAlerts }] = await Promise.all([import("@/db/client"), import("@/lib/server/view")]);
    return (await activeAlerts(await getDb())).length;
  } catch {
    return 0;
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await connection(); // every page reads the database: always render on request
  const race = loadPlan().meta.goal_race;
  const alerts = await alertCount();
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">
        <Sidebar alerts={alerts} daysToRace={diffDays(todayLocal(), race.date)} raceLabel="JAKIM full marathon · Sun 13 Jun 2027" />
        <div className="lg:pl-64">
          <main className="mx-auto max-w-xl px-4 pb-28 pt-4 lg:max-w-6xl lg:px-8 lg:pb-12 lg:pt-8">{children}</main>
        </div>
        <BottomNav />
      </body>
    </html>
  );
}
