/**
 * Step 2 — Priorities, rendered to static markup (docs/CHARGEN.md §4.4
 * Step 2). Pinned for the states that matter: an empty build (five columns
 * with no row, one tab stop each), a card's rows with swaps and the later
 * steps a swap would reopen tied to their rows, a partly filled build, Sum to
 * Ten with its pool and a raise refused in the validator's words, a record
 * already over, the method switch and its confirm, the mundane note,
 * read-only and the GM's review, and the structure a phone and a laptop each
 * get (column pickers below `lg`, a keyboard grid in its own scroller above).
 *
 * Every build comes from the engine (`emptyBuild`, the concept cards) and
 * every number and sentence on screen is its answer. Invented runners only.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChargenSettingsSchema, type CharacterBuild, type ChargenSettings, type PriorityColumn, type PriorityLevel } from '@safehouse/contracts';
import { analyseBuild } from '../../analysis.js';
import { issuesForStep } from '../../lib.js';
import { BUILD_ID, CAMPAIGN, SETTINGS, blankBuild, conceptBuild } from '../../testing.js';
import PrioritiesStep from '../Priorities.js';
import { stepMeta } from '../meta.js';
import { inertActions, type StepProps } from '../types.js';
import { MethodSwitchView } from './MethodSwitch.js';
import ColumnPicker from './ColumnPicker.js';
import PriorityGrid from './PriorityGrid.js';
import { methodModel, prioritiesModel } from './model.js';

const noop = () => undefined;
const SUM_TO_TEN_SETTINGS: ChargenSettings = ChargenSettingsSchema.parse({ allowSumToTen: true });

function stepProps(build: CharacterBuild, over: Partial<StepProps> = {}, settings: ChargenSettings = SETTINGS): StepProps {
  const analysis = analyseBuild(build, settings);
  return {
    campaignId: CAMPAIGN,
    buildId: BUILD_ID,
    characterId: null,
    isOwner: true,
    meta: stepMeta(2),
    build,
    settings,
    settingsFromCampaign: true,
    budgets: analysis.budgets,
    issues: issuesForStep(analysis.issues, 2),
    allIssues: analysis.issues,
    status: analysis.steps[1]!,
    steps: analysis.steps,
    eligibility: analysis.eligibility,
    preview: analysis.preview,
    ratings: analysis.ratings,
    probe: analysis.probe,
    update: noop,
    goTo: noop,
    readOnly: false,
    reviewMode: false,
    mode: 'guided',
    role: 'player',
    actions: inertActions(),
    ...over,
  };
}

const render = (props: StepProps) => renderToStaticMarkup(<PrioritiesStep {...props} />);

/** The visible words, tags stripped and entities decoded. */
function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ');
}

/** The markup of the element carrying `attr="value"`, up to its closing tag (no nesting of the same tag inside). */
function element(html: string, tag: string, attr: string): string {
  const start = html.indexOf(attr);
  if (start === -1) throw new Error(`no ${attr}`);
  const open = html.lastIndexOf(`<${tag}`, start);
  const close = html.indexOf(`</${tag}>`, start);
  return html.slice(open, close + tag.length + 3);
}

/** The opening tag of the first element carrying `attr`. */
function openTag(html: string, attr: string): string {
  const start = html.indexOf(attr);
  if (start === -1) throw new Error(`no ${attr}`);
  const open = html.lastIndexOf('<', start);
  return html.slice(open, html.indexOf('>', start) + 1);
}

/** Every id an element's `aria-describedby` names exists in the markup; returns their texts. */
function describedTexts(html: string, tag: string): string[] {
  const ids = /aria-describedby="([^"]+)"/.exec(tag)?.[1]?.split(' ') ?? [];
  return ids.map((id) => {
    const at = html.indexOf(`id="${id}"`);
    expect(at, `describedby id ${id}`).toBeGreaterThan(-1);
    const open = html.lastIndexOf('<', at);
    const name = /^<(\w+)/.exec(html.slice(open))![1]!;
    return text(html.slice(open, html.indexOf(`</${name}>`, at)));
  });
}

/**
 * Glyph lines that can strand their glyph: a line whose first child is a
 * decorative ⛔ ⚠ ! ✕ ? – glyph, laid out as a wrapping flex row or with a
 * glyph that may shrink (inline text, not flex, keeps a glyph on the first
 * line with the words). On a narrow column the sentence then wraps onto a
 * flex line of its own and leaves the glyph alone on the line above it.
 */
function strandedGlyphs(markup: string): string[] {
  return [...markup.matchAll(/<(?:p|li)\b[^>]*class="([^"]*)"[^>]*>\s*<span aria-hidden="true"(?: class="([^"]*)")?>([^<]*)<\/span>/g)]
    .filter((m) => /[⛔⚠!✕?–]/.test(m[3] ?? '') && /\bflex\b/.test(m[1] ?? '') && (/\bflex-wrap\b/.test(m[1] ?? '') || !/\bshrink-0\b/.test(m[2] ?? '')))
    .map((m) => m[0]);
}

/** The column picker section of one column. */
const column = (html: string, c: PriorityColumn) => element(html, 'section', `data-testid="priority-column-${c}"`);

/** One cell's wrapper in a column picker. */
function pickerCell(html: string, c: PriorityColumn, level: PriorityLevel): string {
  const section = column(html, c);
  const start = section.indexOf(`data-cell="${c}-${level}"`);
  const open = section.lastIndexOf('<div', start);
  const next = section.indexOf('data-cell="', start + 10);
  return section.slice(open, next === -1 ? undefined : section.lastIndexOf('<div', next));
}

describe('Priorities — an empty build', () => {
  const html = render(stepProps(blankBuild()));

  it('says nothing is set yet and who the metatype cells speak for', () => {
    expect(text(html)).toContain('0 of 5 columns have a row; each needs one before the next step.');
    expect(text(html)).toContain('each Metatype cell lists the special points for all five');
    expect(html).toContain('data-filled="0"');
    expect(html).not.toContain('data-testid="priority-concept"');
    expect(html).not.toContain('data-testid="priority-mundane"');
  });

  it('gives every column a heading and a radio group of five rows with one tab stop', () => {
    for (const c of ['metatype', 'attributes', 'magic', 'skills', 'resources'] as const) {
      const section = column(html, c);
      expect(section).toContain('data-level="none"');
      expect(section).toMatch(/<h2 [^>]*>/);
      expect(text(section)).toContain('no row yet');
      expect(section).toContain('role="radiogroup"');
      expect(section.match(/role="radio"/g)).toHaveLength(5);
      expect(section.match(/tabindex="0"/g)).toHaveLength(1);
      expect(section.match(/aria-checked="false"/g)).toHaveLength(5);
      const labelledBy = /role="radiogroup" aria-labelledby="([^"]+)"/.exec(section)![1]!;
      expect(section).toContain(`<h2 id="${labelledBy}"`);
    }
  });

  it('says what each row buys', () => {
    const metatype = text(column(html, 'metatype'));
    expect(metatype).toContain('Human 9 · Elf 8 · Dwarf 7 · Ork 7 · Troll 5');
    expect(metatype).toContain('Not on this row: Elf, Dwarf, Ork and Troll.');
    expect(text(column(html, 'resources'))).toContain('nuyen at the experienced level');
    expect(text(column(html, 'resources'))).toContain('450,000¥');
    expect(text(column(html, 'magic'))).toContain('Adept or aspected magician: Magic 2.');
  });

  it('offers the jump to step 3 only where the walkthrough would let the player land', () => {
    // Guided and incomplete: the shortcut would walk round Next's gate.
    expect(html).not.toContain('data-testid="priority-go-metatype"');
    expect(render(stepProps(blankBuild(), { mode: 'free' }))).toContain('data-testid="priority-go-metatype"');
    expect(render(stepProps(conceptBuild('face')))).toContain('data-testid="priority-go-metatype"');
  });

  it('lists no issues the columns already show, and offers no method switch', () => {
    expect(html).not.toContain('data-testid="priority-issues"');
    expect(html).not.toContain('data-testid="priority-method"');
  });
});

describe('Priorities — a card’s rows', () => {
  const face = conceptBuild('face'); // C/B/E/A/D, elf, mundane
  const html = render(stepProps(face));

  it('marks each column’s row in words and makes it the tab stop', () => {
    const metatype = column(html, 'metatype');
    expect(metatype).toContain('data-level="C"');
    const chosen = openTag(pickerCell(html, 'metatype', 'C'), 'role="radio"');
    expect(chosen).toContain('aria-checked="true"');
    expect(chosen).toContain('tabindex="0"');
    expect(text(pickerCell(html, 'metatype', 'C'))).toContain('chosen');
    expect(text(html)).toContain('All five columns have a row.');
    expect(text(html)).toContain('These are the Back-room face card’s rows (C/B/E/A/D)');
  });

  it('writes the metatype cells for the chosen metatype', () => {
    expect(html).toContain('data-lean="elf"');
    expect(text(pickerCell(html, 'metatype', 'C'))).toContain('Elf: 3 special points');
    expect(text(pickerCell(html, 'metatype', 'E'))).toContain('No Elf on this row');
  });

  it('ties the swap and the step it would reopen to the row, before the tap', () => {
    const cellHtml = pickerCell(html, 'skills', 'C');
    const radio = openTag(cellHtml, 'role="radio"');
    expect(radio).toContain('data-breaks="yes"');
    const described = describedTexts(html, radio);
    expect(described.some((t) => t.includes('swaps with Metatype, which takes A'))).toBe(true);
    expect(described.some((t) => /Reopens steps? .*skill points/.test(t))).toBe(true);
    expect(cellHtml).toMatch(/data-breaks-steps="[\d,]+"/);
  });

  it('keeps an unfocused row to one short line, and spells the account out, with its page, under the row with focus', () => {
    // Twenty rows of sentences and chips made the phone's step 2 mostly amber: a row is brief until it has focus.
    const cellHtml = pickerCell(html, 'skills', 'C');
    const brief = element(cellHtml, 'p', 'data-testid="priority-cell-brief"');
    expect(brief).toContain('aria-hidden="true"');
    expect(text(brief)).toMatch(/↔ swaps with Metatype ⚠ reopens steps? \d/);
    expect(openTag(cellHtml, 'data-swap=')).toContain('class="sr-only"');
    expect(openTag(cellHtml, 'data-breaks-steps=')).toContain('class="sr-only"');
    expect(cellHtml).not.toContain('SR5 p.');
    expect(openTag(cellHtml, 'role="radio"')).toContain('data-open="no"');
    // Every row with a swap or a break keeps its short line; none spells it out until it has focus.
    expect(html.match(/data-testid="priority-cell-brief"/g)!.length).toBeGreaterThan(5);

    const analysis = analyseBuild(face, SETTINGS);
    const model = prioritiesModel({ build: face, settings: SETTINGS, probe: analysis.probe, allIssues: analysis.issues });
    const skills = model.columns.find((c) => c.column === 'skills')!;
    const focused = renderToStaticMarkup(<ColumnPicker column={skills} onPick={noop} initialFocus="C" />);
    const open = focused.slice(focused.indexOf('data-cell="skills-C"'), focused.indexOf('data-cell="skills-D"'));
    expect(open).toContain('data-open="yes"');
    expect(open).not.toContain('data-testid="priority-cell-brief"');
    expect(openTag(open, 'data-swap=')).not.toContain('sr-only');
    expect(text(open)).toContain('swaps with Metatype, which takes A');
    expect(open).toContain('SR5 p.');
    // A mundane card's Magic row says what taking it costs, short until focused, whole in the description.
    const magic = model.columns.find((c) => c.column === 'magic')!;
    const unusedBrief = renderToStaticMarkup(<ColumnPicker column={magic} onPick={noop} />);
    const magicC = unusedBrief.slice(unusedBrief.indexOf('data-cell="magic-C"'), unusedBrief.indexOf('data-cell="magic-D"'));
    expect(text(element(magicC, 'p', 'data-testid="priority-cell-brief"'))).toContain('⚠ Magic unused');
    expect(describedTexts(unusedBrief, openTag(magicC, 'role="radio"')).some((t) => t.includes('Magic priority C is spent on a mundane.'))).toBe(true);
    // Only the focused row opens; its neighbours stay brief.
    const next = focused.slice(focused.indexOf('data-cell="skills-B"'), focused.indexOf('data-cell="skills-C"'));
    expect(next).toContain('data-testid="priority-cell-brief"');
    expect(strandedGlyphs(focused)).toEqual([]);
  });

  it('says why a mundane card keeps Magic at E, with no stray dash beside it', () => {
    const note = element(html, 'p', 'data-testid="priority-mundane"');
    expect(note).toContain('data-kind="concept"');
    expect(text(note)).toContain('Back-room face is mundane, so Magic or Resonance sits at E');
    expect(text(note)).not.toContain('–');
  });

  it('keeps every glyph beside its sentence, however narrow the column', () => {
    expect(html).toContain('data-breaks-steps=');
    expect(strandedGlyphs(html)).toEqual([]);
  });
});

describe('Priorities — partly set, shuffled away from the card', () => {
  const build: CharacterBuild = {
    ...conceptBuild('face'),
    priorities: { metatype: 'C', attributes: 'A', magic: 'E', skills: null, resources: null },
  };
  const html = render(stepProps(build));

  it('counts the columns, offers the card’s rows back, and shows the empty columns', () => {
    expect(text(html)).toContain('3 of 5 columns have a row');
    expect(text(html)).toContain('The Back-room face card suggested C/B/E/A/D.');
    expect(html).toContain('data-testid="priority-restore-rows"');
    expect(column(html, 'skills')).toContain('data-level="none"');
  });

  it('a row taken from a column says that column is left empty', () => {
    const radio = openTag(pickerCell(html, 'skills', 'A'), 'role="radio"');
    expect(describedTexts(html, radio).some((t) => t.includes('takes it from Attributes, which is left empty'))).toBe(true);
  });
});

describe('Priorities — Sum to Ten', () => {
  const tens: CharacterBuild = {
    ...blankBuild(),
    method: 'sumToTen',
    priorities: { metatype: 'A', attributes: 'B', magic: 'C', skills: 'D', resources: 'E' },
  };

  it('shows the method, the pool and each row’s cost', () => {
    const html = render(stepProps(tens, {}, SUM_TO_TEN_SETTINGS));
    const method = element(html, 'section', 'data-testid="priority-method"');
    expect(method).toContain('data-method="sumToTen"');
    expect(text(method)).toContain('rows may repeat');
    expect(text(method)).toContain('0 of 10 priority points left');
    expect(text(method)).toContain('use the priority table');
    expect(text(pickerCell(html, 'resources', 'A'))).toContain('4 points');
  });

  it('refuses a raise past ten with the validator’s sentence, tied to the row, and lets a row come down', () => {
    const html = render(stepProps(tens, {}, SUM_TO_TEN_SETTINGS));
    const raise = openTag(pickerCell(html, 'resources', 'D'), 'role="radio"');
    expect(raise).toContain('aria-disabled="true"');
    expect(raise).toContain('data-refused="yes"');
    expect(describedTexts(html, raise)).toContain(' ⛔ The priorities cost 11 points; Sum to Ten allows 10. RF p.62 ');
    expect(strandedGlyphs(html)).toEqual([]);
    const lower = openTag(pickerCell(html, 'metatype', 'B'), 'role="radio"');
    expect(lower).not.toContain('aria-disabled');
    expect(lower).toContain('data-refused="no"');
  });

  it('a record already over says so in words and lists the error', () => {
    const over: CharacterBuild = { ...tens, priorities: { metatype: 'A', attributes: 'A', magic: 'A', skills: 'B', resources: 'E' } };
    const html = render(stepProps(over, {}, SUM_TO_TEN_SETTINGS));
    expect(text(html)).toContain('5 priority points over: 15 spent of 10');
    const issues = element(html, 'section', 'data-testid="priority-issues"');
    expect(issues).toContain('data-issue="sum-to-ten-over"');
    expect(text(issues)).toContain('must fix: The priorities cost 15 points; Sum to Ten allows 10.');
    expect(issues).toContain('<ul');
  });

  it('a campaign that turned Sum to Ten off still shows the method, with the reason tied to the way back', () => {
    const html = render(stepProps(tens, {}, SETTINGS));
    const method = element(html, 'section', 'data-testid="priority-method"');
    expect(text(method)).toContain('This campaign does not use Sum to Ten.');
    const back = openTag(method, 'data-testid="priority-method-switch"');
    expect(describedTexts(html, back).join(' ')).toContain('This campaign does not use Sum to Ten.');
    expect(text(element(method, 'button', 'data-testid="priority-method-switch"'))).toContain('use the priority table');
  });
});

describe('Priorities — the method switch', () => {
  const face = conceptBuild('face');
  const method = methodModel(face, SUM_TO_TEN_SETTINGS, []);
  const budgets = analyseBuild(face, SUM_TO_TEN_SETTINGS).budgets;

  it('a campaign that allows Sum to Ten offers it, closed until asked', () => {
    const html = renderToStaticMarkup(
      <MethodSwitchView method={method} budgets={budgets} onSwitch={noop} confirming={false} onAsk={noop} onCancel={noop} />,
    );
    expect(text(html)).toContain('The priority table: each column takes a different row');
    expect(text(html)).toContain('use Sum to Ten');
    expect(html).not.toContain('data-testid="priority-method-confirm"');
    expect(html).not.toContain('data-pool="priorityPoints"');
  });

  it('asks before switching, saying what the switch does to these rows', () => {
    const html = renderToStaticMarkup(
      <MethodSwitchView method={method} budgets={budgets} onSwitch={noop} confirming onAsk={noop} onCancel={noop} />,
    );
    const confirm = element(html, 'div', 'data-testid="priority-method-confirm"');
    expect(confirm).toContain('role="group"');
    expect(text(confirm)).toContain('The rows you have now stay where they are.');
    expect(text(html)).toContain('keep the priority table');
    expect(text(element(html, 'button', 'data-testid="priority-method-go"'))).toContain('use Sum to Ten');
    expect(html).not.toContain('data-testid="priority-method-switch"');
  });

  it('read-only shows the method but offers no switch', () => {
    const html = renderToStaticMarkup(
      <MethodSwitchView method={method} budgets={budgets} onSwitch={noop} readOnly confirming={false} onAsk={noop} onCancel={noop} />,
    );
    expect(html).toContain('data-testid="priority-method"');
    expect(html).not.toContain('<button');
  });

  it('renders nothing where the campaign does not allow it and the build does not use it', () => {
    const hidden = methodModel(face, SETTINGS, []);
    expect(
      renderToStaticMarkup(<MethodSwitchView method={hidden} budgets={budgets} onSwitch={noop} confirming={false} onAsk={noop} onCancel={noop} />),
    ).toBe('');
  });
});

describe('Priorities — phone and laptop', () => {
  const html = render(stepProps(conceptBuild('adept')));

  it('column pickers below lg, the grid above it in its own horizontal scroller', () => {
    expect(openTag(html, 'data-testid="priority-columns"')).toContain('lg:hidden');
    expect(openTag(html, 'data-testid="priority-table"')).toContain('hidden');
    expect(openTag(html, 'data-testid="priority-table"')).toContain('lg:block');
    expect(openTag(html, 'data-testid="priority-grid-scroll"')).toContain('overflow-x-auto');
  });

  it('touch targets are at least 40px and headings sit under the frame’s h1', () => {
    expect(openTag(pickerCell(html, 'magic', 'B'), 'role="radio"')).toContain('min-h-11');
    expect(html).not.toMatch(/<h1[\s>]/);
    const levels = [...html.matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));
    expect(Math.min(...levels)).toBe(2);
    expect(levels.every((l) => l <= 3)).toBe(true);
  });

  it('the grid: role grid, labelled, headers for rows and columns, one tab stop, each cell a pressed or unpressed button', () => {
    const grid = element(html, 'table', 'role="grid"');
    const labelledBy = /aria-labelledby="([^"]+)"/.exec(openTag(grid, 'role="grid"'))![1]!;
    expect(grid).toContain(`<caption id="${labelledBy}"`);
    expect(grid.match(/scope="col"/g)).toHaveLength(5);
    expect(grid.match(/scope="row"/g)).toHaveLength(5);
    expect(grid.match(/aria-pressed="true"/g)).toHaveLength(5);
    expect(grid.match(/aria-pressed="false"/g)).toHaveLength(20);
    expect(grid.match(/tabindex="0"/g)).toHaveLength(1);
    // The adept's magic cell reads its own grant, named by its place.
    const magicB = openTag(grid, 'data-cell="magic-B"');
    expect(magicB).toBeTruthy();
    expect(text(element(grid, 'td', 'data-cell="magic-B"'))).toContain('Magic or Resonance at B: Adept: Magic 6');
  });

  it('the grid’s detail panel follows the active cell and carries the pages', () => {
    const build = conceptBuild('face');
    const a = analyseBuild(build, SETTINGS);
    const model = prioritiesModel({ build, settings: SETTINGS, probe: a.probe, allIssues: a.issues });
    const grid = renderToStaticMarkup(<PriorityGrid model={model} onPick={noop} initialActive={{ row: 2, col: 3 }} />);
    const detail = element(grid, 'div', 'data-testid="priority-grid-detail"');
    expect(detail).toContain('data-cell="skills-C"');
    expect(detail).toMatch(/<h3[\s>]/);
    expect(text(detail)).toContain('Skills at C');
    expect(text(detail)).toContain('Taking it swaps with Metatype, which takes A.');
    expect(text(detail)).toMatch(/Reopens steps? .*SR5 p\./);
    // The tab stop moved with it.
    expect(openTag(grid, 'data-cell="skills-C"')).toBeTruthy();
    const tabStop = /<button[^>]*tabindex="0"[^>]*>/.exec(grid)![0];
    expect(describedTexts(grid, tabStop).join(' ')).toContain('Reopens step');
  });
});

describe('Priorities — read-only and review', () => {
  const face = conceptBuild('face');

  for (const [name, over] of [
    ['read-only', { readOnly: true }],
    ['the GM’s review', { reviewMode: true }],
  ] as const) {
    it(`${name}: the rows marked in words, nothing to press, nothing probed`, () => {
      const html = render(stepProps(face, over));
      expect(html).toContain('data-display="yes"');
      expect(html).not.toContain('role="radio"');
      expect(html).not.toContain('role="grid"');
      expect(html).not.toContain('data-testid="priority-go-metatype"');
      expect(html).not.toContain('data-breaks="yes"');
      expect(text(column(html, 'metatype'))).toContain('C Elf: 3 special points');
      expect(element(html, 'table', 'data-cell="metatype-C"')).toContain('● chosen');
      expect(html).not.toContain('data-testid="priority-grid-detail"');
      expect(html).not.toMatch(/<button[^>]*data-testid="priority-/);
    });
  }

  it('read-only with a column not yet chosen says so', () => {
    const build: CharacterBuild = { ...face, priorities: { ...face.priorities, resources: null } };
    const html = render(stepProps(build, { readOnly: true }));
    expect(text(column(html, 'resources'))).toContain('No row chosen for Resources.');
  });
});
