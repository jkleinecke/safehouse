/**
 * Picking a concept card, planned before it happens (docs/CHARGEN.md §4.4
 * Step 1: a card "pre-fills … all editable"; "start from nothing" is a card
 * too; nothing is lost by going back).
 *
 * Pins the claims the Concept step makes on its confirm: that an untouched
 * card can be swapped for another without a question, that a card over the
 * player's own work asks first and names what changes, that a player's own
 * metatype survives a card while a previous card's suggestion does not (and
 * is named as theirs when the next card's row cannot hold it), that the
 * chosen card can be put back with only the player's changes named, that
 * "start from nothing" is `emptyBuild`'s spend with the identity kept, and
 * that a tap applies, asks or does nothing exactly as the plan says.
 * Every build is made the app's way — `emptyBuild`, then the engine's
 * `applyConcept` — over invented runners.
 */
import { describe, expect, it } from 'vitest';
import { BuildContactSchema, BuildQualitySchema, type CharacterBuild } from '@safehouse/contracts';
import {
  BLANK_CONCEPT_ID,
  CONCEPT_PRESETS,
  applyConcept,
  clearSpend,
  conceptPreset,
  emptyBuild,
  setAttributePoints,
  setMetatype,
} from '@safehouse/rules';
import { SETTINGS, blankBuild, conceptBuild } from '../../testing.js';
import {
  applyCard,
  cardBaseline,
  cardFills,
  changeLine,
  conceptPlan,
  keptSentence,
  listWords,
  magicWords,
  ownChanges,
  ownMetatype,
  ownSections,
  pickCard,
  planGoLabel,
  planTitle,
  startFromNothing,
} from './plan.js';

const withIdentity = (b: CharacterBuild): CharacterBuild => ({
  ...b,
  identity: { ...b.identity, realName: 'Mara Quell', age: 27, sex: 'female' },
});

const CONTACT = BuildContactSchema.parse({ name: 'Old Wren', role: 'fixer', connection: 3, loyalty: 2 });
const QUALITY = BuildQualitySchema.parse({ name: 'Invented Knack', type: 'positive', karma: 5 });

/** A card-made build with one attribute point moved by hand. */
function tweaked(id = 'muscle'): CharacterBuild {
  const b = conceptBuild(id);
  return setAttributePoints(setAttributePoints(b, 'bod', b.attributes.bod - 1), 'log', b.attributes.log + 1);
}

describe('the baseline: what the current card alone would have written', () => {
  it('an untouched card build is its own baseline — no section is the player’s', () => {
    for (const preset of CONCEPT_PRESETS) {
      const b = conceptBuild(preset.id);
      expect(ownSections(b, SETTINGS), preset.id).toEqual([]);
    }
  });

  it('a hand-moved attribute point is the player’s own work', () => {
    expect(ownSections(tweaked(), SETTINGS)).toEqual(['attributes']);
  });

  it('with no card, everything on the record is the player’s', () => {
    const b = setMetatype(blankBuild(), 'ork');
    expect(cardBaseline(b, SETTINGS).metatype).toBeNull();
    expect(ownSections(b, SETTINGS)).toEqual(['metatype']);
  });
});

describe('conceptPlan', () => {
  it('a blank draft takes a card without a question, exactly as the engine writes it', () => {
    const b = blankBuild();
    const plan = conceptPlan(b, 'face', SETTINGS)!;
    expect(plan.confirm).toBe(false);
    expect(plan.changes).toEqual([]);
    expect(plan.next).toEqual(applyConcept(b, conceptPreset('face')!, SETTINGS));
    expect(plan.next.identity.concept).toBe('face');
  });

  it('swapping one untouched card for another asks nothing, but still knows what it replaces', () => {
    const plan = conceptPlan(conceptBuild('muscle'), 'decker', SETTINGS)!;
    expect(plan.confirm).toBe(false);
    const sections = plan.changes.map((c) => c.section);
    expect(sections).toContain('priorities');
    expect(sections).toContain('skills');
    expect(plan.changes.every((c) => !c.own)).toBe(true);
    // The card's lifestyle is kept, as the engine keeps any lifestyle.
    expect(plan.kept).toContain('lifestyles');
  });

  it('a card over the player’s own work asks first and names the change', () => {
    const plan = conceptPlan(tweaked('muscle'), 'decker', SETTINGS)!;
    expect(plan.confirm).toBe(true);
    const attributes = plan.changes.find((c) => c.section === 'attributes')!;
    expect(attributes.own).toBe(true);
    expect(attributes.effect).toBe('replaced');
    const priorities = plan.changes.find((c) => c.section === 'priorities')!;
    expect(priorities.detail).toBe('B/C/E/D/A becomes D/B/E/C/A');
    expect(changeLine(priorities)).toBe('Priorities: B/C/E/D/A becomes D/B/E/C/A');
    expect(changeLine(attributes)).toBe("Attribute and special points: replaced with the card's suggestion");
  });

  it('qualities and contacts the player added stay through a card, and asking is not needed for them', () => {
    const b = conceptBuild('muscle');
    const worked: CharacterBuild = { ...b, qualities: [QUALITY], karma: { ...b.karma, contacts: [CONTACT] } };
    const plan = conceptPlan(worked, 'face', SETTINGS)!;
    expect(plan.kept).toEqual(expect.arrayContaining(['qualities', 'contacts']));
    expect(plan.next.qualities).toEqual([QUALITY]);
    expect(plan.next.karma.contacts).toEqual([CONTACT]);
    expect(keptSentence(plan)).toMatch(
      /^Who the runner is — alias, real name, age, sex and background — stays as it is\. So do .*qualities.*contacts\.$/,
    );
  });

  it('keeps the identity through any card', () => {
    const b = withIdentity(tweaked('face'));
    for (const preset of CONCEPT_PRESETS) {
      const next = conceptPlan(b, preset.id, SETTINGS)!.next;
      expect({ ...next.identity, concept: undefined }, preset.id).toEqual({ ...b.identity, concept: undefined });
      expect(next.identity.concept).toBe(preset.id);
    }
  });

  it('an unknown card id plans nothing and changes nothing', () => {
    const b = conceptBuild('muscle');
    expect(conceptPlan(b, 'not-a-card', SETTINGS)).toBeNull();
    expect(applyCard(b, 'not-a-card', SETTINGS)).toBe(b);
  });
});

describe('metatype through a card', () => {
  it('a metatype the player picked themselves stays when the card’s row allows it — nothing of theirs is lost, so no question', () => {
    const mine = setMetatype(conceptBuild('decker'), 'ork');
    expect(ownMetatype(mine, SETTINGS)).toBe('ork');
    const plan = conceptPlan(mine, 'face', SETTINGS)!;
    expect(plan.next.metatype).toBe('ork');
    expect(plan.kept).toContain('metatype');
    expect(plan.confirm).toBe(false);
  });

  it('a metatype the player picked that the next card’s row cannot hold is named as their change, and asks', () => {
    // The investigator card puts metatype at B; the face card puts it at C, where a troll is not on the row.
    const mine = setMetatype(conceptBuild('investigator'), 'troll');
    expect(ownMetatype(mine, SETTINGS)).toBe('troll');
    const plan = conceptPlan(mine, 'face', SETTINGS)!;
    expect(plan.next.metatype).toBe('elf');
    expect(plan.confirm).toBe(true);
    const metatype = plan.changes.find((c) => c.section === 'metatype')!;
    expect(metatype).toMatchObject({ own: true, effect: 'replaced', detail: 'Troll becomes Elf' });
    expect(ownChanges(plan).map((c) => c.section)).toEqual(['metatype']);
  });

  it('a metatype the previous card suggested gives way to the next card’s suggestion', () => {
    const fromFace = conceptBuild('face'); // elf, the face card's suggestion
    expect(ownMetatype(fromFace, SETTINGS)).toBeNull();
    expect(applyCard(fromFace, 'muscle', SETTINGS).metatype).toBe('troll');
    // A card with no suggestion falls back to the engine's default rather than the old card's elf.
    expect(applyCard(fromFace, 'decker', SETTINGS).metatype).toBe(conceptBuild('decker').metatype);
    const plan = conceptPlan(fromFace, 'muscle', SETTINGS)!;
    expect(plan.changes.find((c) => c.section === 'metatype')!.detail).toBe('Elf becomes Troll');
  });
});

describe('start from nothing', () => {
  it('is emptyBuild’s spend with the identity kept and the blank card marked', () => {
    const b = withIdentity({
      ...tweaked('street-mage'),
      qualities: [QUALITY],
      karma: { toNuyen: 2, spends: [], contacts: [CONTACT] },
    });
    const next = startFromNothing(b, SETTINGS);
    const empty = emptyBuild(b, next.identity);
    const { identity: _i, ...spend } = next;
    const { identity: _e, ...emptySpend } = empty;
    expect(spend).toEqual({ ...emptySpend, method: b.method, mode: b.mode, step: b.step, state: b.state });
    expect(next.identity).toEqual({ ...b.identity, concept: BLANK_CONCEPT_ID });
    expect(applyCard(b, BLANK_CONCEPT_ID, SETTINGS)).toEqual(next);
    // One behaviour: the step's reset is the engine's blank card, which is `clearSpend` with the card marked.
    expect(next).toEqual(applyConcept(b, conceptPreset(BLANK_CONCEPT_ID)!, SETTINGS));
    expect(next).toEqual({ ...clearSpend(b), identity: { ...b.identity, concept: BLANK_CONCEPT_ID } });
  });

  it('asks first when it would clear the player’s own gear, and names every section it clears', () => {
    const b = conceptBuild('rigger');
    const worked: CharacterBuild = { ...b, karma: { ...b.karma, toNuyen: 3, contacts: [CONTACT] } };
    const plan = conceptPlan(worked, BLANK_CONCEPT_ID, SETTINGS)!;
    expect(plan.confirm).toBe(true);
    expect(plan.kept).toEqual([]);
    expect(plan.changes.every((c) => c.effect === 'cleared')).toBe(true);
    expect(plan.changes.filter((c) => c.own).map((c) => c.section)).toEqual(['gear', 'contacts']);
    expect(planTitle(plan)).toBe('Start from nothing?');
    expect(planGoLabel(plan)).toBe('clear and start over');
    expect(keptSentence(plan)).toBe('Who the runner is — alias, real name, age, sex and background — stays as it is.');
  });

  it('from an untouched card, clears without a question', () => {
    expect(conceptPlan(conceptBuild('adept'), BLANK_CONCEPT_ID, SETTINGS)!.confirm).toBe(false);
  });

  it('leaves method, level and the GM’s fields where they were', () => {
    const b: CharacterBuild = { ...conceptBuild('muscle'), notes: 'see me', returnedStep: 3, state: 'returned', mode: 'free', step: 1 };
    const cleared = clearSpend(b);
    expect([cleared.notes, cleared.returnedStep, cleared.state, cleared.mode, cleared.level, cleared.table]).toEqual([
      'see me',
      3,
      'returned',
      'free',
      b.level,
      b.table,
    ]);
  });
});

describe('the words', () => {
  it('lists in plain English', () => {
    expect(listWords([])).toBe('');
    expect(listWords(['a'])).toBe('a');
    expect(listWords(['a', 'b'])).toBe('a and b');
    expect(listWords(['a', 'b', 'c'])).toBe('a, b and c');
  });

  it('names magic by kind, aspect and tradition', () => {
    expect(magicWords({ kind: 'mundane' })).toBe('no magic');
    expect(magicWords({ kind: 'aspected', aspect: 'conjuring', tradition: 'shamanic' })).toBe('aspected magician (conjuring), shamanic');
    expect(magicWords({ kind: 'mysticAdept' })).toBe('mystic adept');
  });

  it('says what each card fills in, and says it aloud in full', () => {
    const face = cardFills(conceptPreset('face')!);
    expect(face).toEqual({
      priorities: 'C/B/E/A/D',
      prioritiesSpoken: 'metatype C, attributes B, magic E, skills A, resources D',
      metatype: 'Elf suggested',
      magic: 'no magic',
      seen: 'C/B/E/A/D · Elf suggested · no magic',
      heard: 'Fills in priorities metatype C, attributes B, magic E, skills A, resources D; Elf suggested; no magic.',
    });
    expect(cardFills(conceptPreset('decker')!).metatype).toBe('any metatype');
    expect(cardFills(conceptPreset('conjurer')!).seen).toBe('C/A/B/D/E · any metatype · aspected magician (conjuring), shamanic');
    const blank = cardFills(conceptPreset(BLANK_CONCEPT_ID)!);
    expect(blank.priorities).toBeNull();
    expect(blank.seen).toBe('clears every later step; who the runner is stays');
  });

  it('asks the question in words that fit the tap', () => {
    const swap = conceptPlan(tweaked('muscle'), 'decker', SETTINGS)!;
    expect(swap.again).toBe(false);
    expect(planTitle(swap)).toBe('Use “Grid-runner decker”?');
    expect(planGoLabel(swap)).toBe('use this card');

    const back = conceptPlan(tweaked('muscle'), 'muscle', SETTINGS)!;
    expect(back.again).toBe(true);
    expect(planTitle(back)).toBe('Put “Chromed-up muscle” back as it was?');
    expect(planGoLabel(back)).toBe('put the card back');
  });
});

describe('putting the chosen card back', () => {
  it('names only the player’s own changes, and restores the card’s suggestion', () => {
    const b = tweaked('muscle');
    const plan = conceptPlan(b, 'muscle', SETTINGS)!;
    expect(plan.confirm).toBe(true);
    expect(ownChanges(plan).map((c) => c.section)).toEqual(['attributes']);
    expect(plan.next.attributes).toEqual(conceptBuild('muscle').attributes);
  });

  it('on an untouched card changes nothing at all', () => {
    const b = conceptBuild('face');
    const plan = conceptPlan(b, 'face', SETTINGS)!;
    expect(plan.changes).toEqual([]);
    expect(plan.next).toEqual(b);
  });
});

describe('pickCard', () => {
  it('applies, asks or does nothing — and never offers an edit on a build that may not change', () => {
    expect(pickCard(blankBuild(), 'face', SETTINGS)).toBe('apply');
    expect(pickCard(conceptBuild('muscle'), 'decker', SETTINGS)).toBe('apply');
    expect(pickCard(tweaked('muscle'), 'decker', SETTINGS)).toBe('ask');
    expect(pickCard(tweaked('muscle'), BLANK_CONCEPT_ID, SETTINGS)).toBe('ask');
    expect(pickCard(blankBuild(), 'not-a-card', SETTINGS)).toBe('none');
    expect(pickCard(tweaked('muscle'), 'decker', SETTINGS, false)).toBe('none');
  });
});
