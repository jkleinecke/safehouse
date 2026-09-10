import { describe, expect, it } from 'vitest';
import type { Combatant, CombatantMonitors, Encounter } from '@safehouse/contracts';
import {
  conditionBand,
  effectHint,
  fightPhase,
  formatModifier,
  isRolled,
  monitorDetailFor,
  moraleLine,
  moralePrompts,
  passLabel,
  scoreFromRolled,
  trackerRows,
  visibleCombatants,
  type Viewer,
} from './initiative.js';

function mon(physical = 0, stun = 0, overflow = 0): CombatantMonitors {
  return {
    physical: { max: 10, filled: physical },
    stun: { max: 10, filled: stun },
    overflow: { max: 3, filled: overflow },
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

function encounter(combatants: Combatant[], over: Partial<Encounter> = {}): Encounter {
  return {
    id: 'enc1',
    campaignId: 'c1',
    name: 'Ambush in the alley',
    state: 'live',
    turn: 1,
    pass: 1,
    combatants,
    ...over,
  };
}

const GM: Viewer = { role: 'gm' };
const PLAYER: Viewer = { role: 'player', characterId: 'char-9' };

describe('visibility', () => {
  const mine = combatant({ id: 'mine', source: 'character', sourceId: 'char-9', visibility: 'gm_owner' });
  const other = combatant({ id: 'other', visibility: 'public' });
  const hidden = combatant({ id: 'hidden', visibility: 'gm' });

  it('hides GM-only rows from players but not their own', () => {
    const seen = visibleCombatants([mine, other, hidden], PLAYER).map((c) => c.id);
    expect(seen).toEqual(['mine', 'other']);
  });

  it('shows the GM everything', () => {
    expect(visibleCombatants([mine, other, hidden], GM)).toHaveLength(3);
  });

  it('gives exact boxes only to the GM and the row owner', () => {
    expect(monitorDetailFor(other, GM)).toBe('full');
    expect(monitorDetailFor(mine, PLAYER)).toBe('full');
    expect(monitorDetailFor(other, PLAYER)).toBe('coarse');
    expect(monitorDetailFor(hidden, PLAYER)).toBe('none');
  });
});

describe('conditionBand', () => {
  it('reads the worse of the two tracks', () => {
    expect(conditionBand(mon(0, 0))).toBe('fresh');
    expect(conditionBand(mon(1, 0))).toBe('scratched');
    expect(conditionBand(mon(0, 5))).toBe('wounded');
    expect(conditionBand(mon(8, 0))).toBe('bloodied');
  });

  it('calls a full track or any overflow down', () => {
    expect(conditionBand(mon(10, 0))).toBe('down');
    expect(conditionBand(mon(0, 10))).toBe('down');
    expect(conditionBand(mon(2, 2, 1))).toBe('down');
  });
});

describe('trackerRows', () => {
  it('sorts by score descending and numbers the acting order', () => {
    const rows = trackerRows(
      encounter([
        combatant({ id: 'slow', initScore: 7 }),
        combatant({ id: 'fast', initScore: 22 }),
        combatant({ id: 'mid', initScore: 14 }),
      ]),
      GM,
    );
    expect(rows.map((r) => r.combatant.id)).toEqual(['fast', 'mid', 'slow']);
    expect(rows.map((r) => r.order)).toEqual([1, 2, 3]);
  });

  it('breaks ties on initiative base, then id', () => {
    const rows = trackerRows(
      encounter([
        combatant({ id: 'b', initScore: 12, initBase: 8 }),
        combatant({ id: 'a', initScore: 12, initBase: 8 }),
        combatant({ id: 'c', initScore: 12, initBase: 11 }),
      ]),
      GM,
    );
    expect(rows.map((r) => r.combatant.id)).toEqual(['c', 'a', 'b']);
  });

  it('sinks spent rows below live ones without dropping them', () => {
    const rows = trackerRows(
      encounter([
        combatant({ id: 'spent', initScore: 0 }),
        combatant({ id: 'live', initScore: 3 }),
      ]),
      GM,
    );
    expect(rows.map((r) => r.combatant.id)).toEqual(['live', 'spent']);
    expect(rows.map((r) => r.active)).toEqual([true, false]);
    expect(rows[1]?.order).toBeNull();
  });

  it('flags the encounter’s active combatant', () => {
    const rows = trackerRows(
      encounter(
        [combatant({ id: 'fast', initScore: 20 }), combatant({ id: 'slow', initScore: 9 })],
        { activeCombatantId: 'slow' },
      ),
      GM,
    );
    expect(rows.find((r) => r.acting)?.combatant.id).toBe('slow');
  });

  it('falls back to the next unacted combatant when none is flagged', () => {
    const rows = trackerRows(
      encounter([
        combatant({ id: 'fast', initScore: 20, actedThisPass: true }),
        combatant({ id: 'slow', initScore: 9 }),
      ]),
      GM,
    );
    expect(rows.find((r) => r.acting)?.combatant.id).toBe('slow');
  });

  it('carries the wound modifier onto the row', () => {
    const rows = trackerRows(encounter([combatant({ id: 'hurt', monitors: mon(6, 3) })]), GM);
    expect(rows[0]?.woundModifier).toBe(-3);
  });

  it('is empty without an encounter', () => {
    expect(trackerRows(null, GM)).toEqual([]);
  });
});

describe('labels', () => {
  it('always shows at least turn 1 pass 1', () => {
    expect(passLabel(null)).toBe('TURN 1 · PASS 1');
    expect(passLabel(encounter([], { turn: 3, pass: 2 }))).toBe('TURN 3 · PASS 2');
  });

  it('signs modifiers', () => {
    expect(formatModifier(0)).toBe('+0');
    expect(formatModifier(-2)).toBe('-2');
    expect(formatModifier(3)).toBe('+3');
  });

  it('hints at effect durations', () => {
    expect(effectHint({ id: 'e', name: 'Prone', mods: [], duration: { kind: 'end_of_turn' } })).toBe('EOT');
    expect(
      effectHint({ id: 'e', name: 'Levitate', mods: [], duration: { kind: 'passes', value: 2 } }),
    ).toBe('2p');
    expect(effectHint({ id: 'e', name: 'Marked', mods: [], duration: { kind: 'manual' } })).toBeNull();
  });
});

describe('moralePrompts', () => {
  const squad = (down: number, pr: number, over: Partial<Combatant> = {}) =>
    combatant({
      id: 'squad',
      name: 'Alley crew',
      source: 'grunt_group',
      grunt: {
        size: 4,
        professionalRating: pr,
        groupEdge: 0,
        members: Array.from({ length: 4 }, (_, i) => ({
          label: `G${i + 1}`,
          filled: 0,
          down: i < down,
        })),
      },
      ...over,
    });

  it('stays quiet while a professional squad holds', () => {
    expect(moralePrompts([squad(1, 3)])).toEqual([]);
  });

  it('prompts once the pressure outruns the professional rating', () => {
    const prompts = moralePrompts([squad(2, 0)]);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]?.report.suggestion).toBe('cut_and_run');
    expect(prompts[0]?.standing).toBe(2);
    expect(prompts[0]?.report.reasons).toContain('first casualty');
  });

  it('keys the prompt on the casualty count so it re-fires as things worsen', () => {
    const first = moralePrompts([squad(2, 0)])[0]?.key;
    const worse = moralePrompts([squad(3, 0)])[0]?.key;
    expect(first).toBeDefined();
    expect(worse).not.toBe(first);
  });

  it('respects the GM silence flag and the leader-down flag', () => {
    expect(moralePrompts([squad(2, 0, { copilot: { morale: false } })])).toEqual([]);
    const withLeader = moralePrompts([squad(1, 1, { copilot: { leaderDown: true } })]);
    expect(withLeader[0]?.report.reasons).toContain('leader down');
  });

  /**
   * The server's morale pass keys off `copilot.leader` (the flag its own
   * routes write). Reading a different name here meant the GM could set the
   * leader through the API and watch the tracker's prompt never mention it.
   */
  it('reads the server’s own copilot.leader flag', () => {
    const withLeader = moralePrompts([squad(1, 1, { copilot: { leader: true } })]);
    expect(withLeader[0]?.report.reasons).toContain('leader down');
    const without = moralePrompts([squad(1, 1, { copilot: { leader: false } })]);
    expect(without[0]?.report.reasons ?? []).not.toContain('leader down');
  });

  it('ignores rows that are not grunt groups', () => {
    expect(moralePrompts([combatant({ id: 'pc', source: 'character' })])).toEqual([]);
  });

  it('writes a log line the GM can post', () => {
    const prompt = moralePrompts([squad(2, 0)])[0];
    expect(prompt).toBeDefined();
    expect(moraleLine(prompt!)).toContain('Alley crew');
    expect(moraleLine(prompt!)).toContain('2/4 standing');
  });
});

describe('blank lines and hand rolls (FR4.2)', () => {
  it('a 0 in the first pass is a line nobody has rolled; later it is a spent score', () => {
    const blank = combatant({ id: 'a', initScore: 0 });
    expect(isRolled(encounter([blank], { turn: 0, pass: 0, state: 'prep' }), blank)).toBe(false);
    expect(isRolled(encounter([blank], { turn: 1, pass: 1 }), blank)).toBe(false);
    expect(isRolled(encounter([blank], { turn: 1, pass: 2 }), blank)).toBe(true);
    expect(isRolled(encounter([blank]), combatant({ id: 'b', initScore: 0, actedThisPass: true }))).toBe(true);
    expect(isRolled(encounter([blank]), combatant({ id: 'c', initScore: 12 }))).toBe(true);
    expect(isRolled(null, blank)).toBe(false);
    const rows = trackerRows(encounter([blank, combatant({ id: 'd', initScore: 12 })], { pass: 1 }), GM);
    expect(rows.map((r) => [r.combatant.id, r.rolled])).toEqual([
      ['d', true],
      ['a', false],
    ]);
  });

  it('a dice total becomes base + dice + wounds, exactly as the server computes it', () => {
    const fresh = combatant({ id: 'a', initBase: 8 });
    expect(scoreFromRolled(fresh, 9)).toBe(17);
    const hurt = combatant({ id: 'b', initBase: 8, monitors: mon(3) });
    expect(scoreFromRolled(hurt, 9)).toBe(16);
  });

  it('names the phase of a fight', () => {
    expect(fightPhase(null)).toBe('none');
    expect(fightPhase(encounter([], { state: 'prep' }))).toBe('prep');
    expect(fightPhase(encounter([]))).toBe('live');
    expect(fightPhase(encounter([], { state: 'done' }))).toBe('done');
  });
});
