# Safehouse app image — server + the built SPA it serves (DESIGN.md §16).
#
# Build context is the REPO ROOT:
#   docker buildx build -f infra/Dockerfile --platform linux/amd64,linux/arm64 .
#
# Multi-arch by construction (§16): node:22-bookworm-slim publishes amd64 and
# arm64, and every runtime dependency here is pure JS or WASM (pglite, unpdf) —
# nothing in the stack carries an x86-only native binary. Adding one is a build
# failure on the arm64 leg, not a surprise at the venue.
#
# The image keeps the workspace layout (/app/apps/server, /app/apps/web,
# /app/packages/*) because the server resolves the SPA at ../../web/dist and the
# migrations at packages/db/migrations, both relative to their own dist files.

# ---------------------------------------------------------------- build stage
FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

# Manifests first so the dependency layer caches independently of source.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/rules/package.json    packages/rules/
COPY packages/db/package.json       packages/db/
COPY apps/server/package.json       apps/server/
COPY apps/web/package.json          apps/web/
RUN pnpm install --frozen-lockfile

COPY packages/ packages/
COPY apps/     apps/
RUN pnpm -r --workspace-concurrency=1 build

# -------------------------------------------------------------- runtime stage
FROM node:22-bookworm-slim AS runtime
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NODE_ENV=production
RUN corepack enable
WORKDIR /app

# Production dependency tree only (no vite, no vitest, no drizzle-kit).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/rules/package.json    packages/rules/
COPY packages/db/package.json       packages/db/
COPY apps/server/package.json       apps/server/
COPY apps/web/package.json          apps/web/
# Builds allowed by pnpm-workspace.yaml still run; the dev-only ones (esbuild,
# tailwind oxide) are simply not installed here.
RUN pnpm install --frozen-lockfile --prod

# Compiled output, in the same relative layout the server expects.
COPY --from=build /app/packages/contracts/dist packages/contracts/dist
COPY --from=build /app/packages/rules/dist     packages/rules/dist
COPY --from=build /app/packages/db/dist        packages/db/dist
COPY --from=build /app/packages/db/migrations  packages/db/migrations
COPY --from=build /app/apps/server/dist        apps/server/dist
COPY --from=build /app/apps/web/dist           apps/web/dist

# DATA_DIR holds the file store (maps, tokens, book PDFs) — a named volume in
# compose so `docker compose down` never eats the library.
ENV PORT=8787
ENV DATA_DIR=/data
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/server/dist/index.js"]
