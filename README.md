# Safehouse

A self-hosted web platform for running a Shadowrun 5e campaign from the GM's laptop.
The whole campaign in a backpack: live-table mechanics, the Grid (maps/tokens/fog on
the table TV), the Opposition Kit (NPC generator + combat copilot), a deep-linked
rulebook library, campaign memory, and the Fixer — a fully local AI copilot.

**The spec is [DESIGN.md](DESIGN.md) (rev 0.9).** Success criterion: retire Roll20.

## Quick start

```bash
pnpm install
pnpm build
pnpm seed:books --calibrate   # register the PDF rulebook library, measure page offsets
pnpm seed:demo       # seed the demo campaign
pnpm dev:server      # API + WS on :8787
pnpm dev:web         # web app on :5173
```

Dev/test database is embedded PGlite (real Postgres in-process, `./data/pglite`) —
no Docker needed to develop or to run a session. Set `DATABASE_URL` to use a real
Postgres; the production stack is `infra/docker-compose.yml`. PGlite is
single-process: stop the server before seeding, and let the seeder exit before
starting it again.

## The rulebook library

The GM's own purchased PDFs become the app's library: ref chips like `SR5 p.426`
open the right page in-app, and the page text backs search and the Fixer. The
PDFs stay on the machine — gitignored, never uploaded. **[docs/BOOKS.md](docs/BOOKS.md)**
is the whole story: where the files live, what `pnpm seed:books` does, and why
page offsets are the step nobody can skip. Front matter shifts printed page
numbers against PDF pages, and the seeder's `+0` guess is wrong for 15 of the
17 production books — `--calibrate` measures the real number from the pages
themselves instead, so a chip for `RG p.104` opens page 104.

Players join by scanning the QR on the GM screen. The TV joins as a `display`
device at `/tv`. The Fixer activates when `LLM_BASE_URL` points at an
OpenAI-compatible endpoint (llama.cpp / vLLM on the inference box) — with it
unset, every AI feature degrades to its manual path and nothing else changes.

## Configuration

Copy `.env.example` to `.env` and edit. Everything has a working default except
`SESSION_SECRET` and `POSTGRES_PASSWORD`, which the compose stack refuses to
start without. See [docs/demo/CAMPAIGN.md](docs/demo/CAMPAIGN.md) for what
`seed:demo` puts in the database.

## Verifying it works

```bash
pnpm typecheck && pnpm build && pnpm test
node .github/scripts/smoke.mjs   # boots the built server, plays a roll through it
```

The smoke script starts the server on a throwaway `DATA_DIR`, waits for
`/healthz`, then runs `apps/server/scripts/playthrough.ts`: bootstrap a
campaign, advance the clock, mint an invite, join a phone, open two sockets,
roll a die authoritatively over WS, confirm it persisted and reached both
sockets, and confirm the SPA is served. CI runs the same thing on every push,
plus a multi-arch (amd64 + arm64) image build.

To point the playthrough at a server you already have running:

```bash
SAFEHOUSE_URL=http://127.0.0.1:8787 pnpm playthrough
```

## Deploying

```bash
cp .env.example .env   # set SESSION_SECRET and POSTGRES_PASSWORD
docker compose -f infra/docker-compose.yml --env-file .env up -d
```

`app` (server + built SPA) · `postgres:16` · `backup` (nightly dump + file-store
sync). No reverse proxy — plain HTTP on the LAN. The optional `llm` profile runs
llama.cpp over a gitignored `models/` folder as the away-game fallback; normally
`LLM_BASE_URL` points at the inference box instead.
