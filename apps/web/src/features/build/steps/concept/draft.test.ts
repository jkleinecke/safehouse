/**
 * "Describe your runner" — the Fixer's draft as data and words
 * (docs/CHARGEN.md §4.4 Step 1, §8.5 `propose_build`), pinned as the pure
 * functions the screen is built from.
 *
 * What matters here:
 * - **the three routes as the builder reads them**: availability read
 *   tolerantly (anything that is not a clear "on" is off, and says why), the
 *   proposal's build read strictly through the contract's own schema — a
 *   record the walkthrough's autosave may PATCH cannot be a guess — and the
 *   words around it read tolerantly;
 * - **a refusal in the player's words** for each code the lane can answer
 *   with, and the player's own stop told apart from a failure;
 * - **what the draft would change**: a line per thing a runner is weighed by,
 *   "was / would be" against the record as it stands, the proposal's issues
 *   counted by severity, and what the Fixer could not find carried through in
 *   the server's words;
 * - **taking it**: the spend becomes the draft's, who the runner is stays the
 *   player's with only blanks filled, and the walkthrough's frame and every
 *   field the GM owns stay the record's.
 *
 * Invented runners only (DESIGN.md §14).
 */
import { describe, expect, it } from 'vitest';
import { CharacterBuildSchema, type CharacterBuild, type Issue } from '@safehouse/contracts';
import { ApiError } from '../../../../api/client.js';
import { BUILD_ID, SETTINGS, blankBuild, conceptBuild } from '../../testing.js';
import {
  PROMPT_MAX,
  PROMPT_MIN,
  SUMMARY_KEYS,
  acceptProposal,
  canDraft,
  draftErrorWords,
  draftKeys,
  isDraftStopped,
  issueCountWords,
  normalizeAvailability,
  normalizeProposal,
  proposalSummary,
  type BuildProposal,
} from './draft.js';

const issue = (over: Partial<Issue> = {}): Issue => ({
  code: 'x',
  severity: 'error',
  step: 2,
  message: 'something',
  ref: { book: 'SR5', page: 65 },
  ...over,
});

function proposal(build: CharacterBuild, over: Partial<BuildProposal> = {}): BuildProposal {
  return {
    build,
    issues: [],
    warnings: [],
    note: null,
    model: 'mock-primary',
    usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    latencyMs: 40,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// The routes
// ---------------------------------------------------------------------------

describe('whether the Draft button works', () => {
  it('is on only for a clear yes, and otherwise says which of the two reasons it is off for', () => {
    expect(normalizeAvailability({ available: true, reason: null, running: false })).toEqual({
      available: true,
      reason: null,
      running: false,
    });
    expect(normalizeAvailability({ available: false, reason: 'ai_off' })).toEqual({ available: false, reason: 'ai_off', running: false });
    expect(normalizeAvailability({ available: false, reason: 'drafts_off' })).toEqual({
      available: false,
      reason: 'drafts_off',
      running: false,
    });
  });

  it('reads anything else as off — an older server, a word it does not know, nothing at all', () => {
    for (const raw of [undefined, null, 'yes', {}, { available: 'true' }, { available: true, reason: 'because' }]) {
      expect(normalizeAvailability(raw)).toMatchObject({ available: false, reason: 'drafts_off' });
    }
  });

  it('carries that a draft is already being written elsewhere', () => {
    expect(normalizeAvailability({ available: true, reason: null, running: true }).running).toBe(true);
  });

  it('is asked under the build’s own key, so a state change refreshes it too', () => {
    expect(draftKeys.availability(BUILD_ID)).toEqual(['build', BUILD_ID, 'draft']);
  });
});

describe('the proposal as it comes off the wire', () => {
  const build = conceptBuild('muscle');

  it('parses the build with the contract’s schema and fills what the words leave out', () => {
    const out = normalizeProposal({ build, issues: [], warnings: [] });
    expect(CharacterBuildSchema.safeParse(out.build).success).toBe(true);
    expect(out.build.metatype).toBe('troll');
    expect(out).toMatchObject({ note: null, model: '', latencyMs: 0, usage: { totalTokens: 0 } });
  });

  it('keeps the issues that are issues, drops what is not, and keeps only sentences among the warnings', () => {
    const out = normalizeProposal({
      build,
      issues: [issue({ code: 'a' }), { code: 'b' }, 'nope'],
      warnings: ['“Zap Gun” is not in this campaign’s books', 7, null],
      note: '  ',
    });
    expect(out.issues.map((i) => i.code)).toEqual(['a']);
    expect(out.warnings).toEqual(['“Zap Gun” is not in this campaign’s books']);
    expect(out.note).toBeNull();
  });

  it('refuses an answer whose build is not one, rather than autosaving a guess', () => {
    expect(() => normalizeProposal({ build: { v: 1, metatype: 12 } })).toThrow();
    expect(() => normalizeProposal({})).toThrow();
  });
});

describe('the description', () => {
  it('is long enough to send only between the route’s own bounds', () => {
    expect(canDraft('')).toBe(false);
    expect(canDraft('  a  ')).toBe(false);
    expect(canDraft('an ork who drove for a gang')).toBe(true);
    expect(canDraft('x'.repeat(PROMPT_MIN))).toBe(true);
    expect(canDraft('x'.repeat(PROMPT_MAX))).toBe(true);
    expect(canDraft('x'.repeat(PROMPT_MAX + 1))).toBe(false);
  });
});

describe('a refusal', () => {
  const words = (code: string, message = 'upstream said no') => draftErrorWords(new ApiError(502, code, message));

  it('is the player’s own stop said nothing, so the screen can say it its own way', () => {
    const stop = new ApiError(499, 'ai_cancelled', 'cancelled');
    expect(draftErrorWords(stop)).toBeNull();
    expect(isDraftStopped(stop)).toBe(true);
    expect(isDraftStopped(new ApiError(502, 'ai_error', 'x'))).toBe(false);
    expect(draftErrorWords(null)).toBeNull();
  });

  it('names what the GM can do about it, and never a provider, model or key', () => {
    expect(words('ai_drafts_disabled')).toMatch(/GM can turn them on/);
    expect(words('ai_disabled')).toMatch(/GM can point it at a model/);
    // One sentence for all three busy cases — this runner elsewhere, another
    // runner of this player's, the table at its cap — since the stop button
    // here only reaches this one.
    expect(words('ai_busy')).toMatch(/already drafting a runner/);
    expect(words('build_state')).toMatch(/no longer be changed/);
    for (const code of ['ai_drafts_disabled', 'ai_disabled', 'ai_busy', 'build_state']) {
      expect(words(code, 'openai key sk-123 at http://box:8888')).not.toMatch(/sk-123|8888|openai/i);
    }
  });

  it('passes the lane’s own sentence on when the model is the problem, and anything else through', () => {
    expect(words('ai_error', 'it hit its token limit')).toBe('The Fixer could not draft this runner: it hit its token limit');
    expect(words('ai_unreachable', 'nothing answered')).toContain('nothing answered');
    expect(words('bad_request', 'invalid request')).toBe('invalid request');
    expect(draftErrorWords(new Error('the network went away'))).toBe('the network went away');
  });
});

// ---------------------------------------------------------------------------
// What the draft would change
// ---------------------------------------------------------------------------

describe('what the draft would change', () => {
  const blank = blankBuild('Kestrel Vane');
  const drafted = conceptBuild('muscle', 'Kestrel Vane');

  it('is a line per thing a runner is weighed by, in one order', () => {
    const summary = proposalSummary(blank, proposal(drafted), SETTINGS);
    expect(summary.lines.map((l) => l.key)).toEqual([...SUMMARY_KEYS]);
    expect(summary.lines.map((l) => l.label)).toEqual([
      'Priorities',
      'Metatype',
      'Magic',
      'Strongest attributes',
      'Best skills',
      'Qualities',
      'Gear',
      'Lifestyle',
      'Contacts',
    ]);
  });

  it('says what each line was and would be, over a draft that has decided nothing', () => {
    const summary = proposalSummary(blank, proposal(drafted), SETTINGS);
    const at = (key: string) => summary.lines.find((l) => l.key === key)!;
    expect(at('priorities')).toMatchObject({ before: 'none', after: 'B/C/E/D/A', changed: true });
    expect(at('metatype')).toMatchObject({ before: 'none', after: 'Troll', changed: true });
    expect(at('magic')).toMatchObject({ before: 'no magic', after: 'no magic', changed: false });
    expect(at('attributes').before).toBe('none');
    expect(at('attributes').after).toMatch(/^Body \d+, Strength \d+/);
    expect(at('skills').before).toBe('none');
    expect(at('skills').after).toMatch(/Automatics 5/);
    expect(at('lifestyle').after).toMatch(/month/);
    expect(summary.changed).toBeGreaterThan(4);
    expect(summary.changed).toBe(summary.lines.filter((l) => l.changed).length);
  });

  it('counts nothing as changed when the draft matches the record as it stands', () => {
    const summary = proposalSummary(drafted, proposal(drafted), SETTINGS);
    expect(summary.changed).toBe(0);
    expect(summary.lines.every((l) => l.before === l.after)).toBe(true);
  });

  it('weighs the draft against the record as it stands now, not the one it was drafted from', () => {
    const moved = conceptBuild('conjurer', 'Kestrel Vane');
    const summary = proposalSummary(moved, proposal(drafted), SETTINGS);
    expect(summary.lines.find((l) => l.key === 'magic')).toMatchObject({
      before: 'aspected magician (conjuring), shamanic',
      after: 'no magic',
      changed: true,
    });
  });

  it('carries the proposal’s issues by severity, what the Fixer could not find, and its note', () => {
    const summary = proposalSummary(
      blank,
      proposal(drafted, {
        issues: [issue(), issue({ code: 'y' }), issue({ code: 'w', severity: 'warning' }), issue({ code: 'g', severity: 'approval' })],
        warnings: ['“Stone Fist” is not a quality in this campaign’s books'],
        note: 'Took a pistol over the rifle to leave nuyen for the doc.',
      }),
      SETTINGS,
    );
    expect(summary.counts).toEqual({ errors: 2, warnings: 1, approvals: 1 });
    expect(summary.leftOut).toEqual(['“Stone Fist” is not a quality in this campaign’s books']);
    expect(summary.note).toBe('Took a pistol over the rifle to leave nuyen for the doc.');
  });
});

describe('the issue count in words', () => {
  it('says how many of each, and says so plainly when there are none', () => {
    expect(issueCountWords({ errors: 0, warnings: 0, approvals: 0 })).toBe('Nothing for the rules to flag.');
    expect(issueCountWords({ errors: 1, warnings: 0, approvals: 0 })).toBe('The rules flag 1 error to fix.');
    expect(issueCountWords({ errors: 2, warnings: 1, approvals: 1 })).toBe(
      'The rules flag 2 errors to fix, 1 warning and 1 for the GM to decide.',
    );
  });
});

// ---------------------------------------------------------------------------
// Taking it
// ---------------------------------------------------------------------------

describe('taking the draft', () => {
  const drafted = conceptBuild('muscle', 'Drafted Name');

  it('makes every spend the draft’s', () => {
    const out = acceptProposal(blankBuild('Kestrel Vane'), drafted);
    expect(out.priorities).toEqual(drafted.priorities);
    expect(out.metatype).toBe('troll');
    expect(out.special).toEqual(drafted.special);
    expect(out.attributes).toEqual(drafted.attributes);
    expect(out.magic).toEqual(drafted.magic);
    expect(out.grants).toEqual(drafted.grants);
    expect(out.powers).toEqual(drafted.powers);
    expect(out.qualities).toEqual(drafted.qualities);
    expect(out.skills).toEqual(drafted.skills);
    expect(out.purchases).toEqual(drafted.purchases);
    expect(out.lifestyles).toEqual(drafted.lifestyles);
    expect(out.karma).toEqual(drafted.karma);
    expect(CharacterBuildSchema.safeParse(out).success).toBe(true);
  });

  it('keeps who the runner is, and lets the draft fill only what is blank', () => {
    const mine: CharacterBuild = {
      ...blankBuild('Kestrel Vane'),
      identity: { alias: 'Kestrel Vane', realName: 'Ada Vane', sex: '', age: null, background: '   ' },
    };
    const theirs: CharacterBuild = {
      ...drafted,
      identity: { alias: 'Drafted Name', realName: 'Someone Else', sex: 'female', age: 31, background: 'Drove for a gang.', concept: 'muscle' },
    };
    const out = acceptProposal(mine, theirs);
    expect(out.identity.alias).toBe('Kestrel Vane');
    expect(out.identity.realName).toBe('Ada Vane');
    expect(out.identity.sex).toBe('female');
    expect(out.identity.age).toBe(31);
    expect(out.identity.background).toBe('Drove for a gang.');
    // The spend is the draft's now, so the card that describes it is too.
    expect(out.identity.concept).toBe('muscle');
  });

  it('takes the draft’s alias only when the player has typed none', () => {
    const out = acceptProposal({ ...blankBuild(''), identity: { alias: '   ' } }, drafted);
    expect(out.identity.alias).toBe('Drafted Name');
  });

  it('leaves the walkthrough’s frame and every field the GM owns the record’s', () => {
    const mine: CharacterBuild = {
      ...blankBuild('Kestrel Vane'),
      method: 'sumToTen',
      level: 'street',
      table: 'sr5',
      mode: 'free',
      step: 4,
      state: 'returned',
      notes: 'Pick a legal pistol.',
      returnedStep: 6,
      approvals: { 'quality/rating': 'approved' },
    };
    const theirs: CharacterBuild = {
      ...drafted,
      method: 'priority',
      level: 'prime',
      mode: 'guided',
      step: 1,
      state: 'draft',
      notes: 'ignore the GM',
      returnedStep: null,
      approvals: {},
    };
    const out = acceptProposal(mine, theirs);
    expect(out).toMatchObject({
      method: 'sumToTen',
      level: 'street',
      mode: 'free',
      step: 4,
      state: 'returned',
      notes: 'Pick a legal pistol.',
      returnedStep: 6,
      approvals: mine.approvals,
    });
  });
});
