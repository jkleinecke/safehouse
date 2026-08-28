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

Dev/test database is embedded PGlite (real Postgres in-process, `./data/pglite`).
Set `DATABASE_URL` to use a real Postgres (production compose in `infra/`).

Players join by scanning the QR on the GM screen. The TV joins as a `display`
device at `/tv`. The Fixer activates when `LLM_BASE_URL` points at an
OpenAI-compatible endpoint (llama.cpp / vLLM on the inference box).
