import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Netlify packages the app itself; "standalone" is only for the Docker image.
  output: process.env.NETLIFY ? undefined : "standalone",
  serverExternalPackages: ["@libsql/client", "libsql"],
  // Never ship a local database file inside a deploy bundle.
  outputFileTracingExcludes: { "*": ["data/*.db", "data/*.db-*"] },
};

export default nextConfig;
