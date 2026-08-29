/**
 * `magic.updated` frames (§11) — the refinement half of LIVE-1.
 *
 * The rule these pin is the one LIVE-1 was written about: an event corrects a
 * view that was READ, it never assembles one. A frame about another character
 * is ignored, a frame that moved a pool asks for a re-read rather than
 * guessing, and every frame the table cares about turns into a log line with a
 * number in it.
 */
import { describe, expect, it } from 'vitest';
import type { WsEvent } from '@safehouse/contracts';
import { applyMagicEvent, magicLogLines, magicLogText } from './events.js';
import { spendServiceLocal } from './lib.js';
import { emptyMagicView, type FocusRow, type MagicView, type SpiritRow } from './types.js';

// Fixtures — original fiction only (G6)

function focus(over: Partial<FocusRow> = {}): FocusRow {
  return {
    id: 'focus-1',
    characterId: 'char-1',
    name: 'Copper Wren',
    kind: 'power focus',
    force: 3,
    bonded: true,
    active: false,
    sourceKind: 'power',
    targets: ['pool.skill.spellcasting'],
    mods: [],
    note: '',
    ...over,
  };
}

function spirit(over: Partial<SpiritRow> = {}): SpiritRow {
  return {
    id: 'spirit-1',
    characterId: 'char-1',
    name: 'Ash-Wing',
    spiritType: 'air',
    force: 4,
    bound: true,
    services: 3,
    servicesInitial: 5,
    status: 'summoned',
    sustainingSpellId: null,
    combatantId: null,
    encounterId: null,
    note: '',
    ...over,
  };
}

function view(over: Partial<MagicView> = {}): MagicView {
  return { ...emptyMagicView('char-1'), ...over };
}

// ---------------------------------------------------------------------------

describe('magic.updated refines a hydrated view, it never builds one (LIVE-1)', () => {
  function event(payload: unknown, id = 7): WsEvent {
    return { id, type: 'magic.updated', payload, visibility: 'public', ts: '2076-05-12T21:03:00.000Z' };
  }

  const seeded = view({ spirits: [spirit()], foci: [focus()], reagents: 9 });

  it('reconciles a service spend to the number the server reports', () => {
    // The tap already showed 2 optimistically; the event says 2 as well.
    const optimistic = { ...seeded, spirits: spendServiceLocal(seeded.spirits, 'spirit-1').spirits };
    const effect = applyMagicEvent(
      optimistic,
      event({ op: 'spirit.service.spend', spirit: { ...spirit(), services: 2 }, spent: 1, remaining: 2 }),
    );
    expect(effect.changed).toBe(true);
    expect(effect.rederive).toBe(false);
    expect(effect.view.spirits[0]?.services).toBe(2);
  });

  it('corrects an optimistic guess the server disagreed with', () => {
    const optimistic = { ...seeded, spirits: spendServiceLocal(seeded.spirits, 'spirit-1', 2).spirits };
    expect(optimistic.spirits[0]?.services).toBe(1);
    const effect = applyMagicEvent(
      optimistic,
      event({ op: 'spirit.service.spend', spirit: { ...spirit(), services: 0 }, spent: 3, remaining: 0 }),
    );
    expect(effect.view.spirits[0]?.services).toBe(0);
  });

  it('adds a spirit that was summoned on another device', () => {
    const effect = applyMagicEvent(
      view(),
      event({ op: 'spirit.summoned', spirit: spirit({ id: 'spirit-9', name: 'Slate' }) }),
    );
    expect(effect.view.spirits.map((s) => s.name)).toEqual(['Slate']);
  });

  it('ignores another character’s spirit entirely', () => {
    const effect = applyMagicEvent(
      seeded,
      event({ op: 'spirit.updated', spirit: spirit({ id: 'x', characterId: 'char-2' }) }),
    );
    expect(effect.changed).toBe(false);
    expect(effect.view.spirits).toHaveLength(1);
  });

  it('re-reads rather than guessing when the pools may have moved', () => {
    const focusEvent = applyMagicEvent(
      seeded,
      event({ op: 'focus.updated', focus: { ...focus(), active: true }, characterId: 'char-1' }),
    );
    expect(focusEvent.rederive).toBe(true);
    expect(focusEvent.view.foci[0]?.active).toBe(true);

    const dismissed = applyMagicEvent(
      seeded,
      event({ op: 'spirit.dismissed', spirit: spirit({ status: 'dismissed' }) }),
    );
    expect(dismissed.rederive).toBe(true);
    expect(dismissed.view.spirits[0]?.status).toBe('dismissed');
  });

  it('drops a focus that left the rack', () => {
    const effect = applyMagicEvent(seeded, event({ op: 'focus.removed', focusId: 'focus-1' }));
    expect(effect.view.foci).toHaveLength(0);
  });

  it('takes the reagent count straight off the wire', () => {
    const effect = applyMagicEvent(
      seeded,
      event({ op: 'reagents.spend', characterId: 'char-1', before: 9, after: 5 }),
    );
    expect(effect.view.reagents).toBe(5);
    // Someone else's counter is not ours.
    expect(
      applyMagicEvent(seeded, event({ op: 'reagents.spend', characterId: 'char-2', after: 0 })).view
        .reagents,
    ).toBe(9);
  });

  it('ignores everything that is not a magic frame', () => {
    const roll: WsEvent = {
      id: 8,
      type: 'roll.created',
      payload: {},
      visibility: 'public',
      ts: '2076-05-12T21:04:00.000Z',
    };
    expect(applyMagicEvent(seeded, roll).changed).toBe(false);
  });
});

describe('the log line the table reads', () => {
  it('says what the spirit was told to do, and what it cost', () => {
    expect(
      magicLogText({
        op: 'spirit.service.spend',
        spirit: spirit(),
        spent: 1,
        shortfall: 0,
        remaining: 2,
        reason: 'scout the roof',
      }),
    ).toBe('Ash-Wing: 1 service spent, 2 left — scout the roof');
  });

  it('reports a summoner who asked for more than they were owed', () => {
    expect(
      magicLogText({ op: 'spirit.service.spend', spirit: spirit(), spent: 1, shortfall: 2, remaining: 0 }),
    ).toContain('2 more than it owed');
  });

  it('covers the rest of the vocabulary', () => {
    expect(magicLogText({ op: 'spirit.summoned', spirit: spirit() })).toBe(
      'Ash-Wing summoned at Force 4, bound',
    );
    expect(magicLogText({ op: 'spirit.joined', spirit: spirit() })).toBe('Ash-Wing joined the fight');
    expect(magicLogText({ op: 'spirit.dismissed', spirit: spirit() })).toBe('Ash-Wing dismissed');
    expect(magicLogText({ op: 'focus.updated', focus: { ...focus(), active: true } })).toBe(
      'Copper Wren switched on',
    );
    expect(magicLogText({ op: 'reagents.restock', before: 2, after: 12 })).toContain('2 → 12 drams');
    expect(magicLogText({ op: 'something.else' })).toBeNull();
  });

  it('keeps the last few magic lines out of the whole campaign log', () => {
    const events: WsEvent[] = [
      { id: 1, type: 'roll.created', payload: {}, visibility: 'public', ts: 't' },
      {
        id: 2,
        type: 'magic.updated',
        payload: { op: 'spirit.service.spend', spirit: spirit(), spent: 1, remaining: 2 },
        visibility: 'public',
        ts: 't',
      },
      {
        id: 3,
        type: 'magic.updated',
        payload: { op: 'spirit.dismissed', spirit: spirit() },
        visibility: 'public',
        ts: 't',
      },
    ];
    expect(magicLogLines(events).map((l) => l.text)).toEqual([
      'Ash-Wing: 1 service spent, 2 left',
      'Ash-Wing dismissed',
    ]);
    expect(magicLogLines(events, 1)).toHaveLength(1);
  });
});
