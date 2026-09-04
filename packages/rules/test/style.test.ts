/**
 * The art style, enforced.
 *
 * A tileset grows one tile at a time, months apart, usually mid-prep. That is
 * exactly the condition under which a look drifts: each new tile gets judged
 * against the last one instead of against the whole set, and a year later the
 * catalogue is a committee. These tests are the thing that stops it — adding a
 * tile that breaks the style fails here rather than quietly being fine.
 *
 * The numbers all live in `style.ts` with their sources. This file only holds
 * the catalogue to them, and says clearly what a failure MEANS, because a red
 * test that reads "expected 0.19 to be at least 0.2" teaches nobody anything.
 */
import { describe, expect, it } from 'vitest';
import { TILESETS } from '../src/tilesets/catalogue.js';
import {
  checkGlowBudget,
  checkTile,
  checkTileset,
  ENVIRONMENT_CAP,
  FACE_MULTIPLIER,
  GLOW_BUDGET,
  hsvOf,
  hueFamily,
  KEY_LIGHT,
  SET_EMISSIVE_MAX,
  SET_MEDIAN_SATURATION_MIN,
  TABLE_EXPOSURE,
  VALUE_BAND,
  warmth,
  type StyleSubject,
} from '../src/tilesets/style.js';

/** The corporate set is the one polished tier — see AFFLUENCE in style.ts. */
const POLISHED = new Set(['corp']);

function subjectsOf(setId: string): StyleSubject[] {
  const set = TILESETS.find((t) => t.id === setId);
  if (!set) throw new Error(`no tileset ${setId}`);
  return set.tiles.map((t) => ({
    id: `${setId}/${t.id}`,
    colors: t.colors,
    emissive: t.emissive,
    polished: POLISHED.has(setId),
  }));
}

/** Every violation, formatted so a failure explains itself. */
function report(vs: ReturnType<typeof checkTile>): string {
  return vs.map((v) => `  ${v.subject} — ${v.rule}: ${v.detail}`).join('\n');
}

describe('the catalogue obeys its own art style', () => {
  for (const set of TILESETS) {
    it(`${set.id} passes every rule`, () => {
      const violations = checkTileset(set.id, subjectsOf(set.id));
      expect(violations.length === 0 ? '' : `\n${report(violations)}`).toBe('');
    });
  }

  it('spends its light budget the way the games do', () => {
    // Catalogue-wide on purpose: the measured distribution allows about one
    // cool room in five, so a single cyan-lit club is right and a cyan-lit
    // catalogue is not. Only the whole collection can tell those apart.
    const lights = TILESETS.flatMap((s) =>
      s.tiles.map((t) => t.emissive).filter((e): e is string => e !== undefined),
    );
    expect(lights.length).toBeGreaterThan(8);
    const violations = checkGlowBudget(lights);
    expect(violations.length === 0 ? '' : `\n${report(violations)}`).toBe('');
  });
});

describe('the findings that made this catalogue', () => {
  const surfaces = TILESETS.flatMap((s) => s.tiles.flatMap((t) => [t.colors[0], t.colors[1]]));

  it('is a near-black catalogue, not a neon one', () => {
    // Measured median scene value in the trilogy is 15-20%. Surfaces are what
    // fills a frame, so their median is the closest thing we can check.
    const vs = surfaces.map((h) => hsvOf(h)?.v ?? 0).sort((a, b) => a - b);
    const median = vs[Math.floor(vs.length / 2)] ?? 0;
    // Stated against the measured median times the exposure, so the threshold
    // moves with the decision rather than being a second opinion about it.
    expect(median).toBeLessThan(VALUE_BAND.measuredMedian * TABLE_EXPOSURE * 2);
    expect(median).toBeGreaterThan(VALUE_BAND.measuredMedian);
    // And nothing that is not a light gets to be bright.
    expect(Math.max(...vs)).toBeLessThanOrEqual(ENVIRONMENT_CAP.value);
  });

  it('makes dark with value, not by draining the colour out', () => {
    // The mistake the first catalogue made: 87% of its swatches sat under 25%
    // saturation, so six sets came out as six shades of the same grey. In the
    // measured frames saturation barely moves across the value range.
    const mid = 0.25 * TABLE_EXPOSURE;
    const dark = surfaces.filter((h) => (hsvOf(h)?.v ?? 0) < mid);
    const lit = surfaces.filter((h) => (hsvOf(h)?.v ?? 0) >= mid);
    const meanS = (xs: string[]) => xs.reduce((n, h) => n + (hsvOf(h)?.s ?? 0), 0) / xs.length;
    expect(dark.length).toBeGreaterThan(10);
    // Dark surfaces stay chromatic — within a hair of the lit ones, never a
    // fraction of them.
    expect(meanS(dark)).toBeGreaterThan(meanS(lit) * 0.6);
    expect(meanS(dark)).toBeGreaterThan(SET_MEDIAN_SATURATION_MIN);
  });

  it('warms as it brightens — shadows neutral, light warm', () => {
    // The signature measurement of the whole study, and the exact inverse of
    // the cool-key look that Blade Runner left to everything after it.
    // Band edges ride the exposure too — 0.20 and 0.30 of the measured range.
    const lo = 0.2 * TABLE_EXPOSURE;
    const hi = 0.3 * TABLE_EXPOSURE;
    const bands = [
      surfaces.filter((h) => (hsvOf(h)?.v ?? 0) < lo),
      surfaces.filter((h) => {
        const v = hsvOf(h)?.v ?? 0;
        return v >= lo && v < hi;
      }),
      surfaces.filter((h) => (hsvOf(h)?.v ?? 0) >= hi),
    ];
    const means = bands.map((b) => b.reduce((n, h) => n + warmth(h), 0) / Math.max(1, b.length));
    for (const b of bands) expect(b.length).toBeGreaterThan(5);
    expect(means[1]).toBeGreaterThan(means[0]!);
    expect(means[2]).toBeGreaterThan(means[1]!);
  });

  it('keeps magenta out of the walls entirely', () => {
    // Magenta and purple appear in NONE of the top-ten bright-saturated hue
    // bins of any of the three games. A surface may be lit by them; it may not
    // be made of them.
    const bad = surfaces.filter((h) => {
      const f = hueFamily(h);
      return f === 'magenta' || f === 'purple';
    });
    expect(bad).toEqual([]);
  });

  it('keeps warm light in the majority', () => {
    const lights = TILESETS.flatMap((s) =>
      s.tiles.map((t) => t.emissive).filter((e): e is string => e !== undefined),
    );
    const fams = lights.map(hueFamily);
    const warm = fams.filter((f) => f === 'amber' || f === 'gold' || f === 'red').length;
    const cool = fams.filter((f) => f === 'cyan' || f === 'blue' || f === 'purple').length;
    const pink = fams.filter((f) => f === 'magenta').length;
    expect(warm).toBeGreaterThan(cool + pink);
    // Amber still leads, as measured.
    const amber = fams.filter((f) => f === 'amber').length;
    expect(amber / lights.length).toBeGreaterThanOrEqual(GLOW_BUDGET.amber.min);
  });

  it('puts tube neon in the club and the street, and nowhere else', () => {
    // A pink sign is a location's signature, not a catalogue-wide wash. The
    // measured 1.4% is a share of pixel AREA, and a sign is one small tile —
    // so these two can carry it while a warehouse still cannot.
    const withPink = TILESETS.filter((s) =>
      s.tiles.some((t) => hueFamily(t.emissive ?? '') === 'magenta'),
    ).map((s) => s.id);
    expect(withPink.sort()).toEqual(['club', 'sprawl']);
    // And both of those carry cyan too, because that is what a neon strip is.
    for (const id of withPink) {
      const set = TILESETS.find((s) => s.id === id)!;
      expect(set.tiles.some((t) => hueFamily(t.emissive ?? '') === 'cyan')).toBe(true);
    }
  });

  it('never lets a wall be made of the colour lighting it', () => {
    // The rule that keeps neon from turning into synthwave: the tube is pink,
    // the housing it is bolted to is not.
    for (const set of TILESETS) {
      for (const t of set.tiles) {
        if (hueFamily(t.emissive ?? '') !== 'magenta') continue;
        expect({ id: t.id, base: hueFamily(t.colors[0]) }).not.toEqual({
          id: t.id,
          base: 'magenta',
        });
      }
    }
  });

  it('keeps a room to the two or three lights it can carry', () => {
    // And keeps them off the dominant floor. The one set that broke this drew
    // its glow from the dance floor, so painting a room lit every cell of it.
    for (const set of TILESETS) {
      const lights = set.tiles.filter((t) => t.emissive !== undefined);
      expect({ set: set.id, lights: lights.length }).toEqual({
        set: set.id,
        lights: Math.min(lights.length, SET_EMISSIVE_MAX),
      });
    }
  });

  it('makes exactly one set cool, and does not pair it with magenta', () => {
    // Roughly one room in five runs cool. That set exists; what does not exist
    // is the cyan-beside-magenta pairing that says "cyberpunk" on a poster.
    const coolSets = TILESETS.filter((s) => {
      const fams = s.tiles.flatMap((t) => [hueFamily(t.colors[0]), hueFamily(t.colors[1])]);
      const cool = fams.filter((f) => f === 'cyan' || f === 'blue').length;
      const warm = fams.filter((f) => f === 'amber' || f === 'gold' || f === 'red').length;
      return cool > warm;
    });
    expect(coolSets.map((s) => s.id)).toEqual(['club']);
  });
});

describe('the lighting model', () => {
  it('keys from above and behind, off the diagonal', () => {
    // The editor's own default. All three components negative, and the two
    // horizontal terms deliberately unequal — a symmetric 45 degree key would
    // give the two visible side faces the same value and flatten every corner.
    const [x, y, z] = KEY_LIGHT.direction;
    expect(x).toBeLessThan(0);
    expect(y).toBeLessThan(0);
    expect(z).toBeLessThan(0);
    expect(Math.abs(x)).not.toBeCloseTo(Math.abs(z), 3);
    expect(KEY_LIGHT.elevationDeg).toBeCloseTo(
      (Math.atan(Math.abs(y) / Math.hypot(x, z)) * 180) / Math.PI,
      1,
    );
  });

  it('never lifts a face above its own colour, and never crushes one to black', () => {
    // Ambient and directional both ship neutral and each carry about half, so
    // every face lands between 0.688 and 0.875 of the albedo. A renderer that
    // multiplies a top face ABOVE 1.0 is inventing light the model does not
    // have, and it is what made our boxes read as plastic.
    const fs = Object.values(FACE_MULTIPLIER);
    expect(Math.max(...fs)).toBeLessThanOrEqual(1);
    expect(Math.min(...fs)).toBeGreaterThan(0.6);
    expect(FACE_MULTIPLIER.top).toBeGreaterThan(FACE_MULTIPLIER.left);
    expect(FACE_MULTIPLIER.left).toBeGreaterThan(FACE_MULTIPLIER.right);
  });

  it('derives those multipliers from the key light rather than from taste', () => {
    // 0.502 + 0.502 * lambert, with lambert normalised to the top face.
    for (const face of ['top', 'left', 'right'] as const) {
      const lambert = KEY_LIGHT.lambert[face] * 0.7428;
      expect(FACE_MULTIPLIER[face]).toBeCloseTo(0.502 + 0.502 * lambert, 2);
    }
  });
});

describe('checkTile', () => {
  // The checker has to catch the things a human eye waves through, so it gets
  // its own tests rather than being trusted because the catalogue passes.

  it('rejects a surface brighter than a light', () => {
    const vs = checkTile({ id: 't', colors: ['#f2f0ee', '#f4f2f0'] });
    expect(vs.map((v) => v.rule)).toContain('environment-cap');
  });

  it('rejects the grey the first catalogue was made of', () => {
    const vs = checkTileset('grey', [
      { id: 'a', colors: ['#4a4f57', '#3a3e45'] },
      { id: 'b', colors: ['#495059', '#8b939d'] },
      { id: 'c', colors: ['#39414c', '#4d5765'] },
    ]);
    expect(vs.map((v) => v.rule)).toContain('set-not-grey');
  });

  it('rejects a magenta wall but allows a magenta light', () => {
    expect(checkTile({ id: 'w', colors: ['#5a2a4e', '#63305a'] }).map((v) => v.rule)).toContain(
      'no-magenta-substrate',
    );
    // As a LIGHT the same hue is only bound by the catalogue-wide budget.
    expect(
      checkTile({ id: 'l', colors: ['#3b342b', '#453d33'], emissive: '#ff2d95' }),
    ).toEqual([]);
  });

  it('rejects an accent that fights its own base', () => {
    // Tier 2: a material's pattern must not compete with its silhouette.
    const vs = checkTile({ id: 't', colors: ['#241f1a', '#8a7a66'] });
    expect(vs.map((v) => v.rule)).toContain('contrast-tiers');
  });

  it('rejects an emissive too dim to read at table distance', () => {
    const vs = checkTile({ id: 't', colors: ['#3b342b', '#453d33'], emissive: '#5a4020' });
    expect(vs.map((v) => v.rule)).toContain('emissive-is-a-light');
  });

  it('rejects a set whose lit surfaces are colder than its shadows', () => {
    const vs = checkTileset('inverted', [
      { id: 'a', colors: ['#4a3a24', '#54422a'] },
      { id: 'b', colors: ['#243a4a', '#2a4254'] },
      { id: 'c', colors: ['#2a4a6a', '#3054784'.slice(0, 7)] },
    ]);
    expect(vs.some((v) => v.rule === 'warmth-rises-with-value')).toBe(true);
  });

  it('holds the polished tier to the opposite rule', () => {
    // Corporate inverts the floor rule — pale and desaturated — so a saturated
    // corporate surface is as wrong as a washed-out Barrens one.
    const vs = checkTile({ id: 'c', colors: ['#4a3a24', '#54422a'], polished: true });
    expect(vs.map((v) => v.rule)).toContain('affluence-polished');
  });

  it('accepts a value below the band ceiling but complains about pure black', () => {
    expect(checkTile({ id: 'ok', colors: ['#3b342b', '#453d33'] })).toEqual([]);
    expect(checkTile({ id: 'black', colors: ['#050505', '#0a0a0a'] }).map((v) => v.rule)).toContain(
      'value-band',
    );
    expect(VALUE_BAND.min).toBeGreaterThan(0);
  });
});
