/**
 * How far a token in a live fight can still move this Combat Turn: its walk
 * and run range, from where its turn started, for the map to draw
 * (`MovementRange`, `stage/fx.ts` `drawMovementRange`) and the HUD to read
 * out (`hud/PaceChip.tsx`).
 *
 * DISPLAY ONLY. Nothing reads this to stop, shorten or refuse a move: the GM
 * allows what the GM allows, and a player's runner is held only by walls
 * (`@safehouse/rules` `canWalk`), never by a budget.
 *
 * ## Whose range
 *
 * Only while the encounter is live, and only for a token in it: the token
 * picked on the map (pressing a token to drag it picks it), else the one
 * acting. A player sees their own runner's and nobody else's; the GM sees
 * any runner's. A token with no character sheet behind it (an NPC's or a
 * grunt's) has no walk or run on this page and draws none.
 *
 * ## From where
 *
 * Movement is per Combat Turn, so the range is measured from where the
 * token stood when it first acted this Combat Turn: remembered on this
 * device the moment it becomes the acting combatant, and kept through its
 * later passes, so after a move the range still shows what is left. A token
 * that has not acted yet this turn, or whose start this device did not see
 * (the page was opened mid-turn), is measured from where it stands.
 */
import { useEffect, useMemo, useState } from 'react';
import type { Encounter, Scene, Token } from '@safehouse/contracts';
import { deriveCharacter, walkReach } from '@safehouse/rules';
import { useCharacter } from '../sheet/api.js';
import { actingTokenId, movementFrom } from './projection.js';
import type { MovementRange } from './types.js';

/** Where a token stood when it first acted in one Combat Turn. */
interface TurnStart {
  /** `encounterId|turn`. */
  key: string;
  x: number;
  y: number;
  level: number;
}

export interface MovementRangeInput {
  scene: Scene | null;
  tokens: readonly Token[];
  encounter: Encounter | null;
  selectedTokenId: string | null;
  isGm: boolean;
  myCharacterId: string | null;
  /** Off while the GM is building. */
  enabled: boolean;
}

export interface MovementRangeResult {
  range: MovementRange | null;
  /** The sheet's metatype, for the Sprint note (dwarves and trolls sprint shorter). */
  metatype: string | null;
}

export function useMovementRange(p: MovementRangeInput): MovementRangeResult {
  const live = p.enabled && p.encounter?.state === 'live' ? p.encounter : null;
  const actingId = actingTokenId(live);
  const turnKey = live ? `${live.id}|${live.turn}` : null;

  // Remember where the acting token stood when it first acted this Combat Turn.
  const [starts, setStarts] = useState<ReadonlyMap<string, TurnStart>>(() => new Map());
  const acting = actingId ? p.tokens.find((t) => t.id === actingId) : undefined;
  useEffect(() => {
    if (turnKey === null || acting === undefined) return;
    setStarts((prev) => {
      if (prev.get(acting.id)?.key === turnKey) return prev;
      const out = new Map(prev);
      out.set(acting.id, { key: turnKey, x: acting.x, y: acting.y, level: acting.level ?? 0 });
      return out;
    });
  }, [turnKey, acting]);

  const token = useMemo(() => {
    if (!live) return null;
    const inFight = new Set((live.combatants ?? []).map((c) => c.tokenId).filter(Boolean));
    const shows = (t: Token | undefined): t is Token =>
      t !== undefined &&
      inFight.has(t.id) &&
      t.source === 'character' &&
      Boolean(t.sourceId) &&
      (p.isGm || t.sourceId === p.myCharacterId);
    const picked = p.tokens.find((t) => t.id === p.selectedTokenId);
    if (shows(picked)) return picked;
    const now = p.tokens.find((t) => t.id === actingId);
    return shows(now) ? now : null;
  }, [live, p.tokens, p.selectedTokenId, p.isGm, p.myCharacterId, actingId]);

  const character = useCharacter(token?.sourceId ?? null);
  const sheet = character.data?.sheet ?? null;
  const pace = useMemo(() => {
    if (!sheet) return null;
    try {
      return movementFrom(deriveCharacter(sheet));
    } catch {
      return null; // a half-entered sheet must never break the canvas
    }
  }, [sheet]);

  const level = token?.level ?? 0;
  const start = token ? starts.get(token.id) : undefined;
  const fromStart = start !== undefined && start.key === turnKey && start.level === level;
  const ox = fromStart ? start.x : token?.x;
  const oy = fromStart ? start.y : token?.y;
  const tokenId = token?.id ?? null;
  const walkM = pace?.walkM;
  const runM = pace?.runM;
  const scene = p.scene;

  const range = useMemo((): MovementRange | null => {
    if (!scene || tokenId === null || ox === undefined || oy === undefined) return null;
    if (walkM === undefined || runM === undefined) return null;
    const unitM = Math.max(0.01, scene.grid.unitM);
    const origin = { x: ox, y: oy };
    const cells = walkReach(scene, level, origin, Math.max(walkM, runM) / unitM);
    return { tokenId, origin, level, walkM, runM, cells };
  }, [scene, tokenId, level, ox, oy, walkM, runM]);

  return { range, metatype: range ? (sheet?.identity.metatype ?? null) : null };
}
