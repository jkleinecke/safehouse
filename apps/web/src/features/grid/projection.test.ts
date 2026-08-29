import { describe, expect, it } from 'vitest';
import type { Combatant, Encounter, SheetV1, SheetWeapon, Token } from '@safehouse/contracts';
import {
  actingTokenId,
  barsByToken,
  canSeeBars,
  classifyMark,
  draggableTokenIds,
  focusFromEvent,
  movementFrom,
  rangeReadout,
  rangedWeapons,
  type Viewer,
} from './projection.js';

function token(over: Partial<Token> & { id: string }): Token {
  return {
    sceneId: 'sc1',
    source: 'character',
    sourceId: null,
    name: over.id,
    x: 0,
    y: 0,
    size: 1,
    rotation: 0,
    hidden: false,
    barsVisibility: 'owner',
    ...over,
  };
}

function combatant(over: Partial<Combatant> & { id: string }): Combatant {
  return {
    encounterId: 'e1',
    source: 'manual',
    name: over.id,
    initBase: 0,
    initDice: 1,
    initScore: 0,
    initKind: 'physical',
    monitors: {
      physical: { max: 10, filled: 3 },
      stun: { max: 10, filled: 1 },
      overflow: { max: 3, filled: 0 },
    },
    effects: [],
    visibility: 'public',
    actedThisPass: false,
    ...over,
  };
}

const gm: Viewer = { role: 'gm' };
const player: Viewer = { role: 'player', characterId: 'char-a' };
const display: Viewer = { role: 'display' };

describe('draggableTokenIds', () => {
  const tokens = [
    token({ id: 't1', source: 'character', sourceId: 'char-a' }),
    token({ id: 't2', source: 'character', sourceId: 'char-b' }),
    token({ id: 't3', source: 'prop' }),
  ];

  it('lets the GM drag anything', () => {
    expect([...draggableTokenIds(tokens, gm)].sort()).toEqual(['t1', 't2', 't3']);
  });

  it('lets a player drag only their own token', () => {
    expect([...draggableTokenIds(tokens, player)]).toEqual(['t1']);
  });

  it('gives display and observer devices nothing', () => {
    expect(draggableTokenIds(tokens, display).size).toBe(0);
    expect(draggableTokenIds(tokens, { role: 'observer' }).size).toBe(0);
  });

  it('gives a player with no bound character nothing', () => {
    expect(draggableTokenIds(tokens, { role: 'player' }).size).toBe(0);
  });
});

describe('canSeeBars', () => {
  it('shows the GM everything', () => {
    expect(canSeeBars(token({ id: 't', barsVisibility: 'gm' }), gm)).toBe(true);
  });

  it('hides gm-only bars from players', () => {
    expect(canSeeBars(token({ id: 't', barsVisibility: 'gm' }), player)).toBe(false);
  });

  it('shows public bars to everyone', () => {
    expect(canSeeBars(token({ id: 't', barsVisibility: 'public' }), player)).toBe(true);
    expect(canSeeBars(token({ id: 't', barsVisibility: 'public' }), display)).toBe(true);
  });

  it('shows owner bars only to the owner', () => {
    const own = token({ id: 't', barsVisibility: 'owner', sourceId: 'char-a' });
    const other = token({ id: 'u', barsVisibility: 'owner', sourceId: 'char-b' });
    expect(canSeeBars(own, player)).toBe(true);
    expect(canSeeBars(other, player)).toBe(false);
  });
});

describe('barsByToken / actingTokenId', () => {
  const tokens = [
    token({ id: 't1', sourceId: 'char-a', barsVisibility: 'owner' }),
    token({ id: 't2', sourceId: 'char-b', barsVisibility: 'gm' }),
  ];
  const encounter: Encounter = {
    id: 'e1',
    campaignId: 'c1',
    name: 'raid',
    state: 'live',
    turn: 1,
    pass: 1,
    activeCombatantId: 'c2',
    combatants: [
      combatant({ id: 'c1', tokenId: 't1', effects: [] }),
      combatant({ id: 'c2', tokenId: 't2' }),
    ],
  };

  it('projects monitors and effect counts for the GM', () => {
    const bars = barsByToken(encounter, tokens, gm);
    expect(bars.size).toBe(2);
    expect(bars.get('t1')).toEqual({
      physical: { filled: 3, max: 10 },
      stun: { filled: 1, max: 10 },
      effectCount: 0,
    });
  });

  it('omits tokens whose bars the player may not see', () => {
    const bars = barsByToken(encounter, tokens, player);
    expect([...bars.keys()]).toEqual(['t1']);
  });

  it('resolves the acting combatant to its token', () => {
    expect(actingTokenId(encounter)).toBe('t2');
    expect(actingTokenId(null)).toBeNull();
    expect(actingTokenId({ ...encounter, activeCombatantId: null })).toBeNull();
  });

  it('is empty without an encounter', () => {
    expect(barsByToken(null, tokens, gm).size).toBe(0);
  });
});

describe('movementFrom', () => {
  const derived = (walk: number, run: number) =>
    ({
      movement: { walk: { value: walk, breakdown: [] }, run: { value: run, breakdown: [] } },
    }) as unknown as Parameters<typeof movementFrom>[0];

  it('reads walk/run metres from the engine output', () => {
    expect(movementFrom(derived(8, 16))).toEqual({ walkM: 8, runM: 16 });
  });

  it('collapses run to walk when the run value is not larger', () => {
    expect(movementFrom(derived(8, 4))).toEqual({ walkM: 8, runM: 8 });
  });

  it('returns null without a derived character', () => {
    expect(movementFrom(null)).toBeNull();
    expect(movementFrom(derived(0, 0))).toBeNull();
  });
});

describe('rangeReadout', () => {
  const sheet = {
    rangeTables: { pistol: [5, 15, 30, 50] },
    weapons: [],
  } as unknown as SheetV1;
  const weapon = { name: 'Holdout', skillId: 'pistols', rangeCat: 'pistol' } as SheetWeapon;

  it('names the band and its modifier', () => {
    expect(rangeReadout(4, weapon, sheet)).toMatchObject({ band: 'short', value: 0 });
    expect(rangeReadout(12, weapon, sheet)).toMatchObject({ band: 'medium', value: -1 });
    expect(rangeReadout(28, weapon, sheet)).toMatchObject({ band: 'long', value: -3 });
    expect(rangeReadout(49, weapon, sheet)).toMatchObject({ band: 'extreme', value: -6 });
  });

  it('reports out of range past the extreme edge', () => {
    const out = rangeReadout(80, weapon, sheet);
    expect(out?.band).toBeNull();
    expect(out?.label).toContain('beyond extreme range');
  });

  it('says so when the sheet has no table for the category', () => {
    const out = rangeReadout(10, { ...weapon, rangeCat: 'rocket' }, sheet);
    expect(out?.edges).toBeNull();
    expect(out?.label).toContain('no range table');
  });

  it('is null with no weapon selected', () => {
    expect(rangeReadout(10, null, sheet)).toBeNull();
  });
});

describe('rangedWeapons', () => {
  it('keeps only weapons with a range category', () => {
    const sheet = {
      weapons: [
        { name: 'Knife', skillId: 'blades' },
        { name: 'SMG', skillId: 'automatics', rangeCat: 'smg' },
      ],
    } as unknown as SheetV1;
    expect(rangedWeapons(sheet).map((w) => w.name)).toEqual(['SMG']);
    expect(rangedWeapons(null)).toEqual([]);
  });
});

describe('classifyMark', () => {
  it('honours an explicit kind when the live store carries one', () => {
    expect(classifyMark(null, { x: 0, y: 0, ts: 0, kind: 'pointer' })).toBe('pointer');
    expect(classifyMark(null, { x: 0, y: 0, ts: 0, kind: 'focus' })).toBe('focus');
  });

  it('treats the first mark as a ping', () => {
    expect(classifyMark(null, { x: 1, y: 1, ts: 100 })).toBe('ping');
  });

  it('treats a fast nearby stream as a pointer trail', () => {
    const prev = { x: 1, y: 1, ts: 100 };
    expect(classifyMark(prev, { x: 1.4, y: 1.2, ts: 180 })).toBe('pointer');
  });

  it('treats an isolated or distant mark as a ping', () => {
    const prev = { x: 1, y: 1, ts: 100 };
    expect(classifyMark(prev, { x: 1.2, y: 1, ts: 900 })).toBe('ping');
    expect(classifyMark(prev, { x: 40, y: 1, ts: 150 })).toBe('ping');
  });
});

describe('focusFromEvent', () => {
  it('reads a focus point off either event shape', () => {
    expect(focusFromEvent({ type: 'scene.focus', payload: { x: 4, y: 9 } }, null)).toEqual({
      x: 4,
      y: 9,
    });
    expect(
      focusFromEvent({ type: 'display.updated', payload: { focus: { x: 1, y: 2 } } }, null),
    ).toEqual({ x: 1, y: 2 });
  });

  it('ignores events that are not a focus gesture', () => {
    expect(focusFromEvent({ type: 'token.moved', payload: { x: 1, y: 2 } }, null)).toBeNull();
    expect(focusFromEvent({ type: 'display.updated', payload: { blank: true } }, null)).toBeNull();
    expect(focusFromEvent({ type: 'scene.focus', payload: 'nonsense' }, null)).toBeNull();
  });

  it('ignores a focus aimed at another scene', () => {
    const event = { type: 'scene.focus', payload: { sceneId: 'sc2', x: 1, y: 1 } };
    expect(focusFromEvent(event, 'sc1')).toBeNull();
    expect(focusFromEvent(event, 'sc2')).toEqual({ x: 1, y: 1 });
    // No scene on screen yet: take it rather than drop it.
    expect(focusFromEvent(event, null)).toEqual({ x: 1, y: 1 });
  });
});
