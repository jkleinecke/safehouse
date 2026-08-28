/**
 * Grid feature shared types (DESIGN.md M9 P2). Pure TS — no pixi imports here
 * so the main bundle stays lean; the stage subtree is loaded lazily.
 */
import type { Point, Role, Scene, Token } from '@safehouse/contracts';

/** Active pointer tool on the canvas. */
export type GridTool =
  | 'select' // move tokens / toggle doors (GM) / pan
  | 'ruler' // click-drag measurement (FR9.8/9.9)
  | 'aoe' // place AoE circle template (FR9.12)
  | 'pointer' // pointer trail broadcast (FR9.15)
  | 'fogdef' // GM: click vertices to define a named fog region (FR9.14)
  | 'focus'; // GM: next click broadcasts "focus here" (FR9.15)

/** Live ruler measurement, reported by the stage to the DOM readout. */
export interface RulerState {
  /** Grid-unit coordinates. */
  from: Point;
  to: Point;
  /** Distance in meters (grid distance × unitM). */
  meters: number;
  /** Token the measurement started on (movement thresholds come from it). */
  fromTokenId: string | null;
}

/** Walk/run thresholds in meters for the measuring token (engine-derived). */
export interface MovementThresholds {
  walkM: number;
  runM: number;
}

/** AoE circle template (FR9.12). Position in grid units, radius in meters. */
export interface AoeTemplate {
  center: Point;
  radiusM: number;
}

/** Grenade scatter render state (FR9.12) — cosmetic, client-rolled. */
export interface ScatterResult {
  /** Where the template was aimed (grid units). */
  from: Point;
  /** Where it landed after scatter (grid units). */
  to: Point;
  meters: number;
  /** Human line, e.g. "2d6 → 7 − 3 net hits = 4 m NE". */
  summary: string;
}

/** In-progress fog polygon definition (grid units). */
export interface FogDraft {
  points: Point[];
}

/** Condition/status decorations for a token, projected from the encounter. */
export interface TokenBars {
  physical?: { filled: number; max: number };
  stun?: { filled: number; max: number };
  /** Number of active status effects → pips (FR9.6/FR4.7). */
  effectCount: number;
}

/** Everything the pixi stage needs to (re)draw a frame of scene state. */
export interface StageSceneState {
  scene: Scene;
  tokens: Token[];
  role: Role;
  /** Token ids this client may drag (own tokens; GM: all) — FR9.5. */
  draggableIds: ReadonlySet<string>;
  /** tokenId → bars/pips projection (FR9.6). */
  bars: ReadonlyMap<string, TokenBars>;
  /** Token with the acting-combatant glow (FR9.10). */
  actingTokenId: string | null;
  selectedTokenId: string | null;
  tool: GridTool;
  /** Grid snap on drop (FR9.5, toggleable; hold Shift for a one-off bypass). */
  snapEnabled: boolean;
  aoe: AoeTemplate | null;
  scatter: ScatterResult | null;
  fogDraft: FogDraft | null;
}

/** Callbacks the stage raises back into React land. */
export interface StageCallbacks {
  /** Final drop position (grid units) → WS `token.move` (FR9.5). */
  onTokenMove(tokenId: string, x: number, y: number): void;
  /** Interim drag position, already throttled ~12Hz → WS `token.drag`. */
  onTokenDrag(tokenId: string, x: number, y: number): void;
  onSelectToken(tokenId: string | null): void;
  /** Double-tap flash (FR9.15) — grid units. */
  onPing(x: number, y: number): void;
  /** Pointer-trail sample, throttled — grid units. */
  onPointer(x: number, y: number): void;
  /** Ruler changed (null = measurement ended). */
  onRuler(ruler: RulerState | null): void;
  /** GM clicked a door with the select tool. */
  onDoorToggle(doorId: string): void;
  /** AoE tool click (grid units). */
  onAoePlace(x: number, y: number): void;
  /** fogdef tool click — append a vertex (grid units). */
  onFogVertex(x: number, y: number): void;
  /** focus tool click — broadcast "focus here" (grid units). */
  onFocus(x: number, y: number): void;
}

/** Imperative API of the lazily-loaded pixi stage. */
export interface StageApi {
  update(state: StageSceneState): void;
  /** Interim remote drag ghosts: tokenId → grid position (+ relay timestamp). */
  setDrags(drags: Record<string, { x: number; y: number; ts?: number }>): void;
  /** Flash a ping at grid coords (remote or local echo). */
  flashPing(x: number, y: number): void;
  /** Add a pointer-trail sample at grid coords. */
  trail(x: number, y: number): void;
  /** Movement thresholds for the token currently measured from. */
  setRulerThresholds(t: MovementThresholds | null): void;
  /** Clear the on-canvas measurement line. */
  clearRuler(): void;
  /** Recenter the camera on grid coords ("focus here", scene open). */
  centerOn(x: number, y: number): void;
  /** Zoom about the viewport centre (HUD buttons). */
  zoomBy(factor: number): void;
  /** Frame the whole scene. */
  fitScene(): void;
  destroy(): void;
}

/** Options for the lazily-imported stage factory. */
export interface StageOptions {
  host: HTMLElement;
  state: StageSceneState;
  callbacks: StageCallbacks;
  /** attachment id → URL (map images, token art). */
  urlFor(attachmentId: string): string;
}
