/**
 * The Karma step's pure core (`logic.ts`, `taps.ts`), run against builds the
 * engine made from concept cards — invented runners only (§14).
 *
 * Pinned: a raise is one spend that extends and shortens, and takes back only
 * what this step added; every price is the engine's, Uncouth and Uneducated
 * doubling included; a tap that breaks a creation cap refuses with the
 * validator's sentence and page, one the pool cannot pay refuses in words,
 * and one that only leaves points to spend on another step goes, with the
 * engine's note; contacts are quoted against their own pool until it runs
 * out and refused past 7; spirits past Charisma, foci past twice Magic and
 * power points past Magic refuse; issues land under the line they name; and
 * the carry-over says what the cap would lose.
 */
import { describe, expect, it } from 'vitest';
import { BuildPurchaseSchema, CharacterBuildSchema, type CharacterBuild, type Issue } from '@safehouse/contracts';
import { powerPointsBought, setMagicKind, setPowerPointsBought as withPowerPoints, tallyBuild } from '@safehouse/rules';
import { SETTINGS, analysisOf, conceptBuild } from '../../testing.js';
import {
  carrySentence,
  carryState,
  chainTop,
  companionSpend,
  contactQuote,
  focusCandidates,
  focusSpend,
  gateTap,
  karmaAttributes,
  karmaLines,
  knownPickIds,
  learnableSkills,
  placeIssues,
  raiseFloor,
  shortfall,
  specSpend,
  specTargets,
  spendLabel,
  withContactPatch,
  withLower,
  withNewContact,
  withRaise,
  withSpend,
  withoutContact,
  withoutSpend,
} from './logic.js';
import { createKarmaTaps } from './taps.js';

/** A troll bruiser: Body at its maximum, Charisma 1, Automatics 5, 25 Karma left. */
const bruiser = () => conceptBuild('muscle', 'Slab Harrow');
/** A hermetic street mage: Magic 6, Logic at its maximum, Charisma 3. */
const mage = () => conceptBuild('street-mage', 'Vesper Quill');

function tapsOf(build: CharacterBuild) {
  const a = analysisOf(build);
  return createKarmaTaps({ build, settings: SETTINGS, budgets: a.budgets, probe: a.probe });
}

const REA = { kind: 'attribute', id: 'rea' } as const;

describe('raises are one spend per thing raised', () => {
  it('extends the spend at the top of the chain and takes it back a rating at a time', () => {
    const b0 = bruiser();
    const b1 = withRaise(b0, REA, 4);
    expect(b1.karma.spends).toEqual([{ kind: 'attribute', id: 'rea', from: 4, to: 5 }]);
    const b2 = withRaise(b1, REA, 5);
    expect(b2.karma.spends).toEqual([{ kind: 'attribute', id: 'rea', from: 4, to: 6 }]);
    expect(raiseFloor(b2, REA, 6)).toBe(4);
    expect(withLower(b2, REA, 6).karma.spends).toEqual([{ kind: 'attribute', id: 'rea', from: 4, to: 5 }]);
    expect(withLower(b1, REA, 5).karma.spends).toEqual([]);
    // Nothing this step raised: nothing to take back.
    expect(raiseFloor(b0, REA, 4)).toBe(4);
    expect(withLower(b0, REA, 4)).toBe(b0);
  });

  it('leaves a chain the rating moved past for the ledger, and starts a new spend', () => {
    const stale = withSpend(bruiser(), { kind: 'skill', id: 'automatics', from: 3, to: 4 });
    expect(chainTop(stale, { kind: 'skill', id: 'automatics' }, 5)).toBeNull();
    const next = withRaise(stale, { kind: 'skill', id: 'automatics' }, 5);
    expect(next.karma.spends).toHaveLength(2);
    expect(next.karma.spends[1]).toEqual({ kind: 'skill', id: 'automatics', from: 5, to: 6 });
  });

  it('matches a specific skill by its target in any case', () => {
    const b = withRaise(bruiser(), { kind: 'skill', id: 'exotic-ranged-weapon', target: 'Net Gun' }, 0);
    expect(chainTop(b, { kind: 'skill', id: 'exotic-ranged-weapon', target: 'net gun' }, 1)).toBe(0);
  });

  it('says each spend in a line of its own', () => {
    expect(spendLabel({ kind: 'attribute', id: 'agi', from: 3, to: 5 })).toBe('Agility 3 → 5');
    expect(spendLabel({ kind: 'skill', id: 'pistols', from: 0, to: 1 })).toBe('Pistols, new at 1');
    expect(spendLabel({ kind: 'spirit', type: 'fire', services: 3 })).toBe('Bound fire spirit, 3 services');
    expect(spendLabel({ kind: 'spell', name: 'Glow Ward', category: 'ritual' })).toBe('Ritual: Glow Ward');
    expect(spendLabel({ kind: 'powerPoint', count: 1 })).toBe('1 power point');
  });

  it('shows Magic only to a runner who can use it', () => {
    const b = bruiser();
    expect(karmaAttributes(b, analysisOf(b).ratings)).not.toContain('mag');
    const m = mage();
    expect(karmaAttributes(m, analysisOf(m).ratings)).toContain('mag');
    expect(karmaAttributes(m, analysisOf(m).ratings)).not.toContain('res');
  });
});

describe('what a tap costs and whether it may go', () => {
  it('quotes the engine’s price and opens a tap inside the caps', () => {
    const tap = tapsOf(bruiser()).raise({ kind: 'skill', id: 'automatics' }, 5);
    expect(tap.price).toBe(12);
    expect(tap.gate).toEqual({ open: true, refusal: null, consequences: [] });
  });

  it("refuses a skill past the creation maximum with the validator's sentence and page", () => {
    const at6 = withRaise(bruiser(), { kind: 'skill', id: 'automatics' }, 5);
    const tap = tapsOf(at6).raise({ kind: 'skill', id: 'automatics' }, 6);
    expect(tap.gate.open).toBe(false);
    expect(tap.gate.refusal?.reason).toBe('Automatics 7 is over the creation maximum of 6.');
    expect(tap.gate.refusal?.ref).toEqual({ book: 'SR5', page: 88 });
  });

  it('names the cap before the shortfall when a tap breaks both', () => {
    // Willpower 5 → 6 costs 30 of 25, and would put a second attribute at its maximum.
    const tap = tapsOf(mage()).raise({ kind: 'attribute', id: 'wil' }, 5);
    expect(tap.price).toBe(30);
    expect(tap.gate.refusal?.reason).toMatch(/^Only one attribute may start at its natural maximum/);
    expect(tap.gate.refusal?.ref).toEqual({ book: 'SR5', page: 66 });
  });

  it('refuses a price the pool cannot pay, in words', () => {
    const tap = tapsOf(bruiser()).raise({ kind: 'attribute', id: 'str' }, 8);
    expect(tap.price).toBe(45);
    expect(tap.gate.refusal?.reason).toBe('This costs 45 Karma and 25 are left.');
    expect(shortfall({ amount: 5, remaining: -3 })?.reason).toBe('Karma is already 3 over; take something back first.');
    expect(shortfall({ amount: 5, remaining: 5 })).toBeNull();
    expect(shortfall({ amount: 0, remaining: -3 })).toBeNull();
  });

  it('lets a raise go that leaves points to spend on another step, and says so', () => {
    const tap = tapsOf(mage()).raise({ kind: 'attribute', id: 'int' }, 4);
    expect(tap.gate.open).toBe(true);
    expect(tap.gate.consequences.map((i) => i.code)).toEqual(['knowledge-points-unspent']);
    expect(tap.gate.consequences[0]?.step).toBe(6);
  });

  it('sorts a probe: caps first, then the shortfall, then an overspend it could not price', () => {
    const issue = (code: string): Issue => ({ code, severity: 'error', step: 8, message: code, ref: { book: 'SR5', page: 98 } });
    expect(gateTap({ blocking: [], introduced: [issue('karma-overspent')], warned: [] }).refusal?.reason).toBe('karma-overspent');
    expect(gateTap({ blocking: [], introduced: [issue('karma-overspent'), issue('spirits-over-charisma')], warned: [] }).refusal?.reason).toBe(
      'spirits-over-charisma',
    );
    expect(gateTap({ blocking: [], introduced: [issue('skill-points-unspent')], warned: [] }).open).toBe(true);
  });

  it("doubles Uncouth's and Uneducated's prices through the engine, not the screen", () => {
    const plain = tapsOf(bruiser());
    const rude = bruiser();
    const uncouth = tapsOf({ ...rude, qualities: [{ name: 'Uncouth', type: 'negative', karma: 14, rating: null, mods: [] }] } as CharacterBuild);
    expect(plain.raise({ kind: 'skill', id: 'intimidation' }, 3).price).toBe(8);
    expect(uncouth.raise({ kind: 'skill', id: 'intimidation' }, 3).price).toBe(16);
    expect(uncouth.raise({ kind: 'skill', id: 'automatics' }, 5).price).toBe(12);
    const unschooled = tapsOf({ ...rude, qualities: [{ name: 'Uneducated', type: 'negative', karma: 8, rating: null, mods: [] }] } as CharacterBuild);
    expect(plain.raise({ kind: 'knowledge', name: 'Close protection', category: 'professional' }, 2).price).toBe(3);
    expect(unschooled.raise({ kind: 'knowledge', name: 'Close protection', category: 'professional' }, 2).price).toBe(6);
    expect(unschooled.raise({ kind: 'knowledge', name: 'Gang turf lines', category: 'street' }, 3).price).toBe(4);
  });

  it('refuses a second specialisation on one skill at creation', () => {
    const b = bruiser();
    const target = specTargets(analysisOf(b).ratings).find((t) => t.value === 'active|automatics')!;
    expect(target.label).toBe('Automatics');
    const once = withSpend(b, specSpend(target, 'Bullpups'));
    const again = tapsOf(once).add(specSpend(target, 'Carbines'), 'spec');
    expect(tapsOf(b).add(specSpend(target, 'Bullpups'), 'spec').price).toBe(7);
    expect(again.gate.refusal?.reason).toMatch(/specialisations; one is allowed at creation/);
    // Once specialised, the skill is no longer offered: the select never sits on a refusal for a spec not yet taken.
    expect(specTargets(analysisOf(once).ratings).some((t) => t.value === 'active|automatics')).toBe(false);
  });

  it('says what specialising a skill rated through a group costs the group', () => {
    const face = conceptBuild('face');
    const con = specTargets(analysisOf(face).ratings).find((t) => t.value === 'active|con');
    expect(con?.label).toBe('Con — stops the Acting group being raised');
  });

  it('gives each refusal a few neutral words for before it is pressed', () => {
    expect(shortfall({ amount: 45, remaining: 25 })?.hint).toBe("can't afford 45");
    expect(shortfall({ amount: 5, remaining: -3 })?.hint).toBe('Karma overspent');
    const cap = tapsOf(withRaise(bruiser(), { kind: 'skill', id: 'automatics' }, 5)).raise({ kind: 'skill', id: 'automatics' }, 7);
    expect(cap.gate.refusal?.hint).toBe('at the cap');
  });
});

describe('contacts', () => {
  it('quote free contact Karma until the pool runs out, then Karma', () => {
    const b0 = bruiser(); // Charisma 1: 3 contact Karma
    const add = tapsOf(b0).contact(withNewContact, 'new');
    expect(add).toMatchObject({ contactKarma: 2, karma: 0 });
    expect(contactQuote(add)).toEqual({ amount: 2, pool: 'contactKarma', lead: '' });
    const b1 = withNewContact(b0);
    const second = tapsOf(b1).contact((b) => withContactPatch(b, 0, { connection: 2 }), 'c');
    expect(second).toMatchObject({ contactKarma: 1, karma: 0 });
    const b2 = withContactPatch(b1, 0, { connection: 2 });
    const third = tapsOf(b2).contact((b) => withContactPatch(b, 0, { connection: 3 }), 'c');
    expect(third).toMatchObject({ contactKarma: 0, karma: 1 });
    expect(contactQuote(third)).toEqual({ amount: 1, pool: 'karma', lead: '' });
    expect(contactQuote({ karma: 1, contactKarma: 1 }).lead).toBe('uses the last 1 contact Karma and');
  });

  it('refuses the eighth point on one contact with the validator’s sentence', () => {
    const b = withContactPatch(withNewContact(mage()), 0, { name: 'Rook', connection: 4, loyalty: 3 });
    const tap = tapsOf(b).contact((x) => withContactPatch(x, 0, { loyalty: 4 }), 'l');
    expect(tap.gate.refusal?.reason).toBe('Rook costs 8 Karma; 7 is the most at creation.');
    expect(tap.gate.refusal?.ref).toEqual({ book: 'SR5', page: 98 });
  });

  it('keep every field inside the contract as it is typed', () => {
    const b = withContactPatch(withNewContact(mage()), 0, { name: 'x'.repeat(250), connection: 40, loyalty: 0, notes: 'y'.repeat(5000) });
    const c = b.karma.contacts[0]!;
    expect(c.name).toHaveLength(200);
    expect(c.connection).toBe(12);
    expect(c.loyalty).toBe(1);
    expect(c.notes).toHaveLength(4000);
    expect(withoutContact(b, 0).karma.contacts).toEqual([]);
    expect(withContactPatch(b, 5, { name: 'nobody' })).toBe(b);
  });
});

describe('spirits, foci and power points', () => {
  it('binds spirits up to Charisma and refuses the next', () => {
    let b = mage();
    for (let i = 0; i < 3; i++) b = withSpend(b, companionSpend('spirit', 'fire', 1));
    const fourth = tapsOf(b).add(companionSpend('spirit', 'air', 1), 'spirit');
    expect(fourth.price).toBe(1);
    expect(fourth.gate.refusal?.reason).toBe('4 bound spirits; Charisma 3 allows 3.');
    expect(companionSpend('sprite', ' relay ', 5000)).toEqual({ kind: 'sprite', type: 'relay', tasks: 999 });
  });

  it('offers the gear lines that read as foci, bonded at the Focus Table’s price', () => {
    const charm = BuildPurchaseSchema.parse({
      list: 'gear',
      kind: 'gear',
      name: 'Tidecall Charm',
      category: 'power focus',
      rating: 2,
      cost: 36_000,
      item: { name: 'Tidecall Charm', qty: 1 },
    });
    const b = { ...mage(), purchases: [charm] };
    const [candidate] = focusCandidates(b);
    expect(candidate).toMatchObject({ index: 0, types: ['power'], bonded: 0, free: 1, force: 2 });
    const spend = focusSpend(charm, 'power', 2);
    expect(spend).toMatchObject({ kind: 'focus', focusType: 'power', force: 2, bondKarma: 12 });
    expect(tapsOf(b).add(spend, 'focus').price).toBe(12);
    const bonded = withSpend(b, spend);
    expect(focusCandidates(bonded)[0]).toMatchObject({ bonded: 1, free: 0 });
    // Nothing that reads as a focus: nothing to bond.
    expect(focusCandidates(mage())).toEqual([]);
  });

  it('refuses a bond past twice Magic in total Force', () => {
    const wards = BuildPurchaseSchema.parse({
      list: 'gear',
      kind: 'gear',
      name: 'Sustaining Focus',
      qty: 2,
      cost: 56_000,
      item: { name: 'Sustaining Focus', qty: 2 },
    });
    const b = withSpend({ ...mage(), purchases: [wards] }, focusSpend(wards, 'spell', 6));
    const tap = tapsOf(b).add(focusSpend(wards, 'spell', 7), 'focus');
    expect(tap.gate.refusal?.reason).toBe('Bonded foci total Force 13; Magic 6 allows 12.');
  });

  it('buys power points as one line that grows and shrinks, refused past Magic', () => {
    const adept = setMagicKind(mage(), 'mysticAdept');
    const two = withPowerPoints(adept, 2);
    expect(two.karma.spends).toEqual([{ kind: 'powerPoint', count: 2 }]);
    expect(withPowerPoints(two, 3).karma.spends).toEqual([{ kind: 'powerPoint', count: 3 }]);
    expect(withPowerPoints(two, 0).karma.spends).toEqual([]);
    const split = withSpend(withSpend(adept, { kind: 'powerPoint', count: 1 }), { kind: 'powerPoint', count: 2 });
    expect(withPowerPoints(split, 1).karma.spends).toEqual([{ kind: 'powerPoint', count: 1 }]);
    const six = withPowerPoints(adept, 6);
    expect(powerPointsBought(six)).toBe(6);
    const seventh = tapsOf(six).change((x) => withPowerPoints(x, 7), 'pp', 5);
    expect(seventh.gate.refusal?.reason).toBe('7 power points bought; Magic 6 allows 6.');
  });
});

describe('the pool, the carry-over and where issues sit', () => {
  it('says what the cap would lose, and an overspend, in words', () => {
    const fresh = analysisOf(bruiser());
    const c = carryState(fresh.budgets, SETTINGS);
    expect(c).toEqual({ left: 25, overspent: 0, carried: 7, lost: 18, cap: 7 });
    expect(carrySentence(c)).toBe('At most 7 Karma carries into play, so 18 more must be spent before this step is done.');
    expect(carrySentence({ left: 5, overspent: 0, carried: 5, lost: 0, cap: 7 })).toBe('All 5 carries into play (at most 7 may).');
    expect(carrySentence({ left: 0, overspent: 0, carried: 0, lost: 0, cap: 7 })).toBe('Every point of Karma is spent; nothing carries into play.');
    const over = withRaise(bruiser(), { kind: 'attribute', id: 'str' }, 8);
    const oc = carryState(analysisOf(over).budgets, SETTINGS);
    expect(oc).toMatchObject({ left: 0, overspent: 20 });
    expect(carrySentence(oc)).toBe('20 Karma overspent: take something back before this step is done.');
  });

  it('adds up where the Karma came from to what is left', () => {
    let b = CharacterBuildSchema.parse({
      ...bruiser(),
      qualities: [
        { name: 'Toughened Hide', type: 'positive', karma: 6, rating: null, mods: [] },
        { name: 'Old Debt', type: 'negative', karma: 10, rating: null, mods: [] },
      ],
      karma: { toNuyen: 2, spends: [], contacts: [] },
    });
    b = withRaise(b, { kind: 'skill', id: 'automatics' }, 5);
    b = withContactPatch(withNewContact(b), 0, { name: 'Rook', connection: 3 }); // 4 of 3 free: 1 from Karma
    const tally = tallyBuild(b, SETTINGS);
    const lines = karmaLines(b, tally);
    expect(lines.map((l) => l.key)).toEqual(['start', 'negative', 'positive', 'nuyen', 'spends', 'contacts']);
    expect(lines.reduce((s, l) => s + l.amount, 0)).toBe(analysisOf(b).budgets.pools.karma.remaining);
  });

  it('files issues under the spend or contact they name, the rest at the top', () => {
    const at = (path: string): Issue => ({ code: path, severity: 'error', step: 8, message: path, ref: { book: 'SR5', page: 98 }, path });
    const placed = placeIssues([at('karma.spends.2'), at('karma.spends.2.focusType'), at('karma.contacts.0.name'), at('karma.spends'), at('karma')]);
    expect(placed.spends.get(2)?.map((i) => i.code)).toEqual(['karma.spends.2', 'karma.spends.2.focusType']);
    expect(placed.contacts.get(0)?.map((i) => i.code)).toEqual(['karma.contacts.0.name']);
    expect(placed.general.map((i) => i.code)).toEqual(['karma.spends', 'karma']);
  });

  it('takes a spend back by its place in the list', () => {
    const b = withSpend(withSpend(bruiser(), { kind: 'powerPoint', count: 1 }), { kind: 'form', name: 'Static Veil' });
    expect(withoutSpend(b, 0).karma.spends).toEqual([{ kind: 'form', name: 'Static Veil' }]);
    expect(withoutSpend(b, 9)).toBe(b);
  });
});

describe('what can be learned', () => {
  it('offers skills not yet rated that this runner may take', () => {
    const b = bruiser();
    const ids = learnableSkills(analysisOf(b).ratings, analysisOf(b).eligibility).map((r) => r.id);
    expect(ids).not.toContain('automatics');
    expect(ids).not.toContain('spellcasting');
    expect(ids).toContain('sneaking');
  });

  it('knows the spells a runner already has, granted or bought', () => {
    const b = withSpend(
      { ...mage(), grants: { ...mage().grants, spells: [{ name: 'Glow Ward', catalogueId: 'sp-1' }] } },
      { kind: 'spell', name: 'Quiet Step', catalogueId: 'sp-2' },
    );
    expect([...knownPickIds(b, 'spell')].sort()).toEqual(['sp-1', 'sp-2']);
    expect(knownPickIds(b, 'form').size).toBe(0);
  });
});
