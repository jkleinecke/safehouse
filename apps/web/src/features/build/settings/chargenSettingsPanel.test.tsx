/**
 * The console's "Character creation" panel, rendered to static markup
 * (FR3.9, docs/CHARGEN.md §3 "Sourcebook toggles, house-rule options",
 * §8.3).
 *
 * Pinned for each state a GM meets: the settings as saved (nothing to save,
 * a house cap marked as the campaign's own with a reset that names the
 * level's number); mid-edit after picking another level (the caps showing
 * the new level's numbers, the note on which move, the change count, save
 * and discard); a cap that will not parse (marked invalid, save shut); AI off
 * (the drafts box shut with the way to turn AI on) and AI off with drafts
 * already on (still switchable off); loading and unreadable; the level cards'
 * numbers and the two printings' technomancer rows; the book toggles; and the
 * note that builds under way are re-checked when next opened. Invented book
 * titles only.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { ChargenSettingsSchema, type ChargenSettings } from '@safehouse/contracts';
import { ChargenSettingsView, type ChargenSettingsViewProps } from './ChargenSettingsPanel.js';
import { bookOptions, formOf, withCapText, withLevel } from './chargenSettings.js';

const noop = () => undefined;

const HOUSE: ChargenSettings = ChargenSettingsSchema.parse({
  level: 'experienced',
  table: 'sr5',
  maxAvailability: 14,
  books: ['SR5'],
});

const LIBRARY = [
  { code: 'SR5', title: 'Core Rules (invented title)', shared: true },
  { code: 'AAA', title: 'Alpha Annex', shared: true },
  { code: 'GMX', title: 'Screen Notes', shared: false },
];

function render(over: Partial<ChargenSettingsViewProps> = {}): string {
  const form = over.form === undefined ? formOf(HOUSE) : over.form;
  const props: ChargenSettingsViewProps = {
    campaignId: 'c1',
    base: HOUSE,
    loading: false,
    loadError: null,
    books: bookOptions(LIBRARY, form?.values.books ?? []),
    booksLoading: false,
    ai: 'on',
    saving: false,
    saveError: null,
    justSaved: false,
    onForm: noop,
    onSave: noop,
    onDiscard: noop,
    ...over,
    form,
  };
  return renderToStaticMarkup(
    <MemoryRouter>
      <ChargenSettingsView {...props} />
    </MemoryRouter>,
  );
}

/** The opening tag of the element carrying a test id. */
function tag(html: string, testId: string): string {
  const m = html.match(new RegExp(`<[a-z]+[^>]*data-testid="${testId}"[^>]*>`));
  if (!m) throw new Error(`no ${testId} in markup`);
  return m[0];
}

/** The markup of one cap's block. */
function capBlock(html: string, field: string): string {
  const start = html.indexOf(`data-cap="${field}"`);
  expect(start, field).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf('data-cap=', start + 10) === -1 ? undefined : html.indexOf('data-cap=', start + 10));
}

describe('the settings as saved', () => {
  it('has nothing to save, and marks a house cap with a reset that names the level’s number', () => {
    const html = render();
    expect(html).toContain('data-state="clean"');
    expect(html).toContain('Character creation');
    expect(tag(html, 'chargen-save')).toContain('disabled=""');
    expect(html).toContain('No unsaved changes.');
    expect(html).not.toContain('discard changes');

    const availability = capBlock(html, 'maxAvailability');
    expect(availability).toContain('data-at-level="no"');
    expect(availability).toContain('value="14"');
    expect(availability).toContain('Experienced default: 12 · this campaign sets its own');
    expect(availability).toContain('aria-label="Reset Highest Availability to Experienced&#x27;s 12"');

    const nuyen = capBlock(html, 'nuyenCarry');
    expect(nuyen).toContain('data-at-level="yes"');
    expect(nuyen).toContain('Experienced default: 5,000¥');
    expect(nuyen).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Reset Nuyen carried into play/);
  });

  it('lays out each level with the numbers it moves, from the engine', () => {
    const html = render();
    expect(tag(html, 'chargen-level-cards')).toContain('role="radiogroup"');
    expect(html).toMatch(/data-choice="street".*?13 Karma.*?Quality Karma 26 each way · Availability up to 10 · Device rating up to 4 · Karma to nuyen up to 5 · Contact Karma Charisma × 3/s);
    expect(html).toMatch(/data-choice="prime".*?35 Karma.*?Quality Karma 70 each way · Availability up to 15/s);
    expect(html).toMatch(/data-choice="experienced"><button[^>]*aria-checked="true"/);
    expect(html).toContain('SR5 p.62');
  });

  it('names the two printings by their technomancer rows, with both pages', () => {
    const html = render();
    expect(html).toContain('Technomancer: A 3 skills at 5, 7 forms; B 3 skills at 4, 4 forms; C 3 skills at 2, 3 forms');
    expect(html).toContain('Technomancer: A 2 skills at 5, 5 forms; B 2 skills at 4, 2 forms; C no skills, 1 form');
    expect(html).toContain('differ only in the technomancer&#x27;s row');
    expect(html).toContain('SR5 p.65');
    expect(html).toContain('RF p.63');
  });

  it('lists the shared books as toggles, a GM-only one flagged, and what the list comes to', () => {
    const html = render({ books: bookOptions(LIBRARY, ['SR5', 'GMX']) });
    expect(html).toMatch(/data-book="SR5" data-status="shared"><label[^>]*><input type="checkbox"[^>]*checked=""/);
    expect(html).toMatch(/data-book="AAA" data-status="shared"><label[^>]*><input type="checkbox" class="[^"]*"\/>/);
    expect(html).toContain('not shared, players cannot open it');
    expect(html).toContain('1 of 2 shared books, and 1 the players cannot open');
    expect(html).toContain('Tick none and every book shared with the');
  });

  it('hands over the library when no book is shared', () => {
    const html = render({ books: [] });
    expect(html).toContain('No books are shared with the table yet.');
    expect(html).toContain('href="/c/c1/books"');
  });

  it('says that builds under way are re-checked when next opened', () => {
    expect(render()).toContain('Each is checked against these settings the next time it');
  });

  it('confirms a save that went through', () => {
    expect(render({ justSaved: true })).toContain('Saved.');
  });
});

describe('the GM editing', () => {
  it('after picking another level: its numbers in the caps, the note on what moves, save and discard open', () => {
    const form = withLevel(withCapText(formOf(HOUSE), 'karmaCarry', '5'), 'street', HOUSE);
    const html = render({ form });
    expect(html).toContain('data-state="editing"');
    expect(html).toMatch(/data-choice="street"><button[^>]*aria-checked="true"/);
    expect(capBlock(html, 'maxAvailability')).toContain('value="10"');
    expect(capBlock(html, 'maxAvailability')).toContain('Street level default: 10');
    expect(capBlock(html, 'karmaCarry')).toContain('value="5"');
    expect(html).toContain('Saving at Street level moves these to its numbers: Highest Availability 10, Highest device rating 4, Nuyen carried into play 5,000¥.');
    expect(html).toContain('You set this one yourself, so it stays: Karma carried into play 5.');
    expect(tag(html, 'chargen-save')).not.toContain('disabled');
    expect(html).toContain('discard changes');
    expect(html).toContain('4 unsaved changes: Creation level, Highest Availability, Highest device rating, Karma carried into play.');
  });

  it('marks a cap that will not parse and shuts the save', () => {
    const html = render({ form: withCapText(formOf(HOUSE), 'maxDeviceRating', 'six') });
    const block = capBlock(html, 'maxDeviceRating');
    expect(block).toContain('aria-invalid="true"');
    expect(block).toContain('A whole number, 0 or more.');
    expect(tag(html, 'chargen-save')).toContain('disabled=""');
    expect(html).toContain('Highest device rating: fix the number before saving.');
    expect(html).toContain('discard changes');
  });

  it('shows the save running and the server’s refusal', () => {
    const html = render({ form: withLevel(formOf(HOUSE), 'prime', HOUSE), saving: true, saveError: new Error('Only the GM changes creation settings.') });
    expect(html).toContain('saving…');
    expect(html).toContain('Only the GM changes creation settings.');
  });
});

describe('AI drafts', () => {
  it('is open when the campaign has an AI', () => {
    const html = render({ ai: 'on' });
    expect(tag(html, 'chargen-flag-aiDrafts')).not.toContain('disabled');
    expect(html).not.toContain('AI is off for this campaign');
  });

  it('is shut with the way to turn AI on when AI is off', () => {
    const html = render({ ai: 'off' });
    expect(tag(html, 'chargen-flag-aiDrafts')).toContain('disabled=""');
    expect(html).toContain('data-flag="aiDrafts" data-disabled="yes"');
    expect(html).toContain('AI is off for this campaign, so there is nothing to draft with — ');
    expect(html).toContain('href="/c/c1/gm/ai"');
    // The other options do not depend on AI.
    expect(tag(html, 'chargen-flag-allowSumToTen')).not.toContain('disabled');
  });

  it('can still be switched off when it was left on and AI went off', () => {
    const on = ChargenSettingsSchema.parse({ ...HOUSE, aiDrafts: true });
    const html = render({ base: on, form: formOf(on), ai: 'off' });
    expect(tag(html, 'chargen-flag-aiDrafts')).not.toContain('disabled');
    expect(html).toContain('You can still turn this off.');
  });

  it('waits while the AI settings are read', () => {
    const html = render({ ai: 'checking' });
    expect(tag(html, 'chargen-flag-aiDrafts')).toContain('disabled=""');
    expect(html).toContain('Checking whether this campaign has an AI…');
  });
});

describe('before the settings are in', () => {
  it('says it is loading', () => {
    const html = render({ base: undefined, form: null, loading: true });
    expect(html).toContain('data-state="unavailable"');
    expect(html).toContain('loading creation settings');
    expect(html).not.toContain('chargen-save');
  });

  it('prints why they could not be read, and edits nothing', () => {
    const html = render({ base: undefined, form: null, loadError: new Error('The server is not answering.') });
    expect(html).toContain('The server is not answering.');
    expect(html).toContain('cannot be changed here until the server answers');
    expect(html).not.toContain('chargen-save');
  });
});
