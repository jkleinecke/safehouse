# Safehouse — build report

What exists in this repo, measured against `DESIGN.md` rev 0.9 §6 (feature
modules) and §18 (roadmap). Rewritten from the code as it now stands — every FR
row below was re-read in the source, and every number below was produced by
running the command named beside it, not carried forward from a previous
revision.

- **Repo state:** 355 TS/TSX files of shipping source (~70.1k lines) across 5 workspace packages; 501 files / ~103.8k lines counting tests and the browser E2E suite. (`*.ts`/`*.tsx` under `apps/` and `packages/`, excluding `node_modules` and `dist`; seeds and scripts count as source, `test/`, `*.test.*` and `e2e/` do not.)
- **Verified on:** 2026-08-29. `pnpm -r --workspace-concurrency=1 typecheck` → exit 0. `pnpm -r --workspace-concurrency=1 build` → exit 0. `pnpm -r --workspace-concurrency=1 test` → **1633 passed, 3 skipped, 0 failed** across **120 test files**.
- **Scripted playthrough:** `pnpm playthrough` → **266 checks, 266 passed, 0 failed, 0 n/a**, 10.8 s (`docs/demo/SESSION_REPORT.md`). The count can move by one or two between runs because a handful of assertions are conditional on the night's dice; this run had no content-dependent skips.
- **Browser E2E:** `pnpm --filter @safehouse/web e2e` → **38 passed** in chromium, **13 spec files**, 50.9 s. One of the 38 is a deliberate `test.fail` marking a live gap (§6.1) rather than a passing assertion.
- **Bundle against §15:** initial JS **247.35 KB gz** (840.40 KB raw) against a < 500 KB gz budget, with PixiJS verified absent from the entry chunk. The Grid's lazy chunk is **107.07 KB gz** plus Pixi's own runtime splits (**76.7 KB gz** across eight files) — **≈184 KB gz** worst case against a < 900 KB gz budget. CSS 9.71 KB gz. Both budgets clear with roughly 2× and 5× headroom. Details and the one unmet sub-clause: §4.

Status vocabulary:

| Term | Meaning |
| --- | --- |
| `done` | Implemented end to end, server-authoritative where the FR requires it, covered by a test, a playthrough assertion, or an E2E spec. |
| `partial` | Core of the FR works; a named sub-clause is missing. Every one is itemized. |
| `deferred` | Not built, and §18 puts it in a phase we have not reached (P6) or Q9/Q3 resolved it as unused. Not a defect. |
| `not built` | In a phase we have otherwise shipped, but absent. These are the real gaps. |

---

## 1. Status by module

### M1 — Accounts, campaign, membership *(P0)*

| FR | Status | Where |
| --- | --- | --- |
| FR1.1 QR join, GM at install | done | `services/auth.ts` (`POST /api/campaigns` bootstrap, `GET /api/campaigns/:id/join-qr`, `GET\|POST /api/join/:code`), `plugins/auth.ts` (`POST /api/campaigns/:id/gm-device`, `POST …/gm-pair` — single-use GM pairing code). `web/src/components/shell/Landing.tsx` offers three tabs (start a campaign · pair with a code · paste a token) over `signin.ts` / `signin-api.ts`. `test/auth-gm.test.ts` (18), `e2e/gm-signin.spec.ts` (3). |
| FR1.2 one GM + players + observers; transfer ownership | done | Roles and membership in `memberships`/`Role`. Transfer: `POST /api/campaigns/:id/transfer-ownership` and `PATCH /api/characters/:id/owner` in `plugins/campaigns-admin.ts`. |
| FR1.3 expiring, role-scoped, revocable invites | done | `createInvite` (`expiresInMinutes`, `maxUses`), `POST /api/devices/:id/revoke`. `join-qr` refuses `role=gm` by construction — GM devices come only from bootstrap / `gm-device` / single-use `gm-pair`. |
| FR1.4 roles gate everything per §13 | done | `requireAuth`/`requireRole`/`assertCampaign`; hub filters by visibility server-side. Playthrough + `e2e/secrecy.spec.ts` (4). |
| FR1.5 campaign settings incl. house-rule flags + webhook | done | `PATCH /api/campaigns/:id`. The flag system now carries one real flag — `tacticalHints` (FR10.10) — and otherwise plays RAW per Q4. |

### M2 — Dice engine and roll log *(P1)*

| FR | Status | Where |
| --- | --- | --- |
| FR2.1 pool → hits/ones/glitch, server-rolled, persisted, broadcast | done | `services/dice.ts` (`crypto.randomInt`), `packages/rules/src/dice.ts`, `roll.created`. |
| FR2.2 limits, hits above limit shown but excluded | done | `limitedHits` + `limit` ref on every `RollResult`. |
| FR2.3 Edge actions | done | Push the Limit pre/post with Rule of Six, Second Chance, spend/burn, plus Seize the Initiative, Blitz and Close Call: `rules/src/dice.ts`, `services/rolls-edge.ts`, `POST /api/edge/{seize-initiative,blitz,close-call}`, client in `web/features/sheet/edgeActions.ts` + `components/CloseCallOffer.tsx`. `test/rolls-edge.test.ts` (12). |
| FR2.4 buying hits (4:1) | done | `POST /api/rolls/buy-hits`, `buyHits`. |
| FR2.5 simple / opposed / threshold / extended / teamwork | done | `services/rolls.ts`; extended loop with shrinking pool in `rules/src/dice.ts`. |
| FR2.6 provenance stored on the log entry | done | Breakdown persisted with the roll. |
| FR2.7 public / gm / gm_owner, filtered server-side | done | Hub visibility filter; `e2e/secrecy.spec.ts` asserts the *payload*, not the pixels. |
| FR2.8 free-form rolls + personal macros | **done** | Free-form via `POST /api/rolls`. The macro rack now follows the **person**: `user_macros` (`packages/db/src/schema.ts:466`, migration `0002_macros_and_usage.sql`, unique on `(user, campaign, label)`), five routes in `plugins/macros.ts`, and a server-first client with a local mirror in `web/features/sheet/macroStore.ts` that migrates the old device-local key with additive `POST` rather than `PUT`. `test/macros.test.ts` (20), `packages/db/test/macros-usage.test.ts`, web `macroStore.test.ts` (26) + `macroRack.test.tsx` (6), `e2e/macros.spec.ts` (2 — a macro made on one device is on a freshly paired one; another person on the same server does not get it). |
| FR2.9 append-only interleaved session log | done | `POST/GET /api/campaigns/:id/log` over `ws_events`. The FR that LIVE-4 killed outright on any seeded campaign; now covered across a process boundary by `test/seeded-boot.test.ts` and `test/restore-boot.test.ts`, and in the browser by `e2e/log-append.spec.ts`. |
| FR2.10 Discord mirroring of public rolls | done | `services/discord.ts`; `test/discord-recap.test.ts`. |
| FR2.11 campaign rollable tables | done | `/api/campaigns/:id/roll-tables`, `POST /api/roll-tables/:id/roll`; GM-only tables stay GM-only. |

### M3 — Characters *(P1 core)*

| FR | Status | Where |
| --- | --- | --- |
| FR3.1 Chummer `.chum5` import, raw file kept, unmapped listed, re-import diff | done | `services/chummer.ts` + `chummer-xml.ts`, `diffSheets`, `POST /api/characters/:id/import`. |
| FR3.2 phone-first sheet with tabs | partial | Skills, Combat, **Magic**, Gear, Contacts, Background, Ledger + pinned identity/vitals strip (`features/sheet/playState.ts` `SHEET_TABS`). **Missing: Matrix tab** — consistent with M7 being deferred, and the only thing holding this row at `partial`. |
| FR3.3 derived values with provenance | done | `deriveCharacter`, `GET /api/characters/:id/derived` (which also returns `combatantId` when the tracker is live — that is what makes Seize/Blitz offerable). |
| FR3.4 monitors, wound modifiers, Edge, ammo, progressive recoil, sustained, statuses | done | `services/character-play.ts`, `POST …/damage\|edge\|ammo\|recoil\|sustained`. |
| FR3.5 manual override on any derived value, flagged, with a note | done | `POST/DELETE /api/characters/:id/overrides`. |
| FR3.6 karma & nuyen ledgers, pending-until-approved | done | `plugins/ledger.ts`; approve/reject, now inside `Hub.atomic`. Run awards post through it (FR5.5). |
| FR3.7 advancement (guided karma spends) | deferred | Not built. Deliberate — see §5's deferred list. |
| FR3.8 revisions + rollback | done | `GET …/revisions`, `POST …/rollback`. |
| FR3.9 native priority char-gen | deferred | P6 by design (D5 — Chummer is the builder until then). |

### M4 — Combat tracker *(P1)*

| FR | Status | Where |
| --- | --- | --- |
| FR4.1 encounters from PCs / templates / generator / grunt groups; prep + launch, incl. from a scene | done | `plugins/encounters.ts`, `POST /api/scenes/:id/stage-encounter`. |
| FR4.2 SR5 initiative incl. astral / cold-sim / hot-sim variants, wound mods | done | `rules/src/combat/initiative.ts`. Staged encounters derive through the engine too (FR9.10). |
| FR4.3 native pass structure (−10 loop, re-roll on new turn) | done | `services/encounters.ts:369` — `rollInitiativeAll` opens on turn 1 / pass 1. |
| FR4.4 interrupt menu with editable costs | done | `DEFAULT_INTERRUPTS` + custom cost. Seize/Blitz reachable from the sheet and stamped into the tracker's order (`services/rolls-edge.ts`). |
| FR4.5 damage → monitor → overflow → wound recompute, one-tap undo | done | `services/encounters-damage.ts`, both write paths now inside `Hub.atomic`. |
| FR4.6 grunt groups, shared PR + Group Edge | done | `professionalRating` on `AddCombatantBody` and `PATCH /api/combatants/:id`. Playthrough asserts `pressure 4 vs PR 3`. |
| FR4.7 status effects with durations | done | `EffectDurationSchema` (`end_of_turn` / `while_sustained` / `passes` / `manual`). |
| FR4.8 everything hand-editable; "dumb mode" | done | `PATCH /api/combatants/:id`, `source: 'manual'`. |
| FR4.9 filtered player encounter view | done | Server-side; hidden rows absent, not redacted. `e2e/secrecy.spec.ts`. |
| FR4.10 tracker ↔ grid ↔ copilot | done | Acting-token glow, token bars from monitors, copilot rack on generator-backed rows, and now the FR10.10 hint line when the campaign opts in. |

### M9 — The Grid *(P2 core)*

| FR | Status | Where |
| --- | --- | --- |
| FR9.1 scenes, configurable grid, notes, activate, private staging | done | `plugins/scenes.ts`, `contracts/src/scene.ts`. |
| FR9.2 map building | done | Image upload, multi-image background list, grid alignment, walls/doors/zones with a GM authoring UI (`web/features/grid/gm/GeometryTab.tsx`, 20 tests), and scan-friendly rotate / crop / contrast / brightness (`gm/MapTab.tsx`, `mapImage.ts`, 13 tests). Prop/tile stamp library remains P3+ by design. |
| FR9.3 map pins → codex / handouts | done | `gm/PinsTab.tsx` and `stage/layers.ts drawPins`; GM-only pins stripped server-side in `sceneForViewer`. |
| FR9.4 tokens (PC/NPC/grunt/spirit/drone/prop), art, sizes, facing | done | `contracts/src/token.ts`, `POST /api/scenes/:id/tokens`. A summoned spirit can now become one of these (FR8.3). |
| FR9.5 drag with snap, server-authoritative, smooth interim motion | done | `token.drag` ephemeral + `token.move` authoritative. |
| FR9.6 bars, status markers, aura rings | done | `grid/projection.ts` gates numeric bars per viewer (27 tests). |
| FR9.7 hidden tokens — positions never sent | done | `e2e/secrecy.spec.ts` reads the client's own store, not the screen. Principle 4 held. |
| FR9.8 ruler in metres, walk/run colouring | done | `grid/geometry.ts` + tests. |
| FR9.9 range bands → range modifier into the roll | done | Range band lands in the receipt. |
| FR9.10 encounter ↔ scene both ways | done | `services/scenes.ts` `stageEncounter` derives through `deriveFor`, so wired reflexes and adept powers survive staging. |
| FR9.11 scene environment as a modifier source with provenance | done | `rules/src/env.ts`, `activeSceneModifiers`. Applied **once** — see LIVE-2 in §2, pinned by `e2e/pool-parity.spec.ts`. |
| FR9.12 AoE circles + grenade scatter helper | done | `POST /api/scenes/:id/scatter`; client `rollScatter`. |
| FR9.13 manual fog, server-authoritative, persisted | done | `POST /api/scenes/:id/fog`. |
| FR9.14 named staged reveals with announcement | done | Same. |
| FR9.15 pings, pointer trails, drawings, GM "focus here" | done | `pointer` and `scene.focus` contracted (`contracts/src/events.ts`) with hub handlers and a GM console (`grid/gm/DisplayTab.tsx`). Drawings via `/api/scenes/:id/drawings`. |
| FR9.16 wall-based vision + dynamic lighting | deferred | P6, and Q9 resolved the table does not use it. Manual fog is the permanent first-class path. |
| FR9.17 Matrix overlay | deferred | P6 stretch. |
| FR9.18 ambient audio | superseded | Folded into FR12.10. `audio_tracks` table and `Scene.audioRef` exist; nothing reads them. |
| FR9.19 TV joins as a `display` device, same server-side filtering | done | `e2e/join.spec.ts`, `e2e/tv.spec.ts`. |
| FR9.20 what the TV shows | done | `web/features/tv/TvStageView.tsx` mounts a read-only Pixi stage fed by `tv/hydrate.ts`, alongside the ribbon, big dice moments, handout takeovers and the idle card. `e2e/tv.spec.ts` asserts the stage renders, that a rebooted TV comes back to the scene by itself, and that the kiosk holds no GM-only state. This was the P2 exit criterion. |
| FR9.21 GM steering (focus camera, layer toggles, blank the table) | done | `plugins/scenes.ts` emits `display.updated`; `grid/gm/DisplayTab.tsx` drives blank/ribbon/focus; the TV replays the newest event on reconnect. |

### M10 — The Opposition Kit *(P3)*

| FR | Status | Where |
| --- | --- | --- |
| FR10.1 archetype templates: role tags, tier dial, per-tier ranges, loadout slots | done | `/api/campaigns/:campaignId/npc-templates`, `contracts/src/generator.ts`. |
| FR10.2 seeded generation, original flavour tables, engine-derived values | done | `rules/src/generator/`; `tables.ts` is original writing (G6). |
| FR10.3 promote to reusable template, edits round-trip | done | `POST /api/generator/promote`. |
| FR10.4 encounter builder | done | `POST /api/encounters/build`. |
| FR10.5 party-aware threat readout with visible math | done | `GET /api/encounters/:id/threat`, `services/generator-threat.ts`. |
| FR10.6 balance levers recompute live | done | `POST /api/encounters/:id/threat/recompute`. |
| FR10.7 quick-roll rack | done | `GET /api/combatants/:id/quick-rolls`, `POST …/quick-roll`, stamped with the active session. |
| FR10.8 resolved chains, card-per-step, override before commit | done | `services/encounters-rolls.ts` writes one `rolls` row per pool (attack / defence / soak) at `gm` visibility the moment the server throws them, linked by `request.meta.chainId`, inside a transaction; damage lands only on `…/resolve-chain/commit` (Principle 2). `test/encounters-chain-rolls.test.ts`. **Note:** the tracker's card UI still previews with local dice — see §6.2. |
| FR10.9 morale from Professional Rating triggers | done | GM-only, never acts; measured against a real PR for hand-added rows too. |
| FR10.10 tactical hints on the acting NPC's turn | **done** | `services/tactical-hints.ts` — one line of co-GM advice on the acting NPC's turn, derived from `roleTags` + condition. Three properties enforced in the module rather than trusted to callers: a hint is **text only** (no id, no verb, nothing to "apply"), it is **off unless `campaigns.settings.tacticalHints === true`**, and it is **GM-only**. `test/tactical-hints.test.ts` (12), web `hints.test.tsx` (8) + `trackerHints.test.tsx` (5) + `trackerHintsToggle.test.tsx` (4), `e2e/hints.spec.ts` (2 — off by default; with hints on, a player's device does not contain the line at all). |

### M11 — Rules library *(P1)*

| FR | Status | Where |
| --- | --- | --- |
| FR11.1 registry: code, title, page offset, calibration helper | done | `plugins/books.ts`, `PATCH /api/books/:id`; `web/features/gm/BooksPage.tsx` calibration stepper. |
| FR11.2 structured `{book, page, note?}` refs | done | `contracts/src/common.ts`; used across sheet, templates, tables, codex. |
| FR11.3 one-tap open at the printed page, in-app, on phones | **done** | Self-hosted pdf.js, per §13. `apps/web/scripts/vendor-pdfjs.mjs` copies `pdfjs-dist` into `public/pdfjs/` at `postinstall` and `build`, so the library costs zero bundle bytes and the worker stays a same-origin module worker. `features/reader/` holds the viewer (`pdfjs.ts`, `PdfSurface.tsx`, `ReaderCore/Shell/Route`), the printed-page arithmetic (`pageMath.ts`), byte-range fetching (`range.ts`) and `mode.ts`, which keeps the browser's own viewer as the documented fallback reachable three ways — `?native=1`, a remembered per-device preference, and automatically when pdf.js cannot start. `test/reader-route.test.ts` (9), web `mode`/`pageMath`/`range`/`pdfjs`/`layout`/`ReaderShell` (12)/`refChipViewer` (4), `e2e/reader.spec.ts` (3 — a ref chip opens the printed page over byte ranges, the jump box moves the page under it, pinch and the zoom controls both change scale). |
| FR11.4 ref autolinking of `SR5 p.426` patterns | done | `web/features/gm/books/refs.ts` + tests; also used by the codex renderer. |
| FR11.5 shared with the table, per-book GM-only toggle | done | A player's search returns real page provenance. |
| FR11.6 named bookmarks + recently-opened trail | done | `services/bookmarks.ts` + routes; `test/books-bookmarks.test.ts` (13). |
| FR11.7 `pnpm seed:books` folder import with guessed codes | done | `apps/server/scripts/seed-books.ts`. PDFs stay out of git. |

### M12 — The Fixer *(assistant core P1)*

| FR | Status | Where |
| --- | --- | --- |
| FR12.1 GM-only dockable streaming panel, history, two model slots | done | `plugins/fixer.ts`, `fixer/conversations.ts`, `web/features/gm/fixer/`. |
| FR12.2 grounded rules research, citations from retrieval not the model | done | `search_books` returns `{book, printedPage}`; the chip is the server's. |
| FR12.3 lore and state research | done | `search_codex` over a real codex (`fixer/state-codex.ts`). |
| FR12.4 planning / brainstorming with "save to codex" | done | The draft lands as a `wiki_page` the codex UI can browse and edit. |
| FR12.5 NPC fiction layer onto procedural stats | done | `generate_npc` + persona; D13 split held. |
| FR12.6 in-character conversations with knowledge boundary + secrets | done | `POST /api/npcs/:id/converse`. |
| FR12.7 codex drafting | done | `draft_wiki_page` → `wiki_pages` on accept. |
| FR12.8 fog NL commands, proximity prompts, region auto-naming | done | `suggest_fog_reveal` + `fog_reveal` draft kind; `fixer/proximity.ts` behind `check_fog_proximity` and `GET /api/fixer/fog-proximity` — GM-only, never written down. |
| FR12.9 token identification / labelling | done | `fixer/token-id.ts`, `identify_tokens`, `POST /api/fixer/identify-tokens`. |
| FR12.10 stagecraft (music tagging + scene matching) | deferred | `audio_tracks` table only. |
| FR12.11 map assistance (layout copilot) | **done, both lanes** | Lane 1 unchanged: `fixer/geometry.ts` / `propose_geometry` compiles guided-JSON rectangles to walls / doors / named fog regions as a draft. Lane 2 is new — **map vision**: `fixer/vision.ts` + `vision-probe.ts` probe the configured model once, cache the answer, and offer `read_map_image` **only** when the box actually reads images (`fixer/agent.ts:363` filters it out otherwise). The route distinguishes the two "no" cases honestly: `503 ai_disabled` for no box, `501 vision_unsupported` for a box whose model is text-only. `test/fixer-vision.test.ts` (17). |
| FR12.12 recap drafts | **done** | `fixer/tools-recap.ts` (`draft_recap`) + `fixer/recap.ts` (`assembleRecap`): the model writes prose only, the server adds tallies, casualties, reveals and awards from the log itself, and the FR12.19 spoiler guard runs **unconditionally** because a recap is player-facing by definition. The deterministic client-side skeleton survives as the no-model path (`web/features/gm/sessions/recap.ts`). `test/fixer-recap.test.ts` (8), `e2e/recap.spec.ts` (3). |
| FR12.13 OpenAI-compatible local provider; unset base URL hides everything | done | `fixer/llm.ts`, `GET /api/fixer/status`. Nothing touches the internet. |
| FR12.14 retrieval over extracted book text, Postgres FTS | done | `book_pages.tsv` generated tsvector, `searchBookPages`. |
| FR12.15 every generation an `ai_generation` draft; usage meter | **done** | `fixer/drafts.ts` for drafts; the meter is now durable — `ai_usage` (`schema.ts:432`, migration `0002_macros_and_usage.sql`) records every chat turn, `fixer/usage.ts` `persistTurnUsage` / `campaignUsage` read it back, and `GET /api/campaigns/:id/fixer/usage` reports both the durable total and the per-process live one. `test/fixer-usage.test.ts` (7) includes "reads the same number back from a fresh server on the same directory"; the playthrough asserts 4 turns / 1261 tokens survive a restart while the per-process half correctly reads zero. |
| FR12.16 fast/primary slot discipline | done | `fast` defaults to `primary` when unconfigured. |
| FR12.17 read-only state tool catalog | done | 26 tools registered plus the capability-flagged `read_map_image`: `get_campaign`, `list_characters`, `get_character`, `get_ledger`, `get_encounter`, `get_scene`, `get_session_log`, `search_books`, `get_page`, `search_codex`, `list_contacts`, `list_runs`/`get_run`, `get_calendar`, `list_npcs`, `get_npc`, `get_threat_readout`, `get_magic_state`, `get_matrix_state` — plus `generate_npc`, `draft_wiki_page`, `draft_recap`, `suggest_fog_reveal`, `check_fog_proximity`, `identify_tokens`, `propose_geometry`. `get_magic_state` now returns `spirits: { tracked: true, list }` because the tracker exists (FR8.3); `get_matrix_state` still returns `tracked: false` with a note for Overwatch and marks rather than a misleading zero — honest about M7 not existing. |
| FR12.18 situation snapshot prefix during live sessions | done | `fixer/agent.ts:91`. |
| FR12.19 spoiler guard on player-facing prose | **partial** | The guard itself is complete and server-side: `spoilerScan` (`fixer/drafts.ts:415`) matches GM-only names and returns `SpoilerFlag[]`; the tool result tells the model to name the flags and ask reveal-or-cut; the playthrough catches a GM-only name in a recap draft. **What is broken is the GM's view of it** — `web/features/gm/fixer/api.ts:124` `spoilerFlagsOf()` keeps only `typeof f === 'string'` entries, so the object-shaped flags the server sends are dropped and `DraftsInbox.tsx` renders no warning on the card the GM accepts from. Marked in the suite as a deliberate `test.fail` (`e2e/recap.spec.ts:235`). Top of §6. |

### M5 — Campaign codex *(P4)*

`plugins/codex.ts` (wiki pages, per-page **and per-section** visibility,
`[[Wiki-links]]` + backlinks + unresolved report, handouts staged then
revealed), `plugins/codex-runs.ts` (runs, awards posting to the ledger as
*pending*), `plugins/codex-calendar.ts`, `plugins/contacts.ts`. Services in
`services/codex.ts` / `codex-store.ts` / `codex-templates.ts`. Web:
`features/codex/` (`CodexPage`, `PageBrowser`, `PageView`, `Markdown`,
`RunsBoard`, `CalendarView`, `ContactsPanel`, `HandoutsPanel`, `TemplatePanel`)
at `/c/:id/codex`, `/c/:id/codex/:pageId`, `/c/:id/calendar`, `/c/:id/gm/runs`.

| FR | Status |
| --- | --- |
| FR5.1 typed markdown pages, tags | done |
| FR5.2 per-page and per-section visibility, server-filtered, one-click reveal | done — a player's GET does not *contain* the hidden section; an invisible page 404s like a nonexistent one, so the route is not an oracle |
| FR5.3 `[[Wiki-links]]`, backlinks, unresolved links as create-prompts | done (`GET /api/campaigns/:id/wiki/unresolved`) |
| FR5.4 handouts staged privately, revealed live | done (`POST /api/handouts/:attachmentId/reveal`) |
| FR5.5 runs: Johnson, objectives, opposition links, payout, awards → ledger, recap | done (`POST /api/runs/:id/award` books *pending* ledger rows) |
| FR5.6 NPC/archetype templates live in the codex, page-referenced | **done** — `npc_templates.wiki_page_id` (migration `0003_npc_template_wiki_link.sql`), `services/codex-templates.ts`, `POST/DELETE /api/wiki/:id/templates`, and `GET /api/wiki/:id` now returns the templates a page is the codex entry for. `web/features/codex/TemplatePanel.tsx`. `test/codex-templates.test.ts` (10), web `templates.test.tsx` (13) |
| FR5.7 in-game calendar | done |
| FR5.8 contacts per character, GM-shared by default, linkable to NPC pages | done (`plugins/contacts.ts`; a second player asking for someone else's contact gets a flat 403) |

### M6 — Sessions *(P4)*

| FR | Status | Where |
| --- | --- | --- |
| FR6.1 session entity: date, attendance, linked runs, log, prep notes, recap | done | `plugins/sessions.ts`. |
| FR6.2 start/end live mode | done | `POST /api/campaigns/:id/sessions/start`, `POST /api/sessions/:id/end`, `GET …/live`. |
| FR6.3 recap publishing to Discord on explicit GM action | done | `POST /api/sessions/:id/publish-recap`; with no webhook, nothing leaves the laptop. `e2e/recap.spec.ts` asserts publishing stays a separate, confirmed tap after accepting a draft. |

### M7 — Matrix toolkit *(P6, on demand)*

**Deferred by design** (Q3: no decker at the table). What exists: the
`matrix_hosts` table, the `os.changed` event, the Matrix AR / cold-sim /
hot-sim initiative variants in the engine, and `get_matrix_state` returning
`tracked: false` with a note so the Fixer cannot invent an Overwatch score.
FR7.1–7.6: not built. This is also the only thing holding FR3.2 at `partial`.

### M8 — Magic toolkit

| FR | Status | Where |
| --- | --- | --- |
| FR8.1 casting flow with linked Drain resistance, applied on confirm | done | `web/features/sheet/tabs/DrainApply.tsx` + the rolls service. |
| FR8.2 sustained spells, −2 each, focus/quickening exempt | done | `services/characters.ts`, `POST /api/characters/:id/sustained`. A spirit sustaining for its summoner flips the caster's `exempt` and remembers the prior value (`magic-store.ts` `sustainPriorExempt`). |
| FR8.3 spirit tracker (Force, services, spend a service, joins encounters) | **done** | `plugins/magic.ts` — create, patch, derived, spend a service, dismiss, sustain, and **join an encounter** as a combatant; `services/magic.ts` + `magic-derive.ts` + `magic-store.ts`. GM-side spirits (`characterId: null`) are `gm`-visible and never reach players. Storage is `campaigns.settings.magic`, validated on the way in *and* out, so a hand-edited blob degrades to "no spirits" rather than a 500. Web: `features/sheet/magic/SpiritList.tsx` in `MagicWorkbench.tsx`. `test/magic.test.ts` (31), web `magic/lib.test.ts` (28) + `workbench.test.tsx` (28) + `events.test.ts` (12), `e2e/magic.spec.ts` (spending a service drops the count on screen and on the record). |
| FR8.4 foci bonding/toggles and reagent counters | **done** | `services/magic-foci.ts`; `GET/POST /api/characters/:id/foci`, `PATCH/DELETE …/foci/:focusId`, `POST …/reagents`, `GET …/magic/derived`. An unbonded focus is inert however switched-on it looks — bonding and activation are separate gates, and an active bonded focus contributes real `Modifier` rows so the pool moves **with provenance**. `e2e/magic.spec.ts` asserts exactly that. `get_magic_state` now reports tracked foci first and only then name-matches gear that looks like one, flagged `tracked: false`. |
| FR8.5 adept powers as passive/toggled modifier sources | done | Modifier pipeline; a Quickened Reflexes power contributes an initiative die through staging as well as through `addCombatant`. |

### Phase reading against §18

| Phase | State |
| --- | --- |
| P0 Skeleton | **Done.** |
| P1 Run the table | **Done.** FR2.8's server half closed the last sub-clause. |
| P2 The Grid | **Done.** Map on the TV, geometry and pins authoring, pointer and focus across the wire, and both lanes of FR12.11 including map vision. |
| P3 Opposition Kit | **Done.** FR10.10 hints were the last row and they shipped off by default, as the FR requires. |
| P4 Campaign memory | **Done.** M5 codex, runs, calendar, contacts, handouts; M6 sessions; FR3.6 approvals; FR5.6 template↔codex linkage; FR12.12 AI recap drafting. |
| P5 Deep SR5 | **Done bar FR3.7 and FR12.10.** FR8.1–8.5 all ship. The advancement editor and stagecraft audio remain deliberately unbuilt. |
| P6 Stretch | Deferred as designed: M7, FR9.16, FR9.17, FR3.9, image adapter, PWA, export. |

### Roll20 exit checklist (§18)

| Roll20 feature | State |
| --- | --- |
| Maps, grid, tokens | shipped |
| Fog of war | shipped (manual + staged) |
| Measurement / ruler | shipped, SR5-native |
| Dice + macros | **shipped — macros now follow the person, not the handset** (FR2.8) |
| Initiative tracker | shipped |
| Character sheets | shipped via Chummer import |
| Handouts | shipped — upload, attach, stage, reveal, TV takeover |
| Journal / notes | shipped (M5 codex, with templates page-referenced) |
| Rollable tables | shipped |
| Shared map on the table TV | shipped |
| Jukebox, dynamic lighting | not used, by decision (Q9) |
| PDFs deep-linked in-app | **shipped — self-hosted pdf.js, page-accurate on a phone** (FR11.3) |

No red rows, and no asterisks left on the two that used to carry them. §18's
condition for cancelling the Roll20 subscription is met.

---

## 2. Found by driving the app

The defects below were **not** found by the automated suite. Against the build
they were reported on, `pnpm -r test` was 1194 green, `pnpm playthrough` was 187
green, and the browser E2E suite was green. They were found by a human opening a
browser — or, for the last one, a terminal — and using the thing for ten
minutes. The first three lived in the seam between a correct server and a
rendered page, precisely the seam an in-process `app.inject` harness cannot see
because it never mounts a component. The fourth lived one layer down, in a blind
spot of the same shape: not the seam between two *processes* — the browser
harness already crossed that — but the *state* one process can hand the next,
which nothing anywhere manufactured.

### LIVE-1 — the web UI never backfilled state on mount *(systemic, severe)*

**What it cost at the table.** Every live view rendered only the WebSocket
events it received *while mounted*. Seconds after a real roll persisted, the
table log read "the log is empty". The tracker read "no combatants yet" while
the encounter held eight staged combatants and was `state: live`. A phone that
locked and woke, a browser refreshed mid-firefight, a TV rebooted between
scenes — each came back to an empty world and stayed there until the next event
happened to fire. The socket is a delta feed, and it was being used as the whole
truth.

**Why nothing caught it.** Every server response was correct. The playthrough
asserts over HTTP and WS payloads; it never mounts a React tree, so "the store
starts empty and nothing fills it" is invisible to it.

**The fix, and why it cannot come back.** `apps/web/src/live/hydrate.ts`
(`hydrateCampaign` / `useLiveHydration`) reads the server's held state over REST
and folds it into the same store the socket writes to, per-slice, so a 403 on
one slice marks that slice `error` instead of blanking the screen. It is wired
at one chokepoint — `live/useLiveConnection.ts`, which every campaign view
already calls — rather than bolted onto each screen, so a *new* view is
hydrated by construction. The socket connects first and hydration follows, on
purpose: the overlap is idempotent through `mergeEvents`, whereas hydrating
first would leave a real hole. Reconnect re-hydrates with `force`. Grid, sheet
and TV have their own thin adapters (`features/grid/hydration.ts`,
`features/sheet/api.ts`, `features/tv/hydrate.ts`). Guarded by
`live/hydration.test.tsx` (14), `features/grid/hydration.test.ts` (17),
`features/sheet/hydration.test.tsx` (8), and `e2e/hydration.spec.ts` (4) — one
of which cuts the socket entirely and one of which cuts the REST reads too, to
prove the screen is *honestly* empty rather than accidentally empty.

### LIVE-2 — the scene environment modifier was applied twice *(correctness)*

**What it cost at the table.** The sheet showed Perception 5. The roll dialog
offered "Roll 4d6". The persisted receipt contained
`environment: light 1 → light (-1) -1` **twice**. The server's derived pool
already folded the active scene in; the client re-sent it as a situational chip.
Every roll made in a modified scene was one or more dice light, and the receipt
said so in writing to anyone who read it closely enough — which, at a table, is
nobody.

**Why nothing caught it.** Both halves were individually right. The engine
correctly emits a `source: 'scene'` entry; the client correctly forwards
situational chips. Only the composition was wrong, and composition only exists
once a dialog is open in front of a derived pool.

**The fix, and why it cannot come back.** One authority: the server's derived
pool. `features/sheet/rollDialogState.ts` splits the breakdown with
`appliedSceneEntries` (rendered as context, never summed) and `nonSceneEntries`,
keying off the engine's `source: 'scene'` tag so it holds whether the breakdown
came from the server or the local fallback derive. `rollPool` is now
`base + chips + situational` with no scene term, which makes the acceptance
condition checkable: with no chip armed, dialog dice **equal** the sheet pool.
`rollDialogState.test.ts` (18) covers the unit; `e2e/pool-parity.spec.ts`
asserts sheet pool = dialog dice = persisted pool = scene counted once, and a
second spec arms a situational chip to prove parity is real agreement rather
than a client that stopped sending modifiers.

### LIVE-3 — `/join/:code` served JSON to a scanning player *(blocked onboarding)*

**What it cost at the table.** `GET /join/:code` was both an API route and an
SPA route, and Vite proxied `/join` to the API. A player scanning the QR got a
wall of raw JSON. In production the same collision would have 404'd the join
screen. This is the first thing a new player at the table does.

**Why nothing caught it.** The endpoint worked perfectly. The bug was that two
different things claimed one path, and only a camera pointed at a phone reveals
which one wins.

**The fix, and why it cannot come back.** One path, one owner. `/join/:code` is
the SPA screen (`web/router.tsx`, `components/shell/JoinPage.tsx`); the token
mint moved to `GET|POST /api/join/:code` (`services/auth.ts:467–468`). The
change is enforced in four places at once so no single edit can undo it: the
QR payload (`joinUrl`, with `WEB_ORIGIN` for the dev split-port case and
`.env.example` / `infra/docker-compose.yml` carrying it), the Vite proxy
(`/join` deliberately absent, with the reason written in the config), the
production SPA fallback (`app.ts:176–179`, `/join` not in `API_PREFIXES`), and
the client. `e2e/join.spec.ts` (6) covers all four — including one spec that
asserts the dev server does *not* proxy `/join`, and one that checks the QR the
GM holds up encodes the SPA route.

### LIVE-4 — the event log froze on a campaign seeded by another process *(durability, severe)*

**The reproduction.** Three commands, no browser:

```bash
cd apps/server && rm -rf data && cd ../.. && pnpm seed:demo   # ~24 ws_events rows; the process exits
pnpm dev:server                                               # a NEW process opens the SAME PGlite directory
curl -s -X POST -H "Authorization: Bearer <gm token>" -H 'Content-Type: application/json' \
  -d '{"kind":"simple","pool":6,"breakdown":[{"label":"t","value":6}],"visibility":"public","actor":{"gm":true}}' \
  http://127.0.0.1:8787/api/rolls
```

Every append to `ws_events` came back:

```json
{"error":{"code":"internal","message":"Failed query: insert into \"ws_events\" (\"id\", \"campaign_id\", \"type\", \"payload\", \"visibility\", \"owner_user_id\", \"created_at\") values (default, $1, …)"}}
```

**Blast radius — the whole of FR2.9 on any seeded campaign.** `ws_events` is the
single append point for the shared log, so everything that writes history died
at once:

| Path | Symptom |
| --- | --- |
| `POST /api/rolls` | 500. The roll row **is** written to `rolls` (`GET /api/campaigns/:id/rolls` lists it with the right pool and faces) but `hub.emit` throws, so no `roll.created` ever reaches `ws_events` or any socket. |
| `POST /api/campaigns/:id/log` | 500 — table talk and scene markers cannot be posted. |
| `PATCH /api/campaigns/:id` | 500 on a clock advance (`clock.advanced`). |
| `GET /api/campaigns/:id/log` | Frozen forever at the ~24 rows the seeder wrote. |

Rolls made from the sheet and from the table composer never appeared in the
shared log — not live, and not after a reload. The one screen the whole table
looks at was a dead photograph. And the roll was *half* committed: real dice,
persisted, invisible. That split is a defect in its own right independent of
what caused the append to fail — the write path has to be atomic or
compensating, and it was neither.

**Root cause, as diagnosed.** `ws_events.id` is a `bigserial`
(`packages/db/src/schema.ts`) and `appendEvent` (`packages/db/src/events.ts`)
inserts with a DEFAULT id. A serial's next value lives in a sequence *beside*
the table, not in it, so the rows and the counter can be separated by anything
that moves one without the other. When they separate downwards — sequence
behind `max(id)` — every insert collides on a primary key the server never
chose, `SQLSTATE 23505` on `ws_events_pkey`, and it repeats forever because the
next attempt picks the same doomed id. That is the failure, and
`seeded-boot.test.ts`'s counterfactual (`is genuinely fatal to an append`)
reproduces it deliberately: put the sequence behind the rows and the append
500s exactly as reported.

The prime suspect for *how* the seeder produced that state was an unclean exit.
**That part of the theory is wrong, and it is written down here so nobody
re-derives it.** Measured on the real hand-off: seed 21 events, `process.exit`
with no close, reopen — `max(id)` 21, `last_value` **33**, next append 34.
PostgreSQL WAL-logs sequence advances 32 values ahead (`SEQ_LOG_VALS`), so
recovery restarts a serial *in front of* its rows. An unclean exit skips ids
forward; it can never reissue one. The states that genuinely put a sequence
behind its rows are a `DATA_DIR` restored from a file copy taken while a writer
held it, and the ordinary way of moving this database between backends — load
the rows into a fresh schema with their ids intact and the sequence is still
sitting at 1. Both are reachable here: the GM's realistic backup of an embedded
PGlite install is "copy the folder", and `DATABASE_URL` swapping PGlite for
Postgres is a supported configuration. (The compose `backup` service is *not* a
source of this: it is a nightly `pg_dump`, and a dump carries `setval` for every
sequence.) So the honest summary is that the exact provenance of the reported
directory is not proven; the state it was in, and the fact that the state is
fatal and reachable, both are. **Both paths now have scripts and tests behind
them** — see §5, item 7.

Two things made this cost days rather than minutes, and both are now fixed
alongside the sequence itself. The error text — drizzle's
`Failed query: insert into "ws_events" …` — is byte-identical for a duplicate
key, a foreign-key violation, a not-null violation and a type error, so the
message named the statement and nothing about the fault. And the id skew was
compounding invisibly: the server was itself the last writer still exiting
dirty, so a campaign at event id 24 came back from a restart issuing id **55**,
once per restart, for the life of the campaign.

**The fix, and why it cannot come back.** Four layers, none of which trusts the
others:

- **Repair on every open.** `migrations/0001_sequence_guard.sql` defines
  `safehouse_resync_sequences()` — it walks every serial column in `public`,
  compares `max(col)` against the sequence's next value, and `setval`s forward
  where the sequence would hand out an id that already exists.
  `ensureSequences()` (`packages/db/src/sequences.ts`) runs it inside
  `ensureMigrations`, so opening the directory is the repair; no operator step,
  no manual SQL. It is **forward-only by construction**: a healthy sequence,
  including one recovery pushed ahead of the rows, is left alone. Pulling a
  sequence backwards would re-issue ids clients already hold as `last_event_id`
  and silently truncate their §11 replay — a worse bug than the one being
  repaired, because it is invisible.
- **Atomicity on the write path.** `Hub.atomic` (`hub.ts:299`) opens one
  transaction, writes the domain row and the event announcing it through the
  transaction handle, and broadcasts **only after COMMIT**. The method carries
  the PGlite deadlock rule in its own docblock (single embedded connection:
  every read inside the block must go through `tx.db`, never the service's `db`,
  or it waits forever). It started as one call site on the roll path; **33
  emissions across 7 files now go through it** — see §5, item 2.
- **A diagnosable error.** `appendEvent` wraps failures in `DbError` carrying
  PostgreSQL's own SQLSTATE, violated constraint and DETAIL, and the hub logs
  them with the campaign id and event type. The next person sees
  `23505 / ws_events_pkey / … already exists`, not the SQL.
- **Clean hand-off from every writer.** `closeDatabase` checkpoints and closes;
  the seeders call it and the server does too, through `installSignalHandlers`
  on SIGINT/SIGTERM (`src/shutdown.ts`, idempotent under a double Ctrl-C, with
  an unref'd 5 s backstop). This removes the id skew rather than repairing it
  after the fact.

**Why 1194 unit tests, a 187-check playthrough and a browser E2E suite all
passed.** Two separate misses, and it took both:

*The shape had no coverage at all.* Every server test goes through
`makeTestApp`, which points `DATA_DIR` at a throwaway directory and opens it
with `getDb()` **in the same process** that then asserts against it. The
playthrough boots the real Fastify app (`buildApp`) but likewise seeds
in-process on a fresh temp directory. Neither ever wrote a durable PGlite
directory, let go of it, reopened it somewhere else and appended — the one
sequence a real table always plays:

```
one process writes a durable directory  →  it exits  →  another process opens the same bytes  →  it appends  →  someone reads the log back
```

*The state was never manufactured anywhere.* The browser harness is the
interesting one, and the reason "just add an E2E test" was not the answer: it
**does** cross the process boundary — `e2e/fixtures/harness.ts` spawns
`seed:demo` in its own process and only then boots the built server on the same
`DATA_DIR`, because PGlite locks its directory and the two can never hold it at
once. It crossed the seam on every run and stayed green, because a clean
seed-then-serve hand-off does not produce the fault. A sequence only ever
*skips forward* on its own; it has to be put behind its rows by something
external. So the harness that could see the shape only ever met a healthy
database, and nothing in any suite created an unhealthy one.

Add to that: the E2E suite had no spec that wrote an event and then read the
**log** back. `pool-parity.spec.ts` posts a roll, but it asserts the roll's own
persisted pool — the exact half of the write that survived. The half that died
(`roll.created` reaching `ws_events` and the log view) was asserted nowhere in a
browser at all.

A green suite and a frozen log were therefore perfectly consistent, which is the
worst property a suite can have. Depth was never the problem; 1194 assertions
sat inside one blind spot with a second blind spot layered over it.

**The regression that closes the hole.** `apps/server/test/seeded-boot.test.ts`
(10 tests) owns both halves:

- *The shape.* It spawns the **real** `seed:demo` as a child process, waits for
  it to exit, opens the directory it left behind with a fresh `buildApp`, and
  then writes and reads back every kind of event a session produces — a roll,
  table talk, a clock advance — asserting the log grew each time, that the
  reopened bytes really are the seeder's, and that the roll ids in `rolls` and
  the `roll.created` events in `ws_events` are the same set (`never
  half-commits a roll: what is in the table is in the log`).
- *The state.* It manufactures the sequence-behind-rows condition no seed
  produces on its own, proves with a counterfactual that it really is fatal to
  an append, and then proves that merely booting the server against such a
  directory repairs it — in **both** `is_called` off-by-one states a restore can
  leave behind — while leaving a healthy sequence untouched.

`apps/server/test/restore-boot.test.ts` (19 tests, 2 of them requiring a real
Postgres) then walks the two paths that put a sequence there in the first place:
a byte-copy restore of `DATA_DIR` booted on the copy — file store included,
because that is the half people forget — and a move onto a `DATABASE_URL`
Postgres through `scripts/migrate-to-postgres.ts`, with a counterfactual that
skipping the sequence pass rejects the table's very next event.

CI runs both as their own steps *before* the full suite
(`.github/workflows/ci.yml`), so the cheapest, most specific failure reports
first, and a separate `restore-postgres` job with a `postgres:16` service runs
the block that needs a real server. Around them: `packages/db/test/durability.test.ts`
pins the forward-only repair, the 32-value recovery jump, `appendEvent`'s
SQLSTATE surfacing and the upgrade of a database that predates the guard;
`apps/server/test/seed-durability.test.ts` drives seeder-child → probe-child →
POST-roll → GET-log with the vitest process never touching the directory
(PGlite is single-writer: a second opener hangs rather than erroring);
`core-atomicity.test.ts` (9) and `core-atomicity-domains.test.ts` (16) block a
named event type with a real CHECK constraint and assert **both** halves — a
named error to the caller *and* no domain row; `core-shutdown.test.ts` (8) pins
that a server closed through `shutdownServer` reopens with
`last_value === max(id)`; and `apps/web/e2e/log-append.spec.ts` (2) makes a roll
from the composer in a real browser and checks it is still in the log after a
reload.

**Still open, honestly.** 14 `hub.emit` call sites remain outside a
transaction — see §6.2. Every path LIVE-4 actually damaged is inside one.

### What changed structurally

`apps/web/e2e/` exists: Playwright, chromium, 13 spec files, 38 tests, run
against the **real** stack (built server + built SPA on one origin, throwaway
`DATA_DIR`, PGlite, the demo campaign, no model, no network). It runs in CI
after the unit suite and the smoke playthrough. The runner (`e2e/run.mjs`) skips
with a message when no browser binary is present rather than turning CI red for
a download failure; `e2e:strict` fails instead, for when you mean it.

The cross-process seam has its own layer, separate from the browser one:
`seeded-boot.test.ts`, `restore-boot.test.ts` and `seed-durability.test.ts` on
the server, `durability.test.ts` in `@safehouse/db`. All four spawn real child
processes, because that is the only way to reach the state LIVE-4 was made of.

Two more browser findings from the same session, now closed:

- **Skill rows were click-handler `<div>`s** — no accessible name, no keyboard
  path. Rows are real `<button>`s; every control gets a spoken name from
  `features/sheet/a11y.ts`. `a11y.test.ts` (12), `sheetA11y.test.tsx` (22),
  `e2e/keyboard.spec.ts` makes a whole roll from the keyboard alone and asserts
  every skill row has a name a screen reader can speak.
- **Staged initiative dropped augment dice** and **live encounters sat at turn
  0 / pass 0** — both closed; the browser simply confirmed them in the wild.

The lesson worth keeping, restated after LIVE-4: an API-level harness proves the
server and cannot prove the app; a browser harness proves the app but only
against the states someone thought to build for it. Every suite here now runs on
every push, and the newest ones exist to construct a state rather than to
exercise a path.

---

## 3. How to run

Node ≥ 22, pnpm 11.24. No Docker and no internet are required for anything in
this section.

```bash
pnpm install
pnpm build
```

`pnpm install` also runs `apps/web`'s `postinstall`, which vendors pdf.js into
`apps/web/public/pdfjs/` (FR11.3). `pnpm build` re-runs it. The script never
exits non-zero: a missing library degrades the reader to the browser's own
viewer rather than turning the build red.

### Seed the book library (FR11.7)

The PDFs sit at the repo root and never enter git.

```bash
pnpm seed:books                                   # every PDF it recognises
pnpm seed:books -- --list                         # filename → code/offset guesses, no writes
pnpm seed:books -- --only SR5 --max-pages 60      # fast targeted run
pnpm seed:books -- --dir D:/books --data-dir ./data
```

Codes and offsets are guesses for the GM to confirm in the app (`BooksPage`
calibration stepper); the core rulebook ships at its measured +5. Page text
lands in `book_pages` for FTS retrieval (FR12.14).

### Seed the demo campaign

```bash
pnpm seed:demo                # into DATA_DIR (default ./data)
DATA_DIR=./tmp/demo pnpm seed:demo
```

Idempotent: it deletes any campaign named "Static on the Line" and rebuilds it.
It drives the app's own HTTP surface via `app.inject`, so every row goes through
real validation and event emission. Exactly two things go straight to the
database and both have to: creating the campaign (the bootstrap route refuses a
second campaign without a token) and the wipe. It prints the campaign id, the
three player join codes, the display join code, and the device tokens. Content
brief: `docs/demo/CAMPAIGN.md`.

### Dev servers

```bash
pnpm dev:server    # http://localhost:8787  — REST /api, WS /ws, /files, /read, /healthz
pnpm dev:web       # http://localhost:5173  — proxies /api /ws /files /read to 8787
```

`/join` is **not** proxied: it is an SPA route (LIVE-3). When Vite serves the
SPA on a different port from the server, set `WEB_ORIGIN=http://<lan-ip>:5173`
so the QR encodes the SPA's origin. `/read/:code` is proxied with a `bypass`
rule that hands a `text/html` navigation the SPA shell and a `fetch` the
server's JSON — the same content negotiation
`plugins/books.ts#wantsSpaShell` does in production.

Database is embedded PGlite at `DATA_DIR/pglite` unless `DATABASE_URL` is set.
Migrations apply programmatically on start, and `ensureSequences()` runs with
them on **every** open — so a data directory whose serial sequences have fallen
behind their rows is repaired by being opened, with no operator step (LIVE-4).
To move a campaign from the embedded database onto a real Postgres, use
`apps/server/scripts/migrate-to-postgres.ts`; it preserves ids and resyncs every
sequence, which is the step whose absence *is* LIVE-4.

PGlite is single-writer: only one process may hold `DATA_DIR/pglite` at a time,
and a second opener **hangs** rather than erroring. If a seeder or a probe seems
to stall, something else still holds the directory. Ctrl-C is a clean stop —
SIGINT/SIGTERM drain HTTP and then checkpoint and close the database
(`src/shutdown.ts`), which is what keeps event ids from skipping ~32 forward on
every restart.

### Join flow

| Who | How |
| --- | --- |
| Player | `http://<laptop>:5173/join/<player-code>` — or scan the QR from `GET /api/campaigns/:id/join-qr?role=player`. The screen calls `GET /api/join/:code`, stores the token, and routes to `/c/:campaignId`. |
| Observer | Same, with an `observer`-role invite. |
| The TV | `http://<laptop>:5173/join/<display-code>`, then it lands on `/tv/:campaignId` by itself. Zero controls; the socket is filtered exactly like a player's. |
| GM (first install) | Open `/`, "start a new campaign" — the bootstrap route runs and this browser is signed in as GM. |
| GM (second machine) | From a signed-in laptop, mint a single-use code (`POST /api/campaigns/:id/gm-pair`) and scan or type it on the new machine. |
| GM (escape hatch) | Paste the device token `seed:demo` printed into the "paste a token" tab. |

Ordinary invites are role-scoped to player / observer / display and `join-qr`
refuses `role=gm` outright; a GM device comes only from the bootstrap,
`gm-device`, or a single-use `gm-pair` code.

### The TV

`/tv/:campaignId`. The active scene's map, tokens, revealed fog and acting-token
glow on a read-only Pixi stage, plus the initiative ribbon, flagged dice
moments, handout takeovers and an idle card. It hydrates on mount, so a TV
plugged in mid-firefight comes back to the current scene by itself. The GM
steers it (blank / ribbon / focus here) from the grid's Display tab.

### Pointing the Fixer at a model

`LLM_BASE_URL` unset or blank is a supported, tested state: `GET
/api/fixer/status` returns `enabled: false`, every AI route answers "switched
off", and the web app hides its AI entry points (NG7).

```bash
LLM_BASE_URL=http://inference-box.lan:8080/v1 \
LLM_MODEL_PRIMARY=<big-instruct-model> \
LLM_MODEL_FAST=<small-model> \
pnpm dev:server
```

`chatCompletionsUrl()` tolerates a base URL with or without a trailing `/v1`.
`LLM_MODEL_FAST` falls back to primary, so a single-model box works with just
the base URL. Map vision (FR12.11) additionally needs a model that reads
images: the server probes once, caches the answer, and hides `read_map_image`
entirely when the answer is no — the route then returns `501
vision_unsupported`, which is a different thing from `503 ai_disabled` and says
so. Away-game fallback: `docker compose --profile llm up -d`.

**Mock instead of a real box.** `apps/server/src/fixer/mock-llm.ts` is a real
HTTP server speaking chat-completions with real SSE framing. It is what the
server tests and the playthrough use; nothing imports it at runtime.

### Production

```bash
cp .env.example .env        # set SESSION_SECRET and POSTGRES_PASSWORD
docker compose -f infra/docker-compose.yml --env-file .env up -d
```

`app` (server + built SPA on 8787) · `postgres:16` · `backup`. Plain HTTP on the
LAN, no reverse proxy.

---

## 4. Verification summary

`pnpm -r --workspace-concurrency=1 test`, 2026-08-29:

| Package | Test files | Tests |
| --- | --- | --- |
| `@safehouse/contracts` | 7 | 52 |
| `@safehouse/db` | 4 | 34 |
| `@safehouse/rules` | 11 | 175 |
| `@safehouse/server` | 46 | 605 (602 passed, 3 skipped) |
| `@safehouse/web` | 52 | 770 |
| **Total** | **120** | **1633 passed, 3 skipped, 0 failed** |

`pnpm -r --workspace-concurrency=1 typecheck` → exit 0 across all five packages.
`pnpm -r --workspace-concurrency=1 build` → exit 0.

Server tests run against throwaway PGlite instances with migrations applied; no
Docker, no network. The three skips are all environmental and all deliberate:
one in `books-api.test.ts` (the core PDF is absent), and two in
`restore-boot.test.ts` — the PGlite → Postgres move, which needs
`SAFEHOUSE_TEST_DATABASE_URL` and therefore runs in CI's `restore-postgres` job
rather than on a developer laptop (BUILD_CONVENTIONS: never require Docker).

**Bundle against §15.** From the `apps/web` vite build:

| Chunk | Raw | gzip | Budget |
| --- | --- | --- | --- |
| `index-BB_GQb4n.js` — the entry | 840.40 KB | **247.35 KB** | initial JS < 500 KB gz ✅ |
| `index-BKXK2HK4.css` | 51.84 KB | 9.71 KB | — |
| `index-CryW729h.js` — the Grid's lazy chunk (PixiJS) | 339.21 KB | 107.07 KB | Grid chunk < 900 KB gz ✅ |
| Pixi's own runtime splits (WebGL/WebGPU renderers, render targets, `browserAll`, canvas, bitmap fonts, buffers, worker) — 8 files | 269.78 KB | 76.71 KB | counted against the same 900 KB |
| `PdfSurface-BThIEcd4.js` — the reader surface | 6.79 KB | 2.85 KB | — |

Pixi is verified **absent** from the entry chunk (`grep pixi` finds nothing in
it and 11 hits in the Grid chunk), which is the condition §15's "no Pixi"
clause attaches to. Worst-case Grid cost is ≈184 KB gz against 900. pdf.js is
not in any chunk at all: `pdfjs-dist` is copied to `public/pdfjs/` (`pdf.mjs`
389 KB, `pdf.worker.mjs` 1.4 MB raw) and imported at runtime from our own
origin, costing zero bytes until a ref chip is tapped. **The one sub-clause not
met in the letter:** "codex editor lazy-loaded" — `features/codex/` rides the
entry chunk rather than a dynamic import. The budget that clause exists to
protect is met with ~2× headroom, so this is a tidiness item, not a latency
one; it is item 5 in §6.

**Browser E2E** — `pnpm --filter @safehouse/web e2e`, chromium, **38 passed**,
50.9 s, one worker against one shared live table:

| Spec | Tests | Covers |
| --- | --- | --- |
| `gm-signin.spec.ts` | 3 | FR1.1 GM pairing from a fresh profile; the front door's three paths; a nonsense code rejected client-side |
| `hints.spec.ts` | 2 | FR10.10 — off by default with the toggle visible; with hints on, a player's device does not contain the line at all |
| `hydration.spec.ts` | 4 | LIVE-1 — backfill with the socket cut; refresh mid-session; REST cut too (honestly empty); a player's phone hydrates filtered |
| `join.spec.ts` | 6 | LIVE-3 — the QR renders the join screen; only `/api` answers JSON; the QR encodes the SPA route; the TV lands on the kiosk; a dead code fails on-screen; the dev server does not proxy `/join` |
| `keyboard.spec.ts` | 2 | a roll made from the sheet with the keyboard alone; every skill row has a spoken name |
| `log-append.spec.ts` | 2 | LIVE-4 in the browser — a roll from the composer renders its pool and hits and is still there after a reload; table talk appends and survives a reload |
| `macros.spec.ts` | 2 | FR2.8 — a macro saved on one device is in the rack on a freshly paired one; another person on the same server does not get it |
| `magic.spec.ts` | 2 | FR8.3/8.4 — spending a spirit service drops the count on screen and on the record; toggling a bonded focus moves a pool **and** its provenance |
| `pool-parity.spec.ts` | 2 | LIVE-2 — sheet pool = dialog dice = persisted pool, scene counted once; a situational bump still reaches the server |
| `reader.spec.ts` | 3 | FR11.3 — a ref chip opens the printed page in the in-app pdf.js viewer over byte ranges; the jump box moves the page under it; pinch and the zoom controls both change scale |
| `recap.spec.ts` | 3 | FR12.12 — the Fixer drafts one and the session is untouched; accepting applies it and publishing is a separate confirmed tap; **one deliberate `test.fail`** marking the spoiler-warning gap (§6.1) |
| `secrecy.spec.ts` | 4 | Principle 4 in the browser: log, tracker, grid and the raw payloads behind them |
| `tv.spec.ts` | 3 | FR9.20 map stage + ribbon; a rebooted TV returns to the scene; the kiosk holds no GM-only state |

**Scripted playthrough** — `pnpm playthrough`, report at
`docs/demo/SESSION_REPORT.md`:

- **266 checks: 266 passed, 0 failed, 0 not applicable**, 10.8 s.
- Boots the real Fastify app on a loopback port against a fresh PGlite database,
  seeds SR5 (55 pages indexed) and the demo campaign, then plays a whole session
  from five devices — the GM's laptop, three phones and the TV.
- New beats this revision: a summoner's spirit tracked by Force and services,
  spending one, and the spirit joining the encounter as a combatant; a bonded
  focus toggled with its provenance following the pool; the reagent tin; a
  personal macro rack that survives a restart; the Fixer drafting the recap
  through `draft_recap` after reading the log, spoiler-scanned; the usage meter
  read back across a server restart (4 turns / 1261 tokens durable, per-process
  half correctly zero); tactical hints on and off; and a probe that makes
  `ledger.changed`, `combatant.damaged` and `clock.advanced` unrecordable in
  turn and asserts the domain row does **not** move — "the clock refuses to move
  when the tick cannot be recorded", then "the probe leaves the database exactly
  as it found it".
- The only "model" involved is the in-process mock inference box.

**CI** (`.github/workflows/ci.yml`): typecheck · build · **the seeded-boot
regression** · **the restore-and-boot regression** (both run on their own,
before the suite, so the cheapest and most specific failure reports first) ·
test · `.github/scripts/smoke.mjs` (boots the built server on a throwaway
`DATA_DIR`, runs the playthrough against it, confirms the SPA is served) · the
browser E2E suite (traces uploaded on failure) · a separate `restore-postgres`
job with a `postgres:16` service that runs the PGlite → Postgres move over
node-postgres · a multi-arch image build. `LLM_BASE_URL` and
`DISCORD_WEBHOOK_URL` are unset in CI on purpose.

---

## 5. The previous gap list, resolved

Every item from the last revision's §6 — the ranked list this round was worked
from — with what closed it or why it did not. **Eleven of twelve are closed
outright; the twelfth is closed on every path that ever failed.**

| # | Item | State | Evidence |
| --- | --- | --- | --- |
| 1 | Personal macros that follow the person (FR2.8) | **closed** | `packages/db/src/schema.ts:466` `user_macros` + migration `0002_macros_and_usage.sql` (unique on `(user, campaign, label)`); `apps/server/src/plugins/macros.ts` (GET/PUT/POST/PATCH/DELETE, every read fenced by the authenticated user — there is no user id in the path, so no request can address someone else's rack); `apps/web/src/features/sheet/macroStore.ts` migrates the legacy device key with additive POST rather than PUT, so a stale handset converges instead of deleting. `test/macros.test.ts` (20), `packages/db/test/macros-usage.test.ts`, web `macroStore.test.ts` (26) + `macroRack.test.tsx` (6), `e2e/macros.spec.ts` (2). |
| 2 | Move the remaining domain writes inside `Hub.atomic` | **closed on every path that failed; 14 sites remain** | 33 emissions across 7 files now run inside a transaction: ledger (`plugins/ledger.ts`), encounter damage (`services/encounters-damage.ts`, 4), the clock (`plugins/campaigns.ts:123`), encounters (`services/encounters.ts`, 3 + the service's own 9 `atomic` blocks), scene/token/fog/drawings (`plugins/scenes.ts`, 19) and the roll and chain paths. `test/core-atomicity-domains.test.ts` (16) makes each path's event type fail with a **real CHECK constraint through the real driver** and asserts both halves — a named error *and* no domain row — because "the request failed" is otherwise compatible with the bug. Remaining: §6.2. |
| 3 | AI recap drafting (FR12.12) | **closed** | `apps/server/src/fixer/tools-recap.ts` (`draft_recap`) + `apps/server/src/fixer/recap.ts` (`assembleRecap`). The model writes prose only and is told never to state a number; the server adds tallies, casualties, reveals and awards from the log. The spoiler guard runs unconditionally. `test/fixer-recap.test.ts` (8), `e2e/recap.spec.ts` (3). |
| 4 | Spirit tracker (FR8.3) | **closed** | `apps/server/src/plugins/magic.ts` (9 spirit routes incl. spend-a-service, dismiss, sustain, join-an-encounter), `services/magic.ts` / `magic-derive.ts` / `magic-store.ts`, `apps/web/src/features/sheet/magic/SpiritList.tsx`. GM-side spirits are `gm`-visible by construction (`spiritVisibility`). `test/magic.test.ts` (31), `e2e/magic.spec.ts`. |
| 5 | pdf.js viewer (FR11.3) | **closed** | `apps/web/scripts/vendor-pdfjs.mjs` + `apps/web/src/features/reader/*`; `pdfjs-dist ^4.10.38` in `apps/web/package.json`. Self-hosted, byte-ranged, page-accurate, with the browser viewer kept as a documented three-way fallback. `test/reader-route.test.ts` (9), 6 web unit files, `e2e/reader.spec.ts` (3) against a real generated PDF (`e2e/fixtures/pdf.ts`). |
| 6 | Foci and reagents (FR8.4) | **closed** | `apps/server/src/services/magic-foci.ts`, `/api/characters/:id/foci` + `…/reagents` + `…/magic/derived`, `apps/web/src/features/sheet/magic/FociRack.tsx` + `ReagentCounter.tsx`. Bonding and activation are separate gates; an active bonded focus emits real `Modifier` rows so the pool moves with provenance. |
| 7 | Restore-and-boot in CI, not just seed-and-boot | **closed** | `apps/server/test/restore-boot.test.ts` (19) drives both real paths: a byte-copy restore of `DATA_DIR` booted on the copy (file store included), and a move through the **new** `apps/server/scripts/migrate-to-postgres.ts`, with a counterfactual proving the sequence pass is load-bearing. CI runs it as its own step, plus a `restore-postgres` job with a `postgres:16` service for the node-postgres half. The gap named in the old item — "the PGlite → Postgres move has no script at all" — is closed by that script existing. |
| 8 | Map vision for the Fixer (the open half of FR12.11) | **closed** | `apps/server/src/fixer/vision.ts` + `vision-probe.ts`; `read_map_image` is offered only when a cached probe says the model reads images (`agent.ts:363`), and `POST /api/fixer/propose-geometry`'s vision lane answers `501 vision_unsupported` for a text-only box rather than pretending it is off. `test/fixer-vision.test.ts` (17). Output is still a draft — the scene is untouched until the GM accepts (Principle 8). |
| 9 | FR5.6 — templates in the codex | **closed** | Migration `0003_npc_template_wiki_link.sql` adds `npc_templates.wiki_page_id`; `services/codex-templates.ts`, `POST/DELETE /api/wiki/:id/templates`, and `GET /api/wiki/:id` returning `page.templates`. `web/features/codex/TemplatePanel.tsx`. `test/codex-templates.test.ts` (10), web `templates.test.tsx` (13). Pins, templates and pages are one graph now. |
| 10 | Tactical hints on the acting NPC's turn (FR10.10) | **closed** | `apps/server/src/services/tactical-hints.ts`, surfaced through the GM-only quick-roll rack in `plugins/encounters.ts:419`. Off unless `campaigns.settings.tacticalHints === true`; a hint is text with no id and no verb, so there is deliberately nothing to "apply". `test/tactical-hints.test.ts` (12), 3 web test files, `e2e/hints.spec.ts` (2). |
| 11 | Make the usage meter survive a restart (FR12.15) | **closed** | `ai_usage` (`schema.ts:432`, migration 0002) + `fixer/usage.ts` `persistTurnUsage` / `campaignUsage`. `test/fixer-usage.test.ts` (7) reads the number back from a fresh server on the same directory; the playthrough asserts the durable and live halves agree on tokens and disagree on process-lifetime counts, which is exactly what each is for. |
| 12 | Seed the demo `runs` row through its route | **closed** | `apps/server/seed/demo.ts:351` posts to `/api/campaigns/:id/runs`. The file's docblock now names the only two remaining raw writes (campaign creation and the wipe) and why each has to be. `test/seed-demo-run.test.ts` (11). |

And the four browser/terminal findings from §2, unchanged since they closed:

| # | Defect | State | Evidence |
| --- | --- | --- | --- |
| L1 | The web UI never backfilled state on mount | **closed** | `live/hydrate.ts` at the `useLiveConnection` chokepoint; 39 unit tests + `e2e/hydration.spec.ts` (4). |
| L2 | Scene environment modifier applied twice | **closed** | `features/sheet/rollDialogState.ts`; `rollDialogState.test.ts` (18), `e2e/pool-parity.spec.ts` (2). |
| L3 | `/join/:code` served JSON to a scanning player | **closed** | One path, one owner, enforced in four places; `e2e/join.spec.ts` (6). |
| L4 | Event log frozen on a seeded database | **closed** | Sequence guard + `Hub.atomic` + `DbError` surfacing + clean shutdown everywhere, now with both real restore paths under test. `seeded-boot.test.ts` (10), `restore-boot.test.ts` (19), `durability.test.ts`, `core-atomicity.test.ts` (9), `core-atomicity-domains.test.ts` (16), `core-shutdown.test.ts` (8), `seed-durability.test.ts` (1), `e2e/log-append.spec.ts` (2). |

**Deferred by design and not defects:** the Matrix toolkit (M7, Q3 — no decker
at the table) and with it the sheet's Matrix tab, token vision and dynamic
lighting (FR9.16, Q9 — manual fog is the permanent plan), the Matrix overlay
(FR9.17), native priority char-gen (FR3.9, D5 — Chummer is the builder), the
advancement editor (FR3.7), stagecraft audio (FR12.10 / FR9.18), the prop/tile
stamp library (FR9.2's P3+ half), the image-gen adapter, the PWA offline cache,
and campaign export. They stay unbuilt until the table asks.

---

## 6. What is still worth doing

**The list is genuinely short now, and saying so is the point.** Every one of
the twelve items this round was working from is closed, all four LIVE defects
stayed closed, P0 through P5 are done bar two deliberate deferrals, and the
Roll20 exit checklist has no red rows and no asterisks. What follows is five
real items, only one of which a player would notice at the table, plus a
half-page of tidiness. Padding it would be dishonest about where the project is.

1. **The spoiler-guard warning never reaches the GM's eyes (FR12.19).** This is
   the one item with a table cost. The server-side guard is complete —
   `spoilerScan` (`apps/server/src/fixer/drafts.ts:415`) finds the GM-only names
   in a player-facing draft and returns `SpoilerFlag[]` = `{name, why}` (the
   type is declared at `:405`). The web
   client throws them away: `spoilerFlagsOf()`
   (`apps/web/src/features/gm/fixer/api.ts:124`) keeps only entries where
   `typeof f === 'string'`, so `DraftsInbox.tsx:36` renders nothing and the GM
   accepts a recap with no warning on the card. Accept the object form and
   render `f.name`, keeping the string form for anything that still sends one.
   `apps/web/e2e/recap.spec.ts:235` already asserts the fixed behaviour behind a
   `test.fail` marker — when the fix lands it trips as an unexpected pass and
   the marker comes off with it. Half an hour, and it is the difference between
   a guard that works and a guard the GM can see working.
2. **The last 14 non-atomic emits.** Down from 44. Every path LIVE-4 actually
   broke — rolls, ledger, encounter damage, the clock, scene/token/fog — is
   inside `Hub.atomic` and pinned by `core-atomicity-domains.test.ts`. What is
   left, by file: `plugins/characters.ts` (4 — `sheet.updated` after a sheet or
   play-state save), `plugins/codex.ts` (2 — `wiki.revealed` after the page
   update), `plugins/generator.ts` (2 — `encounter.updated` after a build),
   `plugins/campaigns-admin.ts` (2 — the ownership-transfer log line),
   `services/rolls-edge.ts` (1 — the Edge debit's `sheet.updated`),
   `services/magic-store.ts` (1 — `magic.updated`), `services/rolls.ts:379` (the
   fallback arm of a helper that prefers `tx.emit` when handed one), and
   `plugins/scenes.ts:724` (`display.set`, which has no domain row to be
   inconsistent with). The Edge debit is the one worth doing first: it spends a
   real resource and announces it separately. Each conversion is small — hoist
   the reads out of the block per the PGlite deadlock rule in `Hub.atomic`'s
   docblock — and the harness for proving it already exists.
3. **The resolve-chain dialog previews with browser dice (FR10.8 / G5).**
   `apps/web/src/features/table/ResolveChainDialog.tsx:7` says so in its own
   docblock. The authoritative endpoint exists and is complete —
   `POST /api/encounters/:id/resolve-chain` server-rolls attack, defence and
   soak, persists one `rolls` row per pool at `gm` visibility inside a
   transaction, and waits for `/commit` before any damage lands. The dialog
   still runs `resolveAttackChain` locally and commits only the final boxes. The
   damage that lands is server-applied, so the guarantee holds on the record;
   what is wrong is that the dice the GM reads out mid-chain are the browser's
   and never reach the log. Swapping the preview for that endpoint keeps the
   card UI and the commit path unchanged.
4. **A Matrix tab, if and only if someone rolls a decker.** This is the only
   thing holding FR3.2 at `partial`, and it should stay unbuilt until Q3 changes
   — but it is worth naming as the one FR row whose status is set by a table
   decision rather than by us. `get_matrix_state` already answers `tracked:
   false` with a note so nothing invents an Overwatch score in the meantime.
5. **Tidiness, in one batch.** (a) Lazy-load `features/codex/` to satisfy §15's
   letter — the budget is met with 2× headroom, so this buys clarity, not
   latency. (b) `apps/server/src/fixer/state-codex.ts:7` still names "spirit
   services FR8.3" as not built; `state-play.ts:114` now returns `tracked:
   true`, so the comment is stale and misleading to the next reader. (c) The
   §15 clauses nothing measures yet — Grid frame budget with 60 tokens
   (DESIGN §17.4), and the p95 roll-to-visible latency — have no harness. Not
   urgent at 7 users on a LAN, but they are the two NFRs no test would catch
   regressing.

**The standing lesson from LIVE-1 through LIVE-4.** Each of the four was
invisible to harnesses that were individually correct and collectively blind in
one direction. LIVE-1 to LIVE-3 were about a seam nothing crossed. LIVE-4 was
sharper: the browser harness *did* cross the seam, on every run, and was green
anyway, because the fault needs a database in a state no test ever built. So the
question worth asking of a new suite is not only "which seam does this cross
that nothing else crosses" but "which *state* does this construct that nothing
else constructs" — and the answer for most suites, honestly, is "the happy one".
All four defects were found in ten minutes of ordinary use against a fully green
build.

That lesson is why item 1 above is item 1. It was found the same way: not by a
failing assertion, but by reading what the GM's screen actually renders and
noticing that a guarantee the server keeps perfectly never arrives anywhere a
human can see it. A guard nobody is shown is a guard that does not exist.
