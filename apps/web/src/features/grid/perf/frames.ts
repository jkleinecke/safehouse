/**
 * Frame-time statistics and the §15 Grid budget — pure, unit-tested.
 *
 * DESIGN.md §15 ("Latency — Grid"): *"Pan/zoom stays smooth (target 60 fps,
 * floor 30) on a mid-range laptop and a 3-year-old phone with a 60-token
 * scene."* Two numbers, one of which is a floor, and until now nothing in the
 * repo turned either into a measurement.
 *
 * The statistic is the **95th percentile frame time**, not mean fps. Mean fps is
 * the wrong instrument for this row: a second of perfect 60 fps with two 90 ms
 * stalls in it averages to ~55 fps and reads as fine, while what the GM
 * actually saw was the map lurch twice mid-drag. A percentile over frame
 * *intervals* names the stalls.
 */

/** One phase of the scripted gesture, with the rAF intervals it produced. */
export interface PhaseSamples {
  phase: string;
  /** Consecutive `requestAnimationFrame` timestamp deltas, in ms. */
  deltas: number[];
}

export interface FrameStats {
  n: number;
  min: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  mean: number;
  /** Frames slower than the 30 fps floor — the ones a human notices. */
  overFloor: number;
  /** Frames slower than the 60 fps target. */
  overTarget: number;
}

/** DESIGN §15 — the two numbers, as frame intervals. */
export const TARGET_FPS = 60;
export const FLOOR_FPS = 30;
export const TARGET_MS = 1000 / TARGET_FPS; // 16.67
export const FLOOR_MS = 1000 / FLOOR_FPS; // 33.33

/**
 * The shortest run worth quoting a p95 from.
 *
 * With fewer than this many frames the 95th percentile is just "the slowest
 * one or two", which is noise. A harness that collected three frames and
 * declared victory would be exactly the always-passing smoke test this file
 * exists instead of.
 */
export const MIN_FRAMES_PER_PHASE = 30;

/** Nearest-rank percentile (p in 0..1) over an ascending copy of `values`. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[rank] ?? Number.NaN;
}

export function summarize(deltas: readonly number[]): FrameStats {
  const total = deltas.reduce((sum, d) => sum + d, 0);
  return {
    n: deltas.length,
    min: percentile(deltas, 0),
    p50: percentile(deltas, 0.5),
    p95: percentile(deltas, 0.95),
    p99: percentile(deltas, 0.99),
    max: percentile(deltas, 1),
    mean: deltas.length === 0 ? Number.NaN : total / deltas.length,
    overFloor: deltas.filter((d) => d > FLOOR_MS).length,
    overTarget: deltas.filter((d) => d > TARGET_MS).length,
  };
}

/** Frame interval (ms) → the fps it corresponds to. */
export function fps(intervalMs: number): number {
  return intervalMs > 0 ? 1000 / intervalMs : Number.NaN;
}

export interface PhaseVerdict {
  phase: string;
  stats: FrameStats;
  /** False when the sample is too short to mean anything (see MIN_FRAMES). */
  enoughFrames: boolean;
  /** p95 under the 30 fps floor — the assertion §15 actually sets. */
  holdsFloor: boolean;
  /** p95 under the 60 fps target — reported, never asserted. */
  holdsTarget: boolean;
}

export function judge(samples: PhaseSamples): PhaseVerdict {
  const stats = summarize(samples.deltas);
  return {
    phase: samples.phase,
    stats,
    enoughFrames: stats.n >= MIN_FRAMES_PER_PHASE,
    holdsFloor: stats.n > 0 && stats.p95 < FLOOR_MS,
    holdsTarget: stats.n > 0 && stats.p95 < TARGET_MS,
  };
}

function ms(v: number): string {
  return Number.isFinite(v) ? `${v.toFixed(1)}ms` : '—';
}

/**
 * The block the CI `perf` job prints. Written for a human scanning a log, not
 * for a parser: every line carries the phase, the sample size, the percentile
 * spread and the verdict, so a regression is legible without opening the spec.
 */
export function formatReport(
  verdicts: readonly PhaseVerdict[],
  context: { tokens: number; fogRegions: number; cpuThrottle: number; viewport: string },
): string {
  const head = [
    '',
    `grid frame budget — ${context.tokens} tokens + ${context.fogRegions} fog regions, ` +
      `${context.viewport}, CPU throttle ${context.cpuThrottle}×`,
    `  target ${TARGET_FPS} fps (${ms(TARGET_MS)}) · floor ${FLOOR_FPS} fps (${ms(FLOOR_MS)}) — DESIGN §15`,
    '  headless chromium software WebGL: NOT a real device GPU — see the spec header',
  ];
  const rows = verdicts.map((v) => {
    const s = v.stats;
    const mark = !v.enoughFrames ? 'SHORT' : v.holdsTarget ? 'ok60' : v.holdsFloor ? 'ok30' : 'MISS';
    return (
      `  ${v.phase.padEnd(16)} n=${String(s.n).padStart(4)}  ` +
      `p50 ${ms(s.p50).padStart(8)}  p95 ${ms(s.p95).padStart(8)}  p99 ${ms(s.p99).padStart(8)}  ` +
      `max ${ms(s.max).padStart(8)}  >floor ${String(s.overFloor).padStart(3)}  ` +
      `${fps(s.p95).toFixed(0).padStart(3)}fps@p95  ${mark}`
    );
  });
  return [...head, ...rows, ''].join('\n');
}
