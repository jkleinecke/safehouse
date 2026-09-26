/**
 * Read-only ("display") adapter onto the Grid's map stage — the module the
 * table TV mounts (FR9.19–9.21). Shared, not forked: the TV must draw the map,
 * the grid, revealed fog, tokens, condition bars and the acting glow with
 * exactly the renderer the Grid uses, or "on our map, on the big screen" is a
 * lie the moment the two drift apart. Which renderer that is — the three.js
 * map, or the classic PixiJS one — is `loadStage`'s choice, as it is for the
 * Grid: 3D since P2, unless this device was set to Classic, has no WebGL2,
 * or the 3D map failed here (then the classic map takes its place).
 *
 * What this module adds on top of the stage is *subtraction*:
 *
 * - every callback is a no-op and nothing may be dragged — a kiosk has zero
 *   controls, so the stage can raise nothing that reaches the wire (FR9.19).
 *   The 3D stage goes further and puts no pointer listener on a display at
 *   all;
 * - the role is pinned to `display`, so the stage's own gm-only branches
 *   (unrevealed fog as a tint, GM geometry, the light-map wash, ghosted
 *   hidden tokens) are off;
 * - condition comes in at the only resolution a display is ever given — the
 *   coarse public band (FR4.9). The exact boxes never reach this device, so
 *   there is nothing here to accidentally paint.
 *
 * The one thing shaped by the renderer is which tokens go where
 * (`tvStageState`): the classic map is handed every token on the one floor
 * it paints, as it always was; the 3D map, which stands each token on its
 * own floor, is handed the floor in view's tokens and the ones seen below it,
 * as the Grid hands them over, on the floor the table is on.
 *
 * On the 3D map the TV works its GPU at Low, always (`getQualityPreference`
 * for the `display` role): a screen left on for hours, often driven by a
 * stick or the TV's own browser. It draws on demand — a frame when something
 * on the map changed or moved, none while the table is still — so an idle TV
 * draws nothing. There is no renderer or quality switch on the TV; a device
 * set to Classic (its own storage, as on any other) stays on Classic here.
 *
 * Secrecy note (Principle 4): nothing here hides anything. Hidden tokens,
 * unrevealed fog and GM-only combatants were filtered server-side before this
 * device saw a byte. This renders exactly what arrived.
 *
 * Both renderers are reached only through `loadStage`'s dynamic imports,
 * called from `createTvStage`, so the TV bundle keeps the same lazy-chunk
 * shape as the Grid's (D9).
 */
import type { Role, Scene, Token } from '@safehouse/contracts';
import { tokensBelow } from './hydration.js';
import { chooseRenderer, loadStage } from './stageLoader.js';
import type { StageApi, StageCallbacks, StageRenderer, StageSceneState, TokenBars } from './types.js';

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
  /**
   * Which floor to paint (FR9.22). Omitted, it follows the acting token — see
   * `tvFloor`, and `tvFloor3d` for the 3D map, which between fights follows
   * the runners. Passing 0 unconditionally is what left the wall screen
   * showing the warehouse while the GM's own canvas was up on the catwalk.
   */
  level?: number | undefined;
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

/**
 * Which floor the wall screen should paint (FR9.22).
 *
 * The TV has no controls and no GM sitting at it, so it has to infer this. It
 * follows whoever is ACTING: during a fight that is exactly the floor the
 * table is watching, and between fights it falls back to the ground, which is
 * where a scene with no floors above it lives anyway.
 *
 * The alternative — always the ground floor — is what it did before, and it
 * meant the GM stepped up to the catwalk, their canvas followed, and the
 * screen beside them carried on showing the warehouse. A split-level fight
 * still only shows one storey at a time; that is the projection's rule, not
 * this function's.
 */
export function tvFloor(
  tokens: readonly Token[],
  actingTokenId?: string | null | undefined,
): number {
  if (!actingTokenId) return 0;
  const acting = tokens.find((t) => t.id === actingTokenId);
  return acting?.level ?? 0;
}

/**
 * Which floor the 3D wall screen paints (FR9.22): the acting token's in a
 * fight (`tvFloor`), and between fights the floor the runners are on — the
 * one most of the player characters' tokens stand on, the lower of a tie,
 * the ground when there are none. The 3D map draws a floor's tokens on that
 * floor alone, so falling back to the ground would leave the party, up on
 * the catwalk between fights, off the screen altogether.
 */
export function tvFloor3d(
  tokens: readonly Token[],
  actingTokenId?: string | null | undefined,
): number {
  const acting = actingTokenId ? tokens.find((t) => t.id === actingTokenId) : undefined;
  if (acting) return acting.level ?? 0;
  const count = new Map<number, number>();
  for (const t of tokens) {
    if (t.source !== 'character') continue;
    const level = t.level ?? 0;
    count.set(level, (count.get(level) ?? 0) + 1);
  }
  let best = 0;
  let most = 0;
  for (const [level, n] of count) {
    if (n > most || (n === most && level < best)) {
      best = level;
      most = n;
    }
  }
  return best;
}

/**
 * Project the TV's world into the stage's frame state. Pure.
 *
 * For the classic map (the default) it is what the TV always drew: every
 * token it was handed, on the floor `tvFloor` picks. The 3D map stands each
 * token on its own floor, so it gets the Grid's shape instead
 * (`composeStageState`): the tokens on the floor in view (`tvFloor3d`), and
 * the ones seen below it through its open squares (`belowTokens`) — else a
 * runner on another floor than the one shown would simply vanish from the
 * screen.
 */
export function tvStageState(input: TvStageInput, renderer: StageRenderer = 'classic'): StageSceneState {
  const base: Omit<StageSceneState, 'tokens' | 'level'> = {
    scene: input.scene,
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
  if (renderer !== '3d') {
    return { ...base, tokens: input.tokens, level: input.level ?? tvFloor(input.tokens, input.actingTokenId) };
  }
  const level = input.level ?? tvFloor3d(input.tokens, input.actingTokenId);
  return {
    ...base,
    tokens: input.tokens.filter((t) => (t.level ?? 0) === level),
    belowTokens: tokensBelow(input.scene, input.tokens, level),
    level,
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

/**
 * The imperative handle the TV keeps. Deliberately smaller than `StageApi`:
 * no quality, no view mode, no tools — the TV has no controls.
 */
export interface TvStageHandle {
  update(input: TvStageInput): void;
  /**
   * Frame the whole scene (mount, scene change, a plan ⇄ iso flip). The
   * camera kind follows the scene's projection, which `TvPage` overrides
   * with this screen's own plan/iso choice before it gets here.
   */
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
 * Mount the stage in read-only mode. `loadStage` is the only way to a
 * renderer from the TV feature, and it reaches each by dynamic import, so the
 * TV bundle keeps the Grid's lazy-chunk shape.
 *
 * Every method is guarded by `alive`: the TV runs unattended for hours and a
 * late `update` after teardown (an in-flight fetch resolving into an unmounted
 * page) must be a no-op, not a crash on a wall-sized screen.
 */
export async function createTvStage(opts: TvStageOptions): Promise<TvStageHandle> {
  // The loader picks the renderer and, for 3D, the quality by role: a
  // `display` gets the 3D map at Low. The classic stage's URL parser wrap
  // happens inside its `createStage`. The first state is shaped for the
  // renderer the loader is about to pick; every later one for the renderer
  // actually drawing (`api.renderer`), which turns classic if the 3D map
  // cannot start or later goes.
  const api: StageApi = await loadStage(
    {
      host: opts.host,
      state: tvStageState(opts.input, chooseRenderer(TV_STAGE_ROLE)),
      callbacks: readOnlyStageCallbacks(),
      urlFor: opts.urlFor,
    },
    { role: TV_STAGE_ROLE },
  );

  let alive = true;
  return {
    update(input) {
      if (alive) api.update(tvStageState(input, api.renderer ?? 'classic'));
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
