import { describe, expect, it } from 'vitest';
import type {
  Combatant,
  CombatantMonitors,
  Encounter,
  Token,
  Visibility,
  WsEvent,
} from '@safehouse/contracts';
import {
  actingRow,
  isTvEncounterLive,
  normalizeTvEncounter,
  tvEncounterFrom,
  tvEncounterFromEvents,
  tvRibbonRows,
  tvTokenDecor,
} from './encounterState.js';

let nextId = 0;

function evt(type: string, payload: unknown, visibility: Visibility = 'public'): WsEvent {
  nextId += 1;
  return { id: nextId, type, payload, visibility, ts: '2076-05-12T21:00:00.000Z' };
}

function mon(physical = 0, stun = 0): CombatantMonitors {
  return {
    physical: { max: 10, filled: physical },
    stun: { max: 10, filled: stun },
    overflow: { max: 3, filled: 0 },
  };
}

function combatant(over: Partial<Combatant> & { id: string }): Combatant {
  return {
    encounterId: 'enc1',
    source: 'manual',
    name: over.id,
    initBase: 8,
    initDice: 1,
    initScore: 10,
    initKind: 'physical',
    monitors: mon(),
    effects: [],
    visibility: 'public',
    actedThisPass: false,
    ...over,
  };
}

function gmEncounter(combatants: Combatant[], over: Partial<Encounter> = {}): Encounter {
  return {
    id: 'enc1',
    campaignId: 'c1',
    name: 'Alley ambush',
    state: 'live',
    turn: 2,
    pass: 1,
    combatants,
    ...over,
  };
}

/**
 * What `GET /api/encounters/:id` actually returns to a display device: the
 * roster rides BESIDE the encounter object, coarse-conditioned, with no
 * monitors and no visibility field. The public `encounter.updated` delta has
 * the same shape.
 */
function playerView(over: Record<string, unknown> = {}) {
  return {
    encounter: {
      id: 'enc1',
      campaignId: 'c1',
      sceneId: 's1',
      name: 'Alley ambush',
      state: 'live',
      turn: 2,
      pass: 1,
      activeCombatantId: null,
    },
    combatants: [
      {
        id: 'c-wisp',
        name: 'Wisp',
        source: 'character',
        initScore: 17,
        initKind: 'physical',
        actedThisPass: false,
        own: false,
        condition: 'unharmed',
        effects: [],
      },
      {
        id: 'c-ganger',
        name: 'Ganger',
        source: 'manual',
        initScore: 9,
        initKind: 'physical',
        actedThisPass: true,
        own: false,
        condition: 'bloodied',
        effects: [{ id: 'e1', name: 'prone' }],
      },
    ],
    activeCombatantId: 'c-wisp',
    turnOrder: ['c-wisp', 'c-ganger'],
    scope: 'player',
    ...over,
  };
}

function token(over: Partial<Token> & { id: string }): Token {
  return {
    sceneId: 's1',
    source: 'character',
    name: over.id,
    x: 1,
    y: 1,
    size: 1,
    rotation: 0,
    hidden: false,
    level: 0,
    barsVisibility: 'public',
    ...over,
  };
}

describe('normalizeTvEncounter', () => {
  it('reads the roster that rides BESIDE the encounter (the display shape)', () => {
    const enc = normalizeTvEncounter(playerView());
    // This is the whole bug: the shared live store keeps only payload.encounter,
    // whose `combatants` is always undefined on a display socket.
    expect(enc?.combatants.map((c) => c.name)).toEqual(['Wisp', 'Ganger']);
    expect(enc?.turn).toBe(2);
    expect(enc?.pass).toBe(1);
    expect(enc?.activeCombatantId).toBe('c-wisp');
  });

  it('maps the coarse server condition onto a band, never onto boxes', () => {
    const enc = normalizeTvEncounter(playerView());
    expect(enc?.combatants.map((c) => c.band)).toEqual(['fresh', 'bloodied']);
    expect(enc?.combatants[1]?.effectCount).toBe(1);
  });

  it('reads a GM-grade Encounter with combatants nested inside', () => {
    const enc = tvEncounterFrom(gmEncounter([combatant({ id: 'a', monitors: mon(8, 0) })]));
    expect(enc?.combatants.map((c) => c.id)).toEqual(['a']);
    expect(enc?.combatants[0]?.band).toBe('bloodied');
  });

  it('drops a non-public row even when one is somehow present', () => {
    const enc = tvEncounterFrom(
      gmEncounter([combatant({ id: 'seen' }), combatant({ id: 'ambusher', visibility: 'gm' })]),
    );
    expect(enc?.combatants.map((c) => c.id)).toEqual(['seen']);
  });

  it('refuses an active id that names a row this device cannot see', () => {
    const enc = normalizeTvEncounter(playerView({ activeCombatantId: 'c-hidden' }));
    expect(enc?.activeCombatantId).toBeNull();
  });

  it('returns null for a deletion or a shapeless payload', () => {
    expect(normalizeTvEncounter({ encounterId: 'enc1', deleted: true })).toBeNull();
    expect(normalizeTvEncounter({})).toBeNull();
    expect(normalizeTvEncounter(null)).toBeNull();
  });
});

describe('tvEncounterFromEvents', () => {
  it('takes the newest public delta', () => {
    const enc = tvEncounterFromEvents([
      evt('encounter.updated', playerView({ scope: 'public' })),
      evt(
        'encounter.updated',
        playerView({ scope: 'public', activeCombatantId: 'c-ganger', encounter: { id: 'enc1', name: 'Alley ambush', state: 'live', turn: 3, pass: 2 } }),
      ),
    ]);
    expect(enc?.turn).toBe(3);
    expect(enc?.activeCombatantId).toBe('c-ganger');
  });

  it('IGNORES a gm-visibility event in the stream', () => {
    const base = normalizeTvEncounter(playerView());
    const enc = tvEncounterFromEvents(
      [
        evt(
          'encounter.updated',
          {
            encounterId: 'enc1',
            scope: 'gm',
            encounter: { id: 'enc1', name: 'Alley ambush', state: 'live', turn: 9, pass: 4 },
            combatants: [combatant({ id: 'ambusher', visibility: 'gm', name: 'Ambusher' })],
            activeCombatantId: 'ambusher',
          },
          'gm',
        ),
      ],
      base,
    );
    expect(enc).toBe(base);
    expect(enc?.combatants.map((c) => c.name)).toEqual(['Wisp', 'Ganger']);
  });

  it('refuses a gm-scoped payload even if it arrives marked public', () => {
    const enc = tvEncounterFromEvents([
      evt('encounter.updated', { encounterId: 'enc1', scope: 'gm', encounter: { id: 'enc1' } }),
    ]);
    expect(enc).toBeNull();
  });

  it('falls back to the hydrated snapshot when the stream is silent', () => {
    const base = normalizeTvEncounter(playerView());
    expect(tvEncounterFromEvents([], base)).toBe(base);
    expect(tvEncounterFromEvents([evt('roll.created', {})], base)).toBe(base);
  });

  it('picks by event id, not array position', () => {
    // A REST log route answers newest-first; the store's buffer is ascending.
    // The ribbon on the shared screen must not depend on which one it is given.
    const older = evt('encounter.updated', playerView({ scope: 'public' }));
    const newer = evt(
      'encounter.updated',
      playerView({
        scope: 'public',
        encounter: { id: 'enc1', name: 'Alley ambush', state: 'live', turn: 7, pass: 1 },
      }),
    );
    expect(tvEncounterFromEvents([newer, older])?.turn).toBe(7);
    expect(tvEncounterFromEvents([older, newer])?.turn).toBe(7);
  });

  it('clears the ribbon when the shown fight is deleted', () => {
    const base = normalizeTvEncounter(playerView());
    expect(
      tvEncounterFromEvents([evt('encounter.updated', { encounterId: 'enc1', deleted: true })], base),
    ).toBeNull();
  });
});

describe('tvRibbonRows', () => {
  it('orders by score and flags the acting combatant', () => {
    const rows = tvRibbonRows(normalizeTvEncounter(playerView({ activeCombatantId: null })));
    expect(rows.map((r) => r.id)).toEqual(['c-wisp', 'c-ganger']);
    expect(rows[0]?.acting).toBe(true);
    expect(rows[1]?.acted).toBe(true);
  });

  it('honours an explicit acting combatant', () => {
    const rows = tvRibbonRows(normalizeTvEncounter(playerView({ activeCombatantId: 'c-ganger' })));
    expect(rows.find((r) => r.acting)?.id).toBe('c-ganger');
  });

  it('caps its width and survives an empty fight', () => {
    const many = normalizeTvEncounter({
      encounter: { id: 'e', name: 'n', state: 'live', turn: 1, pass: 1 },
      combatants: Array.from({ length: 18 }, (_, i) => ({
        id: `c${i}`,
        name: `c${i}`,
        initScore: 20 - i,
        actedThisPass: false,
        condition: 'unharmed',
      })),
    });
    expect(tvRibbonRows(many, 4)).toHaveLength(4);
    expect(tvRibbonRows(null)).toEqual([]);
  });
});

describe('isTvEncounterLive', () => {
  it('needs a live encounter with combatants', () => {
    expect(isTvEncounterLive(null)).toBe(false);
    expect(isTvEncounterLive(normalizeTvEncounter(playerView({ combatants: [] })))).toBe(false);
    expect(
      isTvEncounterLive(
        normalizeTvEncounter(
          playerView({ encounter: { id: 'enc1', name: 'x', state: 'prep', turn: 0, pass: 0 } }),
        ),
      ),
    ).toBe(false);
    expect(isTvEncounterLive(normalizeTvEncounter(playerView()))).toBe(true);
  });
});

describe('tvTokenDecor', () => {
  const tokens = [
    token({ id: 't-wisp', name: 'Wisp', sourceId: 'char-1' }),
    token({ id: 't-ganger', name: 'Ganger', source: 'combatant' }),
  ];

  it('glows the acting combatant’s token and bars the rest', () => {
    const decor = tvTokenDecor(normalizeTvEncounter(playerView()), tokens);
    expect(decor.actingTokenId).toBe('t-wisp');
    expect(decor.bars.get('t-ganger')?.physical).toEqual({ filled: 3, max: 4 });
    expect(decor.bars.get('t-ganger')?.effectCount).toBe(1);
  });

  it('prefers an explicit tokenId over the name fallback', () => {
    const enc = normalizeTvEncounter({
      encounter: { id: 'e', name: 'n', state: 'live', turn: 1, pass: 1 },
      combatants: [
        { id: 'c1', name: 'Somebody Else', tokenId: 't-ganger', initScore: 5, condition: 'down' },
      ],
      activeCombatantId: 'c1',
    });
    const decor = tvTokenDecor(enc, tokens);
    expect(decor.actingTokenId).toBe('t-ganger');
    expect(decor.bars.get('t-ganger')?.physical).toEqual({ filled: 4, max: 4 });
  });

  it('respects a GM "not on the shared screen" token', () => {
    const decor = tvTokenDecor(normalizeTvEncounter(playerView()), [
      token({ id: 't-wisp', name: 'Wisp', barsVisibility: 'gm' }),
    ]);
    expect(decor.bars.has('t-wisp')).toBe(false);
    // The glow still tracks it — position is already public on this socket.
    expect(decor.actingTokenId).toBe('t-wisp');
  });

  it('matches nothing when the name is ambiguous', () => {
    const decor = tvTokenDecor(normalizeTvEncounter(playerView()), [
      token({ id: 't-a', name: 'Wisp' }),
      token({ id: 't-b', name: 'Wisp' }),
    ]);
    expect(decor.actingTokenId).toBeNull();
    expect(decor.bars.size).toBe(0);
  });

  it('is empty without a fight or without tokens', () => {
    expect(tvTokenDecor(null, tokens).bars.size).toBe(0);
    expect(tvTokenDecor(normalizeTvEncounter(playerView()), []).actingTokenId).toBeNull();
  });
});

describe('actingRow', () => {
  it('names the row driving the glow', () => {
    expect(actingRow(normalizeTvEncounter(playerView()))?.id).toBe('c-wisp');
    expect(actingRow(null)).toBeNull();
  });
});
