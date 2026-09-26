/**
 * The one place that decides which renderer draws the map.
 *
 * Two renderers can stand behind `StageApi`: the classic PixiJS stage
 * (`stage/index.ts`) and the three.js stage (`stage3d/index.ts`, P1 of the
 * move to 3D). The Grid (`useStage.ts`) and the
 * TV (`tvStage.ts`) both mount through `loadStage` and never import either
 * renderer themselves, so the choice, the capability check and the fallback
 * live here and nowhere else.
 *
 * The choice, in order:
 *   1. Is there a 3D stage at all (`STAGE3D_BUILT`)? Yes, since P1.
 *   2. Does this role get 3D in this phase (`roleMay3d`)? Every role, since
 *      P2: the GM, the players, the observers and the TV.
 *   3. Has this device been set to Classic (`getRendererPreference`)?
 *   4. Can this browser run it (`supportsWebGL2`)? three.js needs WebGL2.
 *
 * The 3D map's quality is this device's too (`getQualityPreference`): Low on
 * the TV, always; for anyone else what the device was set to, else Low on a
 * phone or a tablet and Medium elsewhere. The loader hands it to the 3D
 * stage with the role it is for (`Stage3DHooks.quality`).
 *
 * And the fallback: a 3D stage that throws while starting, or that later
 * loses its GPU context or cannot build a change, is replaced by the classic
 * stage in the same host.
 * The page never learns it happened; it keeps the handle it was given.
 *
 * Both renderers are reached only through dynamic `import()`, so pixi and
 * three each stay in their own lazy chunk (D9, `router.chunks.test.ts`).
 */
import type { Role } from '@safehouse/contracts';
import type { VisionMode } from '@safehouse/rules';
import type {
  MovementThresholds,
  StageApi,
  StageOptions,
  StageQuality,
  StageRenderer,
  TileDrawDef,
} from './types.js';

export type { StageQuality, StageRenderer } from './types.js';

/** Who is mounting the map; the role gate reads it. */
export interface StageLoadContext {
  role: Role;
}

/**
 * What the loader hands the 3D stage besides its options. The 3D stage's
 * `createStage(opts, hooks)` takes this (P1).
 */
export interface Stage3DHooks {
  /**
   * How to tell the loader the 3D map cannot go on — its GPU context is gone
   * for good, or its world could not be built from a later change — so it
   * can put the classic stage in its place.
   */
  onLost(reason: string): void;
  /**
   * The quality the 3D map starts at: this device's for the role mounting it
   * (`getQualityPreference`). Afterwards the page changes it on the live
   * stage (`StageApi.setQuality`).
   */
  quality: StageQuality;
}

/**
 * Whether `./stage3d/index.ts` exists. P0 laid the seams with this false, so
 * every mount resolved to classic without touching WebGL; P1 landed the 3D
 * stage and set it true. Flip it back to take the 3D map out of every mount
 * at once without touching anything else.
 */
const STAGE3D_BUILT: boolean = true;

/**
 * Which roles are offered the 3D stage, each one decided here — a role added
 * to the contract does not compile until it is. The GM played on it first
 * (P1); P2 made the fog and the sightline shroud cover the 3D scene at every
 * height and from every angle, and moved the players' phones and laptops,
 * the observers and the TV (`display`) onto it too.
 */
const OFFERED_3D: Readonly<Record<Role, boolean>> = {
  gm: true,
  player: true,
  observer: true,
  display: true,
};

/** The roles offered the 3D stage in this phase (`OFFERED_3D`): every role, since P2. */
export const ROLES_3D: ReadonlySet<Role> = new Set<Role>(
  (Object.keys(OFFERED_3D) as Role[]).filter((role) => OFFERED_3D[role]),
);

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
 * Set this device's renderer (the 3D / Classic switch), or clear the
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

/** The per-device 3D quality, in localStorage. Absent means the device's default (`getQualityPreference`). */
export const QUALITY_PREF_KEY = 'safehouse.renderer.quality';

/**
 * The 3D quality a mount for `role` starts at on this device.
 *
 * The TV (`display`) is always Low: a kiosk left drawing for hours, often on
 * a stick or a smart TV's own browser, with no quality switch of its own.
 * The stored choice is the Grid's switch, and it does not reach the TV — a
 * TV page opened in the GM's own browser (a second screen off the laptop the
 * session runs from) must not take the GM's High and double the laptop's GPU
 * load.
 *
 * Anyone else gets what this device was set to, or when it was never set:
 * Low on a touch-first device (a phone, a tablet: a coarse pointer), where
 * the GPU and the battery are the constraint, and Medium elsewhere. Storage
 * that cannot be read reads as never set.
 */
export function getQualityPreference(role?: Role): StageQuality {
  if (role === 'display') return 'low';
  try {
    const v = window.localStorage.getItem(QUALITY_PREF_KEY);
    if (v === 'low' || v === 'medium' || v === 'high') return v;
  } catch {
    // Unreadable: the default stands.
  }
  try {
    return window.matchMedia('(pointer: coarse)').matches ? 'low' : 'medium';
  } catch {
    return 'medium';
  }
}

/**
 * Set this device's 3D quality. The page also hands it to the live stage
 * (`StageApi.setQuality`); this is what the next mount starts with. Storage
 * that cannot be written is ignored.
 */
export function setQualityPreference(quality: StageQuality): void {
  try {
    window.localStorage.setItem(QUALITY_PREF_KEY, quality);
  } catch {
    // Not stored; the default stands next time.
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

/**
 * Whether the 3D map can be offered to `role` on this device in this page
 * load, whatever the device is set to: it exists, the role gets it in this
 * phase, the browser has WebGL2, and it has not already failed here. The
 * renderer switch offers 3D only when this is true.
 */
export function offers3d(role: Role): boolean {
  return STAGE3D_BUILT && !failed3d && roleMay3d(role) && supportsWebGL2();
}

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
      return await load3d(opts, getQualityPreference(ctx.role));
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

/** The 3D stage: the only reference to `stage3d/` outside it, so three stays in its own lazy chunk. */
async function create3d(opts: StageOptions, hooks: Stage3DHooks): Promise<StageApi> {
  const { createStage } = await import('./stage3d/index.js');
  return createStage(opts, hooks);
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
 * `quality` is what the 3D stage starts at.
 */
async function load3d(opts: StageOptions, quality: StageQuality): Promise<StageApi> {
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
    console.warn(`[stage] the 3D map stopped (${reason}); switching to the classic map`);
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
        // The page kept updating while the classic chunk loaded: the stage
        // was made with the state as it stood then, so it gets the latest.
        classic.update(state);
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

  const inner = await create3d(opts, { onLost, quality });
  // A context lost while the stage was still starting has already sent the
  // classic stage in; the 3D one it would have been is not wanted.
  if (lost) inner.destroy();
  else current = inner;

  return {
    get renderer(): StageRenderer {
      return current !== null && current === inner ? '3d' : 'classic';
    },
    setQuality(q) {
      current?.setQuality?.(q);
    },
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
