/**
 * The refusing stepper (docs/CHARGEN.md §4.4 Step 3 "the second stepper that
 * reaches its max refuses and says 'only one attribute may start at its
 * natural maximum (p. 66)'", §8.6 "with an accessible reason").
 *
 * What is pinned: a refusal is a sentence on the screen, tied to the refused
 * button with `aria-describedby`; the button stays focusable (`aria-disabled`
 * rather than `disabled`) so the reason can be reached; a rule's reason wins
 * over the bare bound; the "why?" chip opens the page; read-only offers no
 * controls. The press itself is `stepperGate`, tested as a function.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import LimitStepper, { RefusalNote, stepperGate, useLimitStepper } from './LimitStepper.js';

const noop = () => undefined;
const ONE_AT_MAX = { reason: 'Only one attribute may start at its natural maximum.', ref: { book: 'SR5', page: 66 } };

function button(html: string, name: string): string {
  return new RegExp(`<button[^>]*aria-label="${name}"[^>]*>`).exec(html)![0];
}

describe('stepperGate', () => {
  it('opens both ways inside the bounds', () => {
    expect(stepperGate({ label: 'Agility', value: 3, min: 1, max: 6 })).toMatchObject({ canIncrease: true, canDecrease: true });
  });

  it('refuses past the bounds with a sentence of its own', () => {
    const g = stepperGate({ label: 'Agility', value: 6, min: 1, max: 6 });
    expect(g.canIncrease).toBe(false);
    expect(g.increaseReason?.reason).toBe('Agility is at its limit of 6.');
    expect(stepperGate({ label: 'Agility', value: 1, min: 1, max: 6 }).decreaseReason?.reason).toBe('Agility cannot go below 1.');
  });

  it("lets a rule's reason refuse before the bound does", () => {
    const g = stepperGate({ label: 'Agility', value: 5, min: 1, max: 6, refuseIncrease: ONE_AT_MAX });
    expect(g.canIncrease).toBe(false);
    expect(g.increaseReason).toBe(ONE_AT_MAX);
  });
});

describe('LimitStepper', () => {
  it('ties the refusal to the refused button, keeps it focusable and links the page', () => {
    const html = renderToStaticMarkup(
      <LimitStepper label="Agility" value={5} min={1} max={6} onChange={noop} refuseIncrease={ONE_AT_MAX} />,
    );
    const up = button(html, 'increase Agility');
    expect(up).toContain('aria-disabled="true"');
    expect(up).not.toMatch(/\sdisabled=""/);
    expect(up).toContain('data-refused="yes"');
    const id = /aria-describedby="([^"]+)"/.exec(up)![1]!;
    expect(html).toMatch(new RegExp(`<p id="${id}"[^>]*data-refusal="increase"`));
    expect(html).toContain('Only one attribute may start at its natural maximum.');
    expect(html).toContain('SR5 p.66');
    // The other direction is open and carries no reason.
    const down = button(html, 'decrease Agility');
    expect(down).not.toContain('aria-disabled');
    expect(down).not.toContain('aria-describedby');
  });

  it('ties a quote beside it to the + button while the increase is open, and the refusal once it shuts', () => {
    const open = renderToStaticMarkup(<LimitStepper label="Loyalty" value={2} min={1} max={6} onChange={noop} increaseDescribedBy="quote-1" />);
    expect(button(open, 'increase Loyalty')).toContain('aria-describedby="quote-1"');
    expect(button(open, 'decrease Loyalty')).not.toContain('aria-describedby');
    const shut = renderToStaticMarkup(
      <LimitStepper label="Agility" value={5} min={1} max={6} onChange={noop} refuseIncrease={ONE_AT_MAX} increaseDescribedBy="quote-1" />,
    );
    const ids = /aria-describedby="([^"]+)"/.exec(button(shut, 'increase Agility')!)![1]!.split(' ');
    // Shut, the price no longer describes a press that cannot happen: only the refusal does.
    expect(ids).not.toContain('quote-1');
    expect(ids).toHaveLength(1);
    expect(shut).toMatch(new RegExp(`<p id="${ids[0]}"[^>]*data-refusal="increase"`));
  });

  it('is a labelled group with a live value', () => {
    const html = renderToStaticMarkup(<LimitStepper label="Loyalty" value={2} min={1} max={6} onChange={noop} />);
    expect(html).toMatch(/role="group" aria-labelledby="[^"]+"/);
    expect(html).toMatch(/<output[^>]*aria-live="polite"[^>]*>2/);
    expect(html).not.toContain('data-refusal');
  });

  it('read-only shows the value and offers nothing', () => {
    const html = renderToStaticMarkup(<LimitStepper label="Loyalty" value={6} max={6} onChange={noop} readOnly />);
    expect(html).not.toContain('<button');
    expect(html).not.toContain('data-refusal');
    expect(html).toContain('>6');
  });
});

describe('LimitStepper: quiet until pressed, and placeable under a row', () => {
  const AT_SIX = { reason: 'Pistols 7 is over the creation maximum of 6.', ref: { book: 'SR5', page: 88 }, hint: 'at 6' };

  it('says an unpressed refusal quietly: the hint on screen, the sentence for a screen reader, no ⛔', () => {
    const html = renderToStaticMarkup(<LimitStepper label="Pistols" value={6} min={0} onChange={noop} refuseIncrease={AT_SIX} />);
    const up = button(html, 'increase Pistols');
    const id = /aria-describedby="([^"]+)"/.exec(up)![1]!;
    const note = new RegExp(`<p id="${id}"[^>]*data-refusal="increase"[^>]*>(.*?)</p>`).exec(html)!;
    expect(note[0]).toContain('data-voice="quiet"');
    expect(note[0]).toContain('text-faint');
    expect(note[1]).toContain('<span aria-hidden="true">at 6</span>');
    expect(note[1]).toContain('<span class="sr-only">Pistols 7 is over the creation maximum of 6.</span>');
    expect(html).not.toContain('⛔');
    // With no hint, the sentence itself is on screen, still muted.
    const plain = renderToStaticMarkup(<LimitStepper label="Agility" value={5} min={1} max={6} onChange={noop} refuseIncrease={ONE_AT_MAX} />);
    expect(plain).toContain('data-voice="quiet"');
    expect(plain).toMatch(/<span>Only one attribute may start at its natural maximum\.<\/span>/);
  });

  it('says a pressed refusal as the ⛔ sentence and its page', () => {
    const html = renderToStaticMarkup(<RefusalNote id="r1" refusal={AT_SIX} voice="pressed" direction="increase" />);
    expect(html).toContain('data-voice="pressed"');
    expect(html).toContain('text-warn');
    expect(html).toContain('⛔');
    expect(html).toContain('Pistols 7 is over the creation maximum of 6.');
    expect(html).toContain('SR5 p.88');
    expect(html).not.toContain('at 6');
    // The ⛔ cannot be stranded on a line of its own above a wrapped sentence.
    expect(html).toMatch(/<p id="r1" class="flex items-baseline gap-1.5 text-xs text-warn [^"]*"[^>]*><span aria-hidden="true" class="shrink-0">⛔<\/span><span class="flex min-w-0 flex-1 flex-wrap/);
  });

  it('hands a row the buttons and the refusal apart, still tied by id', () => {
    function Row() {
      const { controls, refusal } = useLimitStepper({ label: 'Pistols', hideLabel: true, value: 6, onChange: noop, refuseIncrease: AT_SIX });
      return (
        <li>
          <div data-part="line">
            <span>Pistols</span>
            {controls}
          </div>
          <div data-part="under">{refusal}</div>
        </li>
      );
    }
    const html = renderToStaticMarkup(<Row />);
    const line = /<div data-part="line">(.*?)<\/div><div data-part="under">/.exec(html)![1]!;
    expect(line).not.toContain('data-refusal');
    const id = /aria-describedby="([^"]+)"/.exec(button(html, 'increase Pistols'))![1]!;
    expect(html).toMatch(new RegExp(`<div data-part="under"><p id="${id}"`));
    // The bound's own refusal has a hint too.
    expect(stepperGate({ label: 'Loyalty', value: 6, max: 6 }).increaseReason).toMatchObject({ hint: 'at 6' });
  });
});
