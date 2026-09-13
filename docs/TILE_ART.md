# Tile art style

How Safehouse's tilesets look, why, and what a new tile has to do to belong.

The machine-readable half of this document is
[`packages/rules/src/tilesets/style.ts`](../packages/rules/src/tilesets/style.ts),
and [`style.test.ts`](../packages/rules/test/style.test.ts) holds the whole
catalogue to it. **If you add a tile that breaks the look, a test goes red.**
That is deliberate: a tileset grows one tile at a time, months apart, usually
in the middle of prep — which is exactly the condition under which a look
drifts, because each new tile gets judged against the last one instead of
against the whole set.

---

## The one finding that changed everything

**Shadowrun is a warm, near-black game, not a neon one.**

Measured across the 37 official Steam screenshots of the Harebrained Schemes
isometric trilogy — Shadowrun Returns (app 234650), Dragonfall (300550), Hong
Kong (346940) — cropped to the environment band to drop the HUD:

| Measurement | Value |
| --- | --- |
| Median scene value (HSV V) | **15–20%** |
| Pixels below V 8% | 24% |
| Saturated highlights (V>78%, S>30%) | **1.15% of the frame** |
| …of which amber + gold + red | **85%** |
| …of which magenta + purple | **1.4%** |

The cyan-and-magenta pairing that says "cyberpunk" to anyone who has seen a
film poster is essentially **absent** from these games. Our first catalogue was
built out of exactly that pairing, which is why six sets read as one generic
set. Every rule below follows from taking the measurement seriously instead.

---

## The rules

### 1. Dark is made with value, never by draining the colour out

Measured saturation barely moves across the value range — median 32% in the
darkest band, 54% in the brightest. A dark Shadowrun surface is dark because
its **value** is low, not because it is grey.

This is the mistake we already shipped once: 87% of the first catalogue's
swatches sat under 25% saturation, so every set came out as a shade of the same
near-black. `SET_MEDIAN_SATURATION_MIN` exists to make that failure loud.

### 2. Warmth rises with brightness

`mean(R − B)` climbs monotonically with value across all three games — from
about 0 in the darkest band to +38 (Seattle), +78 (Hong Kong) and +150 (Berlin)
at the top. **Shadows are neutral; light is warm.**

This is the signature of the whole look, and the exact inverse of the cool-key,
cool-shadow palette that Blade Runner left to everything downstream of it. If
you only take one rule from this document, take this one.

### 3. Magenta may light a wall; it may not be one

Magenta and purple appear in **none** of the top-ten bright-saturated hue bins
of any of the three games. A surface is never made of them. Checked by
`no-magenta-substrate`.

### 4. The light budget is warm, and neon is a location's signature

Of the measured highlight budget: amber 50–55%, gold/sodium 18–23%, red 10–13%,
cyan 9–13%, magenta 1.4%. Enforced catalogue-wide rather than per set, because
the distribution allows roughly one cool room in five — a single cyan-lit club
is right and a cyan-lit catalogue is not, and only the whole collection can
tell those apart.

**Tube neon lives in the Club and the Street, and nowhere else.** Both carry a
pink sign and a cyan one; the other four sets carry none.

That is not a departure from the 1.4% figure, it is what the figure means. The
measurement is a share of **pixel area** across 37 frames of mostly sewers,
warehouses, tenements and offices. A neon sign is a single tile covering a
couple of cells — almost no area — so the two locations neon belongs in can
each carry a tube and still leave the rendered share where the study puts it.

The first cut of this file got that wrong: it converted a pixel-area
measurement into a per-tile count budget and set the magenta ceiling at 6% of
lights, which on a thirteen-light catalogue rounds to zero. A rule that bans
the thing it is meant to ration is not a rule.

What actually does the rationing has not moved:

- `no-magenta-substrate` keeps it out of the walls — **the tube is pink, the
  housing it is bolted to is not**, and a test checks exactly that;
- `SET_EMISSIVE_MAX` keeps a room to four practicals;
- the two guard rails are catalogue-wide: warm light stays in the majority,
  and cyan-plus-magenta together stay under 42% of all lights. Past that the
  pairing *is* the palette, which is the film poster and not this.

### 5. One committed temperature per set

Within a scene the dominant temperature holds at least 70% of saturated pixels.
No 50/50 warm-cool rooms — each place reads as one colour idea, and the rare
cool room then lands hard as a change of key.

### 6. A light is something you place, not something you fill with

At most **four** tiles per set carry `emissive` — the top of the 2–4
practicals per 8×8-cell room the study found. The two neon locations sit at
four; a warehouse gets one.

There is a sharper reason than the budget. The club's dance floor carried its
glow for one build, and painting a room lit *every cell of it* — a disco
chessboard at roughly forty times the measured emissive budget. Lamp pools and
neon spills are the exception that proves the rule: a GM paints two cells of
those, not two hundred.

Emissive is drawn as an **unlit layer** composited after every tile — it
receives neither ambient nor directional light and renders at 100% of its
painted value. Drawn inline it was neither: a tile painted later covered the
bloom of one painted earlier, so a sign lit only the sliver of wall it was
bolted to.

The pool takes the shape of the **floor**, not of the fixture. Scaling the
emitter's own outline is the obvious thing and it is wrong — a wall slab is a
third of a cell, so a neon sign's bloom came out as a thin sliver of pink and
read as a coloured pixel. Light stops taking the shape of the thing emitting it
a few centimetres out; it falls on the ground as a pool, which is a circle in
plan view and a 2:1 ellipse in isometric. The fixture keeps its own shape and
brightens to a core at full value.

In a catalogue where about 1% of the frame may be bright, a light that does not
read means the scene has no focal point at all.

### 7. The environment always loses to the people standing on it

No environment surface exceeds S 70% or V 75%. The moment the floor is the
brightest thing on screen, the runners stop reading as the subject. Emissive
elements are exempt — they are lights, not surfaces.

### 8. Contrast comes in three tiers that must not overlap

| Tier | What | Budget |
| --- | --- | --- |
| 1 | Silhouette / adjacent face planes | ≥ 20 value points |
| 2 | Material pattern (brick courses, grating) | ≤ 12 points |
| 3 | Grain and noise | ≤ 6 points |

When a material's pattern competes with the shape it is drawn on, an isometric
scene turns to noise at table zoom. This is why a tile's accent must stay near
its base.

### 9. Corporate is the exception, not the default

Most of a run happens somewhere run-down, so tier 0–2 is the default and tier 3
is opt-in. Tier 3 **inverts** the floor rule: pale, nearly desaturated, and
brighter than anything else in the catalogue.

Getting this backwards is the most common way to make Shadowrun look like
generic sci-fi, because the gleaming corporate tower is the memorable image and
the wrong default.

### 10. The second catalogue (2026-09-13): sixteen sets, one style

`catalogue-places.ts` adds the places a campaign spends the evenings that are
not a heist: a tenement and a condo tower (two kinds of home), a corner café,
a fine-dining room and a noodle counter (three ways to eat), a civic plaza, a
city park, a marina, the countryside and the lake. Every one is held to the
rules above by the same test, so the sixteen still read as one game:

- **Two more polished sets.** The condo and the dining room are the same
  money as the corporate tower and pale for the same reason; `style.test.ts`
  names all three. Rule 2 still holds inside the polished tier — their lit
  greys lean warm (R > B) and their dark greys lean cool — which is what
  separates a pale room in this world from a grey one.
- **Water is cool, so it is rationed.** A set that was mostly water would be
  a cool set, and the catalogue allows about one room in five to run cool.
  The marina, the park and the lake keep water to a few tiles against warm
  wood, sand and stone, and stay warm-dominant (rule 5).
- **The light budget held by hue, not by count.** Thirty-odd new practicals
  came in amber first and pushed the catalogue past the 62% amber ceiling.
  Downlights, chandeliers, porch lights and lanterns are gold now
  (`#e6d58a`, hue ≈ 49°); `#ffd27a` looks gold and is amber (hue ≈ 40°).
  Check the family, not the name.
- **New vocabulary, forced through the renderer.** Five ground patterns
  (cobble, marble, sand, field, reeds), two cuts (a picket fence, a railing)
  and thirty-one prop designs (bed, counter, stove, fridge, sink, bookshelf,
  screen, umbrella, grill, bar, menu board, chandelier, statue, hedge, bench,
  picnic table, signpost, swings, flag, bike, rocks, fire pit, boat, canoe,
  buoy, cleat, hay bale, tractor, well, trough, log pile). Each is a member
  of a `Record` the painter must fill, so a missing drawing is a compile
  error; each prop is used by at least one tile, so none is dead weight.
- **Fences are building fabric, not walls.** A waist-high picket, railing or
  balustrade sits in the building category with `footprint: 'wall'` and
  `kind: 'feature'`, so it orients with its neighbours and grants cover
  without pretending to stop sight — the wall-semantics test keeps every
  `kind: 'wall'` tile full height.

What this is not: hand-painted texture art. Every tile is still drawn from a
palette and a pattern, which is what keeps the catalogue a few kilobytes,
crisp at any zoom, and ours. The road to painted tiles is an image pipeline
(an atlas per set, imported like a map image), and nothing here blocks it.

---

## The lighting model

Taken from the shipped Shadowrun Returns level editor's own documented
defaults, which is the closest thing to the artists' working vocabulary that
exists in public.

- **One directional key**, direction `(-0.50, -1.00, -0.75)` — 48° above the
  ground plane. All three components negative.
- **The horizontal split is 0.50 : 0.75, not a symmetric 45°.** This is why the
  two visible side faces of a box differ from each other at all, and why a
  corner stays legible.
- **Ambient is the shadow colour**, and both ambient and directional ship
  neutral grey. Every hue in a scene comes from a surface's own paint or from a
  placed light — never from a wash over the whole frame.
- **Point lights are additive only**, unaffected by ambient or directional, so
  a sign can blow past the scene's value ceiling locally without lifting the
  room.

Face multipliers fall out of that as `0.502 + 0.502 · lambert`:

| Face | Multiplier |
| --- | --- |
| Top | 0.875 |
| Left | 0.782 |
| Right | 0.688 |

That range is much **flatter** than a procedural renderer would choose on its
own, and it works in the games because the form is painted in rather than
shaded in. Our top face used to be `1.15` — it *lit* the tile, inventing
brightness the model does not have, which is what made every box read as
moulded plastic.

`FACE_FOOT` buys the legibility back: each standing face is drawn as four
horizontal bands running from 74% of its shade at the foot to full at the
crown, so a wall grows out of the floor instead of being pasted onto it. That
is the nearest a procedural renderer gets to the gradient a painter would put
there.

---

## Table exposure — the one deliberate departure

Everything above is measured. This is not.

The catalogue is authored at the measured intent **× 2.0** (× 1.12 for the
polished corporate tier). The measured frames carry things a virtual tabletop
does not — a bloom pass, 3D character lighting, a colour-correction lift, a
vignette — every one of which raises the apparent brightness of a dark floor.
Authoring straight to a 15–20% median produced a map that was faithful and
unusable: a GM squinting at a near-black floor on a laptop in a lit room.

The first exposure was 1.55, and it was still not enough: a GM building a
club saw charcoal boxes on black, and said so. The lift to 2.0 was applied as
one transform over every worn surface — value × 1.3, hue and saturation
untouched, accents held inside the tier-2 budget, everything capped at the
surface ceiling — so the findings survive it exactly as they survived the
first one. The worn-tier median base value is now 0.49.

A single multiplier moves every surface together, which is what lets the
findings survive it. Saturation is still flat across the range, warmth still
rises with value, the glow budget is untouched, and each set keeps its
temperature. Only how far up the range the catalogue sits has changed.

It is called out rather than quietly absorbed into the colour picking, so
anyone comparing this to a screenshot knows exactly which knob was turned.

---

## Adding a tile

1. **Author in HSV, not hex.** The rules are stated in hue, saturation and
   value; picking a hex first and checking afterwards is how you end up
   arguing with the test.
2. Pick the hue from the set's existing family. At most five families per set,
   or it stops reading as one place.
3. Value: most of a set sits in the 0.20–0.45 band at table exposure. Ground
   lower, props higher, and remember rule 2 — anything you make brighter you
   must also make warmer.
4. Saturation: 0.08–0.62. Rust, painted plastic and cloth may go high; plain
   floors and walls should not.
5. Accent within 12 value points of the base (tier 2).
6. Only add `emissive` if the set has fewer than four lights **and** the tile
   is something a GM places rather than fills a region with. Tube neon
   (magenta) belongs to the Club and the Street only.
7. A piece of furniture or a prop names a `prop` design from `TILE_PROPS`
   — reuse one before adding one; a new design needs a drawing in
   `stage/props.ts`, and the record type will not compile without it.
8. **Append it to its category; never insert.** A painted square stores a
   *slot*, not a tile id — `ground/3`, `building/door`, `interior/2` — and
   the slot a tile answers is its position among the set's tiles of that
   category, in catalogue order (`rules/tilesets/slots.ts`). That order is
   part of the data contract: a tile inserted mid-category renumbers every
   tile after it, and every map painted with the set silently changes.
   Building and stairs are roles rather than numbers (the first door is
   `building/door`, the first see-through in-wall piece the `window`, the
   first solid one the `wall`; extras count on from 4), so those may be
   reordered only if the roles come out the same. `slots.test.ts` pins the
   assignment for every set and fails the moment it moves.
9. Run `pnpm --filter @safehouse/rules test`. The failure will name the rule.

Every set answers every slot: a number the set lacks wraps onto one it has,
so a map painted with a seven-floor set still draws in a three-floor one. A
set switch is therefore a render decision — the map is stored once, in slots,
and each set is one way of drawing it.

The generator used to build the current catalogue is not checked in — the
catalogue is the source of truth, and the hexes in it are the authored values.

---

## What this is not

These are statistical properties of a look: value bands, hue budgets, lighting
ratios, contrast tiers. Style is not anyone's property and none of it is
anyone's artwork. Every colour in the catalogue is ours, chosen to satisfy the
numbers above, and every tile ships as a procedural definition — a palette, a
pattern name, a footprint and a height — rather than as an image (§14).

## What is still unsettled

- The `patternMax` (tier 2) and `silhouetteMin` (tier 1) budgets are in
  tension at low values: with face multipliers of 0.875 and 0.688 you cannot
  reach 20 points of face-plane separation on a dark albedo. In practice
  silhouette separation comes from a prop's albedo differing from the floor
  behind it, plus the foot-to-crown gradient. The tier-1 figure is not
  currently enforced for that reason.
- Rain, steam and vent plumes belong to a scene-level overlay, not to tile
  texture. Not implemented.

---

## Sheen — reflected light is a surface, not a light

The study's wet-ground reflectance (8–20% of a surface mirroring the nearest
light) is the `sheen` channel. A tile with `sheen` gets a translucent wash of
that colour over its top face, weighted by the colour's own brightness, plus a
lighter streak toward the key light. **No pool, no bloom, nothing thrown onto
the neighbours.** That is what keeps it a property of the surface, which is
what lets a GM paint a whole dance floor with it — the thing `emissive`, being
a light, is rationed against.

Rules, checked by `checkTile`:

- a sheen colour reads as a reflection: value ≥ 50%, saturation ≥ 30%;
- a tile is a light or reflects one, never both.

It lives on three tiles: the club's dance floor (lit from below), the street's
standing water (reflecting the neon), and the lobby's polished stone (under its
own downlights).

---

## What the renderer adds that the palette cannot

The face multipliers are deliberately flat, so the form has to come from
somewhere else — the games paint it in. A procedural renderer gets it from
four things, all in `stage/tileLayer.ts`:

- **Per-cell grain.** Every floor cell's value is nudged by a hash of its
  position, ±4.5% — inside the tier-3 budget. A floor painted from one tile
  reads as poured rather than printed, and is identical every time it draws.
- **Contact shadows.** Every standing thing casts a dark offset onto the floor
  at its foot, leaning the way the key light leans. Drawn in their own pass
  between the floors and the standing tiles, so they land on the floor beside
  a wall and under the wall itself. In plan view — where there is no
  extrusion — this and the crown are the whole of what says "not floor".
- **Crown edges.** One pixel, a third brighter than the top face, along the
  top of every standing thing. It is the edge the key light catches first.
- **Plan-view cuts.** A door gets a bar across its slab in its accent; glass
  and grilles get a light line down the middle, the way glazing is drawn on a
  floor plan. Without them a room's door was a wall painted a slightly
  different brown.
- **Materials in grid space.** Every pattern is drawn across the whole face in
  cell-local coordinates and projected point by point, so brick courses,
  deck boards and grout run with the diamond, foreshortened, edge to edge.
  The first renderer laid a 1px line into the largest square inside the
  face — the middle third of a diamond — and every floor read as vinyl. Each
  material draws from a small derived palette (base, accent, a lit edge, a
  gap, one ink for cracks and joints); the bulk of a texture stays inside the
  tier-2 budget and only hairlines get the ink. Per-cell seeds vary boards,
  chunks and cracks so forty cells of one tile do not tile.
- **Fourteen patterns.** `grass` (tufts over mottling) and `dirt` (mottling,
  a crack, a few stones) joined the original twelve, because gravel dots
  under turf and under packed earth both read as a spotted floor.
- **Ink line and ambient ring.** A pixel-wide outline in the tile's own ink
  around every standing thing — the line every hand-painted isometric game
  draws, because two props of one colour have no other way to be two things.
  Full-height walls and blocks also take light from the floor on every side:
  a faint, wide ring under the contact shadow, which is what makes a room
  read as enclosed rather than as a floor with a fence on it.
- **Made things have lips.** Standing blocks get a bevel on the top face,
  drums and planters a rim, posts a cap wider than the post, and a canopy's
  crown is jittered per vertex with a lit lump on its key-light side.
- **Walls sit a notch above the floor.** Every full-height structure tile is
  authored at value × 1.18 over its floor, so architecture reads as the
  lighter thing in the room in both projections.
- **The map has an edge.** Where a painted square meets nothing, an ink line
  runs along the drop and a shadow falls off the two near sides, so a floor
  reads as a slab with a thickness and the void around it as space rather
  than an unfinished job.

## Openings are drawn as what they are

A door used to be a wall slab in a different brown with a bar across it.
Every door and window in the catalogue now names a **cut** — `roller`,
`wireglass`, `hatch`, `blown`, `serving`, `sign`… (`TILE_CUTS`) — and
`stage/cuts.ts` draws that design onto the wall's visible face in isometric
and as the floor-plan symbol in plan: a leaf with its frame, panels and
handle; roller slats with a housing; wire mesh in glass on a sill; a
shopfront with its lit interior; louvres; a wheel-hatch with its dogs; a
ragged hole; a frame with the shards still in it; a serving hatch with its
shelf; a porthole door; a neon tube on a sign box; chain-link mesh. Each set
gets the openings its world would have, and a design added to the list
without a drawing is a compile error, not a slab.

**Adjacent cells of one cut tile are one opening.** Two street doors are a
double door that meets in the middle; two cells of roller door are one wide
roller; a run of shopfront glass is one window with a mullion per cell. The
run is found from the wall's own joins and drawn once, from its last cell —
the nearest, the one drawn last — so no slab of the run is painted over it.
A change to any cell of a run redraws the whole run (`expandCutRuns`).

In plan view the symbols are the architect's: swing arcs for hinged leaves,
glazing lines for glass, ticks for slats, a circle for a hatch, a dashed gap
for a hole.

## Props are drawn as what they are

An object used to be one of four blobs — a box, a post, a squat cylinder,
a post with a crown — and a desk, a car and a pallet stack were the same
box in three browns. Every object tile now names a **prop** design
(`TILE_PROPS`, eighty of them) and `stage/props.ts` builds it from
small solids placed in cell space: a slab on two pedestals with a monitor;
a seat with a back and four legs; a low body with a glazed cabin, headlights
and wheels; a cargo box with a cab; a trunk under a jittered crown; a pole
with an arm and a lamp head; a drum with ribs and a lid; a tripod work light;
a cabinet with a column of status lights; a vending machine with its lit
window; a tarp over a ridge pole; flames out of a barrel; a shopping cart
with its wire sides.

**One drawing serves both projections.** The kit projects every solid
through the scene's own projection, so in isometric a box gets its two lit
faces (the same `FACE_SHADE` multipliers as a wall) and its top, and in plan
the same call draws only the top — which is the floor-plan symbol for free.
A chair from above is a seat and a back; a car is a body and a cabin with a
windscreen line; a tree is a crown with a trunk dot. There is no second
drawing per design, so the two views cannot disagree.

**Order is occlusion.** There is no depth buffer: a part drawn later covers
one drawn earlier, so every design draws back to front and bottom to top —
the pedestals before the desktop, the trunk before the crown. Faces standing
on a vertical plane (wheels, speaker cones, a fan grille, a lit screen) are
drawn as polygons on that face and vanish in plan, where a vertical face has
no area.

**Designs are shared; palettes are not.** Barrens crates and warehouse
crates are one drawing in two palettes; the corp filing cabinet is the
locker design at waist height; the street kiosk is the vending machine
unlit. A set's character comes from which designs it offers and what it
paints them, which is what makes a new set cheap to author. Each design
declares its own footprint, and that is what the contact shadow falls from
and the ambient ring surrounds — so a lamp post's shadow is a post's, not a
cell's, and a tree and a lamp post take no light from the floor (a sightline
passes them, and so does the light).

**Lights are fixtures.** A design used by a light tile hands the light pass
a face: the lamp head's pool on the ground, the screen of a terminal, the
rim of a fire drum. The pool and bloom are then drawn by the same unlit pass
as every other light, so a street lamp lights the pavement the way a neon
sign lights a wall.

**Detail comes in three tiers, like everything else.** The second pass
(2026-09-13) gave every design the same hierarchy an environment artist
works to at small size: a silhouette first; then secondary forms — plinths,
lids, rims, bevels, frames, cushions, hinges, wheels with hubs, windows with
frames; then only the tertiary accents that still read at table zoom —
seams, rivets, vents, stencils, a mug on a desk, papers, a sticker on a
locker, rust runs, a folded blanket. Material detail stays inside the tier-2
budget of its surface (shades of the tile's own tones, ink only for
hairlines); hard-coded colours are glass, foliage or small fixed materials
held to rule 7. Every design varies per cell through `k.rnd` — a turned
monitor, a jacket over a chair, a cloth on one table in four, crates stacked
three ways, a pitchfork in one hay bale — so neighbouring copies are two
things rather than one stamp. The lit designs moved their fixture face to
the part that is actually the lamp (a strip across the top of a vending
window, the head of a work light) so the glow no longer washes out the
object under it.

The budget is a per-prop draw-call ceiling, checked over hundreds of cell
seeds at every height the catalogue uses, lit and unlit: at most 110 calls
in isometric (the forklift's pallet-and-crate variant, the busiest, is 103)
and 30 in plan. On average a prop went from about 33 calls to about 52 in
isometric and from 7 to 15 in plan. On a laptop canvas the grid still holds
its frame budget with no frame over 50 ms while panning, zooming or
dragging (`e2e/perf.spec.ts`).

A prop afloat — a boat, a skiff, a buoy — is drawn by the same design with a
`sink`, so it sits in the recessed water rather than on it.

## Water is a body of water

A water tile used to be a floor with three wavy lines printed on it, and a
harbour painted forty squares wide was forty framed pictures of water sitting
flush with the quay — the grid was the most visible thing on its surface. A
ground tile marked `liquid` (`TILE_LIQUIDS`: `deep`, `shallow`) is drawn by
`stage/water.ts` instead, and every square of it knows its neighbours:

- **One surface.** Each square's colour is a field: distance from the
  nearest land, known at the centre and estimated at the corners and edge
  midpoints from the squares that meet there, with each point's palette the
  blend of the water around it. A deep tile beside a shallows tile shelves
  across two squares. The square is cut into quads by how far that colour
  moves across it — one fill for open water, up to 4×4 on a steep shelf —
  because at three a side the steps read as bands parallel to the shore on a
  dark surface, and at four each step is under a value point and a half.
- **Depth from the shore.** Water is the tile's `deep` colour out past about
  three squares and lightens linearly toward its accent at the shore; where a
  beach runs under it the sand shows through. A reed bed is painted in its
  plants' colours but stands in the water beside it.
- **Ripples in world space.** A lit crest and a darker trough as dashes along
  lines of constant screen height, placed by world position, so they cross
  square borders unbroken. None in the first square off the shore, where the
  foam is.
- **Foam follows the shoreline**, wobbling as a function of position along it
  (so it joins square to square), wrapping round corners, lacier on a beach.

**The land drops to the water.** In isometric the water sits below the ground,
so the land's two faces turned toward the viewer show between its edge and the
waterline. Seen from the iso camera a pool sunk `d` cells shows its surface as
its footprint slid down the screen by `d`, and whatever fills the footprint
above the slid surface is the far wall — and sliding down the screen is exactly
a step of `(d, d)` in grid space. So a far wall is a band `d` wide along the
water square's two far edges, drawn in the water square after the land behind
it, with nothing to sort. What the wall is made of comes from the land's
`shore` (`TILE_SHORES`):

| Shore | Drop | Wall | On the land's top |
| --- | --- | --- | --- |
| `quay` | 0.30 | coursed blocks, staggered joints, weed at the waterline, a lit coping | pale jointed coping stones |
| `pier` | 0.30 | vertical boards, a waler, slime at the waterline, round pilings every half square with a ring of water at their feet | a bolted capping beam |
| `bank` (default) | 0.14 | dark earth with a stone and a root, the turf's thickness and ragged tongues of grass over the lip | a damp rim |
| `beach` | 0 | none — it runs under | wet sand in three bands and a swash line with wrack |

Plan view has no drop (`heightRise` is zero) and gets the architect's symbols
instead: a quay's heavy line and wall-thickness line, a pier's line and its
posts, a bank's hand-drawn line; a beach is its wet band and swash line.

Floating things — a boat, a skiff, a buoy — sit `WATER_LEVEL` (0.2 cells) below
the land in isometric: the prop kit takes a `sink`, and the contact shadow falls
on the water where the hull is, not on the floor it would have been on.

Every waterside set has true water (`deep` and `shallow`), a **Beach front**
(`beach`) and a **Pier wall** (`pierwall`), and every board and concrete ground
there says how it meets the water — boards are piers, concrete is a quay, sand
is a beach, only earth is left to `bank`. The plaza's fountain basin is water
in a stone kerb; the farm pond is water in earth.

**Cost.** A water-heavy 40×30 waterfront is about two fifths more draw calls
than the printed water was (11.7k → 16.2k in isometric, most of it the shelf's
quads). The water is resolved once
per stroke and cached on the stroke's input (about 2.6ms on that map); the
signatures fold in what a square's drawing depends on — its distance from
land, its neighbours' shores and palettes — so a quay painted three squares
away still redraws the water it changed while the dirty rule stays one square
wide.

## What it costs, and how the stage pays for it

Drawn this way a 40×30 scene is about 170,000 draw calls. A full-layer
redraw on every brush stroke measured at 106–147ms on a real machine — lag
under the one tool a GM uses most while building. So the stage cuts the layer
into 8×8-cell chunks, each its own graphics, and a stroke redraws only the
chunks it touched plus their neighbours (a wall run turns its corners from
the cells next door). Shadows and lights are redrawn whole; both cross chunk
borders freely and both are cheap. The same stroke now costs 15–30ms. See
`stage/tileChunks.ts`; the one-shot `drawTiles` still exists for tests and
draws the identical passes.
