/**
 * Untrusted input → validated roll intent (DESIGN.md §10.1, §13 capability
 * matrix). Everything here is pure: schema validation, the role gate, and the
 * small folds the service needs. Nothing in this file touches the db, the hub,
 * or the RNG — which is what makes the authorization rules easy to read.
 */
import {
  ModifierSchema,
  RollRequestSchema,
  SheetV1Schema,
  type Glitch,
  type Modifier,
  type RollRequest,
  type RollResult,
  type SheetV1,
  type Visibility,
} from '@safehouse/contracts';
import { httpError } from './auth.js';
import type { RollViewer } from './roll-log.js';

const GLITCH_RANK: Record<Glitch, number> = { none: 0, glitch: 1, critical: 2 };

export function parseRequest(input: unknown): RollRequest {
  const parsed = RollRequestSchema.safeParse(
    typeof input === 'object' && input !== null ? input : {},
  );
  if (!parsed.success) {
    throw httpError(400, 'bad_request', 'invalid roll request', parsed.error.issues);
  }
  return parsed.data;
}

/** §13: GM and players roll; observers and the table display never do. */
export function assertMayRoll(viewer: RollViewer, visibility: Visibility): void {
  if (viewer.role !== 'gm' && viewer.role !== 'player') {
    throw httpError(403, 'forbidden', 'observers may not roll');
  }
  if (visibility === 'gm' && viewer.role !== 'gm') {
    throw httpError(403, 'forbidden', 'only the GM rolls behind the screen');
  }
}

export function parseSheet(raw: unknown): SheetV1 {
  const parsed = SheetV1Schema.safeParse(raw);
  if (!parsed.success) {
    throw httpError(422, 'bad_sheet', 'character sheet does not validate', parsed.error.issues);
  }
  return parsed.data;
}

/**
 * Situational chips the client sent with the roll (the scene's "dim light −1",
 * a GM's ad-hoc penalty). Invalid entries are dropped rather than fatal; what
 * survives lands in the stored breakdown, so every die is accounted for.
 */
export function parseModifiers(raw: unknown): Modifier[] {
  if (!Array.isArray(raw)) return [];
  const mods: Modifier[] = [];
  for (const item of raw) {
    const parsed = ModifierSchema.safeParse(item);
    if (parsed.success) mods.push(parsed.data);
  }
  return mods;
}

export function parseWounds(raw: unknown): { physical: number; stun: number } | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const w = raw as { physical?: unknown; stun?: unknown };
  const physical = typeof w.physical === 'number' ? Math.max(0, Math.floor(w.physical)) : 0;
  const stun = typeof w.stun === 'number' ? Math.max(0, Math.floor(w.stun)) : 0;
  if (physical === 0 && stun === 0) return null;
  return { physical, stun };
}

export function numberFrom(raw: unknown, fallback: number): number {
  return typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : fallback;
}

/** Fold an extended test's intervals into one persisted result row (FR2.5). */
export function aggregate(list: readonly RollResult[], totalHits: number): RollResult {
  let glitch: Glitch = 'none';
  const faces: number[] = [];
  let hits = 0;
  let ones = 0;
  for (const r of list) {
    faces.push(...r.faces);
    hits += r.hits;
    ones += r.ones;
    if (GLITCH_RANK[r.glitch] > GLITCH_RANK[glitch]) glitch = r.glitch;
  }
  return { faces, hits, ones, glitch, limitedHits: totalHits };
}
