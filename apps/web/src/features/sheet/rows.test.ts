/**
 * The readings of the creator's sheet fields, and the fallbacks for a sheet
 * that predates them: a Chummer import and every character made before the
 * native builder carries no grade, no quality Karma and no tradition, and the
 * tabs have to stay honest about that rather than print a default as a fact.
 */
import { describe, expect, it } from 'vitest';
import { SheetV1Schema, type SheetV1 } from '@safehouse/contracts';
import { augmentDetail, drainAttrOf, identityDetails, knowledgeLines, qualityDetail, qualityKarmaText } from './rows.js';

function sheet(over: Record<string, unknown> = {}): SheetV1 {
  return SheetV1Schema.parse({
    v: 1,
    identity: { alias: 'Sixgill' },
    attributes: { bod: 3, agi: 3, rea: 3, str: 3, wil: 4, log: 4, int: 3, cha: 3, edg: { max: 3, current: 3 } },
    ...over,
  });
}

describe('knowledge lines', () => {
  it('puts the knowledge first and the native languages before the bought ones', () => {
    const lines = knowledgeLines(
      sheet({
        knowledge: [{ name: 'Smuggling routes', category: 'professional', rating: 3, spec: 'Puget Sound' }],
        languages: [
          { name: 'Or’zet', rating: 2 },
          { name: 'English', native: true },
        ],
      }),
    );
    expect(lines.map((l) => [l.name, l.kind, l.rating, l.spec])).toEqual([
      ['Smuggling routes', 'professional', '3', 'Puget Sound'],
      ['English', 'language', 'N', null],
      ['Or’zet', 'language', '2', null],
    ]);
  });

  it('is empty for a sheet with neither, so the tab can say so', () => {
    expect(knowledgeLines(sheet())).toEqual([]);
  });
});

describe('quality words', () => {
  it('says which side of the ledger a quality is on, and what it moved', () => {
    expect(qualityKarmaText({ type: 'positive', karma: 12 })).toBe('costs 12 Karma');
    expect(qualityKarmaText({ type: 'negative', karma: 5 })).toBe('gives 5 Karma');
    expect(qualityKarmaText({ type: 'positive', karma: 10 }, { buyOff: true })).toBe('costs 10 Karma to buy off');
  });

  it('says nothing at all for a quality written before the builder', () => {
    expect(qualityKarmaText({})).toBeNull();
    expect(qualityDetail({})).toBeNull();
  });

  it('adds the rating where a quality has one', () => {
    expect(qualityDetail({ type: 'positive', karma: 18, rating: 3 })).toBe('costs 18 Karma · rating 3');
  });
});

describe('augment detail', () => {
  it('leads with the grade and the rating, both of which were paid for', () => {
    expect(augmentDetail({ essence: 0.8, grade: 'alphaware', rating: 3 })).toBe('alphaware · rating 3 · −0.8 ess');
  });

  it('reads as it always did for an implant with neither recorded', () => {
    expect(augmentDetail({ essence: 0.2 })).toBe('−0.2 ess');
    expect(augmentDetail({ essence: 0 })).toBe('no essence cost');
  });
});

describe('who the runner is', () => {
  it('shows only the fields the record carries', () => {
    expect(identityDetails(sheet().identity)).toEqual([]);
    const full = sheet({ identity: { alias: 'Sixgill', realName: '  Marta Oyelaran ', age: 34, sex: 'female' } });
    expect(identityDetails(full.identity)).toEqual([
      { label: 'Real name', value: 'Marta Oyelaran' },
      { label: 'Age', value: '34' },
      { label: 'Sex', value: 'female' },
    ]);
  });
});

describe('the drain attribute comes from the tradition', () => {
  it('reads the second half of the pair the builder recorded', () => {
    expect(drainAttrOf(sheet({ awakening: { kind: 'magician', tradition: 'hermetic', drain: ['wil', 'log'] } }))).toBe('log');
    expect(drainAttrOf(sheet({ awakening: { kind: 'magician', tradition: 'shamanic', drain: ['wil', 'cha'] } }))).toBe('cha');
  });

  it('falls back to Charisma for a mundane sheet and for an import with no tradition', () => {
    expect(drainAttrOf(sheet())).toBe('cha');
    expect(drainAttrOf(sheet({ awakening: { kind: 'adept', drain: null } }))).toBe('cha');
  });

  it("does not offer a technomancer's Resonance, which resists Fading and not Drain", () => {
    expect(drainAttrOf(sheet({ awakening: { kind: 'technomancer', drain: ['wil', 'res'] } }))).toBe('cha');
  });
});
