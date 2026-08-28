/**
 * Grid feature UI state (zustand) — local to this client, never synced.
 * Live/shared state stays in src/live/store; server state in TanStack Query.
 */
import { create } from 'zustand';
import type { AoeTemplate, FogDraft, GridTool, RulerState, ScatterResult } from './types.js';

/** A situational modifier handed from the ruler to the next roll (FR9.9). */
export interface PendingRollMod {
  value: number;
  label: string;
  /** e.g. 'range' — matches Modifier.source.kind. */
  sourceKind: 'range';
  ts: number;
}

/**
 * Roll-modifier handoff: the dice/sheet feature reads this key (and/or the
 * CustomEvent) when building the next roll's pool.
 * INTEGRATION: contract with the dice-UI agent — localStorage key
 * `safehouse.pendingRollMod` + window event `safehouse:pending-roll-mod`.
 */
export const PENDING_ROLL_MOD_KEY = 'safehouse.pendingRollMod';
export const PENDING_ROLL_MOD_EVENT = 'safehouse:pending-roll-mod';

export function publishPendingRollMod(mod: PendingRollMod | null): void {
  try {
    if (mod) localStorage.setItem(PENDING_ROLL_MOD_KEY, JSON.stringify(mod));
    else localStorage.removeItem(PENDING_ROLL_MOD_KEY);
  } catch {
    // storage blocked — the in-memory store + event still work this session
  }
  try {
    window.dispatchEvent(new CustomEvent(PENDING_ROLL_MOD_EVENT, { detail: mod }));
  } catch {
    // non-DOM test environment
  }
}

/** GM authoring side-panel tabs (FR9.1/9.2/9.13/9.11). */
export type GmTab = 'scenes' | 'map' | 'tokens' | 'fog' | 'env';

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
  fogDraft: FogDraft | null;
  gmPanelOpen: boolean;
  gmTab: GmTab;
  /** GM only: view a non-active scene while staging (FR9.1). */
  viewSceneId: string | null;
  pendingRollMod: PendingRollMod | null;

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
  setViewSceneId: (id: string | null) => void;
  setPendingRollMod: (mod: PendingRollMod | null) => void;
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

  toggleSnap: () => set((s) => ({ snapEnabled: !s.snapEnabled })),
  setGmTab: (gmTab) => set({ gmTab }),

  setTool: (tool) =>
    set((s) => ({
      tool,
      // Leaving a drawing tool abandons its in-progress state.
      fogDraft: tool === 'fogdef' ? s.fogDraft : null,
      ruler: tool === 'ruler' ? s.ruler : null,
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
  setViewSceneId: (viewSceneId) => set({ viewSceneId }),
  setPendingRollMod: (pendingRollMod) => {
    publishPendingRollMod(pendingRollMod);
    set({ pendingRollMod });
  },
}));
