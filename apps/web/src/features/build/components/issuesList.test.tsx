/**
 * The issues list (docs/CHARGEN.md §4.4 "every validator finding, grouped
 * error / warning / needs-GM, each a tap to the step that fixes it and a tap
 * to the page").
 *
 * Real findings from the engine over an invented runner, rendered to static
 * markup: the three groups in reading order with glyphs and headings (not
 * colour alone), a step control per row — a button inside the builder, a link
 * outside it — and the reader chip at the issue's `{ book, page }`.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import type { Issue } from '@safehouse/contracts';
import IssuesList from './IssuesList.js';
import { splitIssues } from '../lib.js';
import { analysisOf, blankBuild, conceptBuild } from '../testing.js';

const noop = () => undefined;

const warning: Issue = {
  code: 'nuyen-carry-exact',
  severity: 'warning',
  step: 7,
  message: 'Exactly the carry-over is left.',
  ref: { book: 'SR5', page: 94 },
};
const approval: Issue = {
  code: 'approval-quality-lucky',
  severity: 'approval',
  step: 5,
  message: 'This quality needs the GM.',
  ref: { book: 'SR5', page: 76 },
};

describe('IssuesList', () => {
  it('groups findings as must fix, worth a look, needs the GM — in that order', () => {
    const issues = [approval, warning, ...analysisOf(blankBuild()).issues.filter((i) => i.severity === 'error')];
    const html = renderToStaticMarkup(<IssuesList issues={issues} onGoTo={noop} />);
    const order = [...html.matchAll(/data-issue-group="(\w+)"/g)].map((m) => m[1]);
    expect(order).toEqual(['error', 'warning', 'approval']);
    expect(html).toContain('Must fix');
    expect(html).toContain('Worth a look');
    expect(html).toContain('Needs the GM');
    // Severity is spoken, not only coloured.
    expect(html).toContain('<span class="sr-only">Must fix: </span>');
  });

  it("gives each row a button to its step and a chip to its page", () => {
    const html = renderToStaticMarkup(<IssuesList issues={[warning]} onGoTo={noop} />);
    // The accessible name starts with the chip's own words (WCAG 2.5.3).
    expect(html).toMatch(/<button[^>]*aria-label="step 7 · Gear — go to Gear"[^>]*>step 7 · Gear<\/button>/);
    expect(html).toContain('SR5 p.94');
  });

  it('links to the step instead when shown outside the builder', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <IssuesList issues={[warning]} hrefFor={(s) => `/c/c1/build/b1?step=${s}`} />
      </MemoryRouter>,
    );
    expect(html).toContain('href="/c/c1/build/b1?step=7"');
  });

  it("shows the GM's decision on an approval issue", () => {
    const html = renderToStaticMarkup(
      <IssuesList issues={[approval]} onGoTo={noop} approvals={{ 'approval-quality-lucky': 'denied' }} />,
    );
    expect(html).toContain('data-decision="denied"');
    expect(html).toContain('GM denied');
  });

  it('folds what waits on steps not reached under "later steps", muted and counted apart, and hides none of it', () => {
    const fresh = blankBuild();
    const issues = analysisOf(fresh).issues;
    const { now, later } = splitIssues(issues, 1, fresh);
    const html = renderToStaticMarkup(<IssuesList issues={issues} current={1} build={fresh} onGoTo={noop} />);
    expect(html).toMatch(new RegExp(`data-testid="build-issues-count">${now.length}(<!-- -->)? · ${later.length} later<`));
    const fold = html.slice(html.indexOf('data-testid="build-issues-later"'));
    expect(html.slice(0, html.indexOf('data-testid="build-issues-later"'))).not.toMatch(/data-step="[2-9]"/);
    expect(html).toMatch(/<details[^>]*data-testid="build-issues-later"/);
    expect(fold).toContain(`Later steps (${later.length})`);
    expect(fold.match(/data-issue=/g)).toHaveLength(later.length);
    // Muted: no red in the fold.
    expect(fold).not.toContain('text-danger');
    // Outside the walkthrough (no `current`), every finding is listed as it is.
    const flat = renderToStaticMarkup(<IssuesList issues={issues} onGoTo={noop} />);
    expect(flat).not.toContain('data-testid="build-issues-later"');
    expect(flat.match(/data-issue=/g)).toHaveLength(issues.length);
  });

  it('keeps a later step that holds choices in "must fix": a change upstream broke it', () => {
    const card = conceptBuild('muscle');
    const broken = { ...card, priorities: { ...card.priorities, skills: 'E' as const, resources: card.priorities.skills } };
    const issues = analysisOf(broken).issues;
    const skills = issues.filter((i) => i.step === 6 && i.severity === 'error');
    expect(skills.length).toBeGreaterThan(0);
    const { now, later } = splitIssues(issues, 2, broken);
    expect(now).toEqual(expect.arrayContaining(skills));
    expect(later.filter((i) => i.step === 6)).toEqual([]);
  });

  it('says so when there is nothing to fix', () => {
    const html = renderToStaticMarkup(<IssuesList issues={[]} onGoTo={noop} />);
    expect(html).toContain('data-testid="build-issues-empty"');
  });
});
