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

### 4. The light budget is warm, about six to one

Of the saturated-highlight budget: amber 50–55%, gold/sodium 18–23%, red
10–13%, cyan 9–13%, and everything else in the noise. Enforced catalogue-wide
rather than per set, because the measured distribution allows roughly one cool
room in five — so a single cyan-lit club is right and a cyan-lit catalogue is
not. Only the whole collection can tell those apart.

The Club floor is that one cool set. Nothing else is.

### 5. One committed temperature per set

Within a scene the dominant temperature holds at least 70% of saturated pixels.
No 50/50 warm-cool rooms — each place reads as one colour idea, and the rare
cool room then lands hard as a change of key.

### 6. A light is something you place, not something you fill with

At most **three** tiles per set carry `emissive`, matching the 2–4 practicals
per 8×8-cell room the study found.

There is a sharper reason than the budget. The club's dance floor carried its
glow for one build, and painting a room lit *every cell of it* — a disco
chessboard at roughly forty times the measured emissive budget. Lamp pools and
neon spills are the exception that proves the rule: a GM paints two cells of
those, not two hundred.

Emissive is drawn as an **unlit layer** — it receives neither ambient nor
directional light and renders at 100% of its painted value, with a falloff halo
around a hot core. That is the shipped convention, and in a catalogue where
about 1% of the frame may be bright, a light that does not read means the scene
has no focal point at all.

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

The catalogue is authored at the measured intent **× 1.55** (× 1.12 for the
polished corporate tier). The measured frames carry things a virtual tabletop
does not — a bloom pass, 3D character lighting, a colour-correction lift, a
vignette — every one of which raises the apparent brightness of a dark floor.
Authoring straight to a 15–20% median produced a map that was faithful and
unusable: a GM squinting at a near-black floor on a laptop in a lit room.

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
6. Only add `emissive` if the set has fewer than three lights **and** the tile
   is something a GM places rather than fills a region with.
7. Run `pnpm --filter @safehouse/rules test`. The failure will name the rule.

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
- Wet-ground reflectance variants (8–20% of a tile mirroring the nearest
  emissive) are described by the study and not yet implemented.
- Rain, steam and vent plumes belong to a scene-level overlay, not to tile
  texture. Not implemented.
