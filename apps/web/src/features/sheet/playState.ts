/**
 * Client-local play state for the sheet: per-weapon progressive recoil
 * counters (FR3.4 — clears per the recoil rules, one tap to reset) and the
 * remembered tab per character. Session-local by design; the server owns
 * everything that must survive a reload.
 */
import { create } from 'zustand';

export type SheetTab =
  | 'skills'
  | 'combat'
  | 'magic'
  | 'gear'
  | 'contacts'
  | 'background'
  | 'ledger';

export const SHEET_TABS: { id: SheetTab; label: string }[] = [
  { id: 'skills', label: 'Skills' },
  { id: 'combat', label: 'Combat' },
  { id: 'magic', label: 'Magic' },
  { id: 'gear', label: 'Gear' },
  // FR3.2's little black book, finally wired to a route that exists.
  { id: 'contacts', label: 'Contacts' },
  { id: 'background', label: 'Background' },
  { id: 'ledger', label: 'Ledger' },
];

export function isSheetTab(value: unknown): value is SheetTab {
  return SHEET_TABS.some((t) => t.id === value);
}

export const recoilKey = (characterId: string, weaponName: string): string =>
  `${characterId}:${weaponName}`;

/**
 * Second attribute the caster soaks Drain with (FR8.1 "the tradition's
 * attributes"). SheetV1 (§9.3) carries no tradition field, so the pick is
 * remembered per character for the session and shown in the cast dialog —
 * asked once rather than every cast, and never silently assumed, because
 * Drain resisted with the wrong attribute is a wrong number that looks right.
 */
export type DrainAttr = 'cha' | 'log' | 'int' | 'wil';

interface SheetPlayState {
  /** Cumulative rounds fired this turn, by `${characterId}:${weapon}`. */
  recoil: Record<string, number>;
  tab: Record<string, SheetTab>;
  drainAttr: Record<string, DrainAttr>;
  bumpRecoil: (key: string, bullets: number) => void;
  resetRecoil: (key: string) => void;
  setTab: (characterId: string, tab: SheetTab) => void;
  setDrainAttr: (characterId: string, attr: DrainAttr) => void;
}

export const useSheetPlayStore = create<SheetPlayState>()((set) => ({
  recoil: {},
  tab: {},
  drainAttr: {},
  bumpRecoil: (key, bullets) =>
    set((s) => ({
      recoil: { ...s.recoil, [key]: (s.recoil[key] ?? 0) + Math.max(0, bullets) },
    })),
  resetRecoil: (key) =>
    set((s) => {
      const recoil = { ...s.recoil };
      delete recoil[key];
      return { recoil };
    }),
  setTab: (characterId, tab) => set((s) => ({ tab: { ...s.tab, [characterId]: tab } })),
  setDrainAttr: (characterId, attr) =>
    set((s) => ({ drainAttr: { ...s.drainAttr, [characterId]: attr } })),
}));
