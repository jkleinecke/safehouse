# Safehouse — build report

What exists in this repo, measured against `DESIGN.md` rev 0.9 §6 (feature
modules) and §18 (roadmap). Rewritten from the code as it now stands — every FR
row below was re-read in the source, and every number below was produced by
running the command named beside it, not carried forward from a previous
revision.

> **How to read this document, and what went wrong with the last revision.**
> Every previous revision led with §1's FR tables, and those tables grade *code*:
> a row said `done` when the server route existed, was server-authoritative, and
> had a test. By that bar the app was ~complete. The GM's verdict on sitting down
> to prep a session was **"this is not as complete as represented"**, and he was
> right on every count: there was nowhere to see the player characters, the scene
> screen was a placeholder, and the codex had no AI affordance at all — while the
> FR rows for all three read `done`, because the *capabilities* were there and the
> *doors* were not.
>
> So the headline grade is now **§1 — can a GM actually do the job?**, one row per
> real task with the route a GM takes. §2's FR tables are supporting detail
> underneath it, and rows whose GM-facing surface is thin now say so in the row.
> **A capability reachable only through a chat panel, a CLI step, or a UUID is
> not done.**

- **Repo state:** 400 TS/TSX files of shipping source (~81.6k lines) across 5 workspace packages; 569 files / ~124.0k lines counting tests and the browser E2E suite. (`*.ts`/`*.tsx` under `apps/` and `packages/`, excluding `node_modules` and `dist`; seeds and scripts count as source, `test/`, `*.test.*` and `e2e/` do not.)
- **Verified on:** 2026-08-31. `pnpm -r --workspace-concurrency=1 typecheck` → exit 0. `pnpm -r --workspace-concurrency=1 build` → exit 0. `pnpm -r --workspace-concurrency=1 test` → **2031 passed, 3 skipped, 0 failed** across **142 test files** (contracts 7/52 · db 4/34 · rules 12/191 · server 52/723 · web 67/1034). Up from 1733/127 on 2026-08-29.
- **Scripted playthrough:** `pnpm playthrough` → **266 checks, 265 passed, 0 failed, 1 not applicable** (`docs/demo/SESSION_REPORT.md`). The count moves by one or two between runs because a handful of assertions are conditional on the night's dice; this run had one such skip. The last revision measured 267/267 on a luckier night.
- **Browser E2E:** **carried forward from 2026-08-29, not re-run this revision** — `pnpm --filter @safehouse/web e2e` → 38 passed, 2 skipped, chromium, 14 spec files, 42.4 s. The two skips are the perf harness, which runs only under `SAFEHOUSE_PERF=1`. There is no `test.fail` marker in the suite. **The spec count did not move this round, and that is itself a finding**: the three surfaces this round built — the party roster, the scene manager, the codex AI panel — have unit coverage and no browser spec. It is item 2 of §7.
- **The two §15 NFRs now have numbers.** Both were "no harness exists" last revision. Roll-to-visible: **p95 3.5 ms** client-visible over 200 rolls with six sockets in the room, against §15's 250 ms LAN budget — **71× headroom** (`apps/server/test/latency.test.ts`, in the ordinary suite). Grid frame budget with 60 tokens and fog: **main-thread p95 19.8–22.8 ms** across idle/pan/zoom/drag on both a laptop and a phone canvas under a 4× CPU throttle, inside §15's 33.3 ms floor, with camera gestures costing ~1.1× idle rather than an order of magnitude; the wall-clock interval misses in headless for a reason the harness measures rather than asserts (`apps/web/e2e/perf.spec.ts`). Full tables and the honest caveats: §5.
- **Bundle against §15** (re-measured 2026-08-31): initial JS **273.41 KB gz** (930.49 KB raw) against a < 500 KB gz budget, with PixiJS verified absent from the entry chunk (`grep -i pixi` → 0 hits in the entry, 6 in the Grid chunk). The Grid's lazy chunk is **107.07 KB gz** plus Pixi's own runtime splits (**76.70 KB gz** across eight files) — **≈183.8 KB gz** worst case against a < 900 KB gz budget. CSS 9.99 KB gz. **Every §15 bundle sub-clause is still met in the letter**, the codex editor included. **The entry chunk grew 236.63 → 273.41 KB gz this round** — +36.8 KB gz for the roster, the scene manager, the codex AI panel, the library route and the nav rewrite. That is 55% of the 500 KB budget, up from 47%: still comfortable, and the first revision where the trend is worth watching rather than noting. Details: §5.

Status vocabulary:

| Term | Meaning |
| --- | --- |
| `done` | Implemented end to end, server-authoritative where the FR requires it, covered by a test, a playthrough assertion, or an E2E spec — **and reachable by a GM from a named screen**. |
| `done · thin surface` | The capability is complete and tested on the server, and the GM-facing entry point is missing, hidden, or CLI-only. **This used to be graded `done`. It is the failure mode that produced "not as complete as represented", so it now has its own word.** Every one names what is missing. |
| `partial` | Core of the FR works; a named sub-clause is missing. Every one is itemized. |
| `deferred` | Not built, and §18 puts it in a phase we have not reached (P6) or Q9/Q3 resolved it as unused. Not a defect. |
| `not built` | In a phase we have otherwise shipped, but absent. These are the real gaps. |

---

## 1. Can a GM actually do the job?

**This is the grade.** One row per thing a GM actually sits down to do, with the
route they take to do it. The bar is not "does the endpoint exist" and not "do
the tests pass" — it is *a GM finishes the task without knowing a UUID, reading
the source, or being told where the feature secretly lives*. §2's FR tables are
the supporting detail underneath this table, not a substitute for it.

Verdicts were taken by driving the app in a browser as GM, as a player on a
375×812 phone and as the table display (`docs/UX_AUDIT.md` carries the walk-through
and the evidence), then re-verified against the source on 2026-08-31.

| # | The job | Verdict | Route |
| --- | --- | --- | --- |
| 1 | **See the party** — every PC, condition, Edge, the pools you ask for out loud — and open one sheet | **works** | GM console → *Campaign* → **Party** (`/c/:id/gm/party`). Rows link to each sheet by href. |
| 2 | **Build a scene** — create it, put a map on it, cut fog regions, set the environment, activate it | **works** | GM console → *At the table* → **Scenes** for the list and the levers; **Grid** for the drawing. Both cards say which is which. |
| 3 | **Write a codex page with AI help** — draft one, expand a stub, turn tonight's log into lore | **works** | **Codex** → open a page → the AI panel beside it (*draft · expand · summarise the log · suggest links*). Every result is a proposal the GM accepts or bins. |
| 4 | **Prep opposition** — author an archetype, roll a squad, check it against the party, stage it on the map | works-but-awkward | GM console → *Prep* → **Generator**. Completes end to end. Three warts, listed below. |
| 5 | **Run a fight** — pick tonight's encounter, start it, roll initiative, apply damage, use the copilot | **cannot-complete** | **There is no route.** The tracker shows whichever encounter `pickLiveEncounter` guesses; no screen lists encounters, sets one live, adds a combatant by hand, or rolls initiative. |
| 6 | **Look up a rule, show a player the page** | works-but-awkward | **Books** on both the GM rail and the phone nav; the reader is excellent. But there is no search box anywhere, and nothing pushes a page to the table. |
| 7 | **Close a session** — approve karma, draft and publish a recap | **works** | GM console → *Prep* → **Sessions**. Awards can also be originated from the Party roster now. |
| 8 | **Onboard** — start a campaign, get a character into it, get a player's phone onto that sheet, get the TV up | **works** | **Party** → *add a runner* / *import .chum5*; then pick the player's device on that row. *Pair the TV* is its own rail entry. |
| 9 | **Play as a phone player** — sheet, roll with its provenance, map, Edge, the rulebook | **works** | Bottom nav. One wart: a `SR5 p.426` chip on the sheet still opens a new tab. |

**Six of nine complete. Two are completable but awkward. One cannot be finished
at all, and it is the main event.**

For contrast, the same nine jobs when the GM's complaint was filed — before this
round — were: **jobs 1, 3, 5 and 8 cannot-complete outright**, job 6
cannot-complete for a player and awkward for the GM, job 9 blocked in practice by
job 8, job 2 landing on a placeholder, and only 4 and 7 clean. The audit's own
headline was "five of the nine jobs cannot be completed". Six of the nine moved,
and every one of them moved by
being given a door onto a capability that already existed and already had tests.
**Not one of the six needed a new server route.** That is the shape of this whole
round, and it is why "the tests pass" was never going to be the grade.

### The warts inside the green rows

These do not stop the job, and naming them here rather than burying them is the
point of this table:

- **(4) the generated NPC card is lost on a tab switch.** `GeneratePanel` owns
  the seed and the result in its own state and `GeneratorWorkspace` renders tabs
  conditionally, so going to check the threat readout unmounts the card and
  mints a new seed. The roster you added it to survives; the card does not.
- **(4) "save encounter" always creates a new row.** `EncounterBuilder.tsx:88`
  never PATCHes on `savedId`. Clicking it twice — the natural thing after picking
  the linked scene you forgot — leaves two identically named encounters. **This
  is what makes job 5 worse than merely missing**: the picker that does not exist
  would be picking between duplicates the app itself made.
- **(4) "stage on map" is disabled with no scene linked and says nothing.**
- **(6) no book search UI.** `GET /api/books/search` (FR12.14's FTS) has exactly
  one consumer in the repo: the Fixer's `search_books` tool. Without a local
  model, "look up a rule" is "already know the page number".
- **(6) FR11.6's bookmarks and recents trail have no UI at all.**
- **(6/9) two ref-chip implementations.** `features/gm/books/RefChip.tsx` opens
  the reader in place; `features/sheet/components/ui.tsx:167` is a separate
  `<a target="_blank">`, so a chip on a phone sheet leaves the sheet mid-fight.
- **(7) awards still cannot be originated from the Sessions screen**, which is
  where the GM is standing when they want to give the table karma. The Party
  roster is the workaround, and it is a good one.

### What job 5 needs, precisely

Everything *inside* a fight is built and good — end-pass over the socket, the
damage dialog that previews before it commits, wound modifiers moving derived
numbers in front of you, the copilot rack, morale, interrupts, the
server-authoritative resolve chain. What is missing is the list and the switch:

| Missing | Already written, uncalled |
| --- | --- |
| an encounter list on the tracker | `useEncounterList` (`features/table/commands.ts:120`) — exported, consumed by nothing |
| set live / end / rename / relink / delete | `PATCH`/`DELETE /api/encounters/:id` — **no caller in `apps/web/src`** |
| add a combatant by hand (FR4.1) | `POST /api/encounters/:id/combatants` — no caller |
| roll initiative as a deliberate act | `POST /api/encounters/:id/roll-initiative` — no caller |
| a button that says it starts the fight | today it is "New turn", whose tooltip says "Re-roll initiative (FR4.3)" |

Until someone presses "New turn", `encounter.state` never becomes `live`, so the
TV cannot draw the initiative ribbon either (`features/tv/encounterState.ts:203`).

---

## 2. Status by module

### M1 — Accounts, campaign, membership *(P0)*

| FR | Status | Where |
| --- | --- | --- |
| FR1.1 QR join, GM at install | done | `services/auth.ts` (`POST /api/campaigns` bootstrap, `GET /api/campaigns/:id/join-qr`, `GET\|POST /api/join/:code`), `plugins/auth.ts` (`POST /api/campaigns/:id/gm-device`, `POST …/gm-pair` — single-use GM pairing code). `web/src/components/shell/Landing.tsx` offers three tabs (start a campaign · pair with a code · paste a token) over `signin.ts` / `signin-api.ts`. `test/auth-gm.test.ts` (18), `e2e/gm-signin.spec.ts` (3). |
| FR1.2 one GM + players + observers; transfer ownership | **done · thin surface** | Roles and membership in `memberships`/`Role`. Transfer: `POST /api/campaigns/:id/transfer-ownership` and `PATCH /api/characters/:id/owner` in `plugins/campaigns-admin.ts`. **`PATCH …/owner` now has a real control** — the owner picker on each Party roster row (`features/gm/home/PartyPanel.tsx`), which is how a player's phone gets a sheet at all. **`transfer-ownership` still has no caller in `apps/web/src`**: handing the campaign itself to another GM is an API-only act. |
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
| FR3.1 Chummer `.chum5` import, raw file kept, unmapped listed, re-import diff | **done · thin surface** | `services/chummer.ts` + `chummer-xml.ts`, `diffSheets`, `POST /api/characters/:id/import`. **The first import now has a door** — `features/gm/home/AddCharacter.tsx` takes a blank sheet or a `.chum5` file into `POST /api/characters`, from the Party roster's empty state. Until this round nothing in the browser had ever created a character and `pnpm seed:demo` was the only thing that ever had. **Re-import onto an existing sheet, and the diff that is the interesting half of this FR, still have no UI.** |
| FR3.2 phone-first sheet with tabs | partial | Skills, Combat, **Magic**, Gear, Contacts, Background, Ledger + pinned identity/vitals strip (`features/sheet/playState.ts` `SHEET_TABS`). **Missing: Matrix tab** — consistent with M7 being deferred, and the only thing holding this row at `partial`. |
| FR3.3 derived values with provenance | done | `deriveCharacter`, `GET /api/characters/:id/derived` (which also returns `combatantId` when the tracker is live — that is what makes Seize/Blitz offerable). |
| FR3.4 monitors, wound modifiers, Edge, ammo, progressive recoil, sustained, statuses | done | `services/character-play.ts`, `POST …/damage\|edge\|ammo\|recoil\|sustained`. **The GM can now read and drive these without opening a sheet**: `features/gm/party/PartyRow.tsx` shows both monitors, the wound modifier they imply, Edge, defence, soak and perception, and applies damage and heals through the same routes. |
| FR3.5 manual override on any derived value, flagged, with a note | done | `POST/DELETE /api/characters/:id/overrides`. |
| FR3.6 karma & nuyen ledgers, pending-until-approved | done | `plugins/ledger.ts`; approve/reject, now inside `Hub.atomic`. Run awards post through it (FR5.5). **Awards can now be originated from the Party roster**, not only from `RunsBoard` — still as *pending* rows, so the housekeeping beat is unchanged. They still cannot be originated from the Sessions screen, which is where a GM is standing when they want to give the table karma for turning up. |
| FR3.7 advancement (guided karma spends) | deferred | Not built. Deliberate — see §6's deferred list. |
| FR3.8 revisions + rollback | **done · thin surface** | `GET …/revisions`, `POST …/rollback`. Neither route has a caller anywhere in `apps/web/src`: a GM cannot see that a sheet has history, let alone roll one back. |
| FR3.9 native priority char-gen | deferred | P6 by design (D5 — Chummer is the builder until then). |

### M4 — Combat tracker *(P1)*

| FR | Status | Where |
| --- | --- | --- |
| FR4.1 encounters from PCs / templates / generator / grunt groups; prep + launch, incl. from a scene | **done · thin surface — the worst one in this document** | `plugins/encounters.ts`, `POST /api/scenes/:id/stage-encounter`. The server does all of it. The browser does **prep only**: `POST /api/encounters/build` from the generator and `stage-encounter` from a scene. **Nothing in `apps/web/src` lists encounters, picks one, launches one, renames or relinks one, deletes one, or adds a combatant by hand** — `PATCH`/`DELETE /api/encounters/:id` and `POST …/combatants` have no caller, and `useEncounterList` (`features/table/commands.ts:120`) is written, exported and consumed by nothing. The tracker shows whatever `pickLiveEncounter` (`live/merge.ts:368`) guesses. This row read `done` for four revisions; it is job 5 in §1. |
| FR4.2 SR5 initiative incl. astral / cold-sim / hot-sim variants, wound mods | done | `rules/src/combat/initiative.ts`. Staged encounters derive through the engine too (FR9.10). |
| FR4.3 native pass structure (−10 loop, re-roll on new turn) | **done · thin surface** | `services/encounters.ts:365` — `rollInitiativeAll` opens on turn 1 / pass 1. The engine is right; the button is not. **Starting a fight is done by pressing "New turn", whose tooltip reads "Re-roll initiative (FR4.3)"** — the flip to `state: 'live'` is a side effect of `newTurn` (`services/encounters.ts:524`), and `POST …/roll-initiative` has no UI at all. A GM opening the tracker has no reason to press it, and until they do the TV cannot draw the initiative ribbon (`features/tv/encounterState.ts:203`). |
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
| FR9.1 scenes, configurable grid, notes, activate, private staging | done | `plugins/scenes.ts`, `contracts/src/scene.ts`. **The GM surface is now two screens with a stated division of labour**: `features/gm/ScenesPage.tsx` (+ `gm/scenes/`) is the inventory — create, duplicate, rename, archive, delete, activate for the table, environment (FR9.11), staged reveals (FR9.14) — and the Grid's GM panel is the in-canvas authoring tool. Until this round `/c/:id/gm/scenes` was a placeholder card that the sidebar and the console both linked to. `sceneManager.test.tsx` (24). |
| FR9.2 map building | done | Image upload, multi-image background list, grid alignment, walls/doors/zones with a GM authoring UI (`web/features/grid/gm/GeometryTab.tsx`, 20 tests), and scan-friendly rotate / crop / contrast / brightness (`gm/MapTab.tsx`, `mapImage.ts`, 13 tests). Prop/tile stamp library remains P3+ by design. |
| FR9.3 map pins → codex / handouts | done | `gm/PinsTab.tsx` and `stage/layers.ts drawPins`; GM-only pins stripped server-side in `sceneForViewer`. |
| FR9.4 tokens (PC/NPC/grunt/spirit/drone/prop), art, sizes, facing | done | `contracts/src/token.ts`, `POST /api/scenes/:id/tokens`. A summoned spirit can now become one of these (FR8.3). |
| FR9.5 drag with snap, server-authoritative, smooth interim motion | done | `token.drag` ephemeral + `token.move` authoritative. |
| FR9.6 bars, status markers, aura rings | done | `grid/projection.ts` gates numeric bars per viewer (27 tests). |
| FR9.7 hidden tokens — positions never sent | done | `e2e/secrecy.spec.ts` reads the client's own store, not the screen. Principle 4 held. |
| FR9.8 ruler in metres, walk/run colouring | done | `grid/geometry.ts` + tests. |
| FR9.9 range bands → range modifier into the roll | done | Range band lands in the receipt. |
| FR9.10 encounter ↔ scene both ways | done | `services/scenes.ts` `stageEncounter` derives through `deriveFor`, so wired reflexes and adept powers survive staging. |
| FR9.11 scene environment as a modifier source with provenance | done | `rules/src/env.ts`, `activeSceneModifiers`. Applied **once** — see LIVE-2 in §3, pinned by `e2e/pool-parity.spec.ts`. |
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
| FR10.5 party-aware threat readout with visible math | done | `GET /api/encounters/:id/threat`, `services/generator-threat.ts`. **The readout the GM actually reads is computed in the browser**, by `features/gm/generator/readout.ts` over the shared `@safehouse/rules` engine, so the levers move instantly — the server route has no caller. It is not a second implementation and it does not lie: every number carries an `est` badge and the module's own docblock says `hits ≈ pool ÷ 3`, which is P3 satisfied by honesty rather than by provenance. Worth knowing before quoting a number from it. |
| FR10.6 balance levers recompute live | **done · thin surface** | `POST /api/encounters/:id/threat/recompute` — **no caller in `apps/web/src`**; the live recompute the GM sees is `readout.ts` running locally (see FR10.5). The FR's behaviour is delivered; the server route it names is not the thing delivering it. |
| FR10.7 quick-roll rack | done | `GET /api/combatants/:id/quick-rolls`, `POST …/quick-roll`, stamped with the active session. |
| FR10.8 resolved chains, card-per-step, override before commit | done | `services/encounters-rolls.ts` writes one `rolls` row per pool (attack / defence / soak) at `gm` visibility the moment the server throws them, linked by `request.meta.chainId`, inside a transaction; damage lands only on `…/resolve-chain/commit` (Principle 2). `test/encounters-chain-rolls.test.ts`. The tracker's card UI is now on that endpoint too: `web/features/table/resolveChain.ts` posts the exchange and reads every face off the response, with **no local fallback anywhere in the feature** — an unreachable endpoint draws no dice rather than browser ones. `resolveChain.test.tsx` (22) includes a source-level assertion that the feature does not import `resolveAttackChain`. |
| FR10.9 morale from Professional Rating triggers | done | GM-only, never acts; measured against a real PR for hand-added rows too. |
| FR10.10 tactical hints on the acting NPC's turn | **done** | `services/tactical-hints.ts` — one line of co-GM advice on the acting NPC's turn, derived from `roleTags` + condition. Three properties enforced in the module rather than trusted to callers: a hint is **text only** (no id, no verb, nothing to "apply"), it is **off unless `campaigns.settings.tacticalHints === true`**, and it is **GM-only**. `test/tactical-hints.test.ts` (12), web `hints.test.tsx` (8) + `trackerHints.test.tsx` (5) + `trackerHintsToggle.test.tsx` (4), `e2e/hints.spec.ts` (2 — off by default; with hints on, a player's device does not contain the line at all). |

### M11 — Rules library *(P1)*

| FR | Status | Where |
| --- | --- | --- |
| FR11.1 registry: code, title, page offset, calibration helper | **done · thin surface** | `plugins/books.ts`, `PATCH /api/books/:id`; `web/features/gm/BooksPage.tsx` calibration stepper, now with `books/BookShelfCard.tsx` and `books/SeedInstructions.tsx`. **Registering a book is still CLI-only**: `POST /api/books` and `POST /api/attachments` have no caller, so adding a rulebook means stopping the server (PGlite is single-writer and `seed-books.ts` opens the same `DATA_DIR`), running `pnpm seed:books`, and starting it again. The instruction card now says so plainly, which is honest, not fixed. |
| FR11.2 structured `{book, page, note?}` refs | done | `contracts/src/common.ts`; used across sheet, templates, tables, codex. |
| FR11.3 one-tap open at the printed page, in-app, on phones | **done** | Self-hosted pdf.js, per §13. `apps/web/scripts/vendor-pdfjs.mjs` copies `pdfjs-dist` into `public/pdfjs/` at `postinstall` and `build`, so the library costs zero bundle bytes and the worker stays a same-origin module worker. `features/reader/` holds the viewer (`pdfjs.ts`, `PdfSurface.tsx`, `ReaderCore/Shell/Route`), the printed-page arithmetic (`pageMath.ts`), byte-range fetching (`range.ts`) and `mode.ts`, which keeps the browser's own viewer as the documented fallback reachable three ways — `?native=1`, a remembered per-device preference, and automatically when pdf.js cannot start. `test/reader-route.test.ts` (9), web `mode`/`pageMath`/`range`/`pdfjs`/`layout`/`ReaderShell` (12)/`refChipViewer` (4), `e2e/reader.spec.ts` (3 — a ref chip opens the printed page over byte ranges, the jump box moves the page under it, pinch and the zoom controls both change scale). |
| FR11.4 ref autolinking of `SR5 p.426` patterns | done | `web/features/gm/books/refs.ts` + tests; also used by the codex renderer. |
| FR11.5 shared with the table, per-book GM-only toggle | done | A player's search returns real page provenance. **Players can now reach the shelf**: `/c/:campaignId/books` (`features/library/LibraryPage.tsx`) is role-aware — the GM's calibration shelf, or the shared shelf — and **Books** is on `PLAYER_NAV`, so it is a card on the campaign home and a glyph in the phone's bottom nav. Before this round the shelf existed only behind the GM guard, and a player could reach a rulebook only through a ref chip that happened to be embedded in something they were already reading. |
| FR11.6 named bookmarks + recently-opened trail | **done · thin surface — nothing renders it** | `services/bookmarks.ts` + routes; `test/books-bookmarks.test.ts` (13). `GET/POST/DELETE /api/campaigns/:id/bookmarks`, `GET …/library` and `GET …/library/recent` have **no caller anywhere in `apps/web/src`**. The whole FR is invisible to a GM. |
| FR11.7 `pnpm seed:books` folder import with guessed codes | done | `apps/server/scripts/seed-books.ts`. PDFs stay out of git. |

### M12 — The Fixer *(assistant core P1)*

| FR | Status | Where |
| --- | --- | --- |
| FR12.1 GM-only dockable streaming panel, history, two model slots | done | `plugins/fixer.ts`, `fixer/conversations.ts`, `web/features/gm/fixer/`. |
| FR12.2 grounded rules research, citations from retrieval not the model | done | `search_books` returns `{book, printedPage}`; the chip is the server's. |
| FR12.3 lore and state research | done | `search_codex` over a real codex (`fixer/state-codex.ts`). |
| FR12.4 planning / brainstorming with "save to codex" | **done** | The draft lands as a `wiki_page` the codex UI can browse and edit — **and, as of this round, on the page it belongs to.** `features/codex/ai/AiPanel.tsx` hydrates the campaign's pending `wiki_page` drafts on mount, so a draft asked for from the Fixer chat two screens away is waiting beside the page rather than in an inbox the GM has to know about. |
| FR12.5 NPC fiction layer onto procedural stats | done | `generate_npc` + persona; D13 split held. |
| FR12.6 in-character conversations with knowledge boundary + secrets | **done · thin surface** | `POST /api/npcs/:id/converse`. **No chat surface exists** — the route has no caller in `apps/web/src`, so talking to an NPC in character is an API-only act. |
| FR12.7 codex drafting | **done** | `draft_wiki_page` → `wiki_pages` on accept. **This round gave it the door the user asked for.** `features/codex/ai/` puts four actions beside the page — *draft with the Fixer · expand · summarise the log · suggest links* — plus `NewPagePrompt` in the browser for an empty codex. Nothing applies itself: every result is a `ProposalCard` the GM accepts, edits or rejects (P8). Accepting an **expansion** is `PATCH /api/wiki/:id` (`ai/api.ts:240`), which is what makes "flesh out this stub" possible at all — the server's `applyWikiDraft` only ever inserts, and remains correct as the accept-as-new-page path. With `LLM_BASE_URL` unset the buttons stay visible and disabled with the reason (NG7), rather than vanishing as `FixerDock` does. `codex/ai/ai.test.tsx` (29). Before this round, grepping `PageView.tsx` for *fixer*, *draft*, *generate* or *ai* returned nothing at all. |
| FR12.8 fog NL commands, proximity prompts, region auto-naming | done | `suggest_fog_reveal` + `fog_reveal` draft kind; `fixer/proximity.ts` behind `check_fog_proximity` and `GET /api/fixer/fog-proximity` — GM-only, never written down. |
| FR12.9 token identification / labelling | done | `fixer/token-id.ts`, `identify_tokens`, `POST /api/fixer/identify-tokens`. |
| FR12.10 stagecraft (music tagging + scene matching) | deferred | `audio_tracks` table only. |
| FR12.11 map assistance (layout copilot) | **done, both lanes** | Lane 1 unchanged: `fixer/geometry.ts` / `propose_geometry` compiles guided-JSON rectangles to walls / doors / named fog regions as a draft. Lane 2 is new — **map vision**: `fixer/vision.ts` + `vision-probe.ts` probe the configured model once, cache the answer, and offer `read_map_image` **only** when the box actually reads images (`fixer/agent.ts:363` filters it out otherwise). The route distinguishes the two "no" cases honestly: `503 ai_disabled` for no box, `501 vision_unsupported` for a box whose model is text-only. `test/fixer-vision.test.ts` (17). |
| FR12.12 recap drafts | **done** | `fixer/tools-recap.ts` (`draft_recap`) + `fixer/recap.ts` (`assembleRecap`): the model writes prose only, the server adds tallies, casualties, reveals and awards from the log itself, and the FR12.19 spoiler guard runs **unconditionally** because a recap is player-facing by definition. The deterministic client-side skeleton survives as the no-model path (`web/features/gm/sessions/recap.ts`). `test/fixer-recap.test.ts` (8), `e2e/recap.spec.ts` (3). |
| FR12.13 OpenAI-compatible local provider; unset base URL hides everything | done | `fixer/llm.ts`, `GET /api/fixer/status`. Nothing touches the internet. |
| FR12.14 retrieval over extracted book text, Postgres FTS | **done · thin surface** | `book_pages.tsv` generated tsvector, `searchBookPages`. **`GET /api/books/search` has exactly one consumer in the repo — the Fixer's `search_books` tool.** Nothing in `apps/web/src` calls it and the reader has no in-page find, so a GM without a local inference box cannot search the rules at all: "look up a rule" degrades to "already know the page number". |
| FR12.15 every generation an `ai_generation` draft; usage meter | **done** | `fixer/drafts.ts` for drafts; the meter is now durable — `ai_usage` (`schema.ts:432`, migration `0002_macros_and_usage.sql`) records every chat turn, `fixer/usage.ts` `persistTurnUsage` / `campaignUsage` read it back, and `GET /api/campaigns/:id/fixer/usage` reports both the durable total and the per-process live one. `test/fixer-usage.test.ts` (7) includes "reads the same number back from a fresh server on the same directory"; the playthrough asserts 4 turns / 1261 tokens survive a restart while the per-process half correctly reads zero. |
| FR12.16 fast/primary slot discipline | done | `fast` defaults to `primary` when unconfigured. |
| FR12.17 read-only state tool catalog | done | 26 tools registered plus the capability-flagged `read_map_image`: `get_campaign`, `list_characters`, `get_character`, `get_ledger`, `get_encounter`, `get_scene`, `get_session_log`, `search_books`, `get_page`, `search_codex`, `list_contacts`, `list_runs`/`get_run`, `get_calendar`, `list_npcs`, `get_npc`, `get_threat_readout`, `get_magic_state`, `get_matrix_state` — plus `generate_npc`, `draft_wiki_page`, `draft_recap`, `suggest_fog_reveal`, `check_fog_proximity`, `identify_tokens`, `propose_geometry`. `get_magic_state` now returns `spirits: { tracked: true, list }` because the tracker exists (FR8.3); `get_matrix_state` still returns `tracked: false` with a note for Overwatch and marks rather than a misleading zero — honest about M7 not existing. |
| FR12.18 situation snapshot prefix during live sessions | done | `fixer/agent.ts:114` (`buildSituationSnapshot`). |
| FR12.19 spoiler guard on player-facing prose | **done** | The guard is server-side: `spoilerScan` (`fixer/drafts.ts`) matches GM-only names and returns `SpoilerFlag[]` = `{name, why}`; the tool result tells the model to name the flags and ask reveal-or-cut; the playthrough catches a GM-only name in a recap draft. The GM now *sees* it: `spoilerFlagsOf()` (`web/features/gm/fixer/api.ts`) accepts the object form the server actually sends — and the legacy string form, and flags nested in `output` — and `DraftsInbox.tsx` renders the "spoiler guard — reveal or cut?" panel on the card the GM accepts from. `spoilerFlags.test.ts` (5) pins the wire shape; `e2e/recap.spec.ts:234` asserts the warning is on the card, as a plain passing test. The `test.fail` marker is gone. |

### M5 — Campaign codex *(P4)*

`plugins/codex.ts` (wiki pages, per-page **and per-section** visibility,
`[[Wiki-links]]` + backlinks + unresolved report, handouts staged then
revealed), `plugins/codex-runs.ts` (runs, awards posting to the ledger as
*pending*), `plugins/codex-calendar.ts`, `plugins/contacts.ts`. Services in
`services/codex.ts` / `codex-store.ts` / `codex-templates.ts`. Web:
`features/codex/` (`CodexPage`, `PageBrowser`, `PageView`, `Markdown`,
`RunsBoard`, `CalendarView`, `ContactsPanel`, `HandoutsPanel`, `TemplatePanel`,
and now `ai/` — `AiPanel`, `NewPagePrompt`, `ProposalCard`)
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
| P1 Run the table | **Done on capability; not on the job.** FR2.8's server half closed the last sub-clause, and the dice, the log and the sheet are all real. But "run the table" contains "start tonight's fight", and P1's own FR4.1 has no launch UI — §1's job 5. **This phase should not have been marked Done on the strength of `plugins/encounters.ts` alone.** |
| P2 The Grid | **Done.** Map on the TV, geometry and pins authoring, pointer and focus across the wire, and both lanes of FR12.11 including map vision. |
| P3 Opposition Kit | **Done.** FR10.10 hints were the last row and they shipped off by default, as the FR requires. |
| P4 Campaign memory | **Done.** M5 codex, runs, calendar, contacts, handouts; M6 sessions; FR3.6 approvals; FR5.6 template↔codex linkage; FR12.12 AI recap drafting. |
| P5 Deep SR5 | **Done bar FR3.7 and FR12.10.** FR8.1–8.5 all ship. The advancement editor and stagecraft audio remain deliberately unbuilt. |
| P6 Stretch | Deferred as designed: M7, FR9.16, FR9.17, FR3.9, image adapter, PWA, export. |

**A note on these six "Done"s, since one of them just moved.** A phase was
marked Done when its FRs were. FRs were marked done when the server was. That is
two inferences away from "a GM can run a session", and this revision is the bill
for both of them. Phase state is now the weakest of (capability, surface) and
not the strongest.

### Roll20 exit checklist (§18)

| Roll20 feature | State |
| --- | --- |
| Maps, grid, tokens | shipped |
| Fog of war | shipped (manual + staged) |
| Measurement / ruler | shipped, SR5-native |
| Dice + macros | **shipped — macros now follow the person, not the handset** (FR2.8) |
| Initiative tracker | shipped, **with no way to choose which encounter it tracks** — see job 5 in §1 |
| Character sheets | shipped via Chummer import — **and the import finally has a button** (`home/AddCharacter.tsx`); re-import and rollback are still API-only |
| Handouts | shipped — upload, attach, stage, reveal, TV takeover |
| Journal / notes | shipped (M5 codex, with templates page-referenced) |
| Rollable tables | shipped |
| Shared map on the table TV | shipped |
| Jukebox, dynamic lighting | not used, by decision (Q9) |
| PDFs deep-linked in-app | **shipped — self-hosted pdf.js, page-accurate on a phone** (FR11.3) |

No red rows. **Two rows carry an honest asterisk again**, and both are the same
kind of thing this revision exists to stop hiding: the initiative tracker is
genuinely better than Roll20's *once a fight is running*, and there is no way to
choose which fight that is; the Chummer pipeline is real and now has a button for
the first import only. §18's condition for cancelling the Roll20 subscription is
met on features and **not yet on the tracker's ergonomics** — a GM running a
second encounter in one night would find Roll20 easier today.

---

## 3. Found by driving the app

This section holds **seven** findings in two families, and the difference between
the families is the most useful thing in this document.

**LIVE-1 … LIVE-4 are broken behaviours.** They were not found by the automated
suite: against the build they were reported on, `pnpm -r test` was 1194 green,
`pnpm playthrough` was 187 green, and the browser E2E suite was green. They were
found by a human opening a browser — or, for the last one, a terminal — and using
the thing for ten minutes. The first three lived in the seam between a correct
server and a rendered page, precisely the seam an in-process `app.inject` harness
cannot see because it never mounts a component. The fourth lived one layer down,
in a blind spot of the same shape: not the seam between two *processes* — the
browser harness already crossed that — but the *state* one process can hand the
next, which nothing anywhere manufactured.

**UX-1 … UX-3 are missing entry points**, and they are a different animal. They
were found by a human trying to *prep a session* — not by driving the app as a
machine, but by sitting down to do the job it exists for. Read the next paragraph
before the findings; it is the point of the section.

> **No automated harness would ever have flagged UX-1, UX-2 or UX-3, and adding
> one would not have helped, because every one of them is a missing entry point
> rather than a broken behaviour.** LIVE-1 to LIVE-4 each had a right answer some
> test could have compared against: a store that should have been full, a pool
> that should have been 5, a route that should have returned HTML, an append that
> should have succeeded. UX-1 to UX-3 had nothing to compare against. There was
> no assertion to write, because every line of code involved did exactly what it
> said. `GET /api/campaigns/:id/characters` returned all three PCs to a GM,
> correctly, with tests. `ScenesPage.tsx` rendered its placeholder, correctly.
> `draft_wiki_page` produced a codex draft, correctly, and the playthrough
> asserted it. **The defect was in the set of things the app offered to do, and a
> test suite can only check the things it was told about.** A suite is a
> conversation with the code; these three were the questions nobody asked. The
> only instrument that finds them is a person with a job to do and a Friday
> night, which is why `docs/UX_AUDIT.md` exists and why it is a walk-through
> rather than a test file.
>
> The corollary is the practical part: for LIVE-defects the right response is
> "what state does nothing construct?", and it produces a test. For UX-defects
> the right response is "what did the user come here to *do*, and what is the
> route?", and it produces §1. Both questions have to be asked; only one of them
> can be automated.

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
production SPA fallback (`app.ts:178–181`, `/join` not in `API_PREFIXES`), and
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
them** — `restore-boot.test.ts` and `scripts/migrate-to-postgres.ts`.

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
  or it waits forever). It started as one call site on the roll path; **all 44
  emission sites across 13 files now go through it**, with one audited
  exemption. See the paragraph that closes this section.
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
`core-atomicity.test.ts` (9), `core-atomicity-domains.test.ts` (19) and
`core-atomicity-emits.test.ts` (22) block a
named event type with a real CHECK constraint and assert **both** halves — a
named error to the caller *and* no domain row; `core-shutdown.test.ts` (8) pins
that a server closed through `shutdownServer` reopens with
`last_value === max(id)`; and `apps/web/e2e/log-append.spec.ts` (2) makes a roll
from the composer in a real browser and checks it is still in the log after a
reload.

**Now closed the whole way.** The sweep this defect started is finished:
**exactly one** `hub.emit` in the entire server runs outside a transaction, and
it is an audited exemption with no domain row to be inconsistent with
(`plugins/scenes.ts:730`, `display.set` — the event *is* the state). The other
44 emission sites go through `tx.emit` inside a `Hub.atomic` block, across 13
files. `core-atomicity-emits.test.ts` (22) proves the
paths the second half of the sweep converted, each by blocking its event type
with a real CHECK constraint and asserting both halves; its last two tests scan
`src/` for a bare `hub.emit(` and allow that one call, by file and by name, so
the sweep stays swept as the code moves.

### UX-1 — there was nowhere to see the player characters *(blocked the GM's first job)*

**What it cost at the table.** A GM filling in a campaign could not look at a
player's sheet. `/c/:id/gm` rendered campaign settings, invites, devices and the
join QR, and no roster. The sidebar had no party entry. `/c/:id` offered no Sheet
card, because a GM device owns no character. The **only two links to
`/sheet/:characterId` in the entire web app** were `BottomNav.tsx:20` and
`CampaignHome.tsx:26`, both gated on `useMyCharacterId`, which resolves *this
device's own* character by `ownerUserId === session.userId`. For a GM the count
of reachable sheets was therefore zero, and the documented workaround was to
paste a UUID into the address bar. The only GM surface showing real party numbers
was the Opposition Kit's threat readout — reachable by building an encounter
first.

**Why nothing caught it.** `GET /api/campaigns/:id/characters` returns all three
PCs with full sheets to a GM, correctly, under test. `useCharacters(campaignId)`
already existed at `features/grid/api.ts:87` and was used for the Grid's token
placer and for session attendance chips, which render the same three names as
*toggle buttons*. Every piece was present, correct and tested. Nothing asserted
that a GM could get from a screen to a sheet, because that is not a behaviour —
it is an absence.

**The fix.** `/c/:campaignId/gm/party` (`features/gm/party/`), reached from a
sidebar whose entries now come from one list, `gmNav.ts` `GM_NAV`, rendered by
both the rail and the console home so a screen cannot exist in one and be
invisible in the other. Rows link by href; they carry monitors, wound modifier,
Edge, defence, soak, perception, initiative and the ledger balances, and apply
damage and awards through the sheet's own routes. `roster.test.ts` (25),
`party.test.tsx` (14), `navigation.test.tsx` (20).

### UX-2 — the Scenes screen was a placeholder that argued for its own deletion

**What it cost at the table.** `/c/:id/gm/scenes` rendered a card reading
"Scenes — Placeholder — scene authoring, activation, fog regions land here", with
no link out. It was offered **twice**: from the sidebar and from the GM home's
tool chips. The real authoring lives in the Grid's GM panel and is very good, and
nothing on the placeholder said so.

**The part worth recording.** The file's own docblock admitted the route was the
bug — and concluded that the fix was to delete the link. That conclusion was
wrong, and it is a specific failure mode worth naming: *a placeholder that
explains itself to a code reader has discharged nothing, because the person who
needed the explanation is a GM looking at a screen.* The docblock was, in effect,
a comment addressed to the wrong audience. It also reasoned from the wrong
premise: the Grid panel is an in-canvas drawing tool that does the list badly —
one line per scene, no map preview, no token count, no fog inventory, no rename,
no duplicate, no delete, and an environment editor reachable only by first
putting a scene on screen — and a GM prepping Friday is doing list work.

**The fix.** `ScenesPage.tsx` is the scene manager, with the division of labour
written on the cards: here for inventory, create, duplicate, rename, archive,
delete, activate, environment (FR9.11) and staged reveals (FR9.14); the Grid for
walls, doors, zones, pins, painting fog, tokens and calibration. It hydrates from
REST on mount and lets live events only invalidate (LIVE-1). `sceneManager.test.tsx` (24).

### UX-3 — the codex had no AI affordance, and "expand a stub" was impossible

**What it cost at the table.** "I should be able to use AI to help fill out the
codex" was the user's third complaint, and
`grep -niE "fixer|draft|generate|ai" features/codex/PageView.tsx` returned
nothing. The capability existed: `draft_wiki_page` (`fixer/tools.ts:238`) had
been in the tool catalog since M12 and FR12.7 read `done`. Reaching it meant
leaving the page, opening the Fixer chat, phrasing a request so the model chose
that tool, then finding the drafts inbox. The affordance lived two screens from
the writing and was *conversational* rather than a control on the thing being
edited.

Worse, one obvious use was **not merely missing but impossible**:
`applyWikiDraft` (`fixer/drafts.ts:245`) always did `db.insert(wikiPages)` and
the draft carried no page target, so asking the Fixer to flesh out an existing
page and accepting the result produced a **second page with the same title**.

**The fix.** `features/codex/ai/` — four actions beside the page (*draft with the
Fixer · expand · summarise the log · suggest links*) and `NewPagePrompt` in the
browser for an empty codex. Principle 8 is untouched and now visible: every
result is a `ProposalCard` the GM accepts, edits or rejects, and the panel
hydrates pending `wiki_page` drafts on mount so a draft asked for from the chat
is waiting on the page it belongs to. "Expand" resolves by accepting into
`PATCH /api/wiki/:id` (`ai/api.ts:240`) rather than by teaching the server's
applier an update branch — an edited draft is never written back as the model's
own text, which is the one thing P8 exists to prevent. With no `LLM_BASE_URL` the
buttons stay on screen **disabled with the reason**, deliberately unlike
`FixerDock`'s `return null`: a GM should learn that the feature exists and is
asleep (NG7). `ai.test.tsx` (29).

### What changed structurally

`apps/web/e2e/` exists: Playwright, chromium, 14 spec files, 40 tests, run
against the **real** stack (built server + built SPA on one origin, throwaway
`DATA_DIR`, PGlite, the demo campaign, no model, no network). It runs in CI
after the unit suite and the smoke playthrough. The runner (`e2e/run.mjs`) skips
with a message when no browser binary is present rather than turning CI red for
a download failure; `e2e:strict` fails instead, for when you mean it.

The newest spec is a different animal from the other thirteen and is worth
naming here rather than in the tables: `perf.spec.ts` does not assert what is
drawn, it asserts how long drawing took. It is the first harness in the repo
whose failure mode is "the app got slower", and it skips itself unless
`SAFEHOUSE_PERF=1` because a throttled timing run has no business gating a
merge. §5 carries its output.

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

**And restated once more after UX-1 … UX-3, which is where it stops being about
harnesses at all.** The four LIVE defects were found by driving the app *as a
machine* — open a page, cut a socket, restart a process, watch what breaks. The
three UX defects were found by a human trying to prep a session, and **no
automated harness would ever have flagged any of them, because every one is a
missing entry point rather than a broken behaviour.** There was no wrong answer
to assert against: the roster endpoint returned the right characters, the
placeholder rendered the string it contained, `draft_wiki_page` produced a
correct draft the playthrough checked. Tests compare an outcome to an
expectation; a missing door has no outcome. What finds it is someone with a task
and no patience, and the artefact that captures it is a table of *jobs* — §1 —
not a table of *routes*.

The three harness questions this repo now asks of itself, in the order they were
learned:

1. **Which seam does this cross that nothing else crosses?** (LIVE-1 … LIVE-3.)
2. **Which state does this construct that nothing else constructs?** (LIVE-4 —
   and the honest answer for most suites is "the happy one".)
3. **Which job does this let someone finish that they could not finish before?**
   (UX-1 … UX-3. Only a person can answer it, and the answer belongs at the top
   of this document rather than in a spec file.)

---

## 4. How to run

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

### Measuring the §15 numbers

```bash
# roll-to-visible latency — 200 rolls, six sockets. Also runs in `pnpm -r test`.
pnpm --filter @safehouse/server exec vitest run test/latency.test.ts

# Grid frame budget — 60 tokens + fog, laptop and phone canvases, 4× CPU throttle.
pnpm build
SAFEHOUSE_PERF=1 SAFEHOUSE_E2E_NO_BUILD=1 pnpm --filter @safehouse/web e2e -- perf.spec.ts
```

The latency suite is cheap (≈6 s) and gates: its budget has ~70× headroom, so
it can afford to. The browser harness costs ≈2.5 min and does not; it is
skipped unless `SAFEHOUSE_PERF=1`, and CI's `perf` job is `continue-on-error`
on purpose — a timing check that can turn `main` red on a busy afternoon gets
switched off within a week, at which point it measures nothing at all. Both
print their tables whether or not they pass. `SAFEHOUSE_PERF_CPU_THROTTLE`
overrides the 4× default.

### Production

```bash
pnpm docker:up              # creates .env, rebuilds from this checkout, prints the running build
```

`app` (server + built SPA on 8787) · `postgres:16` · `backup`. Plain HTTP on the
LAN, no reverse proxy.

---

## 5. Verification summary

`pnpm -r --workspace-concurrency=1 test`, **2026-08-31** (previous revision's
figures in the last column, for the delta this round actually bought):

| Package | Test files | Tests | was (2026-08-29) |
| --- | --- | --- | --- |
| `@safehouse/contracts` | 7 | 52 | 7 / 52 |
| `@safehouse/db` | 4 | 34 | 4 / 34 |
| `@safehouse/rules` | 12 | 191 | 11 / 175 |
| `@safehouse/server` | 52 | 723 (720 passed, 3 skipped) | 48 / 634 |
| `@safehouse/web` | 67 | 1034 | 57 / 841 |
| **Total** | **142** | **2031 passed, 3 skipped, 0 failed** | 127 / 1733 |

**+298 tests and +15 test files this round.** The web additions are the ones that
matter for §1: `gm/party/roster.test.ts` (25) and `party.test.tsx` (14),
`gm/scenes/sceneManager.test.tsx` (24), `codex/ai/ai.test.tsx` (29),
`components/shell/navigation.test.tsx` (20), `gm/books/booksShelf.test.tsx` (18)
and `calibration.test.ts` (24), `gm/generator/coldstart.test.tsx` (18) and
`starters.test.ts` (17). **`navigation.test.tsx` is the structural one**: it walks
`routes` and asserts that every path the GM rail and the phone nav offer resolves
to a real element rather than the 404 catch-all, that no prep screen renders
placeholder copy, that every empty surface ships a working control, and that the
roster links to each sheet by href. That is UX-1 and UX-2 turned into a tripwire —
about as close as a test file can get to the question only a person can ask.

`pnpm -r --workspace-concurrency=1 typecheck` → exit 0 across all five packages.
`pnpm -r --workspace-concurrency=1 build` → exit 0. Both re-run 2026-08-31, and
the bundle table below was re-measured from that build's own output.

Server tests run against throwaway PGlite instances with migrations applied; no
Docker, no network. The three skips are all environmental and all deliberate:
one in `books-api.test.ts` (the core PDF is absent), and two in
`restore-boot.test.ts` — the PGlite → Postgres move, which needs
`SAFEHOUSE_TEST_DATABASE_URL` and therefore runs in CI's `restore-postgres` job
rather than on a developer laptop (BUILD_CONVENTIONS: never require Docker).

**Bundle against §15.** From the `apps/web` vite build:

| Chunk | Raw | gzip | Budget | was (08-29) |
| --- | --- | --- | --- | --- |
| `index-CtMiSuhY.js` — the entry | 930.49 KB | **273.41 KB** | initial JS < 500 KB gz ✅ | 236.63 |
| `index-B9TZd222.css` | 53.67 KB | 9.99 KB | — | 9.70 |
| `index-C4K1TQ6l.js` — the Grid's lazy chunk (PixiJS) | 339.21 KB | 107.07 KB | Grid chunk < 900 KB gz ✅ | 107.07 |
| Pixi's own runtime splits (WebGL 19.63, WebGPU 13.21, render targets 14.36, `browserAll` 11.28, canvas 5.96, bitmap fonts 4.66, worker 4.75, buffers 2.85) — 8 files | 269.78 KB | 76.70 KB | counted against the same 900 KB | 76.71 |
| the codex tree — `CodexPage` 13.44 (now carrying `ai/`), `RunsBoard` 2.75, `Markdown` 2.17, `CalendarView` 1.72, plus two shared leaves | 69.05 KB | 22.22 KB | codex editor lazy-loaded ✅ | 15.26 |
| `PdfSurface-BpSZdKxb.js` — the reader surface | 6.88 KB | 2.89 KB | — | 2.89 |

Pixi is verified **absent** from the entry chunk (`grep -i pixi` finds nothing in
it and 6 hits in the Grid chunk), which is the condition §15's "no Pixi"
clause attaches to. Worst-case Grid cost is ≈183.8 KB gz against 900. pdf.js is
not in any chunk at all: `pdfjs-dist` is copied to `public/pdfjs/` (`pdf.mjs`
389 KB, `pdf.worker.mjs` 1.4 MB raw) and imported at runtime from our own
origin, costing zero bytes until a ref chip is tapped.

**Every §15 bundle sub-clause is still met in the letter**, and the codex lazy
chunk earned its keep this round: `features/codex/ai/` (the AI panel, its
proposal card and its data layer — about 78 KB of source) landed **inside** the
lazy chunk rather than in the entry, which is why `CodexPage` went 6.35 → 13.44
KB gz while the entry's growth came from elsewhere. The clause was closed
originally by moving `CodexPage` / `RunsBoard` /
`CalendarView` behind `React.lazy` in `router.tsx`; the entry chunk lost
10.7 KB gz for it (247.35 → 236.63). The interesting part is not the bytes but
the tripwire: `src/router.chunks.test.ts` (4) scans every source file and fails
if `features/codex/` is reached from outside itself by anything other than a
dynamic `import()`. That is the way this clause actually regresses — someone
adds one ordinary import of `Markdown.tsx` to the table log, rollup silently
hoists the whole subtree back into the entry, and the suite stays green.

**NFR — roll-to-visible latency (§15).** First measurement in the project's
life. `apps/server/test/latency.test.ts`, 200 serial rolls, six live sockets in
the room (GM + four players + the display), PGlite, loopback, four
`performance.now()` stamps per roll taken in one process so there is no clock
skew:

| Span | n | p50 | p95 | p99 | max |
| --- | --- | --- | --- | --- | --- |
| server received → broadcast | 200 | 2.1 ms | **2.8 ms** | 3.1 ms | 4.3 ms |
| client-visible send → last socket | 200 | 2.5 ms | **3.5 ms** | 5.0 ms | 8.0 ms |
| fan-out spread (first → last socket) | 200 | 0.1 ms | 0.2 ms | 0.3 ms | 0.4 ms |

Against §15's 250 ms LAN / 500 ms WAN budget that is **71× headroom** on the
LAN figure, which is why this one gates in the ordinary suite. The number to
quote is the middle row: it is a strict superset of the server span, WS framing
included. **What it excludes, in the file's own words:** the network (both ends
are on 127.0.0.1 — add the venue's Wi-Fi RTT to everything here, so this is a
floor on real latency and not an estimate of it), the browser (nothing parses
the frame, reconciles a store or paints a die), Postgres, and a busy table. The
instrumentation lives in the test, not in `src/` — the two stamps are taken by
wrapping the registered command handler and the hub's `broadcast` on the live
instance, so no production file carries a timing hook only a test reads.

**NFR — Grid frame budget with 60 tokens (§15 / §17.4).** Also a first.
`apps/web/e2e/perf.spec.ts`, `SAFEHOUSE_PERF=1`, 4× CDP CPU throttle, a
scripted 40×30 m scene with exactly 60 tokens, 8 fog regions (3 revealed), 24
walls, 4 doors and 6 pins, driven on the real `/c/:id/grid` with the real Pixi
renderer and the real socket. **p95 of main-thread cost per frame** — Pixi's
update and ~133 draw submissions plus React — measured over four phases:

| Phase | laptop 1280×720 | phone 390×844 | vs the 33.3 ms floor |
| --- | --- | --- | --- |
| idle | 20.5 ms | 19.8 ms | ✅ |
| pan | 22.8 ms | 22.4 ms | ✅ |
| zoom | 22.3 ms | 21.5 ms | ✅ |
| drag (a token, one `token.drag` per move) | 22.7 ms | 21.5 ms | ✅ |

Camera gestures cost **~1.1× idle**, not an order of magnitude — which is the
assertion most likely to catch a real regression, because it is the one that
would trip if a pan started re-tessellating the grid, fog or geometry.
`stage/index.ts` has claimed content-hashed layer redraws since it was written;
until now nothing tested the claim.

**The wall-clock frame interval, by contrast, misses the floor in headless, and
the harness proves why rather than arguing it.** Before staging anything, the
same sampler runs for two seconds on an empty page in the same browser at the
same viewport under the same throttle: it comes back at a flat 60 fps
(interval p95 16.7 ms) with 2.0–2.2 ms of sampler lag, so the pipeline is
capable and the sampler is free. Against that control the Grid's interval p95
is 66.7 ms on the laptop canvas and 33.4 ms on the phone canvas — ~2× worse on
~2.5× the pixels with an *identical* draw count (132–134 per frame either way),
which is the signature of fill rate, not of the app. In headless chromium that
fill rate is SwiftShader painting the WebGL surface on the CPU. Asserting it
would assert a property of the runner's software rasteriser, be red on every
machine forever, and be switched off inside a week. So the honest reading is:
**the Grid holds §15's floor on the cost this repo owns, and misses it on wall
clock in headless, where the deficit is rasterisation.** One caveat on the
asserted number, since it is the one that will be quoted — "main-thread cost"
includes time the main thread spends *blocked inside* a WebGL call, so with a
software rasteriser underneath it is an upper bound on real main-thread work
rather than an estimate of it. That makes the assertion conservative, which is
the right direction for a floor.

Four ways a frame harness lies, each closed in the file: a WebGL draw-call
counter installed before the page's own scripts (a renderer that stopped
drawing would still tick at 60 Hz and look perfect); a `MIN_FRAMES_PER_PHASE`
floor of 30 intervals (a three-frame sample has a meaningless p95); the dragged
token parked at the exact map centre at 3×3 with the server's record read back
afterwards (a drag that missed its token is just a pan); and a hard failure if
the empty-page control cannot hold 30 fps (a machine too loaded to measure
anything should not be allowed to blame the Grid). **What it does not measure:**
a real GPU, a real display's vsync, a real device (the CPU throttle moves these
numbers by ~2 ms between 1× and 4×, because the bottleneck is not on the main
thread), the network, or a table with a second GM authoring underneath.

**Browser E2E** — `pnpm --filter @safehouse/web e2e`, chromium, **38 passed, 2
skipped**, 42.4 s, one worker against one shared live table:

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
| `recap.spec.ts` | 3 | FR12.12 — the Fixer drafts one and the session is untouched; **the spoiler-guard warning is on the card the GM accepts from** (FR12.19, formerly the suite's one `test.fail`); accepting applies it and publishing is a separate confirmed tap |
| `secrecy.spec.ts` | 4 | Principle 4 in the browser: log, tracker, grid and the raw payloads behind them |
| `tv.spec.ts` | 3 | FR9.20 map stage + ribbon; a rebooted TV returns to the scene; the kiosk holds no GM-only state |
| `perf.spec.ts` | 2, skipped | the §15 / §17.4 frame budget on a laptop and a phone canvas. Runs only under `SAFEHOUSE_PERF=1`; its output is above |

**Scripted playthrough** — `pnpm playthrough`, report at
`docs/demo/SESSION_REPORT.md`:

- **266 checks: 265 passed, 0 failed, 1 not applicable** (2026-08-31; the last
  revision ran 267/267 — the total moves by one or two because a few assertions
  are conditional on the night's dice).
- **It is still an API-and-socket harness and it always will be**, which is worth
  saying next to §1: the playthrough plays a whole session and would have been
  perfectly green through UX-1, UX-2 and UX-3, because it never needs a link to
  exist in order to reach a screen. It proves the machine underneath the job, not
  the job.
- Boots the real Fastify app on a loopback port against a fresh PGlite database,
  seeds SR5 (55 pages indexed) and the demo campaign, then plays a whole session
  from five devices — the GM's laptop, three phones and the TV.
- The one new beat this revision is the check that closed the resolve-chain
  item, and it is a single line: **"…and the faces on the record are the faces
  on the card"** —
  the dice the GM reads out mid-chain are byte-for-byte the dice in the roll
  log. That is G5 stated as an equality rather than as an intention, and it is
  the assertion that would have failed against the old locally-previewing
  dialog.
- Standing beats, unchanged: a summoner's spirit tracked by Force and services
  joining the encounter as a combatant; a bonded focus toggled with its
  provenance following the pool; the reagent tin; a personal macro rack that
  survives a restart; the Fixer drafting the recap through `draft_recap` after
  reading the log, spoiler-scanned (it catches a GM-only name); the usage meter
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
node-postgres · **a `perf` job that prints both §15 numbers on every push and
never blocks a merge** (`continue-on-error`, deliberately: a timing check that
can turn `main` red on a busy afternoon gets switched off within a week, and a
regression is legible as a job that went green → orange with the before and
after in its log) · a multi-arch image build. `LLM_BASE_URL` and
`DISCORD_WEBHOOK_URL` are unset in CI on purpose.

---

## 6. The record

### 6.1 This round — what was reported, what landed, what is still awkward

**This round was not worked from the previous revision's ranked list.** That list
had four entries and the last revision closed with the sentence *"the ranked list
below is short, and three of its four entries are decisions for the table rather
than work for a build agent… the project is in the state where the next genuinely
useful input is a session at the table, not another pass over the source."* That
was correct about the source and wrong about the state, and the next genuinely
useful input arrived exactly as predicted and said something the document had no
row for.

**What the GM reported**, verbatim: *"The UX is tough to use. I'm trying to fill
out info in the campaign and there is nowhere to see the player characters. The
scene screen isn't implemented. This is not as complete as represented. I should
be able to use AI to help fill out the codex."*

**Every clause was true, and this document said otherwise.** The three findings
are written up as UX-1, UX-2 and UX-3 in §3; in short:

| Reported | What was actually there | What this report said |
| --- | --- | --- |
| "nowhere to see the player characters" | No roster anywhere. The only two links to `/sheet/:characterId` were gated on the device's *own* character, and a GM owns none — so the count of sheets a GM could reach was **zero** and the workaround was pasting a UUID. | M3 read as shipped — FR3.1, 3.3–3.6 and 3.8 all `done`, and no FR anywhere covered "a GM can reach a sheet" |
| "the scene screen isn't implemented" | A 24-line placeholder card, offered **twice** (sidebar + console chips), whose own docblock admitted the route was the bug and argued the fix was to delete the link rather than build the screen. | FR9.1 `done` |
| "I should be able to use AI to help fill out the codex" | `grep -niE "fixer\|draft\|generate\|ai" features/codex/PageView.tsx` → nothing. The capability existed as `draft_wiki_page`, reachable only by leaving the page for the Fixer chat and hunting a drafts inbox. Expanding an existing page was **impossible**: accepting produced a duplicate. | FR12.7 `done` |

**What landed** (files, not claims):

| Job | What was built | Tests |
| --- | --- | --- |
| see the party | `features/gm/party/` (`PartyPage`, `PartyRoster`, `PartyRow`, `roster.ts`, `api.ts`) + `features/gm/home/` (`GmHome`, `PartyPanel`, `SetupChecklist`, `AddCharacter`, `api.ts`) | `roster.test.ts` (25), `party.test.tsx` (14) |
| find anything at all | `components/shell/gmNav.ts` — one ordered `GM_NAV` + `PLAYER_NAV`, rendered by both `GmSidebar` and the console home; `routes.tsx` split out of `router.tsx` so the table is importable without a DOM | `navigation.test.tsx` (20) |
| build a scene | `features/gm/ScenesPage.tsx` rewritten as a manager + `features/gm/scenes/` (`CreateSceneForm`, `SceneCard`, `EnvironmentEditor`, `summary.ts`, `api.ts`) | `sceneManager.test.tsx` (24) |
| write a codex page with AI | `features/codex/ai/` (`AiPanel`, `NewPagePrompt`, `ProposalCard`, `lib.ts`, `api.ts`), wired into `PageView.tsx:341` and `PageBrowser.tsx:228` | `ai.test.tsx` (29) |
| get a character into the app | `home/AddCharacter.tsx` — blank sheet **or** `.chum5`, the first caller `POST /api/characters` has ever had from a browser | in `party.test.tsx` / `navigation.test.tsx` |
| bind a sheet to a phone | owner picker on the roster (`PATCH /api/characters/:id/owner`), plus a `no-character-note` on `CampaignHome` telling an unbound player exactly what to ask for | `navigation.test.tsx` |
| let a player reach the rulebook | `features/library/LibraryPage.tsx` at `/c/:id/books`, role-aware, on `PLAYER_NAV` | `booksShelf.test.tsx` (18) |
| pair the TV without confusion | `GmSidebar` "Table display" section: *Pair the TV* (display-role QR) and *Preview kiosk ↗*, replacing a "TV view ↗" that landed the GM's own laptop on a kiosk it counted as bound | `navigation.test.tsx` |
| start the Opposition Kit from nothing | `generator/StarterLibrary.tsx` + `starters.ts` (original content, §14) | `coldstart.test.tsx` (18), `starters.test.ts` (17) |

**What is still awkward, stated plainly** — the honest half:

1. **Job 5 did not move at all.** No encounter picker, no `PATCH`/`DELETE
   /api/encounters/:id` caller, no add-combatant UI, no roll-initiative UI, and
   the start button is still called "New turn". `useEncounterList` is still
   exported and consumed by nothing. This is the one job a GM cannot finish and
   it is Friday night's main event.
2. **The three new surfaces have no browser spec.** The E2E suite is unchanged at
   14 files. A spec that walks the rail, opens the roster, follows a row into a
   sheet and back is the harness that would keep UX-1 shut.
3. **The generator's warts survive** — result card lost on tab switch, save always
   inserting, disabled stage button with no reason. The second of these is what
   manufactures the duplicate encounters job 5 cannot pick between.
4. **No book search UI** (FR12.14), **no bookmarks UI at all** (FR11.6), and the
   sheet still ships its own `target="_blank"` ref chip alongside the in-place one.
5. **Re-import, rollback and transfer-ownership** still have no callers; NPC
   in-character conversation (FR12.6) still has no chat surface.

### 6.2 The previous gap list, resolved

Every item from the last revision's ranked list, with what closed it, verified by
reading the code rather than by taking the claim. **Four of the five are closed in
code. The fifth was never a code item**: the Matrix tab is a decision the table
has not made, it stays deferred, and it carries forward to §7 unchanged rather
than being quietly retired here.

| # | Item | State | What closed it |
| --- | --- | --- | --- |
| 1 | The spoiler-guard warning never reached the GM's eyes (FR12.19) | **closed** | `apps/web/src/features/gm/fixer/api.ts` — `spoilerFlagsOf()` now normalises the `{name, why}` objects the server actually sends, keeps the legacy string form, and still looks inside `output`; `DraftsInbox.tsx` renders the warning panel on the card the GM accepts from. `spoilerFlags.test.ts` (5) pins all four shapes including malformed entries. `e2e/recap.spec.ts:234` lost its `test.fail` marker and passes on its own terms. **Fixed by hand, outside the swarm.** |
| 2 | The last 14 non-atomic emits | **closed** | The 13 that could be were converted (`plugins/characters.ts`, `codex.ts`, `generator.ts`, `campaigns-admin.ts`, `services/rolls-edge.ts`, `magic-store.ts`, `rolls.ts`'s `postLog` fallback arm). **Exactly one bare `hub.emit` remains in the whole server** — `plugins/scenes.ts:730`, `display.set`, an audited exemption with no domain row to be inconsistent with, named as such in its own docblock. `core-atomicity-emits.test.ts` (22) blocks each converted path's event type with a real CHECK constraint and asserts both halves; its last two tests scan `src/` and allow that one call by file and by name. |
| 3 | The resolve-chain dialog previewed with browser dice (FR10.8 / G5) | **closed** | `web/features/table/resolveChain.ts` posts to `POST /api/encounters/:id/resolve-chain` and reads every face off the response; `ResolveChainDialog.tsx` renders it. There is **no local fallback in the feature at all** — an unreachable endpoint draws no dice rather than browser ones. `resolveChain.test.tsx` (22) includes a source-level assertion that `resolveAttackChain` is not imported here, and the playthrough adds the equality that matters: "the faces on the record are the faces on the card". |
| 4 | A Matrix tab, if and only if someone rolls a decker | **open, and correctly so** | Unchanged and deliberately unbuilt (Q3). `SHEET_TABS` has seven tabs and no Matrix; `get_matrix_state` still answers `tracked: false` with a note rather than a zero. This is the one FR row whose status is set by a table decision. |
| 5a | Lazy-load `features/codex/` (§15's letter) | **closed** | `router.tsx` puts `CodexPage` / `RunsBoard` / `CalendarView` behind `React.lazy`; the entry chunk dropped 247.35 → **236.63 KB gz**. `src/router.chunks.test.ts` (4) is the tripwire: `features/codex/` may be reached from outside itself only through a dynamic `import()`. |
| 5b | The stale "spirit services not built" comment | **closed** | `apps/server/src/fixer/state-codex.ts` now says the opposite, and says why: spirit services *used* to be on the not-tracked list and no longer are, because `state-play.ts` returns `tracked: true` from the real tracker. |
| 5c | The two §15 NFRs nothing measured | **closed — and these are the first real numbers for either** | `apps/server/test/latency.test.ts` (4): roll-to-visible **p95 3.5 ms** over 200 rolls with six sockets, 71× inside the 250 ms LAN budget, gating in the ordinary suite. `apps/web/e2e/perf.spec.ts` (2) + `features/grid/perf/frames.ts` (24 tests) + `perf/scene.ts` (16 tests): **main-thread p95 19.8–22.8 ms** with 60 tokens and fog on laptop and phone canvases, inside the 33.3 ms floor, with camera gestures at ~1.1× idle. Both tabulated in §5, both honest about what they exclude. |

And the four browser/terminal findings from §3, unchanged since they closed:

| # | Defect | State | Evidence |
| --- | --- | --- | --- |
| L1 | The web UI never backfilled state on mount | **closed** | `live/hydrate.ts` at the `useLiveConnection` chokepoint; 39 unit tests + `e2e/hydration.spec.ts` (4). |
| L2 | Scene environment modifier applied twice | **closed** | `features/sheet/rollDialogState.ts`; `rollDialogState.test.ts` (18), `e2e/pool-parity.spec.ts` (2). |
| L3 | `/join/:code` served JSON to a scanning player | **closed** | One path, one owner, enforced in four places; `e2e/join.spec.ts` (6). |
| L4 | Event log frozen on a seeded database | **closed** | Sequence guard + `Hub.atomic` + `DbError` surfacing + clean shutdown everywhere, now with both real restore paths under test. `seeded-boot.test.ts` (10), `restore-boot.test.ts` (19), `durability.test.ts`, `core-atomicity.test.ts` (9), `core-atomicity-domains.test.ts` (19), `core-atomicity-emits.test.ts` (22), `core-shutdown.test.ts` (8), `seed-durability.test.ts` (1), `e2e/log-append.spec.ts` (2). |

**Deferred by design and not defects:** the Matrix toolkit (M7, Q3 — no decker
at the table) and with it the sheet's Matrix tab, token vision and dynamic
lighting (FR9.16, Q9), the Matrix overlay (FR9.17), native priority char-gen
(FR3.9, D5), the advancement editor (FR3.7), stagecraft audio (FR12.10 /
FR9.18), the prop/tile stamp library (FR9.2's P3+ half), the image-gen adapter,
the PWA offline cache, and campaign export. The full list with its reasons is
§7, item 3; none of it is work anyone should start unsolicited.

---

## 7. What is still worth doing

**Something on this list is a defect again, and that is the finding.** The last
revision opened this section with "nothing on this list is a defect" and closed
it with "the next genuinely useful input is a session at the table". Both
sentences were written from a reading of the source. A GM then sat down at the
table and found three things the source could not have told anyone, so the
opening sentence was wrong and the closing one was right for the wrong reason.
This revision's list is therefore ordered by **what stops a GM finishing a job**,
and only then by everything else.

Ranked by the order in which they would actually matter:

1. **Give the tracker an encounter list, and rename the button that starts a
   fight. (§1 job 5 · FR4.1 · FR4.3.)** The only job on the grade that cannot be
   completed, and the one the whole app exists for. It is additive and touches
   nothing load-bearing: a strip across the top of `Tracker.tsx` fed by the
   already-written `useEncounterList` (name · state · linked scene · body count ·
   select / go live / end), and "New turn" reading "Start fight" while
   `turn === 0`. `PATCH`/`DELETE /api/encounters/:id`, `POST …/combatants` and
   `POST …/roll-initiative` are all built, tested and uncalled. Neither change
   goes near G5 or the damage path. **Fix `EncounterBuilder`'s
   save-always-inserts wart in the same pass** — it is what manufactures the
   duplicate encounters the picker would be picking between, and it is a two-line
   change (`savedId ? PATCH : POST`).
2. **A browser spec for the three surfaces this round built.** The E2E suite did
   not grow: 14 spec files before, 14 after. The party roster, the scene manager
   and the codex AI panel are covered by unit tests that render to static markup
   in a package with no DOM, and by `navigation.test.tsx`, which is a good
   structural tripwire and still not the same thing as a browser opening the
   rail, clicking Party, following a row into a sheet and coming back. One spec —
   `wayfinding.spec.ts` — closes UX-1 and UX-2 the way `hydration.spec.ts` closed
   LIVE-1. Note the honest limit while writing it: it will pin the doors that now
   exist and would not have found their absence.
3. **A search box on the library. (FR12.14 · FR11.6.)** `GET /api/books/search`
   is full-text over `book_pages`, works, is tested, and has exactly one consumer
   in the repo: the Fixer's `search_books` tool. So a GM **without** a local
   inference box cannot search the rules at all, which is the opposite of the
   dependency order this project chose everywhere else — the AI is meant to be
   the accelerant, never the only path (NG7). The same screen should render
   `bookmarks` and `library/recent`, which today have no UI whatsoever. While
   there: delete the sheet's private `RefChip`
   (`features/sheet/components/ui.tsx:167`, an `<a target="_blank">`) and import
   the in-place overlay from `features/gm`, so a chip tapped on a phone mid-fight
   does not throw the player out of their sheet.
4. **The remaining uncalled routes, in one honest sweep.** Not urgent, but they
   are the same defect as UX-1 in smaller print, and listing them is cheaper than
   rediscovering them: re-import and its diff (`POST /api/characters/:id/import`
   onto an existing sheet), revisions and rollback (FR3.8), campaign
   transfer-ownership (FR1.2), NPC in-character conversation (FR12.6), and
   `POST /api/books` so registering a rulebook stops being a stop-the-server CLI
   step (FR11.1). Each is a control on a screen that already exists.
5. **The Matrix tab, if and only if someone rolls a decker (FR3.2 / M7).** The
   single FR row at `partial`, and the only one whose status is set by a table
   decision instead of by us. Q3 says there is no decker; `SHEET_TABS` has seven
   tabs and no Matrix; `get_matrix_state` answers `tracked: false` with a note so
   nothing invents an Overwatch score in the meantime. If a player rolls a
   decker, this becomes real work (FR7.1–7.6 plus the tab). Until then, building
   it would be the most expensive way to make one table in this document read
   `done`.
6. **Measure the NFRs once on real hardware.** Both harnesses are honest about
   being floors rather than estimates, and both gaps are the same shape: the
   roll-latency figure (p95 3.5 ms) is loopback, so the venue's Wi-Fi RTT is
   simply not in it; the Grid's wall-clock frame interval misses the 30 fps
   floor in headless because SwiftShader rasterises the WebGL surface on the
   CPU. Neither can be closed by more test code — the honest close is one
   evening: run the GM's laptop and a player's phone on the actual AP, with the
   actual scene, and write the two numbers down beside these. That converts
   "inside budget on the cost this repo owns" into "inside budget", which is
   what §15 actually claims. The same evening settles the one §15 clause that
   still has no measurement of any kind: "other clients see interim motion
   ≤ 200 ms behind; final position authoritative < 500 ms" for a token drag.
   `token.drag` (ephemeral) and `token.move` (authoritative) are both
   contracted, tested for *correctness*, and exercised by the frame harness's
   drag phase — but nobody has ever timed the gap between the two devices,
   because timing it needs two devices.
7. **The rest of P6, when the table asks.** Deferred by design and not defects:
   the Matrix toolkit (M7, Q3), token vision and dynamic lighting (FR9.16, Q9 —
   manual fog is the permanent plan, not a placeholder), the Matrix overlay
   (FR9.17), native priority char-gen (FR3.9, D5 — Chummer is the builder), the
   advancement editor (FR3.7), stagecraft audio (FR12.10 / FR9.18), the
   prop/tile stamp library (FR9.2's P3+ half), the image-gen adapter, the PWA
   offline cache, and campaign export. Each stays unbuilt until someone at the
   table wants it, which is the only signal worth building on.
8. **Taste.** Three standing notes that are correct today and worth re-reading if
   the code around them moves: the single audited bare `hub.emit`
   (`plugins/scenes.ts:730` — `display.set` has no domain row, and the docblock
   says the day a `display_state` row appears it becomes an `atomic` block); the
   three environmental test skips (one PDF the repo does not ship, two that need
   a real Postgres and run in CI's own job); and the entry chunk's growth this
   round (236.63 → 273.41 KB gz, 55% of the §15 budget) — comfortable, and the
   first revision where the direction is worth a glance.

**Housekeeping the last revision claimed and this one corrects.** The previous
§6 said a grep for `TODO`, `FIXME` and `// INTEGRATION:` across `apps/*/src`,
`packages/*/src`, both test trees and `e2e/` "returns nothing". It now returns
**four hits, and none is a `TODO` or a `FIXME`** — all four are `// INTEGRATION:`
cross-reference notes: `generator/api.ts:241` (the threat readout is computed
locally; see FR10.5), `home/SetupChecklist.tsx:87` (a docblock recording that it
*closed* an earlier note), `rules/src/combat/roll.ts:3` (why the combat module
keeps its own pure roller), and `rules/src/generator/generate.ts:200` (an
unresolved loadout option falls back to a named slot). Only the first and last
describe work; both are small and neither costs anything at the table. There is
still no `test.fail` marker in any suite — the string survives only in
`recap.spec.ts`'s docblock recording that it came off — and the only skips are
the three environmental ones in §5 and the two perf specs behind
`SAFEHOUSE_PERF`.

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

That lesson kept earning through the previous round. The spoiler-guard item — the
last one with a cost at the table then — was found the same way the LIVE defects were:
not by a failing assertion, but by reading what the GM's screen actually renders
and noticing that a guarantee the server keeps perfectly never arrived anywhere
a human could see it. The root cause is worth one sentence, because it is a
mechanism and not an accident: the client's own type declared `spoilerFlags` as
`string[]` while the server sent `{name, why}` objects, so a filter that
discarded every real flag typechecked, read correctly, and was wrong. **A lying
type makes a wrong filter look right**, and no amount of strictness helps when
the lie is at the boundary — only a test that pins the shape the wire actually
carries does, which is what `spoilerFlags.test.ts` now is. A guard nobody is
shown is a guard that does not exist.

The two NFR harnesses are the same lesson pointed forward rather than back. Every
Grid test in this repo asserts *what* is drawn — hidden tokens absent, fog
occluding, the acting token glowing — and not one of them asked how long a frame
took, so a change that re-tessellated the fog on every pan could have halved the
framerate at the table with the whole suite green. That is not a seam and not a
state; it is a whole *dimension* nothing measured. It has two numbers in it now.

**And the lesson this round added, which is the one to keep if only one
survives.** LIVE-1 through LIVE-4 were found by driving the app *as a machine*.
UX-1 through UX-3 were found by a human trying to prep a session, and **no
automated harness would ever have flagged them, because every one is a missing
entry point rather than a broken behaviour.** Nothing returned a wrong answer.
The roster endpoint served all three PCs to a GM; the placeholder rendered its
own string; `draft_wiki_page` produced a correct draft the playthrough asserted.
A test compares an outcome against an expectation, and a door that does not exist
produces no outcome to compare. That is why this document now opens with §1 and
why §1 is written as *jobs* rather than as routes: it is the only part of the
report that can be wrong in the direction the user was complaining about.

The mechanism behind all three is worth one sentence, because it is a mechanism
and not an accident: **this report graded capability and called it completeness,
and every layer above it inherited the error** — an FR row said `done` because the
server was, a phase said Done because its FR rows did, and the Roll20 checklist
said "shipped" because the phase did. Three inferences, each individually
reasonable, stacked into "this is not as complete as represented". The fix is
structural rather than editorial: `done` now requires a named screen, `done ·
thin surface` exists as a word, phase state is the weakest of (capability,
surface) rather than the strongest, and the headline grade is a table of things a
person does on a Friday night.
