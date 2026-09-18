/**
 * The Finish screen's print stylesheet (FR3.9, docs/CHARGEN.md §4.4 Step 9):
 * the browser's own Print gives a clean one-page runner, with no PDF library
 * and no second page layout to keep in step with the screen.
 *
 * The app is a dark, sticky, scrolling shell — a campaign sidebar, a sticky
 * header, the builder's progress strip, a rail, a phone bar pinned to the
 * bottom, and a `<main>` that is the scroll container. Printed as it is, that
 * gives one screen's height of dark panels and a clipped sheet. So while the
 * Finish screen is mounted it renders this stylesheet, and under `@media
 * print` it:
 *
 * - hides every element that neither is the sheet (`[data-print-sheet]`),
 *   sits inside it, nor contains it — `:has()` finds the ancestors, so the
 *   rule needs no knowledge of the shell's markup and survives its changes;
 * - flattens those ancestors (no fixed heights, no scroll clipping, no
 *   sticky or grid placement, no padding or panel chrome), so the sheet
 *   starts at the top of the paper and runs as long as it is;
 * - prints ink on paper: black text, no dark grounds, hairline borders, no
 *   glows; buttons (the pool breakdowns) print as their numbers;
 * - drops anything marked `[data-print-hide]` (the print button itself).
 *
 * The compact layout is split between the two: sections flowing down two
 * columns is Tailwind's `print:` variant on the sheet's own classes; the
 * smaller type and tighter rows are here, since they undo the screen's sizes
 * wherever they are set. A plain string, so a node test can pin the rules
 * without a browser.
 */

/** The attribute the sheet carries so the print rules can find it. */
export const PRINT_SHEET_ATTR = 'data-print-sheet';

/** The attribute on anything the printout leaves out. */
export const PRINT_HIDE_ATTR = 'data-print-hide';

const SHEET = `[${PRINT_SHEET_ATTR}]`;
const HIDE = `[${PRINT_HIDE_ATTR}]`;

export const FINISH_PRINT_CSS = `@media print {
  @page { margin: 12mm; }
  html, body { background: #fff !important; color: #000 !important; color-scheme: light; }
  body *:not(:has(${SHEET})):not(${SHEET}):not(${SHEET} *) { display: none !important; }
  body *:has(${SHEET}) {
    display: block !important;
    position: static !important;
    height: auto !important;
    min-height: 0 !important;
    max-height: none !important;
    overflow: visible !important;
    margin: 0 !important;
    padding: 0 !important;
    border: 0 !important;
    background: none !important;
    box-shadow: none !important;
    backdrop-filter: none !important;
  }
  ${SHEET} { font-size: 8pt; line-height: 1.25; }
  ${SHEET} :is(.text-xs, .text-sm, .text-base) { font-size: 8pt !important; line-height: 1.25 !important; }
  ${SHEET} .text-lg { font-size: 13pt !important; }
  ${SHEET} :is(li, td, th) { padding-top: 1px !important; padding-bottom: 1px !important; }
  ${SHEET}, ${SHEET} * {
    color: #000 !important;
    background: transparent !important;
    border-color: #bbb !important;
    box-shadow: none !important;
    text-shadow: none !important;
  }
  ${SHEET} button { border: 0 !important; padding: 0 !important; min-height: 0 !important; min-width: 0 !important; font: inherit; }
  ${SHEET} section, ${SHEET} li, ${SHEET} tr { break-inside: avoid; }
  ${SHEET} ${HIDE}, ${HIDE} { display: none !important; }
}`;
