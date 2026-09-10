/**
 * Hydration logic for the Grid (LIVE-1).
 *
 * The canvas used to draw only what arrived over the WebSocket while it was
 * mounted: refresh the page mid-session and the map had no acting-token glow,
 * no condition bars and — until the first `scene.activated` — no scene at all.
 * Every one of those now comes from REST on mount, with live events merged on
 * top. These are the pure decisions; `useGridLive`/`api` do the fetching.
 */
import type { GeometrySelection } from './types.js';
import type { Encounter, Role, Scene, Token } from '@safehouse/contracts';
import { hiddenLayerTokenIds, layersOf } from './tokenLayers.js';
import {
  actingTokenId,
  barsByToken,
  draggableTokenIds,
  type Viewer,
} from './projection.js';
import type {
  AoeTemplate,
  CameraCone,
  FogDraft,
  GridTool,
  ScatterResult,
  ShroudState,
  StageSceneState,
} from './types.js';

// ---------------------------------------------------------------------------
// Which scene is on screen
// ---------------------------------------------------------------------------

export interface SceneChoiceInput {
  isGm: boolean;
  /** GM only: a scene staged privately for authoring (FR9.1). */
  viewSceneId: string | null;
  /** From `scene.activated` — null until one arrives (or on a cold mount). */
  liveActiveSceneId: string | null;
  /** `GET /api/campaigns/:id/scenes`, already role-filtered server-side. */
  scenes: readonly Scene[] | undefined;
}

export interface SceneChoice {
  /** The campaign's active scene, however we learned about it. */
  activeSceneId: string | null;
  /** The scene this client should render (staging overrides for the GM). */
  sceneId: string | null;
}

/**
 * The REST list is the cold-start source of truth: a player's list contains
 * exactly the active scene, and the GM's carries `state: 'active'` on it. The
 * live value wins once it exists, because it is how a mid-session activation
 * arrives.
 */
export function resolveSceneId(input: SceneChoiceInput): SceneChoice {
  const fromRest = input.scenes?.find((s) => s.state === 'active')?.id ?? null;
  const activeSceneId = input.liveActiveSceneId ?? fromRest;
  const staged = input.isGm ? input.viewSceneId : null;
  return { activeSceneId, sceneId: staged ?? activeSceneId };
}

// ---------------------------------------------------------------------------
// Which encounter drives the token decorations (FR9.10 / FR9.6)
// ---------------------------------------------------------------------------

/**
 * Pick the encounter whose combatants decorate this scene's tokens. A live
 * fight on THIS scene wins; then any live fight (the GM may have swapped the
 * map mid-fight); then a prep encounter staged against this scene.
 */
export function pickEncounterId(
  encounters: readonly Encounter[] | undefined,
  sceneId: string | null,
): string | null {
  if (!encounters || encounters.length === 0) return null;
  const liveHere = encounters.find((e) => e.state === 'live' && sceneId && e.sceneId === sceneId);
  if (liveHere) return liveHere.id;
  const anyLive = encounters.find((e) => e.state === 'live');
  if (anyLive) return anyLive.id;
  const prepHere = encounters.find((e) => e.state === 'prep' && sceneId && e.sceneId === sceneId);
  return prepHere?.id ?? null;
}

/**
 * Merge the REST snapshot with whatever the live store holds.
 *
 * The live object wins when it is the same fight — it is strictly newer. It
 * loses when it is a different fight or has no `combatants` array (some
 * `encounter.updated` payloads are header-only deltas), because dropping the
 * hydrated roster there is exactly the LIVE-1 bug.
 */
export function mergeEncounter(
  live: Encounter | null | undefined,
  rest: Encounter | null | undefined,
): Encounter | null {
  if (!live) return rest ?? null;
  if (!rest) return live;
  if (live.id !== rest.id) return live;
  if (live.combatants && live.combatants.length > 0) return live;
  return { ...rest, ...live, combatants: rest.combatants ?? live.combatants };
}

// ---------------------------------------------------------------------------
// GM display steering (FR9.21)
// ---------------------------------------------------------------------------

export interface DisplayState {
  blank: boolean;
  ribbon: boolean;
}

export const DEFAULT_DISPLAY: DisplayState = { blank: false, ribbon: true };

/**
 * The table's current steering state, read back out of the persisted
 * `display.updated` stream so the GM's console shows what the TV is actually
 * doing after a refresh — the same reduction `features/tv/feed.ts` runs, kept
 * local rather than imported so the two features stay independent.
 */
export function displayFromEvents(
  events: readonly { type: string; payload: unknown }[],
): DisplayState {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (!event || event.type !== 'display.updated') continue;
    const payload =
      typeof event.payload === 'object' && event.payload !== null
        ? (event.payload as Record<string, unknown>)
        : {};
    return { blank: payload['blank'] === true, ribbon: payload['ribbon'] !== false };
  }
  return DEFAULT_DISPLAY;
}

// ---------------------------------------------------------------------------
// The stage frame
// ---------------------------------------------------------------------------

export interface StageComposeInput {
  scene: Scene | null;
  tokens: readonly Token[];
  viewer: Viewer;
  encounter: Encounter | null;
  selectedTokenId: string | null;
  tool: GridTool;
  snapEnabled: boolean;
  aoe: AoeTemplate | null;
  scatter: ScatterResult | null;
  /** Shared polygon draft — fog regions and zones both author with it. */
  fogDraft: FogDraft | null;
  /** What the GM has picked for the inspector (docs/UX_MAP_BUILDER.md §3.2). */
  selection?: GeometrySelection | null;
  /** What each camera on this floor covers — GM only (FR9.23). */
  cameraCones?: readonly CameraCone[] | null;
  /** Cells outside the viewer's sightline, or null to draw no scrim. */
  shroud?: ShroudState | null;
  /** Which floor to draw (FR9.22). */
  level?: number;
}

/**
 * The tokens a viewer's canvas draws, given their sightline (FR9.16).
 *
 * A PLAYER whose own sightline is on sees only what their runner can see: a
 * guard behind a wall, a teammate down the corridor, a drone round the
 * corner — none of them is drawn until the runner has line of sight. Their
 * own token is always drawn; a runner does not lose sight of themself. A GM's
 * lens is a lens, not a limit, so the GM keeps every token on screen.
 *
 * Presentation, not secrecy: hidden tokens are stripped server-side and this
 * only decides what one device paints. The design note is in `useShroud`.
 */
export function tokensInSight(
  tokens: readonly Token[],
  viewer: Viewer,
  shroud: ShroudState | null,
): Token[] {
  if (shroud === null || shroud.gm) return [...tokens];
  return tokens.filter((t) => {
    if (t.source === 'character' && t.sourceId === viewer.characterId) return true;
    // Tokens sit on cell centres; the square they occupy is what the eye sees.
    return shroud.visible.has(`${Math.floor(t.x)},${Math.floor(t.y)}`);
  });
}

/**
 * Build one complete frame of stage state from server data alone. With zero
 * WebSocket traffic this still yields a drawable scene — tokens placed, bars
 * filled from the hydrated encounter, the acting token glowing.
 */
export function composeStageState(input: StageComposeInput): StageSceneState | null {
  const { scene } = input;
  if (!scene) return null;
  // ONE floor's tokens. The canvas draws one storey at a time, so a runner on
  // the catwalk must not also appear on the warehouse floor beneath it —
  // two copies of the same token in the same square is worse than none.
  //
  // A token with no level is on the ground, which is where every token was
  // before floors existed.
  const level = input.level ?? 0;
  const onFloor = input.tokens.filter((t) => (t.level ?? 0) === level);
  const role: Role = input.viewer.role;
  const tokens = tokensInSight(onFloor, input.viewer, input.shroud ?? null);
  return {
    scene,
    tokens,
    role,
    draggableIds: draggableTokenIds(tokens, input.viewer),
    bars: barsByToken(input.encounter, tokens, input.viewer),
    actingTokenId: actingTokenId(input.encounter),
    selectedTokenId: input.selectedTokenId,
    tool: input.tool,
    snapEnabled: input.snapEnabled,
    aoe: input.aoe,
    scatter: input.scatter,
    fogDraft: input.fogDraft,
    selection: input.selection ?? null,
    cameraCones: input.cameraCones ?? null,
    // A player's scene has no layers, so this is empty for them (FR9.26).
    hiddenLayerTokenIds: hiddenLayerTokenIds(layersOf(scene)),
    shroud: input.shroud ?? null,
    level: input.level ?? 0,
  };
}
