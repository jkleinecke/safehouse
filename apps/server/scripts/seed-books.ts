/**
 * seed:books (FR11.7) — turn the folder of rulebook PDFs sitting next to
 * DESIGN.md into the app's library: register each PDF with a guessed code and
 * page offset, copy it into the file store, and extract per-page text into
 * `book_pages` for full-text retrieval (FR12.14).
 *
 *   pnpm seed:books
 *   pnpm seed:books --list
 *   pnpm seed:books --only SR5 --max-pages 40
 *   pnpm --filter @safehouse/server seed:books --dir D:/books
 *
 * Pass the flags directly, as above. A bare `--` separator between the script
 * name and the flags does NOT work: pnpm forwards it to the script and the
 * parser below rejects it with "unknown flag". Every form printed here has
 * been run.
 *
 * The GM-facing version of all this is `docs/BOOKS.md` — where the PDFs live,
 * what the page counts mean, and how page offsets get calibrated.
 *
 * Flags:
 *   --dir <path>       folder to scan (default: repo root)
 *   --only <CODE>      just one guessed code — fast targeted runs and tests
 *   --max-pages <N>    extract at most N PDF pages per book
 *   --data-dir <path>  DATA_DIR override (file store + PGlite location)
 *   --calibrate        measure each book's page offset from the page numbers
 *                      printed on its own pages, before indexing (FR11.1)
 *   --recalibrate      implies --calibrate, and also overwrites an offset that
 *                      was set by hand (or by an earlier --calibrate)
 *   --list             print the filename → code/offset guesses and exit
 *
 * Codes are guesses for the GM to confirm. The seeded offsets are guesses too,
 * and 0 is the wrong guess for almost every book — which is what `--calibrate`
 * is for: without it a `RG p.104` chip opens whatever leaf happens to be 104th
 * in the PDF, silently. It adds well under a second per book.
 * The PDFs never enter git (§16).
 */
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureMigrations, getDb } from '@safehouse/db';
import { closeDatabase } from '../src/shutdown.js';
import {
  guessBookFromFilename,
  seedBooks,
  type SeedBookResult,
  type SeedBooksOptions,
} from '../src/services/books.js';

/** Repo root — three levels up from apps/server/scripts. */
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

export interface Cli {
  dir: string;
  only?: string;
  maxPages?: number;
  dataDir?: string;
  calibrate: boolean;
  /** Also overwrite offsets a human already set (implies `calibrate`). */
  recalibrate: boolean;
  list: boolean;
}

export function parseArgs(argv: string[]): Cli {
  const cli: Cli = { dir: REPO_ROOT, calibrate: false, recalibrate: false, list: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${arg} needs a value`);
      return v;
    };
    switch (arg) {
      case '--dir':
        cli.dir = next();
        break;
      case '--only':
        cli.only = next().toUpperCase();
        break;
      case '--max-pages':
        cli.maxPages = Number(next());
        break;
      case '--data-dir':
        cli.dataDir = next();
        break;
      case '--calibrate':
        cli.calibrate = true;
        break;
      case '--recalibrate':
        // Overwriting a human's calibration is the whole point of this flag,
        // so it has to turn detection on as well.
        cli.calibrate = true;
        cli.recalibrate = true;
        break;
      case '--list':
        cli.list = true;
        break;
      case '--help':
      case '-h':
        cli.list = true;
        break;
      default:
        throw new Error(`unknown flag: ${arg}`);
    }
  }
  if (cli.maxPages !== undefined && (!Number.isInteger(cli.maxPages) || cli.maxPages < 1)) {
    throw new Error('--max-pages must be a positive integer');
  }
  return cli;
}

/** `+5`, `-2`, or `?` when detection declined to name one. */
function offsetCell(offset: number | null): string {
  if (offset === null) return '?';
  return offset >= 0 ? `+${offset}` : `${offset}`;
}

/**
 * The `--calibrate` report: one row per book with the measured offset, how
 * strong the agreement was, and what the sample deliberately ignored. A GM
 * should be able to read this and know which books still need a human.
 */
export function calibrationTable(results: SeedBookResult[]): string[] {
  const rows = results.filter((r) => r.calibration !== undefined);
  if (rows.length === 0) return [];
  const out: string[] = [
    '',
    '[seed:books] page offsets (printed page + offset = PDF page):',
    `  ${'CODE'.padEnd(5)} ${'OFFSET'.padStart(6)} ${'CONF'.padStart(5)} ${'AGREE'.padStart(7)}  ${'SKIPPED'.padEnd(18)} RESULT`,
  ];
  let anyHumanSet = false;
  let anyUnsure = false;
  for (const r of rows) {
    const cal = r.calibration!;
    const d = cal.detection;
    const skipped = `${d.skipped.frontMatter}f/${d.skipped.backMatter}b/${d.skipped.noText}img/${d.skipped.noNumber}n#`;
    const result = cal.applied ? 'applied' : cal.status;
    if (cal.status === 'human-set') anyHumanSet = true;
    if (cal.status === 'low-confidence' || cal.status === 'undetected') anyUnsure = true;
    out.push(
      `  ${r.code.padEnd(5)} ${offsetCell(d.offset).padStart(6)} ${`${Math.round(d.confidence * 100)}%`.padStart(5)} ${`${d.agreed}/${d.withText}`.padStart(7)}  ${skipped.padEnd(18)} ${result} — ${cal.message}`,
    );
  }
  out.push(
    '  SKIPPED = f: front-matter pages left out of the sample (a table of contents is all page numbers,',
    '  and they belong to other pages), b: back-matter pages left out for the same reason (index, ads),',
    '  img: sampled pages with no extractable text at all (image-only scans — invisible to search and to',
    '  the Fixer too), n#: sampled pages whose text carried no page number.',
  );
  if (anyHumanSet) {
    out.push('  Some offsets were set by hand and were left alone — pass --recalibrate to overwrite them.');
  }
  if (anyUnsure) {
    out.push(
      '  Books with no confident offset keep their seeded value: open one to a known printed page and',
      '  nudge the offset in the app (FR11.1). A wrong offset is worse than none.',
    );
  }
  return out;
}

/**
 * Resolve `--dir` the way the person typing it means it.
 *
 * pnpm runs this script with cwd = apps/server, so a GM standing in the repo
 * root who types `--dir books` (the obvious thing, and where the books now
 * live) got "no such folder: books" — the path was resolved against the
 * package, not the repo. Try the literal path first, then the same path
 * relative to the repo root, and only then give up.
 */
export function resolveBooksDir(dir: string): string | null {
  if (existsSync(dir)) return dir;
  const fromRepoRoot = resolve(REPO_ROOT, dir);
  if (existsSync(fromRepoRoot)) return fromRepoRoot;
  return null;
}

export async function main(): Promise<number> {
  const cli = parseArgs(process.argv.slice(2));
  const dir = resolveBooksDir(cli.dir);
  if (dir === null) {
    console.error(
      `[seed:books] no such folder: ${cli.dir} (looked there and under ${REPO_ROOT})`,
    );
    return 1;
  }
  cli.dir = dir;

  const pdfs = readdirSync(cli.dir)
    .filter((f) => /\.pdf$/i.test(f))
    .sort();
  if (pdfs.length === 0) {
    console.error(`[seed:books] no *.pdf found in ${cli.dir}`);
    return 1;
  }

  if (cli.list) {
    console.log(`[seed:books] ${pdfs.length} PDF(s) in ${cli.dir}:`);
    for (const file of pdfs) {
      const g = guessBookFromFilename(file);
      const sign = g.offset >= 0 ? '+' : '';
      console.log(`  ${g.code.padEnd(5)} ${sign}${g.offset}  ${file}  (${g.title})`);
    }
    return 0;
  }

  if (cli.dataDir !== undefined) process.env['DATA_DIR'] = cli.dataDir;
  // PGlite wants its parent directory to exist before it opens the data dir.
  mkdirSync(process.env['DATA_DIR'] ?? './data', { recursive: true });
  const db = getDb();
  // This script exists to hand a populated DATA_DIR to another process (the
  // playthrough seeds books, exits, then boots the server on the same
  // directory). Whatever happens below, checkpoint and close on the way out —
  // src/shutdown.ts has the measurements.
  try {
    await ensureMigrations(db);

    const opts: SeedBooksOptions = { dir: cli.dir, log: (line) => console.log(line) };
    if (cli.only !== undefined) opts.only = cli.only;
    if (cli.maxPages !== undefined) opts.maxPages = cli.maxPages;
    if (cli.dataDir !== undefined) opts.dataDir = cli.dataDir;
    if (cli.calibrate) opts.calibrate = true;
    if (cli.recalibrate) opts.recalibrate = true;

    const started = Date.now();
    const results = await seedBooks(db, opts);
    if (results.length === 0) {
      console.error(
        `[seed:books] nothing matched${cli.only ? ` --only ${cli.only}` : ''} in ${cli.dir}`,
      );
      return 1;
    }
    const pages = results.reduce((n, r) => n + r.pagesInserted, 0);
    console.log(
      `[seed:books] done: ${results.length} book(s), ${pages} page(s) indexed in ${Math.round((Date.now() - started) / 1000)}s`,
    );
    for (const line of calibrationTable(results)) console.log(line);
    if (cli.calibrate) {
      console.log('[seed:books] confirm codes in the app; offsets above are measured (FR11.1).');
    } else {
      console.log(
        '[seed:books] confirm codes in the app. Page offsets are still guesses — re-run with',
      );
      console.log(
        '[seed:books]   pnpm seed:books --calibrate',
      );
      console.log(
        '[seed:books] to measure them from the page numbers printed in the books themselves (FR11.1).',
      );
    }
    return 0;
  } finally {
    await closeDatabase(db);
  }
}

// Run only as a CLI; tests import `parseArgs`/`main` without side effects.
const entry = process.argv[1];
if (entry !== undefined && resolve(entry) === fileURLToPath(import.meta.url)) {
  main()
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      console.error('[seed:books] failed:', err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
