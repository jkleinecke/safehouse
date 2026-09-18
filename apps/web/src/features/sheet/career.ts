/**
 * What the sheet says about a runner's career, as two pure answers the page
 * needs before it renders anything (FR3.7, FR3.9 §4.1).
 *
 * - **Who may improve them.** Karma advancement is the owner's or the GM's
 *   (`POST /api/characters/:id/advance` refuses anyone else with 403), so the
 *   Improve action is offered to exactly those two and to nobody else — an
 *   observer and the table display read the sheet and never spend from it.
 *   The rule is written here rather than in the page so it is checked in a
 *   test instead of by clicking, and so it cannot drift from the route's.
 * - **How the builder made them.** A character the native builder approved
 *   keeps its build summary on the record (`characters.build`), and the
 *   header says it in one line: "built with Priority B/A/E/C/D", the five
 *   levels in the book's column order (SR5 p.65). The short line is for the
 *   eye; the long one names each column for a screen reader, because B/A/E/C/D
 *   read aloud is five letters and no meaning. An imported or hand-typed
 *   sheet has no summary and the line is simply absent — it is a courtesy,
 *   never a warning.
 *
 * No JSX and no React: tested in `career.test.tsx` beside the header it feeds.
 */
import { PRIORITY_COLUMNS, type CharacterBuildSummary, type Role } from '@safehouse/contracts';
import type { CharacterRecord } from './api.js';

/** Enough of a session to answer who is asking. */
export interface CareerViewer {
  role: Role;
  userId?: string | undefined;
}

/**
 * Whether this device may spend the character's Karma: the GM always, the
 * character's own player, nobody else. The same test the advance route makes
 * server-side, so the button is never offered where the route would refuse.
 */
export function canImprove(
  viewer: CareerViewer | null | undefined,
  character: Pick<CharacterRecord, 'ownerUserId'>,
): boolean {
  if (!viewer) return false;
  if (viewer.role === 'gm') return true;
  if (viewer.role !== 'player') return false;
  return viewer.userId !== undefined && viewer.userId === character.ownerUserId;
}

/** The creation method in our words, as the header names it. */
export const BUILD_METHOD_WORDS: Readonly<Record<CharacterBuildSummary['method'], string>> = {
  priority: 'Priority',
  sumToTen: 'Sum to Ten',
};

/** The two creation levels that are worth saying; the default is left unsaid. */
const LEVEL_WORDS: Readonly<Partial<Record<CharacterBuildSummary['level'], string>>> = {
  street: 'a street-level runner',
  prime: 'a prime runner',
};

/** What each priority column is called, in the book's order (SR5 p.65). */
const COLUMN_WORDS: Readonly<Record<(typeof PRIORITY_COLUMNS)[number], string>> = {
  metatype: 'Metatype',
  attributes: 'Attributes',
  magic: 'Magic',
  skills: 'Skills',
  resources: 'Resources',
};

/** The header's build line: the short words, and the long ones a reader hears. */
export interface BuildLine {
  /** "built with Priority B/A/E/C/D". */
  text: string;
  /** "Built with the Priority table: Metatype B, Attributes A, …". */
  detail: string;
}

/**
 * The line for a character the builder made, or null for one that was
 * imported or typed in. A column the build never chose prints as a dash
 * rather than dropping out, so the five slots stay countable.
 */
export function buildLineOf(summary: CharacterBuildSummary | null | undefined): BuildLine | null {
  if (!summary) return null;
  const method = BUILD_METHOD_WORDS[summary.method];
  const levels = PRIORITY_COLUMNS.map((column) => summary.priorities[column] ?? '—');
  const who = LEVEL_WORDS[summary.level];
  return {
    text: `built ${who ? `as ${who} ` : ''}with ${method} ${levels.join('/')}`,
    detail: `Built ${who ? `as ${who} ` : ''}with the ${method} table: ${PRIORITY_COLUMNS.map(
      (column, i) => `${COLUMN_WORDS[column]} ${levels[i]}`,
    ).join(', ')}.`,
  };
}
