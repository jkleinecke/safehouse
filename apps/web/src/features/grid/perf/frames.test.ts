/**
 * The statistic the Grid frame-budget harness quotes, pinned.
 *
 * A perf harness is uniquely easy to make lie: pick the mean instead of a
 * percentile, take three samples, compare against the wrong constant, and it
 * reports a green number for ever. These tests are about the ways this one
 * could be wrong while still printing something plausible — the percentile
 * rank, the §15 constants, the too-short-to-mean-anything guard, and the fact
 * that a genuine miss is rendered as `MISS` rather than quietly rounded away.
 */
import { describe, expect, it } from 'vitest';
import {
  FLOOR_FPS,
  FLOOR_MS,
  MIN_FRAMES_PER_PHASE,
  TARGET_FPS,
  TARGET_MS,
  formatLoaf,
  formatReport,
  formatSeries,
  fps,
  judge,
  percentile,
  shortenSource,
  summarize,
  summarizeLoaf,
  type LoafSample,
} from './frames.js';

/** n frames of exactly `each` ms, plus the stalls that make a p95 interesting. */
function frames(each: number, count: number, stalls: number[] = []): number[] {
  return [...Array.from({ length: count }, () => each), ...stalls];
}

describe('the §15 constants', () => {
  it('are the two numbers the spec writes down, as intervals', () => {
    expect(TARGET_FPS).toBe(60);
    expect(FLOOR_FPS).toBe(30);
    expect(TARGET_MS).toBeCloseTo(16.667, 2);
    expect(FLOOR_MS).toBeCloseTo(33.333, 2);
    // The floor is the looser bound; getting these the wrong way round would
    // assert the target and fail on hardware the spec accepts.
    expect(FLOOR_MS).toBeGreaterThan(TARGET_MS);
  });

  it('round-trips an interval back to fps', () => {
    expect(fps(FLOOR_MS)).toBeCloseTo(30, 6);
    expect(fps(TARGET_MS)).toBeCloseTo(60, 6);
    expect(fps(0)).toBeNaN();
  });
});

describe('percentile', () => {
  it('uses nearest rank, so p95 of 20 samples is the 19th', () => {
    const values = Array.from({ length: 20 }, (_, i) => i + 1); // 1..20
    expect(percentile(values, 0.95)).toBe(19);
    expect(percentile(values, 1)).toBe(20);
    expect(percentile(values, 0)).toBe(1);
    expect(percentile(values, 0.5)).toBe(10);
  });

  it('does not depend on the input order and does not mutate it', () => {
    const values = [9, 1, 7, 3, 5];
    const copy = [...values];
    expect(percentile(values, 0.5)).toBe(percentile(copy.reverse(), 0.5));
    expect(values).toEqual([9, 1, 7, 3, 5]);
  });

  it('is NaN on an empty sample rather than 0', () => {
    // 0 would read as "a perfect frame time", which is the worst possible
    // failure mode for a harness that collected nothing.
    expect(percentile([], 0.95)).toBeNaN();
  });
});

describe('summarize', () => {
  it('separates a stall from the mean it would otherwise disappear into', () => {
    // A second of 60 fps with one frame in ten lurching to 90 ms. The MEAN
    // comes out at ~24 ms — 42 fps, comfortably over the floor, reads as fine.
    // The p95 is the statistic that says the map lurched six times.
    const stats = summarize(frames(16.6, 54, [90, 90, 90, 90, 90, 90]));
    expect(stats.n).toBe(60);
    expect(fps(stats.mean)).toBeGreaterThan(FLOOR_FPS);
    expect(stats.p95).toBeGreaterThan(FLOOR_MS);
    expect(stats.overFloor).toBe(6);
    expect(stats.overTarget).toBe(6);
    expect(stats.max).toBe(90);
  });

  it('counts frames over each threshold independently', () => {
    const stats = summarize([10, 20, 20, 40]);
    expect(stats.overTarget).toBe(3); // 20, 20, 40
    expect(stats.overFloor).toBe(1); // 40
  });
});

describe('judge', () => {
  it('holds the floor but not the target for a steady 40 fps', () => {
    const v = judge({ phase: 'pan', deltas: frames(25, 100) });
    expect(v.holdsFloor).toBe(true);
    expect(v.holdsTarget).toBe(false);
    expect(v.enoughFrames).toBe(true);
  });

  it('misses the floor when the 95th percentile crosses it', () => {
    // 90 good frames and 10 bad ones: p95 lands in the bad tail.
    const v = judge({ phase: 'drag', deltas: frames(16, 90, frames(50, 10)) });
    expect(v.stats.p95).toBeGreaterThan(FLOOR_MS);
    expect(v.holdsFloor).toBe(false);
  });

  it('refuses to call a three-frame sample a measurement', () => {
    const v = judge({ phase: 'zoom', deltas: [8, 8, 8] });
    // It would "hold the floor" arithmetically — that is exactly the vacuous
    // pass this flag exists to make visible.
    expect(v.holdsFloor).toBe(true);
    expect(v.enoughFrames).toBe(false);
    expect(MIN_FRAMES_PER_PHASE).toBeGreaterThanOrEqual(30);
  });

  it('does not hold anything on an empty sample', () => {
    const v = judge({ phase: 'idle', deltas: [] });
    expect(v.holdsFloor).toBe(false);
    expect(v.holdsTarget).toBe(false);
    expect(v.enoughFrames).toBe(false);
  });
});

describe('formatReport', () => {
  const context = {
    profile: 'laptop',
    tokens: 60,
    fogRegions: 8,
    cpuThrottle: 4,
    viewport: '1280×720',
    series: 'main-thread cost per frame',
    asserted: true,
  };

  it('marks each phase with the verdict a reader should act on', () => {
    const out = formatReport(
      [
        judge({ phase: 'idle', deltas: frames(16, 120) }),
        judge({ phase: 'pan', deltas: frames(25, 120) }),
        judge({ phase: 'drag', deltas: frames(50, 120) }),
        judge({ phase: 'short', deltas: [8, 8] }),
      ],
      context,
    );
    expect(out).toContain('ok60');
    expect(out).toContain('ok30');
    expect(out).toContain('MISS');
    expect(out).toContain('SHORT');
  });

  it('states the profile, the scene and the throttle it was measured under', () => {
    const out = formatReport([judge({ phase: 'pan', deltas: frames(16, 60) })], context);
    expect(out).toContain('[laptop]');
    expect(out).toContain('60 tokens');
    expect(out).toContain('8 fog regions');
    expect(out).toContain('1280×720');
    expect(out).toContain('CPU throttle 4×');
  });

  it('carries its own exclusions, so the number is never quoted bare', () => {
    const out = formatReport([judge({ phase: 'pan', deltas: frames(16, 60) })], context);
    expect(out).toContain('excludes');
    expect(out.toLowerCase()).toContain('gpu');
  });

  it('says on the face of it whether the floor is enforced on this series', () => {
    // The harness prints two tables and enforces the floor on one of them. A
    // reader who cannot tell them apart will eventually quote the wrong number
    // at a design decision, so the distinction lives in the output.
    const verdicts = [judge({ phase: 'pan', deltas: frames(16, 60) })];
    expect(formatReport(verdicts, context)).toContain('ASSERTED');
    const reported = formatReport(verdicts, { ...context, asserted: false });
    expect(reported).toContain('REPORTED ONLY');
    expect(reported).not.toContain('ASSERTED');
  });

  it('names the series, so two tables cannot be confused for one', () => {
    const out = formatReport([judge({ phase: 'pan', deltas: frames(16, 60) })], {
      ...context,
      series: 'achieved frame interval, wall clock',
    });
    expect(out).toContain('achieved frame interval, wall clock');
  });
});

describe('formatSeries', () => {
  it('prints a percentile row for a series that is not a frame interval', () => {
    const line = formatSeries('sampler lag', summarize([1, 2, 3, 40]));
    expect(line).toContain('sampler lag');
    expect(line).toContain('n=   4');
    expect(line).toContain('p95');
    // No verdict marker: this series is not judged against §15.
    expect(line).not.toContain('MISS');
    expect(line).not.toContain('ok30');
  });
});

describe('summarizeLoaf', () => {
  const sample = (over: Partial<LoafSample> = {}): LoafSample => ({
    duration: 60,
    blockingDuration: 10,
    scriptMs: 40,
    renderMs: 20,
    scripts: [{ name: 'http://x/assets/stage-abc.js', duration: 30 }],
    ...over,
  });

  it('says "none" when nothing was long enough to report', () => {
    const s = summarizeLoaf([]);
    expect(s.n).toBe(0);
    // Not 'script': an empty list must never be dressed up as a finding.
    expect(s.dominant).toBe('none');
    expect(s.topScripts).toEqual([]);
    expect(s.p95Duration).toBeNaN();
  });

  it('names render as the dominant half when it outweighs script', () => {
    const s = summarizeLoaf([sample({ scriptMs: 5, renderMs: 55 })]);
    expect(s.dominant).toBe('render');
    expect(s.meanRenderMs).toBe(55);
    expect(s.meanScriptMs).toBe(5);
  });

  it('totals attributed script time per source and ranks it', () => {
    const s = summarizeLoaf([
      sample({
        scripts: [
          { name: 'a.js', duration: 10 },
          { name: 'b.js', duration: 5 },
        ],
      }),
      sample({ scripts: [{ name: 'b.js', duration: 30 }] }),
    ]);
    expect(s.topScripts[0]).toMatchObject({ name: 'b.js', totalMs: 35 });
    expect(s.topScripts[1]).toMatchObject({ name: 'a.js', totalMs: 10 });
    expect(s.topScripts[0]?.share).toBeCloseTo(35 / 45, 6);
  });

  it('keeps an unnamed source rather than dropping its cost', () => {
    const s = summarizeLoaf([sample({ scripts: [{ name: '', duration: 12 }] })]);
    expect(s.topScripts[0]).toMatchObject({ name: '(anonymous)', totalMs: 12 });
  });
});

describe('formatLoaf', () => {
  it('says plainly that nothing was long, instead of printing a blank row', () => {
    expect(formatLoaf('pan', summarizeLoaf([]))).toContain('no long frames');
  });

  it('prints the script-vs-render verdict and the top source', () => {
    const line = formatLoaf(
      'drag',
      summarizeLoaf([
        {
          duration: 70,
          blockingDuration: 20,
          scriptMs: 50,
          renderMs: 20,
          scripts: [{ name: 'http://h/assets/grid-9f.js', duration: 44 }],
        },
      ]),
    );
    expect(line).toContain('script dominates');
    expect(line).toContain('grid-9f.js');
  });
});

describe('shortenSource', () => {
  it('reduces a bundled chunk URL to something a log can show', () => {
    expect(shortenSource('http://127.0.0.1:8791/assets/stage-a1b2.js?v=3')).toBe('stage-a1b2.js');
    expect(shortenSource('inline')).toBe('inline');
    expect(shortenSource('')).toBe('');
  });
});
