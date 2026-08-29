/**
 * Sequence reconciliation, run on every database open.
 *
 * The SQL lives in migration `0001_sequence_guard` as
 * `safehouse_resync_sequences()` — one definition, guaranteed present in every
 * database that has reached that migration, whether it got there by upgrade or
 * by being created fresh. This module is the caller.
 *
 * The repair is strictly one-directional: a sequence is only ever pushed UP to
 * clear rows that already exist, never pulled back. See the migration for why
 * moving one backwards would be the worse bug.
 */
import { sql } from 'drizzle-orm';
import type { Db } from './client.js';
import { wrapDbError } from './errors.js';

/** One sequence that was behind its table and has been moved forward. */
export interface SequenceRepair {
  /** Fully-qualified sequence, e.g. `public.ws_events_id_seq`. */
  sequence: string;
  table: string;
  column: string;
  /** `last_value` before the repair. */
  previousValue: number;
  /** `last_value` after the repair — always greater than `previousValue`. */
  newValue: number;
}

/** Row shape of `safehouse_resync_sequences()`; indexed to satisfy `execute`. */
interface RepairRow extends Record<string, unknown> {
  seq_name: string;
  tbl_name: string;
  col_name: string;
  previous_value: string | number | bigint;
  new_value: string | number | bigint;
}

/** PostgreSQL returns bigint as a string over the wire; both drivers may not. */
function toNumber(value: string | number | bigint): number {
  return typeof value === 'number' ? value : Number(value);
}

/**
 * Move any sequence that is behind its table forward to match it.
 *
 * Returns the sequences that were actually repaired — empty on a healthy
 * database, which is the normal case. Callers may log a non-empty result: it
 * means this database was restored or migrated in a way that dropped sequence
 * state, and every insert on the affected table would otherwise have failed
 * with a duplicate primary key until someone intervened.
 */
export async function ensureSequences(db: Db): Promise<SequenceRepair[]> {
  try {
    const result = await db.execute<RepairRow>(sql`select * from safehouse_resync_sequences()`);
    const rows: RepairRow[] = Array.isArray(result)
      ? (result as RepairRow[])
      : ((result as { rows?: RepairRow[] }).rows ?? []);
    return rows.map((row) => ({
      sequence: row.seq_name,
      table: row.tbl_name,
      column: row.col_name,
      previousValue: toNumber(row.previous_value),
      newValue: toNumber(row.new_value),
    }));
  } catch (err) {
    throw wrapDbError('ensureSequences', err);
  }
}
