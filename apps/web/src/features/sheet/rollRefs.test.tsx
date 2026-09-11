/**
 * Every roll says where to read up (FR11.2): the dialog's config becomes the
 * references behind it — skill, attributes, test, limit — and the chips
 * render in place, opening the book over the dialog rather than a new tab.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { rollRefs } from '@safehouse/rules';
import RollRefs from './components/RollRefs.js';
import { RefChip } from './components/ui.js';
import { refsForRoll } from './rollRefs.js';
import { skillRollConfig } from './rollDialogState.js';

describe('refsForRoll', () => {
  it('reads a skill row: the skill, its attribute from the pool, the test, the limit', () => {
    const config = skillRollConfig(
      { id: 'sneaking', rating: 4, attr: 'agi' },
      {
        total: 9,
        breakdown: [
          { label: 'AGI', value: 5, source: 'attribute' },
          { label: 'sneaking', value: 4, source: 'skill' },
        ],
        limit: { kind: 'physical', value: 6 },
      },
    );
    expect(refsForRoll(config).map((r) => r.topic)).toEqual([
      'sneaking · Physical Active Skills',
      'Agility',
      'Success Tests',
      'Limits',
    ]);
  });

  it('knows a weapon by the skill the sheet put in its meta, and melee from ranged', () => {
    const refs = refsForRoll({
      title: 'Katana — melee',
      baseTotal: 8,
      baseBreakdown: [{ label: 'AGI', value: 5, source: 'attribute' }],
      meta: { poolRef: 'weapon.Katana', skill: 'blades' },
    });
    expect(refs.map((r) => r.topic)).toEqual([
      'blades · Combat Active Skills',
      'Melee Combat',
      'Agility',
      'Success Tests',
    ]);
  });

  it('a drain roll reads as Drain, with both attributes', () => {
    const refs = refsForRoll({
      title: 'Drain — Stunbolt',
      kind: 'threshold',
      baseTotal: 9,
      baseBreakdown: [
        { label: 'WIL', value: 5, source: 'attribute' },
        { label: 'CHA', value: 4, source: 'attribute' },
      ],
      meta: { drainFor: 'Stunbolt', threshold: 4 },
    });
    expect(refs.map((r) => r.topic)).toEqual(['Drain', 'Willpower', 'Charisma', 'Success Tests']);
  });

  it('a macro is at least a Success Test; no config is nothing', () => {
    expect(refsForRoll({ title: 'Lucky', baseTotal: 6, baseBreakdown: [{ label: 'Lucky', value: 6, source: 'situational' }] }).map((r) => r.topic)).toEqual(['Success Tests']);
    expect(refsForRoll(null)).toEqual([]);
  });
});

describe('the chips', () => {
  it('render one chip per reference, naming the section, and nothing for none', () => {
    const html = renderToStaticMarkup(<RollRefs refs={rollRefs({ poolRef: 'skill.perception', attributes: ['INT'] })} />);
    expect(html).toContain('data-testid="roll-refs"');
    expect(html).toContain('SR5 p.132');
    expect(html).toContain('perception · Physical Active Skills');
    expect(html).toContain('SR5 p.51');
    expect(html).toContain('SR5 p.44');
    expect(html).not.toContain('target="_blank"');
    expect(renderToStaticMarkup(<RollRefs refs={[]} />)).toBe('');
  });

  it("the sheet's own ref chip opens in place, and offers a search when there is no page", () => {
    const withPage = renderToStaticMarkup(<RefChip refInfo={{ book: 'SR5', page: 426 }} lookup="Ares Predator" />);
    expect(withPage).toContain('SR5 p.426');
    expect(withPage).not.toContain('target="_blank"');
    expect(withPage).not.toContain('data-testid="ref-lookup"');
    const withoutPage = renderToStaticMarkup(<RefChip refInfo={undefined} lookup="Ares Predator" />);
    expect(withoutPage).toContain('data-testid="ref-lookup"');
    expect(withoutPage).toContain('aria-label="Find Ares Predator in the books"');
    expect(renderToStaticMarkup(<RefChip refInfo={undefined} />)).toBe('');
  });
});
