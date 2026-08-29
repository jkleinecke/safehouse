/**
 * migrate-to-postgres — move a PGlite `DATA_DIR` into a real Postgres server,
 * primary keys intact, with the sequences moved to match.
 *
 *   pnpm --filter @safehouse/server exec tsx scripts/migrate-to-postgres.ts \
 *     --data-dir ./data --database-url postgres://safehouse:pw@localhost:5432/safehouse
 *
 * WHY THIS FILE EXISTS
 * The app ships two backends (BUILD_CONVENTIONS "Ports, env, database"): the
 * embedded PGlite under `DATA_DIR/pglite`, which is what a laptop plays on, and
 * node-postgres against `DATABASE_URL`, which is what the compose stack runs. A
 * campaign that starts on the first and grows into the second has to cross that
 * gap, and until now nothing crossed it — the move was left to whoever felt
 * brave with `pg_dump`, and the obvious hand-rolled version of it is the exact
 * shape that killed the shared log once already (BUILD_REPORT LIVE-4):
 *
 *   load the rows into a fresh schema with their ids intact
 *   -> the rows are at id 1..N and every sequence is still sitting at 1
 *   -> the next `INSERT` collides on a primary key the server never chose
 *   -> `POST /api/rolls` 500s AFTER committing, the log freezes, FR2.9 is dead
 *
 * Preserving ids is not optional: `ws_events.id` is the replay cursor clients
 * hold as `last_event_id` (§11), and every foreign key in §9.2 is a real id. So
 * the ids come across unchanged and the sequences are pushed past them — which
 * is precisely what `safehouse_resync_sequences()` (migration 0001) does, the
 * same function the server runs on every boot. One definition, one behaviour,
 * two callers.
 *
 * HOW THE ROWS TRAVEL
 * Each batch leaves the source as one `jsonb_agg(...)::text` string and enters
 * the target through `jsonb_populate_recordset(null::<table>, $1::jsonb)`. The
 * point is that JavaScript never parses it: no driver-specific coercion of
 * jsonb, arrays, timestamps or bigints, no float rounding, nothing to get
 * subtly wrong between two drivers that disagree about types. Postgres writes
 * the text, Postgres reads it back into its own row type.
 *
 * WHAT IT DOES NOT MOVE
 * The file store. Maps, token art, handouts and the seeded book PDFs live on
 * disk under `DATA_DIR/files` and are referenced by `attachments.path`; copy
 * that folder to the new host yourself or every map 404s. The report says so,
 * with a count, because it is the thing an operator forgets.
 *
 * FLAGS
 *   --data-dir <path>      source DATA_DIR (default: $DATA_DIR or ./data)
 *   --database-url <url>   target Postgres (default: $DATABASE_URL)
 *   --dry-run              count rows per table and print the plan; write nothing
 *   --verify-only          re-run the comparison against an already-moved target
 *   --allow-nonempty       copy into a target that already holds rows (unsafe)
 *   --batch-size <n>       rows per INSERT (default 250)
 *   --help
 *
 * Exit code is 0 only when the verification pass agrees the move is complete.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql, type SQL } from 'drizzle-orm';
import {
  closeDb,
  createNodePgDb,
  ensureMigrations,
  ensureSequences,
  getDb,
  resetDbSingleton,
  type Db,
  type SequenceRepair,
} from '@safehouse/db';

// ---------------------------------------------------------------------------
// Catalog reads (both drivers, identical SQL)
// ---------------------------------------------------------------------------

/** Rows out of `db.execute`, whose shape differs between the two drivers. */
async function rowsOf<T extends Record<string, unknown>>(db: Db, query: SQL): Promise<T[]> {
  const result = await db.execute<T>(query);
  return Array.isArray(result) ? (result as T[]) : ((result as { rows?: T[] }).rows ?? []);
}

/** Quote an identifier that came out of the catalog. */
function q(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function num(value: unknown): number {
  return value == null ? 0 : Number(value);
}

/** Base tables in `public`, minus drizzle's own bookkeeping. */
export async function listTables(db: Db): Promise<string[]> {
  const rows = await rowsOf<{ name: string }>(
    db,
    sql`select table_name::text as name
        from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE'
        order by table_name`,
  );
  return rows.map((r) => r.name).filter((n) => !n.startsWith('__drizzle'));
}

/**
 * Columns worth copying: everything except GENERATED ALWAYS ones. `book_pages.tsv`
 * is the live example — a stored tsvector the target computes for itself, and
 * which Postgres refuses to be handed.
 */
export async function copyableColumns(db: Db, table: string): Promise<string[]> {
  const rows = await rowsOf<{ name: string; gen: string | null; ident: string | null }>(
    db,
    sql`select column_name::text as name,
               is_generated::text as gen,
               identity_generation::text as ident
        from information_schema.columns
        where table_schema = 'public' and table_name = ${table}
        order by ordinal_position`,
  );
  return rows.filter((r) => r.gen !== 'ALWAYS' && r.ident !== 'ALWAYS').map((r) => r.name);
}

/** Primary-key columns, used only to give each batch a stable order. */
async function keyColumns(db: Db, table: string): Promise<string[]> {
  const rows = await rowsOf<{ col: string }>(
    db,
    sql`select a.attname::text as col
        from pg_index i
        join pg_class c on c.oid = i.indrelid
        join pg_namespace n on n.oid = c.relnamespace
        join pg_attribute a on a.attrelid = c.oid and a.attnum = any(i.indkey)
        where i.indisprimary and n.nspname = 'public' and c.relname = ${table}
        order by a.attnum`,
  );
  return rows.map((r) => r.col);
}

/** child -> parents, from real foreign keys (self-references dropped). */
async function foreignKeys(db: Db): Promise<Map<string, Set<string>>> {
  const rows = await rowsOf<{ child: string; parent: string }>(
    db,
    sql`select ch.relname::text as child, pa.relname::text as parent
        from pg_constraint c
        join pg_class ch on ch.oid = c.conrelid
        join pg_class pa on pa.oid = c.confrelid
        join pg_namespace cn on cn.oid = ch.relnamespace
        join pg_namespace pn on pn.oid = pa.relnamespace
        where c.contype = 'f' and cn.nspname = 'public' and pn.nspname = 'public'`,
  );
  const deps = new Map<string, Set<string>>();
  for (const row of rows) {
    if (row.child === row.parent) continue;
    const set = deps.get(row.child) ?? new Set<string>();
    set.add(row.parent);
    deps.set(row.child, set);
  }
  return deps;
}

/** One serial/identity column and the sequence that feeds it. */
export interface SerialColumn {
  table: string;
  column: string;
  sequence: string;
}

export async function serialColumns(db: Db): Promise<SerialColumn[]> {
  const rows = await rowsOf<{ tbl: string; col: string; seq: string }>(
    db,
    sql`select c.relname::text as tbl,
               a.attname::text as col,
               pg_get_serial_sequence(c.oid::regclass::text, a.attname) as seq
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
        where c.relkind = 'r' and n.nspname = 'public'
          and pg_get_serial_sequence(c.oid::regclass::text, a.attname) is not null
        order by 1, 2`,
  );
  return rows.map((r) => ({ table: r.tbl, column: r.col, sequence: r.seq }));
}

async function countRows(db: Db, table: string): Promise<number> {
  const rows = await rowsOf<{ n: string | number }>(
    db,
    sql`select count(*)::bigint as n from ${sql.raw(q(table))}`,
  );
  return num(rows[0]?.n);
}

async function maxOf(db: Db, table: string, column: string): Promise<number | null> {
  const rows = await rowsOf<{ m: string | number | null }>(
    db,
    sql`select max(${sql.raw(q(column))})::bigint as m from ${sql.raw(q(table))}`,
  );
  const value = rows[0]?.m;
  return value == null ? null : Number(value);
}

/** The id the sequence would hand out next (`is_called` is the off-by-one). */
async function nextSequenceValue(db: Db, sequence: string): Promise<number> {
  const rows = await rowsOf<{ last_value: string | number; is_called: boolean }>(
    db,
    sql`select last_value, is_called from ${sql.raw(sequence)}`,
  );
  const row = rows[0];
  if (!row) throw new Error(`sequence ${sequence} is missing`);
  return Number(row.last_value) + (row.is_called ? 1 : 0);
}

/**
 * Parents before children, so foreign keys hold at every step. Ties break
 * alphabetically for a stable, reviewable order; a cycle (none today) leaves
 * its members at the end and is reported rather than silently reordered.
 */
export function copyOrder(tables: string[], deps: Map<string, Set<string>>): {
  order: string[];
  cyclic: string[];
} {
  const remaining = new Set(tables);
  const order: string[] = [];
  while (remaining.size > 0) {
    const ready = [...remaining]
      .filter((t) => [...(deps.get(t) ?? [])].every((p) => !remaining.has(p)))
      .sort();
    if (ready.length === 0) break;
    for (const t of ready) {
      order.push(t);
      remaining.delete(t);
    }
  }
  const cyclic = [...remaining].sort();
  return { order: [...order, ...cyclic], cyclic };
}

// ---------------------------------------------------------------------------
// The move
// ---------------------------------------------------------------------------

export interface TableTransfer {
  table: string;
  columns: string[];
  sourceRows: number;
  copiedRows: number;
}

export interface TableCheck {
  table: string;
  sourceRows: number;
  targetRows: number;
  ok: boolean;
}

export interface SequenceCheck {
  table: string;
  column: string;
  sequence: string;
  sourceMax: number | null;
  targetMax: number | null;
  /** The id the target's sequence would issue next — must exceed `targetMax`. */
  nextValue: number;
  ok: boolean;
}

export interface VerifyReport {
  tables: TableCheck[];
  sequences: SequenceCheck[];
  problems: string[];
  ok: boolean;
}

export interface MigrationReport extends VerifyReport {
  order: string[];
  transferred: TableTransfer[];
  /** Sequences the resync pass had to move forward (the hazard, defused). */
  repairs: SequenceRepair[];
  notes: string[];
}

export interface MigrateOptions {
  source: Db;
  target: Db;
  /** Rows per INSERT (default 250). */
  batchSize?: number;
  /** Copy into a target that already holds rows. Off: collisions are certain. */
  allowNonEmpty?: boolean;
  /**
   * Default true. Setting it false produces exactly the state a hand-rolled
   * row-preserving move leaves behind — rows at their original ids, sequences
   * still at 1 — and exists so a test can prove this pass is load-bearing.
   */
  resyncSequences?: boolean;
  log?: (line: string) => void;
}

/** Move every sequence past its table's max. Migration 0001's function. */
export async function resyncSequences(db: Db): Promise<SequenceRepair[]> {
  return ensureSequences(db);
}

/**
 * Copy one table's rows. Returns how many crossed.
 *
 * The batch never becomes a JavaScript value: `jsonb_agg(...)::text` out of the
 * source, `$1::jsonb` into `jsonb_populate_recordset` on the target.
 */
async function copyTable(
  source: Db,
  target: Db,
  table: string,
  columns: string[],
  batchSize: number,
): Promise<number> {
  const total = await countRows(source, table);
  if (total === 0 || columns.length === 0) return 0;
  const keys = await keyColumns(source, table);
  const orderBy = (keys.length > 0 ? keys : columns).map(q).join(', ');
  const list = columns.map(q).join(', ');
  const qt = q(table);

  let copied = 0;
  for (let offset = 0; offset < total; offset += batchSize) {
    const rows = await rowsOf<{ data: string; n: number }>(
      source,
      sql`select coalesce(jsonb_agg(t), '[]'::jsonb)::text as data, count(*)::int as n
          from (select ${sql.raw(list)} from ${sql.raw(qt)}
                order by ${sql.raw(orderBy)}
                limit ${batchSize} offset ${offset}) t`,
    );
    const batch = rows[0];
    if (!batch || batch.n === 0) break;
    await target.execute(
      sql`insert into ${sql.raw(qt)} (${sql.raw(list)})
          select ${sql.raw(list)}
          from jsonb_populate_recordset(null::${sql.raw(qt)}, ${batch.data}::jsonb)`,
    );
    copied += Number(batch.n);
  }
  return copied;
}

/**
 * Compare the two databases: same rows per table, same maximum id per serial,
 * and a target sequence that is past its rows. This is the pass that turns
 * "the script did not throw" into "the move is complete".
 */
export async function verifyMove(source: Db, target: Db): Promise<VerifyReport> {
  const problems: string[] = [];
  const sourceTables = await listTables(source);
  const targetTables = new Set(await listTables(target));

  const tables: TableCheck[] = [];
  for (const table of sourceTables) {
    if (!targetTables.has(table)) {
      problems.push(`target has no table \`${table}\` — its rows were left behind`);
      continue;
    }
    const sourceRows = await countRows(source, table);
    const targetRows = await countRows(target, table);
    const ok = sourceRows === targetRows;
    if (!ok) problems.push(`\`${table}\`: ${sourceRows} row(s) in source, ${targetRows} in target`);
    tables.push({ table, sourceRows, targetRows, ok });
  }

  const sequences: SequenceCheck[] = [];
  for (const serial of await serialColumns(target)) {
    if (!targetTables.has(serial.table)) continue;
    const targetMax = await maxOf(target, serial.table, serial.column);
    const sourceMax = sourceTables.includes(serial.table)
      ? await maxOf(source, serial.table, serial.column)
      : null;
    const nextValue = await nextSequenceValue(target, serial.sequence);
    const idsPreserved = sourceMax === targetMax;
    // The whole point of the exercise: the next id must not already exist.
    const clear = targetMax === null || nextValue > targetMax;
    if (!idsPreserved) {
      problems.push(
        `\`${serial.table}.${serial.column}\`: max ${String(sourceMax)} in source, ` +
          `${String(targetMax)} in target — ids were not preserved`,
      );
    }
    if (!clear) {
      problems.push(
        `\`${serial.sequence}\` would issue ${nextValue}, which already exists in ` +
          `\`${serial.table}\` (max ${String(targetMax)}) — every insert will collide`,
      );
    }
    sequences.push({
      table: serial.table,
      column: serial.column,
      sequence: serial.sequence,
      sourceMax,
      targetMax,
      nextValue,
      ok: idsPreserved && clear,
    });
  }

  return { tables, sequences, problems, ok: problems.length === 0 };
}

/**
 * The move itself: migrate the target's schema, copy every table in dependency
 * order, push the sequences past the rows, then verify.
 *
 * Deliberately not one transaction. Both drivers would have to agree about
 * connection affinity for that to mean anything (node-postgres hands out a pool
 * connection per statement), and a half-finished move is already detectable —
 * the verification pass reports it, and the fix is to drop and recreate the
 * target schema and run again, which the failure message says.
 */
export async function migrateDatabase(opts: MigrateOptions): Promise<MigrationReport> {
  const { source, target } = opts;
  const batchSize = opts.batchSize ?? 250;
  const log = opts.log ?? ((): void => undefined);
  const notes: string[] = [];
  const problems: string[] = [];

  log('[migrate] applying migrations to the target');
  await ensureMigrations(target);

  const sourceTables = await listTables(source);
  const targetTables = new Set(await listTables(target));
  const { order, cyclic } = copyOrder(sourceTables, await foreignKeys(source));
  if (cyclic.length > 0) {
    notes.push(`circular foreign keys among ${cyclic.join(', ')} — copied last, may fail`);
  }

  // A target that already holds rows guarantees primary-key collisions, and a
  // half-merged campaign is worse than a refusal.
  if (opts.allowNonEmpty !== true) {
    const occupied: string[] = [];
    for (const table of order) {
      if (!targetTables.has(table)) continue;
      if ((await countRows(target, table)) > 0) occupied.push(table);
    }
    if (occupied.length > 0) {
      throw new Error(
        `target is not empty (rows in ${occupied.join(', ')}). ` +
          'Drop and recreate its schema, or pass --allow-nonempty if you know why.',
      );
    }
  }

  const transferred: TableTransfer[] = [];
  for (const table of order) {
    if (!targetTables.has(table)) {
      problems.push(`target has no table \`${table}\` — skipped`);
      continue;
    }
    const sourceCols = await copyableColumns(source, table);
    const targetCols = await copyableColumns(target, table);
    const columns = targetCols.filter((c) => sourceCols.includes(c));
    const lost = sourceCols.filter((c) => !targetCols.includes(c));
    const fresh = targetCols.filter((c) => !sourceCols.includes(c));
    if (lost.length > 0) {
      problems.push(`\`${table}\`: target has no column(s) ${lost.join(', ')} — data would be lost`);
      continue;
    }
    if (fresh.length > 0) {
      notes.push(`\`${table}\`: new column(s) ${fresh.join(', ')} take their defaults`);
    }
    const sourceRows = await countRows(source, table);
    const copiedRows = await copyTable(source, target, table, columns, batchSize);
    log(`[migrate] ${table.padEnd(22)} ${String(copiedRows).padStart(7)} row(s)`);
    transferred.push({ table, columns, sourceRows, copiedRows });
  }

  // The step the hand-rolled version forgets, and the reason this file exists.
  let repairs: SequenceRepair[] = [];
  if (opts.resyncSequences !== false) {
    repairs = await resyncSequences(target);
    for (const r of repairs) {
      log(`[migrate] sequence ${r.sequence} ${r.previousValue} -> ${r.newValue}`);
    }
  } else {
    notes.push('sequence resync SKIPPED — the target will reject its first insert');
  }

  const verified = await verifyMove(source, target);
  return {
    order,
    transferred,
    repairs,
    notes,
    tables: verified.tables,
    sequences: verified.sequences,
    problems: [...problems, ...verified.problems],
    ok: problems.length === 0 && verified.ok,
  };
}

// ---------------------------------------------------------------------------
// Dry run
// ---------------------------------------------------------------------------

export interface PlanRow {
  table: string;
  sourceRows: number;
  /** Rows already in the target, or null when it has no such table yet. */
  targetRows: number | null;
}

export interface MovePlan {
  order: string[];
  rows: PlanRow[];
  totalRows: number;
  targetReady: boolean;
}

/** Count what would move. Writes nothing to either database. */
export async function planMove(source: Db, target?: Db): Promise<MovePlan> {
  const tables = await listTables(source);
  const { order } = copyOrder(tables, await foreignKeys(source));
  const targetTables = target ? new Set(await listTables(target)) : new Set<string>();
  const rows: PlanRow[] = [];
  let totalRows = 0;
  for (const table of order) {
    const sourceRows = await countRows(source, table);
    totalRows += sourceRows;
    const targetRows = target && targetTables.has(table) ? await countRows(target, table) : null;
    rows.push({ table, sourceRows, targetRows });
  }
  return { order, rows, totalRows, targetReady: targetTables.size > 0 };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

export function formatPlan(plan: MovePlan): string {
  const lines = ['', 'table                    source   target', '-'.repeat(41)];
  for (const row of plan.rows) {
    lines.push(
      `${row.table.padEnd(22)} ${String(row.sourceRows).padStart(8)} ` +
        `${(row.targetRows === null ? '-' : String(row.targetRows)).padStart(8)}`,
    );
  }
  lines.push('-'.repeat(41), `${'total'.padEnd(22)} ${String(plan.totalRows).padStart(8)}`);
  if (!plan.targetReady) lines.push('', 'target has no schema yet — it will be migrated on the real run');
  return lines.join('\n');
}

export function formatReport(report: MigrationReport): string {
  const lines: string[] = [''];
  for (const t of report.tables) {
    const mark = t.ok ? ' ' : '!';
    lines.push(`${mark} ${t.table.padEnd(22)} ${String(t.targetRows).padStart(8)} row(s)`);
  }
  lines.push('');
  for (const s of report.sequences) {
    lines.push(
      `${s.ok ? ' ' : '!'} ${s.sequence} -> next ${s.nextValue} (max ${String(s.targetMax ?? 0)})`,
    );
  }
  for (const note of report.notes) lines.push(`  note: ${note}`);
  for (const problem of report.problems) lines.push(`  PROBLEM: ${problem}`);
  lines.push('', report.ok ? '[migrate] verified: the move is complete.' : '[migrate] FAILED verification.');
  return lines.join('\n');
}

/** Attachments live on disk, not in the database — the operator's other half. */
function fileStoreNote(dataDir: string): string {
  const dir = join(dataDir, 'files');
  if (!existsSync(dir)) return `no file store at ${dir} — nothing to copy`;
  let count = 0;
  try {
    count = readdirSync(dir).length;
  } catch {
    /* unreadable is the operator's problem to see, not this script's to throw on */
  }
  return `copy the file store too: ${count} entr(ies) under ${dir} (maps, art, book PDFs)`;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export interface Cli {
  dataDir?: string;
  databaseUrl?: string;
  dryRun: boolean;
  verifyOnly: boolean;
  allowNonEmpty: boolean;
  batchSize?: number;
  help: boolean;
}

export function parseArgs(argv: string[]): Cli {
  const cli: Cli = { dryRun: false, verifyOnly: false, allowNonEmpty: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${arg} needs a value`);
      return v;
    };
    switch (arg) {
      case '--data-dir':
        cli.dataDir = next();
        break;
      case '--database-url':
        cli.databaseUrl = next();
        break;
      case '--batch-size':
        cli.batchSize = Number(next());
        break;
      case '--dry-run':
        cli.dryRun = true;
        break;
      case '--verify-only':
        cli.verifyOnly = true;
        break;
      case '--allow-nonempty':
        cli.allowNonEmpty = true;
        break;
      case '--help':
      case '-h':
        cli.help = true;
        break;
      default:
        throw new Error(`unknown flag: ${arg}`);
    }
  }
  if (cli.batchSize !== undefined && (!Number.isInteger(cli.batchSize) || cli.batchSize < 1)) {
    throw new Error('--batch-size must be a positive integer');
  }
  return cli;
}

const USAGE = `migrate-to-postgres — move a PGlite DATA_DIR into Postgres, ids intact

  tsx scripts/migrate-to-postgres.ts --data-dir ./data --database-url <url>
  tsx scripts/migrate-to-postgres.ts --dry-run
  tsx scripts/migrate-to-postgres.ts --verify-only --database-url <url>

  --data-dir <path>      source DATA_DIR (default $DATA_DIR or ./data)
  --database-url <url>   target Postgres (default $DATABASE_URL)
  --dry-run              print row counts per table; write nothing
  --verify-only          compare an already-moved target against the source
  --allow-nonempty       copy into a target that already holds rows (unsafe)
  --batch-size <n>       rows per INSERT (default 250)

Stop the app first: PGlite is single-writer, and a source that is still being
written to moves an inconsistent campaign. The file store (DATA_DIR/files) is
NOT copied by this script — move that folder yourself.`;

export async function main(): Promise<number> {
  const cli = parseArgs(process.argv.slice(2));
  if (cli.help) {
    console.log(USAGE);
    return 0;
  }

  const dataDir = cli.dataDir ?? process.env['DATA_DIR'] ?? './data';
  const pgliteDir = join(dataDir, 'pglite');
  if (!existsSync(pgliteDir)) {
    console.error(`[migrate] no PGlite database at ${pgliteDir} — is --data-dir right?`);
    return 1;
  }
  const url = cli.databaseUrl ?? process.env['DATABASE_URL'];
  if (!url && !cli.dryRun) {
    console.error('[migrate] need --database-url (or DATABASE_URL) to name the target');
    return 1;
  }

  // Open the source as PGlite explicitly: `getDb()` picks node-postgres the
  // moment DATABASE_URL is set, which here names the TARGET.
  process.env['DATA_DIR'] = dataDir;
  delete process.env['DATABASE_URL'];
  resetDbSingleton();
  const source = getDb();
  resetDbSingleton();
  const target = url ? createNodePgDb(url) : undefined;

  try {
    if (cli.dryRun) {
      const plan = await planMove(source, target);
      console.log(`[migrate] dry run: ${dataDir} -> ${url ?? '(no target given)'}`);
      console.log(formatPlan(plan));
      console.log(`\n[migrate] ${fileStoreNote(dataDir)}`);
      console.log('[migrate] nothing was written.');
      return 0;
    }
    if (!target) return 1;

    if (cli.verifyOnly) {
      const verified = await verifyMove(source, target);
      for (const problem of verified.problems) console.error(`  PROBLEM: ${problem}`);
      console.log(verified.ok ? '[migrate] verified.' : '[migrate] verification FAILED.');
      return verified.ok ? 0 : 1;
    }

    console.log(`[migrate] ${dataDir} -> ${url}`);
    const started = Date.now();
    const report = await migrateDatabase({
      source,
      target,
      allowNonEmpty: cli.allowNonEmpty,
      ...(cli.batchSize !== undefined ? { batchSize: cli.batchSize } : {}),
      log: (line) => console.log(line),
    });
    console.log(formatReport(report));
    console.log(`[migrate] ${fileStoreNote(dataDir)}`);
    console.log(`[migrate] ${Math.round((Date.now() - started) / 1000)}s`);
    if (report.ok) {
      console.log('[migrate] set DATABASE_URL to the target and restart the app.');
    } else {
      console.error('[migrate] drop and recreate the target schema before retrying.');
    }
    return report.ok ? 0 : 1;
  } finally {
    await closeDb(source).catch(() => undefined);
    if (target) await closeDb(target).catch(() => undefined);
    resetDbSingleton();
  }
}

// CLI only; tests import the functions above without side effects.
const entry = process.argv[1];
if (entry !== undefined && resolve(entry) === fileURLToPath(import.meta.url)) {
  main()
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      console.error('[migrate] failed:', err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
