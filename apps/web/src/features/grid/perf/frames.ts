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
 *
 * The harness feeds TWO series through this file — the wall-clock frame
 * interval and the main-thread cost inside each frame — so `ReportContext`
 * carries which series a table is and whether the floor is enforced on it.
 * Only one of them can be honestly asserted in a headless browser; which, and
 * why, is argued in `apps/web/e2e/perf.spec.ts`'s header.
 *
 * The second half of the file (`summarizeLoaf`) reads Chrome's
 * `long-animation-frame` entries, which is the only instrument here that can
 * answer *what* a slow frame was spent on: script versus render, and which
 * script. A p95 that misses the floor with no attribution is a number nobody
 * can act on.
 *
 * Everything here is pure and unit-tested (`frames.test.ts`); the browser-side
 * sampling and the gestures live in `apps/web/e2e/perf.spec.ts`.
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

export interface ReportContext {
  /** Which device profile these rows were measured on ("laptop", "phone"…). */
  profile: string;
  tokens: number;
  fogRegions: number;
  cpuThrottle: number;
  viewport: string;
  /** What the rows are timing — the harness prints more than one series. */
  series: string;
  /**
   * Whether the floor is enforced on this series or merely printed.
   *
   * The distinction is load-bearing and belongs in the output rather than only
   * in a spec's comments: a reader who cannot tell an asserted number from a
   * reported one will eventually quote the wrong one at a design decision.
   */
  asserted: boolean;
}

/**
 * The block the CI `perf` job prints. Written for a human scanning a log, not
 * for a parser: every line carries the phase, the sample size, the percentile
 * spread and the verdict, so a regression is legible without opening the spec.
 *
 * The exclusion lines are not boilerplate. A frame time measured on a headless
 * runner's software rasteriser is not a frame time on the GM's laptop or on
 * anyone's phone, and a report that did not say so would invite exactly the
 * wrong conclusion from a number that looks precise.
 */
export function formatReport(verdicts: readonly PhaseVerdict[], context: ReportContext): string {
  const head = [
    '',
    `grid frame budget [${context.profile}] — ${context.tokens} tokens + ` +
      `${context.fogRegions} fog regions, ${context.viewport}, CPU throttle ${context.cpuThrottle}×`,
    `  series: ${context.series}` +
      (context.asserted
        ? ` — ASSERTED against the ${FLOOR_FPS} fps floor`
        : ' — REPORTED ONLY, not asserted'),
    `  target ${TARGET_FPS} fps (${ms(TARGET_MS)}) · floor ${FLOOR_FPS} fps (${ms(FLOOR_MS)}) — DESIGN §15`,
    '  excludes: real device GPUs (headless chromium rasterises in software) and',
    "            real displays (vsync here is the runner's, not a 60 Hz panel's)",
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

/**
 * One extra series under the percentile table — used for the main-thread lag,
 * which is the same shape of data as a frame interval but not a frame interval.
 */
export function formatSeries(label: string, stats: FrameStats): string {
  return (
    `  ${label.padEnd(16)} n=${String(stats.n).padStart(4)}  ` +
    `p50 ${ms(stats.p50).padStart(8)}  p95 ${ms(stats.p95).padStart(8)}  ` +
    `p99 ${ms(stats.p99).padStart(8)}  max ${ms(stats.max).padStart(8)}`
  );
}

// ---------------------------------------------------------------------------
// What the frame was spent on — `long-animation-frame` attribution
// ---------------------------------------------------------------------------

/**
 * One `PerformanceLongAnimationFrameTiming` entry, flattened to the fields this
 * harness reads. Chrome only reports frames it considers long (over 50 ms), so
 * an empty list is itself a result: nothing crossed the bar.
 *
 * This exists because a p95 that misses the floor with no attribution is a
 * number nobody can act on. `dominant` answers "script or render?", and
 * `topScripts` names the chunk.
 */
export interface LoafSample {
  /** Whole frame, from the start of its first task to presentation. */
  duration: number;
  /** The part of `duration` that blocked input (Chrome's own definition). */
  blockingDuration: number;
  /** ms from the frame's start until rendering began — script and other tasks. */
  scriptMs: number;
  /** ms spent in style, layout, paint and compositing. */
  renderMs: number;
  /** Attributed script sources within the frame. */
  scripts: { name: string; duration: number }[];
}

export interface LoafSummary {
  n: number;
  p95Duration: number;
  maxDuration: number;
  meanScriptMs: number;
  meanRenderMs: number;
  /**
   * Which half of a long frame is bigger. `'none'` when nothing was long enough
   * to be reported — the good outcome, and one that must not read as "script"
   * by accident.
   */
  dominant: 'script' | 'render' | 'none';
  /** Longest attributed sources, most expensive first. */
  topScripts: { name: string; totalMs: number; share: number }[];
}

export function summarizeLoaf(samples: readonly LoafSample[], topN = 3): LoafSummary {
  if (samples.length === 0) {
    return {
      n: 0,
      p95Duration: Number.NaN,
      maxDuration: Number.NaN,
      meanScriptMs: 0,
      meanRenderMs: 0,
      dominant: 'none',
      topScripts: [],
    };
  }
  const durations = samples.map((s) => s.duration);
  const script = samples.reduce((sum, s) => sum + s.scriptMs, 0) / samples.length;
  const render = samples.reduce((sum, s) => sum + s.renderMs, 0) / samples.length;

  const byName = new Map<string, number>();
  for (const sample of samples) {
    for (const entry of sample.scripts) {
      const name = entry.name.length > 0 ? entry.name : '(anonymous)';
      byName.set(name, (byName.get(name) ?? 0) + entry.duration);
    }
  }
  const attributed = [...byName.values()].reduce((sum, v) => sum + v, 0);
  const topScripts = [...byName.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([name, totalMs]) => ({
      name,
      totalMs,
      share: attributed > 0 ? totalMs / attributed : 0,
    }));

  return {
    n: samples.length,
    p95Duration: percentile(durations, 0.95),
    maxDuration: percentile(durations, 1),
    meanScriptMs: script,
    meanRenderMs: render,
    dominant: script >= render ? 'script' : 'render',
    topScripts,
  };
}

/** One human-readable line per phase, printed under the percentile table. */
export function formatLoaf(phase: string, summary: LoafSummary): string {
  if (summary.n === 0) {
    return `  ${phase.padEnd(16)} no long frames (nothing crossed Chrome's 50ms bar)`;
  }
  const scripts = summary.topScripts
    .map((s) => `${shortenSource(s.name)} ${ms(s.totalMs)} (${(s.share * 100).toFixed(0)}%)`)
    .join(', ');
  return (
    `  ${phase.padEnd(16)} ${String(summary.n).padStart(3)} long  ` +
    `p95 ${ms(summary.p95Duration)}  max ${ms(summary.maxDuration)}  ` +
    `script ${ms(summary.meanScriptMs)} vs render ${ms(summary.meanRenderMs)} ` +
    `→ ${summary.dominant} dominates` +
    (scripts.length > 0 ? `\n${' '.repeat(18)}top: ${scripts}` : '')
  );
}

/** `http://host/assets/stage-a1b2.js?x=1` → `stage-a1b2.js`, for a readable log. */
export function shortenSource(name: string): string {
  const withoutQuery = name.split('?')[0] ?? name;
  const tail = withoutQuery.split('/').pop();
  return tail !== undefined && tail.length > 0 ? tail : name;
}
