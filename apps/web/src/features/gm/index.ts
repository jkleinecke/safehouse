/**
 * Public surface of the GM feature area for the rest of the app.
 * Other agents should import from here (not from deep paths) so the internals
 * stay free to move.
 *
 * Reuse notes:
 * - `RefChip` / `RefText` render `{ book, page }` refs anywhere (sheet items,
 *   log notes, codex prose) and open the book in place (FR11.2–11.4).
 * - `FixerDock` is the GM-only dockable copilot; mount it once in the campaign
 *   shell so it follows the GM across every screen (FR12.1).
 * - `BookReader` is the `/read/:bookCode` viewer page body (FR11.3).
 */
export { BookViewerOverlay, RefChip, RefText, refLink } from './books/RefChip.js';
export type { BookViewerOverlayProps, RefChipProps } from './books/RefChip.js';
export { default as BookReader } from './books/BookReader.js';
export {
  REF_PATTERN,
  bookFileHref,
  findFreetextRefs,
  parseFreetextRef,
  pdfToPrinted,
  printedToPdf,
  viewerHref,
} from './books/refs.js';
export type { FreetextRefMatch } from './books/refs.js';

export { default as FixerDock } from './fixer/FixerDock.js';
export type { FixerDockProps } from './fixer/FixerDock.js';
export { default as FixerChat } from './fixer/FixerChat.js';
export { default as DraftsInbox } from './fixer/DraftsInbox.js';
export { aiDisabledFrom, isAiDisabled, useFixerStatus } from './fixer/api.js';

export { default as ThreatReadout } from './generator/ThreatReadout.js';
export type { ThreatReadoutProps } from './generator/ThreatReadout.js';
export { actionEconomy, profileFromSheet, readoutRows } from './generator/readout.js';
export type { ReadoutRow, SideProfile } from './generator/readout.js';
