/**
 * The builder's local analysis (docs/CHARGEN.md §8.6 "runs budgets /
 * validate / compile from @safehouse/rules locally on every change for an
 * instant rail").
 *
 * Pins three claims: the analysis is the engine's own answer (so the rail
 * never drifts from the server's check), it is memoised on identity (so an
 * unchanged draft re-renders nothing below it), and a record half-way through
 * being made never takes the page down. Invented runners only.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { budgets, ratings, setAttributePoints, setPriority, stepStatus, validate } from '@safehouse/rules';
import { analyseBuild, createAnalyser } from './analysis.js';
import { SETTINGS, blankBuild, conceptBuild } from './testing.js';

// Compile is swapped for one that can be told to throw, so the failure path
// is exercised on purpose rather than hoped for from a malformed record.
const compileFails = vi.hoisted(() => ({ on: false }));
vi.mock('@safehouse/rules', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@safehouse/rules')>();
  return {
    ...actual,
    compileBuild: (...args: Parameters<typeof actual.compileBuild>) => {
      if (compileFails.on) throw new Error('metatype table has no row for this id');
      return actual.compileBuild(...args);
    },
  };
});
afterEach(() => {
  compileFails.on = false;
});

describe('analyseBuild', () => {
  it('answers what the engine answers', () => {
    const build = conceptBuild('decker');
    const a = analyseBuild(build, SETTINGS);
    expect(a.budgets).toEqual(budgets(build, SETTINGS));
    expect(a.issues).toEqual(validate(build, SETTINGS));
    expect(a.steps.map((s) => s.complete)).toEqual(stepStatus(build, SETTINGS).map((s) => s.complete));
  });

  it('compiles and derives, so the rail shows the numbers play will use', () => {
    const a = analyseBuild(conceptBuild('muscle'), SETTINGS);
    expect(a.preview.error).toBeNull();
    expect(a.preview.compiled?.sheet.identity.alias).toBe('Kestrel Vane');
    expect(a.preview.derived?.initiative.physical.base.value).toBeGreaterThan(0);
  });

  it('carries a compile failure as a preview error instead of throwing', () => {
    compileFails.on = true;
    const a = analyseBuild(conceptBuild('muscle'), SETTINGS);
    expect(a.preview).toEqual({ compiled: null, derived: null, error: 'metatype table has no row for this id' });
    // Budgets and issues still render.
    expect(a.budgets.pools.skills.available).toBeGreaterThan(0);
    expect(a.steps).toHaveLength(9);
  });
});

describe('the answers a refusing control needs', () => {
  it("carries the engine's ratings, so a stepper shows base and natural max without re-deriving them", () => {
    const build = conceptBuild('muscle');
    const a = analyseBuild(build, SETTINGS);
    expect(a.ratings).toEqual(ratings(build, SETTINGS));
    expect(a.ratings.attributes.agi.max).toBeGreaterThanOrEqual(a.ratings.attributes.agi.base);
  });

  it("probe names the error a change would introduce, in the validator's words", () => {
    const build = blankBuild();
    const a = analyseBuild(build, SETTINGS);
    const at = (id: 'agi' | 'bod') => a.ratings.attributes[id].max - a.ratings.attributes[id].base;
    const oneAtMax = setAttributePoints(build, 'agi', at('agi'));
    const b = analyseBuild(oneAtMax, SETTINGS);
    const second = b.probe((x) => setAttributePoints(x, 'bod', at('bod')));
    const refusal = second.introduced.find((i) => i.code === 'attribute-max-more-than-one');
    // The engine's own sentence and page (it may point at Exceptional Attribute as the way out).
    expect(refusal?.ref.book).toBe('SR5');
    expect(refusal?.message.length).toBeGreaterThan(10);
    // What was already wrong is blocking, but not introduced.
    expect(second.blocking.length).toBeGreaterThan(second.introduced.length);
    expect(second.introduced.some((i) => i.code === 'priority-unset')).toBe(false);

    // A change that breaks nothing introduces nothing; a no-op is free.
    expect(b.probe((x) => x).introduced).toEqual([]);
    expect(b.probe((x) => x).warned).toEqual([]);
  });

  it('probe says the warnings a change would bring in apart from its errors', () => {
    // A mundane card on Magic E: moving Magic to C leaves a row the runner gets nothing from.
    const face = conceptBuild('face');
    const a = analyseBuild(face, SETTINGS);
    const moved = a.probe((x) => setPriority(x, 'magic', 'C'));
    const unused = moved.warned.find((i) => i.code === 'magic-priority-unused');
    expect(unused?.severity).toBe('warning');
    expect(unused?.message).toContain('Magic priority C');
    expect(moved.introduced.some((i) => i.code === 'magic-priority-unused')).toBe(false);
    // A warning already on the record is not new.
    const already = analyseBuild(setPriority(face, 'magic', 'C'), SETTINGS);
    expect(already.probe((x) => ({ ...x, identity: { ...x.identity, age: 30 } })).warned.some((i) => i.code === 'magic-priority-unused')).toBe(false);
  });

  it('a keyed probe is answered once per draft', () => {
    const run = vi.fn((x: ReturnType<typeof blankBuild>) => setAttributePoints(x, 'agi', 1));
    const a = analyseBuild(blankBuild(), SETTINGS);
    const first = a.probe(run, 'agi+1');
    expect(a.probe(run, 'agi+1')).toBe(first);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('createAnalyser', () => {
  it('returns the same analysis object for the same draft and settings, and recomputes on a change', () => {
    const run = vi.fn(analyseBuild);
    const analyse = createAnalyser(run);
    const build = blankBuild();
    const first = analyse(build, SETTINGS);
    expect(analyse(build, SETTINGS)).toBe(first);
    expect(run).toHaveBeenCalledTimes(1);

    const renamed = { ...build, identity: { ...build.identity, alias: 'Quill Harrow' } };
    const second = analyse(renamed, SETTINGS);
    expect(second).not.toBe(first);
    expect(run).toHaveBeenCalledTimes(2);
    expect(second.issues.some((i) => i.code === 'alias-missing')).toBe(false);
  });
});
