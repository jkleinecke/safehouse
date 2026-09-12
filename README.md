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
Postgres; the production stack is `compose.yaml`, run with `pnpm docker:up`
(see [Deploying](#deploying)). PGlite is single-process: stop the server before
seeding, and let the seeder exit before starting it again.

## The rulebook library

The GM's own purchased PDFs become the app's library: ref chips like `SR5 p.426`
open the right page in-app, and the page text backs search and the Fixer. The
PDFs stay on the machine — gitignored, never uploaded, never inside a Docker
image.

Where they go depends on how you launch:

- **native** (`pnpm dev:server`) — put the PDFs in `books/` at the repo root
  (or name the folder once as `BOOKS_DIR` in `.env`, or pass `--dir D:/books`),
  stop the server, then `pnpm seed:books --calibrate`;
- **Docker stack** — put the PDFs in `books/` (or name the folder once as
  `BOOKS_DIR` in `.env`), then `pnpm docker:seed` —
  [docs/BOOKS.md §3](docs/BOOKS.md).
  They are bind-mounted read-only and the seeder writes into the same `files`
  volume the app reads, so there is no copy step and nothing to stop.

Do not skip calibration — it is explicit on the native path and the `seed`
service's default on the Docker one. Front matter shifts printed page numbers
against PDF pages and the seeder's `+0` guess is wrong for 15 of the 17
production books, so an uncalibrated chip for `RG p.104` opens the wrong leaf —
silently. **[docs/BOOKS.md](docs/BOOKS.md)** is the whole story.

Seeding also reads every gear table and spell block off the pages into a
**catalogue**: from a sheet's Gear, Combat or Magic tab, **+ from the books**
finds a weapon, armor, 'ware, a spell or a power by name and adds it with the
stats the book printed and its page as the ref — optionally proposing the
nuyen on the ledger for the GM to approve — or **write your own** for a thing
in no book. Player or GM, on any sheet they may edit. How the runner got it is the
table's business; the app keeps the inventory and the numbers. Nothing is
shipped: the catalogue is compiled from your PDFs into your database
([docs/BOOKS.md §3b](docs/BOOKS.md)). `pnpm seed:books --catalogue` recompiles
it without touching the PDFs.

Players join by scanning the QR on the GM screen. The TV joins as a `display`
device at `/tv`.

**Which AI** is chosen in the app — GM console ▸ **AI** (the same panel sits at
the top of the Fixer page, and the console's setup checklist has a row for it)
— saved per campaign, and it takes effect on the next message. Local box
(llama.cpp / vLLM / TabbyAPI, any OpenAI-compatible URL ending in `/v1`;
**check the box** lists the model ids it serves, and from inside Docker the
address is `http://host.docker.internal:<port>/v1`, never `127.0.0.1`),
Anthropic, OpenAI or xAI; keys are stored server-side and never sent back to a
browser. `LLM_BASE_URL` in `.env` only sets what a campaign uses until a
choice is made there. With neither, every AI feature degrades to its manual path
and nothing else changes.

Every AI request — the Fixer chat, an NPC voice, a floor from a description, a
page from the codex — shows on an activity bar across the GM console while it
runs, and the bar's **cancel** stops it. For a whole stretch of play at once, GM
console ▸ **Architect**: one brief becomes an outline of codex pages, NPCs and
scenes; tick what you want and each item is built the way the Fixer's drafts
are — pages and NPCs in the drafts inbox, scenes staged with a floor laid out
by the floor builder, never active until you say.

## Coming back next session

Campaigns live in the database, so closing the laptop is not something you have
to recover from.

**The short version, for a private table.** Set `SAFEHOUSE_OPEN_TABLE=1` in
`.env` and the front door lists every campaign on the server — each with the
name of the GM who started it — and lets whoever is sitting there claim the GM
chair with one tap. No token, no code, nothing to remember, from any device
that can reach the app. That is the mode this repo ships configured for, and it
is the right one for friends around a laptop.

It is also exactly what it sounds like: with the switch on there is no
credential of any kind between the network and the GM console. Fine on a home
network; never on a machine reachable from the internet. The server logs a
warning at every boot while it is on. Removing the line from `.env` restores
everything below, which is the whole of "add real auth later".

The rest of this section is what happens with the switch **off** — three cases,
in the order you will meet them:

**Same browser, next week.** Just open the app. Device tokens are stored per
(campaign, role), so the front door takes you straight in when this browser
holds exactly one, and lists your campaigns to pick from when it holds several.
Nothing to remember, nothing to type. The header's role chip switches this tab
between devices the browser already holds.

**Cleared storage, on the laptop hosting the server.** Open the app on
**`http://localhost:8787`** — loopback, *not* the LAN address the players use.
The front door asks the server which campaigns this machine holds, lists them,
and a tap mints a fresh GM device bound to that campaign's existing owner. This
is deliberately loopback-only: a browser on the host can already read the
database off the disk, so it is not a weaker credential than a token — every
other device on the Wi-Fi gets a flat 403, including that same laptop reached
through its own LAN address.

**Anywhere else — a spare machine, or the Docker stack.** Under Docker the host
arrives from the bridge gateway rather than loopback, so the front door refuses
there too (it cannot tell the host apart from a phone on the venue Wi-Fi). Mint
a sign-in from a shell on the box that owns the database instead:

```bash
# native / PGlite — stop the dev server first; PGlite is single-process
pnpm --filter @safehouse/server gm:token --list
pnpm --filter @safehouse/server gm:token --campaign "Neon Rain"
```

It prints a single-use `/join/<code>` URL to open in the GM's browser, plus a
long-lived token and campaign id for the front door's **paste a token** tab.
Add `--origin http://<the address the GM actually types>:8787` when the printed
URL is not reachable — only the origin changes, the code is the same. It reads
`.env` and prints which database it resolved, so it cannot silently mint into an
empty local PGlite while the real campaign lives in Compose.

Under Docker the same CLI runs in the one-shot `seed` image — the only one
carrying the source and `tsx`:

```bash
pnpm docker:token --origin http://192.168.1.20:8787
```

`docker compose exec app` cannot run the CLI: the runtime image is
production-only, no source and no `tsx`. What `exec` *can* do is call the
recovery route from inside the container, where 127.0.0.1 genuinely is loopback:

```bash
docker compose exec app node -e "fetch('http://127.0.0.1:8787/api/gm/recover',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}).then(r=>r.json()).then(o=>console.log(JSON.stringify(o,null,2)))"
```

That prints `{ campaignId, token, … }` for the paste tab. With more than one
campaign it answers 409 and lists them — put the one you want in the body as
`{"campaignId":"…"}`.

Neither path can create a user or invent a GM: both mint for the campaign's
existing owner of record. A device you regret is one
`POST /api/devices/:id/revoke` away (FR1.3), and the CLI prints the device id
for exactly that.

## Configuration

**One file: `.env` at the repo root.** Both the shell start (`pnpm dev:server`)
and the compose stack read it — compose by itself, because `compose.yaml` sits
beside it, so no `--env-file` anywhere. `pnpm docker:up` creates it from
`.env.example` on first run and generates the two secrets the stack refuses to
start without (`SESSION_SECRET`, `POSTGRES_PASSWORD`); everything else has a
working default. There is no `infra/.env` any more — if one is still lying
around, the server says so at boot and ignores it.

Env vars are **starting points**, not the live configuration. In particular
the AI: `LLM_BASE_URL` / `LLM_MODEL_*` only decide what a campaign uses until
a GM picks one in the app (GM console ▸ AI), and that choice is
saved in the database and wins from then on. Changing `.env` after that changes
nothing — the panel tells you which it is using.

See [docs/demo/CAMPAIGN.md](docs/demo/CAMPAIGN.md) for what `seed:demo` puts in
the database.

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
pnpm docker:up
```

That is the whole thing, every time: it creates `.env` on the first run (and
generates the two secrets), **rebuilds the image from this checkout** — a plain
`docker compose up -d` without `--build` restarts last week's image and says
nothing, which is how "is this the latest?" became a question — stamps it with
the commit it came from, starts the stack, waits for `/healthz` and prints:

```
[safehouse] running build 1a2b3c4 (built just now) at http://localhost:8787
[safehouse] that is this checkout — HEAD is 1a2b3c4
```

The same build stamp is in the corner of the front door and the GM console,
and a tab left open across a rebuild says *"this page is from … — reload"*.
Later, `pnpm docker:status` re-asks the running server and compares it to your
checkout; `pnpm docker:logs` follows the app; `pnpm docker:down` stops it
(volumes — the campaign, the books — survive).

`app` (server + built SPA) · `postgres:16` · `backup` (nightly dump + file-store
sync). No reverse proxy — plain HTTP on the LAN. The optional `llm` profile
(`pnpm docker:up --profile llm`) runs llama.cpp over a gitignored `models/`
folder as the away-game fallback; normally the GM points the app at the
inference box instead.

**Loading the rulebooks into the stack.** Put the PDFs in `books/` — or point
`BOOKS_DIR` in `.env` at wherever they are — then:

```bash
pnpm docker:seed
```

The one-shot `seed` service builds from the Dockerfile's `seed` stage — the only
one carrying `tsx` and the source — bind-mounts your folder **read-only** at
`/books`, and writes into the same `files` volume and the same Postgres the app
uses. So the books are never copied into an image (DESIGN.md §14.8), there is no
`docker compose cp` afterwards, and the app need not be stopped. `--calibrate`
is the service's default; any flag you pass (`pnpm docker:seed --list`,
`--only SR5 --calibrate`) replaces it. `pnpm docker:demo` seeds the demo
campaign the same way. [docs/BOOKS.md §3](docs/BOOKS.md) has the rest.

**Coming from the old layout?** The compose file used to live in `infra/`,
which named the Docker project `infra` and read `infra/.env`. The first
`pnpm docker:up` adopts that stack's volumes (`infra_pgdata`, `infra_files`)
into the new `safehouse_*` ones and leaves the originals for you to delete;
`infra/.env` is no longer read by anything, and the server says so at boot
until you remove it. Relative paths in `.env` now resolve from the repo root,
so an old `BOOKS_DIR=../books` should become `./books` (the script warns), and
the default `BACKUP_DIR=./backups` is the repo's own `backups/` folder — older
dumps stay where they were, in `infra/backups/`.
