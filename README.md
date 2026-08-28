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
pnpm seed:books      # register the PDF library + extract page text (PDFs stay out of git)
pnpm seed:demo       # seed the demo campaign
pnpm dev:server      # API + WS on :8787
pnpm dev:web         # web app on :5173
```

Dev/test database is embedded PGlite (real Postgres in-process, `./data/pglite`) —
no Docker needed to develop or to run a session. Set `DATABASE_URL` to use a real
Postgres; the production stack is `infra/docker-compose.yml`.

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
