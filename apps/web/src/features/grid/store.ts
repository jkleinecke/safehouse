/**
 * Grid feature UI state (zustand) — local to this client, never synced.
 * Live/shared state stays in src/live/store; server state in TanStack Query.
 */
import { create } from 'zustand';
import { TILESETS } from '@safehouse/rules';
import {
  PENDING_ROLL_MOD_EVENT,
  PENDING_ROLL_MOD_KEY,
  publishPendingRollMod,
  type PendingRollMod,
} from '../../live/rollHandoff.js';
import {
  GEOMETRY_TOOLS,
  type AoeTemplate,
  type FogDraft,
  type GridTool,
  type RulerState,
  type ScatterResult,
} from './types.js';

/**
 * The ruler → dice handoff (FR9.9) lives in `src/live/rollHandoff.ts`: a
 * localStorage key and a window event owned by neither feature, so the Grid
 * can publish a measured range modifier and the sheet's roll dialog can offer
 * it as a chip without either importing the other's store. Re-exported here
 * because the Grid is the publishing half.
 */
export {
  PENDING_ROLL_MOD_EVENT,
  PENDING_ROLL_MOD_KEY,
  publishPendingRollMod,
  type PendingRollMod,
};

/** GM authoring side-panel tabs (FR9.1/9.2/9.3/9.13/9.11/9.21). */
export type GmTab = 'scenes' | 'map' | 'tiles' | 'tokens' | 'geo' | 'pins' | 'fog' | 'env' | 'los'
  | 'tv';

/** GM steering of the table display (FR9.21) — mirrors the TV's `TvControls`. */
export interface DisplayControls {
  blank: boolean;
  ribbon: boolean;
}

export const DEFAULT_DISPLAY_CONTROLS: DisplayControls = { blank: false, ribbon: true };

/**
 * The set the paint tool opens on. Read from the catalogue rather than written
 * as a string literal in two files, which is what it was: renaming or
 * reordering the sets in `@safehouse/rules` left a default that the server
 * answers with 400 `unknown_tileset` on the very first stroke, while the
 * palette dropdown showed a set the brush was not actually using.
 */
export const DEFAULT_TILESET_ID: string = TILESETS[0]?.id ?? 'docklands';

export interface GridUiState {
  tool: GridTool;
  /** Grid snap on drop (FR9.5) — Shift bypasses it for one drag. */
  snapEnabled: boolean;
  selectedTokenId: string | null;
  /** Selected weapon name on the selected token's sheet (range bands, FR9.9). */
  selectedWeapon: string | null;
  ruler: RulerState | null;
  aoe: AoeTemplate | null;
  aoeRadiusM: number;
  scatter: ScatterResult | null;
  scatterDice: number;
  scatterNetHits: number;
  /** Tileset + tile the paint tool lays down (FR9.2). */
  tilesetId: string;
  /**
   * The pinned tile, or null for AUTO — the default. Null is not "nothing
   * selected": it is the GM asking the square to decide, which the placement
   * engine answers from the ground and the walls around it.
   */
  tileId: string | null;
  /** Which of the four palettes is open: Ground, Building, Interior, Decor. */
  tileCategory: 'ground' | 'building' | 'interior' | 'decoration';
  /**
   * GM only: whose sightline to draw on the canvas, or null for none.
   *
   * Defaults to null because a GM permanently limited to one token's view
   * cannot run the rest of the map. This is a lens they pick up and put down.
   */
  losTokenId: string | null;
  /**
   * Whether PLAYERS see their own character's sightline shroud.
   *
   * The GM's switch, because it changes the feel of a scene: illuminating for
   * a careful infiltration, unwanted noise in a straight brawl in one room.
   */
  losForPlayers: boolean;
  /**
   * The GM's cover ruling for the shot in hand, or null to let the map decide.
   *
   * Deliberately NOT persisted on the scene: it is a call about one exchange,
   * not a property of the terrain. A crate that stops being cover permanently
   * is an edit to the map, which the GM makes with the tile tools.
   */
  coverOverride: 'none' | 'partial' | 'full' | null;
  /** Shared polygon draft: fog regions (FR9.14) and zones (FR9.2). */
  fogDraft: FogDraft | null;
  gmPanelOpen: boolean;
  gmTab: GmTab;
  /** GM only: view a non-active scene while staging (FR9.1). */
  viewSceneId: string | null;
  pendingRollMod: PendingRollMod | null;
  /** Pin open in the pin editor (FR9.3) — also ringed on the canvas. */
  selectedPinId: string | null;
  /** Name/colour the zone tool will use for its next polygon. */
  zoneName: string;
  /** Last steering state the GM pushed to the TV (FR9.21), optimistic. */
  display: DisplayControls;

  setTool: (tool: GridTool) => void;
  setTilesetId: (tilesetId: string) => void;
  setTileId: (tileId: string | null) => void;
  setTileCategory: (category: 'ground' | 'building' | 'interior' | 'decoration') => void;
  setLosTokenId: (tokenId: string | null) => void;
  setLosForPlayers: (on: boolean) => void;
  setCoverOverride: (cover: 'none' | 'partial' | 'full' | null) => void;
  toggleSnap: () => void;
  setGmTab: (tab: GmTab) => void;
  selectToken: (id: string | null) => void;
  selectWeapon: (name: string | null) => void;
  setRuler: (ruler: RulerState | null) => void;
  setAoe: (aoe: AoeTemplate | null) => void;
  setAoeRadiusM: (r: number) => void;
  setScatter: (s: ScatterResult | null) => void;
  setScatterDice: (n: number) => void;
  setScatterNetHits: (n: number) => void;
  addFogVertex: (x: number, y: number) => void;
  clearFogDraft: () => void;
  toggleGmPanel: () => void;
  openGmPanel: () => void;
  setViewSceneId: (id: string | null) => void;
  setPendingRollMod: (mod: PendingRollMod | null) => void;
  selectPin: (id: string | null) => void;
  setZoneName: (name: string) => void;
  setDisplay: (patch: Partial<DisplayControls>) => void;
}

/**
 * Everything that changes when the active tool changes, in one place.
 *
 * `setTileId` adopts the paint tool as well as the tile — picking a tile IS
 * picking up the brush, and leaving that as two calls the caller had to
 * remember meant a palette click could select a tile the canvas would not
 * paint with. Sharing this keeps it from drifting from `setTool`.
 */
function toolPatch(
  s: GridUiState,
  tool: GridTool,
): Pick<GridUiState, 'tool' | 'fogDraft' | 'ruler' | 'selectedPinId'> {
  return {
    tool,
    // Leaving a polygon tool abandons its in-progress draft; fog and zones
    // share one draft, so staying inside that pair keeps the vertices.
    fogDraft: tool === 'fogdef' || tool === 'zone' ? s.fogDraft : null,
    ruler: tool === 'ruler' ? s.ruler : null,
    // Leaving authoring entirely drops the pin ring off the canvas; the
    // select tool keeps it, because that is how a pin is opened.
    selectedPinId: tool === 'select' || GEOMETRY_TOOLS.includes(tool) ? s.selectedPinId : null,
  };
}

export const useGridStore = create<GridUiState>()((set) => ({
  tool: 'select',
  tilesetId: DEFAULT_TILESET_ID,
  tileId: null,
  tileCategory: 'ground',
  losTokenId: null,
  losForPlayers: false,
  coverOverride: null,
  snapEnabled: true,
  selectedTokenId: null,
  selectedWeapon: null,
  ruler: null,
  aoe: null,
  aoeRadiusM: 6,
  scatter: null,
  scatterDice: 2,
  scatterNetHits: 0,
  fogDraft: null,
  gmPanelOpen: true,
  gmTab: 'scenes',
  viewSceneId: null,
  pendingRollMod: null,
  selectedPinId: null,
  zoneName: '',
  display: DEFAULT_DISPLAY_CONTROLS,

  toggleSnap: () => set((s) => ({ snapEnabled: !s.snapEnabled })),
  setGmTab: (gmTab) => set({ gmTab }),

  // A tile id only means anything inside its own set, so changing sets drops
  // the selection rather than carrying an id the new set may not have.
  setTilesetId: (tilesetId) => set({ tilesetId, tileId: null }),
  // Picking a NAMED tile picks up the brush; clearing the selection does not
  // touch the tool. Those are different acts: the GM mid-erase whose selection
  // is cleared (switching set, switching tool) must stay erasing rather than
  // be silently handed a paintbrush. The "Auto" button arms the brush itself,
  // where the intent to paint is explicit.
  setTileId: (tileId) =>
    set((s) => (tileId === null ? { tileId } : { tileId, ...toolPatch(s, 'tile') })),
  // Switching tool drops the pinned tile back to Auto: an id from the Ground
  // palette means nothing under Decor, and carrying it would silently paint
  // the wrong thing on the first click.
  // A cover ruling is about one pair of tokens, so changing either end drops
  // it. Carrying it over would silently apply "no cover" to a different shot.
  setLosTokenId: (losTokenId) => set({ losTokenId, coverOverride: null }),
  setLosForPlayers: (losForPlayers) => set({ losForPlayers }),
  setCoverOverride: (coverOverride) => set({ coverOverride }),
  setTileCategory: (tileCategory) =>
    set((s) => ({ tileCategory, tileId: null, ...toolPatch(s, 'tile') })),
  setTool: (tool) => set((s) => toolPatch(s, tool)),
  selectToken: (selectedTokenId) =>
    set({ selectedTokenId, selectedWeapon: null, coverOverride: null }),
  selectWeapon: (selectedWeapon) => set({ selectedWeapon }),
  setRuler: (ruler) => set({ ruler }),
  setAoe: (aoe) => set({ aoe, scatter: null }),
  setAoeRadiusM: (aoeRadiusM) => set({ aoeRadiusM: Math.max(0.5, aoeRadiusM) }),
  setScatter: (scatter) => set({ scatter }),
  setScatterDice: (n) => set({ scatterDice: Math.max(1, Math.min(6, Math.floor(n))) }),
  setScatterNetHits: (n) => set({ scatterNetHits: Math.max(0, Math.floor(n)) }),
  addFogVertex: (x, y) =>
    set((s) => ({ fogDraft: { points: [...(s.fogDraft?.points ?? []), { x, y }] } })),
  clearFogDraft: () => set({ fogDraft: null }),
  toggleGmPanel: () => set((s) => ({ gmPanelOpen: !s.gmPanelOpen })),
  openGmPanel: () => set({ gmPanelOpen: true }),
  setViewSceneId: (viewSceneId) => set({ viewSceneId }),
  setPendingRollMod: (pendingRollMod) => {
    publishPendingRollMod(pendingRollMod);
    set({ pendingRollMod });
  },
  selectPin: (selectedPinId) => set({ selectedPinId }),
  setZoneName: (zoneName) => set({ zoneName }),
  setDisplay: (patch) => set((s) => ({ display: { ...s.display, ...patch } })),
}));
