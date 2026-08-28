/**
 * Loose shapes for the JSON the playthrough reads back, plus the two tiny
 * folds every beat needs. These are deliberately NOT the contracts types: the
 * script asserts against what the wire actually carries, so a drifted DTO shows
 * up as a failed check rather than as a compile error.
 */
import type { Api, Checks, Live, Story } from './harness.js';

export type Dict = Record<string, unknown>;
export interface Entry {
  label: string;
  value: number;
  source?: string;
}
export interface RollResult {
  faces: number[];
  hits: number;
  ones: number;
  glitch: string;
  limitedHits: number;
  exploded?: number[];
}
export interface RollRecord {
  id: string;
  request: { pool: number; breakdown: Entry[]; limit?: { kind: string; value: number } };
  faces: number[];
  hits: number;
  ones: number;
  glitch: string;
  limitedHits: number;
}
export interface Monitors {
  physical: { max: number; filled: number };
  stun: { max: number; filled: number };
  overflow: { max: number; filled: number };
}
export interface Combatant {
  id: string;
  name: string;
  source: string;
  initBase: number;
  initDice: number;
  initScore: number;
  actedThisPass: boolean;
  visibility: string;
  monitors: Monitors;
  tokenId: string | null;
}
export interface TokenDto {
  id: string;
  name: string;
  x: number;
  y: number;
  hidden: boolean;
}
export interface SceneView {
  scene: { id: string; name: string; fog: { regions: { id: string; name: string }[] } };
  tokens: TokenDto[];
}
export interface Derived {
  derived: {
    initiative: { physical: { base: { value: number }; dice: { value: number } } };
    limits: { physical: { value: number } };
    pools: Record<string, { total: number; breakdown: Entry[] }>;
  };
  monitors: Monitors;
}

export const sum = (entries: Entry[]): number => entries.reduce((n, e) => n + e.value, 0);
export const sceneEntry = (b: Entry[]): Entry | undefined => b.find((e) => e.source === 'scene');
export const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
  Math.round(Math.hypot(a.x - b.x, a.y - b.y) * 10) / 10;


/** One player device: its phone, its socket, and the sheet it is holding. */
export interface Phone {
  api: Api;
  live: Live;
  userId: string;
  characterId: string;
}

/** The two outputs every beat writes into, plus the defect list. */
export interface Ctx {
  checks: Checks;
  story: Story;
  gaps: string[];
}
