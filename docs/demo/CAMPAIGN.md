# Static on the Line — the demo campaign

`pnpm seed:demo` builds one short, playable run so a fresh install has
something real to click on before any prep exists. It is the fixture the
platform is verified against: three engine-valid sheets, one mapped scene with
fog and hidden tokens, an archetype template, a named NPC with a persona, a
rollable table, and a run row with a payout attached.

Everything is **original fiction** — invented aliases, gangs, gear names,
districts and complications. No book text, no published stat blocks, no CGL
content (G6 / §14). `{ book: 'SR5', page: n }` references carry page *numbers*
only, the way a GM cites their own shelf. Range bands, prices and lifestyle
costs are ordinary game math typed in by hand, not transcriptions.

Source: `apps/server/seed/demo.ts` (+ `apps/server/seed/assets/`).

---

## The brief

**Employer.** A man who calls himself Mr. Pell. Meets at a shuttered noodle
counter under the skyway, pays for everyone, eats nothing, and will not say who
the buyer is. He is not the buyer either.

**The job.** Nine days ago a prototype survey drone — factory-tagged *WREN-3*,
about the size of a dog and worth more than the shed it sits in — came off a
container two piers early and never made it onto a manifest. It is now in
**Pier 23**, a leased transhipment shed in the Docklands that the **Rusted
Halo** took over when the lease-holder stopped paying anyone. It is in crate 9,
mislabelled *hydroponics, fragile*.

Steal it. Bring it out intact. Pell is not paying for wreckage and he is not
paying for a body count.

**Stakes.**

- The Halo's lieutenant has already taken a deposit from a *second* buyer, who
  arrives at 03:40 with four bodies and a boat idling at the pier head. After
  that the crate is gone and so is the job.
- The Docklands are quiet because nobody has had a reason to look. A firefight
  buys the pier a corporate response contract, and the Halo will remember who
  brought it.
- The lieutenant has a brother on the docks she is trying to get inland. She
  will trade the crate for a clean exit and travel money — if anyone thinks to
  ask her instead of shooting her.

**Payout.** 8,000¥ — 2,000¥ up front, 6,000¥ on hand-over — and **4 karma**.
The GM's stated bonus: +1 karma if the drone leaves the pier without anyone on
either side stopping breathing.

### Three beats

| # | Beat | What it is for |
| --- | --- | --- |
| 1 | **The meet** | Negotiation, the roll log, and the first look at a shared table. Pell opens at 6,000¥; the ask is 8,000¥. |
| 2 | **The infiltration** | The Grid: 1 m squares, dim light (−1), staged fog, hidden tokens the players' devices never receive coordinates for. |
| 3 | **The extraction firefight** | The combat tracker: initiative passes, the Rusted Halo template rolled fresh at *blooded*, the lieutenant, and one draw from *Docklands complications* the moment the crate moves. |

---

## The table

Three characters, hand-authored as full `SheetV1`s and matched to the real
group: a street sam, a mage, an adept. `GET /api/characters/:id/derived`
returns limits, condition monitors, all five initiative variants and a pool per
skill / weapon / spell — every number carrying its breakdown (Principle 3).

| Runner | Shape | The numbers that matter |
| --- | --- | --- |
| **Torque** | ork street samurai | Wired reflexes (first grade, 2.0 Essence): REA +1 and **+1 initiative die → 2d6**. Patched armoured jacket **12**, so soak is 18. Heavy pistol *"Hammer"* (`heavy_pistol` range category, 16 rounds), with an ocular targeting overlay that adds +2 to that weapon's pool and nothing else. |
| **Whisper** | elf hermetic mage | MAG 6, Spellcasting 6 → a 12-die casting pool. *Neural Spike* is the combat spell, **drain F−3**; *Hush* is the quiet one. Carries one **bound Force 4 spirit, 2 services left**. |
| **Sparrow** | human adept | *Quickened Reflexes* (1.5 PP): REA +1 and **+1 initiative die → 2d6**. *Iron Palm* makes the *Killing hands* line 5P. *Read the Room* puts **+2 on the defence pool** (13 before scene modifiers), *Soft Landing* +2 on Gymnastics. 3.5 of 5 power points spent. |

The seed prints each runner's derived initiative, physical limit, defence and
soak after it activates the scene — which is why the printed defence pools read
one lower than the sheet math: Pier 23's dim light is a live `scene` modifier on
`pool.all` (FR9.11), and it is doing its job.

## The opposition

**`Rusted Halo ganger`** is an *archetype template*, not a stat block: three
tiers of generation ranges — **street** (tag-along, PR 1–2), **blooded**
(PR 2–3) and **pro** (Halo proper, PR 3–4) — with metatype weights and loadout
slots that resolve against the template's own gear records. The engine rolls
every body inside those curves, so the four gangers in the shed are four
different people and the same seed reproduces them exactly (FR10.1/10.2).

**Marta "Ratchet" Vey** is the lieutenant: a second template carrying a full
statblock *and* a populated persona — goals, secrets, knowledge boundary, voice,
mannerisms, hooks — which is what "speak as this NPC" reads from (FR12.6). She
knows the rota, which crate is real, and that the east stair tread is rust. She
does not know what the drone does. She has not told anyone about the second
deposit.

**`Docklands complications`** is a GM-visibility weighted table with six
original entries, for the moment the crate moves.

## The scene

**Pier 23 Warehouse** — 30 × 20 m on a **1 m grid**, dim light (`light: 1`,
one tier, **−1**), with a floor plan **generated at seed time**: no binary art
in the repo, and no new dependency either. `assets/png.ts` is a ~180-line
stdlib PNG writer (`node:zlib` supplies the deflate stream `IDAT` wants), and
`assets/pier23.ts` draws the shed from the *same constants* that produce the
wall, door and zone geometry — so the picture and the collision data cannot
drift apart.

Walls, three doors (the chained roller door and the office maglock, both
locked until the GM says otherwise; the jammed-open freight door, which the
runners can shut and open themselves), six cover/hazard zones and four map
pins ship with it.

**Four named fog regions**, and only the first is revealed:

| Region | Revealed at seed | Reveal it when |
| --- | --- | --- |
| Loading Dock | ✅ | — the crew starts here |
| Main Floor | — | the freight door moves |
| Office | — | someone opens the maglock |
| Catwalk | — | someone looks up |

**Eight tokens.** Three PC tokens stand in the Loading Dock. Four Rusted Halo
gangers and Ratchet are placed hidden across the Main Floor and the Catwalk —
and *hidden* means the coordinates are filtered server-side and never reach a
player or display socket (Principle 4, FR9.7). Revealing one arrives on the
players' wire as `token.added`: a new thing walking in, not a position that was
quietly on their connection all along.

---

## Running it

```bash
pnpm seed:demo                        # into DATA_DIR (default ./data)
DATA_DIR=./tmp/demo pnpm seed:demo
DATABASE_URL=postgres://… pnpm seed:demo
```

It prints the join codes and every device token — the GM's and all three
players' — so you can open four browser sessions against one server without
scanning anything.

**It is idempotent.** Each run deletes the campaign named *Static on the Line*
(cascading its scenes, sheets, tokens, templates, tables, devices and uploaded
map) and reseeds from scratch. Other campaigns are never touched, so it is safe
to run against a database you care about.

Almost everything is seeded through the app's own HTTP surface via
`app.inject`, so each row goes through the same validation, revisioning and
event emission as a GM clicking through the UI — a seed that bypassed the API
would be a lie about whether the API works. Three things go straight to the
database because there is no route for them: creating the campaign (the
bootstrap route refuses a second campaign without a token), the `runs` row, and
the wipe.

## What it deliberately does not seed

- **No encounter.** Building one from the Rusted Halo template at *blooded* is
  the flow worth demonstrating; a canned encounter would skip it.
- **No books.** `pnpm seed:books` handles the PDF library separately, and the
  PDFs are gitignored by design (§16).
- **No AI drafts.** The Fixer stays off with no `LLM_BASE_URL`, and the demo has
  to look right in exactly that state (NG7). Ratchet's persona is hand-written
  so "speak as her" has something to read the moment a model *is* pointed at it.
- **No ledger entries.** The run row carries the agreed payout and the awards;
  they post to the ledgers when the GM confirms the run (FR5.5), which is the
  beat worth playing.
