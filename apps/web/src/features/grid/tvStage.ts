/**
 * Read-only ("display") adapter onto the Grid's map stage — the module the
 * table TV mounts (FR9.19–9.21). Shared, not forked: the TV must draw the map,
 * the grid, revealed fog, tokens, condition bars and the acting glow with
 * exactly the renderer the Grid uses, or "on our map, on the big screen" is a
 * lie the moment the two drift apart. It mounts through `loadStage`, as the
 * Grid does, and gets the same three.js map.
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
 * What it does add is which tokens go where (`tvStageState`): the map stands
 * each token on its own floor, so it is handed the floor in view's tokens and
 * the ones seen below it, as the Grid hands them over, on the floor the table
 * is on (`tvFloor3d`).
 *
 * The TV works its GPU at Low, always (`getQualityPreference` for the
 * `display` role): a screen left on for hours, often driven by a stick or the
 * TV's own browser. It draws on demand — a frame when something on the map
 * changed or moved, none while the table is still — so an idle TV draws
 * nothing. There is no quality switch on the TV.
 *
 * When the map stops drawing (its GPU context lost, a change it could not
 * draw) the TV page hears of it (`TvStageOptions.onStopped`) and puts its
 * notice up; a lost context that comes back takes it down (`onResumed`).
 *
 * Secrecy note (Principle 4): nothing here hides anything. Hidden tokens,
 * unrevealed fog and GM-only combatants were filtered server-side before this
 * device saw a byte. This renders exactly what arrived.
 *
 * The stage is reached only through `loadStage`'s dynamic import, called from
 * `createTvStage`, so the TV bundle keeps the same lazy-chunk shape as the
 * Grid's (D9).
 */
import type { Role, Scene, Token } from '@safehouse/contracts';
import { tokensBelow } from './hydration.js';
import { loadStage } from './stageLoader.js';
import type { StageApi, StageCallbacks, StageSceneState, StageStop, TokenBars } from './types.js';

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
   * Which floor to paint (FR9.22). Omitted, it follows the acting token, and
   * between fights the runners — see `tvFloor3d`. Passing 0 unconditionally
   * is what left the wall screen showing the warehouse while the GM's own
   * canvas was up on the catwalk.
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
 * Which floor the wall screen paints (FR9.22).
 *
 * The TV has no controls and no GM sitting at it, so it has to infer this. It
 * follows whoever is ACTING: during a fight that is exactly the floor the
 * table is watching. The alternative — always the ground floor — is what it
 * did once, and it meant the GM stepped up to the catwalk, their canvas
 * followed, and the screen beside them carried on showing the warehouse. A
 * split-level fight still only shows one floor in view at a time; that is
 * the map's rule, not this function's.
 *
 * Between fights it follows the runners: the floor most of the player
 * characters' tokens stand on, the lower of a tie, the ground when there are
 * none. The map draws a floor's tokens on that floor alone, so falling back
 * to the ground would leave the party, up on the catwalk between fights, off
 * the screen altogether.
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
 * The map stands each token on its own floor, so it gets the Grid's shape
 * (`composeStageState`): the tokens on the floor in view (`tvFloor3d`), and
 * the ones seen below it through its open squares (`belowTokens`) — else a
 * runner on another floor than the one shown would simply vanish from the
 * screen.
 */
export function tvStageState(input: TvStageInput): StageSceneState {
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
  const level = input.level ?? tvFloor3d(input.tokens, input.actingTokenId);
  return {
    ...base,
    tokens: input.tokens.filter((t) => (t.level ?? 0) === level),
    belowTokens: tokensBelow(input.scene, input.tokens, level),
    level,
  };
}

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
  /**
   * The map stopped drawing (`StageStop`): the TV page shows its notice. Once
   * per stop; nothing restarts the stage from here.
   */
  onStopped?(stop: StageStop): void;
  /** A lost GPU context came back and the map is drawing again: the notice comes down. */
  onResumed?(): void;
}

/**
 * Mount the stage in read-only mode. `loadStage` is the only way to the map
 * from the TV feature, and it reaches it by dynamic import, so the TV bundle
 * keeps the Grid's lazy-chunk shape. Rejects when the map cannot start (no
 * WebGL2, or its first build failed).
 *
 * Every method is guarded by `alive`: the TV runs unattended for hours and a
 * late `update` after teardown (an in-flight fetch resolving into an unmounted
 * page) must be a no-op, not a crash on a wall-sized screen.
 */
export async function createTvStage(opts: TvStageOptions): Promise<TvStageHandle> {
  // The loader picks the quality by role: a `display` gets the map at Low.
  // A stop and a recovery go straight to the page, which owns the notice.
  const api: StageApi = await loadStage(
    {
      host: opts.host,
      state: tvStageState(opts.input),
      callbacks: readOnlyStageCallbacks(),
      urlFor: opts.urlFor,
    },
    { role: TV_STAGE_ROLE, onStopped: opts.onStopped, onResumed: opts.onResumed },
  );

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
