# Safehouse — build report

What exists in this repo, measured against `DESIGN.md` rev 0.9 §6 (feature
modules) and §18 (roadmap). Written from the code as built, the test run below,
and `docs/demo/SESSION_REPORT.md`.

- **Repo state:** 288 TS/TSX source files, ~50.5k lines across 5 workspace packages.
- **Verified on:** 2026-08-28. `pnpm -r typecheck` → exit 0. `pnpm -r test` → 680 passed, 1 skipped, 0 failed.
- **Scripted playthrough:** 94/94 checks passed (`docs/demo/SESSION_REPORT.md`).

Status vocabulary:

| Term | Meaning |
| --- | --- |
| `done` | Implemented end to end, server-authoritative where the FR requires it, covered by a test or a playthrough assertion. |
| `partial` | Core of the FR works; a named sub-clause is missing. Every one is itemized. |
| `deferred` | Not built, and §18 puts it in a phase we have not reached (P5/P6) or Q9/Q3 resolved it as unused. Not a defect. |
| `not built` | In a phase we have otherwise shipped, but absent. These are the real gaps. |

---

## 1. Status by module

### M1 — Accounts, campaign, membership *(P0)*

| FR | Status | Where |
| --- | --- | --- |
| FR1.1 QR join, GM at install | partial | `apps/server/src/services/auth.ts` — `POST /api/campaigns` (bootstrap, no auth when zero campaigns), `GET /api/campaigns/:id/join-qr` (qrcode data URL), `GET /join/:code` mints device + long-lived token. **Missing: any GM-side UI.** `apps/web/src/components/shell/Landing.tsx` only renders "scan the QR"; there is no create-campaign form and no GM pairing screen, and `join-qr` excludes the `gm` role by construction. A GM gets a browser session only by hand-writing `localStorage['safehouse.session']`. |
| FR1.2 one GM + players + observers; transfer ownership | partial | Roles and membership done (`memberships`, `Role`). Ownership transfer: not built — no route, no service method. |
| FR1.3 expiring, role-scoped, revocable invites | done | `createInvite` (`expiresInMinutes`, `maxUses`), `POST /api/devices/:id/revoke`. |
| FR1.4 roles gate everything per §13 | done | `requireAuth`/`requireRole`/`assertCampaign` guards; hub filters by visibility server-side. Playthrough checks 7–9, 16, 33–34. |
| FR1.5 campaign settings incl. house-rule flags + webhook | done | `PATCH /api/campaigns/:id`. Flag system ships empty per Q4 (table plays RAW). |

### M2 — Dice engine and roll log *(P1)*

| FR | Status | Where |
| --- | --- | --- |
| FR2.1 pool → hits/ones/glitch, server-rolled, persisted, broadcast | done | `apps/server/src/services/dice.ts` (`crypto.randomInt`), `packages/rules/src/dice.ts`, `roll.created`. |
| FR2.2 limits, hits above limit shown but excluded | done | `limitedHits` + `limit` ref on every `RollResult`. |
| FR2.3 Edge actions | partial | Push the Limit pre/post with Rule of Six, Second Chance, spend/burn with log entry and revision snapshot on burn: done (`rules/src/dice.ts`, `services/character-play.ts`). **Seize the Initiative, Blitz and Close Call are not implemented anywhere** — not in the engine, not in the tracker. |
| FR2.4 buying hits (4:1) | done | `POST /api/rolls/buy-hits`, `buyHits`. |
| FR2.5 simple / opposed / threshold / extended / teamwork | done | `services/rolls.ts`; extended loop with shrinking pool in `rules/src/dice.ts`. |
| FR2.6 provenance stored on the log entry | done | Breakdown persisted with the roll; playthrough 11–12, 49, 62. |
| FR2.7 public / gm / gm_owner, filtered server-side | done | Hub visibility filter; playthrough 7–9, 69–70. |
| FR2.8 free-form rolls + personal macros | done | Free-form via `POST /api/rolls`. Macros are client-side and per-device (`apps/web/src/features/table/macros.ts`, localStorage) — they do not follow a player to a second phone. |
| FR2.9 append-only interleaved session log | done | `POST/GET /api/campaigns/:id/log` over `ws_events`. |
| FR2.10 Discord mirroring of public rolls | done | `services/discord.ts`; `test/discord-recap.test.ts`. |
| FR2.11 campaign rollable tables | done | `/api/campaigns/:id/roll-tables`, `POST /api/roll-tables/:id/roll`; GM-only tables stay GM-only (playthrough 85–86). |

### M3 — Characters *(P1 core)*

| FR | Status | Where |
| --- | --- | --- |
| FR3.1 Chummer `.chum5` import, raw file kept, unmapped listed, re-import diff | done | `services/chummer.ts` + `chummer-xml.ts`, `diffSheets`, `POST /api/characters/:id/import` (diff first, `confirm=true` applies). Fixture `test/fixtures/chummer-sample.chum5`. |
| FR3.2 phone-first sheet with tabs | partial | Shipped: Skills, Combat, Magic, Gear, Ledger, Background + pinned identity/vitals strip. **Missing: Matrix tab** (M7 deferred — consistent) **and Contacts tab.** `apps/web/src/features/sheet/api.ts:284` assumes `GET /api/characters/:id/contacts`; that route does not exist, so the contacts call would 404. |
| FR3.3 derived values with provenance | done | `deriveCharacter`, `GET /api/characters/:id/derived`. 31 derive tests. |
| FR3.4 monitors, wound modifiers, Edge, ammo, progressive recoil, sustained, statuses | done | `services/character-play.ts`, `POST …/damage|edge|ammo|recoil|sustained`. |
| FR3.5 manual override on any derived value, flagged, with a note | done | `POST/DELETE /api/characters/:id/overrides`. |
| FR3.6 karma & nuyen ledgers, pending-until-approved | done | `plugins/ledger.ts`; approve/reject; playthrough 76–84. Landed ahead of its P4 slot. |
| FR3.7 advancement (guided karma spends) | deferred | P5. Not built. |
| FR3.8 revisions + rollback | done | `GET …/revisions`, `POST …/rollback`. |
| FR3.9 native priority char-gen | deferred | P6 by design (D5 — Chummer is the builder until then). |

### M4 — Combat tracker *(P1)*

| FR | Status | Where |
| --- | --- | --- |
| FR4.1 encounters from PCs / templates / generator / grunt groups; prep + launch, incl. from a scene | done | `plugins/encounters.ts`, `POST /api/scenes/:id/stage-encounter`. |
| FR4.2 SR5 initiative incl. astral / cold-sim / hot-sim variants, wound mods | done | `rules/src/combat/initiative.ts`; playthrough 38–41. |
| FR4.3 native pass structure (−10 loop, re-roll on new turn) | partial | The loop is correct (playthrough 43–46). **Bug: an encounter staged from a scene, or created via `POST /api/campaigns/:id/encounters`, starts at turn 0 / pass 0** — only `newTurn` initialises those columns, so the UI reads a pass behind for the whole first turn. |
| FR4.4 interrupt menu with editable costs | done | `DEFAULT_INTERRUPTS` + custom cost; playthrough 66. Edge Seize/Blitz from the tracker: not built (see FR2.3). |
| FR4.5 damage → monitor → overflow → wound recompute, one-tap undo | done | `services/encounters-damage.ts`, `POST …/damage`, `/damage/from-roll`, `/damage/undo`. |
| FR4.6 grunt groups, shared PR + Group Edge | partial | Contract, generator output and morale all carry PR and Group Edge. **`POST /api/encounters/:id/combatants` has no `professionalRating` field**, so hand-added NPCs measure morale against PR 0. |
| FR4.7 status effects with durations | done | `EffectDurationSchema` (`end_of_turn` / `while_sustained` / `passes` / `manual`). |
| FR4.8 everything hand-editable; "dumb mode" | done | `PATCH /api/combatants/:id`, `source: 'manual'`; playthrough 68. |
| FR4.9 filtered player encounter view | done | Server-side; playthrough 33–34 (hidden rows absent, not redacted). |
| FR4.10 tracker ↔ grid ↔ copilot | done | Acting-token glow, token bars from monitors, copilot rack on generator-backed rows. |

### M9 — The Grid *(P2 core)*

| FR | Status | Where |
| --- | --- | --- |
| FR9.1 scenes, configurable grid (1 m default), notes, activate, private staging | done | `plugins/scenes.ts`, `packages/contracts/src/scene.ts`. |
| FR9.2 map building | partial | Image upload, multi-image background list, grid alignment (cols/rows/offset/opacity): done. Walls / doors / zones are in the contract, persisted, rendered and hit-tested (`grid/stage/`, `grid/stage/hit.ts`) — **but there is no GM authoring UI to draw them.** Scan-friendly controls (rotate / crop / contrast) not built. Prop/tile stamp library: P3+ by design. |
| FR9.3 map pins → codex / handouts | partial | `PinSchema` exists in scene geometry and persists. No pin editor, no pin renderer, and no codex to link to (M5 not built). |
| FR9.4 tokens (PC/NPC/grunt/spirit/drone/prop), art, sizes, facing | done | `contracts/src/token.ts`, `POST /api/scenes/:id/tokens`. |
| FR9.5 drag with snap, server-authoritative, smooth interim motion | done | `token.drag` ephemeral + `token.move` authoritative. |
| FR9.6 bars, status markers, aura rings | done | `grid/projection.ts` gates numeric bars per viewer. |
| FR9.7 hidden tokens — positions never sent | done | Playthrough 16, 19–20. Principle 4 held. |
| FR9.8 ruler in metres, walk/run colouring | done | `grid/geometry.ts` + tests. |
| FR9.9 range bands → range modifier into the roll | done | Playthrough 49 (`medium range (9.5 m, heavy_pistol) −1` in the receipt). |
| FR9.10 encounter ↔ scene both ways | done | Playthrough 32. See the FR4.3 turn/pass bug and the stage-encounter derivation bug below. |
| FR9.11 scene environment as a modifier source with provenance | done | `rules/src/env.ts`, `activeSceneModifiers`; playthrough 11–12, 49, 62. |
| FR9.12 AoE circles + grenade scatter helper | done | `POST /api/scenes/:id/scatter`; client `rollScatter`. |
| FR9.13 manual fog, server-authoritative, persisted | done | `POST /api/scenes/:id/fog`; playthrough 13, 17–18. |
| FR9.14 named staged reveals with announcement | done | Same. |
| FR9.15 pings, pointer trails, drawings, GM "focus here" | partial | Pings (`ping` command) and freehand drawings (`/api/scenes/:id/drawings`) done. **Pointer trails and "focus here" are client-only:** `pointer` is a reserved ephemeral type and both are tool modes in `grid/types.ts`, but `WsCommandSchema` has no `pointer` or `scene.focus` command, so nothing crosses the wire. |
| FR9.16 wall-based vision + dynamic lighting | deferred | P6, and Q9 resolved the table does not use it. Manual fog is the permanent first-class path. |
| FR9.17 Matrix overlay | deferred | P6 stretch. |
| FR9.18 ambient audio | superseded | Folded into FR12.10. `audio_tracks` table and `Scene.audioRef` exist; nothing reads them. |
| FR9.19 TV joins as a `display` device, same server-side filtering | done | Playthrough 4, 9, 10. |
| FR9.20 what the TV shows | partial | **P1 scope only.** Shipped: initiative ribbon with acting highlight, big dice moments, handout takeovers, idle card, scene *name*. **The full-scene display is not built** — `apps/web/src/features/tv/TvPage.tsx` renders no Pixi stage, so the map, tokens and fog never reach the TV. This is the largest single gap against the success criterion. |
| FR9.21 GM steering (focus camera, layer toggles, blank the table) | partial | The TV *consumes* `display.updated` (`{blank, ribbon}`) and honours it — but nothing emits that event and it is not in the §11 catalog, so there is no GM console to drive it. Focus-here has no server command (see FR9.15). |

### M10 — The Opposition Kit *(P3)*

| FR | Status | Where |
| --- | --- | --- |
| FR10.1 archetype templates: role tags, tier dial, per-tier ranges, loadout slots | done | `/api/campaigns/:campaignId/npc-templates`, `contracts/src/generator.ts`. |
| FR10.2 seeded generation, original flavour tables, engine-derived values | done | `rules/src/generator/`; `tables.ts` is original writing (G6). Playthrough 30–31 (same seed → same ganger; three seeds → three people). |
| FR10.3 promote to reusable template, edits round-trip | done | `POST /api/generator/promote`. |
| FR10.4 encounter builder | done | `POST /api/encounters/build`. |
| FR10.5 party-aware threat readout with visible math | done | `GET /api/encounters/:id/threat`, `services/generator-threat.ts`. |
| FR10.6 balance levers recompute live | done | `POST /api/encounters/:id/threat/recompute`; `web/features/gm/generator/ThreatReadout.tsx`. |
| FR10.7 quick-roll rack | done | `GET /api/combatants/:id/quick-rolls`, `POST …/quick-roll`. |
| FR10.8 resolved chains, card-per-step, override before commit | partial | The chain is correct end to end (playthrough 47–54, 58–60) and nothing is written until commit. **The three pools it rolls (attack, defence, soak) are never persisted to `rolls`** — the whole exchange added 0 rows to the immutable record, against G5/FR2.1. |
| FR10.9 morale from Professional Rating triggers | done | Playthrough 71–74; GM-only, never acts. Gated by the FR4.6 PR gap for hand-added rows. |
| FR10.10 tactical hints on the acting NPC's turn | not built | Optional and off by default per the FR, but absent entirely. |

### M11 — Rules library *(P1)*

| FR | Status | Where |
| --- | --- | --- |
| FR11.1 registry: code, title, page offset, calibration helper | done | `plugins/books.ts`, `PATCH /api/books/:id`; `web/features/gm/BooksPage.tsx` calibration stepper. SR5 seeded at the measured +5 (playthrough 27). |
| FR11.2 structured `{book, page, note?}` refs | done | `contracts/src/common.ts`; used across sheet, templates, tables. |
| FR11.3 one-tap open at the printed page, in-app, on phones | partial | Server side is complete: `GET /read/:code?p=N` resolves the offset, `GET /files/books/:code` streams the PDF with byte ranges behind auth. **The viewer is not self-hosted pdf.js** — `web/features/gm/books/BookReader.tsx` frames the browser's built-in PDF viewer at `#page=N`. That works on desktop; mobile browsers that ignore `#page=` will open the book at page 1, so the "works on phones" clause is unproven. |
| FR11.4 ref autolinking of `SR5 p.426` patterns | done | `web/features/gm/books/refs.ts` + tests. |
| FR11.5 shared with the table, per-book GM-only toggle | done | Playthrough 28–29 (a player's search returns real page provenance). |
| FR11.6 named bookmarks + recently-opened trail | not built | No table, no route, no UI. |
| FR11.7 `pnpm seed:books` folder import with guessed codes | done | `apps/server/scripts/seed-books.ts` (`--dir`, `--only`, `--max-pages`, `--list`). PDFs stay out of git. |

### M12 — The Fixer *(assistant core P1)*

| FR | Status | Where |
| --- | --- | --- |
| FR12.1 GM-only dockable streaming panel, history, two model slots | done | `plugins/fixer.ts`, `fixer/conversations.ts`, `web/features/gm/fixer/`. |
| FR12.2 grounded rules research, citations from retrieval not the model | done | `search_books` returns `{book, printedPage}`; the chip is the server's, not the model's. |
| FR12.3 lore and state research | partial | The live-state side is done (FR12.17). **`search_codex` does not exist** — there is no codex to search (M5). |
| FR12.4 planning / brainstorming with "save to codex" | partial | Chat done; the save lands as a `wiki_page` draft that no UI can then read. |
| FR12.5 NPC fiction layer onto procedural stats | done | `generate_npc` + persona; `npc` draft kind; D13 split held (engine rolls numbers, AI writes fiction). |
| FR12.6 in-character conversations with knowledge boundary + secrets | done | `POST /api/npcs/:id/converse`, `fixer/agent.ts:363–420`. |
| FR12.7 codex drafting | partial | `draft_wiki_page` writes `wiki_pages` on accept (playthrough 87–90). No codex API or UI to browse, edit or link the result. |
| FR12.8 fog NL commands, proximity prompts, region auto-naming | partial | `suggest_fog_reveal` tool + `fog_reveal` draft kind: done. Proximity prompts and auto-naming: not built. |
| FR12.9 token identification / labelling | not built | P2 item, absent. |
| FR12.10 stagecraft (music tagging + scene matching) | deferred | P5. `audio_tracks` table only. |
| FR12.11 map assistance (layout copilot, map vision) | not built | P2 item, absent. No guided-JSON geometry generation, no vision path. |
| FR12.12 recap drafts | partial | The recap skeleton is deterministic and client-side (`web/features/gm/sessions/recap.ts`, "draft from log"). There is no AI recap tool; the playthrough produced one only through the generic `draft_wiki_page`. |
| FR12.13 OpenAI-compatible local provider; unset base URL hides everything | done | `fixer/llm.ts`, `GET /api/fixer/status`. Streaming SSE, tool calls. Nothing touches the internet. |
| FR12.14 retrieval over extracted book text, Postgres FTS | done | `book_pages.tsv` generated tsvector, `searchBookPages`. |
| FR12.15 every generation an `ai_generation` draft; usage meter | done | `fixer/drafts.ts`, `GET /api/campaigns/:id/fixer/usage`. Note: chat turns that produce no draft are not metered (`fixer/usage.ts:6`). |
| FR12.16 fast/primary slot discipline | done | Slot selectable per call; `fast` defaults to `primary` when unconfigured. |
| FR12.17 read-only state tool catalog | partial | 11 read tools of the FR's 13 rows: `get_campaign`, `list_characters`, `get_character`, `get_ledger`, `get_encounter`, `get_scene`, `get_session_log`, `search_books`, `list_npcs`, `get_npc`, `get_threat_readout`; plus 3 drafting tools (`generate_npc`, `draft_wiki_page`, `suggest_fog_reveal`). **Missing: `search_codex`, `get_page`, `list_contacts`, `list_runs`, `get_calendar`, `get_magic_state`, `get_matrix_state`** — all but `get_page` belong to P4–P6 modules that are not built. |
| FR12.18 situation snapshot prefix during live sessions | done | `fixer/agent.ts:91`; playthrough 26. |
| FR12.19 spoiler guard on player-facing prose | done | `fixer/drafts.ts:274`; playthrough 89 caught a GM-only name in the recap. |

### M5 — Campaign codex *(P4)*

**Schema only.** `wiki_pages`, `wiki_revisions`, `runs`, `contacts` tables exist;
`wiki.revealed` / `handout.revealed` / `clock.advanced` are in the event catalog;
`draft_wiki_page` can create a page. There is **no REST surface and no UI** for
any of it — no `/api/wiki`, `/api/runs`, `/api/contacts`, `/api/calendar`, and no
route in `apps/web/src/router.tsx`. FR5.1, 5.2, 5.3, 5.5, 5.6, 5.8: not built.
FR5.4 handouts: attachment upload/serve and the TV takeover work, but there is no
staging or reveal UI. FR5.7 calendar: only the campaign's `ingameDate` and the
`clock.advanced` event. The demo seed writes its `runs` row directly to the db
because no route exists.

### M6 — Sessions *(P4)*

| FR | Status | Where |
| --- | --- | --- |
| FR6.1 session entity: date, attendance, linked runs, log, prep notes, recap | done | `plugins/sessions.ts`. |
| FR6.2 start/end live mode | done | `POST /api/campaigns/:id/sessions/start`, `POST /api/sessions/:id/end`, `GET …/live`; playthrough 6, 93. |
| FR6.3 recap publishing to Discord on explicit GM action | done | `POST /api/sessions/:id/publish-recap`; playthrough 91–92 (no webhook → nothing leaves the laptop). |

Shipped ahead of its P4 slot, along with the FR3.6 approval flow.

### M7 — Matrix toolkit *(P6, on demand)*

**Deferred by design** (Q3: no decker at the table). What exists: the
`matrix_hosts` table, the `os.changed` event, and the Matrix AR / cold-sim /
hot-sim initiative variants in the engine. FR7.1–7.6: not built.

### M8 — Magic toolkit *(P5)*

| FR | Status | Where |
| --- | --- | --- |
| FR8.1 casting flow with linked Drain resistance, applied on confirm | done | `web/features/sheet/tabs/DrainApply.tsx` + the rolls service; playthrough 61–65. |
| FR8.2 sustained spells, −2 each, focus/quickening exempt | done | `services/characters.ts:248`, `POST /api/characters/:id/sustained`. |
| FR8.3 spirit tracker (Force, services, spend a service, joins encounters) | not built | No table, no contract, no UI. The demo seed rides a bound spirit in a note (`seed/assets/runners.ts:135`). |
| FR8.4 foci bonding/toggles and reagent counters | not built | Only the FR8.2 "sustained by a focus" exemption flag exists. |
| FR8.5 adept powers as passive/toggled modifier sources | done | Modifier pipeline; playthrough 40 (Quickened Reflexes contributes an initiative die). |

Enough of M8 landed early to run a magic-heavy scene; the bookkeeping half (8.3, 8.4) is untouched.

### Phase reading against §18

| Phase | State |
| --- | --- |
| P0 Skeleton | Done, except there is no GM-side UI for the campaign it creates (FR1.1). |
| P1 Run the table | Done. Dice, sheets, tracker, library, Fixer core, TV tracker/roll feed all present and exercised by the playthrough. |
| P2 The Grid | Core done on phones and laptop. **Not done: the map on the TV (FR9.20), the geometry authoring UI (FR9.2), pointer/focus (FR9.15), the Fixer's P2 items (FR12.9, FR12.11).** The exit criterion — "the Roll20 tab closes mid-session" — is not met while the big screen cannot show the map. |
| P3 Opposition Kit | Done bar FR10.10 hints and the two FR10.8/10.9 defects. |
| P4 Campaign memory | Half. M6 sessions + FR3.6 approvals shipped; M5 codex did not. |
| P5 Deep SR5 | Partial by accident of ordering: FR8.1/8.2/8.5 shipped with the sheet; FR3.7, FR8.3, FR8.4, FR12.10 did not. |
| P6 Stretch | Deferred as designed: M7, FR9.16, FR9.17, FR3.9, image adapter, PWA, export. |

### Roll20 exit checklist (§18)

| Roll20 feature | State |
| --- | --- |
| Maps, grid, tokens | shipped |
| Fog of war | shipped (manual + staged) |
| Measurement / ruler | shipped, SR5-native |
| Dice + macros | shipped; macros per-device only |
| Initiative tracker | shipped |
| Character sheets | shipped via Chummer import |
| Handouts | partial — upload + reveal event + TV takeover; no staging UI |
| Journal / notes | **not shipped** (M5) |
| Rollable tables | shipped |
| Shared map on the table TV | **not shipped** — TV is still P1 (tracker + roll feed) |
| Jukebox, dynamic lighting | not used, by decision (Q9) |
| PDFs deep-linked in-app | shipped (browser PDF viewer, not pdf.js) |

Two red rows. Both are listed in §4 below.

---

## 2. How to run

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

Idempotent: it deletes any campaign named "Static on the Line" and rebuilds it,
touching nothing else. It drives the app's own HTTP surface via `app.inject`, so
every row goes through real validation and event emission. It prints the
campaign id, the three player join codes, the display join code, and the device
tokens — including the GM's, which you need (see below). Content brief:
`docs/demo/CAMPAIGN.md`.

### Dev servers

```bash
pnpm dev:server    # http://localhost:8787  — REST /api, WS /ws, /files, /read, /join, /healthz
pnpm dev:web       # http://localhost:5173  — proxies /api /ws /files /read /join to 8787
```

Database is embedded PGlite at `DATA_DIR/pglite` unless `DATABASE_URL` is set.
Migrations apply programmatically on start.

### Join flow

| Who | How |
| --- | --- |
| Player | `http://<laptop>:5173/join/<player-code>` — or scan the QR from `GET /api/campaigns/:id/join-qr?role=player`. One hop mints a device + long-lived token into `localStorage`, then routes to `/c/:campaignId`. |
| Observer | Same, with an `observer`-role invite. |
| The TV | `http://<laptop>:5173/join/<display-code>`, then it lands on `/tv/:campaignId` by itself. Zero controls; the socket is filtered exactly like a player's. |
| GM | **No UI path exists yet.** `POST /api/campaigns` returns a GM token on a fresh install, and `seed:demo` prints one, but the web app has no create-campaign or paste-token screen. Until FR1.1's GM half lands, set it by hand in the browser console: `localStorage.setItem('safehouse.session', JSON.stringify({ token: '<gm token>', role: 'gm', campaignId: '<campaign id>' }))`, then reload. |

Invites are role-scoped and `join-qr` refuses `role=gm`, so a GM cannot re-pair a
second laptop through the normal flow either.

### The TV

`/tv/:campaignId`. Today it shows the campaign name, the active scene's *name*,
the in-game date, the initiative ribbon with the acting-combatant highlight,
flagged dice moments, handout takeovers, and an idle card. It does **not** show
the map (FR9.20, §4).

### Pointing the Fixer at a model

`LLM_BASE_URL` unset or blank is a supported, tested state: `GET
/api/fixer/status` returns `enabled: false`, every AI route answers "switched
off", and the web app hides its AI entry points. Nothing else changes (NG7).

```bash
# the normal posture — a dedicated inference box on the table's LAN
LLM_BASE_URL=http://inference-box.lan:8080/v1 \
LLM_MODEL_PRIMARY=<big-instruct-model> \
LLM_MODEL_FAST=<small-model> \
pnpm dev:server
```

The client speaks plain OpenAI chat-completions with streaming SSE and tool
calls. `chatCompletionsUrl()` tolerates a base URL with or without a trailing
`/v1`. `LLM_MODEL_PRIMARY` defaults to `local-primary` and `LLM_MODEL_FAST`
falls back to primary, so a single-model box works with just the base URL.
Away-game fallback: `docker compose --profile llm up -d` (llama.cpp over a
gitignored `models/` folder) and point at `http://llm:8080/v1`.

**Mock instead of a real box.** `apps/server/src/fixer/mock-llm.ts` is a real
HTTP server speaking the same chat-completions API with real SSE framing —
scriptable as a queue of canned turns or as a responder function that sees the
request. It is what the server tests and the playthrough use; nothing imports it
at runtime. Use it to exercise the agent loop, tool dispatch and the draft
pipeline with no model present.

### Production

```bash
cp .env.example .env        # set SESSION_SECRET and POSTGRES_PASSWORD
docker compose -f infra/docker-compose.yml --env-file .env up -d
```

`app` (server + built SPA on 8787) · `postgres:16` · `backup` (nightly dump +
file-store sync). Plain HTTP on the LAN, no reverse proxy.

---

## 3. Verification summary

`pnpm -r --workspace-concurrency=1 test`, 2026-08-28:

| Package | Test files | Tests |
| --- | --- | --- |
| `@safehouse/contracts` | 7 | 50 |
| `@safehouse/db` | 2 | 9 |
| `@safehouse/rules` | 10 | 138 |
| `@safehouse/server` | 22 | 267 (+1 skipped) |
| `@safehouse/web` | 16 | 216 |
| **Total** | **57** | **680 passed, 1 skipped, 0 failed** |

`pnpm -r --workspace-concurrency=1 typecheck` → exit 0 across all five packages.

Server tests run against throwaway PGlite instances with migrations applied; no
Docker, no network. The one skipped test is in `books-api.test.ts`.

**Scripted playthrough** — `pnpm playthrough`, report at
`docs/demo/SESSION_REPORT.md`:

- **94 checks passed, 0 failed**, 8.3 s, recorded 2026-08-28 20:13 UTC.
- Boots the real Fastify app on a loopback port against a fresh PGlite database,
  seeds SR5 (55 pages indexed) and the demo campaign, then plays a whole session
  from five devices — the GM's laptop, three phones and the TV — asserting each
  beat: QR joins and role scoping, GM-only lines never reaching a phone, hidden
  token coordinates never crossing the wire, the dim-light scene modifier in a
  Perception receipt, a Fixer turn that reaches for `get_scene` and answers from
  live state, seeded NPC reproducibility, initiative passes with the −10 loop,
  a full attack → defence → DV → soak → boxes chain with the Accuracy limit and
  the range band in the receipt, Push the Limit with Rule of Six, a cast with its
  linked Drain, an interrupt's immediate initiative cost, morale at half
  strength, the ledger approval pass, the spoiler guard on a recap draft, and the
  recap publish path with no webhook configured.
- The only "model" involved is the in-process mock inference box.
- The report's own "Gaps this run found" section lists five defects it surfaced;
  all five are carried into §4 below.

**CI** (`.github/workflows/ci.yml`): typecheck · build · test, plus
`.github/scripts/smoke.mjs` (boots the built server on a throwaway `DATA_DIR`,
waits for `/healthz`, runs the playthrough against it, confirms the SPA is
served) and a multi-arch image build. `LLM_BASE_URL` and `DISCORD_WEBHOOK_URL`
are unset in CI on purpose.

---

## 4. Known gaps and next steps

Ordered by what they cost at the table.

1. **The map never reaches the TV (FR9.20).** `TvPage` renders no scene stage.
   This is the Roll20 exit criterion for P2 — combat cannot run "on our map, on
   the big screen" until a `display`-filtered Pixi view lands on `/tv`. Largest
   single gap in the build.
2. **The GM cannot sign in through the app (FR1.1/1.2).** No create-campaign
   screen, no token-paste screen, and `join-qr` excludes the `gm` role, so a
   fresh install has no GM path and a lost GM laptop cannot be re-paired.
   Currently worked around with a hand-written `localStorage` entry.
3. **Copilot chains roll dice that never hit the record (FR10.8/FR2.1).**
   `POST /api/encounters/:id/resolve-chain` rolls attack, defence and soak
   server-side and persists none of them; a whole firefight adds 0 rows to
   `rolls`. Write them (visibility `gm`) as the cards are produced or on commit.
4. **Copilot quick-rolls fall out of the session (FR10.7/FR6.1).**
   `EncountersService.recordRoll` inserts into `rolls` without stamping
   `session_id`, so those rolls miss the housekeeping summary and
   `GET …/rolls?session=`. The playthrough counted 4 of 7 persisted rolls.
5. **Staged encounters drop augmented initiative (FR9.10/FR4.2).**
   `services/scenes.ts stageEncounter` builds initiative from the raw sheet
   (`REA + INT`, 1d6) instead of calling `deriveFor(sheet, kind)` the way
   `addCombatant` does — wired reflexes and adept powers vanish.
6. **Encounters start at turn 0 / pass 0 (FR4.3).** Only `newTurn` initialises
   those columns, so the tracker reads a pass behind for the whole first turn.
   `rollInitiativeAll` should set `turn = max(1, turn)`, `pass = 1`.
7. **No Professional Rating on hand-added combatants (FR4.6/FR10.9).**
   `AddCombatantBody` needs a `professionalRating` field; without it morale
   measures pressure against PR 0 for anything not built by the generator.
8. **No campaign codex at all (M5).** Tables and events exist; API and UI do
   not. This blocks FR5.1–5.8, the Fixer's `search_codex` / `list_contacts` /
   `list_runs` / `get_calendar` tools (FR12.17), the "save to codex" landing
   surface (FR12.4/12.7), map pins having anything to point at (FR9.3), and the
   Roll20 journal row of the exit checklist. Largest missing module.
9. **Contacts are half-wired (FR3.2/FR5.8).** The `contacts` table exists and
   `web/features/sheet/api.ts:284` calls `GET /api/characters/:id/contacts`,
   which is not implemented — that request 404s today.
10. **Grid geometry has no authoring UI (FR9.2).** Walls, doors and zones
    render and hit-test but can only be created by seeding or a raw `PATCH`.
    Pins (FR9.3) have neither editor nor renderer.
11. **Pointer trails and "focus here" don't cross the wire (FR9.15/FR9.21).**
    Client tool modes exist; `WsCommandSchema` has no `pointer` or `scene.focus`
    command, and nothing emits `display.updated`, so the TV's blank/ribbon
    controls have no console to drive them.
12. **Edge is missing three of its actions (FR2.3/FR4.4).** Seize the
    Initiative, Blitz and Close Call are absent from the engine and the tracker.
13. **The PDF reader is the browser's, not pdf.js (FR11.3).** Offsets and
    byte-range streaming are right, but `#page=` is unreliable on mobile
    browsers — the phone-first clause of the FR is unproven.
14. **Fixer P2 items absent (FR12.9, FR12.11).** No token labelling, no layout
    copilot, no map vision. FR12.8 has the reveal tool but no proximity prompts
    and no region auto-naming. FR12.12 recaps are deterministic, not AI-drafted.
15. **Magic bookkeeping half-built (FR8.3/FR8.4).** No spirit tracker, no foci
    or reagent counters. Casting, drain and sustained penalties do work.
16. **No bookmarks (FR11.6)**, **no advancement editor (FR3.7)**, **no tactical
    hints (FR10.10)**, **no ownership transfer (FR1.2)**.

Deferred by design and *not* on this list as defects: dynamic lighting and token
vision (FR9.16), the Matrix overlay (FR9.17), the whole Matrix toolkit (M7),
native character generation (FR3.9), stagecraft audio (FR12.10), the image
adapter, PWA offline cache and campaign export.
