# Raptoru Core (core-api) — container image for a hosted Core (staging first; ASTRA-P1-019).
# Build context = the monorepo ROOT (the Core uses the @raptoru/schemas workspace and the migrator
# reads supabase/migrations relative to the repository layout):
#   docker build -f apps/core-api/Dockerfile -t raptoru-core .
# Plain HTTP on PORT (3000): TLS is terminated by the reverse proxy (Coolify). Configuration only
# through the environment (DATABASE_URL, BOT_SECRET, STUDIO_SECRET…), never baked into the image.
# Migrations: a one-shot `node apps/core-api/dist/scripts/migrate.js` (production scope).

# Every workspace manifest is copied: npm ci checks the whole lockfile even when installing two
# workspaces. Only @raptoru/schemas and @raptoru/core-api are installed and built.
FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    npm_config_audit=false \
    npm_config_fund=false
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/schemas/package.json packages/schemas/
COPY apps/core-api/package.json apps/core-api/
COPY apps/twitch-bot/package.json apps/twitch-bot/
COPY apps/twitch-extension/package.json apps/twitch-extension/
COPY apps/viewer-web/package.json apps/viewer-web/
COPY apps/studio/server/package.json apps/studio/server/
COPY apps/studio/web/package.json apps/studio/web/
COPY apps/studio/desktop/package.json apps/studio/desktop/
RUN npm ci --workspace @raptoru/schemas --workspace @raptoru/core-api --include-workspace-root
COPY packages/schemas/tsconfig.json packages/schemas/
COPY packages/schemas/src packages/schemas/src
COPY apps/core-api/tsconfig.json apps/core-api/tsconfig.build.json apps/core-api/
COPY apps/core-api/src apps/core-api/src
RUN npm run build -w @raptoru/schemas && npm run build -w @raptoru/core-api

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    npm_config_audit=false \
    npm_config_fund=false
COPY package.json package-lock.json ./
COPY packages/schemas/package.json packages/schemas/
COPY apps/core-api/package.json apps/core-api/
COPY apps/twitch-bot/package.json apps/twitch-bot/
COPY apps/twitch-extension/package.json apps/twitch-extension/
COPY apps/viewer-web/package.json apps/viewer-web/
COPY apps/studio/server/package.json apps/studio/server/
COPY apps/studio/web/package.json apps/studio/web/
COPY apps/studio/desktop/package.json apps/studio/desktop/
RUN npm ci --omit=dev --workspace @raptoru/schemas --workspace @raptoru/core-api \
    && npm cache clean --force
COPY --from=build /app/packages/schemas/dist packages/schemas/dist
COPY --from=build /app/apps/core-api/dist apps/core-api/dist
COPY supabase/migrations supabase/migrations
USER node
EXPOSE 3000
# Readiness (database reachable), the same probe Coolify uses.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/ready').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "apps/core-api/dist/index.js"]
