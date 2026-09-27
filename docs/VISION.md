# Vision, light and cameras — the plan for FR9.16

*Status: proposal, 2026-09-08. Cameras (FR9.23) are built; everything after
§2 is the plan for the rest, written so it can be argued with before it is
coded.*

*Update, 2026-09-27: the party's sightlines and a fog of war kept by the
server are built (FR9.13, FR9.16), with the GM's decisions of that day.
They went another way from this plan in one large respect: the table shares
one pooled sight, worked out on the server, rather than each phone drawing
its own. §8 says what was built against the plan; §1–§7 are kept as
written.*

Roll20's dynamic lighting answers one question — "which pixels can this
token's eyes reach" — with one model of eyes. Shadowrun has four kinds of
eyes at every table, a light table that turns darkness into a dice
modifier, and a GM who has to know the answer for a guard who is not even on
the map yet. So this is not a port of dynamic lighting. It is a **sight
model with rules attached**, built so that the same engine answers the
player ("what can I see, in thermal, from here"), the GM ("what does the
camera cover, what would the guard see, what modifier does that shot take")
and the dice ("−3, dim light, no low-light on the shooter").

## 1. What already exists

The line-of-sight engine is in `packages/rules/src/vision/`, pure grid
maths, and it already carries most of the weight:

- `sightModelFor(scene, level)` turns painted tiles and traced walls/doors
  into one model per floor: which cells block sight, which give cover, how
  tall they stand.
- `lineOfSight(a, b, model)` — can A see B, and with what cover; symmetric
  by construction (a property test guards it).
- `visibleFrom(cell, model, range)` — everything one pair of eyes can see.
- `coneCells(eye, model)` — the same, trimmed to a facing and a field of
  view (the camera, and later any fixed sensor).
- The **shroud** (`useShroud`, `stage3d/masks.ts`) darkens what the
  viewer cannot see: a player's own runner, or a viewpoint the GM picks.
- The **environment** (`env.ts`, the Env tab) composes the scene's light,
  visibility, glare and wind levels into the SR5 tier — `−1/−3/−6`, two at
  the same worst level escalate to the next — and feeds it into every dice
  pool as a named modifier.
- **Tiles already know what they are.** Every emissive tile is a light
  source with a colour; every full-height tile blocks sight; glass stops the
  body and not the eye. The floor the GM built is the collision map, and it
  can be the light map too.

**Three things were fixed on the way to writing this (2026-09-08).** The
"players see their own sightline" switch lived in the GM's browser and never
reached a player device; it is now a scene setting (`scene.vision`), saved
and broadcast, so every device hears it. Players' scenes had the traced
walls and doors stripped, so a player's shroud was cut by painted tiles only
— they now receive walls and doors (without the GM's notes) as the sight
geometry they are, and a pasted-token device learns its own runner from the
server (`GET /api/me`) rather than from a user id it never had. And a ray
through the joint between two wall pieces — a door's frame, a wall drawn in
two strokes — slipped between them; a joint now blocks like the wall it is.
With those, a player device darkens what its runner cannot see and draws no
token outside that sightline; full-height tiles (walls, columns, containers,
lockers, racks) and traced walls and closed doors all cut it.

**Doors (2026-09-09, FR9.24).** Players open and shut doors themselves —
traced doors by their knob, painted doors by their cell — through one route
the GM's hand uses too (`POST /api/scenes/:id/doors`). The GM locks and
unlocks; a locked door refuses a player by name, and which doors are locked
is never on a player's wire. An OPEN door, painted or traced, passes sight:
the sight model reads a painted door's state off its floor's `doors[cell]`
and a traced door's `open`, so a runner who opens the freight door sees the
warehouse floor the moment the scene re-reads. The canvas draws it open —
the way through in elevation, the leaf standing out in plan.

What is missing is the other half of the sentence: light is scene-wide
rather than per cell, eyes are all the same, and nothing on the map is warm.

## 2. Cameras — built

`geometry.cameras[]`: a point, a facing (degrees, 0 east, 90 south), a field
of view, a reach, a floor, on/off, a label. The GM mounts one with the
Camera tool, aims it from the **Cams** tab (compass presets or a number),
and the canvas draws the cone of cells it actually covers — cut by walls,
tiles and closed doors — as an amber wash with the two field-of-view edges.
"Look through it" puts the camera on the LOS lens so the shroud shows the
map the camera's way. Switching a camera off (the decker killed it, a round
did) leaves a struck-through eye and no cone.

**Players never receive a camera.** `sceneForViewer` omits the list from
every non-GM payload — not an empty array, no key at all — and the stage
draws none for a non-GM role even if handed one. A camera a player can see
on the map is a camera their character has already found; when the decker
spots it on the host, the GM says so. That is a scene, not a payload.

The same engine will drive **sensor drones, motion sensors and turrets**
later: each is a fixed or moving eye with a cone.

## 3. The rules we are adapting

From the core rulebook's Environmental Modifiers (Ranged Combat, p. 175),
which the engine already encodes at scene level. The two axes that matter to
vision:

| Row | Visibility | Light / Glare | Modifier |
|---|---|---|---|
| 0 | Clear | Full light / no glare | — |
| 1 | Light rain, fog, smoke | Partial light / weak glare | −1 |
| 2 | Moderate rain, fog, smoke | Dim light / moderate glare | −3 |
| 3 | Heavy rain, fog, smoke | Total darkness / blinding glare | −6 |
| | Two or more conditions at the −6 row | | −10 |

Two conditions at the same non-zero row escalate one row (the book's own
worked example: two −1s become a −3). Compensation shifts rows:

| Enhancement | Effect on the rows |
|---|---|
| Low-light vision | Partial light and dim light count as full light; total darkness still applies |
| Thermographic vision | Visibility **and** light shift one row up |
| Ultrasound | Visibility shifts one row up; light is ignored, within 50 m |
| Flare compensation | Glare shifts two rows up |
| Sunglasses | Glare shifts one row up; light shifts one row **down** |
| Image magnification | Range one category up (already in the ruler, FR9.9) |
| Smartlink, tracer rounds | Wind (not vision) |

Where the eyes come from: metatype (elves and dwarfs see in low light,
orks too, trolls thermographic — engine-derived from the sheet), cybereyes
and goggles with vision enhancements, spells and adept powers. All of it is
already on the character sheet as gear and qualities; the sheet derive step
(`derive.ts`) is where "which vision modes does this runner have" becomes a
fact the map can read.

## 4. The model: light per cell, eyes per token

### 4.1 A light map, from things the GM has already placed

Every cell on a floor gets a **light level 0–3** (full, partial, dim, dark),
derived — not painted — from:

1. **The scene's ambient level** (the Env tab's Light, as now): the floor
   everything starts at. A night street starts at dim; an office at full.
2. **Emissive tiles** are light sources. A sodium lamp pool, a neon sign, a
   barrel fire, a work light, a street lamp, a server rack: each raises the
   cells within its reach by one or two rows, falling off with distance and
   stopped by walls (the same `visibleFrom` walk from the light's cell —
   light and sight obey the same geometry). The catalogue already rations
   these to two–four per set, which is exactly the practicals budget the
   lighting model wants.
3. **GM-placed lights**, for what tiles do not cover: a flashlight clipped
   to a token (moves with it), a flare, a drone spotlight, a room's overhead
   fixtures as one "this room is lit" zone. A light has a colour, a radius,
   a row-shift, and an owner.
4. **Darkness zones**: a blackout, a cut power grid, a magician's Shadow
   spell — a zone that lowers rows. The decker killing the lights is one
   click on the zone.

The result is a `LightMap` (`Map<cellKey, 0..3>`) per floor, recomputed
when any of those change and never per frame. It is drawn as what it is —
a shading of the floor in the GM's view, lit pools brighter, dark rooms
darker — which is also the first honest answer to "is this room lit".

### 4.2 Visibility per cell

Same shape, second axis: **smoke, fog, rain** as zones with a row (a smoke
grenade is a 3-turn zone at row 2; the docks in fog are the scene's ambient
visibility). Thermographic eyes shift it up; ultrasound too.

### 4.3 Eyes: the vision modes a token has

Each token carries `vision: { modes: ('normal'|'lowlight'|'thermographic'|'ultrasound'|'astral')[], flare: boolean, magnification: boolean }`, derived from its sheet for characters and set on the template for NPCs and spirits. A **viewing mode** is which of those the viewer is currently using — the switch the player flips.

**What a viewer sees** = `visibleFrom(eye, model, range)` with two changes:

- **Range shrinks with darkness** after compensation: a cell at row 3
  (total darkness) is not seen at all by normal eyes, at row 2 (dim) only
  within a short radius, at row 1 further. Low-light removes the row-1 and
  row-2 limits; thermographic sees *heat* regardless of light (see 4.4) but
  loses fine detail; ultrasound sees shape within 50 m and ignores light
  entirely.
- **The modifier comes with the sightline.** For any pair (viewer,
  target), the engine returns the environmental tier *after* the viewer's
  compensation — light row at the target's cell, visibility row along the
  line, glare, wind, range — as a named modifier the dice pool takes, with
  provenance ("dim light at the target, low-light vision → full light").
  This replaces the scene-wide `env.scene` modifier for anything that has
  a target on the map; the scene-wide one stays for rolls with no target.

The shroud becomes **per-mode**: the same darkening it does now, computed
from the viewer's mode. Cells seen only as heat are drawn as heat (4.4).

### 4.4 Thermal: heat per cell, and a thermal view of the map

Thermographic vision is the one mode that is not "normal sight with fewer
penalties" — it sees a different quantity. So the map gets a **heat
value** per cell, from things that already exist:

- **Tiles carry `heat`** (a small signed number in the catalogue, like
  `emissive`): a generator, a running engine, a barrel fire, a server rack,
  a steam pipe, a warning light, a hot exhaust are warm; a sludge channel,
  standing water, a steel tank, a chain-link fence, wet asphalt at night are
  cold; concrete and carpet are neutral. Emissive tiles are warm by default.
- **Tokens are warm** — living metahumans and animals hot, spirits neutral
  (they have no body), drones and vehicles warm while running, a corpse
  cooling over turns. A token's `heat` is on its template with sensible
  defaults from its source.
- **Recent events leave heat**: a car that just parked, a gun just fired,
  a door someone just came through — optional GM-placed "warm spots" with a
  decay in turns.

The **thermal rendering** is a filter over the normal stage, not a second
renderer: the tile layer draws in a false-colour ramp (cold blue, neutral
grey-purple, warm amber, hot white) from `heat` instead of the palette;
tokens draw as heat blobs at their footprint, hidden ones included *if*
they are in a thermographic viewer's sightline and warm — which is the
rule that makes thermal worth having (a hidden ganger behind a crate is a
warm shape; a spirit is nothing). Glass is opaque to thermal; smoke is not.

**The GM sees the thermal map while building.** The View toggle (Plan/Iso)
gains a **mode** switch — Normal / Low-light / Thermal / Ultrasound — that
restyles the GM's own canvas with no viewpoint at all. Painting a generator
and seeing the room warm up is how the GM learns what the troll will see
without asking. The same switch, restricted to the modes the runner has, is
what the player gets.

### 4.5 What the player gets

On a player's device, under the map: **a mode selector showing only the
modes their runner has** ("Eyes: normal · low-light · thermographic"). It
changes their own shroud and restyle, and nothing else — it is a view of
data the server already sent them, filtered by their own sightline, so it
costs the GM nothing and gives them the thing they most often ask for out
loud: "can I see anything with thermo?". The TV kiosk follows the GM's
choice of "what the table sees" (FR9.21), defaulting to normal.

Astral perception is the same mechanism with a different map: auras on
living things, wards and spirits visible, everything else fog — later, and
only once a magician wants it.

## 5. Proposed additions that fit this

In rough priority, cheapest and most-used first:

1. **Flashlights and lamps on tokens.** A light a token carries; the most
   common light source in a run and the one that reveals the party as much
   as the room. One field on the token, drawn as a cone or a pool.
2. **The decker's switches.** Lights and cameras as named things on the map
   that a Matrix action can flip: "kill the lobby lights", "loop camera 3".
   Cameras already have `active`; light zones get the same. The Matrix
   overlay (FR9.17) is where those become icons.
3. **Camera feeds as a lens.** A "security console" panel listing the
   scene's cameras with a thumbnail of what each covers — what the decker
   sees once they are on the host, and what the GM reads when a guard
   "checks the monitors". The lens already exists; this is a panel of them.
4. **Sensors that are not eyes.** Motion sensors (a cone that fires when a
   token moves through it), pressure plates (a cell), laser tripwires (a
   segment), each raising an alarm the GM sees. Same cone/cell/segment
   primitives, different trigger.
5. **Smoke, flash and flare as placed effects.** A smoke grenade is a
   visibility zone with a duration in Combat Turns; a flash-pak is a glare
   burst; both expire with the tracker's clock so the GM never forgets to
   remove them.
6. **Noise as a second sense.** A firefight or a generator is loud; hearing
   is another visibility map with different blockers (walls muffle, doors
   leak). Cheap once the first map exists, and it answers "did the guards
   hear that".
7. **Alarm state.** A scene-level "alert" the sensors and cameras raise,
   which changes NPC behaviour hints and the environment (floodlights on:
   the light map jumps to full, and the runners' cover disappears).
8. **Drones as movable eyes.** A drone token with a camera cone that moves
   with it, the rigger's view being its cone in whatever modes its sensor
   package has — the same camera code on a token.
9. **Astral overlay** (4.5), when a magician is at the table.

## 6. What this is not

- Not a per-frame lighting renderer. Everything is a per-cell map
  recomputed on change, drawn as flat washes and restyles — the same
  discipline the shroud and the tile chunks already follow, so it stays fast
  on the laptop and the phones.
- Not secrecy. Fog and vision remain a presentation boundary for terrain
  and a secrecy boundary for everything else (hidden tokens, GM pins,
  cameras). The floor plan is still sent whole; what the player *can act
  on* is what changes. *(2026-09-27: the fog became that secrecy boundary
  for the tokens standing under it too, withheld by the server; §8.3.)*
- Not a replacement for manual fog. FR9.13's fog stays first-class; the
  light map and the shroud draw under it.

## 7. Order of work

1. **Vision modes on the sheet and the token** — derive `vision` from
   metatype, 'ware and gear; show it on the roster. No map change yet, but
   the fact exists.
2. **Light map** from ambient + emissive tiles + GM lights; GM-side
   rendering and the Env tab reading it. The scene-wide light level becomes
   the ambient floor.
3. **Per-pair modifier** with provenance, replacing `env.scene` for shots
   with a target; the LOS tab shows it beside the cover call.
4. **Per-mode shroud** and the player's mode selector.
5. **Heat on tiles and tokens; the thermal restyle**, GM view first, then
   the player's.
6. Visibility zones (smoke/fog), flashlights, the decker's switches.
7. Sensors, alarm state, camera feeds panel, drones.

## 8. What was built, against this plan (2026-09-27)

*The plan above is kept as it was written on 2026-09-08. This section says
what was built since, where it follows the plan and where it went another
way.* The biggest change of direction: the plan put a pair of eyes on each
player's device, drawing its own shroud. What was built is the **table's
shared sight, kept by the server**, because the GM decided so on
2026-09-27 (`DESIGN.md` Q9):

1. Sight is **pooled**: every phone and the TV show the union of all the
   runners' sight. No phone is shown more or less than another, and the
   older "dim outside own sight" switch (§1) keeps working unchanged: it
   darkens a phone to its own runner's sightline and withholds nothing.
2. Unmasking is **always automatic** while a scene's sightlines are on:
   what any runner sees is live at once and joins the party's memory. The
   GM can fog it again or forget it.
3. **Strict SR5 darkness** (§3's table, per square).
4. Tokens outside LIVE ground are **withheld by the server** from players,
   the TV and observers; runners are always on the table.
5. Scenes **start open**, with an explicit fog switch.
6. Sightlines are a **per-scene** setting (`SceneVision.sight`).
7. The GM reveals **live or explored** ("seen before": the map dimmed,
   nobody on it).

### 8.1 The order of work (§7), item by item

1. **Vision modes on the sheet** — built by 2026-09-13: `visionModesFor`
   (`packages/rules/src/vision/modes.ts`) reads metatype, 'ware, gear and
   qualities. Not on the token: an NPC or a spirit has no modes, which
   matters to nothing yet, since only runners are eyes for the sightlines.
2. **Light map** — built 2026-09-26: `lightMapFor`
   (`packages/rules/src/vision/light.ts`), from the ambient level, glowing
   tiles, lamps the GM places (`SceneLight`) and lights tokens carry
   (`TokenLight`), spread through the same walls and doors as sight, one
   light row per square; the GM has a light-map view. Darkness zones are
   not built.
3. **Per-pair modifier** — not built. The dice still take the scene-wide
   environment modifier; the light rows decide only what is seen.
4. **Per-mode shroud and the player's mode selector** — the selector and
   the restyle are built (`grid/hud/eyes.ts`, `grid/stage/viewModes.ts`),
   showing a player only the modes their runner has. What the table is
   SHOWN is no longer the phone's own shroud but the pooled sight (§8.2),
   worked out on the server with each runner's own modes; the selector
   changes how the map looks, not what is on it.
5. **Heat** — the thermal restyle is built (a cold floor, warm bodies).
   Per-tile and per-token heat are not.
6. **Flashlights** — built as token lights, which a player may switch on
   and off for their own runner. Smoke and visibility zones and the
   decker's switches are not.
7. **Sensors, alarm state, camera feeds, drones** — not built.

### 8.2 Sightlines

A per-scene switch. The rules are `partySight` and `sightFor`
(`packages/rules/src/vision/sight.ts`); the server's pass is
`recomputeSight` (`apps/server/src/services/sight.ts`).

- **When.** After every committed change that can move the party's sight,
  inside the same transaction: a runner's step (the drop, never a drag
  frame), a door, a light switched or carried, paint and walls, a scene
  edit, a fog op, the scene going live, a runner's sheet saved with other
  eyes. Never per frame. A guard with no light moves nobody's sight and
  costs nothing.
- **What stops a look.** Walls and closed doors, painted or traced; an
  open door is a doorway. A wall is seen by its face, from a seen open
  square in front of it, so remembered rooms keep their walls; it is never
  seen from its far side, and a corner is lent only where it is a corner.
  A runner standing in a square that blocks sight sees that square alone.
- **Darkness.** A square is seen when a look reaches it and it is not in
  total darkness for the runner's eyes after compensation (§3). Low-light
  vision helps the dice, not the map; thermographic vision shifts every row
  up and so sees every square a look reaches; ultrasound sees within 50 m
  in any light; astral perception changes nothing here. There is no range
  cap: the light does the limiting, so a lit room across a dark hall is
  seen.
- **What is kept.** `FogState.sight`: per floor, `live` (what some runner
  sees now) and `explored` (everything the party has seen), as bitsets.
  Every pass ORs live into explored. With the sightlines off, live is
  emptied and the memory kept. A scene imported into another campaign
  loses the record; one imported back into its own keeps only the memory.
- **What the table hears.** One public `fog.updated` op `sight` with the
  whole record, only when it changed. Phones fold it in place and the TV
  folds it; the tokens it uncovers or covers arrive and leave as
  `token.added` / `token.removed`, after it.
- **What each screen draws.** Phones and the TV stamp the squares into the
  fog mask they already had (`stage3d/masks.ts`: live clear, seen before at
  0.62, hidden solid). The GM sees every square tinted by its state, and
  a **See as party** lens shows exactly what the table is shown.

### 8.3 The fog: three states, and a secrecy boundary

Per square and per floor, a square is **hidden**, **seen before** or
**live** (`fogCells`, `packages/rules/src/vision/fogState.ts`): the fog
off makes it live; then what a runner sees now; then the GM's brush mark;
then a region or shape the GM revealed live; then the party's memory or a
reveal as seen before; otherwise hidden. The GM reveals regions, drawn
shapes and single squares (the brush) either way, fogs any of them again,
and forgets one floor's memory or all of it; the switch turns the fog off
without losing any of it.

§6 said fog and vision are not secrecy for the terrain, and that holds:
the floor plan, the walls and doors, the map images and the GM's lamps are
still sent whole. But the fog is now the **secrecy boundary for everything
standing on the map**, where it had been only a cover the client drew, with
every guard behind it on every player's wire:

- a token not on live ground is withheld, with its moves and drags, and
  crosses the edge as a new token arriving or leaving;
- a public pin on hidden ground is withheld (seen-before ground shows it);
- the table's combat roster names a combatant's token only while the table
  has that token;
- a runner's new look or portrait is told only on the tokens the table has;
- the Fixer's spoiler guard knows every name the map withholds;
- nothing that happens on a scene the GM is still staging reaches the table
  at all, until it goes live.

Drawings, templates, pings and "focus here" stay public wherever they
land: each is somebody's deliberate mark for the table, and a template the
GM drops on a guard in the dark is the GM's call, as at a real table.

### 8.4 Light at the fog's edge

The lamps of a hidden room still light the revealed floor they reach
(through an open door, across a doorway); their fittings and halos are
hidden with the room. Lights carried by tokens come and go with their
tokens. Walls under the fog still cast shadows, so a hidden room's lamp
does not shine through its own walls.

### 8.5 Still open

- Traced walls and doors have no floor, so they block sight on every
  floor; floors seen below through open squares use the mask of the floor
  in view.
- No "shares sight" flag for drones and spirits, and no sight per player
  (that would need the hub to address one socket's tokens, and a sight
  pass per player on every move).
- Every sight change is a persisted event; if the event log swells, the
  per-move ones can go ephemeral.
- A token two or more squares across on the fog's edge is sent when any of
  its squares is live, while its plate and carried light follow its centre.
- At Medium and High quality only a few real-time lamps cast shadows (3 of
  8 point lamps at Medium, 8 of 24 at High); the rest pass through walls,
  fog or no fog, the GM's view included. A quality-tier approximation, not
  a fog leak; the fix would clip each lamp to its light polygon.
- The per-pair modifier (§4.3), heat (§4.4), visibility zones (§4.2) and
  everything in §5 past flashlights.
