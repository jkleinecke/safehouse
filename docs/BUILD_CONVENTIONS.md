# Safehouse build conventions (binding for all build agents)

The spec is `DESIGN.md` (rev 0.9) at repo root. This file is the **canonical interface
contract** between packages built in parallel. Do not rename anything defined here.
If you need something not defined here, code against your best reading of DESIGN.md
and leave a `// INTEGRATION:` comment for the integration pass.

## Monorepo

```
apps/server      @safehouse/server    Fastify + ws API, serves web build in prod
apps/web         @safehouse/web       React SPA (Vite), PixiJS Grid, TV kiosk
packages/contracts @safehouse/contracts  Zod schemas + inferred types (the boundary language)
packages/rules   @safehouse/rules     Pure SR5 engine (no I/O, no DOM, no db)
packages/db      @safehouse/db        Drizzle schema, migrations, db client, FTS helpers
infra/           docker-compose.yml (prod), Caddy nothing (plain HTTP on LAN)
docs/            DESIGN.md lives at root; build docs here
seed/            demo campaign fixtures
scripts/         playthrough + utilities (run via tsx)
```

- TypeScript strict, ESM (`"type": "module"`), extends root `tsconfig.base.json`.
- Tests: **vitest** in each package (`pnpm --filter <pkg> test`). Scripts run via **tsx**.
- Workspace deps: `"@safehouse/contracts": "workspace:*"` etc.
- Every package has scripts: `build` (tsc -b or vite build), `typecheck` (tsc --noEmit), `test` (vitest run; `--passWithNoTests` acceptable only for apps/web).
- Windows host. Do not write bash-isms into package scripts; plain node/tsx commands only.

## Ports, env, database

- Server: **http://localhost:8787** (REST `/api/*`, WS `/ws`, files `/files/:id`, join `/join/:code`, reader `/read/:bookCode`, health `/healthz`). Vite dev server 5173 proxies `/api`, `/ws`, `/files`, `/read`, `/join` to 8787.
- Env (all optional except noted): `PORT` (8787), `DATA_DIR` (`./data`, gitignored; file store at `data/files`, PGlite at `data/pglite`), `DATABASE_URL` (when set, use node-postgres; else **PGlite**), `SESSION_SECRET`, `DISCORD_WEBHOOK_URL`, `LLM_BASE_URL`, `LLM_MODEL_PRIMARY`, `LLM_MODEL_FAST`.
- **Database: Drizzle ORM.** Client factory in `@safehouse/db` exports `getDb()` returning a Drizzle instance backed by PGlite (`drizzle-orm/pglite`, dir `DATA_DIR/pglite`) or node-postgres when `DATABASE_URL` is set. Migrations in `packages/db/migrations`, applied programmatically on server start via drizzle's `migrate()`. Tables exactly as DESIGN.md §9.2 (snake_case). FTS: `book_pages.tsv` is a generated tsvector column (english); helper `searchBookPages(db, query, opts)` and `searchCodex(db, query)` exported from `@safehouse/db`.
- Tests that need a db use a throwaway PGlite instance (in-memory or temp dir) with migrations applied. Never require Docker (no registry access on this machine).

## Canonical types (defined in @safehouse/contracts, imported everywhere)

- `Visibility = 'public' | 'gm' | 'gm_owner'`
- `Role = 'gm' | 'player' | 'observer' | 'display'`
- `Modifier { id, source: { kind: 'cyberware'|'quality'|'power'|'spell'|'wound'|'status'|'scene'|'range'|'situational'|'override', ref?: string }, target: string, op: 'add'|'set'|'cap', value: number, active: boolean, note?: string }`
  - `target` examples: `attr.rea`, `initiative.dice`, `initiative.score`, `limit.physical`, `pool.skill.<id>`, `pool.all`, `armor`
- `SheetV1` — DESIGN.md §9.3 exactly (`v: 1`, identity, attributes incl. `edg {max,current}`, skills, qualities, augments, weapons (with `rangeCat`, `ammo`), armor, spells, powers, complexForms, matrix, gear, lifestyles, rangeTables, overrides). Refs are `{ book: string, page: number, note?: string }`.
- `DerivedCharacter` — output of the rules engine: `attributes`, `limits {physical,mental,social}`, `monitors {physical,stun,overflow}` (sizes), `initiative {physical:{base,dice}, astral, matrixAR, vrCold, vrHot}`, `movement {walk,run}`, `pools: Record<string, PoolBreakdown>`, each value carrying `breakdown: { label, value, source }[]` (provenance, Principle 3).
- `RollRequest { kind: 'simple'|'opposed'|'threshold'|'extended'|'teamwork', pool: number, breakdown: {label,value}[], limit?: {kind,value}, edge?: 'push_pre'|'push_post'|'second_chance'|null, visibility: Visibility, actor: {characterId?|combatantId?|gm:true}, meta?: Record<string,unknown> }`
- `RollResult { faces: number[], hits, ones, glitch: 'none'|'glitch'|'critical', limitedHits, exploded?: number[] }`
- `WsEvent { id: number, type: string, payload: unknown, visibility: Visibility, ownerUserId?: string, ts: string }` — persisted events. Ephemeral messages use `{ type, payload, ephemeral: true }` and are never stored. Event `type` strings exactly as DESIGN.md §11 catalog (`roll.created`, `token.moved`, `token.dragging`, `fog.updated`, `scene.activated`, `encounter.updated`, `combatant.damaged`, …).
- Client→server WS commands: `{ cmd: string, ...payload }` (`roll.request`, `token.move`, `token.drag`, `fog.reveal`, `encounter.advance`, `damage.apply`, `ping`).
- API errors: `{ error: { code: string, message: string, details?: unknown } }`.
- Auth: device token via `Authorization: Bearer <token>` (also accepted as `?token=` on WS/files). `GET /join/:code` mints a device + long-lived token, role-scoped (FR1.1/1.3).

## Key engine functions (@safehouse/rules — pure, no I/O)

- `deriveCharacter(sheet: SheetV1, ctx?: { situational?: Modifier[], wounds?: {physical,stun} }): DerivedCharacter`
- `resolveRoll(req: RollRequest, rng: () => number): RollResult` (Rule of Six on edge, glitch = ones > floor(dice/2), buying hits helper `buyHits(pool)`)
- `combat` module: `rollInitiative`, `advancePass` (−10 loop, FR4.3), `applyInterrupt`, `applyDamage` (soak → monitor → overflow → wound modifiers), `resolveAttackChain` (FR10.8: attack vs defense → net hits → DV − soak → boxes), `checkMorale(prState, triggers)`
- `environment(scene): Modifier[]` (SR5 env table tiers −1/−3/−6/−10), `rangeModifier(distM, rangeCat, rangeTables)`
- `generator`: `generateNpc(template, tier, seed)`, `generateGruntGroup(...)` — seeded (mulberry32 or similar), output is a valid `SheetV1` subset + persona stub; flavor tables are original content in `packages/rules/src/generator/tables.ts`.

## Dependency budget (pre-approved; avoid others — note `// INTEGRATION:` if you must)

- contracts: `zod`
- rules: (runtime none) + workspace contracts
- db: `drizzle-orm`, `@electric-sql/pglite`, `pg`, `@types/pg`, `drizzle-kit` (dev)
- server: `fastify`, `@fastify/websocket`, `@fastify/static`, `@fastify/multipart`, `@fastify/cookie`, `pino`, `zod`, `qrcode`, `unpdf` (PDF text extraction), workspace deps
- web: `react`, `react-dom`, `react-router-dom`, `@tanstack/react-query`, `zustand`, `pixi.js`, `qrcode.react`, `tailwindcss` + `@tailwindcss/vite`, `vite`, `@vitejs/plugin-react` (dev), workspace contracts + rules
- Root dev deps already installed: typescript, tsx, vitest, @types/node

**Do not run `pnpm install` while other agents may be running it** (parallel phases). If you add a dependency mid-parallel-phase, add it to your package.json, keep coding, and note it — the next solo phase installs.

## Server architecture (apps/server)

- `src/app.ts` builds Fastify; `src/plugins/<domain>.ts` one plugin per domain: `auth`, `campaigns`, `characters`, `rolls`, `tables`, `scenes`, `encounters`, `generator`, `books`, `fixer`, `ledger`, `sessions`. `src/plugins/index.ts` registers all (created once by server-core with stubs — feature agents fill their own stub file ONLY).
- WS hub in `src/hub.ts` (server-core): rooms per campaign, `emit(campaignId, event)` persists to `ws_events` + broadcasts filtered by visibility/role; `emitEphemeral()` broadcasts only; replay from `last_event_id` on reconnect.
- Dice: `src/services/dice.ts` uses `crypto.randomInt`; all authoritative rolls go through it.
- The Fixer (`src/fixer/`): OpenAI-compatible client (plain `fetch`, streaming SSE), tool registry mapping FR12.17 catalog to service calls (Zod schemas → JSON schema), agent loop max 8 tool rounds, situation snapshot builder, drafts in `ai_generations`. **Mock LLM** for tests: `src/fixer/mock-llm.ts` starts an HTTP server speaking OpenAI chat-completions (scriptable canned turns incl. tool_calls) — used when `LLM_BASE_URL` unset in test mode.

## Web architecture (apps/web)

- Routes: `/join/:code`, `/c/:campaignId` (home), `/c/:id/sheet/:characterId`, `/c/:id/table` (log+tracker), `/c/:id/grid`, `/tv/:campaignId`, `/c/:id/gm/*` (scenes, generator, fixer, books, sessions), `/read/:bookCode` (iframe of server `/read` with `?p=` printed page).
- State: TanStack Query for CRUD; `src/live/` zustand store fed by the WS client (`src/live/socket.ts`, reconnect + replay via `last_event_id`).
- Dark cyberpunk theme, phone-first player views (390px), TV view high-contrast full-screen.
- Local dice preview uses `@safehouse/rules` `deriveCharacter` in the browser; server remains authoritative.

## Verification fixtures

- Chummer import: synthetic fixture at `apps/server/test/fixtures/chummer-sample.chum5` (Chummer5-style XML for an ORIGINAL character — never book content).
- Book seeding: `seed:books` accepts `--only <code>` to limit extraction (tests use the core book only; full library optional).
- Demo campaign: `seed/demo.ts` — see `docs/demo/CAMPAIGN.md`.

## Hard rules

1. No book text, stat blocks, or CGL content in code, fixtures, or flavor tables — original content only; refs are `{book,page}` numbers (G6/§14).
2. Every derived number carries provenance (Principle 3). GM override always possible (Principle 2).
3. Hidden data is filtered server-side, never client-side (Principle 4): hub filters by visibility; hidden tokens' coordinates never reach player/display sockets.
4. AI output only ever lands as `ai_generations` drafts (Principle 8). Reads via tool catalog are free.
5. The app must boot and play with NO `LLM_BASE_URL`, NO internet, NO Docker (NG7 / Principle 5).
