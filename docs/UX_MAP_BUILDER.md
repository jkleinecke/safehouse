# The map builder, against the Laws of UX

A proposal, not a build. Measured on 2026-09-09 against the Grid page as it
stands (`apps/web/src/features/grid/`), driven as the GM on the demo's Pier 23
scene, and read against the principles collected at https://lawsofux.com/.
`docs/UX_AUDIT.md` asks "can a GM do the job"; this asks "how much does the
GM have to hold in their head to do it" — and the answer today is: too much.

The laws quoted below are the site's own one-line definitions.

---

## 1. What the builder is today

One page, three surfaces, everything at the same level:

**The toolbar** — fourteen tools in two rows, plus snap, zoom, fit, Plan/Iso
and the GM toggle: *Select · Ruler · AoE · Point · Fog · Focus · Wall · Door ·
Zone · Pin · Camera · Note* and the view controls. Play tools (Ruler, AoE,
Point, Focus) sit beside authoring tools (Wall, Door, Zone, Pin, Camera, Note)
with nothing to say which is which.

**The GM panel** — twelve tabs wrapped over three lines: *Scenes · Map ·
Tiles · Tokens · Geo · Pins · Cams · Notes · Fog · Env · LOS · TV*. The order
is the order the features were built in, not the order a GM uses them.

**The canvas** — with a floors chip row along the top and notices that appear
in the same corner.

Three things are true of it at once. Everything a GM needs is there. Nothing
tells them where to start. And most of what is on screen at any moment is
for a different task than the one they are doing.

---

## 2. The findings, law by law

### Hick's Law · Miller's Law · Choice Overload — *"the time it takes to make a decision increases with the number and complexity of choices"; "7 ± 2 items"*

Twelve tabs and fourteen tools are twenty-six choices on screen before the
GM has decided what they are doing. A GM laying a floor sees the TV tab, the
LOS lens and the AoE tool; a GM running a fight sees the calibration fields.
The Geo tab then lists twelve walls, each with three buttons and four
coordinate boxes: forty-eight inputs to scroll past to reach the door list.

### Chunking · Law of Common Region · Law of Proximity — *"elements sharing an area with a clearly defined boundary are perceived as a group"*

The tools are one undifferentiated row. Wall, Door and Zone belong together;
Ruler, AoE and Point belong together; Fog and Focus belong to neither. The
tabs have the same problem: Geo, Pins, Cams and Notes are all "things drawn
on the map"; Fog, Env and LOS are all "what the table sees and rolls under".
None of that grouping is visible.

### Law of Similarity · Law of Uniform Connectedness · Mental Model — *"similar elements are perceived as a group"; "a compressed model of how a system works"*

The same kind of thing is reached two different ways. Walls, doors and pins
have a toolbar tool **and** a "click the map to…" button in their tab. Tile
painting (Brush, Area, Room, Erase) lives only in the Tiles tab and has no
toolbar tool at all. Fog's *tool* is on the toolbar while its *save* is in the
tab. A GM cannot form one rule for "where do I pick up a tool", so they hunt.

### Jakob's Law · Paradox of the Active User — *"users prefer your site to work the same way as the sites they spend their time on"; "users never read manuals"*

Every map editor a GM has used — Roll20, Foundry, Dungeondraft — has single-key
tools (V select, W wall, D door, R room, Esc to stop) and a palette on one
side. Safehouse has neither shortcuts nor a shortcut hint. The help is prose
paragraphs under each section, plus a footer line ("doors toggle by clicking
their knob with the select tool") repeated on eleven of the twelve tabs. GMs
do not read it; they click and see what happens.

### Cognitive Load — *"the mental resources needed to understand and interact with an interface"*

Section titles carry specification ids: *Fight FR9.10*, *Place a pin FR9.3*,
*Mount a camera FR9.23*, *Drop a note FR9.25*, *Generate FR10.2*. These are
for the repo, not the GM; on screen they are noise the eye has to skip every
time. Labels are set in small uppercase mono, and the panel is 300 px wide,
so category rows truncate (`BUILDIN`, `INTERIOR`) and wall names read as
`W.N…`.

### Fitts's Law — *"the time to acquire a target is a function of the distance to and size of the target"*

The things a GM clicks hundreds of times in a session — tile swatches, the
tool buttons — are the smallest targets on the page (chips, ~24 px tall). The
palette swatch carries a 12 px colour dot; the material is identified by
reading its name.

### Goal-Gradient Effect · Zeigarnik Effect · Serial Position Effect — *"approach increases with proximity to the goal"; "people remember uncompleted tasks"*

Building a scene has a natural order — image, calibrate, floors, walls and
doors, tiles, fog, environment, activate — and nothing shows it. There is no
sense of progress, no "what's left", and the last step (activate for the
table) is a small button in the Scenes tab rather than the finish line.

### Von Restorff Effect — *"the one that differs is the one remembered"*

Accent colour is spent evenly: `create`, `activate`, `place at centre`,
`save polygon`, `generate`, `upload image` are all accent buttons. The two
actions with consequences for the whole room — *activate for the table* and
*start a fight* — do not stand out from *add a floor*.

### Occam's Razor · Tesler's Law — *"the fewest assumptions"; "some complexity cannot be reduced"*

Sight, cover, fog, floors and cameras are real Shadowrun complexity and stay.
What can go: the second route to every tool, the coordinate boxes on every
wall (the canvas already edits walls by dragging), the FR badges, the repeated
footer, and the Plan/Iso and GM toggles in the *tool* row where they read as
tools.

### Aesthetic-Usability Effect · Peak-End Rule

The rendering is the app's strongest asset — the sodium-lit warehouse reads as
a place, and GMs forgive a lot for that. The peak is the first painted room;
the end is activating the scene and watching it land on the TV. Both should
be one gesture away and celebrated (the "focus pushed to the table" chip is
the right instinct; activation deserves the same).

### Doherty Threshold — *"<400 ms"*

Already met: painting is coalesced per stroke, geometry saves are optimistic,
the scene refetches on events. Keep it that way through any redesign — the
inspector proposed below must patch locally first, as `ScoreCell` does.

---

## 3. The proposal

Six changes, in the order they pay back. The first three are days, not weeks,
and change no server code.

### 3.1 Three modes, not twelve tabs — **Build · Prep · Play**

Replace the tab strip with a three-way mode switch at the top of the panel,
and show only that mode's tools in the toolbar.

| Mode | Toolbar | Panel sections |
| --- | --- | --- |
| **Build** — the map itself | Select · Room · Area · Brush · Erase · Wall · Door · Zone · Pin | Map image & calibrate · Floors · Tiles palette · *Inspector* (see 3.2) |
| **Prep** — the GM's secrets and levers | Select · Fog region · Camera · Note | Fog regions · Cameras & notes · Token layers · Environment · Sight ("what players see") · Fight |
| **Play** — Friday night | Select · Ruler · AoE · Point · Focus | Tokens · Fight · LOS lens · TV |

Hick's Law: five or six tools and four or five sections per mode, never
twenty-six. Common Region: the toolbar's tools and the panel's sections agree
about what the GM is doing. Mental Model: "I am building / prepping / playing"
is a model a GM already has. Scenes (the list, create, activate) stay in
every mode as the panel's header, because switching scenes is not a mode.

The view controls (snap, zoom, fit, Plan/Iso) and the GM-view toggle move to
the canvas's own corner, out of the tool row, so the tool row is only tools.

### 3.2 One place per thing: tools in the toolbar, an inspector in the panel

Every drawable thing has exactly one way to make it (its tool) and one way to
edit it (click it, and the inspector shows it). The Geo tab's forty-eight
coordinate boxes become: a short list of walls and doors (name, length, a
lock badge), and, when one is selected on the canvas or in the list, its
properties — endpoints, note, *make this a door*, lock, delete. Pins, cameras
and notes join the same inspector rather than owning a tab each.

Fitts's Law and Proximity: the controls for the wall you clicked appear next
to the thing you clicked, not in a list you scroll. Similarity: walls, doors,
pins, cameras and notes all behave the same way, so learning one teaches all.

### 3.3 Shortcuts, tooltips and one hint line

Single-key tools on the current mode's toolbar — **V** select, **R** room,
**A** area, **B** brush, **E** erase, **W** wall, **D** door, **Z** zone,
**P** pin, **F** fog region, **C** camera, **N** note, **M** measure,
**O** area of effect, **X** point, **G** focus; **Esc** returns to select,
**1–9** switch floors — shown in every tool's tooltip. A key only fires when
nobody is typing in a field, never with a modifier held, and a player's keys
only reach the four tools a player has. One contextual line under the toolbar
replaces the paragraphs and the repeated footer:

> Drag along the wall. Shift for a free angle. Esc when done.

Jakob's Law and the Paradox of the Active User: a GM who has used any map
tool will try the keys; the hint line teaches the one thing the current tool
needs. Drop the FR ids from every section title on the GM's screens (they stay
in code comments and the design doc, where they belong).

### 3.4 A build checklist with a finish line

In Build mode, a compact progress strip under the scene name:

> ☑ Map image · ☑ Calibrate · ☐ Floors · ☑ Walls & doors · ☐ Tiles · ☐ Fog · **Activate for the table →**

Each step is a chip that scrolls the panel to its section; a step ticks itself
from the scene's own data (an image attached, walls present, a fog region
defined). Goal-Gradient and Zeigarnik: the GM sees what is left and is pulled
to finish. Serial Position and Peak-End: the last item is the one that
matters, and pressing it should say so — the same chip the Focus tool already
shows, "scene pushed to the table", with the TV preview link beside it.

### 3.5 A palette you can hit

Swatches drawn as the material (a 40 px square of the tile's actual render,
not a coloured dot beside a name), the category row as a segmented control
with room for its words, **Room** as the hero action for a fresh scene ("drag
a rectangle: floor inside, walls around"), and **Auto** as the default brush
with its one-line explanation in its tooltip rather than the panel. Fitts's
Law on the most-clicked targets in the app; Choice Overload answered by
showing one category at a time with the tileset's five or six materials.

### 3.6 Accent for consequence, muted for the rest

Reserve the accent button for the three actions that reach other people:
*activate for the table*, *start a fight*, *reveal* (fog). Everything else on
the panel is the plain button. Destructive actions (delete a wall, clear a
floor, delete a fight) stay muted and confirm on a second click — the tracker's
✕ already does this; the Geo list's red *delete* per wall should too. Von
Restorff: the button that changes what the players see is the one that looks
different.

---

## 4. Beyond the builder — the same laws elsewhere

*Done on 2026-09-10 — see `docs/UX_SITE.md` for the walk over every other
screen and what changed.*

- **One word for a fight.** The tracker says *fight*, the Generator says
  *encounter*, the Grid says both. Mental Model: pick one for every label a
  GM reads (this document votes *fight*; *encounter* can stay in code).
- **The Table page** is two tools in one column — the roller and the tracker
  — and on a laptop the roller's pool/limit/Edge/visibility row is the
  busiest strip on the screen. Chunking: fold the rarely touched controls
  (limit, visibility) behind a disclosure, keep pool and roll large.
- **The sidebar** already chunks well (Campaign · At the table · Prep · Table
  display). Keep it; its section headings are the best-labelled thing in the
  app.
- **FR ids** appear on the Generator, Tokens, Pins, Cameras, Notes and Fight
  sections. Remove them everywhere a GM reads (see 3.3).
- **Empty states** are good where they exist (the tracker, the notes list);
  the tile palette's "Pick a tile, then drag on the canvas" is the model.
  Every list should say what to do next, not only that it is empty.

---

## 5. Phasing and cost

| Phase | Changes | Files (approx.) | Size |
| --- | --- | --- | --- |
| 1 | **Landed 2026-09-09.** Modes replace tabs; toolbar filtered per mode; view controls out of the tool row; FR ids and repeated footers gone; hint line; keyboard shortcuts | `hud/modes.ts` (new), `hud/useGridShortcuts.ts` (new), `hud/Toolbar.tsx`, `gm/GmPanel.tsx`, `store.ts` (`mode`), `GridPage.tsx`, 43 screen files' titles | 1–2 days, no server change |
| 2 | **Landed 2026-09-10.** Inspector for the selected wall / door / zone / pin / camera / note; Geo list rewritten as list + inspector; pins/cams/notes tabs folded in | `gm/Inspector.tsx` (new), `gm/GeometryTab.tsx` (Layout), `gm/CamerasTab.tsx` (Cams & notes), `gm/GmPanel.tsx`, `store.ts` (`selected`), `stage/pointer.ts` (walls, zones, click-on-nothing), `stage/layers.ts` (the ring) | 2–3 days |
| 3 | **Landed 2026-09-10.** Build checklist; palette redesign with rendered swatches; floors as a canvas control; accent audit; confirm on a second click | `gm/BuildProgress.tsx` (new), `gm/swatches.ts` + `gm/Swatch.tsx` (new), `gm/ConfirmButton.tsx` (new), `gm/TilesTab.tsx`, `GridPage.tsx`, the accent buttons across `gm/*` and `hud/MeasurePanel.tsx` | 2–3 days |

| 4 | **Landed 2026-09-10.** Map not Grid; undo and redo; the eraser peels; a second pass varies; the tileset visible and switchable live (§5a) | `history.ts` (new), `api.ts` (recording hooks, the stroke buffer), `hud/Toolbar.tsx`, `hud/useGridShortcuts.ts`, `gm/TilesTab.tsx`, `packages/rules` (`place.ts`, `restyle.ts`) | 2 days |

Each phase ships on its own; none needs the next. Every existing test that
asserts on a control still finds it — the controls move, they do not change
name — and the e2e specs that drive the Grid (`e2e/grid*.spec.ts`,
`hints.spec.ts`) are the regression net for the move.

**Phase 1 as built.** The mode model lives in one file, `hud/modes.ts`: which
tabs and tools each mode owns, which mode a tool or tab belongs to, the key
table, and the hint line per tool. The store follows it both ways — picking a
tool switches to the mode that owns it, switching mode drops a tool the new
mode does not have and lands on a tab it does — and remembers the last mode
on the device (`safehouse.grid.mode`), so a GM mid-prep comes back to Prep.
Players never see the mode switch; their four tools are the same in every
mode. The one existing spec that moved was the stairs spec, which now clicks
**Prep** before it opens Tokens — a fresh browser lands the GM in Build, where
tokens are not a concern.

**Phase 2 as built.** The store holds one selection — `{ kind, id }` for a
wall, door, zone, pin, camera or note — and the panel docks one inspector
above whichever tab is open, outside the tab's scroll, so it is in view
however far down a palette the GM was. A click on the thing opens it: walls
and zones joined pins, cameras, notes and doors as canvas targets (a door
still opens or shuts under the click, and now shows its lock beside it), a
click on nothing closes the inspector, and Esc closes it and puts the tool
down. The canvas rings whatever is open, in the same magenta a pin already
used. The Pins and Notes tabs are gone; Geo became **Layout** — one line per
wall, door, zone and pin, with a length, a state and a badge, and no
coordinate boxes — and Cams became **Cams & notes**, the same one-line list
for the two things only the GM ever sees. The tabs' own "click the map to…"
buttons went with them: the toolbar is the one place a tool is picked up.
Build is now four tabs and Prep six. The lists take the selection and the
tool as props from the panel, which is what lets their tests render them
without a DOM.

One bug surfaced on the way and is fixed with it: the campaign shell was a
*minimum* of one viewport tall, so a long panel tab (the old Geo tab, the
Tiles palette, now Layout) stretched the row, grew the canvas under a camera
that had already fitted the map, and put every click on the canvas half a
cell off — a wall you aimed at was missed by the width of its own line. The
shell is now exactly one viewport tall and the main column scrolls inside
it, on every campaign page.

**Phase 3 as built.** The checklist is a strip of chips on the canvas, under
the scene name, in Build mode only: *Map · Grid · Walls · Fog*, each ticked
from the scene's own data (an image or paint; a grid that has been touched,
or no image to line it up with; drawn or painted walls; a fog region or a
brushed reveal), each opening the tab where it is done — the Map chip opens
Tiles while there is nothing to show yet — and the finish line after them:
**activate for the table →**, the accent, which becomes *✓ on the table* with
the TV a click away. The floor chips already lived on the canvas; they stay.
The palette draws every swatch as the material — a three-by-three cell scene
with the tile in the middle, every tile of a set laid out on one sheet a
cell apart, put through the same renderer as the map and read back from the
GPU once per set, then cached — with its two colours standing in until the
sheet lands; the
categories say their whole word; a fresh scene leads with **Draw a room**
(the room tool, R) and the lead steps aside once there is a floor; Auto's
explanation is its tooltip; the shapes and the eraser are the toolbar's.
The accent now belongs to three buttons — *activate*, *start a fight*,
*reveal* — and every other button on the panel is plain, including the
door's *open it* and the roller's *apply to next roll*. Deleting a wall, a
pin, a floor or the whole painted floor takes two clicks, the second on a
button that has turned red and asks; the browser's `confirm()` dialog is
gone from the Grid.

Two more things surfaced while walking it through and are fixed with it. A
scene the GM was staging that goes away under them — deleted from another
device, or by hand through the API — used to leave "Scene unavailable" with
no way out but a reload, because the panel that holds *follow the live
scene* is not drawn without a scene; the Grid now falls back to the live
scene by itself. And the canvas being unmounted and mounted again (a scene
gone, then another live) could hand one more update to a stage that had
already been torn down, which crashed on a destroyed graphics; a disposed
stage now ignores updates.

## 5a. Asked for at the table — 2026-09-10

Four things the GM asked for after using the builder, built as phase 4.

- **The page is the Map.** The sidebar, the phone's tab, the console cards
  and every sentence that pointed at "the Grid" now say Map; the panel's
  old Map tab — image, floors, view, calibration — is **Setup**, so the
  page and its tab do not share a name. The route is still `/grid`.
- **Undo and redo.** Every build edit the server accepts — a stroke, a
  room, a wall, a pin, a calibration — records the request that puts it
  back, computed from the scene the browser held a moment before, and
  Ctrl+Z sends it (Ctrl+Shift+Z or Ctrl+Y forward). Undo and Redo sit
  beside the tools in Build and Prep, each naming its step: *Undo: paint
  12 squares*. A room is one step, not two. Steps belong to the scene they
  were made on. Nothing is optimistic: an undo is a request, and the map
  redraws from the server's answer.
- **The eraser peels.** It used to take everything out of a square; now it
  takes the top thing — a prop first, then the wall, then the floor — one
  pass per layer, the way an eraser is expected to behave.
- **The same click twice asks for something else.** Building always cycled
  (wall → window → door). Now Ground advances to the set's next floor, and
  Interior and Decoration to the next thing that fits the square, read on
  from the same ranking the first pick came from — so a second pass over a
  wall-side desk offers the terminal, not the fountain.
- **The tileset, visible and switchable.** A chip beside the scene name in
  Build says which set the map draws from and opens the Tiles tab. Choosing
  another set there redraws the map in it, every floor, every layer — each
  square keeps what it is and takes the new set's version — as one undoable
  step, instead of the next stroke silently replacing the floor.

## 6. What I would measure

Two numbers, taken on the demo scene by a GM who has never seen the page:

- **Time to first room** — from opening an empty scene to a painted room with
  walls. Today it needs the Tiles tab, a tileset, a category, the Room shape,
  a drag. Target: under a minute with no help.
- **Clicks to activate** — from "the map is done" to the scene on the TV.
  Today: Scenes tab, find the scene, *activate*. Target: one accent button in
  the place the GM is already looking.
