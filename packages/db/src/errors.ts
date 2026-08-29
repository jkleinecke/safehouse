/**
 * Database errors that keep their diagnosis attached.
 *
 * drizzle wraps every driver failure in a `DrizzleQueryError` whose `message`
 * is the literal SQL — `Failed query: insert into "ws_events" (…) values …` —
 * and puts the part that actually says what went wrong on `.cause`: the
 * PostgreSQL message, its SQLSTATE, the constraint that was violated. Fastify's
 * error envelope forwards `message` and drops `cause`, so a plain unique
 * violation reaches an operator as an opaque SQL dump that is byte-identical to
 * what a foreign-key violation, a not-null violation and a disk error produce.
 * An entire investigation into "why do event appends 500?" can be, and has
 * been, spent on a string that carries no information about the cause.
 *
 * `wrapDbError` lifts those fields onto the error that is thrown, so the code,
 * the constraint and the real message survive into the caller, the log and —
 * as far as the API layer chooses to expose it — the response.
 */

/** The diagnostic fields PostgreSQL attaches to a failed statement. */
export interface PgDiagnostics {
  /** SQLSTATE: `23505` unique violation, `23503` foreign key, `23502` not-null. */
  code?: string;
  /** Name of the violated constraint, when the failure names one. */
  constraint?: string;
  /** PostgreSQL's DETAIL line, e.g. `Key (id)=(2) already exists.` */
  detail?: string;
  table?: string;
  column?: string;
  schema?: string;
  /** PostgreSQL internal routine that raised it (`_bt_check_unique`, …). */
  routine?: string;
  /** The SQL drizzle was running, when it reported one. */
  query?: string;
}

/** Fields we copy off a driver error, in the order we prefer them. */
const DIAGNOSTIC_KEYS = [
  'code',
  'constraint',
  'detail',
  'table',
  'column',
  'schema',
  'routine',
  'query',
] as const;

/**
 * A database operation that failed, carrying PostgreSQL's own diagnosis.
 *
 * `cause` is preserved so a full stack is still available; the named fields
 * exist because `cause` is exactly what the layers above tend to discard.
 */
export class DbError extends Error implements PgDiagnostics {
  override readonly name = 'DbError';
  /** The logical operation that failed, e.g. `appendEvent`. */
  readonly operation: string;
  readonly code?: string;
  readonly constraint?: string;
  readonly detail?: string;
  readonly table?: string;
  readonly column?: string;
  readonly schema?: string;
  readonly routine?: string;
  readonly query?: string;
  /** Caller-supplied context (campaign id, event type, …) for the log. */
  readonly context: Readonly<Record<string, unknown>>;

  constructor(
    message: string,
    operation: string,
    diagnostics: PgDiagnostics = {},
    context: Record<string, unknown> = {},
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.operation = operation;
    if (diagnostics.code !== undefined) this.code = diagnostics.code;
    if (diagnostics.constraint !== undefined) this.constraint = diagnostics.constraint;
    if (diagnostics.detail !== undefined) this.detail = diagnostics.detail;
    if (diagnostics.table !== undefined) this.table = diagnostics.table;
    if (diagnostics.column !== undefined) this.column = diagnostics.column;
    if (diagnostics.schema !== undefined) this.schema = diagnostics.schema;
    if (diagnostics.routine !== undefined) this.routine = diagnostics.routine;
    if (diagnostics.query !== undefined) this.query = diagnostics.query;
    this.context = Object.freeze({ ...context });
  }
}

export function isDbError(err: unknown): err is DbError {
  return err instanceof DbError;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

/**
 * Walk an error's `cause` chain, merging the first defined value seen for each
 * diagnostic field. Drivers put them one or two links down (drizzle wrapper →
 * PGlite/pg error), and merging rather than picking one link means we keep
 * drizzle's `query` alongside PostgreSQL's `code`.
 */
export function pgDiagnostics(err: unknown): PgDiagnostics {
  const out: Record<string, string> = {};
  const seen = new Set<unknown>();
  let node: unknown = err;
  // Depth is bounded to keep a cyclic `cause` from looping forever.
  for (let depth = 0; depth < 8 && node !== undefined && node !== null; depth += 1) {
    if (seen.has(node)) break;
    seen.add(node);
    const rec = asRecord(node);
    if (!rec) break;
    for (const key of DIAGNOSTIC_KEYS) {
      const value = rec[key];
      if (out[key] === undefined && typeof value === 'string' && value.length > 0) {
        out[key] = value;
      }
    }
    node = rec['cause'];
  }
  return out as PgDiagnostics;
}

/**
 * The most specific human-readable message in the chain.
 *
 * drizzle's own wrapper message is deliberately skipped: `Failed query: <sql>`
 * describes what we asked for, never what went wrong, and it is the string that
 * made this class necessary.
 */
function rootMessage(err: unknown): string {
  const messages: string[] = [];
  const seen = new Set<unknown>();
  let node: unknown = err;
  for (let depth = 0; depth < 8 && node !== undefined && node !== null; depth += 1) {
    if (seen.has(node)) break;
    seen.add(node);
    const rec = asRecord(node);
    if (!rec) break;
    const message = rec['message'];
    if (typeof message === 'string' && message.length > 0) messages.push(message);
    node = rec['cause'];
  }
  const specific = messages.reverse().find((m) => !m.startsWith('Failed query:'));
  return specific ?? messages[0] ?? String(err);
}

/**
 * Turn any thrown value into a `DbError` whose message names the real fault.
 *
 * An error that is already a `DbError` is returned unchanged, so wrapping at
 * several layers does not nest "appendEvent failed: appendEvent failed: …".
 */
export function wrapDbError(
  operation: string,
  err: unknown,
  context: Record<string, unknown> = {},
): DbError {
  if (err instanceof DbError) return err;
  const diagnostics = pgDiagnostics(err);
  const parts: string[] = [];
  if (diagnostics.code) parts.push(`code ${diagnostics.code}`);
  if (diagnostics.constraint) parts.push(`constraint ${diagnostics.constraint}`);
  if (diagnostics.detail) parts.push(diagnostics.detail);
  const suffix = parts.length > 0 ? ` [${parts.join('; ')}]` : '';
  return new DbError(
    `${operation} failed: ${rootMessage(err)}${suffix}`,
    operation,
    diagnostics,
    context,
    { cause: err },
  );
}
