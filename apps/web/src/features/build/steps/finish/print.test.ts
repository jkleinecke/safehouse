/**
 * The Finish screen's print stylesheet (docs/CHARGEN.md §4.4 Step 9, "a print
 * view … so the browser's print gives a clean one-pager").
 *
 * No browser prints in a node test, so this pins the rules that make the
 * printout: they apply only under `@media print`; everything that neither is,
 * holds nor contains the sheet is hidden; the sheet's ancestors lose their
 * heights, scroll clipping and chrome; the sheet prints dark ink on white;
 * and the print button leaves itself out.
 */
import { describe, expect, it } from 'vitest';
import { FINISH_PRINT_CSS, PRINT_HIDE_ATTR, PRINT_SHEET_ATTR } from './print.js';

describe('FINISH_PRINT_CSS', () => {
  it('only applies when printing', () => {
    expect(FINISH_PRINT_CSS.startsWith('@media print {')).toBe(true);
    expect(FINISH_PRINT_CSS.trim().endsWith('}')).toBe(true);
  });

  it('hides everything but the sheet and the elements around it', () => {
    expect(FINISH_PRINT_CSS).toContain(
      `body *:not(:has([${PRINT_SHEET_ATTR}])):not([${PRINT_SHEET_ATTR}]):not([${PRINT_SHEET_ATTR}] *) { display: none !important; }`,
    );
  });

  it("flattens the sheet's ancestors so nothing clips it to one screen", () => {
    const ancestors = /body \*:has\(\[data-print-sheet\]\) \{([^}]*)\}/.exec(FINISH_PRINT_CSS)?.[1] ?? '';
    for (const rule of ['height: auto', 'overflow: visible', 'position: static', 'padding: 0', 'background: none']) {
      expect(ancestors).toContain(rule);
    }
  });

  it('prints ink on paper and drops what is marked to hide', () => {
    expect(FINISH_PRINT_CSS).toContain('color: #000 !important');
    expect(FINISH_PRINT_CSS).toContain('background: #fff !important');
    expect(FINISH_PRINT_CSS).toContain(`[${PRINT_HIDE_ATTR}] { display: none !important; }`);
    // Nothing a React text node would have to escape.
    expect(FINISH_PRINT_CSS).not.toMatch(/[<&]/);
  });
});
