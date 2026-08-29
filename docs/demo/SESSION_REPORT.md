# Static on the Line — session report

One scripted session of the demo campaign, played end to end against a live
server by `apps/server/scripts/playthrough.ts`: a fresh PGlite database, the
seeded campaign, five devices on the socket, and every beat asserted as it
happened. The narrative below is what the table saw; the dice in it are the
dice the server actually rolled on this run.

**Run:** 2026-08-29 09:14 UTC · **checks:** 196 passed, 0 failed

- **Server:** buildApp() in-process on a loopback port, fresh PGlite in a temp DATA_DIR
- **Campaign:** `pnpm seed:demo` — Static on the Line
- **Books:** SR5 registered, 55 pages of text indexed
- **Fixer:** src/fixer/mock-llm.ts over real HTTP + SSE; no network, no model
- **Duration:** 9.5s

---

## The session

### Before the run — five devices on one Wi-Fi

Three phones and a television scan the same square of light off the GM's laptop and are on the table's network inside ten seconds. No passwords, no accounts — one code each, one device token each.

The GM types a note to herself about the lieutenant and the second buyer. It appears on her laptop and nowhere else: the phones and the TV never receive the bytes, so there is nothing on them to peek at.

The GM shows the code on her own screen. A borrowed laptop scans it and is *her* — same user, same campaign, a second device token — and the code dies on the way in, so the photo somebody took of it is worth nothing. The player codes cannot be talked into doing that: the invite route has no `gm` in its vocabulary at all.

And what the phones scan is the join *screen*. The endpoint that mints the token lives under `/api/`, where nobody points a camera — which is the whole of the fix for the night a player scanned the QR and got a wall of JSON.

### Before the run — the GM writes it down where the table can read half of it

Before anyone sits down, the GM has written the gang up in the codex and shared the page with the table — all but one section of it. The phones fetch the page and the secret is not *hidden* on them, it is absent: the bytes never left the laptop. Later, when it stops mattering, one tap sends them.

Torque writes Mr. Pell into her contacts from her own phone — Connection 4, Loyalty 2, one favour owing — and Sparrow, three feet away, gets a flat 403 for asking to see it. The job is on the board with its objectives and its payout, and the hand-over is pinned to the thirteenth of June where only the GM can read it.

### Beat one — Pier 23, 02:14

> **Whisper — Perception** — 5 dice (INT +4, perception +2, environment: light 1 → light (-1) -1) [3 3 4 3 4] → 0 hits

Whisper's sheet says Perception **5**. The roll dialog offers 5 dice, the server rolls 5, and the receipt on the log adds up to 5 with the shed's dim light in it exactly once. That reads like nothing at all, which is the point: for one build the scene was counted twice and the dialog quietly offered a die fewer than the sheet.

The freight door is jammed half open and screams if you push it. Whisper looks through the gap first: half the roof lamps are dead, which the app already knows — every pool rolled in this shed is one die lighter, and the roll log says so in as many words. Once.

Up to this point the phones have been holding a map with one lit room on it. The GM opens the Main Floor, and the shape of the shed arrives on three screens at once. A ganger walks out of the west aisle — not a marker that was quietly sitting on their connection, a *new* token, arriving.

Sparrow works east along the pallet rows and stops two metres short of the office door. Nothing on the map changes — but a line appears on the GM's panel and nowhere else: *Sparrow is 2.0 m from "Office" — reveal?* It names tokens the players do not know exist, so it is GM-only and it is never written down.

### Beat two — the GM asks the Fixer who to worry about

**Fixer:** Four bodies and a lieutenant, 4 still hidden on your side of the fog. The one on the catwalk is the one to worry about: she has the only working keycard and the best angle on the whole floor. The rest are cover-to-cover. Nothing here is rated above blooded.

**Fixer:** Codex: "The Rusted Halo". Contacts: Mr. Pell at Connection 4, Loyalty 2 — the only name the crew actually has. Jobs: Static on the Line (prep). In-game date 2076-06-12; next beat "Hand-over at the noodle counter", 2076-06-13.

None of that came out of the model. Four typed tools ran against the live database while it was waiting — the codex page written before the session, the contact Torque typed on her phone, the job with its payout, the calendar with the hand-over on it — and the model got the answers back to write a sentence around. It never sees a number the engine did not give it.

The library is already registered — SR5 at its measured +5 offset — so a citation is a page number the server can prove: searching it from a *player's* phone comes back `SR5 p.2`, `SR5 p.52`, `SR5 p.5`, each one a tap away from the right page of the GM's own PDF.

Three bodies come off the *Rusted Halo* template at **blooded** in about as long as it takes to say it: Fatima Benali, Dmitri Volkov, Noor Haddad. Rerun with the same seed and you get the same three, down to the loadout — which is the difference between a generator and a random number.

While the crew argues about the roller door, the GM asks the Fixer for next week: *lay out the Renraku branch — lobby, checkpoint, server room, exec office.* The model never draws anything. It fills in four rectangles measured in grid squares, and the server compiles them into 19 walls, 4 doors and 4 named fog regions on a 1 m grid — as a draft. The scene is still an empty plate until she says otherwise.

### Beat three — the extraction, 02:31

The crate is chest-high and second from the bottom, and moving it takes two people. That is the moment somebody on the catwalk decides to find out who is downstairs.

The GM does not build an encounter: she launches one off the map. Every token that is a person becomes a row in the tracker, the four Halo bodies come off the *blooded* tier of the gang's own template, and the phones are handed exactly the rows they are allowed to know exist.

> **Initiative** — Torque 8+6+1 = **15** · Whisper 8+4 = **12** · Sparrow 11+6+2 = **19** · Ganger-1 · Fatima Benali 8+1 = **9** · Ganger-2 · Dmitri Volkov 6+5 = **11** · Ganger-3 · Noor Haddad 8+2 = **10** · Ganger-4 · Consuelo Ibarra 7+2 = **9**

Torque and Sparrow both roll two initiative dice and neither of them typed that in: the wired reflexes on one sheet and the adept power on the other are ordinary modifiers, and the tracker asked the engine.

Everyone above zero acts once, then every score in the shed drops by ten and the ones still standing above zero go again. Nobody at the table counts anything.

> **Torque — Hammer, single shot** — 11 dice at 9.5 m [5 4 2 6 2 5 5 5 3 3 1] → 5 hits vs defence 7 [4 1 1 4 4 5 3] → 1 hits → 4 net

> **Ganger-1 — soak** — 14 dice (BOD + armour) [6 5 1 2 4 6 3 6 6 4 1 6 4 5] → 7 hits → **5 boxes** of physical

Second action of the turn, and Torque burns a point of Edge to push it: three more dice, every six rolls again, and the pistol's Accuracy stops applying for one shot.

> **Torque — Push the Limit** — 12+3 dice [1 1 3 3 5 4 5 3 3 6 2 5 6 3 3] → 8 hits · rule of six: 6 5 5

> **Ganger-1 — the receipt** — physical 10/10, wound modifier -3, defence 7 → 4

Sparrow spends a point of Edge to get in front of the whole shed — the tracker moves her to the top of the pass on the spot (9 → 9) and gives her the action back. Torque blitzes hers: five dice instead of two, [4 6 4 1 1], initiative 24. Both points come off the sheets and both spends say so in the log.

> **Whisper — one die on the ladder** — [1] → **CRITICAL**, bought off with a point of Edge

She misses the rung. The app calls it a critical glitch, she spends the Edge to make it a near thing instead — and the roll on the record still says what it said. The spend is a new line, not an edit: that is what an append-only log is for.

Whisper puts a Neural Spike through the pallet rows at Force 4 — the cast limited by the Force she chose, the shed's dim light already docked off her pool — and then pays for it, because the app rolls the Drain right behind the spell without being asked.

> **Whisper — Neural Spike, Force 4** — 11 dice [5 6 4 5 3 6 3 2 5 4 3] → 5 hits (4 inside the limit) vs WIL [1 4 2 3] → 0 hits → 8 Stun

> **Whisper — Drain** — 11 dice against DV 2 [3 6 3 6 5 1 5 5 1 5 1] → 6 hits → 0 Stun to the caster

Somebody swings at Sparrow on their way past and she interrupts to dodge. The cost comes off her Initiative Score the instant she declares it — no note in a margin, no argument about it three actions later.

> **Sparrow — Dodge (interrupt)** — Initiative Score 9 → 4

> **Ganger-3 · Noor Haddad — Cut-down dock gun at Torque** — 4 dice [1 5 1 1] → 1 hits · **GLITCH** vs Torque's defence [2 6 5 3 4 6 6] → 4 hits

> **Ganger-4 · Consuelo Ibarra — Cut-down dock gun at Torque** — 7 dice [4 5 1 5 4 4 6] → 3 hits vs Torque's defence [2 3 1 2 3 6 2] → 1 hits

> **Ganger-2 · Dmitri Volkov — three-round burst at Torque** — 6 dice [6 2 1 6 2 6] → 3 hits vs Torque's defence [5 2 5 2 1 2 6] → 3 hits

> **Ganger-4 · Consuelo Ibarra — Cut-down dock gun at Torque** — 7 dice [1 5 5 4 1 3 6] → 3 hits vs Torque's defence [3 2 3 6 2 1 3] → 1 hits

Torque takes 4 boxes of stun and her own phone updates before the GM has finished saying so. Nobody else's does.

Sparrow crosses four metres of oil-slick concrete without appearing to hurry and puts the second one through a pallet stack.

Two of the four are on the floor. The tracker does not decide anything — it says, quietly and only to the GM: *fall back*. The GM decides.

Ratchet never comes down the stair. She calls it off, and the shed goes quiet enough to hear the tide horn. The crate is still in the aisle, mislabelled *hydroponics, fragile*, and nobody on either side has stopped breathing.

### Between the fight and the paperwork — what the log actually says

Sparrow rolls 5 dice against the noise off the water and the card lands on every screen at once — 0 hits, the same event id on the socket and in the log the GM reloads. The line about the north cleat lands under it, and the date on the header rolls over to 2076-06-13. Nothing here is a live-only flourish: close the page, open it again, and the whole beat is still there, because the log IS the record.

### After — the housekeeping beat, while everyone is still connected

Nobody stopped breathing on either side, so the bonus karma stands. Each runner proposes their own award on their own phone, the GM posts the job's payout from the run page, and six pending rows queue up on her screen — the three from the job carrying the job. She approves them in one pass and the balances move: 4 karma each, 8,000¥ across the crew, every row with a reason attached.

The crate moves, and the GM draws from *Docklands complications*: “A second crew is already inside on the same job, and just as unhappy about it as you are.”

**Recap headlines:** 12 rolls at the table · best result: 8 hits · 1 critical glitch

The GM closes the session. 28 rolls are on the record with their pools, their receipts and who could see them — the copilot's three-card exchanges among them — and the recap is written, edited and posted before anyone has found their coat.

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
| | **1b · Join paths and GM sign-in** | | | |
| 10 | the QR encodes the SPA join screen, never the API endpoint (LIVE-3) | `a URL ending /join/<code>, with no /api/join/ in it` | `http://192.168.4.26:62059/join/49UVYDJH` | yes |
| 11 | …and it is a real scannable image | `a base64 PNG data URL` | `data:image/png;base64,… (4274 chars)` | yes |
| 12 | GET /join/:code is not an API route any more — no token in the response | `no "token" anywhere in the body` | `404 · {"error":{"code":"not_found","message":"route GET /join/49UV` | yes |
| 13 | …and the scan did not burn the code: /api/join/:code still mints the device | `role observer, a long-lived token` | `observer · 43-char token` | yes |
| 14 | a player invite refuses to mint a GM device | `400 bad_request — 'gm' is not in the invite role enum` | `400 · {"error":{"code":"bad_request","message":"invalid request body","details":[{"cod` | yes |
| 15 | …and a player device cannot mint a pairing code either | `403` | `403` | yes |
| 16 | the GM mints a pairing code for a second laptop | `gm` | `gm` | yes |
| 17 | …short-lived by construction | `expires inside the hour` | `10 minutes` | yes |
| 18 | …and it too points at the join screen | `a URL ending /join/<code>` | `http://192.168.4.26:62059/join/L9V3C7RJ` | yes |
| 19 | redeeming it mints a gm device | `gm` | `gm` | yes |
| 20 | …bound to the SAME GM identity, not a new user | `c605379b-17c1-4ae3-92a8-fc66cb965661` | `c605379b-17c1-4ae3-92a8-fc66cb965661` | yes |
| 21 | …and the borrowed laptop really is the GM | `201` | `201` | yes |
| 22 | a pairing code is single-use | `410 invite_exhausted on the second scan` | `410 · {"error":{"code":"invite_exhausted","message":"this join cod` | yes |
| | **2 · The codex, a contact, the job** | | | |
| 23 | the GM writes a codex page and shares it with the table | `public` | `public` | yes |
| 24 | a player's copy of the page does not contain the GM-only section | `neither the heading nor its prose anywhere in the payload` | `1 section(s), 367 chars of markdown` | yes |
| 25 | …while the public section is right there | `the street-level section present` | `present` | yes |
| 26 | …and the GM sees the whole thing | `the secret paragraph present for the GM` | `present` | yes |
| 27 | revealing the section announces it to the table | `what-ratchet-is-actually-selling` | `what-ratchet-is-actually-selling` | yes |
| 28 | …and only then does the phone receive the words | `the secret paragraph now present for the player` | `present` | yes |
| 29 | the page is findable in the codex | `the Rusted Halo page in a title/body search` | `found` | yes |
| 30 | the contact reads back on the sheet's own route | `Mr. Pell at Connection 4 / Loyalty 2, one favour owing` | `Mr. Pell C4/L2 owing 1` | yes |
| 31 | …and another runner's phone cannot read it | `403` | `403` | yes |
| 32 | the GM pins a beat to the in-game calendar | `present on the GM calendar` | `present` | yes |
| 33 | …and it is not on the players' calendar | `absent for a player` | `absent` | yes |
| 34 | the run is on the GM screen with its brief | `one run, state prep` | `Static on the Line (prep)` | yes |
| 35 | …and an unfinished job is not on a player list at all | `no runs for a player yet` | `0 run(s)` | yes |
| 36 | …so the GM writes the brief onto it | `two objectives and an 8,000¥ / 4 karma payout` | `2 objective(s) · 8000¥ / 4 karma` | yes |
| 37 | every one of those writes is on the log the session replays from | `the reveal in the campaign event stream` | `present` | yes |
| | **3 · Scene, fog and secrecy** | | | |
| 38 | scene.activated reaches the TV and the phones | `both` | `both` | yes |
| 39 | Perception breakdown carries the dim-light scene modifier | `one 'scene' entry, value −1` | `environment: light 1 → light (-1) -1` | yes |
| 40 | …and the pool is the sum of its own receipt | `5` | `5` | yes |
| 41 | the sheet and the roll agree on the pool (LIVE-2: they did not) | `5` | `5` | yes |
| 42 | the persisted receipt names the scene exactly once | `one 'scene' entry` | `environment: light 1 → light (-1) -1` | yes |
| 43 | a client that re-sends the scene as a chip does not pay for it twice | `pool 5, one 'scene' entry` | `pool 5, 1 scene entry` | yes |
| 44 | …and that roll still sums to its own receipt | `5` | `5` | yes |
| 45 | a receipt that names the scene twice is repaired, and the dice are given back | `one 'scene' entry, pool 5` | `1 scene entry, pool 5` | yes |
| 46 | …and it too sums to its own receipt | `5` | `5` | yes |
| 47 | …and the log records what it refused, rather than quietly fixing it | `a 'dedupedScene' note on the stored roll` | `[{"label":"environment: light 1 → light (-1)","value":-1}]` | yes |
| 48 | player scene shows only the revealed region | `["Loading Dock"]` | `["Loading Dock"]` | yes |
| 49 | player scene carries only the three PC tokens | `3` | `3` | yes |
| 50 | GM sees the staged opposition | `5` | `5` | yes |
| 51 | no hidden token name or coordinate ever hit a player socket | `none` | `none` | yes |
| 52 | fog.updated reaches the TV as a reveal | `reveal` | `reveal` | yes |
| 53 | player scene now includes Main Floor | `["Loading Dock","Main Floor"]` | `["Loading Dock","Main Floor"]` | yes |
| 54 | revealing a hidden token arrives as token.added | `4947fb8c-6023-4bc0-ab1e-21ab74f4e2e7` | `4947fb8c-6023-4bc0-ab1e-21ab74f4e2e7` | yes |
| 55 | …and only then does it appear in the player payload | `4` | `4` | yes |
| 56 | a token at an unrevealed region nudges the GM (FR12.8) | `Sparrow, ~2 m from the Office, inside the 3 m ring` | `Sparrow → Office at 2 m` | yes |
| 57 | …and it suggests, it never reveals | `a pointer at suggest_fog_reveal, sent ephemerally` | `suggest_fog_reveal · ephemeral true` | yes |
| 58 | …so the Office is still fogged on the phones | `no Office region in the player payload` | `Loading Dock, Main Floor` | yes |
| 59 | the prompt reaches no player or display socket at all | `none` | `none` | yes |
| 60 | …which matters, because it names the tokens they cannot see | `at least one prompt about a hidden token` | `Halo ganger — catwalk, east → Catwalk · Ratchet — catwalk → Catwalk · Halo ganger — office door → Office` | yes |
| 61 | …and it is never written down, so a replay cannot leak it either | `no fixer.suggestion in the persisted event log` | `absent` | yes |
| 62 | the token walks back and the server has the final say on where it is | `{"x":4,"y":7}` | `{"x":4,"y":7}` | yes |
| | **4 · The Fixer (mock inference box)** | | | |
| 63 | AI entry points switch on with LLM_BASE_URL set | `true` | `true` | yes |
| 64 | the model reached for get_scene | `["get_scene"]` | `["get_scene"]` | yes |
| 65 | …and the tool ran | `true` | `true` | yes |
| 66 | the tool answered from live state, not from the prompt | `all five staged tokens, and the reveal we made a minute ago` | `5/5 token names · Main Floor revealed: true` | yes |
| 67 | the answer quotes the live count back | `a sentence naming 4 hidden tokens` | `Four bodies and a lieutenant, 4 still hidden on your side of the fog. The one on the catwalk is the one to worry about: she has the only working keycard and th…` | yes |
| 68 | a live session prefixes the situation snapshot (FR12.18) | `true` | `true` | yes |
| 69 | the catalog now covers the FR12.17 rows the codex was blocking | `search_codex, get_page, list_contacts, list_runs, get_calendar` | `search_codex, get_page, list_contacts, list_runs, get_calendar` | yes |
| 70 | …and every one of them is declared read-only | `kind read` | `search_codex:read get_page:read list_contacts:read list_runs:read get_calendar:read` | yes |
| 71 | one turn reaches all four of them | `["search_codex","list_contacts","list_runs","get_calendar"]` | `["search_codex","list_contacts","list_runs","get_calendar"]` | yes |
| 72 | …and all four ran | `every tool ok` | `search_codex:true list_contacts:true list_runs:true get_calendar:true` | yes |
| 73 | search_codex finds the page the GM wrote ten minutes ago | `a hit titled "The Rusted Halo"` | `The Rusted Halo (gmOnly false)` | yes |
| 74 | list_contacts reads the contact off the live sheet, favours and all | `Mr. Pell, Connection 4, one favour owing, read from the structured field` | `Mr. Pell C4 owing 1 (structured)` | yes |
| 75 | list_runs knows the job, its state, its Johnson page and its agreed payout | `Static on the Line, prep, 8,000¥, linked to the gang page` | `Static on the Line (prep) 8000¥ · Johnson "The Rusted Halo"` | yes |
| 76 | get_calendar carries the in-game date, the pinned beat and the rent | `2076-06-12, the hand-over beat, three lifestyles` | `2076-06-12 · Hand-over at the noodle counter · 3 lifestyle(s)` | yes |
| 77 | reads are free — nothing the four tools did left a draft behind | `no new ai_generations rows` | `0 generation(s)` | yes |
| 78 | …and only the GM ever talks to it | `403` | `403` | yes |
| 79 | the core rulebook is registered at its measured page offset | `5` | `5` | yes |
| 80 | …and shared with the whole table (FR11.5) | `true` | `true` | yes |
| 81 | a player can search the library and gets real page provenance | `hits carrying {book, printed page} and a reader URL` | `SR5 p.2, SR5 p.52, SR5 p.5` | yes |
| 82 | the same seed reproduces the same ganger, bone for bone | `byte-identical NPC` | `Fatima Benali vs Fatima Benali` | yes |
| 83 | …and three different seeds are three different people | `three distinct names` | `Fatima Benali, Dmitri Volkov, Noor Haddad` | yes |
| 84 | the GM opens a blank scene for next week | `draft` | `draft` | yes |
| 85 | the model reached for propose_geometry | `["propose_geometry"]` | `["propose_geometry"]` | yes |
| 86 | the layout lands as an ai_generations DRAFT, never on the scene | `kind geometry, status draft` | `geometry / draft` | yes |
| 87 | it is grid-true: whole squares, and metres from the scene's own grid | `every room an integer number of 1 m squares, area = w × h` | `Lobby 14×10 m · Security checkpoint 8×10 m · Server room 10×12 m · Exec office 12×9 m` | yes |
| 88 | …and it compiled walls, doors and unrevealed fog regions the Grid can draw | `walls + doors + one named fog region per room` | `19 walls · 4 doors · Lobby, Security checkpoint, Server room, Exec office` | yes |
| 89 | nothing had to be clamped off the plate | `[]` | `[]` | yes |
| 90 | the scene itself is untouched until the GM accepts (Principle 8) | `still an empty plate: 0 walls, 0 doors, 0 fog regions` | `0 walls · 0 doors · 0 regions` | yes |
| 91 | and the GM can reach it with no inference box configured at all (NG7) | `a draft straight off the deterministic route` | `draft · 1 room(s)` | yes |
| | **5 · The extraction firefight** | | | |
| 92 | every character/NPC token on the map became a combatant | `8` | `8` | yes |
| 93 | the phones see only what has been revealed | `4` | `4` | yes |
| 94 | the four hidden rows are absent, not redacted | `no still-hidden name anywhere in the player payload` | `none` | yes |
| 95 | a PC staged off the map keeps her augmented initiative dice | `Torque 8 + 2d6, as the engine derives her` | `8 + 2d6` | yes |
| 96 | …and every staged line is the engine's, not REA + INT + 1d6 | `three lines matching GET /derived` | `Torque 8+2d6 · Whisper 8+1d6 · Sparrow 11+2d6` | yes |
| 97 | …so the three of them are not one flat number | `more than one distinct initiative line` | `8+2, 8+1, 11+2` | yes |
| 98 | four rolled gangers stand the shed up | `4` | `4` | yes |
| 99 | an unhurt ganger carries no wound modifier | `0` | `0` | yes |
| 100 | a combatant added with a sheet derives its own monitors | `physical track sized from BOD` | `10/11/10/11` | yes |
| 101 | a hand-added NPC carries its own Professional Rating (FR4.6) | `the template's blooded PR (2), on the row` | `{"professionalRating":2}` | yes |
| 102 | a freshly-rolled encounter is on turn 1, pass 1 (FR4.3) | `turn 1 / pass 1` | `staged at turn 0 / pass 0 → rolled to turn 1 / pass 1` | yes |
| 103 | Torque rolls two initiative dice (wired reflexes) | `2` | `2` | yes |
| 104 | …on the engine-derived base REA+INT | `8` | `8` | yes |
| 105 | Sparrow rolls two as well (Quickened Reflexes) | `2` | `2` | yes |
| 106 | Whisper, unaugmented, rolls one | `1` | `1` | yes |
| 107 | the highest Initiative Score acts first | `2dd395d5-3b8a-4a6d-834f-afa8364801c2` | `2dd395d5-3b8a-4a6d-834f-afa8364801c2` | yes |
| 108 | everyone above 0 acts exactly once in the pass | `7` | `7` | yes |
| 109 | end of pass takes 10 off every score | `score − 10, floored at 0` | `every row` | yes |
| 110 | the pass counter advances | `2` | `2` | yes |
| 111 | …from a first pass the tracker was counting all along | `turn 1 / pass 1 before the drop` | `turn 1 / pass 1` | yes |
| 112 | Torque acts twice in turn 1 | `still above 0 after −10` | `15 → 5` | yes |
| 113 | the chain walks attack → defense | `["attack","defense"]` | `["attack","defense"]` | yes |
| 114 | the attack is capped by the weapon's Accuracy | `{"kind":"accuracy","value":5}` | `{"kind":"accuracy","value":5}` | yes |
| 115 | the shot carries the scene and the range band in its receipt | `a 'scene' −1 and a 'range' −1 (medium, heavy pistol)` | `environment: light 1 → light (-1) -1 · medium range (9.5 m, heavy_pistol) -1` | yes |
| 116 | net hits are the attacker's limited hits minus the defence | `4` | `4` | yes |
| 117 | modified DV is the weapon's DV plus net hits | `12` | `12` | yes |
| 118 | boxes are modified DV minus soak hits | `5` | `5` | yes |
| 119 | nothing is written until the GM commits the card | `true` | `true` | yes |
| 120 | the boxes land on the right monitor | `5` | `5` | yes |
| 121 | the chain persists every pool it threw | `["attack","defense","soak"]` | `["attack","defense","soak"]` | yes |
| 122 | …and the roll log grew by at least that many rows | `3 → at least 6` | `3 → 6` | yes |
| 123 | every one of them is behind the screen and stamped with the chain | `visibility gm, chainId 83e2952c-1f69-464b-b095-0de04c3cc74d` | `attack:gm defense:gm soak:gm` | yes |
| 124 | …and the faces on the record are the faces on the card | `the attack card and its stored row agree, die for die` | `[5,4,2,6,2,5,5,5,3,3,1]` | yes |
| 125 | …and no phone can read them (FR2.7) | `none of the chain rows in a player roll log` | `absent` | yes |
| 126 | …not even by id | `404` | `404` | yes |
| 127 | Push the Limit adds the Edge dice to the pool | `15` | `15` | yes |
| 128 | …and ignores the Accuracy limit entirely | `8` | `8` | yes |
| 129 | …and every six rolls again (Rule of Six) | `at least 2 exploded dice` | `6 5 5` | yes |
| 130 | every copilot roll is stamped with the running session | `6 rolls carrying session 3e0db9c1…` | `6/6` | yes |
| 131 | …so they are in the session's own roll log, not floating beside it | `every copilot roll in GET …/rolls?session=` | `6/6` | yes |
| 132 | damage-from-roll is (DV + net) − soak | `13` | `13` | yes |
| 133 | the ganger's wound modifier recomputes from the filled boxes | `-3` | `-3` | yes |
| 134 | and his next defence pool is that much smaller | `7 -3 = 4` | `7 → 4` | yes |
| 135 | Seize the Initiative puts the actor above everyone still in the pass | `strictly above 5` | `9 → 9 (beat 5)` | yes |
| 136 | …and hands the action back — she has not acted this pass | `false` | `false` | yes |
| 137 | …and it costs exactly one point of Edge | `4` | `4` | yes |
| 138 | …debited on the sheet itself, not in a note | `4` | `4` | yes |
| 139 | Blitz rolls the SR5 ceiling of five initiative dice | `5` | `5` | yes |
| 140 | …and the score is base + those five dice + the wound modifier | `8 + 4+6+4+1+1 0 = 24` | `24 (tracker says 24)` | yes |
| 141 | …having bought only the dice her wired reflexes did not already give her | `5 − 2 = 3 bought` | `3 bought over a normal 2d6` | yes |
| 142 | …and it costs one Edge too | `2` | `2` | yes |
| 143 | every spend announces itself, loudly, by name (FR2.3) | `log lines naming Seize the Initiative and Blitz, with the Edge left` | `Sparrow spends 1 Edge — Seize the Initiative: initiative 9 → 9, ahead of 5 (4/5 left) \| Torque spends 1 Edge — Blitz: 5d6 [4, 6, 4, 1, 1] → initiative 24 (2/3 …` | yes |
| 144 | Close Call buys off a glitch after the dice have landed | `the critical negated` | `critical → none` | yes |
| 145 | …for one point of Edge | `2` | `2` | yes |
| 146 | …without editing the roll: the record still says it glitched (G5) | `the stored row still critical, same faces` | `critical · [1]` | yes |
| 147 | …and nobody else may spend another runner's Edge | `403` | `403` | yes |
| 148 | a roll that did not glitch has nothing to sell | `400 no_glitch` | `400 · {"error":{"code":"no_glitch","message":"that roll did not glitch — not` | yes |
| 149 | the cast is limited by its Force | `4` | `4` | yes |
| 150 | the shed's dim light is in the casting pool too | `a 'scene' −1` | `-1` | yes |
| 151 | the spike lands as Stun | `8` | `8` | yes |
| 152 | a Drain resistance roll follows the cast | `threshold 2` | `2` | yes |
| 153 | the unresisted margin lands on the caster's Stun track | `0` | `0` | yes |
| 154 | Dodge costs 5 off the Initiative Score, immediately | `4` | `4` | yes |
| 155 | a three-round burst pays uncompensated recoil | `a negative 'recoil' entry` | `recoil (3 rounds, 1 comp) -1` | yes |
| 156 | damage in the tracker mirrors to the owner's sheet — and only the owner | `sheet.updated at gm_owner visibility on Torque's phone` | `gm_owner · physical 0/11 stun 4` | yes |
| 157 | …nobody else's phone got it | `no monitor mirror for Torque elsewhere` | `none` | yes |
| 158 | two of four down fires the morale suggestion | `a morale report` | `["first casualty","at half strength"]` | yes |
| 159 | …because the squad is at half strength | `reasons include "at half strength"` | `first casualty, at half strength` | yes |
| 160 | …and it is measured against a real Professional Rating, not 0 (FR4.6) | `a non-zero threshold on a hand-added NPC row` | `pressure 4 vs PR 3` | yes |
| 161 | the suggestion is logged GM-only, never acted on | `a gm-visibility log line` | `4 line(s), visibility gm` | yes |
| 162 | …and the players never see the prompt | `absent` | `absent` | yes |
| 163 | the GM ends the encounter on that call | `done` | `done` | yes |
| | **5b · The shared log** | | | |
| 164 | the log is not empty before the beat starts | `events already on the record` | `142 events, newest id 142` | yes |
| 165 | the roll is on the immutable record | `present in GET /api/campaigns/:id/rolls` | `present` | yes |
| 166 | …and on the shared log the GM reads back | `a roll.created event carrying the roll's id` | `event 143` | yes |
| 167 | …so the log has actually grown since the beat began | `an event id above 142` | `143` | yes |
| 168 | …and on the player's own log, because a public roll is the table's | `roll.created present on the phone's read` | `present` | yes |
| 169 | …and it reached the live socket as the same event id | `frame id 143` | `143` | yes |
| 170 | table talk from a phone appends to the same log | `event 144 readable back` | `present` | yes |
| 171 | the GM advances the in-game clock | `2076-06-13` | `2076-06-13` | yes |
| 172 | …and the log carries the clock tick as table-visible history (§11) | `a clock.advanced event naming the new date` | `event 145` | yes |
| | **6 · Wrap** | | | |
| 173 | Torque's own karma claim lands pending | `pending` | `pending` | yes |
| 174 | Whisper's own karma claim lands pending | `pending` | `pending` | yes |
| 175 | Sparrow's own karma claim lands pending | `pending` | `pending` | yes |
| 176 | the job posts its payout to the ledger (FR5.5) | `3` | `3` | yes |
| 177 | …as pending rows, not as money (FR5.5 → FR3.6) | `state pending on every one` | `pending` | yes |
| 178 | …and the run itself records what it paid | `16000` | `16000` | yes |
| 179 | six proposals wait on the GM | `6` | `6` | yes |
| 180 | …and the three from the job carry the job that earned them | `runId on the three nuyen rows` | `3 of 6 linked` | yes |
| 181 | …and the housekeeping beat is holding exactly those six | `6` | `6` | yes |
| 182 | Torque's karma balance after approval | `4` | `4` | yes |
| 183 | Whisper's karma balance after approval | `4` | `4` | yes |
| 184 | Sparrow's karma balance after approval | `4` | `4` | yes |
| 185 | the crew is paid exactly the agreed 8,000¥ | `8000` | `8000` | yes |
| 186 | and 4 karma each | `12` | `12` | yes |
| 187 | the table draw lands in the log | `present for the GM` | `present` | yes |
| 188 | …and a GM-only table stays GM-only | `absent for players` | `absent` | yes |
| 189 | the Fixer drafts the recap through draft_wiki_page | `["draft_wiki_page"]` | `["draft_wiki_page"]` | yes |
| 190 | nothing was applied — it is an ai_generations draft | `status draft` | `draft` | yes |
| 191 | the spoiler guard caught the GM-only name in it (FR12.19) | `at least one flag` | `Halo ganger — pallet rows` | yes |
| 192 | accepting it creates the codex page | `wiki_pages` | `wiki_pages` | yes |
| 193 | the GM publishes the edited recap | `true` | `true` | yes |
| 194 | …with no webhook configured, nothing leaves the laptop | `skipped` | `skipped` | yes |
| 195 | session ends → live mode off | `false` | `false` | yes |
| 196 | the session log counted the whole night, copilot dice included | `every persisted roll accounted for by the session` | `28 of 28 persisted rolls, 1 glitches` | yes |

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
| GM | paste the **GM device token** the seed printed, or — from a laptop already signed in as GM — `POST /api/campaigns/:id/gm-pair` and scan the code it returns at `http://localhost:5173/join/<code>` |
| Player | `http://localhost:5173/join/<player-code>` — one code per phone, and the seed prints three |
| The TV | `http://localhost:5173/join/<display-code>`, then `/tv/<campaignId>` |

Ordinary invites are role-scoped to player / observer / display and refuse `gm`
outright; a GM device comes only from the bootstrap, `gm-device`, or a
single-use `gm-pair` code. Every one of those redeems at **`/api/join/:code`** —
`/join/:code` is the SPA screen the QR points a camera at.

`pnpm seed:demo` prints all of those codes and tokens; it is idempotent, so
running it again wipes *Static on the Line* and rebuilds it from scratch
without touching any other campaign.

To play the same beats by hand: write a codex page with one GM-only section
and open it on a phone before and after revealing it; activate **Pier 23
Warehouse** and roll a Perception from a phone (the dim light is already in
the pool — the dialog shows it as context, never as a chip you add again);
reveal *Main Floor*; drag a token to the office door and watch the GM-only
nudge appear; launch the encounter from the scene, build the opposition from
the *Rusted Halo* template at **blooded**; spend Edge on Seize the Initiative,
Blitz and a Close Call; then post the run award and settle karma and nuyen in
the housekeeping beat before you close the session.

Optional extras:

```bash
# register the rulebook PDFs sitting at the repo root (FR11.7)
pnpm seed:books -- --only SR5 --max-pages 60

# point the Fixer at a local OpenAI-compatible model (llama.cpp / vLLM)
# with LLM_BASE_URL unset every AI entry point simply hides (NG7)
LLM_BASE_URL=http://127.0.0.1:8080 pnpm dev:server
```
