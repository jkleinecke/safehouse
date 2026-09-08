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
# `apps/web`'s postinstall vendors pdf.js (§13, self-hosted — no CDN), so its
# script has to exist before the install layer runs. It is copied separately
# and ahead of the source so the dependency layer still caches on manifests
# alone; `apps/web/build` re-runs the same script, so a future change here
# degrades to a slower build, never a broken one.
COPY apps/web/scripts/              apps/web/scripts/
RUN pnpm install --frozen-lockfile

COPY packages/ packages/
COPY apps/     apps/
# The build stamp — the short commit (`-dirty` if the tree was) and the time —
# passed by `pnpm docker:up` through compose, and by CI from the commit.
# Declared this late on purpose: a new commit invalidates the build below and
# never the dependency layer above. Vite bakes both into the SPA here, and the
# `runtime` stage puts the same two values in the server's environment, so
# /healthz, the boot log and the page footer all name one build.
ARG SAFEHOUSE_VERSION=dev
ARG SAFEHOUSE_BUILT_AT=
ENV SAFEHOUSE_VERSION=$SAFEHOUSE_VERSION SAFEHOUSE_BUILT_AT=$SAFEHOUSE_BUILT_AT
RUN pnpm -r --workspace-concurrency=1 build

# ----------------------------------------------------------------- seed stage
# The one-shot seeding image (compose service `seed`): `seed:books` (FR11.7)
# and `seed:demo`, run INSIDE the stack against the `postgres` service.
#
# It inherits `build` and that is the whole point — source, dev dependencies
# and tsx are already here, and none of them reach `runtime` below, which is
# why the production image can stay production-only. It adds two empty
# directories and a package-manager cache on top of `build` and nothing else,
# so the app image pays for none of it.
#
# KEEP THIS STAGE ABOVE `runtime`. The last stage in the file is what a plain
# `docker build -f infra/Dockerfile .` produces, and that has to remain the
# app; compose pins `target:` for both services, but nothing else does.
FROM build AS seed
# /books is where compose bind-mounts the GM's PDF folder, READ-ONLY. It is a
# mount point and stays EMPTY in the image: the books are the owner's own
# copies and never enter a layer (DESIGN.md §14) — a `COPY` of a book here
# would be a licensing bug, not a convenience.
#
# /data mirrors the app's DATA_DIR, node-owned exactly as in `runtime`. Docker
# seeds a fresh named volume from the image of whichever container mounts it
# first, and that can be this one — a GM may seed the library before the first
# `up -d`. Without the chown, that volume would come up root-owned and the app
# (USER node) could not write a single upload into its own file store.
RUN mkdir -p /books /data/files && chown -R node:node /data
ENV DATA_DIR=/data

# Corepack caches the pnpm it downloads under the HOME of whoever ran it — in
# `build`, root. A seed container running as `node` would find that cache
# unreadable and re-download pnpm on every single run: slow at best, and at a
# venue with no internet, a seeding step that simply fails (Principle 5 — the
# stack owes nobody a network). So stage the cache somewhere both users can
# reach it. No version is named: `corepack prepare` reads `packageManager`
# out of /app/package.json, which is the one place it is allowed to live.
ENV COREPACK_HOME=/opt/corepack
RUN corepack prepare --activate && chown -R node:node /opt/corepack

# Same uid as the app, so seeded PDFs and app uploads land under one owner and
# neither can lock the other out of the file store. /app is world-readable, so
# nothing here wants root.
USER node
# Overridden per invocation by compose; a bare `docker run` on this image
# prints what a seed would import and writes nothing.
ENTRYPOINT ["pnpm", "--filter", "@safehouse/server", "seed:books", "--dir", "/books"]
CMD ["--list"]

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
#
# `--ignore-scripts`: the only lifecycle script in the prod tree is
# `apps/web`'s pdf.js vendoring, and this stage has neither its script nor any
# reason to run it — the assets were vendored in the build stage and travel in
# `apps/web/dist` below. Every prod dependency is pure JS or WASM (pglite,
# unpdf), so nothing here needs a native build step (§16).
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

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

# The same stamp the build stage baked into the SPA (see there), now in the
# server's environment: `/healthz` reports it, and `docker inspect` can read
# it off the image without starting a container.
ARG SAFEHOUSE_VERSION=dev
ARG SAFEHOUSE_BUILT_AT=
ENV SAFEHOUSE_VERSION=$SAFEHOUSE_VERSION SAFEHOUSE_BUILT_AT=$SAFEHOUSE_BUILT_AT
LABEL org.opencontainers.image.revision=$SAFEHOUSE_VERSION \
      org.opencontainers.image.created=$SAFEHOUSE_BUILT_AT

CMD ["node", "apps/server/dist/index.js"]
