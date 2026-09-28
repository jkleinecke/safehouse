/**
 * The roll card builder (services/roll-cards.ts), pure: no db, no app boot.
 * Original fiction only.
 */
import { describe, expect, it } from 'vitest';
import { RollCardSchema, SheetV1Schema, type Exchange } from '@safehouse/contracts';
import { COMBAT_ACTIONS, environment } from '@safehouse/rules';
import { buildCard, listActions, type CardBody, type CardScene } from '../src/services/roll-cards.js';

const sheet = SheetV1Schema.parse({
  v: 1,
  identity: { alias: 'Wren' },
  attributes: { bod: 4, agi: 5, rea: 4, str: 3, wil: 5, log: 3, int: 4, cha: 3, edg: { max: 3, current: 3 }, ess: 6 },
  skills: [
    { id: 'pistols', rating: 4, attr: 'agi' },
    { id: 'gymnastics', rating: 2, attr: 'agi' },
  ],
  armor: [{ name: 'lined coat', rating: 9, worn: true }],
  weapons: [
    { name: 'Hold-out', skillId: 'pistols', acc: 6, dv: '8P', ap: -1, modes: ['SA'], rangeCat: 'heavy_pistol' },
  ],
  rangeTables: { heavy_pistol: [5, 20, 40, 60] },
});

const runner: CardBody = {
  actor: { kind: 'character', id: 'ch-1', name: 'Wren' },
  sheet,
  wounds: { physical: 3, stun: 0 },
  secret: false,
  initScore: 12,
  token: { sceneId: 's-1', x: 0, y: 0, unitM: 1 },
};

// Partial light: the −1 row.
const scene: CardScene = { id: 's-1', mods: environment({ light: 1, visibility: 0, glare: 0, wind: 0 }) };
const guard = {
  actor: { kind: 'token' as const, id: 't-2', name: 'Guard' },
  token: { sceneId: 's-1', x: 10, y: 0, unitM: 1 },
};

const burst: Exchange = {
  id: 'x-1',
  encounterId: 'e-1',
  turn: 1,
  actionId: 'fire_bf',
  attack: 'ranged',
  attacker: { combatantId: 'c-9', name: 'Ganger' },
  target: { combatantId: 'c-1', name: 'Wren' },
  declared: { dv: { value: 7, type: 'P' }, ap: 0, defenseModifier: -2, extras: [], by: { role: 'gm', name: 'GM' } },
  attackRollId: 'r-1',
  attackHits: 3,
  state: 'awaiting_defense',
  createdAt: '2026-09-28T00:00:00.000Z',
};

const offer = (card: ReturnType<typeof buildCard>, id: string) => card.offers.find((o) => o.id === id);

describe('roll cards', () => {
  it('lays out a shot: every line with its page, range folded into the environment', () => {
    const card = buildCard({
      body: runner,
      req: { actor: runner.actor, actionId: 'fire_sa', target: guard.actor },
      gm: true,
      scene,
      target: guard,
    });
    expect(() => RollCardSchema.parse(card)).not.toThrow();
    expect(card.action).toMatchObject({ type: 'simple', ref: { page: 165 } });
    expect(card.pool!.lines.every((l) => l.ref)).toBe(true);
    // AGI 5 + pistols 4, wounds −1, partial light and medium range tie at −1 → −3.
    expect(offer(card, 'environment')).toMatchObject({ value: -3, on: true });
    expect(offer(card, 'environment')!.note).toContain('10 m between the tokens');
    expect(card.pool!.total).toBe(5);
    expect(card.limit).toMatchObject({ kind: 'accuracy', value: 6 });
    expect(card.test).toMatchObject({ kind: 'opposed', against: "Guard's defense" });
    expect(card.declare).toMatchObject({ dv: { value: 8, type: 'P' }, ap: -1, mode: 'SA', defenseModifier: 0 });
    expect(card.stage).toBe('modifiers');
  });

  it('strikes engine lines left out of offersOn, and caps Take Aim at half Willpower', () => {
    const card = buildCard({
      body: runner,
      req: { actor: runner.actor, actionId: 'fire_sa', offersOn: ['recoil', 'aim_accuracy'], steppers: { aim_accuracy: 5 } },
      gm: false,
      scene,
    });
    expect(card.pool!.total).toBe(9);
    expect(offer(card, 'aim_accuracy')!.stepper).toMatchObject({ count: 3, max: 3 });
    expect(card.limit!.value).toBe(9);
  });

  it('never refuses a defense: Block against a shot, melee-only offers listed last', () => {
    const card = buildCard({
      body: runner,
      req: { actor: runner.actor, actionId: 'block' },
      gm: false,
      exchange: burst,
    });
    expect(() => RollCardSchema.parse(card)).not.toThrow();
    // REA 4 + INT 4 + no Unarmed Combat, wounds −1, the burst's −2.
    expect(card.pool!.total).toBe(5);
    expect(offer(card, 'fire_mode')).toMatchObject({ value: -2, on: true, declaredBy: { role: 'gm' } });
    const ids = card.offers.map((o) => o.id);
    expect(ids).toContain('attacker_reach');
    expect(ids.indexOf('attacker_reach')).toBeGreaterThan(ids.indexOf('cover_partial'));
    expect(card.context).toBeUndefined();
    expect(card.cost?.initScore).toEqual({ from: 12, to: 7 });
    expect(card.stage).toBe('dice');
  });

  it('Full Defense carries its Willpower once', () => {
    const card = buildCard({ body: runner, req: { actor: runner.actor, actionId: 'full_defense' }, gm: true });
    expect(card.pool!.lines.filter((l) => l.label.startsWith('WIL'))).toHaveLength(1);
    expect(offer(card, 'full_defense')).toBeUndefined();
  });

  it('lists every action, grouped, and orders the defenses without dropping any', () => {
    const list = listActions(runner, { gm: true, scene, against: 'ranged' });
    const ids = list.groups.flatMap((g) => g.actions.map((a) => a.id));
    expect(ids.sort()).toEqual(COMBAT_ACTIONS.map((a) => a.id).sort());
    expect(list.defenses!.slice(0, 5)).toEqual(['defense', 'full_defense', 'dodge', 'block', 'parry']);
    const fire = list.groups.find((g) => g.type === 'simple')!.actions.find((a) => a.id === 'fire_sa')!;
    expect(fire.weapons).toEqual(['Hold-out']);
    expect(fire.preview).toMatchObject({ limit: { kind: 'accuracy', value: 6 } });

    const prop = listActions({ ...runner, sheet: null, wounds: null }, { gm: true });
    expect(prop.groups.flatMap((g) => g.actions)).toHaveLength(COMBAT_ACTIONS.length);
  });
});
