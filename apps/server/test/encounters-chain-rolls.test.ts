/**
 * `chainRollInputs` (FR10.8 → G5): the pure mapping from one resolved attack
 * chain to the `rolls` rows the server persists. No db, no hub, no app boot —
 * the dice are pinned by a constant rng so the miss path is deterministic.
 *
 * Original fiction only (G6/§14).
 */
import { describe, expect, it } from 'vitest';
import { SheetV1Schema, type SheetV1 } from '@safehouse/contracts';
import { chainActor, resolveChain } from '../src/services/encounters-copilot.js';
import { chainRollInputs } from '../src/services/encounters-rolls.js';

const MONITORS = {
  physical: { max: 10, filled: 0 },
  stun: { max: 10, filled: 0 },
  overflow: { max: 4, filled: 0 },
};

function sheet(alias: string): SheetV1 {
  return SheetV1Schema.parse({
    v: 1,
    identity: { alias },
    attributes: {
      bod: 4,
      agi: 4,
      rea: 5,
      str: 3,
      wil: 4,
      log: 3,
      int: 4,
      cha: 3,
      edg: { max: 3, current: 3 },
      ess: 6,
    },
    skills: [{ id: 'pistols', rating: 4, attr: 'agi' }],
    armor: [{ name: 'padded jacket', rating: 9, worn: true }],
    weapons: [
      { name: 'snub pistol', skillId: 'pistols', acc: 6, dv: '7P', ap: 0, modes: ['SA'] },
    ],
  });
}

const CTX = {
  chainId: 'chain-1',
  encounterId: 'enc-1',
  attacker: { id: 'c-att', name: 'Breaker' },
  defender: { id: 'c-def', name: 'Rivet' },
  weaponName: 'snub pistol',
};

function chainWith(rng: () => number) {
  const attacker = sheet('Breaker');
  const defender = sheet('Rivet');
  return resolveChain(
    chainActor(attacker, MONITORS, { name: 'Breaker', weaponName: 'snub pistol' }),
    chainActor(defender, MONITORS, { name: 'Rivet' }),
    attacker.weapons[0]!,
    rng,
  );
}

describe('chainRollInputs (FR10.8 dice on the record)', () => {
  it('records attack and defence, and no soak, when the shot misses', () => {
    // Every die a 1: no hits either side, ties go to the defender ⇒ miss.
    const outcome = chainWith(() => 0);
    expect(outcome.result.outcome).toBe('miss');
    expect(outcome.result.soak).toBeUndefined();

    const inputs = chainRollInputs(outcome, CTX);
    expect(inputs.map((i) => i.step)).toEqual(['attack', 'defense']);
    expect(inputs[0]!.combatantId).toBe('c-att');
    expect(inputs[0]!.actorName).toBe('Breaker');
    expect(inputs[0]!.label).toContain('Attack');
    expect(inputs[1]!.combatantId).toBe('c-def');
    // The persisted pool matches the dice actually thrown (Principle 3).
    for (const input of inputs) {
      expect(input.result.faces).toHaveLength(input.request['pool'] as number);
      expect(input.meta['chainId']).toBe('chain-1');
      expect(input.meta['encounterId']).toBe('enc-1');
      expect((input.request['visibility'] as string)).toBe('gm');
      expect(input.request['breakdown']).toEqual(
        input.step === 'attack' ? outcome.result.attack.breakdown : outcome.result.defense.breakdown,
      );
    }
    expect(inputs[0]!.limit).toEqual(outcome.result.attack.limit ?? null);
  });

  it('adds the soak row when boxes were rolled for', () => {
    // Sixes for the attacker's pool, ones after that: the shot lands and the
    // defender rolls soak (the dice come off one rng, attack pool first).
    const attackPool = chainWith(() => 0).result.attack.pool;
    let die = 0;
    const outcome = chainWith(() => (die++ < attackPool ? 0.999 : 0));
    expect(outcome.result.soak).toBeDefined();
    const inputs = chainRollInputs(outcome, CTX);
    expect(inputs.map((i) => i.step)).toEqual(['attack', 'defense', 'soak']);
    const soak = inputs[2]!;
    expect(soak.combatantId).toBe('c-def');
    expect(soak.kind).toBe('soak');
    expect(soak.meta['boxes']).toBe(outcome.result.soak!.boxes);
    expect(soak.meta['track']).toBe(outcome.result.soak!.track);
    expect(soak.result.faces).toHaveLength(outcome.result.soak!.pool);
  });
});
