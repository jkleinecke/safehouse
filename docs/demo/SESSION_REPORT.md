# Static on the Line — session report

One scripted session of the demo campaign, played end to end against a live
server by `apps/server/scripts/playthrough.ts`: a fresh PGlite database, the
seeded campaign, five devices on the socket, and every beat asserted as it
happened. The narrative below is what the table saw; the dice in it are the
dice the server actually rolled on this run.

**Run:** 2026-08-28 20:26 UTC · **checks:** 93 passed, 0 failed

- **Server:** buildApp() in-process on a loopback port, fresh PGlite in a temp DATA_DIR
- **Campaign:** `pnpm seed:demo` — Static on the Line
- **Books:** SR5 registered, 55 pages of text indexed
- **Fixer:** src/fixer/mock-llm.ts over real HTTP + SSE; no network, no model
- **Duration:** 8.3s

---

## The session

### Before the run — five devices on one Wi-Fi

Three phones and a television scan the same square of light off the GM's laptop and are on the table's network inside ten seconds. No passwords, no accounts — one code each, one device token each.

The GM types a note to herself about the lieutenant and the second buyer. It appears on her laptop and nowhere else: the phones and the TV never receive the bytes, so there is nothing on them to peek at.

### Beat two — Pier 23, 02:14

> **Whisper — Perception** — 5 dice (INT +4, perception +2, environment: light 1 → light (-1) -1) [2 1 1 2 1] → 0 hits · **CRITICAL**

The freight door is jammed half open and screams if you push it. Whisper looks through the gap first: half the roof lamps are dead, which the app already knows — every pool rolled in this shed is one die lighter, and the roll log says so in as many words.

Up to this point the phones have been holding a map with one lit room on it. The GM opens the Main Floor, and the shape of the shed arrives on three screens at once. A ganger walks out of the west aisle — not a marker that was quietly sitting on their connection, a *new* token, arriving.

### Beat three — the GM asks the Fixer who to worry about

**Fixer:** Four bodies and a lieutenant, 4 still hidden on your side of the fog. The one on the catwalk is the one to worry about: she has the only working keycard and the best angle on the whole floor. The rest are cover-to-cover. Nothing here is rated above blooded.

The library is already registered — SR5 at its measured +5 offset — so a citation is a page number the server can prove: searching it from a *player's* phone comes back `SR5 p.2`, `SR5 p.52`, `SR5 p.5`, each one a tap away from the right page of the GM's own PDF.

Three bodies come off the *Rusted Halo* template at **blooded** in about as long as it takes to say it: Fatima Benali, Dmitri Volkov, Noor Haddad. Rerun with the same seed and you get the same three, down to the loadout — which is the difference between a generator and a random number.

### Beat four — the extraction, 02:31

The crate is chest-high and second from the bottom, and moving it takes two people. That is the moment somebody on the catwalk decides to find out who is downstairs.

The GM does not build an encounter: she launches one off the map. Every token that is a person becomes a row in the tracker, the four Halo bodies come off the *blooded* tier of the gang's own template, and the phones are handed exactly the rows they are allowed to know exist.

> **Initiative** — Torque 8+1+3 = **12** · Whisper 8+2 = **10** · Sparrow 11+5+2 = **18** · Ganger-1 · Fatima Benali 8+5 = **13** · Ganger-2 · Dmitri Volkov 6+4 = **10** · Ganger-3 · Noor Haddad 8+6 = **14** · Ganger-4 · Consuelo Ibarra 7+4 = **11**

Torque and Sparrow both roll two initiative dice and neither of them typed that in: the wired reflexes on one sheet and the adept power on the other are ordinary modifiers, and the tracker asked the engine.

Everyone above zero acts once, then every score in the shed drops by ten and the ones still standing above zero go again. Nobody at the table counts anything.

> **Torque — Hammer, single shot** — 11 dice at 9.5 m [3 4 2 3 1 4 3 6 3 5 6] → 3 hits vs defence 7 [2 4 6 1 3 4 6] → 2 hits → 1 net

> **Ganger-1 — soak** — 14 dice (BOD + armour) [2 1 4 5 2 2 1 6 1 4 5 2 1 1] → 3 hits → **6 boxes** of stun

Second action of the turn, and Torque burns a point of Edge to push it: three more dice, every six rolls again, and the pistol's Accuracy stops applying for one shot.

> **Torque — Push the Limit** — 12+3 dice [4 2 2 6 3 5 5 6 6 5 6 3 4 5 2] → 9 hits · rule of six: 3 1 5 3

> **Ganger-1 — the receipt** — physical 10/10, wound modifier -5, defence 7 → 2

Whisper puts a Neural Spike through the pallet rows at Force 4 — the cast limited by the Force she chose, the shed's dim light already docked off her pool — and then pays for it, because the app rolls the Drain right behind the spell without being asked.

> **Whisper — Neural Spike, Force 4** — 11 dice [5 4 1 6 5 5 1 6 5 1 4] → 6 hits (4 inside the limit) vs WIL [2 1 5 5] → 2 hits → 6 Stun

> **Whisper — Drain** — 11 dice against DV 2 [4 2 4 4 6 2 3 4 4 2 2] → 1 hits → 1 Stun to the caster

Somebody swings at Sparrow on their way past and she interrupts to dodge. The cost comes off her Initiative Score the instant she declares it — no note in a margin, no argument about it three actions later.

> **Sparrow — Dodge (interrupt)** — Initiative Score 8 → 3

> **Ganger-3 · Noor Haddad — Cut-down dock gun at Torque** — 4 dice [6 2 6 3] → 2 hits vs Torque's defence [4 1 3 6 5 5 3] → 3 hits

> **Ganger-4 · Consuelo Ibarra — Cut-down dock gun at Torque** — 7 dice [3 6 5 1 5 2 2] → 3 hits vs Torque's defence [6 3 6 2 5 4 6] → 4 hits

> **Ganger-2 · Dmitri Volkov — three-round burst at Torque** — 6 dice [2 6 6 4 5 5] → 4 hits vs Torque's defence [1 3 1 4 4 1 5] → 1 hits

Torque takes 6 boxes of stun and her own phone updates before the GM has finished saying so. Nobody else's does.

Sparrow crosses four metres of oil-slick concrete without appearing to hurry and puts the second one through a pallet stack.

Two of the four are on the floor. The tracker does not decide anything — it says, quietly and only to the GM: *cut and run*. The GM decides.

Ratchet never comes down the stair. She calls it off, and the shed goes quiet enough to hear the tide horn. The crate is still in the aisle, mislabelled *hydroponics, fragile*, and nobody on either side has stopped breathing.

### After — the housekeeping beat, while everyone is still connected

Nobody stopped breathing on either side, so the bonus karma stands. Each runner proposes their own award on their own phone; six pending rows queue up on the GM's screen; she approves them in one pass and the balances move: 4 karma each, 8,000¥ across the crew, every row with a reason and a session attached.

The crate moves, and the GM draws from *Docklands complications*: “The tide horn sounds. Everyone on the pier looks up, including the people you were sneaking past.”

**Recap headlines:** 3 rolls at the table · best result: 4 hits · 1 critical glitch

The GM closes the session. 4 rolls are on the record with their pools, their receipts and who could see them — and the recap is written, edited and posted before anyone has found their coat.

---

## Assertions

| # | Check | Expected | Observed | Pass |
| --- | --- | --- | --- | --- |
| | **1 · Join** | | | |
| 1 | Torque joins by code → role | `player` | `player` | yes |
| 2 | Whisper joins by code → role | `player` | `player` | yes |
| 3 | Sparrow joins by code → role | `player` | `player` | yes |
| 4 | the TV joins by code → role | `display` | `display` | yes |
| 5 | five sockets connected | `5` | `5` | yes |
| 6 | GM starts the session → live mode | `true` | `true` | yes |
| 7 | planted GM-only line reaches the GM socket | `1` | `1` | yes |
| 8 | …and no player/display socket | `no sockets` | `none` | yes |
| 9 | no gm-visibility frame on any player/display socket | `none` | `none` | yes |
| | **2 · Scene, fog and secrecy** | | | |
| 10 | scene.activated reaches the TV and the phones | `both` | `both` | yes |
| 11 | Perception breakdown carries the dim-light scene modifier | `one 'scene' entry, value −1` | `environment: light 1 → light (-1) -1` | yes |
| 12 | …and the pool is the sum of its own receipt | `5` | `5` | yes |
| 13 | player scene shows only the revealed region | `["Loading Dock"]` | `["Loading Dock"]` | yes |
| 14 | player scene carries only the three PC tokens | `3` | `3` | yes |
| 15 | GM sees the staged opposition | `5` | `5` | yes |
| 16 | no hidden token name or coordinate ever hit a player socket | `none` | `none` | yes |
| 17 | fog.updated reaches the TV as a reveal | `reveal` | `reveal` | yes |
| 18 | player scene now includes Main Floor | `["Loading Dock","Main Floor"]` | `["Loading Dock","Main Floor"]` | yes |
| 19 | revealing a hidden token arrives as token.added | `6c240b8e-bdf4-46cc-b239-b24a5cb48877` | `6c240b8e-bdf4-46cc-b239-b24a5cb48877` | yes |
| 20 | …and only then does it appear in the player payload | `4` | `4` | yes |
| | **3 · The Fixer (mock inference box)** | | | |
| 21 | AI entry points switch on with LLM_BASE_URL set | `true` | `true` | yes |
| 22 | the model reached for get_scene | `["get_scene"]` | `["get_scene"]` | yes |
| 23 | …and the tool ran | `true` | `true` | yes |
| 24 | the tool answered from live state, not from the prompt | `all five staged tokens, and the reveal we made a minute ago` | `5/5 token names · Main Floor revealed: true` | yes |
| 25 | the answer quotes the live count back | `a sentence naming 4 hidden tokens` | `Four bodies and a lieutenant, 4 still hidden on your side of the fog. The one on the catwalk is the one to worry about: she has the only working keycard and th…` | yes |
| 26 | a live session prefixes the situation snapshot (FR12.18) | `true` | `true` | yes |
| 27 | the core rulebook is registered at its measured page offset | `5` | `5` | yes |
| 28 | …and shared with the whole table (FR11.5) | `true` | `true` | yes |
| 29 | a player can search the library and gets real page provenance | `hits carrying {book, printed page} and a reader URL` | `SR5 p.2, SR5 p.52, SR5 p.5` | yes |
| 30 | the same seed reproduces the same ganger, bone for bone | `byte-identical NPC` | `Fatima Benali vs Fatima Benali` | yes |
| 31 | …and three different seeds are three different people | `three distinct names` | `Fatima Benali, Dmitri Volkov, Noor Haddad` | yes |
| | **4 · The extraction firefight** | | | |
| 32 | every character/NPC token on the map became a combatant | `8` | `8` | yes |
| 33 | the phones see only what has been revealed | `4` | `4` | yes |
| 34 | the four hidden rows are absent, not redacted | `no still-hidden name anywhere in the player payload` | `none` | yes |
| 35 | four rolled gangers stand the shed up | `4` | `4` | yes |
| 36 | an unhurt ganger carries no wound modifier | `0` | `0` | yes |
| 37 | a combatant added with a sheet derives its own monitors | `physical track sized from BOD` | `10/11/10/11` | yes |
| 38 | Torque rolls two initiative dice (wired reflexes) | `2` | `2` | yes |
| 39 | …on the engine-derived base REA+INT | `8` | `8` | yes |
| 40 | Sparrow rolls two as well (Quickened Reflexes) | `2` | `2` | yes |
| 41 | Whisper, unaugmented, rolls one | `1` | `1` | yes |
| 42 | the highest Initiative Score acts first | `e66b4cfc-9775-4390-8bfd-85179feb0eb3` | `e66b4cfc-9775-4390-8bfd-85179feb0eb3` | yes |
| 43 | everyone above 0 acts exactly once in the pass | `7` | `7` | yes |
| 44 | end of pass takes 10 off every score | `score − 10, floored at 0` | `every row` | yes |
| 45 | the pass counter advances | `1` | `1` | yes |
| 46 | Torque acts twice in turn 1 | `still above 0 after −10` | `12 → 2` | yes |
| 47 | the chain walks attack → defense | `["attack","defense"]` | `["attack","defense"]` | yes |
| 48 | the attack is capped by the weapon's Accuracy | `{"kind":"accuracy","value":5}` | `{"kind":"accuracy","value":5}` | yes |
| 49 | the shot carries the scene and the range band in its receipt | `a 'scene' −1 and a 'range' −1 (medium, heavy pistol)` | `environment: light 1 → light (-1) -1 · medium range (9.5 m, heavy_pistol) -1` | yes |
| 50 | net hits are the attacker's limited hits minus the defence | `1` | `1` | yes |
| 51 | modified DV is the weapon's DV plus net hits | `9` | `9` | yes |
| 52 | boxes are modified DV minus soak hits | `6` | `6` | yes |
| 53 | nothing is written until the GM commits the card | `true` | `true` | yes |
| 54 | the boxes land on the right monitor | `6` | `6` | yes |
| 55 | Push the Limit adds the Edge dice to the pool | `15` | `15` | yes |
| 56 | …and ignores the Accuracy limit entirely | `9` | `9` | yes |
| 57 | …and every six rolls again (Rule of Six) | `at least 4 exploded dice` | `3 1 5 3` | yes |
| 58 | damage-from-roll is (DV + net) − soak | `12` | `12` | yes |
| 59 | the ganger's wound modifier recomputes from the filled boxes | `-5` | `-5` | yes |
| 60 | and his next defence pool is that much smaller | `7 -5 = 2` | `7 → 2` | yes |
| 61 | the cast is limited by its Force | `4` | `4` | yes |
| 62 | the shed's dim light is in the casting pool too | `a 'scene' −1` | `-1` | yes |
| 63 | the spike lands as Stun | `6` | `6` | yes |
| 64 | a Drain resistance roll follows the cast | `threshold 2` | `2` | yes |
| 65 | the unresisted margin lands on the caster's Stun track | `1` | `1` | yes |
| 66 | Dodge costs 5 off the Initiative Score, immediately | `3` | `3` | yes |
| 67 | a three-round burst pays uncompensated recoil | `a negative 'recoil' entry` | `recoil (3 rounds, 1 comp) -1` | yes |
| 68 | damage in the tracker mirrors to the owner's sheet — and only the owner | `sheet.updated at gm_owner visibility on Torque's phone` | `gm_owner · physical 0/11 stun 6` | yes |
| 69 | …nobody else's phone got it | `no monitor mirror for Torque elsewhere` | `none` | yes |
| 70 | two of four down fires the morale suggestion | `a morale report` | `["first casualty","at half strength"]` | yes |
| 71 | …because the squad is at half strength | `reasons include "at half strength"` | `first casualty, at half strength` | yes |
| 72 | the suggestion is logged GM-only, never acted on | `a gm-visibility log line` | `5 line(s), visibility gm` | yes |
| 73 | …and the players never see the prompt | `absent` | `absent` | yes |
| 74 | the GM ends the encounter on that call | `done` | `done` | yes |
| | **5 · Wrap** | | | |
| 75 | Torque's own karma claim lands pending | `pending` | `pending` | yes |
| 76 | Whisper's own karma claim lands pending | `pending` | `pending` | yes |
| 77 | Sparrow's own karma claim lands pending | `pending` | `pending` | yes |
| 78 | six proposals wait on the GM | `6` | `6` | yes |
| 79 | Torque's karma balance after approval | `4` | `4` | yes |
| 80 | Whisper's karma balance after approval | `4` | `4` | yes |
| 81 | Sparrow's karma balance after approval | `4` | `4` | yes |
| 82 | the crew is paid exactly the agreed 8,000¥ | `8000` | `8000` | yes |
| 83 | and 4 karma each | `12` | `12` | yes |
| 84 | the table draw lands in the log | `present for the GM` | `present` | yes |
| 85 | …and a GM-only table stays GM-only | `absent for players` | `absent` | yes |
| 86 | the Fixer drafts the recap through draft_wiki_page | `["draft_wiki_page"]` | `["draft_wiki_page"]` | yes |
| 87 | nothing was applied — it is an ai_generations draft | `status draft` | `draft` | yes |
| 88 | the spoiler guard caught the GM-only name in it (FR12.19) | `at least one flag` | `Halo ganger — pallet rows` | yes |
| 89 | accepting it creates the codex page | `wiki_pages` | `wiki_pages` | yes |
| 90 | the GM publishes the edited recap | `true` | `true` | yes |
| 91 | …with no webhook configured, nothing leaves the laptop | `skipped` | `skipped` | yes |
| 92 | session ends → live mode off | `false` | `false` | yes |
| 93 | the session log counted the night | `a non-empty roll count for the session` | `4 of 7 persisted rolls, 0 glitches` | yes |

---

## Gaps this run found

- `POST /api/scenes/:id/stage-encounter` builds initiative lines from the raw sheet (`REA + INT`, 1d6): it staged Torque at 7 + 1d6 where the engine derives 8 + 2d6 — wired reflexes and adept powers are dropped. `services/scenes.ts stageEncounter` should call `deriveFor(sheet, kind)` the way `addCombatant` does.
- `POST /api/encounters/:id/combatants` has no way to carry a Professional Rating onto the row (`copilot.generator` is set only by the generator's own encounter builder), so FR10.9 morale for hand-added NPCs measures pressure against PR 0. `AddCombatantBody` needs a `professionalRating` field.
- An encounter that is staged (or created through `POST /api/campaigns/:id/encounters`) and then rolled starts at turn 0 / pass 0: only `newTurn` ever initialises those columns, so the tracker reads a pass behind for the whole first turn (FR4.3 "the UI always shows current pass"). `rollInitiativeAll` should set `turn = max(1, turn)` and `pass = 1` when the encounter has not started.
- `POST /api/encounters/:id/resolve-chain` rolls three server-side pools (attack, defence, soak) and persists none of them: the roll log gained 0 rows across the whole exchange. The damage staying uncommitted is deliberate (Principle 2), but G5/FR2.1 want the dice themselves on the immutable record — the cards should write `rolls` rows (visibility `gm`) as they are produced, or on commit.
- The session's roll count is 4 where 7 rolls were persisted: `EncountersService.recordRoll` (every copilot quick-roll, FR10.7) inserts into `rolls` directly and never stamps `session_id`, so those rolls fall out of the housekeeping summary and out of `GET …/rolls?session=`. It should go through the rolls service, or at least call `activeSessionId` — its own INTEGRATION note says as much.

---

## How to replay this yourself

Everything below runs offline: no Docker, no internet, no model.

```bash
pnpm install

# 1. the whole scripted session again, against a throwaway database
pnpm playthrough

# 2. or play it by hand — seed the campaign into ./data
pnpm seed:demo          # prints join codes AND device tokens

# 3. two terminals
pnpm dev:server         # http://localhost:8787
pnpm dev:web            # http://localhost:5173 (proxies /api /ws /files /read /join)
```

Then open, in as many browser windows as you have hands:

| Who | Where |
| --- | --- |
| GM | paste the **GM device token** the seed printed (join codes are role-scoped to player / observer / display, so there is no GM code) |
| Player | `http://localhost:5173/join/<player-code>` — one code per phone, and the seed prints three |
| The TV | `http://localhost:5173/join/<display-code>`, then `/tv/<campaignId>` |

`pnpm seed:demo` prints all of those codes and tokens; it is idempotent, so
running it again wipes *Static on the Line* and rebuilds it from scratch
without touching any other campaign.

To play the same beats by hand: activate **Pier 23 Warehouse**, roll a
Perception from a phone (the dim light is already in the pool), reveal
*Main Floor*, launch the encounter from the scene, build the opposition from
the *Rusted Halo* template at **blooded**, and settle karma and nuyen in the
housekeeping beat before you close the session.

Optional extras:

```bash
# register the rulebook PDFs sitting at the repo root (FR11.7)
pnpm seed:books -- --only SR5 --max-pages 60

# point the Fixer at a local OpenAI-compatible model (llama.cpp / vLLM)
# with LLM_BASE_URL unset every AI entry point simply hides (NG7)
LLM_BASE_URL=http://127.0.0.1:8080 pnpm dev:server
```
