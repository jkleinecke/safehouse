/**
 * The kit's small components, rendered to static markup (`PoolLine`,
 * `CostQuote`, `WhyLink`, `ChoiceCards`, `RatingPicker`). Pinned for each
 * state that matters: a pool with points left, exactly spent and over (said
 * in words, not colour alone); a price the pool can and cannot pay; the
 * "why?" chip at a page; a radio group with one tab stop, the chosen card
 * marked in words, a refused card still focusable with its reason tied to it,
 * read-only; the arrow-key moves as a function; and a rating inside the
 * book's range that refuses past it. Invented numbers and names.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { BudgetPool, Budgets } from '@safehouse/contracts';
import { budgets as engineBudgets } from '@safehouse/rules';
import { SETTINGS, conceptBuild } from '../testing.js';
import ChoiceCards, { choiceKeyDown, choiceKeyTarget, choiceTabStop, type Choice } from './ChoiceCards.js';
import CostQuote from './CostQuote.js';
import PoolLine from './PoolLine.js';
import RatingPicker from './RatingPicker.js';
import WhyLink from './WhyLink.js';

const noop = () => undefined;
const pool = (available: number, spent: number): BudgetPool => ({ available, spent, remaining: available - spent });

/** The engine's budgets for an invented concept build, with pools laid over for the state under test. */
function budgetsWith(pools: Partial<Record<string, BudgetPool>>): Budgets {
  const b = engineBudgets(conceptBuild('muscle'), SETTINGS);
  return { ...b, pools: { ...b.pools, ...pools } as Budgets['pools'] };
}

describe('PoolLine', () => {
  it('says what is left, and marks a pool exactly spent', () => {
    const html = renderToStaticMarkup(<PoolLine budgets={budgetsWith({ skills: pool(28, 16) })} pool="skills" id="skills-left" />);
    expect(html).toContain('12 of 28 skill points left');
    expect(html).toContain('id="skills-left"');
    expect(html).toContain('data-over="no"');
    expect(renderToStaticMarkup(<PoolLine budgets={budgetsWith({ skills: pool(28, 28) })} pool="skills" />)).toContain('text-ok');
  });

  it('says an overspend in words with a mark, not in colour alone', () => {
    const html = renderToStaticMarkup(<PoolLine budgets={budgetsWith({ skills: pool(28, 31) })} pool="skills" />);
    expect(html).toContain('data-over="yes"');
    expect(html).toContain('3 skill points over: 31 spent of 28');
    expect(html).toContain('✕');
  });

  it('renders nothing for a pool the build does not have', () => {
    const b = budgetsWith({});
    const { powerPoints: _gone, ...pools } = b.pools as Record<string, BudgetPool>;
    expect(renderToStaticMarkup(<PoolLine budgets={{ ...b, pools: pools as Budgets['pools'] }} pool="powerPoints" />)).toBe('');
  });
});

describe('CostQuote', () => {
  it('quotes a price the pool can pay, and one it cannot', () => {
    const ok = renderToStaticMarkup(<CostQuote amount={10} budgets={budgetsWith({ karma: pool(26, 0) })} id="q" />);
    expect(ok).toContain('costs 10 Karma — you have 26');
    expect(ok).toContain('data-short="no"');
    expect(ok).toContain('id="q"');
    const short = renderToStaticMarkup(<CostQuote amount={10} budgets={budgetsWith({ karma: pool(26, 20) })} />);
    expect(short).toContain('costs 10 Karma — you have 6, 4 short');
    expect(short).toContain('data-short="yes"');
    expect(renderToStaticMarkup(<CostQuote amount={4000} pool="nuyen" budgets={budgetsWith({ nuyen: pool(50000, 0) })} />)).toContain(
      'costs 4,000¥ — you have 50,000¥',
    );
  });
});

describe('WhyLink', () => {
  it('puts "why?" before the reader chip at the page, a 40 px target on touch', () => {
    const html = renderToStaticMarkup(<WhyLink refValue={{ book: 'SR5', page: 72 }} />);
    expect(html).toContain('why?');
    expect(html).toMatch(/<button[^>]*pointer-coarse:min-h-10[^>]*>SR5 p.72<\/button>/);
  });
});

describe('ChoiceCards', () => {
  const CHOICES: Choice<'adept' | 'magician' | 'technomancer'>[] = [
    { value: 'magician', title: 'Magician', detail: 'Casts and summons.', aside: 'Magic 4' },
    { value: 'adept', title: 'Adept', detail: 'Turns magic inward.' },
    {
      value: 'technomancer',
      title: 'Technomancer',
      refusal: { reason: 'This magic row does not offer technomancers.', ref: { book: 'SR5', page: 65 } },
    },
  ];

  it('is a radio group with one tab stop, the chosen card marked in words', () => {
    const html = renderToStaticMarkup(<ChoiceCards label="Kind of magic" choices={CHOICES} value="adept" onChange={noop} />);
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-label="Kind of magic"');
    const radios = [...html.matchAll(/<button[^>]*role="radio"[^>]*>/g)].map((m) => m[0]);
    expect(radios).toHaveLength(3);
    expect(radios.filter((r) => r.includes('tabindex="0"'))).toHaveLength(1);
    expect(radios[1]).toContain('aria-checked="true"');
    expect(radios[1]).toContain('tabindex="0"');
    expect(radios[0]).toContain('aria-checked="false"');
    expect(html).toMatch(/aria-hidden="true" class="mono-label text-cyan">chosen</);
    // Named by the title and figure, described by the line on what it is for.
    const nameIds = /aria-labelledby="([^"]+)"/.exec(radios[0]!)![1]!.split(' ');
    expect(nameIds).toHaveLength(2);
    expect(html).toContain(`id="${nameIds[0]}" class="min-w-[8ch] flex-auto break-words text-sm font-semibold text-ink">Magician<`);
    const described = /aria-describedby="([^"]+)"/.exec(radios[0]!)![1]!;
    expect(html).toContain(`id="${described}" class="text-xs text-dim">Casts and summons.<`);
    // A tap target at least 44 px tall.
    expect(radios[0]).toContain('min-h-11');
  });

  it('can tie a sentence about the whole choice to the group', () => {
    const html = renderToStaticMarkup(<ChoiceCards label="Aspect" describedBy="aspect-for-good" choices={CHOICES} value={null} onChange={noop} />);
    expect(html).toMatch(/role="radiogroup" aria-label="Aspect" aria-describedby="aspect-for-good"/);
    expect(renderToStaticMarkup(<ChoiceCards label="Aspect" choices={CHOICES} value={null} onChange={noop} />)).not.toMatch(/role="radiogroup"[^>]*aria-describedby/);
  });

  it('keeps a refused card focusable, refusing, with its reason and page tied to it', () => {
    const html = renderToStaticMarkup(<ChoiceCards label="Kind of magic" choices={CHOICES} value={null} onChange={noop} />);
    const refused = /<button[^>]*data-refused="yes"[^>]*>/.exec(html)![0];
    expect(refused).toContain('aria-disabled="true"');
    expect(refused).not.toMatch(/\sdisabled=""/);
    const reasonId = /aria-describedby="([^"]+)"/.exec(refused)![1]!;
    expect(html).toMatch(new RegExp(`<p id="${reasonId}"[^>]*data-refusal="technomancer"`));
    expect(html).toContain('This magic row does not offer technomancers.');
    expect(html).toContain('SR5 p.65');
    // With nothing chosen, the first card holds the tab stop.
    expect([...html.matchAll(/<button[^>]*role="radio"[^>]*>/g)][0]![0]).toContain('tabindex="0"');
  });

  it('read-only: the group says so and no card can be taken', () => {
    const html = renderToStaticMarkup(<ChoiceCards label="Metatype" choices={CHOICES.slice(0, 2)} value="magician" onChange={noop} readOnly />);
    expect(html).toContain('aria-readonly="true"');
    expect([...html.matchAll(/<button[^>]*role="radio"[^>]*>/g)].every((m) => m[0].includes('aria-disabled="true"'))).toBe(true);
  });

  it('moves with the arrows, wrapping, and to the ends with Home and End', () => {
    expect(choiceKeyTarget(3, 0, 'ArrowRight')).toBe(1);
    expect(choiceKeyTarget(3, 2, 'ArrowDown')).toBe(0);
    expect(choiceKeyTarget(3, 0, 'ArrowLeft')).toBe(2);
    expect(choiceKeyTarget(3, 1, 'ArrowUp')).toBe(0);
    expect(choiceKeyTarget(3, 1, 'Home')).toBe(0);
    expect(choiceKeyTarget(3, 0, 'End')).toBe(2);
    expect(choiceKeyTarget(3, 0, 'a')).toBeNull();
    expect(choiceKeyTarget(0, 0, 'ArrowRight')).toBeNull();
    expect(choiceTabStop(CHOICES, 'technomancer')).toBe(2);
    expect(choiceTabStop(CHOICES, 'nobody')).toBe(0);
  });

  it('arrows only move focus: browsing the cards never takes one (Space and Enter are the button’s own click)', () => {
    const focused: number[] = [];
    let prevented = 0;
    const key = (k: string) => ({ key: k, preventDefault: () => void prevented++ });
    expect(choiceKeyDown(key('ArrowDown'), 3, 0, (i) => focused.push(i))).toBe(true);
    expect(choiceKeyDown(key('ArrowDown'), 3, 1, (i) => focused.push(i))).toBe(true);
    expect(choiceKeyDown(key('End'), 3, 2, (i) => focused.push(i))).toBe(true);
    expect(focused).toEqual([1, 2, 2]);
    expect(prevented).toBe(3);
    // Enter and Space are left to the button, whose click is the only thing that takes a card.
    expect(choiceKeyDown(key('Enter'), 3, 1, (i) => focused.push(i))).toBe(false);
    expect(choiceKeyDown(key(' '), 3, 1, (i) => focused.push(i))).toBe(false);
    expect(focused).toHaveLength(3);
    expect(prevented).toBe(3);
  });

  it('keeps a long figure from running into the title on a phone, and the refusal glyph beside its sentence', () => {
    const long: Choice<'wide'>[] = [
      { value: 'wide', title: 'Wakyambi', aside: 'no special points · 12 Karma', refusal: { reason: 'Not on this row.', ref: { book: 'RF', page: 102 } } },
    ];
    const html = renderToStaticMarkup(<ChoiceCards label="Metatypes" choices={long} value={null} onChange={noop} />);
    expect(html).toMatch(/class="min-w-\[8ch\] flex-auto break-words[^"]*">Wakyambi</);
    expect(html).toMatch(/class="mono-label max-w-full break-words text-dim">no special points · 12 Karma</);
    expect(html).toMatch(/<p [^>]*class="flex items-baseline gap-1.5 text-xs text-warn"[^>]*><span aria-hidden="true" class="shrink-0">⛔<\/span>/);
  });
});

describe('RatingPicker', () => {
  it('steps inside the book\'s range and says where it ends', () => {
    const html = renderToStaticMarkup(<RatingPicker itemName="Knit Weave" value={2} max={3} onChange={noop} />);
    expect(html).toContain('aria-label="increase Rating of Knit Weave"');
    expect(html).toContain('rating 1 to 3');
    expect(html).not.toContain('data-refusal="increase"');
  });

  it('passes a hidden label and a note for + through to its stepper', () => {
    const html = renderToStaticMarkup(<RatingPicker itemName="Knit Weave" value={2} max={3} onChange={noop} hideLabel increaseDescribedBy="essence-note" />);
    expect(html).toMatch(/<span id="[^"]+" class="sr-only">Rating of Knit Weave<\/span>/);
    expect(html).toMatch(/<button[^>]*aria-label="increase Rating of Knit Weave"[^>]*aria-describedby="essence-note"/);
  });

  it('refuses past the maximum with a sentence, or past a rule that shuts it sooner', () => {
    const top = renderToStaticMarkup(<RatingPicker itemName="Knit Weave" value={3} max={3} onChange={noop} />);
    expect(top).toMatch(/<button[^>]*aria-label="increase Rating of Knit Weave"[^>]*aria-disabled="true"/);
    expect(top).toContain('Rating of Knit Weave is at its limit of 3.');
    const capped = renderToStaticMarkup(
      <RatingPicker
        itemName="Big Relay"
        value={6}
        max={null}
        onChange={noop}
        refuseIncrease={{ reason: "Device rating 7 is over this campaign's cap of 6.", ref: { book: 'SR5', page: 94 } }}
      />,
    );
    expect(capped).toContain('no maximum printed');
    expect(capped).toContain('Device rating 7 is over this campaign&#x27;s cap of 6.');
    expect(capped).toContain('SR5 p.94');
  });

  it('read-only shows the rating and offers no buttons', () => {
    const html = renderToStaticMarkup(<RatingPicker itemName="Knit Weave" value={2} max={3} onChange={noop} readOnly />);
    expect(html).not.toContain('<button');
    expect(html).toContain('>2<');
  });
});
