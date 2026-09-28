import { describe, expect, it } from 'vitest';
import type { CardOffer, Exchange, WsEvent } from '@safehouse/contracts';
import {
  FIRE_CHOICES,
  incomingLine,
  modifierOrder,
  openExchangesOf,
  openRequest,
  rackStart,
  withCoverHint,
  type DeclareForm,
} from './gmModel.js';

const ref = { book: 'SR5', page: 1 };
const offer = (id: string, on: boolean, extra: Partial<CardOffer> = {}): CardOffer => ({ id, label: id, value: 2, ref, on, ...extra });

const x = (id: string, state: Exchange['state'], extra: Partial<Exchange> = {}): Exchange => ({
  id,
  encounterId: 'e1',
  turn: 1,
  attack: 'ranged',
  attacker: { combatantId: 'a', name: 'Ari' },
  target: { combatantId: 't', name: 'Bouncer' },
  declared: { dv: { value: 8, type: 'P' }, ap: -1, defenseModifier: 0, extras: [], by: { role: 'player', name: 'Ari' } },
  attackHits: 4,
  state,
  createdAt: '2026-09-28T00:00:00Z',
  ...extra,
});

const frame = (id: number, exchanges: Exchange[], extra: Record<string, unknown> = {}): WsEvent =>
  ({
    id,
    type: 'encounter.updated',
    ts: '2026-09-28T00:00:00Z',
    payload: { scope: 'gm', encounterId: 'e1', exchanges, ...extra },
  }) as unknown as WsEvent;

describe('rack chips', () => {
  it('opens a weapon on the firing action for its mode, melee without a range table', () => {
    expect(rackStart({ key: 'attack:Ares', kind: 'attack', weapon: { name: 'Ares', dv: '8P', ap: -1, mode: 'SA', rangeCat: 'heavy-pistol' } })).toEqual({
      action: { id: 'fire_sa', weapons: ['Ares'], needsTarget: true },
      weapon: 'Ares',
    });
    expect(rackStart({ key: 'attack:Knife', kind: 'attack', weapon: { name: 'Knife', dv: '3P', ap: -1, mode: null } })?.action.id).toBe('melee_attack');
  });

  it('maps the other chips to their actions', () => {
    expect(rackStart({ key: 'defense.full', kind: 'defense' })?.action.id).toBe('full_defense');
    expect(rackStart({ key: 'soak', kind: 'soak' })?.action.id).toBe('soak');
    expect(rackStart({ key: 'skill:sneaking', kind: 'skill' })).toEqual({ action: { id: 'use_skill' }, skill: 'sneaking' });
    expect(rackStart({ key: 'odd', kind: 'odd' })).toBeNull();
  });
});

describe('the incoming line', () => {
  it('reads attacker, hits, damage, mode', () => {
    expect(incomingLine(x('1', 'awaiting_defense', { declared: { ...x('1', 'awaiting_defense').declared, mode: 'SA' } }))).toBe(
      'Incoming: Ari, 4 hits, 8P AP −1, SA',
    );
    expect(incomingLine(x('1', 'awaiting_defense', { declared: { ...x('1', 'awaiting_defense').declared, mode: 'BF', defenseModifier: -2 } }))).toBe(
      'Incoming: Ari, 4 hits, 8P AP −1, BF, −2 to defend',
    );
  });
});

describe('open exchanges', () => {
  it('takes the newest GM frame over an older REST read, and only the open ones', () => {
    const events = [frame(5, [x('a', 'awaiting_defense')]), frame(9, [x('a', 'done'), x('b', 'awaiting_soak')])];
    expect(openExchangesOf(events, 'e1', { list: [x('a', 'awaiting_defense')], asOf: 7 }).map((e) => e.id)).toEqual(['b']);
  });

  it('keeps a REST read asked after the last frame, and ignores other fights and public frames', () => {
    const events = [frame(5, [x('a', 'awaiting_defense')]), frame(9, [], { encounterId: 'e2' }), frame(10, [], { scope: 'public' })];
    expect(openExchangesOf(events, 'e1', { list: [x('c', 'awaiting_apply')], asOf: 6 }).map((e) => e.id)).toEqual(['c']);
    expect(openExchangesOf(events, 'e1', undefined).map((e) => e.id)).toEqual(['a']);
  });
});

describe('modifiers', () => {
  it('marks the cover the map reads as likely, never ticked', () => {
    const offers = [offer('cover_good', false), offer('cover_partial', false)];
    const hinted = withCoverHint(offers, 'partial');
    expect(hinted.find((o) => o.id === 'cover_partial')).toMatchObject({ on: false, suggestedBy: 'los' });
    expect(hinted.find((o) => o.id === 'cover_good')?.suggestedBy).toBeUndefined();
    expect(withCoverHint(offers, 'none')).toEqual(offers);
  });

  it('lists what is on, then the hints, and keeps the Initiative cost apart', () => {
    const offers = [
      offer('init_cost', true, { target: 'initiative' }),
      offer('wounds', true),
      offer('prone', false),
      offer('cover_partial', false, { suggestedBy: 'los' }),
    ];
    expect(modifierOrder(offers).map((o) => o.id)).toEqual(['wounds', 'cover_partial', 'prone']);
  });
});

describe('declaring a tabletop attack', () => {
  const form: DeclareForm = {
    target: { kind: 'combatant', id: 't' },
    attacker: { kind: 'row', id: 'a', name: 'Ari', runner: true },
    attack: 'ranged',
    hits: 4,
    dv: { value: 8, type: 'P' },
    ap: -1,
    fire: FIRE_CHOICES.find((f) => f.label === 'SA')!,
    defenseModifier: 0,
    note: '  ',
  };

  it('labels a runner attack as the player said it', () => {
    expect(openRequest(form)).toEqual({
      target: { kind: 'combatant', id: 't' },
      attacker: { kind: 'combatant', id: 'a' },
      attack: 'ranged',
      hits: 4,
      dv: { value: 8, type: 'P' },
      ap: -1,
      defenseModifier: 0,
      mode: 'SA',
      rounds: 1,
      by: { role: 'player', name: 'Ari' },
    });
  });

  it('takes a typed name for someone with no row, as the GM', () => {
    const req = openRequest({ ...form, attacker: { kind: 'name', name: ' Sniper ' }, fire: FIRE_CHOICES[0]! });
    expect(req).toMatchObject({ attackerName: 'Sniper', by: { role: 'gm', name: 'GM' } });
    expect(req).not.toHaveProperty('attacker');
    expect(req).not.toHaveProperty('mode');
  });
});
