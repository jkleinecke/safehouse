import { describe, expect, it } from 'vitest';
import type { Encounter } from '@safehouse/contracts';
import type { TrackerRow } from '../../table/initiative.js';
import { newTokenCount, sceneFight } from './FightFromMap.js';
import { orderSummary } from './OrderChip.js';

const FIGHT: Encounter = { id: 'e1', campaignId: 'c', sceneId: 's1', name: 'Pier', state: 'live', turn: 2, pass: 1 };

describe('the fight from the map', () => {
  it('counts the fighting tokens the fight has no row for', () => {
    const tokens = [
      { id: 't1', source: 'character' as const },
      { id: 't2', source: 'npc_template' as const },
      { id: 't3', source: 'prop' as const },
      { id: 't4', source: 'prop' as const, combatant: true },
    ];
    expect(newTokenCount(tokens, [{ tokenId: 't1' }, { tokenId: null }])).toBe(2);
  });

  it("takes only this scene's fight, and not one that is over", () => {
    expect(sceneFight(FIGHT, 's1')).toBe(FIGHT);
    expect(sceneFight(FIGHT, 's2')).toBeNull();
    expect(sceneFight({ ...FIGHT, state: 'done' }, 's1')).toBeNull();
  });
});

describe('the order chip', () => {
  const row = (name: string, over: Partial<TrackerRow>) => ({ combatant: { name }, ...over }) as TrackerRow;

  it('says the turn, who is up and who is next', () => {
    const rows = [row('Ari', { acting: true, state: 'acting' }), row('Bo', { state: 'next' })];
    expect(orderSummary(FIGHT, rows).text).toBe('T2·P1 · Ari · next Bo');
    expect(orderSummary({ ...FIGHT, gmTurn: true }, [row('Bo', { state: 'next' })]).text).toBe('T2·P1 · GM’s turn · next Bo');
  });

  it("asks a runner for their initiative while it is gathered", () => {
    const mine = [row('Ari', { own: true, rolled: false })];
    expect(orderSummary({ ...FIGHT, gathering: true }, mine)).toEqual({ text: 'roll initiative', warn: true });
    expect(orderSummary(null, []).text).toBe('fight');
  });
});
