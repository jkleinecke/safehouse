/**
 * The Improve panel's arithmetic (FR3.7, docs/CHARGEN.md §8.5) — everything
 * the panel decides before a spend is sent, with no React in sight.
 *
 * What is pinned here: which kinds of improvement a runner is offered (a
 * mundane is never offered a spell, a technomancer never power points); what
 * each kind picks from; that a draft's `from` is always read off the sheet as
 * it stands rather than remembered, so a sheet that moves under an open panel
 * re-prices instead of sending a stale spend; that the rating stepper stops
 * at the ceiling the engine names and at the Karma available, with the
 * builder's quiet words for each; that the confirm gate says the first thing
 * that stops the request; that Karma available is the projection the route
 * checks against, and the GM's own advance must also fit what is approved;
 * and the list of advances, newest first, in the words the ledger uses.
 *
 * Prices and training times are the engine's (SR5 p.107) and are asserted
 * here only where the panel quotes them. Invented names throughout (§14).
 */
import { describe, expect, it } from 'vitest';
import { SheetV1Schema, type LedgerEntry, type KarmaSpend, type SheetV1, type SheetV1Input } from '@safehouse/contracts';
import { trainingTimeOf } from '@safehouse/rules';
import {
  ADVANCE_STATE_WORDS,
  advanceRows,
  confirmWords,
  doneWords,
  draftCurrent,
  draftFor,
  draftSpend,
  improveCheck,
  improveKinds,
  improveTargets,
  isRated,
  karmaStanding,
  missingWords,
  needsSkillTarget,
  pendingSpends,
  settleDraft,
  skillTargetValue,
  stepperRefusal,
  trainingWords,
  type ImproveDraft,
} from './logic.js';

function sheet(over: Partial<SheetV1Input> = {}): SheetV1 {
  return SheetV1Schema.parse({
    v: 1,
    identity: { alias: 'Marrowlight', metatype: 'human' },
    attributes: { bod: 3, agi: 4, rea: 3, str: 3, wil: 3, log: 3, int: 4, cha: 2, edg: { max: 3, current: 2 } },
    skills: [
      { id: 'pistols', rating: 3, attr: 'agi' },
      { id: 'con', rating: 2, attr: 'cha' },
    ],
    knowledge: [{ name: 'Dock Gangs', category: 'street', rating: 2 }],
    languages: [
      { name: 'Sperethiel', native: true },
      { name: 'Portuguese', rating: 1 },
    ],
    ...over,
  } as SheetV1Input);
}

const magician = () =>
  sheet({
    attributes: { bod: 3, agi: 3, rea: 3, str: 2, wil: 4, log: 4, int: 4, cha: 3, edg: { max: 3, current: 3 }, mag: 5 },
    awakening: { kind: 'magician', tradition: 'hermetic', drain: ['wil', 'log'] },
    skills: [{ id: 'spellcasting', rating: 5, attr: 'mag' }],
    spells: [{ name: 'Nightbloom', category: 'illusion' }],
  } as Partial<SheetV1Input>);

const technomancer = () =>
  sheet({
    attributes: { bod: 3, agi: 3, rea: 3, str: 2, wil: 4, log: 4, int: 4, cha: 3, edg: { max: 3, current: 3 }, res: 4 },
    awakening: { kind: 'technomancer' },
    skills: [{ id: 'compiling', rating: 4, attr: 'res' }],
  } as Partial<SheetV1Input>);

const mysticAdept = () =>
  sheet({
    attributes: { bod: 3, agi: 3, rea: 3, str: 2, wil: 4, log: 3, int: 4, cha: 4, edg: { max: 3, current: 3 }, mag: 4 },
    awakening: { kind: 'mysticAdept', powerPoints: 1 },
    powers: [{ name: 'Sure Step', cost: 0.5 }],
    spells: [{ name: 'Harbour Fog', category: 'illusion' }],
  } as Partial<SheetV1Input>);

const kinds = (s: SheetV1) => improveKinds(s).map((o) => o.value);
const labels = (s: SheetV1, kind: ImproveDraft['kind']) => improveTargets(s, kind).map((o) => o.label);

function entry(over: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id: over.id ?? 'e1',
    characterId: 'ch-1',
    currency: 'karma',
    delta: -10,
    reason: 'Improvement',
    state: 'pending',
    createdAt: '2076-05-12T10:00:00.000Z',
    ...over,
  };
}

/** The engine's training time as the wire carries it (the route copies it the same way). */
const trainingOf = (spend: KarmaSpend) => {
  const t = trainingTimeOf(spend);
  return { steps: [...t.steps], total: t.total };
};

/** A ledger entry carrying an advance, as the route writes one. */
function advanceEntry(id: string, spend: KarmaSpend, cost: number, over: Partial<LedgerEntry> = {}): LedgerEntry {
  return entry({
    id,
    delta: -cost,
    reason: `advance · ${cost} Karma`,
    advance: { kind: 'advance', spend, cost, trainingTime: trainingOf(spend), label: 'An improvement' },
    ...over,
  });
}

describe('what a runner may improve', () => {
  it('offers spells to casters and complex forms to technomancers, and neither to a mundane', () => {
    expect(kinds(sheet())).not.toContain('spell');
    expect(kinds(sheet())).not.toContain('form');
    expect(kinds(sheet())).not.toContain('powerPoint');
    expect(kinds(magician())).toContain('spell');
    expect(kinds(magician())).not.toContain('form');
    expect(kinds(technomancer())).toContain('form');
    expect(kinds(technomancer())).not.toContain('spell');
    // Power points are creation's purchase; in play they are not for sale (p.279).
    expect(kinds(mysticAdept())).toContain('spell');
    expect(kinds(mysticAdept())).not.toContain('powerPoint');
  });

  it('offers a raise only for what the sheet holds, and always the new lines', () => {
    expect(kinds(sheet())).toEqual(expect.arrayContaining(['knowledge', 'language', 'newKnowledge', 'newLanguage']));
    const blank = sheet({ knowledge: [], languages: [{ name: 'Sperethiel', native: true }] } as Partial<SheetV1Input>);
    // Nothing to raise: no knowledge skill at all, and the one language is native.
    expect(kinds(blank)).not.toContain('knowledge');
    expect(kinds(blank)).not.toContain('language');
    expect(kinds(blank)).toEqual(expect.arrayContaining(['newKnowledge', 'newLanguage', 'attribute', 'skill', 'group']));
  });

  it('picks attributes with their rating, Magic for the Awakened and Resonance for a technomancer', () => {
    expect(labels(sheet(), 'attribute')).toContain('Agility 4');
    // Edge shows what it is, not what is left after a spend.
    expect(labels(sheet(), 'attribute')).toContain('Edge 3');
    expect(labels(sheet(), 'attribute').join(' ')).not.toContain('Magic');
    expect(labels(magician(), 'attribute')).toContain('Magic 5');
    expect(labels(technomancer(), 'attribute')).toContain('Resonance 4');
  });

  it('lists the held skills with their rating before the ones the runner does not have', () => {
    const list = improveTargets(sheet(), 'skill');
    expect(list.slice(0, 2).map((o) => o.label)).toEqual(['Con 2', 'Pistols 3']);
    expect(list.some((o) => o.label === 'Pistols (new)')).toBe(false);
    expect(list.some((o) => o.label === 'Perception (new)')).toBe(true);
  });

  it('says where a group stands, and lists knowledge, languages and what a specialisation can go on', () => {
    const grouped = sheet({
      skills: [
        { id: 'pistols', rating: 3, attr: 'agi', group: 'Firearms' },
        { id: 'longarms', rating: 3, attr: 'agi', group: 'Firearms' },
        { id: 'automatics', rating: 3, attr: 'agi', group: 'Firearms' },
      ],
    } as Partial<SheetV1Input>);
    expect(labels(grouped, 'group')).toContain('Firearms 3');
    expect(labels(sheet(), 'knowledge')).toEqual(['Dock Gangs 2']);
    // The native language has no rating to raise; only the bought one is listed.
    expect(labels(sheet(), 'language')).toEqual(['Portuguese 1']);
    expect(labels(sheet(), 'specialization')).toEqual([
      'Con',
      'Pistols',
      'Dock Gangs (knowledge)',
      'Portuguese (language)',
      'Sperethiel (language)',
    ]);
  });
});

describe('the draft', () => {
  it('opens one rating above where the sheet is', () => {
    const draft = draftFor(sheet(), 'attribute', 'agi');
    expect(draftCurrent(sheet(), draft)).toBe(4);
    expect(draft.to).toBe(5);
    expect(isRated(draft.kind)).toBe(true);
  });

  it('reads `from` off the sheet, never off the draft, so a moved sheet re-prices', () => {
    const stale: ImproveDraft = { ...draftFor(sheet(), 'attribute', 'agi'), to: 5 };
    // The GM approved someone else's raise first: Agility is 5 now.
    const moved = sheet({ attributes: { bod: 3, agi: 5, rea: 3, str: 3, wil: 3, log: 3, int: 4, cha: 2, edg: { max: 3, current: 2 } } } as Partial<SheetV1Input>);
    expect(draftSpend(moved, stale)).toEqual({ kind: 'attribute', id: 'agi', from: 5, to: 5 });
    // And the panel lifts the rating past it rather than offering a raise to where it already is.
    expect(settleDraft(moved, stale).to).toBe(6);
    expect(settleDraft(sheet(), stale).to).toBe(5);
  });

  it('withholds the spend until a new line is named, and says what is missing', () => {
    const fresh = draftFor(sheet(), 'newKnowledge');
    expect(draftSpend(sheet(), fresh)).toBeNull();
    expect(missingWords(sheet(), fresh)).toBe('Name the knowledge skill.');
    expect(draftSpend(sheet(), { ...fresh, name: 'Harbour Rumours' })).toEqual({
      kind: 'knowledge',
      name: 'Harbour Rumours',
      from: 0,
      to: 1,
      category: 'street',
    });
    const spec = draftFor(sheet(), 'specialization', 'active|pistols');
    expect(draftSpend(sheet(), spec)).toBeNull();
    expect(missingWords(sheet(), spec)).toBe('Say what the specialisation is.');
    expect(draftSpend(sheet(), { ...spec, spec: 'Revolvers' })).toEqual({
      kind: 'specialization',
      list: 'active',
      id: 'pistols',
      spec: 'Revolvers',
    });
  });

  it('asks a specific skill what it is for before it is a spend', () => {
    const draft = draftFor(sheet(), 'skill', skillTargetValue('exotic-melee'));
    expect(needsSkillTarget(sheet(), draft)).toBe(true);
    expect(draftSpend(sheet(), draft)).toBeNull();
    expect(missingWords(sheet(), draft)).toBe('Name the weapon or vehicle this skill is for.');
    expect(draftSpend(sheet(), { ...draft, name: 'Monofilament whip' })).toEqual({
      kind: 'skill',
      id: 'exotic-melee',
      from: 0,
      to: 1,
      target: 'Monofilament whip',
    });
  });
});

describe('the rating stepper', () => {
  it('stops at the ceiling the engine names, in the builder’s quiet words', () => {
    const nearMax = sheet({ skills: [{ id: 'pistols', rating: 11, attr: 'agi' }] } as Partial<SheetV1Input>);
    const draft = draftFor(nearMax, 'skill', skillTargetValue('pistols'));
    expect(draft.to).toBe(12);
    const refusal = stepperRefusal(nearMax, draft, 5_000);
    expect(refusal?.hint).toBe('at 12');
    expect(refusal?.reason).toMatch(/12/);
    expect(refusal?.ref).toBeTruthy();
  });

  it('leaves a skill already at its play maximum refused at the confirm, with the rule’s sentence', () => {
    const maxed = sheet({ skills: [{ id: 'pistols', rating: 12, attr: 'agi' }] } as Partial<SheetV1Input>);
    const draft = draftFor(maxed, 'skill', skillTargetValue('pistols'));
    const check = improveCheck(maxed, draft, { pending: [], available: 5_000 });
    expect(check.refusal?.reason).toMatch(/12/);
    expect(check.refusal?.ref).toBeTruthy();
  });

  it('stops at the Karma available, and says what the whole raise would cost', () => {
    const draft = draftFor(sheet(), 'attribute', 'agi');
    // Agility 4 → 6 is 25 + 30; with 20 available the stepper will not offer it.
    const refusal = stepperRefusal(sheet(), draft, 20);
    expect(refusal?.hint).toBe("can't afford more");
    expect(refusal?.reason).toContain('55 Karma');
    expect(refusal?.reason).toContain('20 is available');
    expect(stepperRefusal(sheet(), draft, 200)).toBeNull();
  });

  it('caps a raise at the natural maximum the engine names', () => {
    const capped = sheet({
      attributes: { bod: 3, agi: 5, rea: 3, str: 3, wil: 3, log: 3, int: 4, cha: 2, edg: { max: 3, current: 2 } },
    } as Partial<SheetV1Input>);
    const draft = draftFor(capped, 'attribute', 'agi');
    // A human's Agility stops at 6, so 6 is the last rating the stepper offers.
    expect(draft.to).toBe(6);
    expect(stepperRefusal(capped, draft, 500)?.hint).toBe('at 6');
  });
});

describe('the confirm gate', () => {
  it('quotes the price and lets the request through when the rules and the Karma allow it', () => {
    const draft = draftFor(sheet(), 'skill', skillTargetValue('pistols'));
    const check = improveCheck(sheet(), draft, { pending: [], available: 20 });
    expect(check.refusal).toBeNull();
    expect(check.quote?.label).toBe('Raise Pistols 3 → 4');
    expect(check.quote?.cost).toBe(8);
    expect(check.spend).toEqual({ kind: 'skill', id: 'pistols', from: 3, to: 4 });
  });

  it('refuses a price the Karma cannot pay, in words', () => {
    const draft = draftFor(sheet(), 'skill', skillTargetValue('pistols'));
    const check = improveCheck(sheet(), draft, { pending: [], available: 3 });
    expect(check.refusal?.reason).toBe('This costs 8 Karma; 3 is available.');
  });

  it('refuses what the rules refuse, with the rule’s own sentence and page', () => {
    const draft = draftFor(sheet(), 'newKnowledge');
    const fenced = improveCheck(magician(), { ...draftFor(magician(), 'spell'), name: 'Nightbloom' }, { pending: [], available: 100 });
    expect(fenced.refusal?.reason).toMatch(/Nightbloom/);
    expect(fenced.refusal?.ref).toBeTruthy();
    // And something still to type is said without a rule behind it.
    expect(improveCheck(sheet(), draft, { pending: [], available: 100 }).refusal).toEqual({ reason: 'Name the knowledge skill.' });
  });

  it('refuses asking again for what is already waiting on the GM', () => {
    const spend: KarmaSpend = { kind: 'attribute', id: 'agi', from: 4, to: 5 };
    const entries = [advanceEntry('e-wait', spend, 25)];
    expect(pendingSpends(entries)).toEqual([spend]);
    const draft = draftFor(sheet(), 'attribute', 'agi');
    const check = improveCheck(sheet(), draft, { pending: pendingSpends(entries), available: 100 });
    expect(check.refusal?.reason).toMatch(/waiting|already/i);
  });
});

describe('Karma available', () => {
  const entries = [
    entry({ id: 'a1', delta: 20, reason: 'Run pay', state: 'approved' }),
    entry({ id: 'p1', delta: -6, reason: 'A raise', state: 'pending' }),
    entry({ id: 'p2', delta: 9, reason: 'An award the GM has not signed', state: 'pending' }),
    entry({ id: 'r1', delta: -50, reason: 'Turned down', state: 'rejected' }),
    entry({ id: 'n1', currency: 'nuyen', delta: -4000, reason: 'A coat', state: 'approved' }),
  ];

  it('projects approved plus pending for a player, the route’s own check', () => {
    expect(karmaStanding(entries, 'player')).toEqual({ approved: 20, pending: 3, available: 23 });
  });

  it('holds the GM’s own advance to what is already approved as well', () => {
    // 23 projected, 20 approved — a spend applied at once can only use 20.
    expect(karmaStanding(entries, 'gm').available).toBe(20);
  });
});

describe('what the panel says', () => {
  it('quotes the training time, and says when there is none', () => {
    expect(trainingWords(trainingTimeOf({ kind: 'attribute', id: 'agi', from: 4, to: 5 }))).toBe('Trains for 5 weeks.');
    expect(trainingWords(trainingTimeOf({ kind: 'attribute', id: 'edg', from: 2, to: 3 }))).toBe('No training time.');
  });

  it('asks the GM for a player and improves at once for the GM', () => {
    const quote = improveCheck(sheet(), draftFor(sheet(), 'skill', skillTargetValue('pistols')), { pending: [], available: 50 }).quote;
    expect(confirmWords(quote, 'player')).toBe('Ask the GM · 8 Karma');
    expect(confirmWords(quote, 'gm')).toBe('Improve now · 8 Karma');
    expect(confirmWords(null, 'player')).toBe('Ask the GM');
  });

  it('says what became of the request', () => {
    expect(doneWords('Raise Agility 4 → 5', 'player')).toContain('goes on the sheet when it is approved');
    expect(doneWords('Raise Agility 4 → 5', 'gm', 7)).toBe('Raise Agility 4 → 5 is on the sheet (revision 7).');
    expect(doneWords('Raise Agility 4 → 5', 'gm')).toBe('Raise Agility 4 → 5 is waiting on the ledger.');
  });
});

describe('the list of advances', () => {
  it('lists only the advance entries, newest first, with price, training time and where the GM has it', () => {
    const rows = advanceRows([
      advanceEntry('older', { kind: 'skill', id: 'pistols', from: 3, to: 4 }, 8, {
        createdAt: '2076-05-01T09:00:00.000Z',
        state: 'approved',
      }),
      entry({ id: 'plain', delta: -500, currency: 'nuyen', reason: 'Ammunition', createdAt: '2076-05-20T09:00:00.000Z' }),
      advanceEntry('newer', { kind: 'attribute', id: 'agi', from: 4, to: 5 }, 25, { createdAt: '2076-05-12T09:00:00.000Z' }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(['newer', 'older']);
    expect(rows[0]).toEqual({ id: 'newer', label: 'An improvement', cost: 25, training: '5 weeks', state: 'pending', day: '2076-05-12' });
    expect(rows[1]?.training).toBe('4 days');
    expect(ADVANCE_STATE_WORDS[rows[0]!.state]).toBe('waiting on the GM');
    expect(ADVANCE_STATE_WORDS.approved).toBe('on the sheet');
  });
});
