# Raptoru production bot (LeCroupier_) — container image for the VPS (docs/PLAN_POST_LIVE_2026-10-21.md, lots 2 and 4).
# Build context = the monorepo ROOT (the bot uses the @raptoru/schemas workspace):
#   docker build -f apps/twitch-bot/Dockerfile -t raptoru-bot .
# No port, no domain: the bot only calls the Core and Twitch. Configuration only through the environment (Coolify),
# never baked in. Every runtime file lives on the persistent volume /data: Twitch tokens (renewed and rewritten by the
# bot), the durable outboxes and the journals — the env paths below point there.
# Only one instance acts at a time (Core lease): a second container waits in standby, it never connects to Twitch.

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
RUN npm ci --workspace @raptoru/schemas --workspace @raptoru/twitch-bot --include-workspace-root
COPY packages/schemas/tsconfig.json packages/schemas/
COPY packages/schemas/src packages/schemas/src
COPY apps/twitch-bot/tsconfig.json apps/twitch-bot/tsconfig.build.json apps/twitch-bot/
COPY apps/twitch-bot/src apps/twitch-bot/src
RUN npm run build -w @raptoru/schemas && npm run build -w @raptoru/twitch-bot

FROM node:22-bookworm-slim
WORKDIR /app
# Coolify passes the deployed commit as SOURCE_COMMIT: shown by Studio as the bot's version.
ARG SOURCE_COMMIT=dev
ENV NODE_ENV=production \
    SOURCE_COMMIT=${SOURCE_COMMIT} \
    BOT_HOST=vps \
    BOT_ALIVE_FILE=/data/alive \
    TWITCH_TOKEN_FILE=/data/.twitch-tokens.json \
    TWITCH_BROADCASTER_TOKEN_FILE=/data/.twitch-tokens.broadcaster.json \
    LOYALTY_OUTBOX_FILE=/data/.loyalty-outbox.json \
    CHANNEL_POINTS_OUTBOX_FILE=/data/.channel-points-outbox.json \
    ALERTS_OUTBOX_FILE=/data/.alerts-outbox.json \
    CHAT_GAMES_JOURNAL_FILE=/data/.chat-games-journal.json \
    RANDOM_BAN_JOURNAL_FILE=/data/.random-ban-journal.json \
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
RUN npm ci --omit=dev --workspace @raptoru/schemas --workspace @raptoru/twitch-bot \
    && npm cache clean --force \
    && mkdir -p /data && chown node:node /data
COPY --from=build /app/packages/schemas/dist packages/schemas/dist
COPY --from=build /app/apps/twitch-bot/dist apps/twitch-bot/dist
USER node
VOLUME ["/data"]
# Healthy = the Core answered the lease less than 90 s ago (holder OR standby: a new container waiting for the old
# one to release during a rolling deploy is healthy). Nothing to do with Twitch: Studio shows that (lease health).
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["node", "-e", "const f=require('fs');try{process.exit(Date.now()-f.statSync(process.env.BOT_ALIVE_FILE).mtimeMs<90000?0:1)}catch{process.exit(1)}"]
# node is PID 1: SIGTERM (docker stop / Coolify) runs the bot's clean stop (lease released) within the 10 s grace.
CMD ["node", "apps/twitch-bot/dist/index.js"]
