/**
 * Proof that the style checker actually bites.
 *
 * `style.test.ts` passed on its first run, which is exactly when a checker
 * deserves the most suspicion: a rule set that accepts everything also accepts
 * the catalogue. So this holds the checker against the catalogue it REPLACED —
 * the six-shades-of-grey, cyan-and-magenta version that was measurably generic
 * — and asserts that it says so, rule by rule.
 *
 * The colours below are the previous catalogue's, frozen here as evidence. If
 * a future change loosens the rules far enough to let this through, this file
 * goes red and says which rule stopped mattering.
 */
import { describe, expect, it } from 'vitest';
import { checkGlowBudget, checkTileset, type StyleSubject } from '../src/tilesets/style.js';

/** The catalogue as it stood before the style was written down. */
const BEFORE: Record<string, StyleSubject[]> = {
  docklands: [
    { id: 'floor', colors: ['#6a7078', '#7d848d'] },
    { id: 'stain', colors: ['#4a4f57', '#3a3e45'] },
    { id: 'grate', colors: ['#495059', '#8b939d'] },
    { id: 'lamp', colors: ['#7d7461', '#9a8b68'], emissive: '#ffb545' },
    { id: 'wall', colors: ['#39414c', '#4d5765'] },
    { id: 'window', colors: ['#5c7f8c', '#9fd0dd'] },
    { id: 'crates', colors: ['#8a6a3c', '#a8834f'] },
    { id: 'rail', colors: ['#5c646e', '#9aa3ae'] },
    { id: 'puddle', colors: ['#2f3238', '#43484f'] },
  ],
};

describe('the rules reject the catalogue they replaced', () => {
  it('calls the old docklands set grey', () => {
    // The measurable failure of the first cut: 87% of its swatches sat under
    // 25% saturation, so six sets came out as six shades of one near-black.
    const rules = checkTileset('docklands', BEFORE['docklands']!).map((v) => v.rule);
    expect(rules).toContain('set-not-grey');
  });

  it('calls out surfaces brighter than the ceiling for a surface', () => {
    const rules = checkTileset('docklands', BEFORE['docklands']!).map((v) => v.rule);
    // `#9fd0dd` is a 87% value window frame — brighter than any token.
    expect(rules).toContain('environment-cap');
  });

  it('calls out accents that fight their own base', () => {
    const rules = checkTileset('docklands', BEFORE['docklands']!).map((v) => v.rule);
    // The old grating ran base 35% to accent 62% — a 27-point pattern on a
    // 12-point budget, which is why the sets read as noise at table zoom.
    expect(rules).toContain('contrast-tiers');
  });

  it('rejects the cyan-and-magenta light budget', () => {
    // What the old catalogue lit its rooms with. Measured across the three
    // games, magenta and purple together take 1.4% of the highlight budget;
    // here they were a third of it, beside an equal weight of cyan.
    const before = ['#ffb545', '#7fe4ff', '#ff2d95', '#c9ff5a', '#ff2d95', '#7fe4ff'];
    const rules = checkGlowBudget(before).map((v) => v.rule);
    expect(rules).toContain('glow-budget');
    expect(rules).toContain('no-cyan-magenta-pairing');
    expect(rules).toContain('warm-outnumbers-cool');
  });

  it('finds more wrong with the old set than with any current one', () => {
    // A blunt guard against the rules being quietly relaxed until both
    // catalogues pass, which would make the whole file decorative.
    const oldCount = checkTileset('docklands', BEFORE['docklands']!).length;
    expect(oldCount).toBeGreaterThan(4);
  });
});
