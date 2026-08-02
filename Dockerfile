# Multi-stage build for the Qwixx monorepo: builds @quixx/engine,
# @quixx/server, and @quixx/client, then ships a single runtime image that
# serves the built client as static files from the Fastify server — one
# process, one port.
#
# Uses the glibc-based "bookworm-slim" image (not alpine) because
# better-sqlite3 is a native module; alpine's musl libc complicates
# native-module builds/prebuilds. See README "Deploying to Azure" for the
# single-instance constraint (game state lives in process memory).

FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/engine/package.json packages/engine/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/client/package.json packages/client/package.json
RUN npm ci

COPY packages/engine packages/engine
COPY packages/server packages/server
COPY packages/client packages/client

RUN npm run build -w @quixx/engine \
 && npm run build -w @quixx/server \
 && npm run build -w @quixx/client

# Prune devDependencies out of node_modules for a smaller runtime image.
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules node_modules
COPY --from=build /app/package.json package.json
COPY --from=build /app/packages/engine/package.json packages/engine/package.json
COPY --from=build /app/packages/engine/dist packages/engine/dist
COPY --from=build /app/packages/server/package.json packages/server/package.json
COPY --from=build /app/packages/server/dist packages/server/dist
COPY --from=build /app/packages/client/dist packages/client/dist

# Data directory for the SQLite file — mount a persistent volume here in
# production (see README). Falls back to in-memory storage automatically
# if better-sqlite3 can't open it (see store/sqlite.ts).
RUN mkdir -p /data
ENV QUIXX_DB_PATH=/data/quixx.sqlite
ENV QUIXX_CLIENT_DIST=/app/packages/client/dist
ENV PORT=3000

EXPOSE 3000
CMD ["node", "packages/server/dist/index.js"]
