/**
 * The tile art style, written down as numbers a program can check.
 *
 * ## Why this file exists
 *
 * A tileset grows one tile at a time, usually months apart, usually to fill a
 * gap in the middle of prep. That is exactly the condition under which a look
 * drifts: each new tile is judged against the last one rather than against the
 * whole, and six months later the set is a committee. So the style lives here
 * as constants and predicates, and `style.test.ts` holds the entire catalogue
 * to them. Adding a tile that breaks the look fails a test instead of quietly
 * being fine.
 *
 * ## Where the numbers came from
 *
 * Measured, not invented. The value, saturation, warmth and glow-hue figures
 * below were taken from the 37 official Steam screenshots of the Harebrained
 * Schemes isometric trilogy — Shadowrun Returns (app 234650), Dragonfall
 * (300550) and Hong Kong (346940) — cropped to the environment band to drop
 * the HUD. The lighting model and the face ratios come from the shipped
 * Shadowrun Returns level editor's own documented defaults, which is the
 * closest thing to the artists' working vocabulary that exists in public.
 *
 * Sources are named per constant. Where a rule is our inference rather than a
 * measurement it says so, because a style guide that cannot tell you which of
 * its rules are evidence is not much of a guide.
 *
 * ## The one finding that changed everything
 *
 * Shadowrun is a WARM, NEAR-BLACK game, not a neon one. Median scene value is
 * 15–20%. Only 1.15% of a frame is a saturated highlight, and of that budget
 * amber, gold and red take 85% while magenta and purple take 1.4%. The
 * cyan/magenta pairing that says "cyberpunk" to everyone who has seen a film
 * poster is essentially absent from these games. Our first catalogue was built
 * out of exactly that pairing, which is why it read as generic.
 *
 * NOTHING HERE IS ANYONE ELSE'S ARTWORK (§14). These are statistical
 * properties of a look — value bands, hue budgets, lighting ratios — and the
 * colours below are ours, chosen to satisfy them.
 */

/** A colour in the space these rules are stated in. */
export interface Hsv {
  /** Degrees, 0–360. Meaningless when `s` is near zero. */
  h: number;
  /** 0–1. */
  s: number;
  /** 0–1. */
  v: number;
}

/** `#rgb` or `#rrggbb` → 0–255 channels. Null for anything malformed. */
export function rgbOf(hex: string): { r: number; g: number; b: number } | null {
  const raw = hex.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(raw)) return null;
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw;
  const n = Number.parseInt(full, 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

/** HSV, because every rule below is stated in value and saturation. */
export function hsvOf(hex: string): Hsv | null {
  const rgb = rgbOf(hex);
  if (rgb === null) return null;
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

/**
 * Warmth: red channel minus blue, in 0–255 units.
 *
 * The single most characteristic measurement in the whole study. Across all
 * three games this rises monotonically with brightness — from about 0 in the
 * darkest band to +38 (Seattle), +78 (Hong Kong) and +150 (Berlin) at the top.
 * Shadows are neutral and light is warm, which is the exact inverse of the
 * cool-key, cool-shadow look that Blade Runner left to everything after it.
 */
export function warmth(hex: string): number {
  const rgb = rgbOf(hex);
  return rgb === null ? 0 : rgb.r - rgb.b;
}

// ---------------------------------------------------------------------------
// Measured bands
// ---------------------------------------------------------------------------

/**
 * TABLE EXPOSURE — the one place this catalogue knowingly departs from the
 * measurement, and why.
 *
 * The study measured a median scene value of 15–20% from released frames. Those
 * frames carry things a virtual tabletop does not: a bloom pass, 3D character
 * lighting, a colour-correction lift and a vignette, every one of which raises
 * the apparent brightness of a dark floor. Authoring straight to 15–20%
 * produced a map that was faithful and unusable — a GM squinting at a
 * near-black floor on a laptop in a lit room.
 *
 * So the whole catalogue is the measured intent times this number. A single
 * multiplier moves every surface together, which is what lets the findings
 * survive it: saturation is still flat across the range, warmth still rises
 * with value, the glow budget is untouched, and each set keeps its
 * temperature. Only how far up the range the catalogue sits has changed.
 *
 * Say it out loud rather than quietly picking brighter colours: someone
 * comparing this to a screenshot should know exactly which knob was turned.
 */
export const TABLE_EXPOSURE = 1.55;

/** The corporate tier starts pale, so it needs far less of a lift. */
export const TABLE_EXPOSURE_POLISHED = 1.12;

/**
 * Where an ordinary surface's brightness lives, at table exposure.
 *
 * Measured: whole-scene value median 15–20%, with 24% of pixels below V 8%.
 * `measuredMedian` is that figure; `typical` is where it lands once exposed.
 * `ceiling` is the hard cap for anything that is not a light source — a
 * surface brighter than this is a light, whatever the tile calls itself.
 *
 * Source: 37 official Steam screenshots, apps 234650 / 300550 / 346940.
 */
export const VALUE_BAND = {
  min: 0.06,
  measuredMedian: 0.175,
  typical: 0.175 * TABLE_EXPOSURE,
  ceiling: 0.65,
} as const;

/**
 * Saturation does NOT taper off in the dark.
 *
 * The measured medians barely move across the value range — 32% in the darkest
 * band, 54% in the brightest — so a dark Shadowrun surface is dark because its
 * VALUE is low, not because the colour has been drained out of it. That is the
 * difference between a painted dark and a muddy one, and it is the mistake our
 * first catalogue made: 87% of its swatches sat under 25% saturation.
 *
 * `floorMax` is the looser cap the materials study found for plain floors and
 * walls; `rustMax` is what oxide, painted plastic and cloth may reach.
 */
export const SATURATION_BAND = { min: 0.08, floorMax: 0.45, rustMax: 0.62 } as const;

/**
 * A whole set must not be grey, even if each tile is individually legal.
 *
 * Per-tile minimums cannot catch a set that hugs the bottom of the band, and
 * that is precisely the failure mode we already shipped once.
 */
export const SET_MEDIAN_SATURATION_MIN = 0.2;

/**
 * The environment always loses to the people standing on it.
 *
 * No environment surface may out-saturate or out-shine a token, because the
 * moment the floor is the brightest thing on screen the runners stop reading
 * as the subject. Emissive elements are exempt — they are lights, not
 * surfaces.
 *
 * Source: composition study; corroborated by the trilogy's own separation of
 * hand-painted environments from 3D character rendering.
 */
export const ENVIRONMENT_CAP = { saturation: 0.7, value: 0.75 } as const;

/**
 * Hue families, in degrees. Half-open ranges; `red` wraps.
 *
 * These are the bins the glow budget is expressed in.
 */
export const HUE_FAMILIES = {
  red: [345, 15],
  amber: [15, 45],
  gold: [45, 70],
  green: [70, 170],
  cyan: [170, 205],
  blue: [205, 250],
  purple: [250, 290],
  magenta: [290, 345],
} as const;

export type HueFamily = keyof typeof HUE_FAMILIES;

export function hueFamily(hex: string): HueFamily | null {
  const c = hsvOf(hex);
  // Below this there is no meaningful hue to bin — it is a grey with a lean.
  if (c === null || c.s < 0.12) return null;
  for (const [name, [lo, hi]] of Object.entries(HUE_FAMILIES)) {
    if (lo > hi) {
      if (c.h >= lo || c.h < hi) return name as HueFamily;
    } else if (c.h >= lo && c.h < hi) {
      return name as HueFamily;
    }
  }
  return null;
}

/**
 * How the catalogue's light sources divide by hue.
 *
 * Measured across every saturated highlight in all 37 frames: amber and gold
 * together take roughly seven tenths, magenta and purple together under two
 * hundredths. Enforced over the WHOLE catalogue rather than per set, since one
 * cool room in five is exactly the distribution the study found.
 *
 * ## Why the magenta ceiling is 18% and not 1.4%
 *
 * Because the measurement is a share of PIXEL AREA and this is a count of
 * TILES, and treating one as the other is a category error. The 1.4% figure
 * comes from 37 frames of mostly sewers, warehouses, tenements and offices. A
 * neon sign is a single tile covering a couple of cells — almost no area — so
 * a club and a neon street can each carry a pink tube and leave the rendered
 * share of magenta pixels exactly where the study puts it.
 *
 * The first cut of this file set the ceiling at 6% of lights, which on a
 * thirteen-light catalogue rounds to zero: a rule that banned the thing it was
 * meant to ration. What actually does the rationing is elsewhere and has not
 * moved — `no-magenta-substrate` keeps the walls out of it, `SET_EMISSIVE_MAX`
 * keeps a room to four practicals, and the light tiles that carry tube neon
 * are small-footprint signage rather than floors.
 *
 * The ceilings still matter more than the floors: this is a budget for
 * restraint, not a ban.
 */
export const GLOW_BUDGET: Readonly<Record<HueFamily, { min: number; max: number }>> = {
  amber: { min: 0.22, max: 0.62 },
  gold: { min: 0.1, max: 0.32 },
  red: { min: 0.06, max: 0.22 },
  cyan: { min: 0.04, max: 0.26 },
  green: { min: 0, max: 0.08 },
  blue: { min: 0, max: 0.06 },
  magenta: { min: 0, max: 0.18 },
  purple: { min: 0, max: 0.03 },
};

/**
 * Warm sources outnumber cool ones about six to one.
 *
 * Stated separately from the per-family budget because it is the load-bearing
 * half: a catalogue can satisfy every individual ceiling and still feel cold.
 */
export const WARM_GLOW_SHARE_MIN = 0.5;

/**
 * The two hues that say "generic cyberpunk" when used together.
 *
 * The sourced finding is about a SCENE: never place cyan and magenta as
 * co-equal accents in one room. A club with a pink sign over the door and a
 * cyan rig above the stage is a club, and it is what a table wants from the
 * one location in the book that is about light. What the finding rules out is
 * that pairing becoming the catalogue's whole idea, which is what our first
 * cut did in all six sets at once.
 *
 * So the guard is stated where it belongs — across the catalogue, on the two
 * TOGETHER — rather than as a per-scene ban that would empty out the two
 * locations neon actually belongs in.
 */
export const CYAN_MAGENTA_LIMIT = { pairShareMax: 0.42 } as const;

// ---------------------------------------------------------------------------
// The lighting model
// ---------------------------------------------------------------------------

/**
 * The key light, taken from the shipped editor's own default.
 *
 * Direction (-0.50, -1.00, -0.75), which normalises to 48.0° above the ground
 * plane. The horizontal split is 0.50 : 0.75 — deliberately NOT the symmetric
 * 45° that a naive isometric renderer reaches for, which is why the two
 * visible side faces of a box differ from each other instead of matching.
 *
 * Source: Shadowrun Returns level editor lighting documentation.
 */
export const KEY_LIGHT = {
  direction: [-0.5, -1.0, -0.75] as const,
  elevationDeg: 48.0,
  /** Lambert dot products of the three visible faces, normalised to the top. */
  lambert: { top: 1.0, left: 0.75, right: 0.5 },
} as const;

/**
 * Face multipliers on a tile's own colour.
 *
 * The editor ships ambient and directional both at neutral #808080, so a face
 * ends up at `0.502 + 0.502 · lambert` of its albedo. That is a much FLATTER
 * range than a procedural renderer would choose on its own — and it works in
 * the games because the form is painted in rather than shaded in.
 *
 * We keep the ratio and make up the missing legibility with the two things the
 * study says the games use for exactly that job: a vertical gradient down each
 * standing face (`FACE_GRADIENT`) and a contact shadow where it meets the
 * floor. Flat-shading a prism harder than this would read as a different game.
 */
export const FACE_MULTIPLIER = { top: 0.875, left: 0.782, right: 0.688 } as const;

/**
 * How much darker the foot of a standing face is than its crown.
 *
 * Sourced as 20–35% for figures and full-height props, which is what makes
 * them sit INTO the floor and rise INTO the light rather than float. This is
 * the legibility the flat face multipliers give up.
 */
export const FACE_GRADIENT = 0.26;

/**
 * The global light carries no hue at all.
 *
 * Both ambient and directional ship neutral, so every colour in a Shadowrun
 * scene comes from a surface's own paint or from a placed light — never from a
 * wash over the whole frame. This is a rule about what NOT to do, and the
 * reason the settings read as different places rather than as one place under
 * different gels.
 */
export const GLOBAL_LIGHT_IS_NEUTRAL = true;

/**
 * Contrast, in three tiers that must not overlap.
 *
 * Silhouette separation beats material pattern beats grain. When a material's
 * pattern competes with the shape it is drawn on, an isometric scene turns to
 * noise at table zoom — which is the whole reason a tile's accent has to stay
 * near its base.
 *
 * Stated in VALUE POINTS (percentage points of HSV V, 0–100).
 */
export const CONTRAST_TIERS = { silhouetteMin: 20, patternMax: 12, grainMax: 6 } as const;

/**
 * Affluence tier. Most of a run happens somewhere run-down.
 *
 * The default for a random scene is tier 0–2. Tier 3 — the polished corporate
 * interior — is the exception you opt into, and it INVERTS the floor rule:
 * pale, nearly desaturated, and brighter than anything else in the catalogue.
 * Getting this backwards is the most common way to make Shadowrun look like
 * generic sci-fi, because the gleaming tower is the memorable image and the
 * wrong default.
 */
export const AFFLUENCE = {
  /** Run-down: the default. */
  worn: { saturationMin: 0.14, valueMax: 0.42 },
  /** Corporate: opt-in, and the only tier allowed to be pale and bright. */
  polished: { saturationMax: 0.16, valueMin: 0.3, valueMax: 0.7 },
} as const;

/**
 * At most this many tiles in a set may be lights.
 *
 * The study budgets 2-4 practicals per 8x8-cell room, and a set that offers
 * ten glowing tiles will get a room with ten in it. There is a second, sharper
 * reason: a light belongs on something a GM PLACES, never on a set's dominant
 * floor. Four is the top of the measured range and where the two neon
 * locations sit; a warehouse wants one. The club's dance floor carried its glow for one build, and painting a
 * room lit every cell — a disco chessboard at roughly forty times the measured
 * emissive budget. Lamp pools and neon spills are the exception that proves
 * the rule, because a GM paints two cells of those rather than two hundred.
 */
export const SET_EMISSIVE_MAX = 4;

/** At most this many distinct hue families in one set, so it reads as a place. */
export const SET_HUE_FAMILY_MAX = 5;

/** Dominant temperature share within one set (warm vs cool, ignoring neutrals). */
export const SET_TEMPERATURE_DOMINANCE = 0.7;

// ---------------------------------------------------------------------------
// Checking
// ---------------------------------------------------------------------------

export interface StyleViolation {
  /** Tile or set the complaint is about. */
  subject: string;
  rule: string;
  detail: string;
}

/** Everything the checker needs, without importing the tile type. */
export interface StyleSubject {
  id: string;
  colors: readonly [string, string];
  emissive?: string | undefined;
  /** Polished tier opts out of the worn defaults. */
  polished?: boolean;
}

/**
 * Check one tile's colours.
 *
 * Emissive is checked separately and loosely on purpose: it is a LIGHT, and
 * the whole point of the model is that lights are not bound by the rules that
 * govern surfaces. What binds them is the catalogue-wide hue budget.
 */
export function checkTile(tile: StyleSubject): StyleViolation[] {
  const out: StyleViolation[] = [];
  const say = (rule: string, detail: string) => out.push({ subject: tile.id, rule, detail });

  const [baseHex, accentHex] = tile.colors;
  const base = hsvOf(baseHex);
  const accent = hsvOf(accentHex);
  if (base === null) say('parse', `base colour ${baseHex} is not a hex colour`);
  if (accent === null) say('parse', `accent colour ${accentHex} is not a hex colour`);
  if (base === null || accent === null) return out;

  for (const [name, c, hex] of [
    ['base', base, baseHex],
    ['accent', accent, accentHex],
  ] as const) {
    if (c.v > ENVIRONMENT_CAP.value) {
      say('environment-cap', `${name} value ${pct(c.v)} exceeds ${pct(ENVIRONMENT_CAP.value)}`);
    }
    if (c.s > ENVIRONMENT_CAP.saturation) {
      say(
        'environment-cap',
        `${name} saturation ${pct(c.s)} exceeds ${pct(ENVIRONMENT_CAP.saturation)}`,
      );
    }
    if (c.v < VALUE_BAND.min) {
      say('value-band', `${name} value ${pct(c.v)} is below ${pct(VALUE_BAND.min)} — it is black`);
    }
    if (tile.polished === true) {
      if (c.s > AFFLUENCE.polished.saturationMax) {
        say(
          'affluence-polished',
          `${name} saturation ${pct(c.s)} exceeds ${pct(AFFLUENCE.polished.saturationMax)} for a polished tile`,
        );
      }
      if (c.v > AFFLUENCE.polished.valueMax) {
        say(
          'affluence-polished',
          `${name} value ${pct(c.v)} exceeds ${pct(AFFLUENCE.polished.valueMax)}`,
        );
      }
    } else {
      if (c.v > VALUE_BAND.ceiling) {
        say(
          'value-band',
          `${name} value ${pct(c.v)} exceeds the ${pct(VALUE_BAND.ceiling)} ceiling for a surface`,
        );
      }
      if (c.s > SATURATION_BAND.rustMax) {
        say(
          'saturation-band',
          `${name} saturation ${pct(c.s)} exceeds ${pct(SATURATION_BAND.rustMax)}`,
        );
      }
      // Magenta and purple are not substrate colours in this world. A surface
      // may be lit by them; it may not be made of them.
      const fam = hueFamily(hex);
      if (fam === 'magenta' || fam === 'purple') {
        say('no-magenta-substrate', `${name} hue ${Math.round(c.h)}° is ${fam}`);
      }
    }
  }

  // Tier 2: a material's pattern must not compete with its silhouette.
  const spread = Math.abs(base.v - accent.v) * 100;
  if (spread > CONTRAST_TIERS.patternMax) {
    say(
      'contrast-tiers',
      `accent is ${spread.toFixed(1)} value points from base, over the ${CONTRAST_TIERS.patternMax}-point pattern budget`,
    );
  }

  if (tile.emissive !== undefined) {
    const glow = hsvOf(tile.emissive);
    if (glow === null) {
      say('parse', `emissive ${tile.emissive} is not a hex colour`);
    } else if (glow.v < 0.7) {
      // A light dimmer than this is a surface pretending, and it will not read
      // at table distance — which is the entire job of the emissive channel.
      say('emissive-is-a-light', `emissive value ${pct(glow.v)} is below 70%`);
    }
  }

  return out;
}

/** Median of a non-empty list. */
function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2 : (s[mid] ?? 0);
}

/**
 * Check a whole set: the rules a single tile cannot break on its own.
 *
 * Every failure here is one a per-tile check would wave through — a set that
 * hugs the bottom of the saturation band, a set that reads as five places, a
 * set whose lit faces are no warmer than its shadows. Those are exactly the
 * ways a look rots one legal tile at a time.
 */
export function checkTileset(setId: string, tiles: readonly StyleSubject[]): StyleViolation[] {
  const out: StyleViolation[] = [];
  const say = (rule: string, detail: string) => out.push({ subject: setId, rule, detail });
  for (const t of tiles) out.push(...checkTile(t));

  const surfaces = tiles.flatMap((t) => [t.colors[0], t.colors[1]]);
  const parsed = surfaces.map(hsvOf).filter((c): c is Hsv => c !== null);
  if (parsed.length === 0) return out;

  const polished = tiles.every((t) => t.polished === true);
  if (!polished) {
    const medianS = median(parsed.map((c) => c.s));
    if (medianS < SET_MEDIAN_SATURATION_MIN) {
      say(
        'set-not-grey',
        `median saturation ${pct(medianS)} is below ${pct(SET_MEDIAN_SATURATION_MIN)} — dark is made with value, not by draining the colour out`,
      );
    }
  }

  // Warmth rises with value. The signature measurement, checked as a two-band
  // comparison because a thirteen-tile set has no room for eight bands.
  const byValue = [...surfaces]
    .map((hex) => ({ hex, v: hsvOf(hex)?.v ?? 0, w: warmth(hex) }))
    .sort((a, b) => a.v - b.v);
  const half = Math.floor(byValue.length / 2);
  if (half > 0) {
    const dark = byValue.slice(0, half);
    const lit = byValue.slice(byValue.length - half);
    const meanW = (xs: typeof dark) => xs.reduce((n, x) => n + x.w, 0) / xs.length;
    if (meanW(lit) <= meanW(dark)) {
      say(
        'warmth-rises-with-value',
        `lit surfaces average ${meanW(lit).toFixed(1)} R-B against ${meanW(dark).toFixed(1)} in the darks — light must be warmer than shadow`,
      );
    }
  }

  const lights = tiles.filter((t) => t.emissive !== undefined).length;
  if (lights > SET_EMISSIVE_MAX) {
    say(
      'light-budget',
      `${lights} tiles in this set are lights, over the ${SET_EMISSIVE_MAX} a room can carry`,
    );
  }

  const families = new Set(surfaces.map(hueFamily).filter((f): f is HueFamily => f !== null));
  if (families.size > SET_HUE_FAMILY_MAX) {
    say(
      'set-reads-as-one-place',
      `${families.size} hue families (${[...families].join(', ')}) — at most ${SET_HUE_FAMILY_MAX}`,
    );
  }

  // One committed temperature per set. A 50/50 split reads as indecision.
  const warmFams: readonly HueFamily[] = ['red', 'amber', 'gold'];
  const coolFams: readonly HueFamily[] = ['cyan', 'blue', 'purple'];
  const fams = surfaces.map(hueFamily);
  const warm = fams.filter((f) => f !== null && warmFams.includes(f)).length;
  const cool = fams.filter((f) => f !== null && coolFams.includes(f)).length;
  const total = warm + cool;
  if (total > 0) {
    const dominant = Math.max(warm, cool) / total;
    if (dominant < SET_TEMPERATURE_DOMINANCE) {
      say(
        'one-temperature-per-set',
        `${warm} warm against ${cool} cool surfaces — the dominant temperature must hold ${pct(SET_TEMPERATURE_DOMINANCE)}`,
      );
    }
  }

  return out;
}

/**
 * Check the light sources across the WHOLE catalogue against the hue budget.
 *
 * Deliberately catalogue-wide: the measured distribution allows about one cool
 * room in five, so a single cyan-lit club is correct and a cyan-lit catalogue
 * is not. Only the whole collection can tell those apart.
 */
export function checkGlowBudget(emissives: readonly string[]): StyleViolation[] {
  const out: StyleViolation[] = [];
  const say = (rule: string, detail: string) =>
    out.push({ subject: 'catalogue', rule, detail });
  if (emissives.length === 0) return out;

  const counts = new Map<HueFamily, number>();
  for (const hex of emissives) {
    const fam = hueFamily(hex);
    if (fam === null) continue;
    counts.set(fam, (counts.get(fam) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  if (total === 0) return out;

  for (const [fam, budget] of Object.entries(GLOW_BUDGET) as Array<
    [HueFamily, { min: number; max: number }]
  >) {
    const share = (counts.get(fam) ?? 0) / total;
    if (share > budget.max) {
      say('glow-budget', `${fam} is ${pct(share)} of lights, over the ${pct(budget.max)} ceiling`);
    }
    if (share < budget.min) {
      say('glow-budget', `${fam} is ${pct(share)} of lights, under the ${pct(budget.min)} floor`);
    }
  }

  const warmShare =
    (['red', 'amber', 'gold'] as const).reduce((n, f) => n + (counts.get(f) ?? 0), 0) / total;
  if (warmShare < WARM_GLOW_SHARE_MIN) {
    say(
      'warm-outnumbers-cool',
      `warm lights are ${pct(warmShare)} of the catalogue, under ${pct(WARM_GLOW_SHARE_MIN)}`,
    );
  }

  const pair =
    ((counts.get('cyan') ?? 0) + (counts.get('magenta') ?? 0) + (counts.get('purple') ?? 0)) /
    total;
  if (pair > CYAN_MAGENTA_LIMIT.pairShareMax) {
    say(
      'no-cyan-magenta-pairing',
      `cyan and magenta together are ${pct(pair)} of the catalogue's lights — past ${pct(CYAN_MAGENTA_LIMIT.pairShareMax)} that pairing IS the palette, which is the film poster and not this`,
    );
  }

  return out;
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}
