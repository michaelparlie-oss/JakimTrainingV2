# Optional self-hosted deploy (VPS, Railway, Fly.io). Netlify doesn't use this file.
# With a local SQLite file, mount a persistent volume at /app/data. With TURSO_DATABASE_URL set, no volume is needed.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN rm -f data/*.db* .env.local && npm run build

FROM node:22-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 DATABASE_PATH=/app/data/app.db
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
# Production dependencies (libsql ships a prebuilt native SQLite binary). Plan and migrations are bundled in the build.
COPY --from=prod-deps /app/node_modules ./node_modules
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
VOLUME ["/app/data"]
EXPOSE 3000
CMD ["node", "server.js"]
