/**
 * Page references for the character-creation tables (FR3.9, docs/CHARGEN.md
 * §8.4) — the one place the two book codes are spelled.
 *
 * Every row in `chargen/` carries a `{ book, page }` so the builder's "why?"
 * link opens the reader where the number came from. Pages are PRINTED pages;
 * the reader applies each book's offset (core +5, Run Faster +2 once the
 * library is calibrated — an uncalibrated RF opens two pages early, which the
 * book map notes). Internal to the chargen folder: not re-exported.
 */
import type { Ref } from '@safehouse/contracts';

/** A page of the Shadowrun, Fifth Edition core rulebook. */
export const SR5 = (page: number): Ref => ({ book: 'SR5', page });

/** A page of Run Faster (metavariants, Sum to Ten, the reprinted priority table). */
export const RF = (page: number): Ref => ({ book: 'RF', page });
