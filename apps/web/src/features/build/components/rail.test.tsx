/**
 * The rail (docs/CHARGEN.md §4.4 "every pool as spent / available … plus the
 * derived numbers as they change").
 *
 * Rendered to static markup from the real engine's budgets and derived
 * character over invented runners, so the assertions are about what a player
 * would read: every pool present, an overspent pool marked in words and not
 * only in red, and the derived block (initiative, limits, monitors, Essence,
 * Magic or Resonance) present once the build compiles.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Budgets } from '@safehouse/contracts';
import Rail from './Rail.js';
import { analysisOf, blankBuild, conceptBuild } from '../testing.js';

const text = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

describe('Rail', () => {
  it('lists every core pool as spent / available', () => {
    const a = analysisOf(conceptBuild('muscle'));
    const html = renderToStaticMarkup(<Rail budgets={a.budgets} derived={a.preview.derived} />);
    for (const key of ['special', 'attributes', 'skills', 'groups', 'knowledge', 'karma', 'nuyen', 'contactKarma']) {
      expect(html).toContain(`data-pool="${key}"`);
    }
    const skills = a.budgets.pools.skills;
    expect(text(html)).toContain(`Skill points: ${skills.spent} of ${skills.available} spent`);
    expect(html).not.toContain('data-over="yes"');
  });

  it('marks an overspent pool in words as well as colour', () => {
    const a = analysisOf(conceptBuild('muscle'));
    const budgets: Budgets = {
      ...a.budgets,
      pools: { ...a.budgets.pools, attributes: { available: 20, spent: 23, remaining: -3 } },
    };
    const html = renderToStaticMarkup(<Rail budgets={budgets} derived={a.preview.derived} />);
    expect(html).toMatch(/data-pool="attributes" data-over="yes"/);
    expect(text(html)).toContain('Attribute points: 23 of 20 spent, over by 3');
    expect(text(html)).toContain('over by 3');
    expect(html).toContain('data-testid="rail-over-count"');
    expect(text(html)).toContain('1 overspent');
  });

  it('shows the derived numbers play will use', () => {
    const a = analysisOf(conceptBuild('muscle'));
    const d = a.preview.derived!;
    const html = renderToStaticMarkup(<Rail budgets={a.budgets} derived={d} />);
    expect(html).toContain('data-testid="rail-initiative"');
    expect(text(html)).toContain(`${d.initiative.physical.base.value} + ${d.initiative.physical.dice.value}D6`);
    expect(text(html)).toContain(`${d.limits.physical.value} / ${d.limits.mental.value} / ${d.limits.social.value}`);
    expect(text(html)).toContain(`${d.monitors.physical.value} / ${d.monitors.stun.value}`);
    expect(html).toContain('data-testid="rail-essence"');
  });

  it('shows Magic for a magic user and Resonance for a technomancer', () => {
    const mage = analysisOf(conceptBuild('street-mage'));
    expect(renderToStaticMarkup(<Rail budgets={mage.budgets} derived={mage.preview.derived} />)).toContain(
      'data-testid="rail-magic"',
    );
    const techno = analysisOf(conceptBuild('technomancer'));
    const html = renderToStaticMarkup(<Rail budgets={techno.budgets} derived={techno.preview.derived} />);
    expect(html).toContain('data-testid="rail-resonance"');
    expect(html).not.toContain('data-testid="rail-magic"');
  });

  it('says what the carry-over loses plainly — "18 lost", not "−18 lost"', () => {
    const a = analysisOf(conceptBuild('muscle'));
    const budgets: Budgets = { ...a.budgets, preview: { ...a.budgets.preview, karmaCarried: 7, karmaLost: 18, nuyenCarried: 5000, nuyenLost: 40000 } };
    const html = renderToStaticMarkup(<Rail budgets={budgets} derived={a.preview.derived} />);
    expect(text(html)).toContain('7 (18 lost)');
    expect(text(html)).toContain('5,000¥ (40,000¥ lost)');
    expect(html).not.toContain('−18');
    expect(html).not.toContain('−40,000');
  });

  it('says why the derived block is missing rather than showing stale numbers', () => {
    const a = analysisOf(blankBuild());
    const html = renderToStaticMarkup(<Rail budgets={a.budgets} derived={null} previewError="no metatype yet" />);
    expect(html).toContain('data-testid="rail-derived-pending"');
    expect(text(html)).toContain('no metatype yet');
    expect(html).not.toContain('data-testid="rail-initiative"');
  });
});
