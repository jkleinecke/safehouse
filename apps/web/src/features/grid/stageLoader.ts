/**
 * The one place that decides which renderer draws the map.
 *
 * Two renderers can stand behind `StageApi`: the classic PixiJS stage
 * (`stage/index.ts`) and, once it exists, the three.js stage
 * (`stage3d/index.ts`, P1 of the move to 3D). The Grid (`useStage.ts`) and the
 * TV (`tvStage.ts`) both mount through `loadStage` and never import either
 * renderer themselves, so the choice, the capability check and the fallback
 * live here and nowhere else.
 *
 * The choice, in order:
 *   1. Is there a 3D stage at all? Not yet (`STAGE3D_BUILT`), so today every
 *      mount is classic and nothing below it runs.
 *   2. Does this role get 3D in this phase (`roleMay3d`)? The GM first;
 *      players and the TV stay classic until P2.
 *   3. Has this device been set to Classic (`getRendererPreference`)?
 *   4. Can this browser run it (`supportsWebGL2`)? three.js needs WebGL2.
 *
 * And the fallback: a 3D stage that throws while starting, or that later
 * loses its GPU context, is replaced by the classic stage in the same host.
 * The page never learns it happened; it keeps the handle it was given.
 *
 * Both renderers are reached only through dynamic `import()`, so pixi and
 * three each stay in their own lazy chunk (D9, `router.chunks.test.ts`).
 */
import type { Role } from '@safehouse/contracts';
import type { VisionMode } from '@safehouse/rules';
import type { MovementThresholds, StageApi, StageOptions, TileDrawDef } from './types.js';

/** The two renderers the map can be drawn with. */
export type StageRenderer = '3d' | 'classic';

/** Who is mounting the map; the role gate reads it. */
export interface StageLoadContext {
  role: Role;
}

/**
 * What the loader hands the 3D stage besides its options: how to tell the
 * loader the GPU context is gone for good, so it can put the classic stage in
 * its place. The 3D stage's `createStage(opts, hooks)` takes this (P1).
 */
export interface Stage3DHooks {
  onLost(reason: string): void;
}

/**
 * Whether `./stage3d/index.ts` exists yet. P0 lays the seams before the 3D
 * stage is written, so this is false and every mount resolves to classic
 * without touching WebGL. P1 sets it true when it lands the 3D stage, and
 * fills in `create3d` below.
 */
const STAGE3D_BUILT: boolean = false;

/**
 * The roles offered the 3D stage in this phase. The GM plays on it first
 * (P1); players' phones and the TV stay classic until P2 has proved the fog
 * cannot leak when a view turns, and that the TV and phones hold a frame rate.
 * P2 widens this set to every role.
 */
export const ROLES_3D: ReadonlySet<Role> = new Set<Role>(['gm']);

/** Whether `role` may be drawn with the 3D stage in this phase (see `ROLES_3D`). */
export function roleMay3d(role: Role): boolean {
  return ROLES_3D.has(role);
}

/** The per-device renderer choice, in localStorage. Absent means "no choice made here". */
export const RENDERER_PREF_KEY = 'safehouse.renderer';

/**
 * The renderer this device was set to, or null when it was never set (the
 * default then applies: 3D where the gates allow it). Storage that cannot be
 * read — a private window, blocked site data — reads as never set.
 */
export function getRendererPreference(): StageRenderer | null {
  try {
    const v = window.localStorage.getItem(RENDERER_PREF_KEY);
    return v === '3d' || v === 'classic' ? v : null;
  } catch {
    return null;
  }
}

/**
 * Set this device's renderer (the future "Classic" switch), or clear the
 * choice with null. It takes effect on the next mount. Storage that cannot be
 * written is ignored: the choice simply does not stick.
 */
export function setRendererPreference(renderer: StageRenderer | null): void {
  try {
    if (renderer === null) window.localStorage.removeItem(RENDERER_PREF_KEY);
    else window.localStorage.setItem(RENDERER_PREF_KEY, renderer);
  } catch {
    // Not stored; the default stands.
  }
}

let webgl2: boolean | null = null;

/**
 * Can this browser make a WebGL2 context? Asked once per page load, with a
 * throwaway canvas whose context is released straight away, so the check
 * does not hold one of the browser's few contexts.
 */
export function supportsWebGL2(): boolean {
  if (webgl2 !== null) return webgl2;
  try {
    if (typeof document === 'undefined' || typeof WebGL2RenderingContext === 'undefined') {
      webgl2 = false;
    } else {
      const gl = document.createElement('canvas').getContext('webgl2');
      webgl2 = gl !== null;
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch {
    webgl2 = false;
  }
  return webgl2;
}

/**
 * Set when a 3D stage failed to start or lost its context: the rest of this
 * page load mounts classic straight away rather than failing the same way at
 * every scene switch. A reload tries 3D again.
 */
let failed3d = false;

/** Which renderer a mount for `role` gets, by the rules in this module's header. */
export function chooseRenderer(role: Role): StageRenderer {
  if (!STAGE3D_BUILT || failed3d) return 'classic';
  if (!roleMay3d(role)) return 'classic';
  if (getRendererPreference() === 'classic') return 'classic';
  if (!supportsWebGL2()) return 'classic';
  return '3d';
}

/**
 * Mount the map into `opts.host` with the renderer `chooseRenderer` picks
 * for `ctx.role`, falling back to classic if the 3D stage cannot start.
 * Rejects only when the classic stage cannot start either.
 */
export async function loadStage(opts: StageOptions, ctx: StageLoadContext): Promise<StageApi> {
  if (chooseRenderer(ctx.role) === '3d') {
    try {
      return await load3d(opts);
    } catch (err) {
      failed3d = true;
      console.warn('[stage] the 3D map could not start; drawing the classic map instead', err);
    }
  }
  return createClassic(opts);
}

/** The classic PixiJS stage: the only reference to `stage/` outside it (D9). */
async function createClassic(opts: StageOptions): Promise<StageApi> {
  const { createStage } = await import('./stage/index.js');
  return createStage(opts);
}

/**
 * The 3D stage's factory. P1 replaces the body with
 * `(await import('./stage3d/index.js')).createStage(opts, hooks)`. Until the
 * 3D stage exists it refuses, which `loadStage` answers with classic — but
 * `STAGE3D_BUILT` keeps it from being asked at all.
 */
async function create3d(opts: StageOptions, hooks: Stage3DHooks): Promise<StageApi> {
  throw new Error('there is no 3D stage yet');
}

/**
 * The 3D stage behind a handle that can swap it for the classic stage.
 *
 * The page keeps this handle for the stage's whole life, so it remembers what
 * the page last told the stage — the frame state, the palette, the view mode,
 * the drag ghosts and the ruler bands — and, if the 3D stage reports its GPU
 * context lost, destroys it and starts the classic stage in the same host
 * with all of that replayed. One-off effects (a ping, a trail sample, a
 * camera move) are not replayed: the classic stage frames the scene itself.
 */
async function load3d(opts: StageOptions): Promise<StageApi> {
  let state = opts.state;
  let defs: Record<string, TileDrawDef> | null = null;
  let viewMode: VisionMode | null = null;
  let drags: Parameters<StageApi['setDrags']>[0] | null = null;
  let thresholds: MovementThresholds | null | undefined;
  let current: StageApi | null = null;
  let destroyed = false;
  let lost = false;

  const onLost = (reason: string): void => {
    if (destroyed || lost) return;
    lost = true;
    failed3d = true;
    console.warn(`[stage] the 3D map lost its GPU context (${reason}); switching to the classic map`);
    const dead = current;
    current = null;
    try {
      dead?.destroy();
    } catch {
      // A stage without a context may fail to tear down cleanly; it is gone either way.
    }
    void createClassic({ ...opts, state })
      .then((classic) => {
        if (destroyed) {
          classic.destroy();
          return;
        }
        if (defs) classic.setTileDefs(defs);
        if (viewMode) classic.setViewMode(viewMode);
        if (drags) classic.setDrags(drags);
        if (thresholds !== undefined) classic.setRulerThresholds(thresholds);
        current = classic;
      })
      .catch((err: unknown) => {
        console.error('[stage] the classic map could not start after the 3D map was lost', err);
      });
  };

  const inner = await create3d(opts, { onLost });
  // A context lost while the stage was still starting has already sent the
  // classic stage in; the 3D one it would have been is not wanted.
  if (lost) inner.destroy();
  else current = inner;

  return {
    update(s) {
      state = s;
      current?.update(s);
    },
    setTileDefs(d) {
      defs = d;
      current?.setTileDefs(d);
    },
    setViewMode(m) {
      viewMode = m;
      current?.setViewMode(m);
    },
    setDrags(d) {
      drags = d;
      current?.setDrags(d);
    },
    flashPing(x, y) {
      current?.flashPing(x, y);
    },
    trail(x, y) {
      current?.trail(x, y);
    },
    setRulerThresholds(t) {
      thresholds = t;
      current?.setRulerThresholds(t);
    },
    clearRuler() {
      current?.clearRuler();
    },
    centerOn(x, y) {
      current?.centerOn(x, y);
    },
    zoomBy(factor) {
      current?.zoomBy(factor);
    },
    fitScene() {
      current?.fitScene();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      current?.destroy();
      current = null;
    },
  };
}
