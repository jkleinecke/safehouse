import { describe, expect, it } from 'vitest';
import { SheetV1Schema, type SheetV1 } from '@safehouse/contracts';
import type { GeneratedGruntGroup, GeneratedNpc } from '@safehouse/rules';
import { actionEconomy } from './readout.js';
import {
  entryFromGroup,
  entryFromNpc,
  needsRegen,
  oppositionProfiles,
  partyProfiles,
  patchEntry,
  removeEntry,
  toParts,
  totalBodies,
  type RosterEntry,
} from './roster.js';

const sheet: SheetV1 = SheetV1Schema.parse({
  v: 1,
  identity: { alias: 'Ganger' },
  attributes: {
    bod: 4, agi: 4, rea: 3, str: 4, wil: 3, log: 2, int: 3, cha: 2,
    edg: { max: 2, current: 2 },
  },
  skills: [{ id: 'automatics', rating: 4, attr: 'agi' }],
  weapons: [{ name: 'SMG', skillId: 'automatics', dv: '8P', ap: -2, acc: 5 }],
  armor: [{ name: 'Vest', rating: 9, worn: true }],
});

function npc(over: Partial<GeneratedNpc> = {}): GeneratedNpc {
  return {
    name: 'Wire',
    seed: 1234,
    tierId: 'street',
    metatype: 'human',
    professionalRating: 2,
    sheet,
    monitors: { physical: 10, stun: 10, overflow: 4 },
    persona: {},
    flavor: { name: 'Wire', quirk: 'q', appearance: 'a', motivation: 'm' },
    loadout: {},
    corrections: [],
    ...over,
  };
}

const meta = { templateId: 'tpl-1', templateName: 'Street ganger' };

describe('roster entries (FR10.4)', () => {
  it('builds an NPC entry carrying its seed for reproducibility', () => {
    const entry = entryFromNpc(npc(), meta);
    expect(entry.kind).toBe('npc');
    expect(entry.seed).toBe(1234);
    expect(entry.tierId).toBe('street');
    expect(entry.count).toBe(1);
    expect(entry.sheet).toBe(sheet);
  });

  it('builds a grunt-group entry whose bodies are the squad size', () => {
    const group: GeneratedGruntGroup = {
      seed: 99,
      tierId: 'street',
      metatype: 'ork',
      professionalRating: 1,
      statblock: sheet,
      monitors: { physical: 10, stun: 10, overflow: 4 },
      members: [npc({ name: 'A' }), npc({ name: 'B' }), npc({ name: 'C' })],
    };
    const entry = entryFromGroup(group, meta);
    expect(entry.kind).toBe('gruntGroup');
    expect(entry.count).toBe(3);
    expect(entry.name).toContain('×3');
  });

  it('gives distinct ids to entries built back to back', () => {
    const a = entryFromNpc(npc(), meta);
    const b = entryFromNpc(npc(), meta);
    expect(a.id).not.toBe(b.id);
  });
});

describe('toParts (server BuildPartInput)', () => {
  it('sends size for squads and count for independent NPCs', () => {
    const entries: RosterEntry[] = [
      { ...entryFromNpc(npc(), meta), count: 3 },
      { ...entryFromNpc(npc(), meta), kind: 'gruntGroup', count: 5 },
    ];
    const parts = toParts(entries);
    expect(parts[0]).toMatchObject({ kind: 'npc', count: 3, templateId: 'tpl-1', seed: 1234 });
    expect(parts[0]).not.toHaveProperty('size');
    expect(parts[1]).toMatchObject({ kind: 'gruntGroup', size: 5 });
    expect(parts[1]).not.toHaveProperty('count');
  });

  it('passes a PR override through only when the GM set one', () => {
    const entry = entryFromNpc(npc(), meta);
    expect(toParts([{ ...entry, professionalRating: undefined }])[0]).not.toHaveProperty(
      'professionalRating',
    );
    expect(toParts([{ ...entry, professionalRating: 4 }])[0]).toMatchObject({
      professionalRating: 4,
    });
  });
});

describe('profiles feeding the readout (FR10.5/10.6)', () => {
  it('skips rows whose roll has not landed yet', () => {
    const pending: RosterEntry = { ...entryFromNpc(npc(), meta), sheet: undefined, pending: true };
    expect(oppositionProfiles([pending])).toHaveLength(0);
  });

  it('scales action economy with the squad-size lever', () => {
    const one = oppositionProfiles([entryFromNpc(npc(), meta)]);
    const four = oppositionProfiles([{ ...entryFromNpc(npc(), meta), count: 4 }]);
    expect(actionEconomy(one).bodies).toBe(1);
    expect(actionEconomy(four).bodies).toBe(4);
    expect(actionEconomy(four).actionsPerTurn).toBe(actionEconomy(one).actionsPerTurn * 4);
  });

  it('builds party profiles from the live PC sheets, one body each', () => {
    const profiles = partyProfiles([{ id: 'c1', name: 'Static', sheet }]);
    expect(profiles).toHaveLength(1);
    expect(profiles[0]?.side).toBe('party');
    expect(profiles[0]?.name).toBe('Static');
    expect(profiles[0]?.bodies).toBe(1);
    expect(profiles[0]?.attackPool).toBeGreaterThan(0);
  });
});

describe('lever bookkeeping', () => {
  it('re-rolls only when the generation itself must change', () => {
    const base = entryFromNpc(npc(), meta);
    expect(needsRegen(base, { ...base, tierId: 'pro' })).toBe(true);
    expect(needsRegen(base, { ...base, seed: 7 })).toBe(true);
    expect(needsRegen(base, { ...base, count: 6 })).toBe(false);
    const squad = { ...base, kind: 'gruntGroup' as const };
    expect(needsRegen(squad, { ...squad, count: 6 })).toBe(true);
  });

  it('patches and removes entries immutably', () => {
    const entries = [entryFromNpc(npc(), meta), entryFromNpc(npc({ name: 'Two' }), meta)];
    const patched = patchEntry(entries, entries[1]!.id, { count: 3 });
    expect(patched[1]?.count).toBe(3);
    expect(entries[1]?.count).toBe(1);
    expect(totalBodies(patched)).toBe(4);
    expect(removeEntry(patched, entries[0]!.id)).toHaveLength(1);
  });
});
