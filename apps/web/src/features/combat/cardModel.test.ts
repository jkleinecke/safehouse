import { describe, expect, it } from 'vitest';
import type { CardOffer, Exchange, WsEvent } from '@safehouse/contracts';
import type { ActionSummary, ActorActions } from './cardApi.js';
import {
  defenseChoices,
  exchangeTasks,
  flipOffer,
  latestExchanges,
  offOffers,
  offersOnWith,
  orderedGroups,
  requestOf,
  newDraft,
  tableResult,
} from './cardModel.js';

const ref = { book: 'SR5', page: 1 };
const act = (id: string, type: ActionSummary['type'], extra: Partial<ActionSummary> = {}): ActionSummary => ({
  id,
  name: id,
  type,
  ref,
  preview: null,
  ...extra,
});
const offer = (id: string, on: boolean, extra: Partial<CardOffer> = {}): CardOffer => ({ id, label: id, value: -1, ref, on, ...extra });

describe('the actions list', () => {
  const list: ActorActions = {
    actor: { kind: 'character', id: 'c1', name: 'Ari' },
    groups: [
      { type: 'none', actions: [act('defense', 'none', { exchange: 'defends' }), act('soak', 'none', { exchange: 'soaks' })] },
      { type: 'interrupt', actions: [act('hit_the_dirt', 'interrupt', { exchange: 'defends' }), act('dodge', 'interrupt', { exchange: 'defends' })] },
      { type: 'free', actions: [act('speak', 'free')] },
      { type: 'complex', actions: [] },
    ],
    defenses: ['avoid_suppression', 'hit_the_dirt', 'defense', 'dodge'],
  };

  it('groups Free, Simple, Complex, Interrupt, then no-action tests, empty groups dropped', () => {
    expect(orderedGroups(list).map((g) => g.type)).toEqual(['free', 'interrupt', 'none']);
  });

  it('lists the free defense first, then the Interrupts, never leaving one out', () => {
    expect(defenseChoices(list).map((a) => a.id)).toEqual(['defense', 'dodge', 'hit_the_dirt']);
  });
});

describe('offers', () => {
  const offers = [offer('wounds', true), offer('cover_partial', false, { group: 'cover' }), offer('cover_good', true, { group: 'cover' })];

  it('ticking one clears the rest of its group, and the flip goes last', () => {
    const flips = flipOffer(offers, {}, 'cover_partial');
    expect(flips).toEqual({ cover_good: false, cover_partial: true });
    expect(offersOnWith(offers, flips)).toEqual(['wounds', 'cover_partial']);
    expect(offersOnWith(offers, flipOffer(offers, {}, 'wounds'))).toEqual(['cover_good']);
  });

  it('puts hints and the attacker’s facts first among the unticked', () => {
    const list = [offer('a', false), offer('b', false, { declaredBy: { role: 'gm', name: 'GM' } }), offer('c', false, { suggestedBy: 'status' }), offer('d', true)];
    expect(offOffers(list).map((o) => o.id)).toEqual(['c', 'b', 'a']);
  });

  it('builds the request from the draft', () => {
    const d = { ...newDraft({ kind: 'token', id: 't1' }, { id: 'fire_sa', weapons: ['Ares Predator'] }), other: 2 };
    expect(requestOf(d)).toEqual({
      actor: { kind: 'token', id: 't1' },
      actionId: 'fire_sa',
      weapon: 'Ares Predator',
      extras: [{ label: 'Other', value: 2 }],
    });
  });
});

describe('the table’s dice', () => {
  it('a critical glitch has no hits, and a glitch on none is critical', () => {
    expect(tableResult(3, 'critical')).toEqual({ hits: 0, glitch: 'critical' });
    expect(tableResult(0, 'glitch')).toEqual({ hits: 0, glitch: 'critical' });
    expect(tableResult(2.7, 'none')).toEqual({ hits: 2, glitch: 'none' });
  });
});

describe('exchanges a runner is in', () => {
  const x = (id: string, state: Exchange['state'], extra: Partial<Exchange> = {}): Exchange => ({
    id,
    encounterId: 'e1',
    turn: 1,
    attack: 'ranged',
    attacker: { combatantId: 'npc', name: 'Ganger' },
    target: { combatantId: 'me', name: 'Ari' },
    declared: { dv: { value: 8, type: 'P' }, ap: -1, defenseModifier: 0, extras: [], by: { role: 'gm', name: 'GM' } },
    state,
    createdAt: '2026-09-28T00:00:00Z',
    ...extra,
  });
  const frame = (id: number, exchange: Exchange) =>
    ({ id, type: 'exchange.updated', payload: { scope: 'player', exchange }, visibility: 'gm_owner', ts: '2026-09-28T00:00:00Z' }) as unknown as WsEvent;

  it('keeps the newest copy and asks for a defense, then a soak', () => {
    const seen = latestExchanges([frame(1, x('x1', 'awaiting_defense')), frame(3, x('x1', 'awaiting_soak')), frame(2, x('x2', 'awaiting_defense'))]);
    const tasks = exchangeTasks(seen, new Set(['me']), () => false);
    expect(tasks.map((t) => `${t.kind}:${t.x.id}`)).toEqual(['defend:x2', 'soak:x1']);
  });

  it('tells the attacker Hit, Grazed or Miss only while it is news', () => {
    const mine = x('x3', 'done', { attacker: { combatantId: 'me', name: 'Ari' }, target: { name: 'someone unseen' }, outcome: 'graze' });
    const seen = latestExchanges([frame(5, mine)]);
    expect(exchangeTasks(seen, new Set(['me']), () => true).map((t) => t.kind)).toEqual(['attacked']);
    expect(exchangeTasks(seen, new Set(['me']), () => false)).toEqual([]);
  });
});
