# Static on the Line — session report

One scripted session of the demo campaign, played end to end against a live
server by `apps/server/scripts/playthrough.ts`: a fresh PGlite database, the
seeded campaign, five devices on the socket, and every beat asserted as it
happened. The narrative below is what the table saw; the dice in it are the
dice the server actually rolled on this run.

**Run:** 2026-08-29 18:17 UTC · **checks:** 265 passed, 0 failed, 1 not applicable

- **Server:** buildApp() in-process on a loopback port, fresh PGlite in a temp DATA_DIR
- **Campaign:** `pnpm seed:demo` — Static on the Line
- **Books:** SR5 registered, 55 pages of text indexed
- **Fixer:** src/fixer/mock-llm.ts over real HTTP + SSE; no network, no model
- **Duration:** 16.1s

---

## The session

### Before the run — five devices on one Wi-Fi

Three phones and a television scan the same square of light off the GM's laptop and are on the table's network inside ten seconds. No passwords, no accounts — one code each, one device token each.

The GM types a note to herself about the lieutenant and the second buyer. It appears on her laptop and nowhere else: the phones and the TV never receive the bytes, so there is nothing on them to peek at.

The GM shows the code on her own screen. A borrowed laptop scans it and is *her* — same user, same campaign, a second device token — and the code dies on the way in, so the photo somebody took of it is worth nothing. The player codes cannot be talked into doing that: the invite route has no `gm` in its vocabulary at all.

And what the phones scan is the join *screen*. The endpoint that mints the token lives under `/api/`, where nobody points a camera — which is the whole of the fix for the night a player scanned the QR and got a wall of JSON.

While the crate is still theoretical, Torque builds two buttons on her phone — *suppressive fire* at eleven dice under the pistol’s Accuracy, and a nine-dice maglock roll she only wants the GM to see. They are hers, not the handset’s: Sparrow, sitting next to her, has an empty rack, and a guessed id gets a flat 404.

The GM proves the other half by pairing the phone in her pocket as a second device on the same account. She never rebuilds the rack — it is simply there, and firing it from the phone rolls the same seven dice the laptop would have.

### Before the run — the GM writes it down where the table can read half of it

Before anyone sits down, the GM has written the gang up in the codex and shared the page with the table — all but one section of it. The phones fetch the page and the secret is not *hidden* on them, it is absent: the bytes never left the laptop. Later, when it stops mattering, one tap sends them.

Torque writes Mr. Pell into her contacts from her own phone — Connection 4, Loyalty 2, one favour owing — and Sparrow, three feet away, gets a flat 403 for asking to see it. The job is on the board with its objectives and its payout, and the hand-over is pinned to the thirteenth of June where only the GM can read it.

The gang page and the gang’s stat template stop being two unrelated rows: the archetype the generator rolls bodies from now names the codex page that says who they are, and the page lists it back. Only for the GM — the phones read the same page and are handed no opposition at all.

### Beat one — Pier 23, 02:14

> **Whisper — Perception** — 5 dice (INT +4, perception +2, environment: light 1 → light (-1) -1) [2 2 3 1 4] → 0 hits

Whisper's sheet says Perception **5**. The roll dialog offers 5 dice, the server rolls 5, and the receipt on the log adds up to 5 with the shed's dim light in it exactly once. That reads like nothing at all, which is the point: for one build the scene was counted twice and the dialog quietly offered a die fewer than the sheet.

The freight door is jammed half open and screams if you push it. Whisper looks through the gap first: half the roof lamps are dead, which the app already knows — every pool rolled in this shed is one die lighter, and the roll log says so in as many words. Once.

Up to this point the phones have been holding a map with one lit room on it. The GM opens the Main Floor, and the shape of the shed arrives on three screens at once. A ganger walks out of the west aisle — not a marker that was quietly sitting on their connection, a *new* token, arriving.

Sparrow works east along the pallet rows and stops two metres short of the office door. Nothing on the map changes — but a line appears on the GM's panel and nowhere else: *Sparrow is 2.0 m from "Office" — reveal?* It names tokens the players do not know exist, so it is GM-only and it is never written down.

### Beat two — the GM asks the Fixer who to worry about

Before anything else, the app asks the box a question it will not guess at: *do you read images?* The box refuses the test image, which is the answer — so the map-vision half of the layout copilot simply is not there tonight. The model is never offered the tool, the button reports `vision_unsupported` rather than failing in the GM's hands, and everything else the Fixer does carries on unaffected.

**Fixer:** Four bodies and a lieutenant, 4 still hidden on your side of the fog. The one on the catwalk is the one to worry about: she has the only working keycard and the best angle on the whole floor. The rest are cover-to-cover. Nothing here is rated above blooded.

**Fixer:** Codex: "The Rusted Halo". Contacts: Mr. Pell at Connection 4, Loyalty 2 — the only name the crew actually has. Jobs: Static on the Line (prep). In-game date 2076-06-12; next beat "Hand-over at the noodle counter", 2076-06-13.

None of that came out of the model. Four typed tools ran against the live database while it was waiting — the codex page written before the session, the contact Torque typed on her phone, the job with its payout, the calendar with the hand-over on it — and the model got the answers back to write a sentence around. It never sees a number the engine did not give it.

The library is already registered — SR5 at its measured +5 offset — so a citation is a page number the server can prove: searching it from a *player's* phone comes back `SR5 p.2`, `SR5 p.52`, `SR5 p.5`, each one a tap away from the right page of the GM's own PDF.

Three bodies come off the *Rusted Halo* template at **blooded** in about as long as it takes to say it: Fatima Benali, Dmitri Volkov, Noor Haddad. Rerun with the same seed and you get the same three, down to the loadout — which is the difference between a generator and a random number.

While the crew argues about the roller door, the GM asks the Fixer for next week: *lay out the Renraku branch — lobby, checkpoint, server room, exec office.* The model never draws anything. It fills in four rectangles measured in grid squares, and the server compiles them into 19 walls, 4 doors and 4 named fog regions on a 1 m grid — as a draft. The scene is still an empty plate until she says otherwise.

### Beat three — the extraction, 02:31

The crate is chest-high and second from the bottom, and moving it takes two people. That is the moment somebody on the catwalk decides to find out who is downstairs.

The GM does not build an encounter: she launches one off the map. Every token that is a person becomes a row in the tracker, the four Halo bodies come off the *blooded* tier of the gang's own template, and the phones are handed exactly the rows they are allowed to know exist.

> **Initiative** — Torque 8+2+6 = **16** · Whisper 8+6 = **14** · Sparrow 11+2+6 = **19** · Ganger-1 · Fatima Benali 8+2 = **10** · Ganger-2 · Dmitri Volkov 6+5 = **11** · Ganger-3 · Noor Haddad 8+4 = **12** · Ganger-4 · Consuelo Ibarra 7+5 = **12**

Torque and Sparrow both roll two initiative dice and neither of them typed that in: the wired reflexes on one sheet and the adept power on the other are ordinary modifiers, and the tracker asked the engine.

Everyone above zero acts once, then every score in the shed drops by ten and the ones still standing above zero go again. Nobody at the table counts anything.

> **Torque — Hammer, shot 1** — 11 dice [1 1 3 2 1 3 3 1 6 5 6] → 3 hits — Tie — the defense holds.

> **Torque — Hammer, single shot** — 11 dice at 9.5 m [5 3 1 4 6 2 6 6 2 1 1] → 4 hits vs defence 7 [4 4 6 6 3 4 5] → 3 hits → 1 net

> **Ganger-1 — soak** — 14 dice (BOD + armour) [3 5 4 2 2 3 6 1 5 2 4 2 4 2] → 3 hits → **6 boxes** of stun

Second action of the turn, and Torque burns a point of Edge to push it: three more dice, every six rolls again, and the pistol's Accuracy stops applying for one shot.

> **Torque — Push the Limit** — 12+3 dice [2 6 6 3 4 6 6 2 3 3 6 5 4 3 4] → 7 hits · rule of six: 3 2 4 6 1 1

> **Ganger-1 — the receipt** — physical 10/10, wound modifier -5, defence 7 → 2

Sparrow spends a point of Edge to get in front of the whole shed — the tracker moves her to the top of the pass on the spot (9 → 9) and gives her the action back. Torque blitzes hers: five dice instead of two, [5 3 1 2 4], initiative 23. Both points come off the sheets and both spends say so in the log.

> **Whisper — one die on the ladder** — [1] → **CRITICAL**, bought off with a point of Edge

She misses the rung. The app calls it a critical glitch, she spends the Edge to make it a near thing instead — and the roll on the record still says what it said. The spend is a new line, not an edit: that is what an append-only log is for.

Whisper puts a Neural Spike through the pallet rows at Force 4 — the cast limited by the Force she chose, the shed's dim light already docked off her pool — and then pays for it, because the app rolls the Drain right behind the spell without being asked.

> **Whisper — Neural Spike, Force 4** — 13 dice [5 3 3 1 4 5 2 4 3 3 4 5 4] → 3 hits vs WIL [2 5 4 2] → 1 hits → 6 Stun

> **Whisper — Drain** — 11 dice against DV 2 [5 5 5 6 6 2 2 2 2 5 6] → 7 hits → 0 Stun to the caster

Somebody swings at Sparrow on their way past and she interrupts to dodge. The cost comes off her Initiative Score the instant she declares it — no note in a margin, no argument about it three actions later.

> **Sparrow — Dodge (interrupt)** — Initiative Score 9 → 4

> **Ganger-3 · Noor Haddad — Cut-down dock gun at Torque** — 4 dice [3 3 5 2] → 1 hits vs Torque's defence [3 4 1 4 1 1 1] → 0 hits · **CRITICAL**

Torque takes 6 boxes of stun and her own phone updates before the GM has finished saying so. Nobody else's does.

Sparrow crosses four metres of oil-slick concrete without appearing to hurry and puts the second one through a pallet stack.

Two of the four are on the floor. The tracker does not decide anything — it says, quietly and only to the GM: *fall back*. The GM decides.

Whisper spends one of Ash-of-Kettles’ two services and the count drops on every screen at once, with the instruction attached to it. The spirit goes on the tracker as an ordinary row — Force 4 in, initiative 11 + 2d6 out, derived by the same engine that does the runners — and the phones can see her, because a summoned spirit is not the GM’s secret.

She asks for nine more services out of habit. She gets the one she is owed and is told, plainly, that she is eight short. The same floor holds under the reagent tin: ninety-nine drams out of four leaves four spent and ninety-five owed to nobody.

And the brass ring on her hand is not a line on the gear list. Switched off, the casting pool falls from **13** to **11** and the receipt stops mentioning it; break the bond and the toggle does nothing at all. Two gates, both real, both visible in the same tooltip that answers "why is my pool 11?".

Ratchet never comes down the stair. She calls it off, and the shed goes quiet enough to hear the tide horn. The crate is still in the aisle, mislabelled *hydroponics, fragile*, and nobody on either side has stopped breathing.

### Between the fight and the paperwork — what the log actually says

Sparrow rolls 5 dice against the noise off the water and the card lands on every screen at once — 3 hits, the same event id on the socket and in the log the GM reloads. The line about the north cleat lands under it, and the date on the header rolls over to 2076-06-13. Nothing here is a live-only flourish: close the page, open it again, and the whole beat is still there, because the log IS the record.

Between the pier and the settle-up the GM stages next week’s opposition off the same gang template, and — because it is nearly one in the morning — switches on the tactical hints she has ignored all campaign. The acting row now carries one line of the kind a co-GM would mutter: *mob the nearest target — numbers are the only edge this crew has* — tagged with the role tag it came from, so she can see why she got it.

It is text and nothing else. There is no button on it, no roll behind it and no row it writes; the phone three feet away gets a 403 for asking and does not learn the sentence from the refusal either. She turns it off again before the end of the beat, which is where the FR says it lives by default.

### After — the housekeeping beat, while everyone is still connected

Nobody stopped breathing on either side, so the bonus karma stands. Each runner proposes their own award on their own phone, the GM posts the job's payout from the run page, and six pending rows queue up on her screen — the three from the job carrying the job. She approves them in one pass and the balances move: 4 karma each, 8,000¥ across the crew, every row with a reason attached.

The crate moves, and the GM draws from *Docklands complications*: “The crate is warm and something inside it is answering pings.”

**Recap headlines:** 13 rolls at the table · best result: 7 hits · 1 critical glitch

The GM closes the session. 25 rolls are on the record with their pools, their receipts and who could see them — the copilot's three-card exchanges among them — and the recap is written, edited and posted before anyone has found their coat.

### After the settle-up — the probe nobody at the table sees

With the session closed, the harness does something the table never would: it breaks the event log on purpose, one event type at a time, and tries to move money, fill a monitor and advance the calendar while it is broken.

All three refuse, by name — *event_append_failed*, naming the event that could not be written — and, more importantly, all three leave nothing behind: no ledger row, no filled box, no moved date. That is the defect that started this: a roll that was in the database and on nobody’s screen, with nothing anywhere that could ever notice the difference. The moment the fault clears, the same calls go through.

### The morning after — the GM restarts the box

The last thing the harness does is the thing every real deployment does: it stops the server, lets go of the database, and starts the whole stack again on the same directory.

Everything the table earned is still there — balances, the macro rack, the published recap, Ash-of-Kettles with nothing left to give — and the Fixer's meter still reads 1,261 tokens across 4 turns, because it counts rows on disk rather than a number in a process. The "since this server started" half reads zero, which is the only honest thing it could say.

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
| 10 | the QR encodes the SPA join screen, never the API endpoint (LIVE-3) | `a URL ending /join/<code>, with no /api/join/ in it` | `http://192.168.4.26:50293/join/VF7JGNNQ` | yes |
| 11 | …and it is a real scannable image | `a base64 PNG data URL` | `data:image/png;base64,… (4170 chars)` | yes |
| 12 | GET /join/:code is not an API route any more — no token in the response | `no "token" anywhere in the body` | `404 · {"error":{"code":"not_found","message":"route GET /join/VF7J` | yes |
| 13 | …and the scan did not burn the code: /api/join/:code still mints the device | `role observer, a long-lived token` | `observer · 43-char token` | yes |
| 14 | a player invite refuses to mint a GM device | `400 bad_request — 'gm' is not in the invite role enum` | `400 · {"error":{"code":"bad_request","message":"invalid request body","details":[{"cod` | yes |
| 15 | …and a player device cannot mint a pairing code either | `403` | `403` | yes |
| 16 | the GM mints a pairing code for a second laptop | `gm` | `gm` | yes |
| 17 | …short-lived by construction | `expires inside the hour` | `10 minutes` | yes |
| 18 | …and it too points at the join screen | `a URL ending /join/<code>` | `http://192.168.4.26:50293/join/QZANZCZW` | yes |
| 19 | redeeming it mints a gm device | `gm` | `gm` | yes |
| 20 | …bound to the SAME GM identity, not a new user | `2057e88a-b233-4569-9689-f070a118fb04` | `2057e88a-b233-4569-9689-f070a118fb04` | yes |
| 21 | …and the borrowed laptop really is the GM | `201` | `201` | yes |
| 22 | a pairing code is single-use | `410 invite_exhausted on the second scan` | `410 · {"error":{"code":"invite_exhausted","message":"this join cod` | yes |
| | **1c · Personal macros (FR2.8)** | | | |
| 23 | a runner opens the session with an empty rack | `0` | `0` | yes |
| 24 | two buttons on it a moment later | `2` | `2` | yes |
| 25 | …each one carrying its own pool, limit and visibility | `Suppressive fire at 11 dice, accuracy 5, public` | `Suppressive fire — Hammer: 11 dice, accuracy 5, public` | yes |
| 26 | pushing the same rack twice converges instead of duplicating | `still two macros, same id` | `2 macro(s), id unchanged` | yes |
| 27 | the GM pairs a second device to the same identity (FR1.1) | `a new device token bound to the same user` | `device f1a08ab4… user unchanged` | yes |
| 28 | the macro made on one device is there on the second one (FR2.8) | `the same macro, same id, same pool — a different token entirely` | `Ganger perception — the whole shed @7` | yes |
| 29 | …and firing it from there puts the macro’s own pool on the record | `the rolled dice equal the stored pool, the macro named in the receipt` | `7 dice → 7 faces · macro — Ganger perception` | yes |
| 30 | the GM's own rack holds only the GM's macro | `one macro, and none of Torque’s` | `Ganger perception — the whole shed` | yes |
| 31 | …and another runner's phone cannot see Torque's either | `an empty rack for Sparrow` | `0 macro(s)` | yes |
| 32 | …and a guessed id from someone else's rack is a 404, not a read | `404` | `404` | yes |
| | **2 · The codex, a contact, the job** | | | |
| 33 | the GM writes a codex page and shares it with the table | `public` | `public` | yes |
| 34 | a player's copy of the page does not contain the GM-only section | `neither the heading nor its prose anywhere in the payload` | `1 section(s), 367 chars of markdown` | yes |
| 35 | …while the public section is right there | `the street-level section present` | `present` | yes |
| 36 | …and the GM sees the whole thing | `the secret paragraph present for the GM` | `present` | yes |
| 37 | revealing the section announces it to the table | `what-ratchet-is-actually-selling` | `what-ratchet-is-actually-selling` | yes |
| 38 | …and only then does the phone receive the words | `the secret paragraph now present for the player` | `present` | yes |
| 39 | the page is findable in the codex | `the Rusted Halo page in a title/body search` | `found` | yes |
| 40 | the contact reads back on the sheet's own route | `Mr. Pell at Connection 4 / Loyalty 2, one favour owing` | `Mr. Pell C4/L2 owing 1` | yes |
| 41 | …and another runner's phone cannot read it | `403` | `403` | yes |
| 42 | the GM pins a beat to the in-game calendar | `present on the GM calendar` | `present` | yes |
| 43 | …and it is not on the players' calendar | `absent for a player` | `absent` | yes |
| 44 | the run is on the GM screen with its brief | `one run, state prep` | `Static on the Line (prep)` | yes |
| 45 | …and an unfinished job is not on a player list at all | `no runs for a player yet` | `0 run(s)` | yes |
| 46 | …so the GM writes the brief onto it | `two objectives and an 8,000¥ / 4 karma payout` | `2 objective(s) · 8000¥ / 4 karma` | yes |
| 47 | the archetype template is linked to the codex page that describes it (FR5.6) | `the template naming the page, with its role tags` | `Rusted Halo ganger → page matched · tags ganger, muscle, street, docklands` | yes |
| 48 | …and the page resolves back to it, so the two are one graph | `the template listed on the page` | `Rusted Halo ganger` | yes |
| 49 | …on the template row itself, not in a join table | `a596a623-f9c7-4ee9-8f85-c529e043e7bd` | `a596a623-f9c7-4ee9-8f85-c529e043e7bd` | yes |
| 50 | …and a player’s copy of a shared page carries no opposition at all | `no templates key on the phone’s payload` | `absent` | yes |
| 51 | every one of those writes is on the log the session replays from | `the reveal in the campaign event stream` | `present` | yes |
| | **3 · Scene, fog and secrecy** | | | |
| 52 | scene.activated reaches the TV and the phones | `both` | `both` | yes |
| 53 | Perception breakdown carries the dim-light scene modifier | `one 'scene' entry, value −1` | `environment: light 1 → light (-1) -1` | yes |
| 54 | …and the pool is the sum of its own receipt | `5` | `5` | yes |
| 55 | the sheet and the roll agree on the pool (LIVE-2: they did not) | `5` | `5` | yes |
| 56 | the persisted receipt names the scene exactly once | `one 'scene' entry` | `environment: light 1 → light (-1) -1` | yes |
| 57 | a client that re-sends the scene as a chip does not pay for it twice | `pool 5, one 'scene' entry` | `pool 5, 1 scene entry` | yes |
| 58 | …and that roll still sums to its own receipt | `5` | `5` | yes |
| 59 | a receipt that names the scene twice is repaired, and the dice are given back | `one 'scene' entry, pool 5` | `1 scene entry, pool 5` | yes |
| 60 | …and it too sums to its own receipt | `5` | `5` | yes |
| 61 | …and the log records what it refused, rather than quietly fixing it | `a 'dedupedScene' note on the stored roll` | `[{"label":"environment: light 1 → light (-1)","value":-1}]` | yes |
| 62 | player scene shows only the revealed region | `["Loading Dock"]` | `["Loading Dock"]` | yes |
| 63 | player scene carries only the three PC tokens | `3` | `3` | yes |
| 64 | GM sees the staged opposition | `5` | `5` | yes |
| 65 | no hidden token name or coordinate ever hit a player socket | `none` | `none` | yes |
| 66 | fog.updated reaches the TV as a reveal | `reveal` | `reveal` | yes |
| 67 | player scene now includes Main Floor | `["Loading Dock","Main Floor"]` | `["Loading Dock","Main Floor"]` | yes |
| 68 | revealing a hidden token arrives as token.added | `ac10d493-e186-47dd-8d74-d1f3b9a9c280` | `ac10d493-e186-47dd-8d74-d1f3b9a9c280` | yes |
| 69 | …and only then does it appear in the player payload | `4` | `4` | yes |
| 70 | a token at an unrevealed region nudges the GM (FR12.8) | `Sparrow, ~2 m from the Office, inside the 3 m ring` | `Sparrow → Office at 2 m` | yes |
| 71 | …and it suggests, it never reveals | `a pointer at suggest_fog_reveal, sent ephemerally` | `suggest_fog_reveal · ephemeral true` | yes |
| 72 | …so the Office is still fogged on the phones | `no Office region in the player payload` | `Loading Dock, Main Floor` | yes |
| 73 | the prompt reaches no player or display socket at all | `none` | `none` | yes |
| 74 | …which matters, because it names the tokens they cannot see | `at least one prompt about a hidden token` | `Halo ganger — catwalk, east → Catwalk · Ratchet — catwalk → Catwalk · Halo ganger — office door → Office` | yes |
| 75 | …and it is never written down, so a replay cannot leak it either | `no fixer.suggestion in the persisted event log` | `absent` | yes |
| 76 | the token walks back and the server has the final say on where it is | `{"x":4,"y":7}` | `{"x":4,"y":7}` | yes |
| | **4 · The Fixer (mock inference box)** | | | |
| 77 | AI entry points switch on with LLM_BASE_URL set | `true` | `true` | yes |
| 78 | the vision probe reports cleanly on a model with no image support (FR12.11) | `supported false, via 'probe', with a reason the GM can read` | `supported false · via probe · model mock-primary · “the model refused an image content part — map vision stays hidden”` | yes |
| 79 | …and it is an answer, not an outage: the rest of the Fixer is on | `enabled true beside vision false` | `enabled true, vision false` | yes |
| 80 | the map-vision lane refuses by name rather than pretending | `501 vision_unsupported, explaining which box and which model` | `501 vision_unsupported: this inference box cannot read images — the model refused an image content part — map vision stays hidden` | yes |
| 81 | the model reached for get_scene | `["get_scene"]` | `["get_scene"]` | yes |
| 82 | …and the tool ran | `true` | `true` | yes |
| 83 | the tool answered from live state, not from the prompt | `all five staged tokens, and the reveal we made a minute ago` | `5/5 token names · Main Floor revealed: true` | yes |
| 84 | the answer quotes the live count back | `a sentence naming 4 hidden tokens` | `Four bodies and a lieutenant, 4 still hidden on your side of the fog. The one on the catwalk is the one to worry about: she has the only working keycard and th…` | yes |
| 85 | a live session prefixes the situation snapshot (FR12.18) | `true` | `true` | yes |
| 86 | the model is never offered the tool this box cannot run (FR12.11) | `read_map_image absent from the tools sent to the model` | `26 tools offered, read_map_image withheld` | yes |
| 87 | the catalog now covers the FR12.17 rows the codex was blocking | `search_codex, get_page, list_contacts, list_runs, get_calendar` | `search_codex, get_page, list_contacts, list_runs, get_calendar` | yes |
| 88 | …and every one of them is declared read-only | `kind read` | `search_codex:read get_page:read list_contacts:read list_runs:read get_calendar:read` | yes |
| 89 | one turn reaches all four of them | `["search_codex","list_contacts","list_runs","get_calendar"]` | `["search_codex","list_contacts","list_runs","get_calendar"]` | yes |
| 90 | …and all four ran | `every tool ok` | `search_codex:true list_contacts:true list_runs:true get_calendar:true` | yes |
| 91 | search_codex finds the page the GM wrote ten minutes ago | `a hit titled "The Rusted Halo"` | `The Rusted Halo (gmOnly false)` | yes |
| 92 | list_contacts reads the contact off the live sheet, favours and all | `Mr. Pell, Connection 4, one favour owing, read from the structured field` | `Mr. Pell C4 owing 1 (structured)` | yes |
| 93 | list_runs knows the job, its state, its Johnson page and its agreed payout | `Static on the Line, prep, 8,000¥, linked to the gang page` | `Static on the Line (prep) 8000¥ · Johnson "The Rusted Halo"` | yes |
| 94 | get_calendar carries the in-game date, the pinned beat and the rent | `2076-06-12, the hand-over beat, three lifestyles` | `2076-06-12 · Hand-over at the noodle counter · 3 lifestyle(s)` | yes |
| 95 | reads are free — nothing the four tools did left a draft behind | `no new ai_generations rows` | `0 generation(s)` | yes |
| 96 | …and only the GM ever talks to it | `403` | `403` | yes |
| 97 | the core rulebook is registered at its measured page offset | `5` | `5` | yes |
| 98 | …and shared with the whole table (FR11.5) | `true` | `true` | yes |
| 99 | a player can search the library and gets real page provenance | `hits carrying {book, printed page} and a reader URL` | `SR5 p.2, SR5 p.52, SR5 p.5` | yes |
| 100 | the same seed reproduces the same ganger, bone for bone | `byte-identical NPC` | `Fatima Benali vs Fatima Benali` | yes |
| 101 | …and three different seeds are three different people | `three distinct names` | `Fatima Benali, Dmitri Volkov, Noor Haddad` | yes |
| 102 | the GM opens a blank scene for next week | `draft` | `draft` | yes |
| 103 | the model reached for propose_geometry | `["propose_geometry"]` | `["propose_geometry"]` | yes |
| 104 | the layout lands as an ai_generations DRAFT, never on the scene | `kind geometry, status draft` | `geometry / draft` | yes |
| 105 | it is grid-true: whole squares, and metres from the scene's own grid | `every room an integer number of 1 m squares, area = w × h` | `Lobby 14×10 m · Security checkpoint 8×10 m · Server room 10×12 m · Exec office 12×9 m` | yes |
| 106 | …and it compiled walls, doors and unrevealed fog regions the Grid can draw | `walls + doors + one named fog region per room` | `19 walls · 4 doors · Lobby, Security checkpoint, Server room, Exec office` | yes |
| 107 | nothing had to be clamped off the plate | `[]` | `[]` | yes |
| 108 | the scene itself is untouched until the GM accepts (Principle 8) | `still an empty plate: 0 walls, 0 doors, 0 fog regions` | `0 walls · 0 doors · 0 regions` | yes |
| 109 | and the GM can reach it with no inference box configured at all (NG7) | `a draft straight off the deterministic route` | `draft · 1 room(s)` | yes |
| | **5 · The extraction firefight** | | | |
| 110 | every character/NPC token on the map became a combatant | `8` | `8` | yes |
| 111 | the phones see only what has been revealed | `4` | `4` | yes |
| 112 | the four hidden rows are absent, not redacted | `no still-hidden name anywhere in the player payload` | `none` | yes |
| 113 | a PC staged off the map keeps her augmented initiative dice | `Torque 8 + 2d6, as the engine derives her` | `8 + 2d6` | yes |
| 114 | …and every staged line is the engine's, not REA + INT + 1d6 | `three lines matching GET /derived` | `Torque 8+2d6 · Whisper 8+1d6 · Sparrow 11+2d6` | yes |
| 115 | …so the three of them are not one flat number | `more than one distinct initiative line` | `8+2, 8+1, 11+2` | yes |
| 116 | four rolled gangers stand the shed up | `4` | `4` | yes |
| 117 | an unhurt ganger carries no wound modifier | `0` | `0` | yes |
| 118 | a combatant added with a sheet derives its own monitors | `physical track sized from BOD` | `10/11/10/11` | yes |
| 119 | a hand-added NPC carries its own Professional Rating (FR4.6) | `the template's blooded PR (2), on the row` | `{"professionalRating":2}` | yes |
| 120 | a freshly-rolled encounter is on turn 1, pass 1 (FR4.3) | `turn 1 / pass 1` | `staged at turn 0 / pass 0 → rolled to turn 1 / pass 1` | yes |
| 121 | Torque rolls two initiative dice (wired reflexes) | `2` | `2` | yes |
| 122 | …on the engine-derived base REA+INT | `8` | `8` | yes |
| 123 | Sparrow rolls two as well (Quickened Reflexes) | `2` | `2` | yes |
| 124 | Whisper, unaugmented, rolls one | `1` | `1` | yes |
| 125 | the highest Initiative Score acts first | `43e8fcc0-f1aa-4f7a-b0c6-217beb554344` | `43e8fcc0-f1aa-4f7a-b0c6-217beb554344` | yes |
| 126 | everyone above 0 acts exactly once in the pass | `7` | `7` | yes |
| 127 | end of pass takes 10 off every score | `score − 10, floored at 0` | `every row` | yes |
| 128 | the pass counter advances | `2` | `2` | yes |
| 129 | …from a first pass the tracker was counting all along | `turn 1 / pass 1 before the drop` | `turn 1 / pass 1` | yes |
| 130 | Torque acts twice in turn 1 | `still above 0 after −10` | `16 → 6` | yes |
| 131 | the chain walks attack → defense | `["attack","defense"]` | `["attack","defense"]` | yes |
| 132 | the attack is capped by the weapon's Accuracy | `{"kind":"accuracy","value":5}` | `{"kind":"accuracy","value":5}` | yes |
| 133 | the shot carries the scene and the range band in its receipt | `a 'scene' −1 and a 'range' −1 (medium, heavy pistol)` | `environment: light 1 → light (-1) -1 · medium range (9.5 m, heavy_pistol) -1` | yes |
| 134 | net hits are the attacker's limited hits minus the defence | `1` | `1` | yes |
| 135 | modified DV is the weapon's DV plus net hits | `9` | `9` | yes |
| 136 | boxes are modified DV minus soak hits | `6` | `6` | yes |
| 137 | nothing is written until the GM commits the card | `true` | `true` | yes |
| 138 | the boxes land on the right monitor | `6` | `6` | yes |
| 139 | the chain persists every pool it threw | `["attack","defense","soak"]` | `["attack","defense","soak"]` | yes |
| 140 | …and the roll log grew by at least that many rows | `4 → at least 7` | `4 → 9` | yes |
| 141 | every one of them is behind the screen and stamped with the chain | `visibility gm, chainId 91822f3a-3b13-4359-8512-b80a0914dfdc` | `attack:gm defense:gm soak:gm` | yes |
| 142 | …and the faces on the record are the faces on the card | `the attack card and its stored row agree, die for die` | `[5,3,1,4,6,2,6,6,2,1,1]` | yes |
| 143 | …and no phone can read them (FR2.7) | `none of the chain rows in a player roll log` | `absent` | yes |
| 144 | …not even by id | `404` | `404` | yes |
| 145 | Push the Limit adds the Edge dice to the pool | `15` | `15` | yes |
| 146 | …and ignores the Accuracy limit entirely | `7` | `7` | yes |
| 147 | …and every six rolls again (Rule of Six) | `at least 5 exploded dice` | `3 2 4 6 1 1` | yes |
| 148 | every copilot roll is stamped with the running session | `6 rolls carrying session 83adb8ec…` | `6/6` | yes |
| 149 | …so they are in the session's own roll log, not floating beside it | `every copilot roll in GET …/rolls?session=` | `6/6` | yes |
| 150 | damage-from-roll is (DV + net) − soak | `11` | `11` | yes |
| 151 | the ganger's wound modifier recomputes from the filled boxes | `-5` | `-5` | yes |
| 152 | and his next defence pool is that much smaller | `7 -5 = 2` | `7 → 2` | yes |
| 153 | Seize the Initiative puts the actor above everyone still in the pass | `strictly above 6` | `9 → 9 (beat 6)` | yes |
| 154 | …and hands the action back — she has not acted this pass | `false` | `false` | yes |
| 155 | …and it costs exactly one point of Edge | `4` | `4` | yes |
| 156 | …debited on the sheet itself, not in a note | `4` | `4` | yes |
| 157 | Blitz rolls the SR5 ceiling of five initiative dice | `5` | `5` | yes |
| 158 | …and the score is base + those five dice + the wound modifier | `8 + 5+3+1+2+4 0 = 23` | `23 (tracker says 23)` | yes |
| 159 | …having bought only the dice her wired reflexes did not already give her | `5 − 2 = 3 bought` | `3 bought over a normal 2d6` | yes |
| 160 | …and it costs one Edge too | `2` | `2` | yes |
| 161 | every spend announces itself, loudly, by name (FR2.3) | `log lines naming Seize the Initiative and Blitz, with the Edge left` | `Sparrow spends 1 Edge — Seize the Initiative: initiative 9 → 9, ahead of 6 (4/5 left) \| Torque spends 1 Edge — Blitz: 5d6 [5, 3, 1, 2, 4] → initiative 23 (2/3 …` | yes |
| 162 | Close Call buys off a glitch after the dice have landed | `the critical negated` | `critical → none` | yes |
| 163 | …for one point of Edge | `2` | `2` | yes |
| 164 | …without editing the roll: the record still says it glitched (G5) | `the stored row still critical, same faces` | `critical · [1]` | yes |
| 165 | …and nobody else may spend another runner's Edge | `403` | `403` | yes |
| 166 | a roll that did not glitch has nothing to sell | `400 no_glitch` | `400 · {"error":{"code":"no_glitch","message":"that roll did not glitch — not` | yes |
| 167 | the cast is limited by its Force | `4` | `4` | yes |
| 168 | the shed's dim light is in the casting pool too | `a 'scene' −1` | `-1` | yes |
| 169 | the spike lands as Stun | `6` | `6` | yes |
| 170 | a Drain resistance roll follows the cast | `threshold 2` | `2` | yes |
| 171 | the unresisted margin lands on the caster's Stun track | `0` | `0` | yes |
| 172 | Dodge costs 5 off the Initiative Score, immediately | `4` | `4` | yes |
| 173 | a three-round burst pays uncompensated recoil | `a negative 'recoil' entry` | `none of the shooters drew a burst-capable weapon from the loadout table` | n/a |
| 174 | damage in the tracker mirrors to the owner's sheet — and only the owner | `sheet.updated at gm_owner visibility on Torque's phone` | `gm_owner · physical 0/11 stun 6` | yes |
| 175 | …nobody else's phone got it | `no monitor mirror for Torque elsewhere` | `none` | yes |
| 176 | two of four down fires the morale suggestion | `a morale report` | `["first casualty","at half strength"]` | yes |
| 177 | …because the squad is at half strength | `reasons include "at half strength"` | `first casualty, at half strength` | yes |
| 178 | …and it is measured against a real Professional Rating, not 0 (FR4.6) | `a non-zero threshold on a hand-added NPC row` | `pressure 4 vs PR 3` | yes |
| 179 | the suggestion is logged GM-only, never acted on | `a gm-visibility log line` | `4 line(s), visibility gm` | yes |
| 180 | …and the players never see the prompt | `absent` | `absent` | yes |
| | **5b · The mage’s bookkeeping (FR8.3/FR8.4)** | | | |
| 181 | the mage opens the session with a bound spirit and services owed | `Ash-of-Kettles, bound, Force 4, 2 services` | `Ash-of-Kettles bound F4, 2 service(s)` | yes |
| 182 | spending a service drops the count by exactly one | `spent 1, 1 remaining of 2` | `spent 1, 1 of 2 remaining` | yes |
| 183 | …and the log carries what the spirit was told to do | `a magic.updated line naming the spend and its reason` | `spirit.service.spend · remaining 1 · “Materialise in the aisle and stand between them”` | yes |
| 184 | …on the summoner’s own phone too — her spirit is not GM-only | `the same frame on Whisper’s socket` | `public` | yes |
| 185 | the spirit joins the encounter as an ordinary combatant | `a tracker row linked back to the spirit` | `Ash-of-Kettles · combatantId on the spirit: set` | yes |
| 186 | …with a Force-derived initiative line, not a hand-typed one | `11 + 2d6, exactly as the engine derives Force 4` | `11 + 2d6` | yes |
| 187 | …and those extra dice show where they came from (Principle 3) | `a 'spirit form' line in the initiative receipt` | `1d6 +1 · fire spirit — 2d6 initiative +1` | yes |
| 188 | …and the phones can see her: a summoned spirit is not hidden opposition | `Ash-of-Kettles on the player roster` | `Torque, Whisper, Sparrow, Ganger-1 · Fatima Benali, Ash-of-Kettles` | yes |
| 189 | asking for more services than are owed is a shortfall, never a loan | `1 spent, 8 short, 0 remaining — and never a negative count` | `spent 1, short 8, remaining 0` | yes |
| 190 | the bonded focus is in the casting pool, and says so in the receipt | `a +2 line naming the focus` | `Kettle-ring — A band of scorched brass. Warm to the touch when she is holding something up. +2` | yes |
| 191 | switching it off moves the derived pool the same instant | `spellcasting 13 → 11` | `13 → 11` | yes |
| 192 | …and the line leaves the receipt with it — no orphan provenance | `no focus line in the pool’s breakdown` | `gone` | yes |
| 193 | an unbonded focus is inert however switched-on it looks (FR8.4) | `still 11 with the toggle on but the bond broken` | `active, unbonded → 11` | yes |
| 194 | bonding it again restores the pool | `13` | `13` | yes |
| 195 | two drams of reagents go into the Neural Spike | `6 → 4` | `6 → 4` | yes |
| 196 | reagents cannot go negative — the overspend is reported, not borrowed | `floors at 0, short 95` | `4 → 0, short 95` | yes |
| 197 | …and restocking counts back up from the floor | `4` | `4` | yes |
| | **5c · Ratchet calls it off** | | | |
| 198 | the GM ends the encounter on that call | `done` | `done` | yes |
| | **5b · The shared log** | | | |
| 199 | the log is not empty before the beat starts | `events already on the record` | `153 events, newest id 153` | yes |
| 200 | the roll is on the immutable record | `present in GET /api/campaigns/:id/rolls` | `present` | yes |
| 201 | …and on the shared log the GM reads back | `a roll.created event carrying the roll's id` | `event 154` | yes |
| 202 | …so the log has actually grown since the beat began | `an event id above 153` | `154` | yes |
| 203 | …and on the player's own log, because a public roll is the table's | `roll.created present on the phone's read` | `present` | yes |
| 204 | …and it reached the live socket as the same event id | `frame id 154` | `154` | yes |
| 205 | table talk from a phone appends to the same log | `event 155 readable back` | `present` | yes |
| 206 | the GM advances the in-game clock | `2076-06-13` | `2076-06-13` | yes |
| 207 | …and the log carries the clock tick as table-visible history (§11) | `a clock.advanced event naming the new date` | `event 156` | yes |
| | **6 · Tactical hints (FR10.10)** | | | |
| 208 | a campaign that never asked for hints never sees one (FR10.10 default) | `a quick-roll rack with no hint on it` | `12 rack entries, no hint` | yes |
| 209 | switching it on puts one line on the acting NPC’s row | `a hint tagged with the role it came from` | `ganger: “mob the nearest target — numbers are the only edge this crew has”` | yes |
| 210 | …and it says where it came from (Principle 3) | `a 'why' naming the template’s role tag` | `role tag "ganger"` | yes |
| 211 | …and carries no verb: it is text that marks itself advisory | `exactly advisoryOnly, roleTag, text, why — nothing to "apply"` | `advisoryOnly, roleTag, text, why` | yes |
| 212 | a player asking for the same row is refused, and told nothing | `403, with no hint text in the refusal` | `403 · {"error":{"code":"forbidden","message":"requires role: gm"}}` | yes |
| 213 | …and the hint appears nowhere in what a phone is handed | `no hint text anywhere in the player’s encounter payload` | `0 row(s) visible, no hint` | yes |
| 214 | turning it off is the end of it, not a hidden div | `no hint on the GM’s own rack` | `gone` | yes |
| 215 | a combatant the GM typed in by hand gets silence, not a guess | `no hint for a row with no template behind it` | `silent` | yes |
| | **7 · Wrap** | | | |
| 216 | Torque's own karma claim lands pending | `pending` | `pending` | yes |
| 217 | Whisper's own karma claim lands pending | `pending` | `pending` | yes |
| 218 | Sparrow's own karma claim lands pending | `pending` | `pending` | yes |
| 219 | the job posts its payout to the ledger (FR5.5) | `3` | `3` | yes |
| 220 | …as pending rows, not as money (FR5.5 → FR3.6) | `state pending on every one` | `pending` | yes |
| 221 | …and the run itself records what it paid | `8000` | `8000` | yes |
| 222 | six proposals wait on the GM | `6` | `6` | yes |
| 223 | …and the three from the job carry the job that earned them | `runId on the three nuyen rows` | `3 of 6 linked` | yes |
| 224 | …and the housekeeping beat is holding exactly those six | `6` | `6` | yes |
| 225 | Torque's karma balance after approval | `4` | `4` | yes |
| 226 | Whisper's karma balance after approval | `4` | `4` | yes |
| 227 | Sparrow's karma balance after approval | `4` | `4` | yes |
| 228 | the crew is paid exactly the agreed 8,000¥ | `8000` | `8000` | yes |
| 229 | and 4 karma each | `12` | `12` | yes |
| 230 | the table draw lands in the log | `present for the GM` | `present` | yes |
| 231 | …and a GM-only table stays GM-only | `absent for players` | `absent` | yes |
| 232 | the Fixer reads the log, then drafts the recap through draft_recap (FR12.12) | `["get_session_log","draft_recap"]` | `["get_session_log","draft_recap"]` | yes |
| 233 | nothing was applied — it is an ai_generations draft | `kind recap, status draft` | `recap / draft` | yes |
| 234 | …whose numbers came off the log, not out of the model (D13) | `the roll tally and the award lines assembled server-side` | `13 public rolls · 3 award line(s) in the body` | yes |
| 235 | the spoiler guard caught the GM-only name in it (FR12.19) | `a flag naming "Halo ganger — pallet rows"` | `Halo ganger — pallet rows` | yes |
| 236 | …and it never auto-applied: the session still holds whatever the GM last wrote | `session.recapMd untouched by the draft` | `unchanged` | yes |
| 237 | accepting it writes the draft onto the session, and no further | `game_sessions` | `game_sessions` | yes |
| 238 | …the session it was actually about | `83adb8ec-ef7c-49db-a24f-e6a2c3039fe2` | `83adb8ec-ef7c-49db-a24f-e6a2c3039fe2` | yes |
| 239 | …and publishing to Discord is still a separate GM action (Principle 8) | `the markdown on the session, still unpublished` | `1304 chars on game_sessions.recap_md` | yes |
| 240 | the GM publishes the edited recap | `true` | `true` | yes |
| 241 | …with no webhook configured, nothing leaves the laptop | `skipped` | `skipped` | yes |
| 242 | session ends → live mode off | `false` | `false` | yes |
| 243 | the session log counted the whole night, copilot dice included | `every persisted roll accounted for by the session` | `25 of 25 persisted rolls, 0 glitches` | yes |
| | **8 · Half-commit probes (LIVE-4)** | | | |
| 244 | a ledger write that cannot be announced fails loudly | `500 event_append_failed, naming ledger.changed, no SQL in the message` | `500 event_append_failed: could not record the 'ledger.changed' event; the change was not saved` | yes |
| 245 | …and leaves NO orphan entry behind (the LIVE-4 shape, on money) | `still 6 ledger rows` | `6 rows` | yes |
| 246 | damage that cannot be announced fails the same way | `500 event_append_failed, naming combatant.damaged` | `500 event_append_failed: could not record the 'combatant.damaged' event; the change was not saved` | yes |
| 247 | …and fills no boxes: no monitor moved that no screen was told about | `physical 0/10, unchanged` | `physical 0/10, stun 0` | yes |
| 248 | …and the identical call lands once the fault clears | `6` | `6` | yes |
| 249 | the clock refuses to move when the tick cannot be recorded | `500 event_append_failed, naming clock.advanced` | `500 event_append_failed: could not record the 'clock.advanced' event; the change was not saved` | yes |
| 250 | …and the in-game date does not move (FR5.7) | `still 2076-06-13` | `2076-06-13` | yes |
| 251 | …while an edit that announces nothing is untouched by the fault | `200` | `200` | yes |
| 252 | the probe leaves the database exactly as it found it | `0` | `0` | yes |
| | **9 · Restart (FR12.15 and everything else on disk)** | | | |
| 253 | the night’s Fixer turns are on the meter before the restart | `tokens counted, in both halves, reported as tokens+latency not money` | `4 turn(s) / 1261 tokens durable · 8 / 1261 this process · tokens+latency` | yes |
| 254 | …split by what the tokens bought | `a 'chat' bucket with a non-zero count` | `chat 1261` | yes |
| 255 | the server comes back on the same DATA_DIR and the old device token still works | `200, and the campaign it was seeded with` | `200 · Static on the Line` | yes |
| 256 | the durable usage meter survived the restart (FR12.15) | `4 turns / 1261 tokens, unchanged` | `4 turns / 1261 tokens` | yes |
| 257 | …and it can still say since when, so the number reads honestly | `the same first-counted timestamp` | `2026-08-29T18:17:51.126Z` | yes |
| 258 | …while the per-process half reads zero, which is what it is for | `0 calls since this server started` | `0 call(s) / 0 tokens` | yes |
| 259 | the two halves agree about tokens, which is the number that matters | `identical token totals across the durable and live meters before the reboot` | `1261 durable vs 1261 live (4 turns vs 8 model calls)` | yes |
| 260 | Torque's nuyen balance came back | `2667` | `2667` | yes |
| 261 | Whisper's nuyen balance came back | `2667` | `2667` | yes |
| 262 | Sparrow's nuyen balance came back | `2666` | `2666` | yes |
| 263 | the GM’s macro rack came back with it (FR2.8) | `1 macro(s), same ids` | `1 macro(s)` | yes |
| 264 | the published recap is still on the session | `the same markdown, and the session still closed` | `1305 chars · state done` | yes |
| 265 | the spirit’s spent services and the reagent tin came back too (FR8.3/8.4) | `Ash-of-Kettles at 0 services, 4 drams on the shelf` | `0 service(s) · {"eef37163-37ba-4fb4-b677-44aa8e1f6808":4}` | yes |
| 266 | and the event log takes the next id, not one already used | `an id above 183` | `event 185` | yes |

---

## Gaps this run found

- **FR10.10 reaches only the planner path.** `hintForCombatant` looks the template up through `copilot.generator.templateId`, which only `POST /api/encounters/build` and the grunt-group inserter write. A row added through `POST /api/encounters/:id/combatants` with `source: 'generated', sourceId: <templateId>` — how the pier fight's four gangers were built, and how the copilot rack is meant to be used — gets `copilot.generator = { professionalRating }` and no template, so it is silent even with hints switched on. One line in `EncountersService.addCombatant` (carry `sourceId` into `generator.templateId` when `source === 'generated'`) would close it; nothing here is wrong, it is just narrower than the FR reads.
- **`fixer/usage.ts` reports two different things as `calls`.** In one payload `GET /api/campaigns/:id/fixer/usage` returns `total.calls` = completed Fixer *turns* (one `ai_usage` row per turn) and `session.calls` = individual *model requests* (one `usageMeter.record` per round of the agent loop) — this run: 4 vs 8 for the same 1261 tokens. The token counts agree, so nothing is lost, but a GM panel that renders both as "calls" beside each other is showing two units under one label.

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
and open it on a phone before and after revealing it; link the *Rusted Halo*
archetype template to that page and watch it appear on the GM copy and on no
phone; build two macros on one device and read them back on a second one you
paired to the same account; activate **Pier 23 Warehouse** and roll a
Perception from a phone (the dim light is already in the pool — the dialog
shows it as context, never as a chip you add again); reveal *Main Floor*; drag
a token to the office door and watch the GM-only nudge appear; launch the
encounter from the scene, build the opposition from the *Rusted Halo* template
at **blooded**; spend Edge on Seize the Initiative, Blitz and a Close Call;
spend one of Ash-of-Kettles’ services and send her into the fight; flip the
Kettle-ring off and watch the spellcasting pool — and its tooltip — move; then
post the run award and settle karma and nuyen in the housekeeping beat before
you close the session, ask the Fixer for the recap, and read the spoiler flag
it comes back with.

Two of the beats above have no in-fiction equivalent and are the harness
talking to itself: the half-commit probe (which breaks `ws_events` on purpose,
one event type at a time, and checks that no ledger row, filled box or moved
date survives the fault) and the restart, which stops the server, closes
PGlite and boots the whole app again on the same `DATA_DIR` before asking the
same questions with the same device token. The second one you *can* do by
hand: `docker compose restart`, then reopen the Fixer’s usage panel.

Optional extras:

```bash
# register the rulebook PDFs sitting at the repo root (FR11.7)
pnpm seed:books -- --only SR5 --max-pages 60

# point the Fixer at a local OpenAI-compatible model (llama.cpp / vLLM)
# with LLM_BASE_URL unset every AI entry point simply hides (NG7)
LLM_BASE_URL=http://127.0.0.1:8080 pnpm dev:server
```
