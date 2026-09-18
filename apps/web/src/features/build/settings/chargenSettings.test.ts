/**
 * The GM's creation settings form, as pure functions (FR3.9,
 * docs/CHARGEN.md §8.3, §8.5 `PUT /api/campaigns/:id/chargen`).
 *
 * Pinned: a save sends only the fields that changed, and — the part a plain
 * diff gets wrong — after a change of level a cap is sent only when it
 * differs from the new level's preset, because that is what the server's
 * merge stores for a cap the write leaves out; every write is checked by
 * merging it with the contract's own `mergeChargenSettings` and comparing
 * with the form. The caps follow a level change the way the server will
 * (untouched ones move and come back, typed ones stay, reset ones follow),
 * the level cards read the engine's presets, the two printings differ in the
 * technomancer's row, the book toggles, the AI drafts gate, and the builds
 * list's "settings changed" hint. Invented book titles only.
 */
import { describe, expect, it } from 'vitest';
import {
  ChargenSettingsSchema,
  mergeChargenSettings,
  type ChargenSettings,
  type ChargenSettingsWrite,
} from '@safehouse/contracts';
import { CREATION_LEVEL_PRESETS } from '@safehouse/rules';
import {
  CAP_FIELDS,
  SETTING_FIELDS,
  aiAvailability,
  aiDraftsEnabled,
  bookOptions,
  booksLine,
  capAtLevel,
  capError,
  changedFields,
  formOf,
  formOutcome,
  formatCap,
  levelChangeNote,
  levelDefault,
  levelFigures,
  normalizeBooks,
  parseCap,
  resetCap,
  sameBooks,
  saveLine,
  settingsDrift,
  settingsWrite,
  tableLine,
  tableRef,
  toggleBook,
  withCapText,
  withLevel,
  withValues,
} from './chargenSettings.js';

const DEFAULTS: ChargenSettings = ChargenSettingsSchema.parse({});

/** A campaign with house caps and a few options on — what an edited campaign looks like. */
const HOUSE: ChargenSettings = ChargenSettingsSchema.parse({
  level: 'experienced',
  table: 'rf',
  maxAvailability: 14,
  maxDeviceRating: 6,
  karmaCarry: 5,
  nuyenCarry: 5000,
  books: ['SR5', 'RF'],
  allowSumToTen: true,
  aiDrafts: false,
});

/** The write, merged the way the server merges it, lands exactly on what the form shows. */
function expectRoundTrip(base: ChargenSettings, edited: ChargenSettings): ChargenSettingsWrite {
  const write = settingsWrite(base, edited);
  const merged = mergeChargenSettings(base, write);
  expect({ ...merged, books: normalizeBooks(merged.books).sort() }).toEqual({
    ...edited,
    books: normalizeBooks(edited.books).sort(),
  });
  return write;
}

describe('settingsWrite — only the changed fields', () => {
  it('sends nothing when nothing changed', () => {
    expect(settingsWrite(HOUSE, HOUSE)).toEqual({});
    expect(settingsWrite(DEFAULTS, formOf(DEFAULTS).values)).toEqual({});
  });

  it('sends one toggle alone, so a save cannot reset the rest', () => {
    const write = expectRoundTrip(HOUSE, { ...HOUSE, allowMetavariants: true });
    expect(write).toEqual({ allowMetavariants: true });
  });

  it('sends the table, a cap and the books when those change', () => {
    const write = expectRoundTrip(HOUSE, { ...HOUSE, table: 'sr5', maxAvailability: 12, books: ['RF'] });
    expect(write).toEqual({ table: 'sr5', maxAvailability: 12, books: ['RF'] });
  });

  it('treats the books as a set: order and case are not a change', () => {
    expect(settingsWrite(HOUSE, { ...HOUSE, books: ['rf', 'SR5'] })).toEqual({});
    expect(sameBooks(['SR5', 'RF'], [' rf', 'sr5', 'SR5'])).toBe(true);
    expect(sameBooks(['SR5'], [])).toBe(false);
  });

  it('after a level change, leaves out a cap that is the new level’s own number', () => {
    // Street presets Availability 10, device 4, 7 Karma, 5,000¥ carried.
    const edited = { ...HOUSE, level: 'street' as const, maxAvailability: 10, maxDeviceRating: 4, karmaCarry: 7, nuyenCarry: 5000 };
    const write = expectRoundTrip(HOUSE, edited);
    expect(write).toEqual({ level: 'street' });
  });

  it('after a level change, sends a cap that differs from the new level’s number — even one equal to what was saved', () => {
    // The GM keeps their 5 Karma carry and 14 Availability at prime.
    const edited = { ...HOUSE, level: 'prime' as const, maxAvailability: 14, maxDeviceRating: 6, karmaCarry: 5, nuyenCarry: 5000 };
    const write = expectRoundTrip(HOUSE, edited);
    expect(write).toEqual({ level: 'prime', maxAvailability: 14, karmaCarry: 5 });
  });

  it('round-trips every single-field edit of every field', () => {
    for (const field of SETTING_FIELDS) {
      const edited: ChargenSettings = { ...HOUSE };
      switch (field) {
        case 'level':
          edited.level = 'street';
          for (const cap of CAP_FIELDS) edited[cap] = levelDefault('street', cap);
          break;
        case 'table':
          edited.table = 'sr5';
          break;
        case 'books':
          edited.books = [];
          break;
        default:
          if (typeof HOUSE[field] === 'number') (edited as Record<string, unknown>)[field] = (HOUSE[field] as number) + 1;
          else (edited as Record<string, unknown>)[field] = !HOUSE[field];
      }
      const write = expectRoundTrip(HOUSE, edited);
      expect(Object.keys(write), field).toEqual([field]);
    }
  });
});

describe('changedFields', () => {
  it('names what differs on screen, caps that followed a level included', () => {
    const form = withLevel(formOf(HOUSE), 'street', HOUSE);
    expect(changedFields(HOUSE, form.values)).toEqual(['level', 'maxAvailability', 'maxDeviceRating', 'karmaCarry']);
    expect(changedFields(HOUSE, { ...HOUSE, books: ['RF', 'SR5'] })).toEqual([]);
  });
});

describe('the caps follow a level change the way the server will', () => {
  it('shows the level defaults for every cap', () => {
    expect(levelDefault('street', 'maxAvailability')).toBe(10);
    expect(levelDefault('street', 'maxDeviceRating')).toBe(4);
    expect(levelDefault('experienced', 'maxAvailability')).toBe(12);
    expect(levelDefault('prime', 'maxAvailability')).toBe(15);
    expect(levelDefault('prime', 'karmaCarry')).toBe(7);
    expect(levelDefault('prime', 'nuyenCarry')).toBe(5000);
    expect(formatCap('nuyenCarry', 5000)).toBe('5,000¥');
    expect(formatCap('karmaCarry', 7)).toBe('7 Karma');
    expect(formatCap('maxAvailability', 12)).toBe('12');
  });

  it('moves untouched caps to the new level, and back to the saved house numbers on return', () => {
    const street = withLevel(formOf(HOUSE), 'street', HOUSE);
    expect(street.values).toMatchObject({ level: 'street', maxAvailability: 10, maxDeviceRating: 4, karmaCarry: 7, nuyenCarry: 5000 });
    expect(street.capText.maxAvailability).toBe('10');
    const back = withLevel(street, 'experienced', HOUSE);
    expect(back.values).toEqual(HOUSE);
    expect(formOutcome(HOUSE, back).canSave).toBe(false);
  });

  it('keeps a typed cap through level changes', () => {
    const typed = withCapText(formOf(HOUSE), 'maxAvailability', '11');
    const prime = withLevel(typed, 'prime', HOUSE);
    expect(prime.values.maxAvailability).toBe(11);
    expect(prime.values.maxDeviceRating).toBe(6);
    expect(prime.values.karmaCarry).toBe(7);
    const outcome = formOutcome(HOUSE, prime);
    expect(outcome.write).toEqual({ level: 'prime', maxAvailability: 11 });
    expect(mergeChargenSettings(HOUSE, outcome.write)).toEqual(prime.values);
  });

  it('a reset cap takes the level’s number and follows the level from then on', () => {
    const reset = resetCap(formOf(HOUSE), 'maxAvailability');
    expect(reset.values.maxAvailability).toBe(12);
    expect(capAtLevel(reset, 'maxAvailability')).toBe(true);
    expect(formOutcome(HOUSE, reset).write).toEqual({ maxAvailability: 12 });
    // Back at the saved level a reset cap stays the level's, not the house number.
    const away = withLevel(withLevel(reset, 'street', HOUSE), 'experienced', HOUSE);
    expect(away.values.maxAvailability).toBe(12);
    expect(capAtLevel(formOf(HOUSE), 'maxAvailability')).toBe(false);
  });

  it('refuses a cap that is blank, negative or not whole, and will not save it', () => {
    expect(parseCap('12')).toBe(12);
    expect(parseCap(' 0 ')).toBe(0);
    for (const bad of ['', '-1', '2.5', 'ten', '1e3']) expect(parseCap(bad), bad).toBeNull();
    expect(capError('')).toMatch(/Enter a number/);
    expect(capError('-3')).toBe('A whole number, 0 or more.');
    expect(capError('9')).toBeNull();
    const broken = withCapText(formOf(HOUSE), 'karmaCarry', 'x');
    expect(broken.values.karmaCarry).toBe(5);
    const outcome = formOutcome(HOUSE, withValues(broken, { allowMetavariants: true }));
    expect(outcome.invalid).toEqual(['karmaCarry']);
    expect(outcome.canSave).toBe(false);
    expect(saveLine(outcome)).toBe('Karma carried into play: fix the number before saving.');
  });

  it('says which caps move with a level change and which the GM kept', () => {
    expect(levelChangeNote(HOUSE, formOf(HOUSE))).toBeNull();
    const form = withLevel(withCapText(formOf(HOUSE), 'karmaCarry', '5'), 'street', HOUSE);
    const note = levelChangeNote(HOUSE, form)!;
    expect(note).toContain('Saving at Street level moves these to its numbers: Highest Availability 10, Highest device rating 4, Nuyen carried into play 5,000¥.');
    expect(note).toContain('You set this one yourself, so it stays: Karma carried into play 5.');
  });

  it('counts the changes in words beside the save button', () => {
    expect(saveLine(formOutcome(HOUSE, formOf(HOUSE)))).toBe('No unsaved changes.');
    const one = formOutcome(HOUSE, withValues(formOf(HOUSE), { aiDrafts: true }));
    expect(saveLine(one)).toBe('1 unsaved change: AI drafts.');
  });
});

describe('what each level and each printing means', () => {
  it('reads every level card’s numbers from the engine’s presets', () => {
    const value = (level: 'street' | 'experienced' | 'prime', on = true) =>
      Object.fromEntries(levelFigures(level, on).map((f) => [f.key, f.value]));
    expect(value('street')).toEqual({
      karma: '13',
      qualities: '26 each way',
      availability: 'up to 10',
      device: 'up to 4',
      toNuyen: 'up to 5',
      contacts: 'Charisma × 3',
    });
    expect(value('experienced')).toMatchObject({ karma: '25', qualities: '25 each way', availability: 'up to 12', toNuyen: 'up to 10' });
    expect(value('prime')).toMatchObject({ karma: '35', qualities: '70 each way', availability: 'up to 15', device: 'up to 6', toNuyen: 'up to 25', contacts: 'Charisma × 6' });
    // With the house reading off, every level keeps the flat 25.
    expect(value('prime', false).qualities).toBe('25 each way');
    expect(value('street').karma).toBe(String(CREATION_LEVEL_PRESETS.street.karma));
  });

  it('names the technomancer row where the printings differ, with each page', () => {
    expect(tableLine('sr5')).toBe('Technomancer: A 3 skills at 5, 7 forms; B 3 skills at 4, 4 forms; C 3 skills at 2, 3 forms');
    expect(tableLine('rf')).toBe('Technomancer: A 2 skills at 5, 5 forms; B 2 skills at 4, 2 forms; C no skills, 1 form');
    expect(tableRef('sr5')).toMatchObject({ book: 'SR5', page: 65 });
    expect(tableRef('rf')).toMatchObject({ book: 'RF', page: 63 });
  });
});

describe('books', () => {
  const LIBRARY = [
    { code: 'SR5', title: 'Core Rules (invented title)', shared: true },
    { code: 'AAA', title: 'Alpha Annex', shared: true },
    { code: 'sr5', title: 'Duplicate copy', shared: true },
    { code: 'GMX', title: 'Screen Notes', shared: false },
  ];

  it('lists each shared book once, sorted, with none ticked meaning all of them', () => {
    const options = bookOptions(LIBRARY, []);
    expect(options.map((o) => [o.code, o.status, o.checked])).toEqual([
      ['AAA', 'shared', false],
      ['SR5', 'shared', false],
    ]);
    expect(booksLine(options)).toBe('Every shared book (2) — nothing is ticked, so nothing is left out.');
    expect(booksLine([])).toMatch(/No books are shared/);
  });

  it('keeps a ticked book that is GM-only or gone, so it can be unticked', () => {
    const options = bookOptions(LIBRARY, ['sr5', 'GMX', 'OLD']);
    expect(options.map((o) => [o.code, o.status, o.checked])).toEqual([
      ['AAA', 'shared', false],
      ['SR5', 'shared', true],
      ['GMX', 'gm-only', true],
      ['OLD', 'missing', true],
    ]);
    expect(booksLine(options)).toBe('1 of 2 shared books, and 2 the players cannot open');
  });

  it('ticks and unticks by code, whatever the case', () => {
    expect(toggleBook(['SR5'], 'AAA', true)).toEqual(['SR5', 'AAA']);
    expect(toggleBook(['SR5', 'AAA'], 'sr5', false)).toEqual(['AAA']);
    expect(toggleBook(['SR5'], 'sr5', true)).toEqual(['sr5']);
    expect(normalizeBooks([' SR5 ', '', 'sr5', 'RF'])).toEqual(['SR5', 'RF']);
  });
});

describe('AI drafts', () => {
  it('reads the server’s own readiness, and says when it cannot', () => {
    expect(aiAvailability({ ready: true }, false, null)).toBe('on');
    expect(aiAvailability({ ready: false }, false, null)).toBe('off');
    expect(aiAvailability(undefined, true, null)).toBe('checking');
    expect(aiAvailability(undefined, false, new Error('403'))).toBe('unknown');
  });

  it('shuts the box while AI is off or being read, but never traps it on', () => {
    expect(aiDraftsEnabled('on', false)).toBe(true);
    expect(aiDraftsEnabled('off', false)).toBe(false);
    expect(aiDraftsEnabled('checking', false)).toBe(false);
    expect(aiDraftsEnabled('off', true)).toBe(true);
    expect(aiDraftsEnabled('unknown', false)).toBe(true);
  });
});

describe('settingsDrift — the builds list hint', () => {
  const now = { level: 'experienced' as const, table: 'sr5' as const };

  it('is quiet when the build matches, or is approved history', () => {
    expect(settingsDrift({ level: 'experienced', table: 'sr5' }, 'draft', now)).toBeNull();
    expect(settingsDrift({ level: 'street', table: 'sr5' }, 'approved', now)).toBeNull();
    expect(settingsDrift({ level: 'street', table: 'sr5' }, 'draft', undefined)).toBeNull();
  });

  it('names the level and table the build was saved under and what the campaign runs now', () => {
    expect(settingsDrift({ level: 'street', table: 'sr5' }, 'draft', now)).toBe(
      'Settings changed since this build was saved: saved at Street level, the campaign now runs Experienced. It is checked against the new settings when opened.',
    );
    const both = settingsDrift({ level: 'prime', table: 'rf' }, 'submitted', now)!;
    expect(both).toContain('saved at Prime runner, the campaign now runs Experienced');
    expect(both).toContain('saved on the Revised priority table, the campaign now uses the Core priority table');
  });
});
