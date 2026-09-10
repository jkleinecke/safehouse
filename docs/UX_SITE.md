# The rest of the site, against the Laws of UX

`docs/UX_MAP_BUILDER.md` applied the principles collected at
https://lawsofux.com/ to the map builder, in three phases. This is the same
pass over every other screen, walked on 2026-09-10 as the GM on a laptop and
as a player on a phone, with a few numbers taken from each page: how many
buttons, how many of them accent, how many smaller than a fingertip, and
which words it uses for the same thing.

What this found is a site whose bones are right — the sidebar's three
sections are the best-labelled thing in the app, the empty states say what
to do next, the console home is already a checklist — and whose skin has the
same four habits the builder had. Each is fixed once, in the place it lives,
so it stays fixed.

## The findings, and what changed

### Von Restorff — the shell spent the accent on every page

Every campaign page carried three accent buttons before its own content
drew one: the header's **QR**, the sidebar's **Show join QR** — the same
action twice — and the floating **ask the Fixer**, glowing in the corner of
the Table, the Grid, the Codex and the Calendar alike. With three accents
fixed to the frame, the fourth — the page's own primary action — could not
stand out from them.

The shell now spends none. The three stay where they were, as plain
buttons; the accent belongs to the page: *Roll* on the Table, *activate* on
Scenes, *Generate* on the Generator, *Show join QR* on the console home
where a new campaign's first job is a phone.

### Fitts's Law — targets a thumb cannot land on

| Screen | Small targets (under 28 px) before |
| --- | --- |
| GM Table | 55 — the tracker's stat chips, DMG, INT ▾ and ✕ at 23 px |
| Player sheet, phone | 36 — twenty-one condition boxes at 18 px, dice buttons at 26 px |
| GM Generator | 16 |
| GM Party | 13 |

Two rules in the stylesheet: a `chip` that is a button is at least 28 px
tall, and on a touch screen 36 px, with every `btn` at 40 px. The condition
boxes grow from 18 px to 24 px under a coarse pointer, which is what fits
twelve of them beside their label on a 390 px phone. The visual weight is
unchanged on a desktop; the target is not.

### Similarity and Cognitive Load — six chips that all said SKIL

The tracker's quick-roll rack on an NPC read *ATTA 8 · DEFE 7 · DEFE 12 ·
SOAK 17 · COMP 8 · PERC 7 · SKIL 8 · SKIL 7 · SKIL 8 · SKIL 6 · SKIL 7 ·
SKIL 7*: the first four letters of each row's KIND, upper-cased, so six skill
rolls were six identical chips with nothing but the pool to tell Pistols
from Sneaking, and the tooltip was the only way to find out. The chips now
say the row's own name, clipped at sixteen characters.

### Chunking and Hick's Law — the roller strip

On a laptop the free-form roller was the busiest strip on the Table: pool,
limit checkbox, limit kind, limit value, Edge, visibility, Roll, Buy, ★ —
nine controls in one row, for a roll that is nearly always "pool, Roll".
Pool and Roll are now the large things, Edge stays in view because it is a
decision made at the table, and limit and visibility fold behind one chip
that says what it hides — *social limit 5 · GM only* — so a private roll is
never a surprise. The chip unfolds itself while anything is set.

### Jakob's Law and the Doherty Threshold — the last browser prompt

Saving a macro opened `window.prompt('Macro name?')`: a native dialog that
steals focus, cannot show what is being saved, and looks like an error on a
phone. The name is now typed on the strip, in a field that appears where ★
was, with the roll it will save beside it; Enter saves, Esc puts it away.
With the Grid's two `confirm()` dialogs gone in the builder's phase 3, no
screen in the app opens a browser dialog.

### Mental Model — one word for a fight

The tracker said *fight*; the Generator said *encounter* in five places
(*Encounter + readout*, *New encounter*, *save encounter*, *add squad to
encounter*, *add to encounter*); the sheet's Edge rack said *this
encounter*; the sessions list promised *encounter launching*; the TV's
fallback name was *Encounter*. Every one now says fight. *Encounter* stays
in the code and the routes, where it belongs.

### Cognitive Load — the last spec ids on screen

Two section hints still carried a milestone id a GM has no use for — *M9 —
the list; drawing lives in the Grid*, *M11 — the table's own PDFs*. Gone,
the way the FR ids went in the builder's phase 1. Nothing a GM or a player
reads now carries an id from the design document.

### Responsive — the Grid on a phone

The Grid's toolbar shared its row with the view controls and would not
wrap, so on a 390 px phone the player's four tools stacked in a column and
the hint line broke into one word per line down the left of the map. The
row wraps now, the toolbar may take the full width, and the hint line is
for screens with room for it.

### The landing card

Three tabs — *Pair this device · Start a campaign · Paste a token* — wrapped
to two lines each in a 28 rem card. The card is 32 rem.

## Measured, before and after

The same tour, run again on the built app. "Accent" counts accent buttons
on the page; "small" counts buttons, links and fields under 28 px in either
direction. The phone row was measured with touch emulation on, which is
what the coarse-pointer rules key on.

| Page | Accent before → after | Small targets before → after |
| --- | --- | --- |
| GM Overview | 6 → 3 | 4 → 3 |
| GM Party | 5 → 2 | 13 → 12 |
| GM Table | 5 → 2 | 55 → 10 |
| GM Scenes | 5 → 2 | 2 → 1 |
| GM Codex | 4 → 1 | 2 → 0 |
| GM Calendar | 4 → 1 | 3 → 1 |
| GM Runs | 5 → 2 | 11 → 4 |
| GM Generator | 4 → 1 | 16 → 0 |
| GM Fixer | 5 → 2 | 5 → 0 |
| GM Books | 3 → 0 | 1 → 0 |
| GM Sessions | 4 → 1 | 6 → 2 |
| Player Table, phone | 1 → 1 | 5 → 0 |
| Player Grid, phone | 0 → 0 | 1 → 0 |
| Player sheet, phone (touch) | 0 → 0 | 36 → 2 under 24 px |

On the phone sheet the condition boxes measure 24 × 24 and every `btn`
40 px tall under a coarse pointer. No page shows a spec id; the Generator
says *fight*.

## Left as it is, and why

- **The console home** repeats the sidebar as labelled cards. That is a
  deliberate Jakob's-Law choice from the earlier audit — one list rendered
  twice, so a screen can never be reachable from one and invisible in the
  other — and the status cards above it are already a goal gradient.
- **The Party page's award strip** on every row is busy, but it is what a GM
  does at the end of a session for every runner in turn; folding it would
  add a click per runner to the most repeated action on the page.
- **Tab styles** differ by screen — chips on the Generator, a segmented
  control on the Table, underlined tabs on the sheet. Each is the right
  control for its width, and unifying them is a restyle with no failure
  behind it.
- **Empty states** were graded in `docs/UX_AUDIT.md` and the weak one, the
  Codex, has since been answered: the empty codex offers to have a page
  written.
