/**
 * Ledger helpers (FR3.6) — entries are append-only; balances are sums.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from './client.js';
import { ledgerEntries } from './schema.js';

export interface LedgerBalance {
  karma: number;
  nuyen: number;
}

/**
 * Sum of approved deltas per currency for a character. Pass
 * `{ includePending: true }` to preview balances with pending spends counted.
 */
export async function ledgerBalance(
  db: Db,
  characterId: string,
  opts: { includePending?: boolean } = {},
): Promise<LedgerBalance> {
  const stateCond = opts.includePending
    ? sql`${ledgerEntries.state} in ('approved', 'pending')`
    : eq(ledgerEntries.state, 'approved');
  const rows = await db
    .select({
      currency: ledgerEntries.currency,
      total: sql<number>`coalesce(sum(${ledgerEntries.delta}), 0)::bigint`,
    })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.characterId, characterId), stateCond))
    .groupBy(ledgerEntries.currency);
  const balance: LedgerBalance = { karma: 0, nuyen: 0 };
  for (const row of rows) balance[row.currency] = Number(row.total);
  return balance;
}
