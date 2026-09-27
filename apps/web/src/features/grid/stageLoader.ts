/**
 * The one place the map is mounted from.
 *
 * One renderer stands behind `StageApi`: the three.js stage
 * (`stage3d/index.ts`). The Grid (`useStage.ts`) and the TV (`tvStage.ts`)
 * both mount through `loadStage` and never import it themselves, so the
 * capability check and the quality a mount starts at live here and nowhere
 * else.
 *
 * three.js needs WebGL2, so `supportsWebGL2` is asked first. A browser
 * without it gets a plain error the page shows over the map, before the
 * three chunk is ever downloaded. There is no second renderer to fall back on
 * any more: the classic PixiJS map is gone, and with it the per-device
 * renderer switch.
 *
 * The 3D map's quality is this device's (`getQualityPreference`): Low on the
 * TV, always; for anyone else what the device was set to, else Low on a
 * phone or a tablet and Medium elsewhere. The loader hands it to the 3D
 * stage with the role it is for (`Stage3DHooks.quality`).
 *
 * And the page is told when a running map stops: its GPU context was lost,
 * a change could not be drawn, or a quality switch was refused a new context
 * (`StageStop`, through `StageLoadContext.onStopped`). It is told again when
 * a lost context comes back by itself (`onResumed`). What to do about a stop
 * is the page's call: the Grid shows a panel with a Reload map button, the
 * TV its "renderer unavailable" notice.
 *
 * The stage is reached only through a dynamic `import()`, so three stays in
 * its own lazy chunk (D9, `router.chunks.test.ts`).
 */
import type { Role } from '@safehouse/contracts';
import type { StageApi, StageOptions, StageQuality, StageStop } from './types.js';

export type { StageQuality, StageStop } from './types.js';

/** Who is mounting the map, and who to tell when it stops. */
export interface StageLoadContext {
  /** The role the map is drawn for; it picks the starting quality (`getQualityPreference`). */
  role: Role;
  /**
   * The running map stopped drawing (`StageStop`). Called once per stop; a
   * lost context that comes back is reported through `onResumed`.
   */
  onStopped?(stop: StageStop): void;
  /** A lost GPU context came back and the map is drawing again. */
  onResumed?(): void;
}

/**
 * What the loader hands the 3D stage besides its options. The 3D stage's
 * `createStage(opts, hooks)` takes this.
 */
export interface Stage3DHooks {
  /**
   * How the stage tells the page it has stopped drawing: its GPU context is
   * gone, a later change could not be built, or a quality switch was refused
   * a new context (`StageStop`). The stage is not destroyed; the page decides
   * whether to remount it.
   */
  onStopped(stop: StageStop): void;
  /** How the stage tells the page a lost GPU context came back and it is drawing again. */
  onResumed(): void;
  /**
   * The quality the 3D map starts at: this device's for the role mounting it
   * (`getQualityPreference`). Afterwards the page changes it on the live
   * stage (`StageApi.setQuality`).
   */
  quality: StageQuality;
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

function noop(): void {}

/**
 * Mount the map into `opts.host`. Rejects with a plain message the page can
 * show when this browser has no WebGL2 (asked before the three chunk is
 * fetched, so a browser that cannot draw it never downloads it) or when the
 * 3D stage throws while starting. There is nothing else to fall back on.
 *
 * Once it is running, the stage reports a stop and a recovery through
 * `ctx.onStopped` and `ctx.onResumed` (see `StageStop`); the page keeps the
 * handle either way and remounts only when asked to.
 */
export async function loadStage(opts: StageOptions, ctx: StageLoadContext): Promise<StageApi> {
  if (!supportsWebGL2()) {
    throw new Error('This browser cannot draw the map: WebGL2 is turned off or not supported.');
  }
  // The only reference to `stage3d/` outside it, so three stays in its own
  // lazy chunk (D9, `router.chunks.test.ts`).
  const { createStage } = await import('./stage3d/index.js');
  return createStage(opts, {
    quality: getQualityPreference(ctx.role),
    onStopped: ctx.onStopped ?? noop,
    onResumed: ctx.onResumed ?? noop,
  });
}
