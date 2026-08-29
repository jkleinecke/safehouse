/**
 * Pure projections from live/server state into what the stage draws
 * (no pixi, no DOM — unit-tested).
 *
 * Principle 4 note: this never *hides* anything the server sent. Hidden tokens
 * and GM-only combatants are filtered server-side; these helpers only decide
 * decoration (bars, pips, glow) and local interaction affordances (what this
 * device is allowed to try to drag — the server still rules on the move).
 */
import type {
  Combatant,
  DerivedCharacter,
  Encounter,
  Role,
  SheetV1,
  SheetWeapon,
  Token,
} from '@safehouse/contracts';
import { rangeModifier } from '@safehouse/rules';
import type { MovementThresholds, TokenBars } from './types.js';

export interface Viewer {
  role: Role;
  userId?: string | undefined;
  /** The character this device plays (from the join session). */
  characterId?: string | undefined;
}

export const isGm = (v: Viewer): boolean => v.role === 'gm';

/** Tokens this device may drag: GM anything, players their own (FR9.5). */
export function draggableTokenIds(tokens: readonly Token[], viewer: Viewer): Set<string> {
  const out = new Set<string>();
  if (isGm(viewer)) {
    for (const t of tokens) out.add(t.id);
    return out;
  }
  if (viewer.role !== 'player') return out; // observer / display: read-only
  if (!viewer.characterId) return out;
  for (const t of tokens) {
    if (t.source === 'character' && t.sourceId === viewer.characterId) out.add(t.id);
  }
  return out;
}

/** True when this viewer is allowed to see numeric bars on `token` (FR9.6). */
export function canSeeBars(token: Token, viewer: Viewer): boolean {
  if (isGm(viewer)) return true;
  if (token.barsVisibility === 'public') return true;
  if (token.barsVisibility === 'gm') return false;
  return token.source === 'character' && token.sourceId === viewer.characterId;
}

function combatantBars(c: Combatant): TokenBars {
  return {
    physical: { filled: c.monitors.physical.filled, max: c.monitors.physical.max },
    stun: { filled: c.monitors.stun.filled, max: c.monitors.stun.max },
    effectCount: c.effects.length,
  };
}

/**
 * tokenId → bars/pips, projected from the encounter the tracker owns (FR4.10).
 * Tokens whose bars this viewer may not see are simply absent from the map.
 */
export function barsByToken(
  encounter: Encounter | null,
  tokens: readonly Token[],
  viewer: Viewer,
): Map<string, TokenBars> {
  const out = new Map<string, TokenBars>();
  if (!encounter?.combatants) return out;
  const byId = new Map(tokens.map((t) => [t.id, t]));
  for (const c of encounter.combatants) {
    if (!c.tokenId) continue;
    const token = byId.get(c.tokenId);
    if (!token || !canSeeBars(token, viewer)) continue;
    out.set(c.tokenId, combatantBars(c));
  }
  return out;
}

/** The acting combatant's token gets the pulsing glow (FR9.10). */
export function actingTokenId(encounter: Encounter | null): string | null {
  if (!encounter?.activeCombatantId) return null;
  const active = encounter.combatants?.find((c) => c.id === encounter.activeCombatantId);
  return active?.tokenId ?? null;
}

// ---------------------------------------------------------------------------
// Ruler inputs (FR9.8 / FR9.9)
// ---------------------------------------------------------------------------

/** Walk/run metres per turn from the engine's derivation (never enforced). */
export function movementFrom(derived: DerivedCharacter | null | undefined): MovementThresholds | null {
  if (!derived) return null;
  const walkM = derived.movement.walk.value;
  const runM = derived.movement.run.value;
  if (!Number.isFinite(walkM) || walkM <= 0) return null;
  return { walkM, runM: Number.isFinite(runM) && runM > walkM ? runM : walkM };
}

export interface RangeReadout {
  /** 'short' | 'medium' | 'long' | 'extreme', or null past extreme range. */
  band: string | null;
  /** Pool modifier, 0 at short range. */
  value: number;
  label: string;
  /** Band edges in metres, for the HUD's little ladder. */
  edges: readonly number[] | null;
}

const BAND_FROM_ID = (id: string): string | null => id.split('.').pop() ?? null;

/**
 * Range band + modifier for a measured distance with a weapon selected.
 * Bands come from the sheet's own user-entered `rangeTables` (G6: no book
 * tables in code) via the rules engine, so provenance matches the server's.
 */
export function rangeReadout(
  distM: number,
  weapon: SheetWeapon | null,
  sheet: SheetV1 | null,
): RangeReadout | null {
  if (!weapon?.rangeCat || !sheet) return null;
  const edges = sheet.rangeTables[weapon.rangeCat] ?? null;
  if (!edges) {
    return { band: null, value: 0, label: `no range table for "${weapon.rangeCat}"`, edges: null };
  }
  const mod = rangeModifier(Math.round(distM), weapon.rangeCat, sheet.rangeTables);
  if (!mod) {
    return {
      band: null,
      value: 0,
      label: `beyond extreme range (${Math.round(distM)} m)`,
      edges,
    };
  }
  const band = BAND_FROM_ID(mod.id);
  return {
    band,
    value: mod.value,
    label: mod.note ?? `${band ?? 'range'} (${Math.round(distM)} m)`,
    edges,
  };
}

/** Ranged weapons on a sheet (the ruler's weapon picker). */
export function rangedWeapons(sheet: SheetV1 | null | undefined): SheetWeapon[] {
  if (!sheet) return [];
  return sheet.weapons.filter((w) => Boolean(w.rangeCat));
}

// ---------------------------------------------------------------------------
// Ephemeral "mark" classification (FR9.15)
// ---------------------------------------------------------------------------

export type MarkKind = 'ping' | 'pointer' | 'focus';

export interface MarkSample {
  x: number;
  y: number;
  ts: number;
  /**
   * The server's own label for the mark, carried through `live/store.ts` on
   * every `ping` / `pointer` ephemeral. Optional only so the cadence fallback
   * below stays reachable for a mark from an older server.
   */
  kind?: string;
}

/**
 * Decide how to render an incoming mark. With an explicit `kind` we honour it;
 * without one we fall back to a cadence heuristic: samples that arrive in a
 * fast stream near the previous one are a pointer trail, an isolated mark is a
 * ping flash.
 */
export function classifyMark(prev: MarkSample | null, next: MarkSample): MarkKind {
  if (next.kind === 'ping' || next.kind === 'pointer' || next.kind === 'focus') return next.kind;
  if (!prev) return 'ping';
  const dt = next.ts - prev.ts;
  const dist = Math.hypot(next.x - prev.x, next.y - prev.y);
  if (dt <= 260 && dist <= 6) return 'pointer';
  return 'ping';
}

/**
 * "Focus here" (FR9.15/FR9.21) read out of a PERSISTED event.
 *
 * The live wiring is the ephemeral one — `scene.focus` relays a ping-family
 * mark with `kind: 'focus'`, which `classifyMark` above reads. This is the
 * belt to that brace: if a deployment ever persists the gesture instead (as
 * `scene.focus`, or as a `display.updated` carrying `focus: {x, y}` so the TV
 * steers from the same event), the camera still follows.
 */
export function focusFromEvent(
  event: { type: string; payload: unknown },
  sceneId: string | null,
): { x: number; y: number } | null {
  if (event.type !== 'scene.focus' && event.type !== 'display.updated') return null;
  const payload =
    typeof event.payload === 'object' && event.payload !== null
      ? (event.payload as Record<string, unknown>)
      : {};
  const inner =
    typeof payload['focus'] === 'object' && payload['focus'] !== null
      ? (payload['focus'] as Record<string, unknown>)
      : payload;
  const x = inner['x'];
  const y = inner['y'];
  if (typeof x !== 'number' || typeof y !== 'number') return null;
  const target = payload['sceneId'] ?? inner['sceneId'];
  // A focus aimed at another scene is not for this canvas.
  if (typeof target === 'string' && sceneId && target !== sceneId) return null;
  return { x, y };
}
