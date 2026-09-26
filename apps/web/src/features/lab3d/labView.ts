/**
 * The 3D lab's view: one scene, drawn by three.js into a host element, with
 * the numbers a "should the map move to a real 3D engine?" decision needs.
 *
 * A thin shell over the 3D runtime (`runtime3d.ts`), which does all the
 * drawing — renderer, quality tiers, world, figures, lighting, floors, the
 * camera and the frame loop. What the lab adds is its own: the options from
 * the page, the benchmark, and the frame numbers for the HUD. The page reads
 * `stats()` twice a second.
 *
 * The runtime draws on demand, so the lab measures what the map will do: a
 * still view draws nothing, and its HUD numbers are those of the last second
 * it did draw (`LabStats.idle` says so). The benchmark flies the camera
 * itself, so it asks for every frame of its orbits.
 *
 * Nothing here is shared with the 2D map, and nothing in the 2D map changes
 * because this exists.
 */
import { Spherical, Vector3 } from 'three';
import { createRuntime3D, type LabLightCounts, type LabQuality, type Runtime3DOptions } from './runtime3d.js';

export type { LabBelow, LabCamera, LabLightCounts, LabQuality, LabWalls } from './runtime3d.js';

/** Everything the view draws and how. `update` takes any subset of these. */
export type LabViewOptions = Runtime3DOptions;

/** A snapshot of how the view is doing, for the page's HUD. */
export interface LabStats {
  /** Frames per second, averaged over the last second of drawing. */
  fps: number;
  /** Time between frames over the last second: the mean and the single worst. */
  frameMsAvg: number;
  frameMsWorst: number;
  /**
   * CPU time spent inside the frame callback (controls, light picking and
   * submitting the draw calls), averaged over the last second. Not GPU time:
   * on a vsynced display this is the headroom the frame time cannot show.
   */
  cpuMsAvg: number;
  /** Draw calls and triangles in the last frame, every pass included (shadow maps too). */
  drawCalls: number;
  triangles: number;
  lights: LabLightCounts;
  /** How long the world took to build, and how many triangles it came to. */
  worldBuildMs: number;
  worldTriangles: number;
  /** The pixel ratio the renderer is drawing at, and the canvas size in CSS pixels. */
  pixelRatio: number;
  width: number;
  height: number;
  /** The GPU as WebGL names it (unmasked when the browser allows). */
  gpu: string;
  quality: LabQuality;
  benchmarking: boolean;
  /**
   * Nothing has been drawn for the last second: the view is still, and draws
   * only when something changes. The frame numbers are then those of the
   * last second it drew.
   */
  idle: boolean;
}

/** One quality level's benchmark pass. */
export interface BenchResult {
  quality: LabQuality;
  /** Mean frames per second over the measured part of the orbit. */
  fps: number;
  /** The worst 1% of frame times, averaged, as frames per second. */
  low1Fps: number;
  /** Mean time between frames. */
  frameMs: number;
  /** Mean CPU time inside the frame callback. */
  cpuMs: number;
  /** How many frames were measured. */
  frames: number;
  drawCalls: number;
  triangles: number;
  lights: LabLightCounts;
  pixelRatio: number;
}

/** Where a running benchmark is: which pass, and how far through it. */
export interface BenchProgress {
  quality: LabQuality;
  /** 0-based pass index, of `of` passes. */
  index: number;
  of: number;
  /** 0..1 through this pass's orbit. */
  fraction: number;
}

export interface LabView {
  /** Change any options; only what actually changed is rebuilt. */
  update(partial: Partial<LabViewOptions>): void;
  /**
   * Orbit the camera through a full turn at each quality in turn, and
   * measure. The view's own quality and camera are put back afterwards.
   * Resolves with whatever passes finished if the view is disposed midway.
   */
  benchmark(onProgress?: (p: BenchProgress) => void): Promise<BenchResult[]>;
  stats(): LabStats;
  /** Put the camera back on the whole scene, at the current camera's framing. */
  reframe(): void;
  dispose(): void;
}

/** One benchmark orbit, and the warm-up at its start that is not measured (shader compiles, first shadow maps). */
const BENCH_MS = 6000;
const BENCH_WARMUP_MS = 1000;
const BENCH_ORDER: readonly LabQuality[] = ['low', 'medium', 'high'];
/** A gap longer than this was a hidden tab, not a slow frame. */
const STALL_MS = 1000;
/** The HUD's window: frame numbers cover this much of the latest drawing, and a view that drew nothing in it is idle. */
const WINDOW_MS = 1000;

interface Sample {
  t: number;
  dt: number;
  cpu: number;
}

interface BenchPass {
  quality: LabQuality;
  /** Timestamp of the pass's first frame; null until it has drawn one. */
  start: number | null;
  /** The camera's place around the target when the pass began; the orbit turns its azimuth. */
  from: Spherical;
  dts: number[];
  cpus: number[];
  calls: number;
  tris: number;
  lastProgress: number;
  onProgress: (fraction: number) => void;
  done: (result: BenchResult | null) => void;
}

/**
 * Mount the lab into `host` (which should be positioned and sized; the
 * canvas fills it) and start drawing. Throws if WebGL or a builder fails, so
 * the page can say so.
 */
export function createLabView(host: HTMLElement, initial: LabViewOptions): LabView {
  const rt = createRuntime3D(host, initial);
  let disposed = false;

  // Frame bookkeeping, fed by the runtime after each frame it draws.
  const samples: Sample[] = [];
  let lastCalls = 0;
  let lastTris = 0;
  /** When the runtime last drew a frame; a second after it, the view is idle. */
  let lastDrawn = -Infinity;
  let pass: BenchPass | null = null;
  /** The quality to go back to after a benchmark; the page may change it mid-run. */
  let benchRestore: LabQuality | null = null;

  const tmpOffset = new Vector3();
  const tmpSpherical = new Spherical();

  // --- the frame hooks -----------------------------------------------------

  // A running pass flies the camera one step round its orbit before each
  // frame, and asks for the next frame until the pass is done.
  const offBefore = rt.onBeforeFrame((now) => {
    const p = pass;
    if (!p) return false;
    const camera = rt.camera;
    const target = rt.controls.target;
    if (p.start === null) {
      p.start = now;
      p.from.setFromVector3(tmpOffset.copy(camera.position).sub(target));
    }
    const elapsed = now - p.start;
    const turn = (Math.PI * 2 * Math.min(elapsed, BENCH_MS)) / BENCH_MS;
    tmpSpherical.set(p.from.radius, p.from.phi, p.from.theta + turn);
    camera.position.setFromSpherical(tmpSpherical).add(target);
    camera.lookAt(target);
    return true;
  });

  // After each frame, its numbers: into the HUD's last second of drawing,
  // and into the running pass once that is past its warm-up.
  const offAfter = rt.onAfterFrame((f) => {
    lastCalls = f.drawCalls;
    lastTris = f.triangles;
    lastDrawn = f.now;
    if (f.dt > 0 && f.dt < STALL_MS) samples.push({ t: f.now, dt: f.dt, cpu: f.cpu });
    while (samples.length > 0 && samples[0]!.t < f.now - WINDOW_MS) samples.shift();

    const p = pass;
    if (!p || p.start === null) return;
    const elapsed = f.now - p.start;
    if (elapsed >= BENCH_WARMUP_MS && f.dt > 0 && f.dt < STALL_MS) {
      p.dts.push(f.dt);
      p.cpus.push(f.cpu);
      p.calls += f.drawCalls;
      p.tris += f.triangles;
    }
    if (f.now - p.lastProgress >= 200) {
      p.lastProgress = f.now;
      p.onProgress(Math.min(1, elapsed / BENCH_MS));
    }
    if (elapsed >= BENCH_MS) {
      pass = null;
      p.done(summarize(p));
    }
  });

  // --- the benchmark -------------------------------------------------------

  function summarize(p: BenchPass): BenchResult {
    const n = p.dts.length;
    const { lights, pixelRatio } = rt.info();
    const base = { quality: p.quality, lights, pixelRatio };
    if (n === 0) return { ...base, fps: 0, low1Fps: 0, frameMs: 0, cpuMs: 0, frames: 0, drawCalls: 0, triangles: 0 };
    const mean = p.dts.reduce((a, b) => a + b, 0) / n;
    const worst = [...p.dts].sort((a, b) => b - a);
    const k = Math.max(1, Math.floor(n / 100));
    const worstMean = worst.slice(0, k).reduce((a, b) => a + b, 0) / k;
    return {
      ...base,
      fps: 1000 / mean,
      low1Fps: 1000 / worstMean,
      frameMs: mean,
      cpuMs: p.cpus.reduce((a, b) => a + b, 0) / n,
      frames: n,
      drawCalls: Math.round(p.calls / n),
      triangles: Math.round(p.tris / n),
    };
  }

  function runPass(q: LabQuality, onProgress: (fraction: number) => void): Promise<BenchResult | null> {
    return new Promise((resolve) => {
      pass = {
        quality: q,
        start: null,
        from: new Spherical(),
        dts: [],
        cpus: [],
        calls: 0,
        tris: 0,
        lastProgress: 0,
        onProgress,
        done: resolve,
      };
      // The view may be sitting idle: the pass's first frame starts its orbit.
      rt.requestRender();
    });
  }

  // --- the handle ----------------------------------------------------------

  return {
    update(partial) {
      if (disposed) return;
      // Mid-benchmark the quality belongs to the benchmark; remember the
      // page's choice and apply it when the run hands the view back.
      if (benchRestore !== null && partial.quality !== undefined) {
        const { quality, ...rest } = partial;
        benchRestore = quality;
        rt.update(rest);
        return;
      }
      rt.update(partial);
    },

    async benchmark(onProgress) {
      if (disposed || pass !== null || benchRestore !== null) return [];
      benchRestore = rt.options.quality;
      const camera = rt.camera;
      const savedPos = camera.position.clone();
      const savedTarget = rt.controls.target.clone();
      const savedZoom = camera.zoom;
      // The orbit flies the camera; the page's drag must not fight it.
      rt.setOrbitEnabled(false);
      const results: BenchResult[] = [];
      try {
        for (let i = 0; i < BENCH_ORDER.length; i += 1) {
          const q = BENCH_ORDER[i]!;
          rt.update({ quality: q });
          const r = await runPass(q, (fraction) => onProgress?.({ quality: q, index: i, of: BENCH_ORDER.length, fraction }));
          if (r === null || disposed) break;
          results.push(r);
        }
      } finally {
        const back = benchRestore ?? rt.options.quality;
        benchRestore = null;
        pass = null;
        if (!disposed) {
          rt.update({ quality: back });
          camera.position.copy(savedPos);
          camera.zoom = savedZoom;
          camera.updateProjectionMatrix();
          rt.controls.target.copy(savedTarget);
          rt.setOrbitEnabled(true);
          rt.controls.update();
          rt.requestRender();
        }
      }
      return results;
    },

    stats() {
      let sum = 0;
      let worst = 0;
      let cpu = 0;
      for (const s of samples) {
        sum += s.dt;
        cpu += s.cpu;
        if (s.dt > worst) worst = s.dt;
      }
      const n = samples.length;
      const mean = n > 0 ? sum / n : 0;
      const info = rt.info();
      return {
        fps: mean > 0 ? 1000 / mean : 0,
        frameMsAvg: mean,
        frameMsWorst: worst,
        cpuMsAvg: n > 0 ? cpu / n : 0,
        drawCalls: lastCalls,
        triangles: lastTris,
        lights: info.lights,
        worldBuildMs: info.worldBuildMs,
        worldTriangles: info.worldTriangles,
        pixelRatio: info.pixelRatio,
        width: info.width,
        height: info.height,
        gpu: info.gpu,
        quality: info.quality,
        benchmarking: pass !== null || benchRestore !== null,
        idle: performance.now() - lastDrawn > WINDOW_MS,
      };
    },

    reframe() {
      if (disposed || pass !== null) return;
      rt.reframe();
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      offBefore();
      offAfter();
      const p = pass;
      pass = null;
      p?.done(null);
      rt.dispose();
    },
  };
}
