/**
 * Read-only ("display") adapter onto the Grid's PixiJS stage — the module the
 * table TV mounts (FR9.19–9.21). Shared, not forked: the TV must draw the map,
 * the grid, revealed fog, tokens, condition bars and the acting glow with
 * exactly the renderer the Grid uses, or "on our map, on the big screen" is a
 * lie the moment the two drift apart.
 *
 * What this module adds on top of `stage/index.ts` is *subtraction*:
 *
 * - every callback is a no-op and nothing may be dragged — a kiosk has zero
 *   controls, so the stage can raise nothing that reaches the wire (FR9.19);
 * - the role is pinned to `display`, so the stage's own gm-only branches
 *   (unrevealed fog as a tint, GM geometry, ghosted hidden tokens) are off;
 * - condition comes in at the only resolution a display is ever given — the
 *   coarse public band (FR4.9). The exact boxes never reach this device, so
 *   there is nothing here to accidentally paint.
 *
 * Secrecy note (Principle 4): nothing here hides anything. Hidden tokens,
 * unrevealed fog and GM-only combatants were filtered server-side before this
 * device saw a byte. This renders exactly what arrived.
 *
 * `pixi.js` is reached only through the dynamic import in `createTvStage`, so
 * the TV bundle keeps the same lazy-chunk shape as the Grid's (D9).
 */
import type { Role, Scene, Token } from '@safehouse/contracts';
import type { StageApi, StageCallbacks, StageSceneState, TokenBars } from './types.js';

/** The kiosk is a `display` device, always (FR9.19). */
export const TV_STAGE_ROLE: Role = 'display';

/** One frozen empty set — a display drags nothing, and never re-allocates. */
const NO_DRAGGABLE: ReadonlySet<string> = new Set<string>();
const NO_BARS: ReadonlyMap<string, TokenBars> = new Map<string, TokenBars>();

/** Coarse public condition (FR4.9) — the only detail a display device gets. */
export type TvConditionBand = 'fresh' | 'scratched' | 'wounded' | 'bloodied' | 'down';

export interface TvStageInput {
  scene: Scene;
  tokens: Token[];
  /** tokenId → coarse bars/pips. Absent tokens simply draw undecorated. */
  bars?: ReadonlyMap<string, TokenBars> | undefined;
  /** The acting combatant's token gets the pulsing glow (FR9.10). */
  actingTokenId?: string | null | undefined;
}

/**
 * Four pseudo-boxes standing in for a condition monitor. A display is told a
 * band, never a count, so the bar is a band meter wearing the monitor's clothes
 * — which is the honest rendering, not a lossy one.
 */
const BAND_FILL: Record<TvConditionBand, number> = {
  fresh: 0,
  scratched: 1,
  wounded: 2,
  bloodied: 3,
  down: 4,
};

/** Coarse band + status count → the `TokenBars` the stage already knows how to draw. */
export function coarseBars(band: TvConditionBand, effectCount = 0): TokenBars {
  return {
    physical: { filled: BAND_FILL[band], max: 4 },
    effectCount: Math.max(0, Math.floor(effectCount)),
  };
}

/**
 * Every stage callback, wired to nothing. Built once per stage, not per frame.
 * A kiosk that could emit a `token.move` would be a control surface sitting in
 * the open at the table — the one thing FR9.19 forbids.
 */
export function readOnlyStageCallbacks(): StageCallbacks {
  const noop = (): void => undefined;
  return {
    onTokenMove: noop,
    onTokenDrag: noop,
    onSelectToken: noop,
    onPing: noop,
    onPointer: noop,
    onRuler: noop,
    onDoorToggle: noop,
    onAoePlace: noop,
    onFogVertex: noop,
    onFocus: noop,
  };
}

/** Project the TV's world into the stage's frame state. Pure. */
export function tvStageState(input: TvStageInput): StageSceneState {
  return {
    scene: input.scene,
    tokens: input.tokens,
    role: TV_STAGE_ROLE,
    draggableIds: NO_DRAGGABLE,
    bars: input.bars ?? NO_BARS,
    actingTokenId: input.actingTokenId ?? null,
    selectedTokenId: null,
    tool: 'select',
    snapEnabled: true,
    aoe: null,
    scatter: null,
    fogDraft: null,
  };
}

// ---------------------------------------------------------------------------
// Map / token art loading
// ---------------------------------------------------------------------------

/**
 * The file store's URLs carry no file extension, which stops pixi picking a
 * texture parser and silently blanks every map and portrait. That was first
 * caught here, on the TV, but it was never a TV problem: `createStage` now
 * applies the same wrap for every stage (`stage/assetUrl.ts`), so the GM's
 * Grid and a player's phone are covered by the same line. Re-exported because
 * the wrap is idempotent and this module's tests own its behaviour.
 */
export { parserSafeUrlFor, TEXTURE_PARSER, type AssetRegistry } from './stage/assetUrl.js';

/** The imperative handle the TV keeps. Deliberately smaller than `StageApi`. */
export interface TvStageHandle {
  update(input: TvStageInput): void;
  /** Frame the whole scene (mount, scene change, viewport resize). */
  fit(): void;
  /** GM "focus here" drives the TV camera (FR9.21). */
  centerOn(x: number, y: number): void;
  destroy(): void;
}

export interface TvStageOptions {
  host: HTMLElement;
  input: TvStageInput;
  /** attachment id → URL (map images, token art). */
  urlFor(attachmentId: string): string;
}

/**
 * Mount the stage in read-only mode. The `import()` is the only reference to
 * the pixi subtree from the TV feature, so it stays in the Grid's lazy chunk.
 *
 * Every method is guarded by `alive`: the TV runs unattended for hours and a
 * late `update` after teardown (an in-flight fetch resolving into an unmounted
 * page) must be a no-op, not a crash on a wall-sized screen.
 */
export async function createTvStage(opts: TvStageOptions): Promise<TvStageHandle> {
  // The one reference to the pixi subtree from the TV feature (D9). The URL
  // parser wrap happens inside `createStage`, for every stage alike.
  const { createStage } = await import('./stage/index.js');
  const api: StageApi = await createStage({
    host: opts.host,
    state: tvStageState(opts.input),
    callbacks: readOnlyStageCallbacks(),
    urlFor: opts.urlFor,
  });

  let alive = true;
  return {
    update(input) {
      if (alive) api.update(tvStageState(input));
    },
    fit() {
      if (alive) api.fitScene();
    },
    centerOn(x, y) {
      if (alive) api.centerOn(x, y);
    },
    destroy() {
      if (!alive) return;
      alive = false;
      api.destroy();
    },
  };
}
