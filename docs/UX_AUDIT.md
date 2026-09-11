# UX audit — can a GM actually do the job?

**Method.** The app was booted for real (`kill node` → wipe `apps/server/data` → `pnpm seed:demo`
(exited) → `pnpm seed:books -- --only SR5 --max-pages 40` → `pnpm dev:server` + `pnpm dev:web`) and
driven in a browser as **GM**, as a **player on a 375×812 phone**, and as the **table display**,
using the seeded demo campaign's own printed join codes and device tokens. Everything below marked
"walked" was clicked. Everything marked "read" was established from source, and says so.

**The bar.** Not "does the endpoint exist" and not "do the tests pass". The bar is: *a GM sits down
on Friday night and finishes the task without knowing a UUID, reading the source, or being told
where the feature secretly lives.* `docs/BUILD_REPORT.md` graded server code and this document was
written to grade jobs instead. **That split is now closed from the other side**: the build report
opens with §1 "Can a GM actually do the job?", a nine-row summary of this table, and its FR rows
carry a `done · thin surface` status for capabilities with no GM-facing entry point. §1 is the
summary; this file is the walk-through, the evidence and the file paths behind each verdict.

**Snapshot warning.** Other agents were landing changes during the original pass (`git status` showed
live edits under `features/gm/books/` and `features/gm/generator/`). Findings for tasks 4 and 6 were
already moving as they were written.

**Headline (as found).** The engine underneath this app is genuinely good — server-authoritative dice
with full provenance, wound modifiers that propagate into pools in front of you, party-aware threat
math, server-side fog secrecy that holds up when you inspect the wire. What is missing is almost
entirely *doors*: the roster has no screen, the character pipeline has no screen, the encounter list
has no screen, book search has no screen, and the codex has no AI button. Five of the nine jobs
cannot be completed.

---

## Verdicts — as found, and now

**Re-verified 2026-08-31** against the working tree, by reading the code each verdict names rather
than by taking a claim. Every "now" cell below is followed, in that task's section, by a
`**NOW (2026-08-31).**` paragraph naming the files that moved it. Where nothing moved, the task says
so and keeps its original verdict.

| # | Task | As found | Now | Route a GM actually takes |
|---|---|---|---|---|
| 1 | See the party, open a sheet | **cannot-complete** | **works** | sidebar → Campaign → **Party** (`/c/:id/gm/party`) |
| 2 | Create a scene, map, fog, activate | works-but-awkward (advertised route is a dead end) | **works** | sidebar → **Scenes** (`/c/:id/gm/scenes`); Grid for the drawing |
| 3 | Write a codex page with AI help | **cannot-complete** | **works** | Codex → open a page → **AI panel** beside it |
| 4 | Prep opposition | works (with warts) | works-but-awkward | sidebar → **Generator** — warts 1–3 all stand |
| 5 | Run a fight | **cannot-complete** (wrong fight, no picker) | **cannot-complete** | unchanged — no encounter picker exists |
| 6 | Look up a rule / show a player | works-but-awkward (GM) · **cannot-complete** (player) | works-but-awkward (both) | **Books** on both navs; still no search, still no push-to-table |
| 7 | End a session: karma, recap | works | works | sidebar → **Sessions**; awards now also on the Party roster |
| 8 | Onboard from nothing | **cannot-complete** | **works** | Party → **add / import .chum5**, then assign the row to a joined device |
| 9 | Player on a phone | works — *once* a sheet is bound (see 8) | **works** | binding is now a GM click; ref chips still open a new tab |

Six of the nine were closed by giving an existing capability a door. **Task 5 is untouched** and is
the one job a GM still cannot finish; task 4's warts are what make it worse, because saving an
encounter twice is how you end up with two identically named fights and no way to pick between them.

---

## 1. See the party — every PC, condition, Edge, key pools — and open one sheet

**VERDICT: cannot-complete.** → **NOW: works.**

**NOW (2026-08-31).** `/c/:campaignId/gm/party` exists (`features/gm/party/PartyPage.tsx` +
`PartyRoster.tsx` + `PartyRow.tsx` + `roster.ts`), and the GM sidebar's first section names it —
`gmNav.ts` `GM_NAV` is now one ordered list rendered by both `GmSidebar` and the console home, so a
screen cannot be in one and invisible in the other. The roster reads
`GET /api/campaigns/:id/characters` on mount and fans out to `/derived` per row, marking rows still
waiting `est` rather than pretending (Principle 3). Each row links to `/c/:id/sheet/:characterId` by
href — **the UUID is never typed**. The rows also carry the numbers the audit said the GM had to
build an encounter to see (condition monitors, wound modifier, Edge, defence, soak, karma/nuyen), and
apply damage and awards through the same routes the sheet uses. The console home keeps a compact
`home/PartyPanel.tsx` and links here. Covered by `party/roster.test.ts` (25),
`party/party.test.tsx` (14) and `components/shell/navigation.test.tsx` (20). **No browser E2E spec
walks it yet** — see the remainder list in `BUILD_REPORT.md` §7.

**Walked.** Signed in as GM, went to `/c/:id/gm`. The console shows Campaign settings, Invites & join
QR, Pair a GM device, and Devices. No roster. The sidebar (`Overview · Table log · Grid · Codex ·
Calendar · GM home · Runs · Scenes · Generator · Fixer · Books · Sessions · TV view`) has no party
entry. `/c/:id` (Overview) offers Table / Grid / Codex / Calendar / GM console — no Sheet card,
because the GM device owns no character.

**Where it breaks.** The only two links to `/sheet/:characterId` in the entire web app are:

- `apps/web/src/components/shell/BottomNav.tsx:20` — `characterId ? …` , and
- `apps/web/src/components/shell/CampaignHome.tsx:26` — inside `{myCharacterId && …}`

Both are gated on `useMyCharacterId` (`apps/web/src/api/campaigns.ts:67`), which resolves *this
device's own* character by `ownerUserId === session.userId`. A GM owns none, so for a GM the count of
reachable sheets is zero. There is no roster list, no search, no token→sheet jump. The GM must paste
a UUID into the address bar.

The data is right there: `GET /api/campaigns/:id/characters` returns all three PCs with full sheets
to a GM (verified live), and `useCharacters(campaignId)` already exists at
`apps/web/src/features/grid/api.ts:87` — used today only to populate the Grid's token placer and the
Sessions attendance chips. The attendance chips (`features/gm/sessions/SessionList.tsx:39`) render
`Torque / Whisper / Sparrow` as *toggle buttons*, not links.

The single GM surface that shows real party numbers is the Opposition Kit's threat readout —
`Torque DEF 8 · SOAK 12 · 11 BOXES`, `Whisper …`, `Sparrow …` — and you can only see it by building
an encounter first.

**Smallest fix.** A "Party" panel on `GmHome.tsx` (and a sidebar entry) that maps
`useCharacters(campaignId)` to rows linking to `/c/${campaignId}/sheet/${c.id}`, each showing name,
metatype, condition monitors and Edge. The hook, the route and the sheet all exist; this is a list
and a `<Link>`. Reading condition/Edge live means `GET /api/characters/:id/derived` per row, or
adding a roster projection — either is small next to the value.

---

## 2. Create a scene, upload a map, define fog regions, activate it

**VERDICT: works-but-awkward.** The feature is real and good. The route the app advertises is a dead
end. → **NOW: works.**

**NOW (2026-08-31).** `ScenesPage.tsx` is a real scene manager (331 lines, plus
`features/gm/scenes/{CreateSceneForm,SceneCard,EnvironmentEditor,api,summary}.ts[x]`): inventory with
a live badge, create, duplicate, rename, archive, delete, **activate for the table**, the environment
dials (FR9.11) and staged fog reveals (FR9.14). The smallest fix this audit proposed — delete the
route and redirect to the Grid — was **not** the fix taken, and the file's own docblock argues why:
the Grid panel is an in-canvas drawing tool that does the *list* badly, and a GM prepping Friday is
doing list work. The division of labour is now written on the cards themselves (here: inventory,
activation, environment, reveals; Grid: walls, doors, pins, painting fog, tokens, calibration).
Hydration is a REST read on mount; live events only invalidate it (LIVE-1). `sceneManager.test.tsx`
(24). No E2E spec.

**Walked.** `/c/:id/gm/scenes` (`apps/web/src/features/gm/ScenesPage.tsx`) renders a 24-line card:

> Scenes — Placeholder — scene authoring, activation, fog regions land here.

No link out. Nothing tells the GM the feature exists elsewhere. It is offered **twice**: the sidebar
(`components/shell/GmSidebar.tsx:57`) and the GM home tool chips (`features/gm/GmHome.tsx`
`TOOL_LINKS`). The file's own docblock admits the route is the bug and asks a reader not to build a
second authoring UI here — but a GM does not read docblocks, and the link is still on the screen.
This is exactly the "scene screen isn't implemented" the user reported.

**The real thing, walked, at `/c/:id/grid`:** a GM panel with tabs *Scenes · Map · Tokens · Geo ·
Pins · Fog · Env · TV*.

- **Scenes** — list with a live badge, activate, and a name field + Create.
- **Map** — thumbnail, Upload image, Adjust/Remove, and calibration (columns, rows, metres, offset
  X/Y, opacity) with a live `30×20 squares = 30×20 m` readout.
- **Fog** — regions listed with per-region Reveal/Hide, "announce reveals in the log", and a
  Define region tool ("click vertices on the map", save polygon / save rect).
- **Env** — light/visibility/glare/wind dials with `RESULTING MODIFIER −1` and
  `environment: light 1 → light (−1)` — "applies to every roll while this scene is active".
  Confirmed downstream: that exact line later appeared inside a player's roll breakdown.
- **TV** — blank the table, initiative ribbon on/off, focus here, pointer trail.

**Smallest fix.** Delete `ScenesPage.tsx` and its route, and point the sidebar's "Scenes" entry (and
GmHome's `scenes` chip) at `/c/:id/grid`. If the address must survive, make `/gm/scenes` a
`<Navigate to="../grid" replace />`.

---

## 3. Write a codex page WITH AI HELP — draft it, expand a stub, turn a session log into lore

**VERDICT: cannot-complete** as a codex action. → **NOW: works.**

**NOW (2026-08-31).** `features/codex/ai/` is the door: `AiPanel.tsx` renders beside the page
(`PageView.tsx:341`, GM-only) with four actions — *draft with the Fixer · expand · summarise the log ·
suggest links* (`ai/lib.ts` `CODEX_AI_ACTIONS`) — and `NewPagePrompt.tsx` sits in the browser
(`PageBrowser.tsx:228`) so an empty codex can be started from a title. Principle 8 is intact and
visibly so: nothing applies itself, every result is a `ProposalCard` the GM accepts, edits or
rejects, and the panel hydrates the campaign's pending `wiki_page` drafts on mount so a draft asked
for from the Fixer chat is waiting on the page it belongs to. With `LLM_BASE_URL` unset the buttons
stay on screen **disabled with the reason and a link**, rather than vanishing — a deliberate
departure from `FixerDock`'s `return null`, on the grounds that a GM should learn the feature exists
and is asleep (NG7). **"Expand a stub" is solved a different way than this audit proposed:** rather
than teaching `applyWikiDraft` an update branch, an accepted expansion goes out as
`PATCH /api/wiki/:id` (`ai/api.ts:240` `useApplyToPage`) and the generation row is closed; an edited
draft is never written back as the model's own text. `applyWikiDraft` (`fixer/drafts.ts:245`) still
only inserts, and that is now correct — it is the "accept as a new page" path.
`codex/ai/ai.test.tsx` (29). No E2E spec.

**Walked.** `/c/:id/codex`. Empty state reads "Nothing in the codex yet." with a New page form
(title + kind + Add) — acceptable, though creating a page does not select it; the right pane still
says "Pick a page". Created *Rusted Halo*, opened it: `GM ONLY · EDIT · REVEAL TO TABLE`, plus
Section visibility, Backlinks, Handouts, Delete. Clicked **Edit**: title, kind, tags and a bare
markdown `<textarea>`. No "draft this", no "expand", no "summarise the log", no AI anything —
matching `grep -niE "fixer|draft|generate|ai" features/codex/PageView.tsx` returning nothing.

**The only path that exists.** Sidebar → Fixer (`/c/:id/gm/fixer`) → type a request in prose → hope
the model picks the `draft_wiki_page` tool (`apps/server/src/fixer/tools.ts:238`) → switch to the
Drafts inbox on the right → accept. The Fixer page's own empty states are honest and good ("The
Fixer is offline… point `LLM_BASE_URL` at the inference box"; "No drafts waiting. Ask the Fixer for
an NPC, a recap, or a codex page and it lands here."). But the affordance lives two screens away
from the writing, and it is *conversational*, not a button on the thing you are editing.

**"Expand a stub" is not merely missing — it is impossible.** Read
`apps/server/src/fixer/drafts.ts:245` `applyWikiDraft`: accepting a `wiki_page` draft always does
`db.insert(wikiPages)`. There is no update branch and the draft carries no page target. Asking the
Fixer to flesh out an existing page and accepting the result gives you a **second page with the same
title**, not a filled-in stub.

**Note for whoever fixes it.** `FixerDock.tsx` returns `null` when `aiDisabledFrom(...)` is true, so
the Fixer chip vanishes entirely with no LLM configured (correct per NG7). A codex AI button must
degrade the same way, or a GM with AI off gets a button that does nothing.

**Smallest fix.** In `PageView.tsx` edit mode, a "Draft with the Fixer" / "Expand this page" control
that (a) is hidden when `useFixerStatus()` reports AI off, (b) POSTs to `/api/fixer/chat` with the
page title, kind and current body plus a target of `{ type: 'wiki_page', id }`, and (c) shows the
returned draft inline for accept/edit/reject — same accept/reject mutations the inbox already uses,
so Principle 8 is preserved untouched. Then teach `applyWikiDraft` to `update` when the generation
row names an existing page.

---

## 4. Prep opposition: build an archetype, generate a squad, check it against the party, stage it

**VERDICT: works.** The strongest surface in the app. Four warts. → **NOW: works-but-awkward — three
of the four warts are unchanged.**

**NOW (2026-08-31).** What improved is the cold start: `generator/StarterLibrary.tsx` +
`starters.ts` give an empty campaign a shelf of original archetypes to install (G9/D10, §14 —
the catalog is the server's own writing), and `GeneratorWorkspace.tsx` hoists the opposition roster
(`entries`) to page level so it survives a tab switch. `coldstart.test.tsx` (18),
`starters.test.ts` (17). What did **not** change, re-read in the source today:

1. still true — `GeneratePanel.tsx:78–92` owns `seed`/`npc`/`group` in its own state and
   `GeneratorWorkspace.tsx:110` renders the tab conditionally, so switching away unmounts the panel
   and the generated card and its seed are gone;
2. still true — `EncounterBuilder.tsx:88` `save` calls `create.mutate` unconditionally and never
   PATCHes on `savedId`, so a second click is a second encounter. **This is the direct cause of
   finding 5**;
3. still true — `EncounterBuilder.tsx:137` `disabled={stage.isPending || !sceneId}` with no
   explanation of why;
4. partly fixed — a `saved` chip appears, but there is still no staged-combatant count and no link
   to the Grid.

**Walked.** `/c/:id/gm/generator`, tabs *Generate · Encounter + readout · Archetypes*.

- Generate: archetype dropdown, one NPC / grunt group, tier dial (Tag-along / Blooded / Halo
  proper), seed with New seed + Generate + Reroll, and per-aspect locks (stats / metatype / name /
  flavor / loadout). Produced *Freya Dahl* with attributes, INIT `7 + 1d6`, PHYS/STUN, DEFENSE,
  SOAK, limits, skills, weapons & armor, loadout with "picked from the tier's slots", face/persona
  stub. Buttons: **Add to encounter**, **Promote to template**.
- Encounter + readout: named the encounter, linked the scene, saved, and the **threat readout**
  showed party action economy (`3 BODIES · 6 ACTIONS/TURN · top init ~18`) against opposition, then
  attacker→target rows per PC (`Siobhan Doyle · Scrapyard machine pistol · POOL 3 · DV 7P` vs
  `Torque DEF 8 · SOAK 12 · 11 BOXES` → EXPECTED MISS) and the reverse (`Torque · Hammer · POOL 13 ·
  DV 8P` → `~6 boxes`). This is the show-your-work principle done properly.
- **Stage on map** posted `/api/scenes/:id/stage-encounter`; verified via API that the encounter then
  held **9 combatants** — the generated NPC, the three PCs derived from their character tokens, and
  the five hidden `npc_template` tokens.

**Warts (all in `features/gm/GeneratorPage.tsx` / `generator/GeneratePanel.tsx` /
`generator/EncounterBuilder.tsx`):**

1. Switching to the Encounter tab and back **discards the generated result card and mints a new
   seed** (observed: 2590463835 → 3109163064). The GM who goes to check the readout loses the NPC
   they were looking at.
2. **Save encounter always creates a new row.** `savedId` is stored but never used to PATCH. Clicking
   it twice — which is the natural thing to do after picking the linked scene you forgot — left two
   identically named `Pier 23 ambush` encounters (verified via API). That directly causes finding 5.
3. **Stage on map is `disabled={… || !sceneId}`** (`EncounterBuilder.tsx:141`) but looks identical to
   an enabled button in this theme. Clicked it with "— none —" selected: nothing happened, nothing
   was said.
4. No success feedback after a successful stage — no toast, no "9 combatants staged", no link to the
   Grid.

**Smallest fix.** Lift the generated result into the page-level state that already survives the tab
switch; make Save encounter PATCH when `savedId` is set; render the stage button `aria-disabled` with
a "pick a linked scene first" hint; report `staged` count from the 201 response.

---

## 5. Run a fight: launch an encounter, roll initiative, apply damage, use the copilot

**VERDICT: cannot-complete.** Everything *inside* a fight works well. Choosing *which* fight is
impossible, and I got the wrong one on the first honest try. → **NOW: cannot-complete. Nothing here
moved.**

**NOW (2026-08-31).** Re-verified line by line and every clause of this finding still holds.
`useEncounterList` (`features/table/commands.ts:120`) is still exported and still consumed by
nothing — the only other mention of the name in the whole package is a comment in `api/live.ts:23`.
A grep of `apps/web/src` for `api/encounters` returns reads (`GET /api/encounters/:id`), the
generator's `POST /api/encounters/build`, `end-pass`, `new-turn` and `resolve-chain` — **no PATCH, no
DELETE, no `/combatants`, no `/roll-initiative`**. `Tracker.tsx` still shows one encounter chosen for
the GM by `pickLiveEncounter`, and the button that starts a fight is still labelled "New turn". This
is the one job on the list a GM cannot finish, and it is the most expensive one to be unable to
finish, because it is Friday night's main event.

**Walked.** `/c/:id/table` — log left with the dice roller docked under it, tracker and rollable
tables right. The tracker showed `PIER 23 AMBUSH · TURN 1 · PASS 1` with `Back behind screen`,
`Hints off`, `Next ▸`, `End pass`, `New turn`, and a single row: Siobhan Doyle. **The party was not
in it.** The other `Pier 23 ambush` — the one holding all nine combatants — was unreachable. Opening
the copilot's Resolve chain dialog offered `Siobhan Doyle vs Siobhan Doyle` as the only pairing.

**Where it breaks.**

- `pickLiveEncounter` (`apps/web/src/live/merge.ts:368`) takes the first `live`, else the first
  `prep`, else `list[0]`. There is no picker anywhere. `useEncounterList`
  (`features/table/commands.ts:120`) is written, exported, and **consumed by no component**.
- **No UI calls `PATCH /api/encounters/:id`.** Verified by grep across `apps/web/src`. So nothing in
  the app can set an encounter live or done, rename it, relink its scene, or delete it. The only
  live-flip in the system is a side effect of `newTurn` (`apps/server/src/services/encounters.ts:524`
  sets `state: 'live'`).
- Consequence for the TV: `features/tv/encounterState.ts:203` and `feed.ts:210` only draw the
  initiative ribbon when `encounter.state === 'live'`. Until someone presses "New turn", the table
  display cannot show turn order at all.
- `POST /api/encounters/:id/combatants` (FR4.1, add a combatant by hand) and
  `POST /api/encounters/:id/roll-initiative` have no UI. Combat rows can only arrive via
  `stage-encounter` from scene tokens or via the generator's build.
- **"New turn" is the start button and does not say so.** It rolls initiative for everyone *and*
  flips the encounter live; its tooltip says "Re-roll initiative (FR4.3)". A GM starting a fight has
  no reason to press a button labelled "New turn".

**What works, and works well (walked).** `End pass` moved PASS 1 → PASS 2 live over the socket. The
per-row `DMG` dialog previews before it commits — `→ P 1/10 · S 0/10 WOUNDS 0` — and after applying 6
physical the row's derived numbers moved in front of me (`ATTA 3→1`, `DEFE 7→5`, `WOUNDS −2`) and the
log wrote `Siobhan Doyle takes 6 physical boxes · WOUNDS −2`. The copilot rack, morale, interrupt menu
and the resolve-chain dialog (weapon, DV/AP overrides, attacker/defender dice mods, full defence,
"nothing is applied until you commit") are all present and coherent.

**Smallest fix.** An encounter strip across the top of `Tracker.tsx` fed by the already-written
`useEncounterList`: name · state · linked scene · body count, with select / go-live / end. Rename the
button to "Start fight" while `turn === 0`. Both are additive; neither touches G5 or the damage path.

---

## 6. Look up a rule and show a player the page

**VERDICT (GM): works-but-awkward. VERDICT (show a player): cannot-complete.** → **NOW:
works-but-awkward for both. The player half got its door; the GM half did not get its search.**

**NOW (2026-08-31).** `features/library/LibraryPage.tsx` is a new route at `/c/:campaignId/books`,
role-aware: a GM gets the calibration shelf, everyone else gets the shared shelf with one tap to open
a book in place. **Books is now on `PLAYER_NAV`** (`gmNav.ts`), so it is a card on the campaign home
and a glyph in the phone's bottom nav — a player no longer needs a ref chip to have been embedded in
something they were already reading. `/c/:id/gm/books` still resolves. The registration story also
improved (`books/SeedInstructions.tsx`, `BookShelfCard.tsx`, `calibration.ts`; `booksShelf.test.tsx`
18, `calibration.test.ts` 24). Still true, all re-checked today:

- **no search UI anywhere.** `GET /api/books/search` has exactly one consumer in the repo, the
  Fixer's `search_books` tool. A grep of `apps/web/src` for `books/search` returns nothing. So for a
  GM without a local model, "look up a rule" is still "already know the page number";
- **bookmarks and the recents trail (FR11.6) have no UI at all** — `bookmarks`, `library`,
  `library/recent` return no hits in `apps/web/src`;
- **the sheet's ref chip is still a second implementation.** `features/sheet/components/ui.tsx:167`
  is still `<a target="_blank">`, used by `CombatTab`, `GearTab`, `BackgroundTab`, `SpellBook` and
  `FociRack` — so tapping `SR5 p.426` on a phone mid-fight still leaves the sheet, while
  `features/gm/books/RefChip.tsx` opens in place. (An unmerged worktree carries a
  `features/reader/BookReaderOverlay` that looks aimed at exactly this; it is not in the tree, so it
  is not counted.)
- **no "show this to the table."** Nothing pushes a book page to the TV or to players' phones.

**Walked.** `/c/:id/gm/books` on a fresh install: *"No books registered. Run `pnpm seed:books` on the
server to import the PDF folder (FR11.7)."* — a correct instruction, and still a CLI step in the
middle of a GUI. After seeding, the shelf showed `SR5 · Shadowrun Fifth Edition Core Rulebook` with a
page-offset field (+5), a "calibrate at printed p." stepper, a **shared with table** checkbox, and
**Open** → the self-hosted pdf.js reader rendering the real 43 MB PDF with prev/next, "jump to
printed page", zoom/fit and a `PRINTED 1 · PDF 6 OF 505 · OFFSET +5` footer. That part is excellent.

**Where it breaks.**

- **Registering a book is CLI-only.** `POST /api/books` and `POST /api/attachments` exist; no UI
  reaches them. Worse, `apps/server/scripts/seed-books.ts` opens the same PGlite `DATA_DIR` the
  running server holds, so the GM must **stop the server, run the command, and restart it**. (An
  agent is actively improving the instruction card — `features/gm/books/SeedInstructions.tsx`.)
- **There is no search.** `GET /api/books/search` exists (FR12.14 full-text over `book_pages`) and
  **nothing in the web app calls it** — verified by grep. The reader has no in-page find either. Its
  only consumer is the Fixer's `search_books` tool, which requires a local LLM. So "look up a rule"
  reduces to "already know the page number".
- **Bookmarks and recents are invisible.** `/api/campaigns/:id/bookmarks`,
  `/api/campaigns/:id/library`, `/api/campaigns/:id/library/recent` — no UI at all.
- **Players cannot reach the library.** Books live only on the GM sidebar. `BottomNav` and
  `CampaignHome` offer no Books entry, even though FR11.5's default is shared-with-the-table and the
  seeded SR5 came back `shared: true`. A player reaches a book *only* through a ref chip already
  embedded in their sheet or a codex page.
- **Two divergent ref chips.** `features/gm/books/RefChip.tsx` opens the reader as an in-place
  overlay ("without losing context"). `features/sheet/components/ui.tsx:167` is a *separate*
  implementation — an `<a target="_blank">` — so tapping `SR5 p.426` on a phone sheet mid-fight
  throws the player into a new tab. `features/gm/index.ts` advertises RefChip for "sheet items, log
  notes, codex prose"; the sheet does not use it and the roll log renders no refs at all.
- **No "show this to the table".** Nothing pushes a book page to the TV or to players' phones, so the
  literal task — *show a player the page* — has no control.

**Smallest fix.** A search box on the shelf and in the reader wired to `GET /api/books/search` with
results as `{book, page}` chips. A Books entry in `BottomNav`/`CampaignHome` whenever any book is
`shared`. Delete the sheet's private RefChip and import the overlay one from `features/gm`.

---

## 7. End a session: approve karma, publish a recap

**VERDICT: works.**

**Walked.** `/c/:id/gm/sessions`: date + New session; a session card with state, attendance chips and
**Start session**; **Housekeeping** ("the GM's approval is the transaction"); and a **Recap** pane
with "Headlines in the log", **Draft from log**, a free-text recap, **Save recap** and **Publish to
Discord** (disabled, titled "Set the Discord webhook URL in campaign settings first" — a good
disabled state).

End-to-end verified: on `/c/:id/gm/runs`, selected Torque, entered 4 karma, **Post as pending**
("lands unapproved — settle it at the table (FR3.6)"); it appeared instantly in Housekeeping as
`+4 KARMA · Run: Static on the Line · TORQUE` with approve/reject. Draft from log assembled
`SCENE Scene: Pier 23 Warehouse` and `DAMAGE Siobhan Doyle took 6 physical boxes`.

**Warts.** Karma/nuyen can only be *originated* from a run (`RunsBoard`). There is no "award the
table 5 karma for tonight" control on the Sessions screen, which is where the GM is standing when
they want it. The session card also read `0 PRESENT` while listing three attendance chips.

**NOW (2026-08-31).** Verdict unchanged at **works**, and the first wart is largely answered from a
different direction: every row of the new Party roster carries a karma/nuyen award control
(`party/PartyRow.tsx:287`), so "award the table for tonight" is now three clicks on a screen the GM
has a reason to be on, and it still lands as a *pending* ledger row for the housekeeping beat to
approve (FR3.6). It is still not on the Sessions screen itself.

---

## 8. Onboard: start a campaign, get a player onto a phone, get the TV up

**VERDICT: cannot-complete.** → **NOW: works.**

**NOW (2026-08-31).** All three legs closed.

**(a)** `features/gm/home/AddCharacter.tsx` is the missing door: a blank sheet, or a `.chum5` file
picker (`accept=".chum5,.xml,…"`) posting to `POST /api/characters` — the route that had accepted a
Chummer5a export since M3 and that nothing in the browser had ever called. It is deliberately the
empty roster's call to action rather than a screen of its own. `home/SetupChecklist.tsx` then answers
"what is set up in this campaign" with real counts read from REST, each empty row carrying the
control that fills it.

**(b)** Binding is now a GM click. The Party roster's owner picker
(`home/PartyPanel.tsx` `ownerOptions` + `useAssignOwner` → `PATCH /api/characters/:id/owner`) lists
the joined non-display devices; picking one on a character's row hands that sheet to that phone. The
audit's alternative — teaching invites to carry a character — was not taken, and the dead end it
produced is now explained on the phone instead of being silent: a non-GM device with no character
gets a `no-character-note` panel on `CampaignHome.tsx` reading "Ask the GM to pick your name on their
Party roster — it takes them one click and your Sheet tab appears."

**(c)** The GM rail no longer offers a "TV view ↗" that lands the GM's own laptop on a kiosk it
counts as bound. `GmSidebar.tsx` has a **Table display** section: *Pair the TV* (opens the join QR
already switched to the display role), the sentence "The TV needs its own display invite", and
*Preview kiosk ↗* named as a preview. `TvPage.tsx:76`'s `bound` check is unchanged — a GM session
still counts as bound — so the fix is the wayfinding, not the kiosk.

**The front door is good (walked).** `/` offers *Pair this device · Start a campaign · Paste a
token*, with genuinely useful error copy ("This server already has a campaign…", "That code is spent.
Mint a new one from the GM console.", "Could not reach the table server. Same Wi-Fi as the laptop?").
A spent join code lands on a clean *Join failed · invite_not_found · ask the GM for a fresh QR* card.
GM home mints role-scoped invites, shows the join QR, pairs a second GM machine, and lists devices
with per-device Revoke.

**Then it stops.**

**(a) There is no way to get a character into the app.** Verified by diffing every server route
against `apps/web/src`:

| Route | Purpose | UI |
|---|---|---|
| `POST /api/characters` | create (blank sheet or JSON) | **none** |
| `POST /api/characters/:id/import` | Chummer5a `.chum5` — FR3.1, *the* character pipeline | **none** |
| `PATCH /api/characters/:id/owner` | bind a sheet to a device/player | **none** |
| `GET /api/characters/:id/revisions` · `POST …/rollback` | re-import diff & undo (FR3.1) | **none** |
| `POST /api/campaigns/:id/transfer-ownership` | FR1.2 | **none** |

`pnpm seed:demo` is the only thing that has ever created a character. A GM who starts a fresh
campaign gets an empty world with no door into it.

**(b) Even with characters present, a scanned QR does not reach a sheet.** Walked: opened the seeded
`player Torque` join code on a 375×812 phone view. It joined successfully — and the campaign home
showed **Table / Grid / Codex / Calendar and no Sheet**, with no Sheet tab in the bottom nav. Cause,
read and then confirmed: `AuthService.redeemInvite`
(`apps/server/src/services/auth.ts:281`) mints a **fresh user** for every non-GM join, while
`useMyCharacterId` binds a device to a sheet strictly by `characters.ownerUserId`
(`apps/web/src/api/campaigns.ts:79`). Invites carry a *role*, not a character, and there is no
claim-your-character screen and no GM-side assign control. Proof: injecting a session whose `userId`
equalled Torque's `ownerUserId` made the Sheet card and the Sheet tab appear immediately.

The seeded demo hides this because `seed/demo.ts` redeems each invite itself and then creates the
character with that user's id server-side. The printed join codes are therefore misleading: scanning
one produces a *character-less* player.

**(c) The TV works, but nothing tells you how.** Walked with a real `display` token: `/tv/:id`
hydrated from REST and drew the scene name, the in-game date, the revealed fog region and only the
player-visible tokens — server-side secrecy verified against the wire (`GET …/scenes` with a display
token returns *only* the revealed region and no hidden tokens). But the GM sidebar's "TV view ↗"
opens `/tv/:id` on the GM's *own* laptop, where a GM session counts as "bound" and the kiosk shows
`Standing by / RECONNECTING` instead of the `NotJoined` card that would have said "scan the GM's
display QR". Nothing on the GM console explains that the TV needs its own `display` invite.

**Smallest fix.** A "Party" screen (see task 1) that also carries: **Add character** (blank sheet),
**Import .chum5** (multipart to `/api/characters/:id/import`), and per-character **Assign to device**
listing joined player devices → `PATCH /api/characters/:id/owner`. Make the invite minter offer an
optional character so a scanned QR lands the phone on its own sheet. In `TvPage`, treat a *non-display*
role as not-joined so the GM sees the pairing card.

---

## 9. As a PLAYER on a phone: sheet, roll, map, Edge, book page

**VERDICT: works — once a sheet is bound.** The binding is the blocker (task 8b). → **NOW: works.
The binding is a GM click and the unbound state explains itself; one wart survives.**

**NOW (2026-08-31).** Everything walked below still stands. Two changes: **Books** is on the phone's
bottom nav (task 6), so "look up the rule the GM just cited" has an affordance at last; and a device
that has joined but holds no sheet says so and says what to ask for, instead of showing four cards
and no Sheet. The surviving wart is the last bullet below — the sheet's own `RefChip` is still
`target="_blank"`, so a ref chip on a phone still leaves the sheet mid-fight.

**Walked at 375×812**, with a session whose `userId` matched the character's owner:

- **Sheet.** Identity/condition strip pinned: `Torque · ORK · WOUNDS +0`, `PHY 0/11`, `STN 0/10` with
  every box individually tappable and labelled ("Physical box 7 of 11, empty. Activate to damage to
  7"), `EDG ◆◆◆` with `+ / SPEND / BURN`. Tabs Skills / Combat / Magic / Gear / Contacts /
  Background / Ledger. Limits + initiative + movement strip (`P LIMIT 8 · INIT 8+2d6 · WALK 10m ·
  RUN 20m`), attributes, and per-skill pool chips with their limit.
- **Roll a skill — two taps, and it shows its work.** Tapping Pistols opened a dialog reading
  `10 DICE · LIMIT PHYSICAL 8`, then the breakdown: `AGI +5`, `pistols +6`, `SPEC: SEMI-AUTOMATICS
  +2`, and — the thing that justifies the whole architecture — `ALREADY IN THIS POOL · environment:
  light 1 → light (−1)`, the scene modifier the GM set two screens away. Plus a situational
  modifier stepper, `EDGE 3 LEFT` with Push the Limit / Second Chance, and public / GM + me / GM only
  visibility. Rolled it; the roll persisted server-side with its full breakdown (verified via
  `GET /api/campaigns/:id/rolls`).
- **Edge.** Spend/Burn on the strip, with Seize the Initiative / Blitz offered only inside a live
  encounter (read: `components/EdgeControl.tsx`, `IdentityStrip.tsx`).
- **Map.** Grid is on the bottom nav.
- **Book page.** *Not reachable* — see task 6. And a ref chip on the sheet opens a **new tab**, which
  on a phone means leaving the sheet mid-fight.
- Accessibility is a genuine strength: every control carries a spoken label.

---

## Cross-cutting findings

### Dead nav links / placeholders

- ~~`/c/:id/gm/scenes` — placeholder card, offered twice (sidebar + GM home chip), with no link to
  the Grid where the feature actually lives.~~ **Closed.** It is the scene manager, and `GM_NAV` is
  now one list rendered by both the sidebar and the console home, so the "offered twice" failure mode
  is structurally gone. `navigation.test.tsx` asserts that every path either nav offers resolves to a
  real route with an element, and that no prep screen renders placeholder copy.

### Screens that need a UUID you cannot get from the UI

- ~~`/c/:id/sheet/:characterId`~~ **Closed** — every roster row links to it by href.

### Built server-side, no UI entry point anywhere

Verified by diffing every registered route in `apps/server/src/plugins/*` against `apps/web/src`;
**re-diffed 2026-08-31**, struck items now have a caller.

- ~~`POST /api/characters`~~ (`home/AddCharacter.tsx`, blank sheet **and** `.chum5`) ·
  ~~`POST /api/characters/:id/import`~~ · ~~`PATCH /api/characters/:id/owner`~~ (`home/PartyPanel.tsx`) ·
  ~~`GET /api/characters/:id/revisions`~~ · ~~`POST /api/characters/:id/rollback`~~ — **closed
  2026-09-11**: the sheet's History tab (`sheet/tabs/HistoryTab.tsx`) lists every revision, shows
  the diff a roll-back would make and rolls back, and re-imports a `.chum5` diff-first
- ~~`POST /api/campaigns/:id/transfer-ownership`~~ — **closed 2026-09-11**: `home/TransferPanel.tsx`
  on the GM console; two clicks, and the device that clicked is a player
- `PATCH /api/encounters/:id` · `DELETE /api/encounters/:id` ·
  `POST /api/encounters/:id/combatants` · `POST /api/encounters/:id/roll-initiative` ·
  `POST /api/encounters/:id/threat/recompute` — **still none. This is finding 5, and it is the
  largest hole left in the app.**
- ~~`GET /api/books/search`~~ — **closed 2026-09-11**: `books/BookSearch.tsx` on both library
  screens · ~~`POST /api/books`~~ still none, but the seed instruction card now explains the CLI
  step properly
- ~~`GET/POST/DELETE /api/campaigns/:id/bookmarks`~~ · ~~`GET /api/campaigns/:id/library`~~ ·
  ~~`POST /api/campaigns/:id/library/recent`~~ — **closed 2026-09-11** (FR11.6 in full):
  `books/LibraryPanel.tsx` on both library screens; the reader puts every opened book on the
  trail and offers the GM a bookmark button on the page they are looking at
- ~~`POST /api/npcs/:id/converse`~~ — **closed 2026-09-11**: `fixer/NpcVoice.tsx` on the Fixer
  page, an archetype's persona answering in character

### Finished but unreachable from any menu

- ~~The **threat readout** is the only place a GM sees party defence/soak/boxes.~~ **Closed** — the
  Party roster carries condition, Edge, defence, soak and boxes without building an encounter. The
  readout remains the place for the attacker→target math, which is the right home for it.
- ~~The **library** is GM-menu-only despite being shared with the table by default.~~ **Closed** —
  `/c/:id/books` is on `PLAYER_NAV`.

### Empty states, graded

Good, because they say what to do next: Books ("Run `pnpm seed:books` …"), Fixer ("point
`LLM_BASE_URL` at the inference box"), Drafts inbox, Macros ("Build one for the roll you keep
making"), Contacts ("Add the fixer, the doc, the guy who owes you"), Tracker (four distinct truths —
still asking / read failed / no fight / fight with no rows), Housekeeping ("Nothing pending — the
books balance").

Weak: **Codex** ("Nothing in the codex yet.") says nothing about what a codex is for or that the
Fixer can write one — and creating a page does not open it. **Now partly answered**: `NewPagePrompt`
sits in the browser, so the empty codex offers to have one written; whether creating a page selects
it was not re-walked.

### Dead code a fix should consume rather than re-write

- `useEncounterList` — `features/table/commands.ts:120`, exported, referenced by nothing.
  **Still true on 2026-08-31.** It is the whole of finding 5's data layer, already written.
- `TvStageHandle.fit()` — `features/grid/tvStage.ts:162`, implemented, never called. Harmless today
  (the stage self-fits on mount and on scene change), but the `ResizeObserver` at
  `features/grid/stage/index.ts:155` only sets `camera.dirty` and never refits, so a TV that changes
  resolution keeps the old framing with no controls to fix it.

### Claims checked and found sound

Worth recording so nobody "fixes" these: server-side secrecy holds on the wire (a `display` token's
scene read contained only the revealed region and no hidden tokens); dice are server-rolled and
persisted with provenance; wound modifiers propagate into derived pools live; the environment
modifier set on the Grid reappears inside a player's roll breakdown; the TV re-hydrates from REST
after a reload rather than waiting on the socket.
