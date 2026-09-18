/**
 * What the sheet says about a runner's career (FR3.7, FR3.9 §4.1): who is
 * offered Improve with Karma, the header's "built with Priority B/A/E/C/D",
 * and the strip that renders both.
 *
 * Pinned: the Improve gate matches the advance route's (the owner or the GM,
 * never an observer, a display, another player or a device with no session);
 * the build line prints the five priorities in the book's column order with a
 * dash for a column the build never chose, names each column for a screen
 * reader, says the creation level when it is not the default, and is simply
 * absent for an imported or hand-typed sheet; and the record the sheet reads
 * off the wire carries the summary without ever failing on a broken one.
 *
 * Invented names (§14). Node + `renderToStaticMarkup`, no jsdom.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CharacterBuildSummary, SheetV1 } from '@safehouse/contracts';
import { SheetV1Schema } from '@safehouse/contracts';
import { deriveCharacter } from '@safehouse/rules';
import { normalizeCharacter, type CharacterRecord } from './api.js';
import { buildLineOf, canImprove } from './career.js';
import IdentityStrip, { type IdentityStripProps } from './components/IdentityStrip.js';

const SHEET: SheetV1 = SheetV1Schema.parse({
  v: 1,
  identity: { alias: 'Marrowlight', metatype: 'human' },
  attributes: { bod: 3, agi: 4, rea: 3, str: 3, wil: 3, log: 3, int: 4, cha: 2, edg: { max: 3, current: 3 } },
  skills: [{ id: 'pistols', rating: 3, attr: 'agi' }],
} satisfies Record<string, unknown>);

const SUMMARY: CharacterBuildSummary = {
  method: 'priority',
  level: 'experienced',
  table: 'sr5',
  priorities: { metatype: 'B', attributes: 'A', magic: 'E', skills: 'C', resources: 'D' },
  metatype: 'human',
  magic: 'mundane',
};

function record(over: Partial<CharacterRecord> = {}): CharacterRecord {
  return {
    id: 'ch-1',
    campaignId: 'camp-1',
    ownerUserId: 'user-wren',
    name: 'Marrowlight',
    sheet: SHEET,
    condition: { physical: 0, stun: 0 },
    edgeBurned: 0,
    balances: { karma: 12, nuyen: 4200 },
    build: SUMMARY,
    ...over,
  };
}

describe('who may improve a runner with Karma', () => {
  const mine = record();

  it('is the GM and the character’s own player, and nobody else', () => {
    expect(canImprove({ role: 'gm', userId: 'user-gm' }, mine)).toBe(true);
    expect(canImprove({ role: 'player', userId: 'user-wren' }, mine)).toBe(true);
    expect(canImprove({ role: 'player', userId: 'user-stray' }, mine)).toBe(false);
    expect(canImprove({ role: 'observer', userId: 'user-wren' }, mine)).toBe(false);
    expect(canImprove({ role: 'display', userId: 'user-wren' }, mine)).toBe(false);
  });

  it('refuses a device with no session and a character nobody owns', () => {
    expect(canImprove(null, mine)).toBe(false);
    expect(canImprove({ role: 'player' }, mine)).toBe(false);
    expect(canImprove({ role: 'player', userId: 'user-wren' }, record({ ownerUserId: undefined }))).toBe(false);
    // The GM improves an unowned NPC sheet all the same.
    expect(canImprove({ role: 'gm', userId: 'user-gm' }, record({ ownerUserId: undefined }))).toBe(true);
  });
});

describe('how the builder made this runner', () => {
  it('prints the five priorities in the book’s column order, and names them for a reader', () => {
    const line = buildLineOf(SUMMARY);
    expect(line?.text).toBe('built with Priority B/A/E/C/D');
    expect(line?.detail).toBe('Built with the Priority table: Metatype B, Attributes A, Magic E, Skills C, Resources D.');
  });

  it('says Sum to Ten when that is how it was built, repeated levels and all', () => {
    const line = buildLineOf({ ...SUMMARY, method: 'sumToTen', priorities: { metatype: 'C', attributes: 'A', magic: 'E', skills: 'C', resources: 'D' } });
    expect(line?.text).toBe('built with Sum to Ten C/A/E/C/D');
    expect(line?.detail).toContain('Sum to Ten table');
  });

  it('says the creation level when it is not the default, and dashes a column never chosen', () => {
    expect(buildLineOf({ ...SUMMARY, level: 'street' })?.text).toBe('built as a street-level runner with Priority B/A/E/C/D');
    expect(buildLineOf({ ...SUMMARY, level: 'prime' })?.text).toBe('built as a prime runner with Priority B/A/E/C/D');
    const half = buildLineOf({ ...SUMMARY, priorities: { ...SUMMARY.priorities, resources: null } });
    expect(half?.text).toBe('built with Priority B/A/E/C/—');
    expect(half?.detail).toContain('Resources —');
  });

  it('has nothing to say about an imported or hand-typed sheet', () => {
    expect(buildLineOf(null)).toBeNull();
    expect(buildLineOf(undefined)).toBeNull();
  });

  it('comes off the wire on the character record, and a broken summary is simply absent', () => {
    const wire = (build: unknown) => normalizeCharacter({ id: 'ch-1', name: 'Marrowlight', sheet: SHEET, build });
    expect(wire(SUMMARY).build).toEqual(SUMMARY);
    expect(wire(null).build).toBeNull();
    expect(wire({ method: 'nonsense' }).build).toBeNull();
    expect(wire(undefined).build).toBeNull();
  });
});

describe('the header strip', () => {
  const derived = deriveCharacter(SHEET);
  const strip = (over: Partial<IdentityStripProps>) =>
    renderToStaticMarkup(
      <IdentityStrip
        character={record()}
        derived={derived}
        onCondition={() => {}}
        onEdgeOp={() => {}}
        overrideFor={() => ({ set: () => {}, clear: () => {} })}
        {...over}
      />,
    );

  it('shows the build line to the eye and the columns to a screen reader', () => {
    const html = strip({ buildLine: buildLineOf(SUMMARY) });
    expect(html).toContain('<span aria-hidden="true">built with Priority B/A/E/C/D</span>');
    expect(html).toContain('<span class="sr-only">Built with the Priority table: Metatype B');
  });

  it('carries the career action the page decided on, as a thumb’s target', () => {
    const html = strip({
      buildLine: buildLineOf(SUMMARY),
      actions: (
        <button type="button" className="btn shrink-0 px-2.5 py-1 text-xs pointer-coarse:min-h-10" data-testid="sheet-improve">
          Improve
        </button>
      ),
    });
    const button = /<button[^>]*data-testid="sheet-improve"[^>]*>/.exec(html)?.[0] ?? '';
    expect(button).toContain('pointer-coarse:min-h-10');
    expect(html).toContain('Improve');
  });

  it('adds no line and no room for one when there is neither', () => {
    const html = strip({});
    expect(html).not.toContain('sheet-build-line');
    expect(html).not.toContain('Improve');
    // The strip is otherwise exactly what it was.
    expect(html).toContain('Marrowlight');
  });
});
