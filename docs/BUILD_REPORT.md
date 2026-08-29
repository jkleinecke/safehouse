# Safehouse — build report

What exists in this repo, measured against `DESIGN.md` rev 0.9 §6 (feature
modules) and §18 (roadmap). Rewritten from the code as it now stands — every FR
row below was re-read in the source, not carried forward from a previous
revision.

- **Repo state:** 304 TS/TSX files of shipping source (~58.3k lines) across 5 workspace packages; 414 files / ~82.4k lines counting tests and the browser E2E suite. (`*.ts`/`*.tsx` under `apps/` and `packages/`, excluding `node_modules` and `dist`; seeds and scripts count as source, `test/`, `*.test.*` and `e2e/` do not.)
- **Verified on:** 2026-08-29, re-run from a clean checkout for this revision. `pnpm -r --workspace-concurrency=1 typecheck` → exit 0. `pnpm -r --workspace-concurrency=1 build` → exit 0. `pnpm -r --workspace-concurrency=1 test` → **1234 passed, 1 skipped, 0 failed** across **92 test files**.
- **Scripted playthrough:** `pnpm playthrough` → **196 checks, 196 passed, 0 failed, 0 n/a**, 9.5 s (`docs/demo/SESSION_REPORT.md`). The count can move by one or two between runs because a handful of assertions are conditional on the night's dice; this run had no content-dependent skips.
- **Browser E2E:** `pnpm --filter @safehouse/web e2e` → **26 passed** in chromium, **8 spec files**, 20.8 s.

Status vocabulary:

| Term | Meaning |
| --- | --- |
| `done` | Implemented end to end, server-authoritative where the FR requires it, covered by a test, a playthrough assertion, or an E2E spec. |
| `partial` | Core of the FR works; a named sub-clause is missing. Every one is itemized. |
| `deferred` | Not built, and §18 puts it in a phase we have not reached (P5/P6) or Q9/Q3 resolved it as unused. Not a defect. |
| `not built` | In a phase we have otherwise shipped, but absent. These are the real gaps. |

---

## 1. Status by module

### M1 — Accounts, campaign, membership *(P0)*

| FR | Status | Where |
| --- | --- | --- |
| FR1.1 QR join, GM at install | done | `services/auth.ts` (`POST /api/campaigns` bootstrap, `GET /api/campaigns/:id/join-qr`, `GET\|POST /api/join/:code`), `plugins/auth.ts` (`POST /api/campaigns/:id/gm-device`, `POST …/gm-pair` — single-use GM pairing code). GM side of the UI now exists: `web/src/components/shell/Landing.tsx` offers three tabs (start a campaign · pair with a code · paste a token) over `signin.ts` / `signin-api.ts`. `test/auth-gm.test.ts` (18), `e2e/gm-signin.spec.ts` (3). |
| FR1.2 one GM + players + observers; transfer ownership | done | Roles and membership in `memberships`/`Role`. Transfer: `POST /api/campaigns/:id/transfer-ownership` and `PATCH /api/characters/:id/owner` in `plugins/campaigns-admin.ts`. |
| FR1.3 expiring, role-scoped, revocable invites | done | `createInvite` (`expiresInMinutes`, `maxUses`), `POST /api/devices/:id/revoke`. `join-qr` still refuses `role=gm` by construction — GM devices come only from bootstrap / `gm-device` / single-use `gm-pair`. |
| FR1.4 roles gate everything per §13 | done | `requireAuth`/`requireRole`/`assertCampaign`; hub filters by visibility server-side. Playthrough + `e2e/secrecy.spec.ts` (4). |
| FR1.5 campaign settings incl. house-rule flags + webhook | done | `PATCH /api/campaigns/:id`. Flag system ships empty per Q4 (table plays RAW). |

### M2 — Dice engine and roll log *(P1)*

| FR | Status | Where |
| --- | --- | --- |
| FR2.1 pool → hits/ones/glitch, server-rolled, persisted, broadcast | done | `services/dice.ts` (`crypto.randomInt`), `packages/rules/src/dice.ts`, `roll.created`. Copilot dice now included — see FR10.8. |
| FR2.2 limits, hits above limit shown but excluded | done | `limitedHits` + `limit` ref on every `RollResult`. |
| FR2.3 Edge actions | done | Push the Limit pre/post with Rule of Six, Second Chance, spend/burn: `rules/src/dice.ts`, `services/character-play.ts`. **Seize the Initiative, Blitz and Close Call now exist**: `rules/src/dice.ts` (`seizeInitiative`, `blitzInitiative`, `closeCall`), `services/rolls-edge.ts`, `POST /api/edge/{seize-initiative,blitz,close-call}`, client in `web/features/sheet/edgeActions.ts` + `components/CloseCallOffer.tsx`. `test/rolls-edge.test.ts` (12). |
| FR2.4 buying hits (4:1) | done | `POST /api/rolls/buy-hits`, `buyHits`. |
| FR2.5 simple / opposed / threshold / extended / teamwork | done | `services/rolls.ts`; extended loop with shrinking pool in `rules/src/dice.ts`. |
| FR2.6 provenance stored on the log entry | done | Breakdown persisted with the roll. |
| FR2.7 public / gm / gm_owner, filtered server-side | done | Hub visibility filter; `e2e/secrecy.spec.ts` asserts the *payload*, not the pixels. |
| FR2.8 free-form rolls + personal macros | partial | Free-form via `POST /api/rolls`. `web/features/sheet/macroStore.ts` was rewritten server-first with a local mirror, but **the server half never landed**: there is no `GET/PUT /api/campaigns/:id/macros` route and no `user_macros` table, so `hasRemote` stays false and macros are still per-device. The expected contract is written out as an `// INTEGRATION:` block at the top of `macroStore.ts`. |
| FR2.9 append-only interleaved session log | done | `POST/GET /api/campaigns/:id/log` over `ws_events`. This is the FR that LIVE-4 killed outright on any seeded campaign; it is now covered across a process boundary by `test/seeded-boot.test.ts` and in the browser by `e2e/log-append.spec.ts`. |
| FR2.10 Discord mirroring of public rolls | done | `services/discord.ts`; `test/discord-recap.test.ts`. |
| FR2.11 campaign rollable tables | done | `/api/campaigns/:id/roll-tables`, `POST /api/roll-tables/:id/roll`; GM-only tables stay GM-only. |

### M3 — Characters *(P1 core)*

| FR | Status | Where |
| --- | --- | --- |
| FR3.1 Chummer `.chum5` import, raw file kept, unmapped listed, re-import diff | done | `services/chummer.ts` + `chummer-xml.ts`, `diffSheets`, `POST /api/characters/:id/import`. |
| FR3.2 phone-first sheet with tabs | partial | Skills, Combat, Magic, Gear, **Contacts**, Background, Ledger + pinned identity/vitals strip (`features/sheet/playState.ts` `SHEET_TABS`). The contacts route it calls now exists (see FR5.8). **Missing: Matrix tab** — consistent with M7 being deferred. |
| FR3.3 derived values with provenance | done | `deriveCharacter`, `GET /api/characters/:id/derived` (which also returns `combatantId` when the tracker is live — that is what makes Seize/Blitz offerable). 34 derive tests. |
| FR3.4 monitors, wound modifiers, Edge, ammo, progressive recoil, sustained, statuses | done | `services/character-play.ts`, `POST …/damage\|edge\|ammo\|recoil\|sustained`. |
| FR3.5 manual override on any derived value, flagged, with a note | done | `POST/DELETE /api/characters/:id/overrides`. |
| FR3.6 karma & nuyen ledgers, pending-until-approved | done | `plugins/ledger.ts`; approve/reject. Run awards post through it (FR5.5). |
| FR3.7 advancement (guided karma spends) | deferred | P5. Not built. |
| FR3.8 revisions + rollback | done | `GET …/revisions`, `POST …/rollback`. |
| FR3.9 native priority char-gen | deferred | P6 by design (D5 — Chummer is the builder until then). |

### M4 — Combat tracker *(P1)*

| FR | Status | Where |
| --- | --- | --- |
| FR4.1 encounters from PCs / templates / generator / grunt groups; prep + launch, incl. from a scene | done | `plugins/encounters.ts`, `POST /api/scenes/:id/stage-encounter`. |
| FR4.2 SR5 initiative incl. astral / cold-sim / hot-sim variants, wound mods | done | `rules/src/combat/initiative.ts`. Staged encounters now derive through the engine too (see FR9.10). |
| FR4.3 native pass structure (−10 loop, re-roll on new turn) | done | `services/encounters.ts:369` — `rollInitiativeAll` sets `turn = max(1, turn)`, `pass = 1`, so a fresh encounter opens on turn 1 / pass 1 rather than 0/0. |
| FR4.4 interrupt menu with editable costs | done | `DEFAULT_INTERRUPTS` + custom cost. Seize/Blitz reachable from the sheet and stamped into the tracker's order (`services/rolls-edge.ts`). |
| FR4.5 damage → monitor → overflow → wound recompute, one-tap undo | done | `services/encounters-damage.ts`. |
| FR4.6 grunt groups, shared PR + Group Edge | done | `AddCombatantBody` and `PATCH /api/combatants/:id` both carry `professionalRating` (`plugins/encounters.ts:87,92,115`; `services/encounters.ts:230,287`). Hand-added NPCs now measure morale against a real PR — the playthrough asserts `pressure 4 vs PR 3`. |
| FR4.7 status effects with durations | done | `EffectDurationSchema` (`end_of_turn` / `while_sustained` / `passes` / `manual`). |
| FR4.8 everything hand-editable; "dumb mode" | done | `PATCH /api/combatants/:id`, `source: 'manual'`. |
| FR4.9 filtered player encounter view | done | Server-side; hidden rows absent, not redacted. `e2e/secrecy.spec.ts`. |
| FR4.10 tracker ↔ grid ↔ copilot | done | Acting-token glow, token bars from monitors, copilot rack on generator-backed rows. |

### M9 — The Grid *(P2 core)*

| FR | Status | Where |
| --- | --- | --- |
| FR9.1 scenes, configurable grid, notes, activate, private staging | done | `plugins/scenes.ts`, `contracts/src/scene.ts`. |
| FR9.2 map building | done | Image upload, multi-image background list, grid alignment, walls/doors/zones **with a GM authoring UI** (`web/features/grid/gm/GeometryTab.tsx` over `geometryEdit.ts`, 20 tests), and scan-friendly controls — rotate / crop / contrast / brightness in `gm/MapTab.tsx` (`mapImage.ts`, 13 tests). Prop/tile stamp library remains P3+ by design. |
| FR9.3 map pins → codex / handouts | done | `gm/PinsTab.tsx` (drop, name, link to a wiki page or handout, per-pin visibility) and `stage/layers.ts drawPins` renders them; GM-only pins are stripped server-side in `sceneForViewer`. |
| FR9.4 tokens (PC/NPC/grunt/spirit/drone/prop), art, sizes, facing | done | `contracts/src/token.ts`, `POST /api/scenes/:id/tokens`. |
| FR9.5 drag with snap, server-authoritative, smooth interim motion | done | `token.drag` ephemeral + `token.move` authoritative. |
| FR9.6 bars, status markers, aura rings | done | `grid/projection.ts` gates numeric bars per viewer (27 tests). |
| FR9.7 hidden tokens — positions never sent | done | `e2e/secrecy.spec.ts` "the grid never holds a hidden token" reads the client's own store, not the screen. Principle 4 held. |
| FR9.8 ruler in metres, walk/run colouring | done | `grid/geometry.ts` + tests. |
| FR9.9 range bands → range modifier into the roll | done | Range band lands in the receipt. |
| FR9.10 encounter ↔ scene both ways | done | `services/scenes.ts` `stageEncounter` now calls `deriveFor(sheet, kind)` (import at `:53`, use at `~:757`) exactly as `addCombatant` does — wired reflexes and adept powers survive staging. The playthrough shows Torque and Sparrow each rolling two initiative dice off a staged encounter. |
| FR9.11 scene environment as a modifier source with provenance | done | `rules/src/env.ts`, `activeSceneModifiers`. Applied **once** — see LIVE-2 in §2. |
| FR9.12 AoE circles + grenade scatter helper | done | `POST /api/scenes/:id/scatter`; client `rollScatter`. |
| FR9.13 manual fog, server-authoritative, persisted | done | `POST /api/scenes/:id/fog`. |
| FR9.14 named staged reveals with announcement | done | Same. |
| FR9.15 pings, pointer trails, drawings, GM "focus here" | done | `pointer` and `scene.focus` are contracted commands (`contracts/src/events.ts:145,158`) with hub handlers (`hub.ts:104–120`) and a GM console (`grid/gm/DisplayTab.tsx`). Drawings via `/api/scenes/:id/drawings`. |
| FR9.16 wall-based vision + dynamic lighting | deferred | P6, and Q9 resolved the table does not use it. Manual fog is the permanent first-class path. |
| FR9.17 Matrix overlay | deferred | P6 stretch. |
| FR9.18 ambient audio | superseded | Folded into FR12.10 (P5). `audio_tracks` table and `Scene.audioRef` exist; nothing reads them. |
| FR9.19 TV joins as a `display` device, same server-side filtering | done | `e2e/join.spec.ts`, `e2e/tv.spec.ts`. |
| FR9.20 what the TV shows | done | **The map is on the TV.** `web/features/tv/TvStageView.tsx` mounts a read-only Pixi stage (`features/grid/tvStage.ts`, `pointer-events: none`, one ticker) fed by `tv/hydrate.ts`; `TvPage.tsx:145–152` renders it alongside the ribbon, big dice moments, handout takeovers and the idle card. `e2e/tv.spec.ts` asserts the stage renders, that a rebooted TV comes back to the scene by itself, and that the kiosk holds no GM-only state. This was the P2 exit criterion. |
| FR9.21 GM steering (focus camera, layer toggles, blank the table) | done | `plugins/scenes.ts:623–641` emits `display.updated`; `grid/gm/DisplayTab.tsx` drives blank/ribbon/focus; the TV consumes it and replays the newest event on reconnect (`services/scenes.ts:798–818`). |

### M10 — The Opposition Kit *(P3)*

| FR | Status | Where |
| --- | --- | --- |
| FR10.1 archetype templates: role tags, tier dial, per-tier ranges, loadout slots | done | `/api/campaigns/:campaignId/npc-templates`, `contracts/src/generator.ts`. |
| FR10.2 seeded generation, original flavour tables, engine-derived values | done | `rules/src/generator/`; `tables.ts` is original writing (G6). |
| FR10.3 promote to reusable template, edits round-trip | done | `POST /api/generator/promote`. |
| FR10.4 encounter builder | done | `POST /api/encounters/build`. |
| FR10.5 party-aware threat readout with visible math | done | `GET /api/encounters/:id/threat`, `services/generator-threat.ts`. |
| FR10.6 balance levers recompute live | done | `POST /api/encounters/:id/threat/recompute`. |
| FR10.7 quick-roll rack | done | `GET /api/combatants/:id/quick-rolls`, `POST …/quick-roll`. Rolls are stamped with the active session (`services/encounters-rolls.ts:234`), so they show up in housekeeping and `GET …/rolls?session=`. |
| FR10.8 resolved chains, card-per-step, override before commit | done | `services/encounters-rolls.ts` `chainRollInputs` + `recordChainRolls` writes one `rolls` row per pool (attack / defence / soak) at `gm` visibility the moment the server throws them, linked by `request.meta.chainId`; damage still lands only on `…/resolve-chain/commit` (Principle 2). `test/encounters-chain-rolls.test.ts`. The playthrough's closing check now reads **38 of 38 persisted rolls, copilot dice included**. |
| FR10.9 morale from Professional Rating triggers | done | GM-only, never acts; now measured against a real PR for hand-added rows too (FR4.6). |
| FR10.10 tactical hints on the acting NPC's turn | not built | Optional and off by default per the FR, but absent entirely. `roleTags` exist on templates; nothing consumes them for hints. |

### M11 — Rules library *(P1)*

| FR | Status | Where |
| --- | --- | --- |
| FR11.1 registry: code, title, page offset, calibration helper | done | `plugins/books.ts`, `PATCH /api/books/:id`; `web/features/gm/BooksPage.tsx` calibration stepper. |
| FR11.2 structured `{book, page, note?}` refs | done | `contracts/src/common.ts`; used across sheet, templates, tables, codex. |
| FR11.3 one-tap open at the printed page, in-app, on phones | partial | Server side complete: `GET /read/:code?p=N` resolves the offset, `GET /files/books/:code` streams the PDF with byte ranges behind auth. **The viewer is still the browser's built-in PDF viewer** framed at `#page=N` (`web/features/gm/books/BookReader.tsx`), not self-hosted pdf.js. Works on desktop; the "works on phones" clause stays unproven on mobile browsers that ignore `#page=`. |
| FR11.4 ref autolinking of `SR5 p.426` patterns | done | `web/features/gm/books/refs.ts` + tests; also used by the codex renderer. |
| FR11.5 shared with the table, per-book GM-only toggle | done | A player's search returns real page provenance. |
| FR11.6 named bookmarks + recently-opened trail | done | `services/bookmarks.ts` + `POST/PATCH/DELETE /api/campaigns/:id/bookmarks`, `GET /api/campaigns/:id/library`, `POST …/library/recent`. `test/books-bookmarks.test.ts` (13). |
| FR11.7 `pnpm seed:books` folder import with guessed codes | done | `apps/server/scripts/seed-books.ts`. PDFs stay out of git. |

### M12 — The Fixer *(assistant core P1)*

| FR | Status | Where |
| --- | --- | --- |
| FR12.1 GM-only dockable streaming panel, history, two model slots | done | `plugins/fixer.ts`, `fixer/conversations.ts`, `web/features/gm/fixer/`. |
| FR12.2 grounded rules research, citations from retrieval not the model | done | `search_books` returns `{book, printedPage}`; the chip is the server's. |
| FR12.3 lore and state research | done | `search_codex` now exists over a real codex (`fixer/state-codex.ts:42`, `tools-codex.ts:25`). |
| FR12.4 planning / brainstorming with "save to codex" | done | The draft lands as a `wiki_page` that the codex UI can then browse and edit. |
| FR12.5 NPC fiction layer onto procedural stats | done | `generate_npc` + persona; D13 split held. |
| FR12.6 in-character conversations with knowledge boundary + secrets | done | `POST /api/npcs/:id/converse`. |
| FR12.7 codex drafting | done | `draft_wiki_page` → `wiki_pages` on accept, readable and editable at `/c/:id/codex`. |
| FR12.8 fog NL commands, proximity prompts, region auto-naming | done | `suggest_fog_reveal` + `fog_reveal` draft kind; proximity in `fixer/proximity.ts` behind `check_fog_proximity` and `GET /api/fixer/fog-proximity` — GM-only, never written down. Region naming rides the geometry proposal (below). |
| FR12.9 token identification / labelling | done | `fixer/token-id.ts`, `identify_tokens`, `POST /api/fixer/identify-tokens`. |
| FR12.10 stagecraft (music tagging + scene matching) | deferred | P5. `audio_tracks` table only. |
| FR12.11 map assistance (layout copilot) | done | `fixer/geometry.ts`, `propose_geometry`, `POST /api/fixer/propose-geometry`, `GET /api/fixer/geometry-schema`. Guided-JSON rectangles compile to walls / doors / named fog regions **as a draft** (the playthrough: 19 walls, 4 doors, 4 regions, scene untouched). *Map vision* (reading an uploaded map image) is not built — the model never sees the image. |
| FR12.12 recap drafts | partial | The recap skeleton is still deterministic and client-side (`web/features/gm/sessions/recap.ts`, "draft from log"). There is no dedicated AI recap tool; the playthrough still produces one through the generic `draft_wiki_page`. |
| FR12.13 OpenAI-compatible local provider; unset base URL hides everything | done | `fixer/llm.ts`, `GET /api/fixer/status`. Nothing touches the internet. |
| FR12.14 retrieval over extracted book text, Postgres FTS | done | `book_pages.tsv` generated tsvector, `searchBookPages`. |
| FR12.15 every generation an `ai_generation` draft; usage meter | done | `fixer/drafts.ts`, `GET /api/campaigns/:id/fixer/usage`. Chat turns producing no draft are metered in a per-process accumulator that resets on restart — `ai_generations.usage` only persists draft usage (`fixer/usage.ts` INTEGRATION note). |
| FR12.16 fast/primary slot discipline | done | `fast` defaults to `primary` when unconfigured. |
| FR12.17 read-only state tool catalog | done | All 13 read rows plus 5 drafting/assist tools: `get_campaign`, `list_characters`, `get_character`, `get_ledger`, `get_encounter`, `get_scene`, `get_session_log`, `search_books`, `get_page`, `search_codex`, `list_contacts`, `list_runs`/`get_run`, `get_calendar`, `list_npcs`, `get_npc`, `get_threat_readout`, `get_magic_state`, `get_matrix_state` — plus `generate_npc`, `draft_wiki_page`, `suggest_fog_reveal`, `check_fog_proximity`, `identify_tokens`, `propose_geometry`. `get_magic_state`/`get_matrix_state` return `tracked: false` with a note for spirits and OS/marks rather than a misleading zero (`fixer/state-play.ts`) — honest about M7/FR8.3 not existing. |
| FR12.18 situation snapshot prefix during live sessions | done | `fixer/agent.ts:91`. |
| FR12.19 spoiler guard on player-facing prose | done | `fixer/drafts.ts`; the playthrough catches a GM-only name in a recap draft. |

### M5 — Campaign codex *(P4)*

Built this round. `plugins/codex.ts` (wiki pages, per-page **and per-section**
visibility, `[[Wiki-links]]` + backlinks + unresolved report, handouts staged
then revealed), `plugins/codex-runs.ts` (runs, awards posting to the ledger as
*pending*), `plugins/codex-calendar.ts` (in-game dates and beats),
`plugins/contacts.ts`. Services in `services/codex.ts` / `codex-store.ts`. Web:
`features/codex/` (`CodexPage`, `PageBrowser`, `PageView`, `Markdown`,
`RunsBoard`, `CalendarView`, `ContactsPanel`, `HandoutsPanel`) with routes at
`/c/:id/codex`, `/c/:id/codex/:pageId`, `/c/:id/calendar`, `/c/:id/gm/runs`.

| FR | Status |
| --- | --- |
| FR5.1 typed markdown pages, tags | done |
| FR5.2 per-page and per-section visibility, server-filtered, one-click reveal | done — a player's GET does not *contain* the hidden section; an invisible page 404s like a nonexistent one, so the route is not an oracle |
| FR5.3 `[[Wiki-links]]`, backlinks, unresolved links as create-prompts | done (`GET /api/campaigns/:id/wiki/unresolved`) |
| FR5.4 handouts staged privately, revealed live | done (`POST /api/handouts/:attachmentId/reveal`; TV takeover already worked) |
| FR5.5 runs: Johnson, objectives, opposition links, payout, awards → ledger, recap | done (`POST /api/runs/:id/award` books *pending* ledger rows) |
| FR5.6 NPC/archetype templates live in the codex, page-referenced | **partial** — templates live in `npc_templates` with no codex page link either way |
| FR5.7 in-game calendar | done |
| FR5.8 contacts per character, GM-shared by default, linkable to NPC pages | done (`plugins/contacts.ts`; a second player asking for someone else's contact gets a flat 403) |

Tests: `test/codex.test.ts` (19), `test/codex-runs.test.ts` (14),
`test/contacts.test.ts` (8), web `features/codex/{lib,md,live}.test.ts` (55).

### M6 — Sessions *(P4)*

| FR | Status | Where |
| --- | --- | --- |
| FR6.1 session entity: date, attendance, linked runs, log, prep notes, recap | done | `plugins/sessions.ts`. |
| FR6.2 start/end live mode | done | `POST /api/campaigns/:id/sessions/start`, `POST /api/sessions/:id/end`, `GET …/live`. |
| FR6.3 recap publishing to Discord on explicit GM action | done | `POST /api/sessions/:id/publish-recap`; with no webhook, nothing leaves the laptop. |

### M7 — Matrix toolkit *(P6, on demand)*

**Deferred by design** (Q3: no decker at the table). What exists: the
`matrix_hosts` table, the `os.changed` event, the Matrix AR / cold-sim /
hot-sim initiative variants in the engine, and `get_matrix_state` returning
`tracked: false` so the Fixer cannot invent an Overwatch score. FR7.1–7.6: not
built.

### M8 — Magic toolkit *(P5)*

| FR | Status | Where |
| --- | --- | --- |
| FR8.1 casting flow with linked Drain resistance, applied on confirm | done | `web/features/sheet/tabs/DrainApply.tsx` + the rolls service. |
| FR8.2 sustained spells, −2 each, focus/quickening exempt | done | `services/characters.ts`, `POST /api/characters/:id/sustained`. Surfaced to the Fixer as a live penalty in `get_magic_state`. |
| FR8.3 spirit tracker (Force, services, spend a service, joins encounters) | not built | No table, no contract, no UI. `get_magic_state` reports `spirits: { tracked: false }` rather than zero. |
| FR8.4 foci bonding/toggles and reagent counters | not built | `get_magic_state` name-matches gear that looks like a focus; there is no bonding state, no toggle, no reagent count. |
| FR8.5 adept powers as passive/toggled modifier sources | done | Modifier pipeline; a Quickened Reflexes power contributes an initiative die through staging as well as through `addCombatant`. |

### Phase reading against §18

| Phase | State |
| --- | --- |
| P0 Skeleton | **Done.** The GM half of FR1.1 landed; a fresh install now has a GM path through the app and a lost laptop can be re-paired. |
| P1 Run the table | Done. |
| P2 The Grid | **Done.** The map is on the TV (FR9.20), geometry and pins have authoring UIs (FR9.2/9.3), pointer and focus cross the wire (FR9.15/9.21), and the Fixer's P2 items shipped (FR12.9, FR12.11 layout copilot). Exit criterion met bar map *vision*, which is the optional half of FR12.11. |
| P3 Opposition Kit | Done bar FR10.10 hints. Both FR10.7/10.8 record defects are closed. |
| P4 Campaign memory | **Done.** M5 codex, runs, calendar, contacts, handouts; M6 sessions; FR3.6 approvals. Open sub-clauses: FR5.6 template↔codex linkage, FR12.12 AI recap drafting. |
| P5 Deep SR5 | Partial: FR8.1/8.2/8.5 shipped with the sheet. FR3.7, FR8.3, FR8.4, FR12.10 did not. |
| P6 Stretch | Deferred as designed: M7, FR9.16, FR9.17, FR3.9, image adapter, PWA, export. |

### Roll20 exit checklist (§18)

| Roll20 feature | State |
| --- | --- |
| Maps, grid, tokens | shipped |
| Fog of war | shipped (manual + staged) |
| Measurement / ruler | shipped, SR5-native |
| Dice + macros | shipped; **macros still per-device** (FR2.8) |
| Initiative tracker | shipped |
| Character sheets | shipped via Chummer import |
| Handouts | shipped — upload, attach, stage, reveal, TV takeover |
| Journal / notes | shipped (M5 codex) |
| Rollable tables | shipped |
| Shared map on the table TV | **shipped** |
| Jukebox, dynamic lighting | not used, by decision (Q9) |
| PDFs deep-linked in-app | shipped (browser PDF viewer, not pdf.js) |

No red rows. The two that were red — the map on the TV and the journal — are
both green, which is the condition §18 attaches to cancelling the Roll20
subscription.

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
Postgres is a supported configuration with no migration script behind it. (The
compose `backup` service is *not* a source of this: it is a nightly `pg_dump`,
and a dump carries `setval` for every sequence.) So the honest summary is that
the exact provenance of the reported directory is not proven; the state it was
in, and the fact that the state is fatal and reachable, both are.

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
  transaction handle, and broadcasts **only after COMMIT**. `services/rolls.ts:535`
  uses it, so a failed append can no longer leave a roll that no log will ever
  show, and a rolled-back roll is also an unsent socket frame. The method
  carries the PGlite deadlock rule in its own docblock (single embedded
  connection: every read inside the block must go through `tx.db`, never the
  service's `db`, or it waits forever).
- **A diagnosable error.** `appendEvent` wraps failures in `DbError` carrying
  PostgreSQL's own SQLSTATE, violated constraint and DETAIL, and the hub logs
  them with the campaign id and event type. The next person sees
  `23505 / ws_events_pkey / … already exists`, not the SQL.
- **Clean hand-off from every writer.** `closeDatabase` checkpoints and closes;
  the seeders call it (`seed/demo.ts:396`, `scripts/seed-books.ts:135`) and the
  server now does too, through `installSignalHandlers` on SIGINT/SIGTERM
  (`src/shutdown.ts`, wired at `src/index.ts:24`, idempotent under a double
  Ctrl-C, with an unref'd 5 s backstop). This removes the id skew rather than
  repairing it after the fact.

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

CI runs it as its own step *before* the full suite
(`.github/workflows/ci.yml`: "Regression — seed in one process, serve from the
next"), so the cheapest, most specific failure reports first. Around it:
`packages/db/test/durability.test.ts` (12) pins the forward-only repair, the
32-value recovery jump, `appendEvent`'s SQLSTATE surfacing and the upgrade of a
database that predates the guard; `apps/server/test/seed-durability.test.ts`
drives seeder-child → probe-child → POST-roll → GET-log with the vitest process
never touching the directory (PGlite is single-writer: a second opener hangs
rather than erroring); `core-atomicity.test.ts` (9) blocks the event insert and
asserts no orphan roll, no Edge debit, a named error and a post-COMMIT-only
broadcast; `core-shutdown.test.ts` (8) pins that a server closed through
`shutdownServer` reopens with `last_value === max(id)`; and
`apps/web/e2e/log-append.spec.ts` (2) makes a roll from the composer in a real
browser and checks it is still in the log after a reload.

**Still open, honestly.** `Hub.atomic` exists and the roll path uses it, but
there are 44 `hub.emit` sites across 12 files and only that one has been moved
inside a transaction. `POST …/log` is safe by construction (the event *is* the
write — a single INSERT), but a clock advance still updates `campaigns` and
then emits (`plugins/campaigns.ts:126–131`), as do the encounter, scene and
ledger paths. With the sequence guard in place an append failing is now a
remote possibility rather than a certainty, but the half-commit *shape* is
still there everywhere except rolls. See §6.

### What changed structurally

`apps/web/e2e/` now exists: Playwright, chromium, 8 spec files, 26 tests, run
against the **real** stack (built server + built SPA on one origin, throwaway
`DATA_DIR`, PGlite, the demo campaign, no model, no network). It runs in CI
after the unit suite and the smoke playthrough. The runner (`e2e/run.mjs`) skips
with a message when no browser binary is present rather than turning CI red for
a download failure; `e2e:strict` fails instead, for when you mean it.

The cross-process seam has its own layer now, separate from the browser one:
`seeded-boot.test.ts` and `seed-durability.test.ts` on the server,
`durability.test.ts` in `@safehouse/db`. All three spawn real child processes,
because that is the only way to reach the state LIVE-4 was made of.

Two more browser findings from the same session, now closed:

- **Skill rows were click-handler `<div>`s** — no accessible name, no keyboard
  path. Rows are real `<button>`s; every control gets a spoken name from
  `features/sheet/a11y.ts`. `a11y.test.ts` (12), `sheetA11y.test.tsx` (22),
  `e2e/keyboard.spec.ts` makes a whole roll from the keyboard alone and asserts
  every skill row has a name a screen reader can speak.
- **Staged initiative dropped augment dice** and **live encounters sat at turn
  0 / pass 0** — both were already §4 items (#5, #6) and both are closed; the
  browser simply confirmed them in the wild.

The lesson worth keeping, restated after LIVE-4: an API-level harness proves the
server and cannot prove the app; a browser harness proves the app but only
against the states someone thought to build for it. Every suite here now runs on
every push, and the newest one exists to construct a state rather than to
exercise a path.

---

## 3. How to run

Node ≥ 22, pnpm 11.24. No Docker and no internet are required for anything in
this section.

```bash
pnpm install
pnpm build
```

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
real validation and event emission — except the `runs` row, which it still
inserts directly even though `POST /api/campaigns/:id/runs` now exists. It
prints the campaign id, the three player join codes, the display join code, and
the device tokens. Content brief: `docs/demo/CAMPAIGN.md`.

### Dev servers

```bash
pnpm dev:server    # http://localhost:8787  — REST /api, WS /ws, /files, /read, /healthz
pnpm dev:web       # http://localhost:5173  — proxies /api /ws /files /read to 8787
```

`/join` is **not** proxied: it is an SPA route (LIVE-3). When Vite serves the
SPA on a different port from the server, set `WEB_ORIGIN=http://<lan-ip>:5173`
so the QR encodes the SPA's origin.

Database is embedded PGlite at `DATA_DIR/pglite` unless `DATABASE_URL` is set.
Migrations apply programmatically on start, and `ensureSequences()` runs with
them on **every** open — so a data directory whose serial sequences have fallen
behind their rows is repaired by being opened, with no operator step (LIVE-4).

PGlite is single-writer: only one process may hold `DATA_DIR/pglite` at a time,
and a second opener **hangs** rather than erroring. If a seeder or a probe seems
to stall, something else still holds the directory. Ctrl-C is now a clean stop —
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

Ordinary invites are role-scoped to player / observer / display and
`join-qr` refuses `role=gm` outright; a GM device comes only from the
bootstrap, `gm-device`, or a single-use `gm-pair` code.

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
the base URL. Away-game fallback: `docker compose --profile llm up -d`.

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
| `@safehouse/db` | 3 | 24 |
| `@safehouse/rules` | 10 | 150 |
| `@safehouse/server` | 35 | 443 (442 passed, 1 skipped) |
| `@safehouse/web` | 37 | 566 |
| **Total** | **92** | **1234 passed, 1 skipped, 0 failed** |

`pnpm -r --workspace-concurrency=1 typecheck` → exit 0 across all five packages.
`pnpm -r --workspace-concurrency=1 build` → exit 0.

Server tests run against throwaway PGlite instances with migrations applied; no
Docker, no network. The one skipped test is in `books-api.test.ts`. The four
test files and 28 tests added since the last revision are all LIVE-4 work:
`seeded-boot.test.ts` (10), `core-atomicity.test.ts` (9), `core-shutdown.test.ts`
(8) and `seed-durability.test.ts` (1) on the server, plus
`packages/db/test/durability.test.ts` growing from 0 to 12 in a new file.

**Browser E2E** — `pnpm --filter @safehouse/web e2e`, chromium, **26 passed**,
20.8 s, one worker against one shared live table:

| Spec | Tests | Covers |
| --- | --- | --- |
| `gm-signin.spec.ts` | 3 | FR1.1 GM pairing from a fresh profile; the front door's three paths; a nonsense code rejected client-side |
| `hydration.spec.ts` | 4 | LIVE-1 — backfill with the socket cut; refresh mid-session; REST cut too (honestly empty); a player's phone hydrates filtered |
| `join.spec.ts` | 6 | LIVE-3 — the QR renders the join screen; only `/api` answers JSON; the QR encodes the SPA route; the TV lands on the kiosk; a dead code fails on-screen; the dev server does not proxy `/join` |
| `keyboard.spec.ts` | 2 | a roll made from the sheet with the keyboard alone; every skill row has a spoken name |
| `log-append.spec.ts` | 2 | LIVE-4 in the browser — a roll from the composer renders its pool and hits and is still there after a reload; table talk appends and survives a reload |
| `pool-parity.spec.ts` | 2 | LIVE-2 — sheet pool = dialog dice = persisted pool, scene counted once; a situational bump still reaches the server |
| `secrecy.spec.ts` | 4 | Principle 4 in the browser: log, tracker, grid and the raw payloads behind them |
| `tv.spec.ts` | 3 | FR9.20 map stage + ribbon; a rebooted TV returns to the scene; the kiosk holds no GM-only state |

**Scripted playthrough** — `pnpm playthrough`, report at
`docs/demo/SESSION_REPORT.md`:

- **196 checks: 196 passed, 0 failed, 0 not applicable**, 9.5 s.
- Boots the real Fastify app on a loopback port against a fresh PGlite database,
  seeds SR5 (55 pages indexed) and the demo campaign, then plays a whole session
  from five devices — the GM's laptop, three phones and the TV.
- New beats since the last revision: GM pairing and the `/api/join` split; a
  codex page shared with one section withheld (and the bytes proved absent from
  a phone); a contact typed on one player's phone that another player's 403
  cannot see; a run with its payout and a calendar beat; the Fixer reaching
  `search_codex` / `list_contacts` / `list_runs` / `get_calendar` against live
  state; a Perception receipt that adds up to the sheet's pool with the scene in
  it exactly once; proximity nudges that name tokens the players do not know
  exist, GM-only and never written down; a layout copilot proposal compiling to
  19 walls / 4 doors / 4 regions **as a draft**; staged initiative rolling
  augment dice; Seize / Blitz / Close Call; a beat that reads the shared log
  back after each write — the roll on the immutable record, on the GM's log, on
  the player's log and on the live socket as the same event id, table talk from
  a phone, and the clock tick as table-visible history (the LIVE-4 blast radius,
  asserted end to end); and a closing count of **38 of 38 persisted rolls,
  copilot dice included**.
- No `n/a` checks this run — the loadout table happened to produce a
  burst-capable weapon, which is what the two previously-skipped assertions
  needed. They remain content-dependent.
- The only "model" involved is the in-process mock inference box.

**CI** (`.github/workflows/ci.yml`): typecheck · build · **the seeded-boot
regression** (`pnpm --filter @safehouse/server exec vitest run
test/seeded-boot.test.ts`, run on its own *before* the suite so the cheapest and
most specific failure reports first) · test · `.github/scripts/smoke.mjs` (boots
the built server on a throwaway `DATA_DIR`, runs the playthrough against it,
confirms the SPA is served) · **the browser E2E suite** (with Playwright traces
uploaded on failure) · a multi-arch image build. `LLM_BASE_URL` and
`DISCORD_WEBHOOK_URL` are unset in CI on purpose.

---

## 5. The previous gap list, resolved

Every item from the last revision's §4, with what closed it or why it did not.

| # | Gap | State | Evidence |
| --- | --- | --- | --- |
| 1 | The map never reaches the TV (FR9.20) | **closed** | `web/features/tv/TvStageView.tsx` + `features/grid/tvStage.ts` + `features/tv/hydrate.ts`, mounted at `TvPage.tsx:145–152`. `tvStage.test.ts` (10), `e2e/tv.spec.ts` (3). |
| 2 | The GM cannot sign in through the app (FR1.1/1.2) | **closed** | `web/components/shell/Landing.tsx` (three tabs) + `signin.ts` / `signin-api.ts`; server `plugins/auth.ts` `gm-device` / `gm-pair`. `test/auth-gm.test.ts` (18), `signin.test.ts` (12), `e2e/gm-signin.spec.ts` (3). |
| 3 | Copilot chains roll dice that never hit the record (FR10.8/FR2.1) | **closed** | `services/encounters-rolls.ts` `chainRollInputs` + `recordChainRolls`, called from `plugins/encounters.ts:535`. Rows are `gm`-visible and linked by `chainId`; damage still waits for commit. `test/encounters-chain-rolls.test.ts`. |
| 4 | Copilot quick-rolls fall out of the session (FR10.7/FR6.1) | **closed** | `services/encounters-rolls.ts:234` stamps `sessionId` via `activeSessionId`. Playthrough: 38 of 38 rolls counted. |
| 5 | Staged encounters drop augmented initiative (FR9.10/FR4.2) | **closed** | `services/scenes.ts` imports `deriveFor` (`:53`) and uses it in `stageEncounter` (`~:757`). Playthrough shows two-die initiative off a staged encounter. |
| 6 | Encounters start at turn 0 / pass 0 (FR4.3) | **closed** | `services/encounters.ts:369` — `rollInitiativeAll` sets `turn = max(1, turn)`, `pass = 1`. |
| 7 | No Professional Rating on hand-added combatants (FR4.6/FR10.9) | **closed** | `plugins/encounters.ts:87,92,115`; `services/encounters.ts:230,287`. Playthrough asserts `pressure 4 vs PR 3`. |
| 8 | No campaign codex at all (M5) | **closed** | `plugins/codex.ts`, `codex-runs.ts`, `codex-calendar.ts`, `contacts.ts`; `services/codex.ts`, `codex-store.ts`; `web/features/codex/*` on four routes. 41 server tests + 55 web tests. FR5.6 is the one sub-clause still open (below). |
| 9 | Contacts are half-wired (FR3.2/FR5.8) | **closed** | `plugins/contacts.ts` (`GET/POST /api/characters/:id/contacts`, `PATCH/DELETE /api/contacts/:id`); `web/features/sheet/tabs/ContactsTab.tsx` (read view) and `features/codex/ContactsPanel.tsx` (editing). `test/contacts.test.ts` (8), `features/sheet/contacts.test.ts` (6). |
| 10 | Grid geometry has no authoring UI (FR9.2/FR9.3) | **closed** | `web/features/grid/gm/GeometryTab.tsx` and `PinsTab.tsx` over `geometryEdit.ts`; pins render in `stage/layers.ts drawPins`. `geometryEdit.test.ts` (20). |
| 11 | Pointer trails and "focus here" don't cross the wire (FR9.15/FR9.21) | **closed** | `contracts/src/events.ts:145,158` (`pointer`, `scene.focus`), `hub.ts:104–120`, `plugins/scenes.ts:623–641` emits `display.updated`, `web/features/grid/gm/DisplayTab.tsx` drives it. |
| 12 | Edge is missing three of its actions (FR2.3/FR4.4) | **closed** | `rules/src/dice.ts` `seizeInitiative` / `blitzInitiative` / `closeCall`; `services/rolls-edge.ts`; `POST /api/edge/*`; `web/features/sheet/edgeActions.ts` + `CloseCallOffer.tsx`. `test/rolls-edge.test.ts` (12), `edgeActions.test.ts` (9). |
| 13 | The PDF reader is the browser's, not pdf.js (FR11.3) | **still open** | `web/features/gm/books/BookReader.tsx` still frames the built-in viewer at `#page=N`; no pdf.js dependency anywhere. Offsets and byte-range streaming are correct; the phone-first clause is still unproven. Untouched this round. |
| 14 | Fixer P2 items absent (FR12.8, 12.9, 12.11, 12.12) | **mostly closed** | FR12.9 `fixer/token-id.ts`, FR12.11 layout copilot `fixer/geometry.ts`, FR12.8 proximity `fixer/proximity.ts` — all three with routes and playthrough coverage. **Still open:** map *vision* (the model never sees an image) and FR12.12 AI recap drafting (`web/features/gm/sessions/recap.ts` remains a deterministic skeleton; there is no `draft_recap` tool). |
| 15 | Magic bookkeeping half-built (FR8.3/FR8.4) | **still open** | No spirits table, contract or UI; no foci bonding state or reagent counters. `fixer/state-play.ts` reports `spirits: { tracked: false }` rather than a misleading zero, which is honest but is not the tracker. P5 work, untouched. |
| 16a | No bookmarks (FR11.6) | **closed** | `services/bookmarks.ts` + `plugins/books.ts` routes; `test/books-bookmarks.test.ts` (13). |
| 16b | No ownership transfer (FR1.2) | **closed** | `plugins/campaigns-admin.ts` — `POST /api/campaigns/:id/transfer-ownership`, `PATCH /api/characters/:id/owner`. |
| 16c | No advancement editor (FR3.7) | **deferred** | P5, unchanged and not a defect. |
| 16d | No tactical hints (FR10.10) | **still open** | Absent entirely. `roleTags` exist on templates; nothing consumes them. Optional and off by default per the FR. |

And the four browser/terminal findings from §2:

| # | Defect | State | Evidence |
| --- | --- | --- | --- |
| L1 | The web UI never backfilled state on mount | **closed** | `live/hydrate.ts` at the `useLiveConnection` chokepoint; 39 unit tests + `e2e/hydration.spec.ts` (4). |
| L2 | Scene environment modifier applied twice | **closed** | `features/sheet/rollDialogState.ts`; `rollDialogState.test.ts` (18), `e2e/pool-parity.spec.ts` (2). |
| L3 | `/join/:code` served JSON to a scanning player | **closed** | One path, one owner, enforced in four places; `e2e/join.spec.ts` (6). |
| L4 | Event log frozen on a seeded database | **closed** | Sequence guard + `Hub.atomic` + `DbError` surfacing + clean shutdown everywhere. `seeded-boot.test.ts` (10), `durability.test.ts` (12), `core-atomicity.test.ts` (9), `core-shutdown.test.ts` (8), `seed-durability.test.ts` (1), `e2e/log-append.spec.ts` (2). |

Newly surfaced this round (not in the previous §4):

- **44 of 45 event emissions are still non-atomic with their domain row.**
  `Hub.atomic` was built for LIVE-4 and only `services/rolls.ts:535` uses it.
  `POST …/log` needs nothing (the event *is* the write), but a clock advance
  updates `campaigns` and then emits (`plugins/campaigns.ts:126–131`), and the
  encounter, scene and ledger paths do the same. The sequence guard makes the
  append failing unlikely; it does not make the shape safe.
- **FR2.8 personal macros are still device-local.** `macroStore.ts` was
  rewritten server-first and degrades cleanly to a local mirror, but the server
  half — `GET/PUT /api/campaigns/:id/macros` and a `user_macros` table — does
  not exist. The contract is written as an `// INTEGRATION:` block in that file.
  A player on a second phone still has no macros.
- **FR5.6 template↔codex linkage.** NPC and archetype templates live in
  `npc_templates` with no page reference in either direction, so they are not
  "in the codex" the way the FR describes.
- **The demo seed still writes its `runs` row straight to the database** even
  though `POST /api/campaigns/:id/runs` now exists. Cosmetic, but it means one
  row in the demo skips validation and event emission.

Deferred by design and *not* defects: the whole Matrix toolkit (M7, Q3 — no
decker at the table), token vision and dynamic lighting (FR9.16, Q9 — manual fog
is the permanent plan), the Matrix overlay (FR9.17), native priority char-gen
(FR3.9, D5 — Chummer is the builder), the advancement editor (FR3.7),
stagecraft audio (FR12.10 / FR9.18), the image-gen adapter, the PWA offline
cache, and campaign export.

---

## 6. What is still worth doing

Ranked by what it costs at the table.

1. **Personal macros that follow the person (FR2.8).** The client is already
   written and waiting; this is one table (`user_macros`) and two routes. It is
   top of the list because the cost is small, the client half is dead weight
   until it lands, and a player on a borrowed phone currently has an empty rack
   mid-fight.
2. **Move the remaining domain writes inside `Hub.atomic`.** LIVE-4 proved the
   half-commit shape is not theoretical: a roll landed in `rolls` with no event
   and no socket frame, and nothing anywhere noticed. The roll path is fixed;
   the clock advance, the ledger, the encounter and the scene paths still write
   their row and then emit. The transaction helper, its deadlock rule and its
   test harness (`core-atomicity.test.ts` blocks an event type by name) all
   exist, so each conversion is small — the work is auditing 44 call sites and
   hoisting reads out of the blocks, not inventing anything. Highest-value
   first: ledger (money), then encounter damage (monitors), then the clock.
3. **AI recap drafting (FR12.12).** P4's exit clause says recaps write
   themselves for editing. Today the skeleton is deterministic and the AI path
   is the generic `draft_wiki_page`. A `draft_recap` tool reading the session log
   through the existing draft + spoiler-guard pipeline is a contained change to
   `fixer/tools.ts` and `web/features/gm/sessions/`. The recap is the players'
   only between-session window — §18 flags it as carrying more weight than its
   size.
4. **Spirit tracker (FR8.3).** The party has a summoner. Force, services
   remaining, one-tap "spend a service", and a spirit that joins the encounter
   as a combatant. Currently ridden in a note, and `get_magic_state` has to
   admit it is not tracked. This is the largest genuine hole in a module the
   table uses every session.
5. **pdf.js viewer (FR11.3).** Everything under it is right — the offset
   arithmetic, the byte-range streaming, the auth. The last hop is a viewer that
   honours a page number on a phone. Until it lands, "one tap opens the printed
   page" is a desktop-only promise, and the whole M11 ref-chip experience is
   built on it.
6. **Foci and reagents (FR8.4).** Bonded foci as real toggled modifier sources
   (the pipeline already accepts them) and a reagent counter. Smaller than the
   spirit tracker and it removes the last magic side-spreadsheet.
7. **Restore-and-boot in CI, not just seed-and-boot.** `seeded-boot.test.ts`
   manufactures the sequence-behind-rows state with `setval`, which is a fair
   proxy but not the real path. The two ways a real deployment reaches it are a
   file-copy restore of `DATA_DIR` and a PGlite → `DATABASE_URL` Postgres move
   with ids preserved — and the second of those has no script behind it at all,
   which is its own gap. The guard would catch both; nothing proves it, and the
   provenance of the directory that started LIVE-4 is still unproven because of
   that.
8. **Map vision for the Fixer (the open half of FR12.11).** The layout copilot
   proposes geometry from a description; it cannot read an uploaded map. A
   vision path would turn a photographed battle map into walls and zones, which
   is the case the GM actually has.
9. **FR5.6 — templates in the codex.** Give `npc_templates` a `wiki_page_id`
   and let a page reference its template. Cheap, and it makes FR9.3 pins,
   FR10.1 templates and FR5.1 pages one graph instead of three.
10. **Tactical hints on the acting NPC's turn (FR10.10).** Off by default per
    the FR. `roleTags` are already on every template; this is a lookup table and
    a line in the tracker row.
11. **Make the usage meter survive a restart (FR12.15).** `ai_generations.usage`
    covers drafts only, so `fixer/usage.ts` accumulates chat-turn tokens
    per-process and loses them when the server restarts (its own `INTEGRATION`
    note names the fix: an `ai_usage` table).
12. **Seed the demo `runs` row through its route.** One-line hygiene fix in
    `apps/server/seed/demo.ts:325`; makes the seed's claim of "every row goes
    through real validation" true without an asterisk.

Below the line, and deliberately: the advancement editor (FR3.7), stagecraft
audio (FR12.10), and everything in P6. They stay unbuilt until the table asks.

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
