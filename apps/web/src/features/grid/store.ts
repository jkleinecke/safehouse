/**
 * Grid feature UI state (zustand) — local to this client, never synced.
 * Live/shared state stays in src/live/store; server state in TanStack Query.
 */
import { create } from 'zustand';
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
export type GmTab = 'scenes' | 'map' | 'tokens' | 'geo' | 'pins' | 'fog' | 'env' | 'tv';

/** GM steering of the table display (FR9.21) — mirrors the TV's `TvControls`. */
export interface DisplayControls {
  blank: boolean;
  ribbon: boolean;
}

export const DEFAULT_DISPLAY_CONTROLS: DisplayControls = { blank: false, ribbon: true };

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

export const useGridStore = create<GridUiState>()((set) => ({
  tool: 'select',
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

  setTool: (tool) =>
    set((s) => ({
      tool,
      // Leaving a polygon tool abandons its in-progress draft; fog and zones
      // share one draft, so staying inside that pair keeps the vertices.
      fogDraft: tool === 'fogdef' || tool === 'zone' ? s.fogDraft : null,
      ruler: tool === 'ruler' ? s.ruler : null,
      // Leaving authoring entirely drops the pin ring off the canvas; the
      // select tool keeps it, because that is how a pin is opened.
      selectedPinId:
        tool === 'select' || GEOMETRY_TOOLS.includes(tool) ? s.selectedPinId : null,
    })),
  selectToken: (selectedTokenId) => set({ selectedTokenId, selectedWeapon: null }),
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
