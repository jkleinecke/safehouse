/**
 * Tactical hints (FR10.10) — off by default, GM-only, and never a control.
 *
 * The FR's three promises are tested as three separate things because they can
 * each break on their own:
 *
 *  - **off by default** — `hintsEnabled` must mirror the server's rule
 *    (`services/tactical-hints.ts`) exactly, or the toggle shows a state the
 *    table never gets;
 *  - **GM-only, acting-only** — `shouldShowHint` decides which rows offer one;
 *  - **never acts** — the rendered line carries no button, no handler and no
 *    id, and says it is advisory in its accessible name.
 *
 * Rendered with `react-dom/server`: no DOM needed for markup, roles and names.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HintNote } from './HintLine.js';
import {
  HINTS_SETTING,
  hintAriaLabel,
  hintProvenance,
  hintsEnabled,
  shouldShowHint,
  type TacticalHint,
} from './hints.js';

const HINT: TacticalHint = {
  roleTag: 'sniper',
  text: 'hold the angle and take the biggest threat first',
  why: 'role tag "sniper"',
  advisoryOnly: true,
};

describe('off by default (FR10.10)', () => {
  it('is off for a campaign that has never heard of the feature', () => {
    expect(hintsEnabled(undefined)).toBe(false);
    expect(hintsEnabled(null)).toBe(false);
    expect(hintsEnabled({})).toBe(false);
    expect(hintsEnabled({ discordWebhookUrl: 'x' })).toBe(false);
  });

  /**
   * The server accepts ONLY a literal `true`. A client that read `'yes'` or
   * `1` as on would draw a lit toggle over a feature the table is not getting.
   */
  it('reads only a literal true as on, exactly like the server does', () => {
    expect(hintsEnabled({ [HINTS_SETTING]: true })).toBe(true);
    expect(hintsEnabled({ [HINTS_SETTING]: 'true' })).toBe(false);
    expect(hintsEnabled({ [HINTS_SETTING]: 1 })).toBe(false);
    expect(hintsEnabled({ [HINTS_SETTING]: false })).toBe(false);
  });
});

describe('who gets a line, and on which row', () => {
  it('offers one only to the GM', () => {
    expect(shouldShowHint({ isGm: true, acting: true, hint: HINT })).toBe(true);
    expect(shouldShowHint({ isGm: false, acting: true, hint: HINT })).toBe(false);
  });

  it('offers one only on the acting row', () => {
    expect(shouldShowHint({ isGm: true, acting: false, hint: HINT })).toBe(false);
  });

  /**
   * The disabled case arrives as an ABSENT hint: the server withholds the line
   * rather than sending it with a flag, so there is no payload for a client
   * bug to render by accident (Principle 4).
   */
  it('renders nothing when the server sent no hint — which is how "off" arrives', () => {
    expect(shouldShowHint({ isGm: true, acting: true, hint: undefined })).toBe(false);
  });
});

describe('the rendered line', () => {
  const html = renderToStaticMarkup(<HintNote hint={HINT} name="Rooftop shooter" />);

  it('is prose in a note, not a control', () => {
    expect(html).toContain('role="note"');
    // A hint that could be pressed would be the automation FR10.10 rules out.
    expect(html).not.toContain('<button');
    expect(html).not.toContain('onclick');
  });

  it('says it is a suggestion before it says the advice', () => {
    const label = hintAriaLabel(HINT, 'Rooftop shooter');
    expect(label.startsWith('Tactical suggestion for Rooftop shooter')).toBe(true);
    expect(label).toContain('takes no action');
    expect(html).toContain(`aria-label="${label.replace(/"/g, '&quot;')}"`);
  });

  it('is marked as a suggestion on screen too, and carries its provenance', () => {
    expect(html).toContain('hint ▸');
    expect(html).toContain('advisory');
    expect(html).toContain(HINT.text);
    // Principle 3: the GM can see why they got this line.
    expect(hintProvenance(HINT)).toContain('role tag "sniper"');
    expect(hintProvenance(HINT)).toContain('nothing here acts on its own');
  });
});
