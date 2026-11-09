import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import "./globals.css";
import { BottomNav } from "./_c/BottomNav";

export const metadata: Metadata = { title: "JAKIM 2027 Tracker", description: "Mike's marathon plan, synced with Strava" };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0f766e" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await connection(); // every page reads the local DB: always render on request
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">
        <main className="mx-auto max-w-xl px-4 pb-28 pt-4">{children}</main>
        <BottomNav />
      </body>
    </html>
  );
}
