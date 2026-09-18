# Native character creation (FR3.9) — the plan

**Status:** plan, 2026-09-13. Nothing here is built. DESIGN.md §6 M3 / FR3.9
commits to "Priority system first, Sum-to-Ten as a variant"; D5 keeps Chummer
as the builder until this lands. The bar the owner set is *at least as good
as Chummer5a*, so §3 is a parity table and everything after it is how we get
there without shipping a page of the book.

Read alongside `DESIGN.md` §9.3 (the sheet), §10.2 (the engine), §14
(content), and `docs/BUILD_REPORT.md` M3 for what the sheet already does.

---

## 1. What the book says must happen

Everything below was read from the owner's core rulebook (printed pages, offset
+5 in the reader). Each is a rule the builder must enforce or a number it must
know. Words are ours; the numbers are the book's, which is the same line the
dice engine and the advancement table already stand behind (§10.2).

### Step 1 — Concept (p. 62)
Every character starts with **25 Karma** to customise. Three creation levels
(p. 64): **street** (Resources A–E = 75k/50k/25k/15k/6k; 13 Karma, max 26;
device rating ≤ 4, Availability ≤ 10; convert ≤ 5 Karma to nuyen),
**experienced** (the default, below), **prime runner** (500k/325k/210k/150k/100k;
35 Karma, max 70; device ≤ 6, Availability ≤ 15; convert ≤ 25 Karma; contacts
Charisma × 6; may initiate/submerge at creation).

### Step 2 — Metatype and attributes (pp. 65–67)
- **Priority table**: five columns (Metatype, Attributes, Magic/Resonance,
  Skills, Resources), rows A–E, **each row used exactly once**.
- Metatype column gives the metatype *and* special attribute points:
  A Human 9 / Elf 8 / Dwarf 7 / Ork 7 / Troll 5; B 7/6/4/4/0; C 5/3/1/0/–;
  D Human 3 / Elf 0; E Human 1. Special points buy **only** Edge, Magic,
  Resonance; unspent ones vanish.
- Attribute column: A 24 · B 20 · C 16 · D 14 · E 12 points; 1 point = +1;
  **all must be spent**; only on the eight mental/physical attributes.
- Metatype attribute table (base/max): Human all 1/6, Edge 2/7; Elf AGI 2/7,
  CHA 3/8, Edge 1/6; Dwarf BOD 3/8, REA 1/5, STR 3/8, WIL 2/7; Ork BOD 4/9,
  STR 3/8, LOG 1/5, CHA 1/5; Troll BOD 5/10, AGI 1/5, STR 5/10, LOG 1/5,
  INT 1/5, CHA 1/4. Racial: elf/ork low-light; dwarf thermographic, +2 dice
  vs pathogens/toxins, lifestyle +20%; troll thermographic, +1 Reach, +1 dermal
  armor, lifestyle +100%. Magic and Resonance start at 0, max 6 (7 with
  Exceptional Attribute; Lucky or Exceptional Attribute, never both, GM
  approval).
- **Only one mental/physical attribute may sit at its natural maximum** at
  creation (Exceptional Attribute lifts that one by 1). Edge/Magic/Resonance
  are exempt.

### Step 3 — Magic or Resonance (pp. 68–71)
- Column grants, already paid: A — Magician/Mystic Adept: Magic 6, two
  Rating-5 magical skills, 10 spells/rituals/preparations; Technomancer:
  Resonance 6, three Rating-5 skills from Resonance/Electronics/Cracking,
  7 complex forms. B — Magic 4, two Rating-4 skills, 7 spells / Resonance 4,
  three Rating-4 skills, 4 forms / Adept Magic 6 + one Rating-4 active skill /
  Aspected Magic 5 + one Rating-4 magical skill group. C — Magic 3, 5 spells /
  Resonance 3, three Rating-2 skills, 3 forms / Adept Magic 4 + one Rating-2
  skill / Aspected Magic 3 + one Rating-2 group. D — Adept Magic 2 / Aspected
  Magic 2. E — mundane.
- Types and their fences (p. 69): adepts get Power Points = Magic for free, no
  Sorcery/Conjuring/Enchanting skills, Assensing only with Astral Perception;
  magicians choose freely; **aspected** magicians pick exactly one of Sorcery,
  Conjuring, Enchanting and may never take the other two; **mystic adepts**
  buy Power Points with Karma (5 each, max = Magic) and never project.
- At creation a caster may know at most **Magic × 2** formulae per group
  (spells, rituals, preparations); a technomancer at most **Resonance × 2**
  complex forms.
- Restricted skills: magic skills need a Magic rating, Resonance skills a
  Resonance rating; deckers cannot take Compiling/Decompiling/Registering.

### Step 4 — Qualities (pp. 71–87)
Positive cost Karma, negative give it. At creation **at most 25 Karma of
positive and 25 Karma of negative**. Costs are per quality; some scale by
rating (e.g. 6 Karma per rating, max 4) or by severity (4 to 25). In play a
positive quality costs ×2 and buying off a negative one costs its bonus ×2
(p. 106).

### Step 5 — Skills (pp. 88–93)
- Skill column: A 46/10 · B 36/5 · C 28/2 · D 22/0 · E 18/0 (individual
  points / **skill group** points). Group points buy only groups, skill points
  only skills; groups cannot be broken in this step; **all must be spent**.
- Ratings: max **6** at creation (7 with Aptitude, skills only); 12 in play.
- **Specialisations**: 1 skill point each, one per skill at creation, +2 dice,
  never on a group; buying one for a grouped skill breaks the group (Step 7
  only).
- **Knowledge and language**: free points = **(Intuition + Logic) × 2**, one
  native language free (a second with Bilingual), max rating 6; knowledge
  types Academic/Professional (Logic) and Interests/Street (Intuition);
  languages use Intuition.
- The skill list, its linked attributes and the eleven-plus groups (p. 90) —
  Acting, Athletics, Biotech, Close Combat, Conjuring, Cracking, Electronics,
  Enchanting, Firearms, Influence, Engineering, Outdoors, Sorcery, Stealth,
  Tasking — with the individual skills under Agility, Body, Reaction,
  Strength, Charisma, Intuition, Logic, Willpower, Magic and Resonance.

### Step 6 — Resources (pp. 94–97)
- Resources column: A 450,000¥ · B 275,000 · C 140,000 · D 50,000 · E 6,000.
- Convert up to **10 Karma → 2,000¥ each** (20,000¥). Carry over at most
  **5,000¥** into play; the rest is lost.
- **Availability ≤ 12, device rating ≤ 6**; all gear subject to GM approval.
- Augmentations: any attribute's total bonus from all sources **≤ +4**; only
  **standard, alphaware and used** grades at creation; every fraction of
  Essence lost drops Magic/Resonance by 1; a cyber replacement removes the
  racial trait it replaces (elf eyes, troll skin); augmented attributes do not
  raise knowledge points or contact Karma; Social limit rounds Essence up.
- Lifestyle (p. 373): Street free · Squatter 500 · Low 2,000 · Middle 5,000 ·
  High 10,000 · Luxury 100,000 per month; trolls ×2, dwarfs ×1.2; more than
  one lifestyle may be kept, each at full cost.
- **Starting nuyen** (p. 95): Street 1D6×20 · Squatter 2D6×40 · Low 3D6×60 ·
  Middle 4D6×100 · High 5D6×500 · Luxury 6D6×1,000, plus the carry-over.

### Step 7 — Leftover Karma (pp. 98–99)
- Carry at most **7 Karma** into play. No initiation or submersion.
- Advancement costs apply (p. 107): attribute **new × 5**; active skill
  **new × 2**; skill group **new × 5**; knowledge/language **new × 1**;
  new specialisation **7**; new spell **5**; new complex form **4**. Skills
  and attributes remain bound by the creation caps (max rating 6, one
  attribute at max, Availability 12).
- Contacts: free Karma = **Charisma × 3**; each contact has Connection ≥ 1 and
  Loyalty ≥ 1 at 1 Karma per point (**min 2, max 7 per contact**), no limit on
  how many.
- Bound spirits: 1 Karma per service, Force = Magic, at most Charisma of them.
  Registered sprites: 1 Karma per task, Level = Resonance, at most Charisma.
- Foci: bonding cost per the Focus Table (p. 318); at creation total bonded
  Force ≤ **Magic × 2** (in play, foci ≤ Magic and Force ≤ Magic × 5).

### Step 8 — Final calculations (pp. 100–102)
Initiative (INT + REA) + 1D6 with augmentation dice; Astral (INT × 2) + 2D6;
Matrix AR as physical; VR cold (Data Processing + INT) + 3D6, hot + 4D6;
limits Mental ⌈(LOG×2 + INT + WIL)/3⌉, Physical ⌈(STR×2 + BOD + REA)/3⌉,
Social ⌈(CHA×2 + WIL + ⌈ESS⌉)/3⌉; monitors 8 + ⌈BOD/2⌉ and 8 + ⌈WIL/2⌉,
overflow BOD (+ augments, + Will to Live); living persona Attack CHA, Sleaze
INT, Data Processing LOG, Firewall WIL, Device Rating RES. The engine already
owns all of these (§10.2, `packages/rules/src/derive.ts`).

### Step 9 — Final touches (p. 103)
Backstory, and **gamemaster approval before play**. The checklist on p. 101
is, word for word, the validator's job list.

---

## 2. What we have already

| Piece | Where | Reused as |
| --- | --- | --- |
| The sheet (`SheetV1`) with skills, qualities, augments, weapons, armor, spells, powers, complex forms, gear, lifestyles, overrides | `packages/contracts/src/sheet.ts` | The builder's **output**. It gains nothing the builder needs except a few fields (§4.1). |
| Derivation with provenance: limits, monitors, initiative, pools, Essence → Magic loss, augment caps | `packages/rules/src/derive.ts` | Step 8 for free; the wizard shows derived numbers live. |
| The catalogue: 1,840 items read out of the owner's 17 PDFs — weapons, armor, augmentations (with Essence), gear, vehicles, electronics, spells, adept powers, qualities (name, cost/bonus, type), complex forms — each with its page | `apps/server/src/services/catalogue.ts`, `GET /api/catalogue/search` | The **only** source of pickable content. Chummer ships data files; we read the GM's own books. |
| Catalogue row → typed sheet item, page ref attached; custom item form | `features/sheet/catalogue/toSheet.ts`, `CustomItemForm.tsx` | The gear step's add flow. |
| Availability test and delivery times | `features/sheet/catalogue/acquire.ts` | Not used at creation (gear is bought at list), but the same availability parser gates the ≤ 12 rule. |
| Karma/nuyen ledgers, pending approval | FR3.6 | Opening balances land as ledger entries: carried Karma, starting nuyen. |
| Revisions and rollback | FR3.8 | The finished build is revision 1, cause `created via builder`. |
| Chummer import | `services/chummer.ts` | Stays. A Chummer character is career mode from day one; the builder never has to reverse-engineer one. |
| NPC generator archetypes: 16 original concepts with attribute/skill curves | `packages/rules/src/generator/archetypes` | **Concept presets** for Step 1 (original names, §14-clean). |
| The Fixer's constrained-JSON lanes with coerce/repair/validate | `fixer/floor-plan.ts`, `fixer/repair.ts` | The pattern for "describe your runner and I'll draft the build". |
| Page refs (`refs.ts`) and the reader | M11 | Every rule the validator cites is one tap from the page. |

Not there today: advancement (FR3.7 is unbuilt — the karma tables it needs are
the same ones Step 7 needs), any notion of a *build* separate from a sheet,
contacts as structured records with Connection/Loyalty (the sheet stores them
as notes), knowledge/language skills as a distinct list, and a priority table.

---

## 3. Chummer parity — what "at least as good" means

Chummer5a's create mode, feature by feature, and where ours lands.

| Chummer does | Ours | How |
| --- | --- | --- |
| Priority build | **P1** | §4, the whole of this plan |
| Sum-to-Ten | **P7** | Same engine, the row constraint becomes a sum |
| Karma build, Life Modules | later, on demand | Run Faster is in the library; the build model already separates *method* from *spend* |
| Street / experienced / prime levels | **P1** | Level presets, GM-set per campaign |
| Five metatypes with base/max, racial traits | **P1** | Numeric table + traits as modifiers |
| Metavariants (Run Faster) | **P7** | Same table, more rows |
| Special attribute points, Edge/Magic/Resonance | **P1** | |
| Magic user types, aspected fences, mystic adept PP purchase | **P1/P5** | |
| Qualities with the 25/25 cap, rating-scaled costs, prerequisites | **P1** cap and costs; prerequisites **P6** | Costs from the catalogue; effects as modifiers (§6, the one hard question) |
| Skills, groups, specialisations, caps, Aptitude | **P1** | |
| Knowledge/language points, native language, Bilingual | **P1** | New sheet list |
| Gear with a catalogue, filters by book, availability/device caps, nuyen running total | **P4** | The catalogue *is* the book list; per-campaign allowed books |
| Weapon accessories, armor mods, 'ware grades and capacity, vehicle mods | **P4** partial | Grades and Essence multipliers; accessories as line items first, slotting later |
| Cyberware/bioware Essence, Magic loss, +4 cap | **P1** | Already derived |
| Spells/rituals/preparations, complex forms, adept powers with PP totals | **P5** | From the catalogue |
| Traditions, mentor spirits, foci bonding, bound spirits, registered sprites | **P5** | Tradition drain pairs are numbers; mentors are the user's picks |
| Contacts (Connection/Loyalty, CHA × 3) | **P6** | New sheet list |
| Karma → nuyen conversion, carry-over limits | **P1** | |
| Lifestyles with multipliers, starting nuyen roll | **P4** | The roll is a server roll on the record (G5) |
| Live validation with a list of what is wrong | **P1**, in every step | Chummer's dialog becomes a persistent rail |
| Career mode: karma advancement with training time | **P7** (= FR3.7) | Same cost tables |
| Print / export | **P6** | The sheet page already is the print; `.chum5` export is out of scope |
| Sourcebook toggles, house-rule options | **P6** | Campaign settings: level, caps, carry-over, allowed books |
| Custom items | **P4** | `CustomItemForm` exists |
| Undo, autosave | **P2** | Server-side draft, saved on every change |

Where we go past Chummer, because we live at the table: the GM approves a
build in the app and returns it with notes; the build lands as a character in
the campaign with its ledger opened; a phone can run the whole thing; every
number is one tap from the page it came from; and the Fixer drafts a build
from a sentence, validated before anyone sees it.

---

## 4. Architecture

### 4.1 The build is its own record

A character sheet is *what the runner is*; a build is *how the runner was
paid for*. Chummer keeps one file and flips it to career mode; the priorities
and point spends stay inside. We keep the two apart:

```jsonc
// CharacterBuild v1 — packages/contracts/src/build.ts
{
  "v": 1,
  "method": "priority",                       // "sumToTen" later
  "level": "experienced",                     // street | experienced | prime
  "priorities": { "metatype": "B", "attributes": "A", "magic": "E", "skills": "C", "resources": "D" },
  "metatype": "troll",
  "special": { "edg": 0, "mag": 0, "res": 0 },          // special attribute points spent
  "attributes": { "bod": 4, "agi": 3, "rea": 2, "str": 6, "wil": 3, "log": 2, "int": 2, "cha": 2 }, // points spent
  "magic": { "kind": "none" },                // | magician | adept | aspected(group) | mysticAdept | technomancer
  "grants": { "skills": [{ "id": "spellcasting", "rating": 5 }], "spells": ["…"], "forms": ["…"] }, // the column's free picks
  "qualities": [{ "name": "…", "ref": {…}, "type": "positive", "karma": 14, "rating": null, "mods": [] }],
  "skills": {
    "active": [{ "id": "automatics", "points": 5, "spec": null }],
    "groups": [{ "id": "athletics", "points": 2 }],
    "knowledge": [{ "name": "…", "type": "street", "points": 2 }],
    "languages": [{ "name": "English", "native": true }, { "name": "Dakota", "points": 1 }]
  },
  "purchases": [{ "ref": {…}, "name": "…", "kind": "weapon", "qty": 1, "rating": null, "grade": null, "cost": 725, "item": { /* the toSheet result */ } }],
  "lifestyles": [{ "name": "Low", "months": 3 }],
  "karma": {
    "toNuyen": 10,
    "spends": [
      { "kind": "skill", "id": "perception", "from": 1, "to": 2 },
      { "kind": "attribute", "id": "edg", "from": 1, "to": 2 },
      { "kind": "powerPoint", "count": 2 },
      { "kind": "spell", "name": "…" }, { "kind": "form", "name": "…" },
      { "kind": "spirit", "type": "…", "services": 4 }, { "kind": "sprite", "type": "…", "tasks": 3 },
      { "kind": "focus", "name": "…", "force": 2, "bondKarma": 4 },
      { "kind": "specialization", "id": "blades", "spec": "…" }
    ],
    "contacts": [{ "name": "…", "role": "…", "connection": 3, "loyalty": 2 }]
  },
  "identity": { "alias": "…", "realName": "…", "age": null, "background": "…" },
  "state": "draft"                            // draft | submitted | returned | approved
}
```

Rules of the record:

- **It is decisions, not results.** `attributes` holds points spent, not
  ratings; the rating is base + points + Karma raises, computed. That is what
  makes every budget recomputable and every validation honest.
- **Compile is a pure function**: `compileBuild(build, tables, catalogue) →
  { sheet: SheetV1, opening: { karma, nuyen }, contacts, knowledge, issues }`.
  The sheet then runs through `deriveCharacter` exactly as an imported one
  does. Nothing in play reads the build.
- **It stays on the row** (`characters.build JSONB`, nullable) so the sheet
  page can show "built with Priority B/A/E/C/D" and a GM can reopen an
  unapproved build. After approval the build is history; changes go through
  advancement (FR3.7), never by editing the build.

The sheet grows three small things so the compile has somewhere to put what
the book requires: `knowledge: [{ name, type, rating }]`, `languages:
[{ name, rating | 'N' }]`, and `contacts: [{ name, role, connection, loyalty,
notes }]` (today contacts are a notes field; the Contacts tab already exists to
render them). Migration is additive with `default([])`.

### 4.2 The engine: `packages/rules/src/chargen/`

- `tables.ts` — the numbers of §1 as data with page refs: the priority table,
  the metatype table and traits, the magic column grants, the skill list with
  linked attribute and group, the karma advancement tables (attribute new×5,
  skill new×2, group new×5, knowledge new×1, and the fixed costs), lifestyle
  costs and starting-nuyen dice, the level presets. Numbers and identifiers
  only, no prose — the same footing as `refs.ts` and the environment table
  (§10.2). The unit test for the tables is the three worked examples in the
  book, reproduced with invented aliases (§5).
- `budget.ts` — `budgets(build)` returns every pool and its remainder:
  special points, attribute points, skill points, group points, knowledge
  points, Karma (start − qualities + negatives − spends − conversions), nuyen
  (resources + conversions − purchases − lifestyles), contact Karma, power
  points, formula and form caps, foci Force cap. The wizard's rail is this
  object rendered.
- `validate.ts` — `validate(build)` returns `Issue[]` of three severities:
  **error** (the build cannot finish: a priority row used twice, points
  unspent or overspent, two attributes at max, a magic skill on a mundane, a
  group broken in Step 5, Availability 14, alphaware on a 6,000¥ build, 30
  Karma of negatives, 9 Karma on one contact, 8 Karma carried, a second
  specialisation), **warning** (allowed but worth a look: 5,000¥ carried
  exactly, an aspected magician with no group skill, no commlink, no fake
  SIN, no lifestyle), **approval** (the book says the GM decides: Exceptional
  Attribute, Lucky, restricted gear, anything the campaign settings flag).
  Every issue carries the page it comes from. This is the p. 101 checklist as
  code.
- `compile.ts` — build → sheet, as above; the Karma spends apply through the
  same functions FR3.7 will use, so `advance.ts` is written once here.
- `sumToTen.ts` (P7) — the same tables with the priority constraint swapped.

### 4.3 Server

- `POST /api/campaigns/:id/builds` (player or GM) → a draft; `GET/PATCH
  /api/builds/:id` autosaves the whole record (last write wins, one owner);
  `GET /api/builds/:id/check` → budgets + issues + a preview sheet through
  `derive`; `POST /api/builds/:id/submit` → `submitted`, a `build.submitted`
  event the GM's console shows; `POST /api/builds/:id/return` with notes;
  `POST /api/builds/:id/approve` (GM) → creates the character in one
  transaction: row + build + revision 1 + ledger openings (carried Karma; the
  starting-nuyen roll made **on the record**, G5) + `character.created`.
  Table `builds` (id, campaign_id, owner_user_id, build JSONB, state, notes,
  timestamps) — separate from `characters` until approval so a half-built
  runner never appears on the party roster.
- Campaign settings (`campaigns.settings.chargen`): level, Availability and
  device caps, Karma carry-over, allowed book codes for the catalogue, and
  the optional-rule toggles as they come.
- The Fixer lane `propose_build` (P6): the campaign's level and palette (the
  catalogue's names by kind, exactly as `floorPalette` lists tiles) go to the
  model with a description; the answer is coerced, run through `validate`,
  and shown as a draft build the player edits — never auto-approved.

### 4.4 The walkthrough: `/c/:id/build/:buildId`

The builder is a **guided walk through the book's nine steps, one screen per
step, in order.** A player who has never built a runner gets taken by the
hand; a player who has can jump around. Two rules hold the whole thing
together:

- **Next only opens when the step is complete**, and the screen says exactly
  what is missing, in the book's words, with the page. Back always works.
- **Nothing is lost by going back.** Change the metatype in Step 3 after
  spending skill points in Step 6 and the later steps are re-validated, not
  cleared; the rail turns red where the change broke something and Next on
  that step is what fixes it.

The page is one column on a phone and two on a tablet or laptop: the step on
the left, the **rail** on the right. The rail is always visible and is the
part of the book a first-timer would otherwise keep on a spreadsheet (p. 62
recommends one): every pool as *spent / available* — special points,
attribute points, skill and group points, knowledge points, Karma, nuyen,
contact Karma, power points — plus the derived numbers as they change
(initiative, limits, monitors, Essence, Magic/Resonance). Below the rail sits
the **issues list**: every validator finding, grouped error / warning /
needs-GM, each a tap to the step that fixes it and a tap to the page. A
progress strip across the top names the nine steps, ticks the finished ones,
and marks any that a later change broke.

Every step opens with two sentences on what the step is for and one on what
the book lets you do — ours, not the book's — and a **"why?"** link on any
constraint that opens the reader at the page. Numbers chosen earlier are
shown wherever they matter later ("Priority C gives you 28 skill points and
2 group points"). Autosave on every change; a build can be closed and
resumed from the party roster.

**Step 1 — Concept.** What kind of runner. A strip of concept cards (the
sixteen original archetype shapes: enforcer, combat mage, adept, decker,
drone rigger, face, street doc, investigator…) with the one line each is for;
picking one pre-fills a suggested priority order and a suggested spend for
every later step, all editable, and the walkthrough says so. "Describe your
runner" opens the Fixer (P6): a sentence in, a validated draft build out. Also
here: alias, real name, age, and the creation level the campaign runs
(street / experienced / prime — set by the GM, shown not chosen). *Complete
when:* an alias exists. A concept card is optional; "start from nothing" is a
card too.

**Step 2 — Priorities.** The five columns as five slots (A–E) and five
labels to drop into them (Metatype, Attributes, Magic or Resonance, Skills,
Resources); a label can sit in only one slot, so a duplicate row cannot be
made. Each slot shows, for the metatype the player is leaning toward, what
it buys ("B — Human 7 special points", "C — 28 skill points, 2 group points",
"D — 50,000¥"). A concept card has already filled this in; a player can
still shuffle. Mundane concepts put Magic at E and the walkthrough says why.
*Complete when:* all five slots are filled.

**Step 3 — Metatype and attributes.** Metatype cards with base/max for each
attribute and the racial traits in plain words, the special points this
priority grants that metatype, and the lifestyle multiplier for dwarfs and
trolls. Then the eight attributes as steppers: base at the left, points spent,
Karma raises (greyed until Step 8), the augmented total in the book's
`4 (6)` form once Step 7 adds 'ware, and the natural max on the right. The
special attributes — Edge, Magic, Resonance — sit below with their own
pool. The one-at-max rule is enforced as it bites: the second stepper that
reaches its max refuses and says "only one attribute may start at its
natural maximum (p. 66)". *Complete when:* every attribute point is spent and
no special point is unspent (unspent special points vanish, p. 66, so the
step warns before it lets you pass with "I meant to").

**Step 4 — Magic or Resonance.** Skipped automatically for a mundane
(priority E), with one line saying so. Otherwise the type picker is gated by
the column: at B the choices are magician, mystic adept, technomancer, adept
and aspected magician; at D only adept and aspected. Picking a type lays out
its grants as pick lists to fill — "two magical skills at rating 5", "10
spells, rituals or preparations" — each fed by the catalogue (spells,
powers, complex forms from the GM's books) and counted against the caps
(Magic × 2 formulae, Resonance × 2 forms). Tradition (drain attributes) and
mentor spirit are picked here; an aspected magician chooses their one group
and the walkthrough states that the other two are closed to them for good;
a mystic adept sees "Power Points: 0 of up to 6 — buy in Step 8 at 5 Karma
each" and a shortcut to do it now, which is what the book's own example does.
*Complete when:* every grant is either filled or explicitly waived.

**Step 5 — Qualities.** Two lists side by side, positive and negative, each
with its running Karma against the 25 cap and the Karma pool on the rail
moving as they change. Search is the catalogue's qualities (name, cost or
bonus, page); a rating-scaled quality asks for its rating; a quality the
validator knows changes the rules (Exceptional Attribute, Lucky, Aptitude,
Bilingual, Will to Live) is flagged "needs the GM's approval" where the book
says so and its effect is applied to the later steps. Effects the app cannot
know are entered as modifiers with the page open beside them, or drafted by
the Fixer (§6.2). *Complete when:* both totals are within 25; the step may
be passed empty.

**Step 6 — Skills.** The skill list laid out as p. 90 lays it out: the
groups first, then the individual skills under their attribute, magic and
resonance skills greyed for those who cannot take them, skills already
granted by Step 4 shown at their rating and locked. Two pools on the rail,
skill points and group points, that never mix; buying a group greys its
skills; each skill has a specialisation slot costing one point. Below,
knowledge and language skills with their own pool ((INT + LOG) × 2, quoted
with the numbers) and the native language pick (a second with Bilingual).
The rating-6 cap is a hard stop on the stepper. *Complete when:* every skill,
group and knowledge point is spent (they cannot be saved, p. 88).

**Step 7 — Gear.** The catalogue search the sheet already has, filtered to
the campaign's allowed books and the level's caps (Availability ≤ 12, device
rating ≤ 6 — anything over is shown greyed with its number, and "needs the
GM" if the campaign allows asking). Adding an item asks only what the book
needs: quantity, rating for rated items, grade for 'ware (standard, alpha,
used — the others are greyed with "not at creation, p. 95"). The running
nuyen sits on the rail; an augmentation moves Essence and, for the Awakened,
Magic, on the rail as it is added, with a warning before the first point of
Magic goes. A "what most runners need" checklist (commlink, fake SIN,
licences, armor, a weapon, ammunition, a lifestyle — the book's own list on
p. 94) ticks itself off. Lifestyle rows take months and apply the metatype
multiplier. A "convert Karma to nuyen" control (up to 10, 2,000¥ each) shows
what it costs the Karma pool. *Complete when:* nuyen is not overspent and a
lifestyle exists; the 5,000¥ carry-over is shown and anything above it is
named as lost before Next.

**Step 8 — Karma.** The remaining Karma, and what it can buy, each with the
cost quoted before the tap: raise an attribute (new × 5), a skill (new × 2),
a group (new × 5), a knowledge or language (new × 1), a specialisation (7), a
spell (5), a complex form (4), Power Points (5), bound spirits and registered
sprites (1 per service or task, Force/Level = Magic/Resonance, count ≤
Charisma), foci to bond (the Focus Table cost, total Force ≤ Magic × 2).
Then **contacts**, with their own pool of Charisma × 3 Karma: name, role,
Connection and Loyalty steppers, the 2-minimum and 7-maximum per contact
enforced. The creation caps still apply and the steppers say so (a skill
will not go to 7, a second attribute will not reach its max). *Complete
when:* Karma carried is 7 or less.

**Step 9 — Finish.** The p. 101 checklist rendered as a list with a tick or
a cross per line, each cross linking back; the full derived sheet as the
player will see it in play (limits, initiative, monitors, pools per skill and
weapon); a background box; and **Submit for approval**. Submitting freezes
the build and tells the GM. The GM opens the same page in review mode: the
sheet, the build's choices step by step, the issues list including the
needs-GM items with approve/deny per item, and two buttons — **Approve**,
which creates the character (revision 1, Karma carried and the starting
nuyen rolled on the record, the roster updated), and **Return with notes**,
which reopens the build for the player with the GM's note pinned to the top
of whichever step it names.

Two modes of the same page: **guided** (Next/Back, steps gated, the default
for a build started from the roster) and **free** (the progress strip is a
tab bar; nothing gated but Submit; what a returning player or the GM gets).
A build remembers which it was opened in.

---

## 5. Phases and tests

Each phase is shippable on its own and lands behind the FR3.9 flag until P6.

| Phase | Builds | Proof |
| --- | --- | --- |
| **P1 Engine** | `chargen/tables.ts`, `budget.ts`, `validate.ts`, `compile.ts`; contracts `build.ts`; sheet fields for knowledge/languages/contacts | **Golden builds**: the book's three worked characters — a human technomancer (D/C/B/E/A), a troll street samurai (B/A/E/C/D), an elf mystic adept (D/B/A/C/E) — re-entered with invented aliases and no gear names beyond what the catalogue holds, must reproduce every total the chapter prints: 16/24/20 attribute points, Resonance 6, Kyra's 10 Karma for 2 PP, 16/12/14 knowledge points, 9/9/18 contact Karma, 26/16/16 Karma left, 7,195 / 3,505 / 2,225 starting nuyen given fixed dice, initiative 6 / 6 (8) / 7, limits 5-4-5 / 5-12-6 / 5-4-8, monitors 10-10-3 / 13-10-9. Plus one test per validator rule, each named for the sentence on the page it enforces. |
| **P2 Server** | `builds` table, routes, autosave, submit/return/approve transaction, events, campaign settings | Route tests through `makeTestApp`; the approve transaction is atomic (`hub.atomic`); a player cannot approve; the roster does not show a draft. |
| **P3 Walkthrough, steps 1–3 and 6** | The page shell (progress strip, rail, issues list, guided and free modes, autosave/resume), then Concept, Priorities, Metatype & attributes, Skills | Component tests for the rail, the gating of Next on each step, and re-validation after a change upstream; an e2e that walks the troll samurai from the concept strip to Step 6 complete on a phone viewport and a laptop one. |
| **P4 Gear** | Step 7 on the catalogue; parser gaps: rating-scaled quality costs ("6 Karma per rating", "4 to 25"), 'ware grades (alpha ×1.2 cost, ×0.8 Essence; used ×0.75 cost, ×1.25 Essence, p. 451), capacity, vehicles as line items; lifestyles; conversion | Catalogue parse tests for the new shapes; budget tests for the multipliers; the availability cap against the parser. |
| **P5 Magic & Resonance** | Step 4 in full: grants, types, traditions, mentors, PP, spells/forms/powers, foci, spirits, sprites | The mystic adept golden passes end to end; an aspected magician cannot add a Conjuring skill; a mundane cannot open the section. |
| **P6 Finish, GM, AI** | Steps 8–9, the GM review mode with per-item approvals and return-with-notes, `propose_build` lane, print view, sourcebook/house-rule settings | e2e: player submits, GM returns with a note, player fixes, GM approves, the character is on the roster with 7 Karma and the starting nuyen on the ledger. Fixer test through the mock LLM. |
| **P7 Career & variants** | FR3.7 advancement on `advance.ts` with training time; Sum-to-Ten; metavariants (Run Faster) | Advancement goldens from the p. 106 examples; a Sum-to-Ten build whose rows sum to 10 and one that does not. |

Rough size: P1–P3 are the bulk of the engine and the shape of the UI and are
where the quality is decided; P4–P6 are wide but each piece is a known
pattern in the codebase. Nothing in this plan needs a new dependency.

---

## 6. Decisions to make before P1

1. **Tables as mechanics.** §14 forbids shipping "tables" from the book; §10.2
   already ships the environmental table, the karma cost formulas and the
   monitor formulas as mechanics, and Chummer has shipped the priority and
   metatype tables for a decade. **Recommendation:** encode the priority
   table, metatype numbers, skill list and karma costs as numeric data with
   page refs, no descriptions, under the same line as the dice engine. Say so
   in §14 when it lands.
2. **Quality effects.** The catalogue gives a quality's name, cost and type,
   not what it does; the sheet stores effects as `Modifier[]`. Chummer
   encodes every effect. Options: (a) the player enters the modifier by hand
   from the page (Principle 5, works today); (b) ship a numeric effects map
   keyed by quality *name* — `{ "Aptitude": skill cap +1 }` is a mechanic, but
   the map of a hundred of them starts to look like the chapter; (c) let the
   Fixer read the page and propose the modifiers, which the validator checks.
   **Recommendation:** (a) with (c) as the assist, and a short whitelist of
   the qualities the *validator* must understand (Exceptional Attribute,
   Lucky, Aptitude, Bilingual, Will to Live, Addiction's cost band) because
   they change the rules of creation itself.
3. **Where the builder lives.** A player-facing route (`/c/:id/build`) that
   the GM can open too, entered from the party roster's "add character" beside
   "import a Chummer build". The Chummer path stays as it is.
4. **Contacts on the sheet.** Structured now (Connection/Loyalty), which also
   fixes the Contacts tab and lets the acquire flow (`acquire.ts`, "a contact
   searching uses their own Negotiation") use a real contact.

---

## 7. What this plan does not do

- No `.chum5` export. Chummer users keep Chummer; ours is a second way in.
- No Karma-build or Life Modules until asked (D5's "out of scope until asked").
- No gear slotting model (accessories mounted on weapons, 'ware inside 'ware)
  in the first pass; accessories are line items with their cost, which is
  what the sheet shows anyway.
- No published names: presets, examples and fixtures are ours (§14.7).

---

## 8. Implementation decisions (2026-09-13, resolved before P1)

Mapping the code and re-reading the books against this plan turned up
places where the plan was wrong about the code or silent where the book
needs a decision. These override anything above that disagrees.

### 8.1 The owner's §6 decisions

All four recommendations stand: tables as numeric mechanics data with page
refs (and a line in DESIGN.md §14 saying so); quality effects entered by hand
with the page open, plus a validator whitelist (§8.4); the builder at
`/c/:campaignId/build/:buildId`; contacts structured.

### 8.2 Where things already live — use them, do not duplicate

- **Contacts are already a table** (`packages/db` `contacts`: name,
  archetype, connection 1–12, loyalty 1–6, notes, npcPageId) with routes in
  `apps/server/src/plugins/contacts.ts` and a web panel. The build keeps its
  contacts (`karma.contacts`, `role` ↔ table `archetype`); **approval inserts
  `contacts` rows**. There is no `sheet.contacts`.
- **Bound spirits and foci live in `campaigns.settings.magic`**
  (`apps/server/src/services/magic-store.ts`). Approval writes them there
  through the store's helpers, with the store's schemas. The store has no
  sprite list yet: registered sprites join it as `magic.sprites` beside
  `spirits` (type ≤ 80 characters, tasks ≤ 999, Level = Resonance), added in
  P2 before approve, never dropped. A bonded focus carries its Focus Table
  type, the purchase it was bought as, and the `sourceKind`/`targets`/`mods`
  the player entered on the spend (`CompiledFocus`).
- **There is no `character.created` event**; rosters refresh on
  `sheet.updated`. Approval emits `sheet.updated` (cause `built`) exactly as
  creation does today, plus the new `build.approved`. New event names go in
  `WS_EVENT_TYPES` (`build.submitted`, `build.returned`, `build.approved`).
- **Players cannot read `campaigns.settings`.** The chargen settings are served
  by their own member-readable route.
- **The 16 generator archetypes are NPC opposition.** Concept presets are hand
  authored in `packages/rules/src/chargen/concepts.ts`: original titles built
  from genre role words (face, decker, rigger, technomancer, adept, street
  mage, shaman, muscle, infiltrator, street doc, investigator, smuggler), each
  a suggested priority order and spend, no book names.
- **Catalogue search requires `q` and one `book`.** The server gains a browse
  mode (§8.6) rather than the builder faking queries.
- **Nothing writes `campaigns.settings` without `forgetCampaignSettings(id)`
  after**, and nothing inside `hub.atomic` reads through the outer `app.db`
  (it hangs under PGlite).

### 8.3 Contracts

`packages/contracts/src/build.ts` — `CharacterBuildSchema` as §4.1 with:
- `method: 'priority' | 'sumToTen'`, `level: 'street' | 'experienced' | 'prime'`,
  `table: 'sr5' | 'rf'` (which printing of the priority table — the two differ
  only in the technomancer cells; the core book's own technomancer example
  follows the RF row).
- `priorities` holds a level per column; under `priority` all five differ,
  under `sumToTen` levels may repeat and cost A4 B3 C2 D1 E0, total 10.
- `metatype` is an id from the metatype table, which includes the Run Faster
  metavariants and metasapients (their extra Karma cost is part of the build
  and does not count toward the 25 positive-quality cap, RF p.102).
- `skills.active[]` = `{ id, points, spec: string | null, target?: string }`
  (`target` for Exotic Melee / Exotic Ranged / Pilot Exotic Vehicle);
  `skills.knowledge[]` = `{ name, category: 'academic' | 'interests' |
  'professional' | 'street', points, skillPoints }` and `skills.languages[]` =
  `{ name, native: boolean, points, skillPoints }` — `skillPoints` because
  active skill points may also buy knowledge and language ranks (p. 88).
- `magic` = `{ kind: 'mundane' | 'magician' | 'aspected' | 'adept' |
  'mysticAdept' | 'technomancer', aspect?: 'sorcery' | 'conjuring' |
  'enchanting', tradition?: 'hermetic' | 'shamanic', mentor?: string,
  waived?: string[] }` and `grants` = `{ skills: [{ id, rating }], groups:
  [{ id, rating }], spells: Pick[], forms: Pick[] }`, `powers: PowerPick[]`
  (adept power point spends, `{ name, ref, cost, levels }`), where a Pick is
  `{ name, ref?, catalogueId?, category? }`.
- `purchases[]` carry `grade` for 'ware (`standard | alphaware | betaware |
  deltaware | used`), `rating`, `qty`, unit `cost`, `avail` (as printed),
  `essence` (per unit, before grade), and `item` (the toSheet result).
- `identity` = `{ alias, realName, age, sex, background, concept }`, all but
  alias optional.
- `approvals` = `{ [issueCode: string]: 'approved' | 'denied' }` — the GM's
  per-item decisions on `approval` issues; `notes` (GM) and `returnedStep`.
- `mode: 'guided' | 'free'` and `step: number` (where the walkthrough was).
- `Issue` = `{ code, severity: 'error' | 'warning' | 'approval', step: 1..9,
  message, ref: { book, page }, path?: string }`; `Budgets` = one entry per pool
  `{ available, spent, remaining }` plus derived previews.
- Build DTOs for the routes (§8.5) and `ChargenSettingsSchema` =
  `{ level, table, maxAvailability, maxDeviceRating, karmaCarry, nuyenCarry,
  books: string[] (empty = all shared), allowSumToTen, allowMetavariants,
  aiDrafts, uncouthDoublesPriorityPoints }` with the level presets as defaults.

`sheet.ts` grows, additively with defaults: `identity.realName/age/sex`;
`knowledge[]` `{ name, category, rating, spec }`; `languages[]` `{ name,
rating, native, spec }`; `skills[].target`; `augments[].grade/rating`;
`qualities[].type/karma/rating`; and `awakening` `{ kind, aspect, tradition,
drain: [attr, attr] | null, mentor, powerPoints }` (default mundane). Chummer
import is left as it is.

### 8.4 Rules engine — `packages/rules/src/chargen/`

Data modules (numbers, ids, page refs; no prose): `skills.ts` (15 groups, 75
active skills with attribute, group, restriction, default), `metatypes.ts`
(the five plus RF metavariants, metasapients and shapeshifters with base/max,
special points per priority, extra Karma, lifestyle multiplier, racial trait
ids), `priority.ts` (sr5 and rf tables; the sum-to-ten costs), `levels.ts`,
`costs.ts` (advancement Karma and training time — the same functions FR3.7
uses), `grades.ts` (Essence, cost and Availability multipliers; which grades
are legal at creation), `foci.ts` (bonding Karma by focus type), `traditions.ts`
(drain attributes), `lifestyles.ts` (costs, starting-nuyen dice, metatype
multipliers), `qualityRules.ts` (the whitelist below), `concepts.ts`.

Logic: `budget.ts`, `validate.ts`, `compile.ts`, `advance.ts`. Names exported
through `chargen/index.ts` with explicit re-exports; do not reuse names the
rules barrel already exports (`SkillGroup`, `ATTR_MAX`, `SKILL_MAX`,
`rollDice`…).

The validator whitelist — qualities whose *creation* consequences the
engine applies (matched by normalised name, tolerant of the book's own drift:
"Magical/Magic Resistance", "Dependent(s)", "SINner (…)"): Exceptional
Attribute, Lucky (never both), Aptitude, Bilingual, Will to Live, Magic
Resistance (no Magic), Mentor Spirit / Focused Concentration / Astral
Chameleon / Spirit Affinity / Spirit Bane (Awakened or casters only),
Human-Looking / Elf Poser / Ork Poser (metatype gates), Incompetent (a group
barred), Uncouth and Uneducated (×2 costs), Dependents (lifestyle +10/20/30%),
Sensitive System (cyber Essence ×2, no bioware), and Distinctive Style /
Blandness exclusion. Everything else is a name, a cost and hand-entered
modifiers — and a quality with neither a catalogue id nor a whitelist entry
(one written in by hand) is an approval item, `approval-quality-custom-…`,
decided by the GM like Restricted gear, its code fingerprinting the side,
Karma, rating, target and modifiers so a re-priced line asks again. A list
price ("7 or 14") allows only its amounts (`catalogueQualityPrice().choices`).

Rules the plan did not state and the engine follows:
- Assensing needs astral perception (magician, aspected, mystic adept with
  the Astral Perception power, adept with the power) (p. 142).
- Arcana is **not** restricted (p. 90 and p. 151 list it under Logic).
- Magic/Resonance skills and groups need the attribute; aspected magicians
  only their aspect's group; adepts no magical groups; Resonance skills never
  for a non-technomancer.
- The +4 augmentation cap is enforced by the validator *and* applied in
  `derive.ts` (it is missing there today). Living persona (Attack CHA, Sleaze
  INT, Data Processing LOG, Firewall WIL, Device Rating RES) and technomancer
  VR initiative on it are added to `derive.ts`.
- Street "max 26 Karma" and prime "max 70" (p. 64) are read as the caps on
  positive and on negative qualities at that level (26 and 70 replacing 25);
  flagged in the settings as a house-rule toggle.
- Uncouth/Uneducated double Karma costs at creation; whether they also double
  priority skill points is `uncouthDoublesPriorityPoints` (default false).

### 8.5 Server

Migration `0006_*.sql` (hand-authored, journal idx 6): table `builds` (id,
campaign_id, owner_user_id, state, build JSONB, notes, created_at,
updated_at) and `characters.build` JSONB nullable.

`apps/server/src/plugins/builds.ts`:
- `GET  /api/campaigns/:id/chargen` (members) · `PUT /api/campaigns/:id/chargen` (GM)
- `GET  /api/campaigns/:id/builds` (GM: all; player: own) · `POST /api/campaigns/:id/builds`
- `GET  /api/builds/:id` · `PATCH /api/builds/:id` (whole record, owner or GM,
  only in `draft`/`returned`; no persisted event — an ephemeral `build.saved`).
  The body may carry `baseUpdatedAt`, the `updatedAt` of the row the record
  was built on; when the row has moved on since, the save is refused with
  `409 build_stale` and the current `BuildDto` in `error.details`, and the
  walkthrough keeps the player's edits on screen beside it until they choose
  "keep mine" or "take theirs". Without it, last write wins.
- `GET  /api/builds/:id/check` → `{ budgets, issues, sheet, derived }`
- `POST /api/builds/:id/submit` (owner; refuses with errors) → `build.submitted`
- `POST /api/builds/:id/return` (GM, `{ notes, step }`) → `build.returned`
- `POST /api/builds/:id/approvals` (GM, `BuildApprovalsSchema`: decisions per
  issue code, `null` takes one back) → `build.reviewed`
- `POST /api/builds/:id/approve` (GM; refuses on errors or undecided
  approvals) → one `hub.atomic`: character row + `characters.build` + revision
  1 + contacts rows + magic settings + ledger entries with `{ tx }` (Karma
  carried; nuyen = carry-over + the starting-nuyen roll, persisted as a roll
  on the record through the `recordCopilotRoll` pattern) + `sheet.updated` +
  `build.approved`.
- `DELETE /api/builds/:id` (owner while draft, GM any time before approval).
- Malformed ids answer 404 (copy the `UUID_RE` guard).

Catalogue: `GET /api/catalogue/search` accepts `kind` without `q` (browse,
alphabetical), `books=SR5,RF` (several), `offset`; the `%`/`_` escaping bug in
`searchBookItems` is fixed. The quality parser learns "N Karma per rating (max
rating M)" → `KARMA: N, PER: 'rating', MAX: M` and "Bonus: A to B Karma" →
`KARMA: 'A-B'`; a recompile picks them up.

Fixer `propose_build` (P6): a new lane, reachable by the build's owner or the
GM when AI is enabled and `settings.chargen.aiDrafts` is on; its run slot is
keyed to the build so a player's draft never blocks the GM's Fixer. It
returns a proposed build (never writes one); names are resolved against the
catalogue on the server and the unresolved ones come back as warnings. The
palette sent to the model is the tables' ids plus a capped list of catalogue
names by kind from the campaign's allowed books.

Advancement (P7, FR3.7): `POST /api/characters/:id/advance` with a spend
(the same `advance.ts` shapes) → a pending Karma ledger entry carrying the
mutation; approving the entry applies the mutation as a revision. Training
time is shown, not enforced, and so are the per-downtime ceilings of pp.
105–106 (two attribute ratings, three skill ratings, one group rating): the
quote names the one a raise passes, and the GM decides how many downtimes
the entry covers.

Decisions the Improve panel makes by leaving something out:

- **Four rows of p.107's table are the GM's by hand**, not spends: a positive
  quality bought in play, buying off a negative one, a new initiate grade and
  a new submersion grade. The prices are in `costs.ts`
  (`karmaForQualityInPlay`, `karmaForQualityBuyOff`, `karmaForInitiation`) and
  the Karma is posted as an ordinary ledger entry with the sheet edited
  beside it; no initiate grade is modelled on the sheet, which is why Magic
  and Resonance stop at 6 in play. Adding them means a sheet field
  (`awakening.grade`) and is its own piece of work.
- **A runner's ledger is the table's record, not the owner's.** Balances,
  deltas, reasons and the advance an entry carries are readable by every
  device bound to the campaign and ride the public `ledger.changed`, because
  settle-up is a table beat (§4) — a queued improvement is visible to the
  table before the GM approves it, by design. If that is ever to change it is
  the whole ledger that changes, event and read path together, not the
  advance lane on its own.

### 8.6 Web — `apps/web/src/features/build/`

- Routes `/c/:campaignId/build` (list: my builds, "start a new runner") and
  `/c/:campaignId/build/:buildId` (the walkthrough), lazy chunks.
- State: `useBuild(buildId)` holds the record, runs `budgets` / `validate` /
  `compile` from `@safehouse/rules` locally on every change for an instant
  rail, and autosaves with a debounced `PATCH`; `check` is fetched before
  submit and on the Finish step.
- Shell: `BuildPage` (two columns ≥ lg, one below), `ProgressStrip`,
  `Rail`, `IssuesList`, `StepFrame` (intro, why-links, Back/Next with the
  gating reason). A refusing stepper (`LimitStepper`) with an accessible
  reason, since the sheet's `Stepper` cannot refuse.
- Steps: `steps/Concept`, `Priorities`, `Metatype`, `Magic`, `Qualities`,
  `Skills`, `Gear`, `Karma`, `Finish`; GM review mode in `Review`.
- The step kit (`features/build/kit/`, P3): `CataloguePicker` and
  `useBuilderCatalogue` (browse mode, the campaign's books, paging, rows over
  the caps greyed with why), the mappers `hitToPurchase` / `hitToQuality` /
  `hitToPick` / `hitToPower` over `toSheetItem` and the rules engine's
  catalogue readers (`chargen/catalogue.ts`: `catalogueQualityPrice`,
  `catalogueWareFigures`, `cataloguePowerPoints`, which the server's
  catalogue service also uses), and `PoolLine`, `CostQuote`, `WhyLink`,
  `ChoiceCards`, `RatingPicker`.
- Catalogue picking reuses `AddFromBooksView` and `toSheet` with the browse
  mode.
- Entry points: party roster and `AddCharacter` ("build a runner" beside the
  Chummer import), the player's home, a "builds waiting" card on the GM
  overview.
- Unit tests are node + `renderToStaticMarkup` (no jsdom); e2e in
  `apps/web/e2e/build.spec.ts` on phone and laptop viewports.

### 8.7 The goldens follow the rules, not the misprints

The book's three worked characters are the golden tests, re-entered with
invented aliases. Where the book disagrees with itself the test asserts what
the rules produce and names the discrepancy in a comment (see the book
map): Rob has 15 Karma after conversion, not 16; Rob's Social limit is 5;
Kyra's printed starting nuyen cannot be rolled (assert the formula with
fixed dice instead); Kyra's powers cost 2.25 PP by p. 311, so her golden buys
the example's powers and expects the over-spend issue, or trims Voice Control
— whichever, stated; James uses the `rf` table. Gear line items are not
asserted, only carry-over into starting nuyen.

Step numbers: issue `step` fields use the walkthrough's numbering (§4.4:
1 Concept, 2 Priorities, 3 Metatype & attributes, 4 Magic, 5 Qualities,
6 Skills, 7 Gear, 8 Karma, 9 Finish); §1's headings follow the book's.

---

## 9. Status (2026-09-17) — what shipped

The builder is built. P1–P7 all landed in one run, with the phases above as
the order of work; §8 is the record of what was decided before the code, and
this section the record of what the code settled on where it differs. The
owner runs the test suites, so the counts below are the ones the phases
reported as they landed, not a final tally.

### 9.1 The pieces

| Piece | Where |
| --- | --- |
| The build record, issues, budgets, settings, DTOs | `packages/contracts/src/build.ts`, `advancement.ts`, sheet additions in `sheet.ts` |
| The engine: tables, ratings, budgets, eligibility, 135 validator rules, steps, compile, advancement, concepts | `packages/rules/src/chargen/` (22 modules) |
| Golden builds, one test per validator rule, table tests pinned to pages | `packages/rules/test/chargen-*.test.ts` |
| The builds table, `characters.build`, the ledger payload | `packages/db/migrations/0006_builds.sql`, `0007_ledger_payload.sql` |
| Build routes, the approval transaction, chargen settings | `apps/server/src/{plugins,services}/builds.ts` |
| Advancement route and the ledger mutation it carries | `apps/server/src/{plugins,services}/advance.ts` |
| The Fixer's build draft lane | `apps/server/src/fixer/build-draft.ts` |
| The walkthrough: shell, rail, issues, step kit, nine steps, GM review | `apps/web/src/features/build/` |
| Career advancement and the build line on the sheet | `apps/web/src/features/sheet/career.ts` and its panel |
| The GM's creation settings | `apps/web/src/features/build/settings/` |
| The whole loop end to end, on a phone and a laptop | `apps/web/e2e/build.spec.ts` |

### 9.2 Where the code settled differently from §8

- **The GM's fields are columns, not build keys.** `state`, `notes`,
  `returned_step` and `approvals` live on the row; the player-writable body is
  `BuildWritableSchema` (the record minus `GM_BUILD_FIELDS`), so a player
  cannot self-approve by sending a field. The DTO's build carries the row's
  copies, and the row is the source of truth.
- **Approvals are their own route and event.** `POST /api/builds/:id/approvals`
  merges the GM's per-item decisions and emits `build.reviewed`; reusing
  submit or return would have lied to the other devices. An approval code
  fingerprints the line it approved, so editing that line asks again.
- **Autosave is guarded.** `PATCH` takes `baseUpdatedAt` and answers 409
  `build_stale` with the current row; the walkthrough keeps the player's
  unsaved typing on screen and offers "keep mine" or "take theirs". The
  ephemeral `build.saved` is the only thing a save emits.
- **Sprites joined the magic shelf.** `campaigns.settings.magic.sprites`, beside
  spirits, written by approval through the store's own helpers.
- **A build that no longer parses does not break the list.** It comes back as an
  unreadable stub the GM can delete.
- **Settings merge.** `PUT /chargen` goes through `mergeChargenSettings`, so a
  one-toggle write never resets the rest; the level's caps follow a level change
  unless the same write sets them.
- **The engine answers, the UI renders.** A step never re-derives a rule: what a
  control may do comes from `probe`, what is open from `eligibility`, what a
  pool holds from `budgets`, and every refusal carries the validator's own
  sentence and page. `StepProps` is the contract (`steps/types.ts`).
- **Initiation at creation** is a Karma spend in step 8 rather than a footnote,
  because the prime-runner level allows it.
- **Goldens follow the rules, not the misprints** (§8.7), and each disagreement
  is named in a comment with its page.

### 9.3 Known gaps

- No `.chum5` export, no Karma build or Life Modules, no gear slotting model
  (§7 stands).
- Training time is shown, never enforced; the p.105–106 downtime ceilings are
  not applied.
- Four rows of the p.107 improvement table cannot be bought in play yet.
- The sheet stores more than it shows: augment grade and rating, and a quality's
  type and Karma, are recorded by the builder and not yet surfaced in play.
- Nobody has played with it yet. The suites and the e2e spec exist; a table has
  not sat down with it.
