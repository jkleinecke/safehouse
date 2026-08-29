/**
 * The magic toolkit's engine half (M8): spirits derived from Force (FR8.3),
 * bonded foci as toggled modifier sources (FR8.4), service and reagent
 * counters that floor at zero, and the sustaining arithmetic (FR8.2).
 */
import { describe, expect, it } from 'vitest';
import type { Modifier, SheetV1Input } from '@safehouse/contracts';
import { SheetV1Schema } from '@safehouse/contracts';
import {
  applySpiritSustaining,
  deriveCharacter,
  deriveSpirit,
  focusModifiers,
  focusSummary,
  grantServices,
  modifiersForFocus,
  restockReagents,
  setReagents,
  setServices,
  spendReagents,
  spendServices,
  spiritAttributes,
  spiritDisplayName,
  spiritInitiative,
  spiritSheet,
  spiritSustainedSpellIds,
  sustainingPenalty,
  sustainingReport,
  type BondedFocus,
  type SpiritProfile,
} from '../src/index.js';

// ---------------------------------------------------------------------------
// Spirits (FR8.3)
// ---------------------------------------------------------------------------

/** A Force 6 spirit with the GM's own offsets typed in (no book data ships). */
function airish(force = 6): SpiritProfile {
  return {
    type: 'air',
    force,
    attributeOffsets: { bod: -2, agi: 3, rea: 4, str: -3 },
    skills: [{ id: 'unarmed combat', attr: 'agi' }],
  };
}

describe('spiritSheet / deriveSpirit (FR8.3)', () => {
  it('derives every attribute from Force plus the GM-entered offset', () => {
    const attrs = spiritAttributes(airish(6));
    expect(attrs.bod).toBe(4);
    expect(attrs.agi).toBe(9);
    expect(attrs.rea).toBe(10);
    expect(attrs.str).toBe(3);
    // Untouched codes are exactly Force — the honest default.
    expect(attrs.wil).toBe(6);
    expect(attrs.log).toBe(6);
    expect(attrs.int).toBe(6);
    expect(attrs.cha).toBe(6);
  });

  it('never lets an offset push an attribute below 1', () => {
    const attrs = spiritAttributes({ type: 'tiny', force: 1, attributeOffsets: { str: -5 } });
    expect(attrs.str).toBe(1);
  });

  it('produces a schema-valid SheetV1 with Force-scaled Essence, MAG and Edge', () => {
    const sheet = spiritSheet(airish(6));
    expect(SheetV1Schema.safeParse(sheet).success).toBe(true);
    expect(sheet.attributes.mag).toBe(6);
    expect(sheet.attributes.ess).toBe(6);
    expect(sheet.attributes.edg).toEqual({ max: 3, current: 3 });
    expect(sheet.identity.metatype).toBe('spirit');
    expect(sheet.skills[0]).toMatchObject({ id: 'unarmed combat', attr: 'agi', rating: 6 });
  });

  it('names itself off type and Force when the GM typed no name', () => {
    expect(spiritDisplayName(airish(4))).toBe('air spirit (Force 4)');
    expect(spiritDisplayName({ ...airish(4), name: 'Whisper' })).toBe('Whisper');
  });

  it('gives a spirit its initiative dice through the pipeline, with provenance', () => {
    const init = spiritInitiative(airish(6));
    // REA (6+4) + INT (6) = 16, on 2d6.
    expect(init.base).toBe(16);
    expect(init.dice).toBe(2);
    const receipt = init.diceBreakdown.map((b) => b.label).join(' | ');
    expect(receipt).toContain('air spirit — 2d6 initiative');
    expect(init.diceBreakdown.some((b) => b.source === 'power' && b.value === 1)).toBe(true);
    // The breakdown always sums to the value (Principle 3).
    expect(init.diceBreakdown.reduce((s, b) => s + b.value, 0)).toBe(init.dice);
    expect(init.breakdown.reduce((s, b) => s + b.value, 0)).toBe(init.base);
  });

  it('honours a GM-set initiative dice count on the astral line too', () => {
    const three = spiritInitiative({ ...airish(6), initiativeDice: 3 }, 'astral');
    expect(three.dice).toBe(3);
    // Astral base is INT×2.
    expect(three.base).toBe(12);
  });

  it('scales monitors and pools with Force, and every pool carries a receipt', () => {
    const derived = deriveSpirit(airish(6));
    // 8 + ⌈BOD/2⌉ with BOD 4.
    expect(derived.monitors.physical.value).toBe(10);
    // 8 + ⌈WIL/2⌉ with WIL 6.
    expect(derived.monitors.stun.value).toBe(11);
    const unarmed = derived.pools['skill.unarmed combat'];
    expect(unarmed?.total).toBe(15); // AGI 9 + rating 6
    expect(unarmed?.breakdown.reduce((s, b) => s + b.value, 0)).toBe(15);
    // Defense is REA + INT, straight off the Force-derived attributes.
    expect(derived.pools['defense']?.total).toBe(16);
  });

  it('scales with Force: a Force 3 spirit is strictly weaker than a Force 9 one', () => {
    const weak = deriveSpirit(airish(3));
    const strong = deriveSpirit(airish(9));
    expect(strong.pools['defense']!.total).toBeGreaterThan(weak.pools['defense']!.total);
    expect(strong.monitors.physical.value).toBeGreaterThan(weak.monitors.physical.value);
  });
});

// ---------------------------------------------------------------------------
// Services (FR8.3)
// ---------------------------------------------------------------------------

describe('spirit services', () => {
  it('spends one service at a time and reports what is left', () => {
    const change = spendServices({ remaining: 3, initial: 3 });
    expect(change.spent).toBe(1);
    expect(change.after.remaining).toBe(2);
    expect(change.after.initial).toBe(3);
    expect(change.exhausted).toBe(false);
  });

  it('floors at zero and reports the shortfall instead of going negative', () => {
    const change = spendServices({ remaining: 1, initial: 4 }, 3);
    expect(change.spent).toBe(1);
    expect(change.shortfall).toBe(2);
    expect(change.after.remaining).toBe(0);
    expect(change.exhausted).toBe(true);
    // And again on an already-empty spirit.
    const again = spendServices(change.after, 2);
    expect(again.after.remaining).toBe(0);
    expect(again.spent).toBe(0);
    expect(again.shortfall).toBe(2);
  });

  it('grants and sets, keeping `initial` as the high-water mark', () => {
    expect(grantServices({ remaining: 2, initial: 3 }, 4).after).toEqual({ remaining: 6, initial: 6 });
    expect(setServices({ remaining: 6, initial: 6 }, 2).after).toEqual({ remaining: 2, initial: 6 });
    expect(setServices({ remaining: 2, initial: 6 }, -5).after.remaining).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Foci (FR8.4)
// ---------------------------------------------------------------------------

function focus(over: Partial<BondedFocus> = {}): BondedFocus {
  return {
    id: 'f1',
    name: 'Riverstone',
    kind: 'power focus',
    force: 3,
    bonded: true,
    active: true,
    targets: ['pool.skill.spellcasting'],
    ...over,
  };
}

describe('bonded foci as modifier sources (FR8.4)', () => {
  it('contributes Force on its declared targets when live', () => {
    const mods = modifiersForFocus(focus());
    expect(mods).toHaveLength(1);
    expect(mods[0]).toMatchObject({
      target: 'pool.skill.spellcasting',
      op: 'add',
      value: 3,
      active: true,
    });
    expect(mods[0]!.source).toEqual({ kind: 'power', ref: 'Riverstone' });
    expect(mods[0]!.note).toContain('Force 3');
  });

  it('always names the focus on the receipt, whatever the GM wrote in the note', () => {
    // The pool breakdown carries `{ label, value, source }` — no `ref` — so if
    // a GM's flavour note replaced the name, the receipt said "+2, a band of
    // scorched brass" and the table could not tell which toggle to flip.
    const mods = modifiersForFocus(focus({ note: 'a band of scorched brass' }));
    expect(mods[0]!.note).toBe('Riverstone — a band of scorched brass');
    // With no note it still says which focus, its kind, and its Force.
    expect(modifiersForFocus(focus())[0]!.note).toBe('Riverstone (power focus) — Force 3');
  });

  it('contributes nothing while unbonded, and nothing while switched off', () => {
    expect(modifiersForFocus(focus({ bonded: false }))).toEqual([]);
    expect(modifiersForFocus(focus({ active: false }))).toEqual([]);
    expect(modifiersForFocus(focus({ bonded: false, active: false }))).toEqual([]);
  });

  it('passes explicit modifiers through, forced active and re-sourced to the focus', () => {
    const custom: Modifier = {
      id: 'boost',
      source: { kind: 'quality', ref: 'wrong' },
      target: 'limit.mental',
      op: 'add',
      value: 2,
      active: false,
      note: 'sustaining focus',
    };
    const mods = modifiersForFocus(focus({ mods: [custom], sourceKind: 'spell' }));
    expect(mods[0]).toMatchObject({ target: 'limit.mental', value: 2, active: true });
    expect(mods[0]!.source).toEqual({ kind: 'spell', ref: 'Riverstone' });
    expect(mods[0]!.id).toBe('focus.f1.boost');
  });

  it('changes the derived pool and shows up in that pool’s provenance', () => {
    const input: SheetV1Input = {
      v: 1,
      identity: { alias: 'Ash', metatype: 'elf', portraitId: null },
      attributes: {
        bod: 3, agi: 3, rea: 4, str: 2, wil: 5, log: 4, int: 5, cha: 4,
        edg: { max: 3, current: 3 }, ess: 6, mag: 6, res: 0,
      },
      skills: [{ id: 'spellcasting', rating: 6, attr: 'mag' }],
      spells: [{ name: 'Ash’s own spell' }],
    };
    const sheet = SheetV1Schema.parse(input);
    const off = deriveCharacter(sheet, { situational: focusModifiers([focus({ active: false })]) });
    const on = deriveCharacter(sheet, { situational: focusModifiers([focus()]) });
    expect(off.pools['skill.spellcasting']!.total).toBe(12);
    expect(on.pools['skill.spellcasting']!.total).toBe(15);
    const line = on.pools['skill.spellcasting']!.breakdown.find((b) => b.value === 3 && b.source === 'power');
    expect(line).toBeDefined();
    expect(line!.label).toContain('Riverstone');
    // Provenance still sums exactly to the total (Principle 3).
    expect(on.pools['skill.spellcasting']!.breakdown.reduce((s, b) => s + b.value, 0)).toBe(15);
  });

  it('summarises a rack: bonded, active, actually contributing', () => {
    const rack = [
      focus(),
      focus({ id: 'f2', name: 'Cold iron', bonded: true, active: false }),
      focus({ id: 'f3', name: 'Unbonded blade', bonded: false, active: true }),
      focus({ id: 'f4', name: 'Empty', targets: [] }),
    ];
    expect(focusSummary(rack)).toEqual({ bonded: 3, active: 3, contributing: 1 });
    expect(focusModifiers(rack)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Reagents (FR8.4)
// ---------------------------------------------------------------------------

describe('reagent counter (FR8.4)', () => {
  it('spends drams and reports the new count', () => {
    expect(spendReagents(20, 6)).toMatchObject({ before: 20, after: 14, applied: 6, shortfall: 0 });
  });

  it('cannot go negative, however hard it is pushed', () => {
    expect(spendReagents(4, 10)).toMatchObject({ after: 0, applied: 4, shortfall: 6 });
    expect(spendReagents(0, 3).after).toBe(0);
    expect(spendReagents(-5, 1).after).toBe(0);
    expect(setReagents(10, -4).after).toBe(0);
    expect(restockReagents(-2, 5).after).toBe(5);
  });

  it('restocks and sets', () => {
    expect(restockReagents(4, 8).after).toBe(12);
    expect(setReagents(12, 3).after).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Sustaining (FR8.2 × FR8.3)
// ---------------------------------------------------------------------------

describe('sustaining exemptions (FR8.2)', () => {
  const sustained = [
    { id: 'levitate', name: 'Levitate', exempt: false },
    { id: 'armour', name: 'Armour', exempt: false },
  ];

  it('charges the caster −2 per spell they hold themselves', () => {
    expect(sustainingPenalty(sustained)).toBe(-4);
  });

  it('exempts a spell a live spirit is sustaining for the caster', () => {
    const spirits = [{ id: 's1', name: 'Whisper', sustainingSpellId: 'levitate', active: true }];
    expect(spiritSustainedSpellIds(spirits)).toEqual(['levitate']);
    const next = applySpiritSustaining(sustained, spirits);
    expect(next.find((s) => s.id === 'levitate')!.exempt).toBe(true);
    expect(next.find((s) => s.id === 'armour')!.exempt).toBe(false);
    expect(sustainingPenalty(next)).toBe(-2);
  });

  it('ignores a dismissed spirit — the caster is holding it again', () => {
    const spirits = [{ id: 's1', name: 'Whisper', sustainingSpellId: 'levitate', active: false }];
    expect(spiritSustainedSpellIds(spirits)).toEqual([]);
    expect(sustainingPenalty(applySpiritSustaining(sustained, spirits))).toBe(-4);
  });

  it('never adds a penalty back to something already exempt', () => {
    const quickened = [{ id: 'armour', name: 'Armour', exempt: true }];
    expect(applySpiritSustaining(quickened, [])).toEqual(quickened);
    expect(sustainingPenalty(applySpiritSustaining(quickened, []))).toBe(0);
  });

  it('reports who is holding what, and why it is free', () => {
    const report = sustainingReport(
      [...sustained, { id: 'quickened', name: 'Increase Reflexes', exempt: true }],
      [{ id: 's1', name: 'Whisper', sustainingSpellId: 'levitate', active: true }],
    );
    expect(report.penalty).toBe(-2);
    expect(report.selfSustained).toBe(1);
    expect(report.lines.find((l) => l.id === 'levitate')).toMatchObject({
      exempt: true,
      exemptBy: 'spirit',
      spiritName: 'Whisper',
      penalty: 0,
    });
    expect(report.lines.find((l) => l.id === 'quickened')).toMatchObject({
      exemptBy: 'focus_or_quickening',
      spiritId: null,
    });
    expect(report.lines.find((l) => l.id === 'armour')).toMatchObject({
      exempt: false,
      exemptBy: null,
      penalty: -2,
    });
  });
});
