/**
 * seed:books (FR11.7) — turn the folder of rulebook PDFs sitting next to
 * DESIGN.md into the app's library: register each PDF with a guessed code and
 * page offset, copy it into the file store, and extract per-page text into
 * `book_pages` for full-text retrieval (FR12.14).
 *
 *   pnpm --filter @safehouse/server seed:books
 *   pnpm --filter @safehouse/server seed:books -- --only SR5 --max-pages 40
 *   pnpm --filter @safehouse/server seed:books -- --dir D:/books --list
 *
 * Flags:
 *   --dir <path>       folder to scan (default: repo root)
 *   --only <CODE>      just one guessed code — fast targeted runs and tests
 *   --max-pages <N>    extract at most N PDF pages per book
 *   --data-dir <path>  DATA_DIR override (file store + PGlite location)
 *   --list             print the filename → code/offset guesses and exit
 *
 * Codes are guesses for the GM to confirm; offsets start at 0 and are
 * calibrated in-app (FR11.1) — except the core rulebook's measured +5.
 * The PDFs never enter git (§16).
 */
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureMigrations, getDb } from '@safehouse/db';
import { guessBookFromFilename, seedBooks, type SeedBooksOptions } from '../src/services/books.js';

/** Repo root — three levels up from apps/server/scripts. */
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

export interface Cli {
  dir: string;
  only?: string;
  maxPages?: number;
  dataDir?: string;
  list: boolean;
}

export function parseArgs(argv: string[]): Cli {
  const cli: Cli = { dir: REPO_ROOT, list: false };
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

export async function main(): Promise<number> {
  const cli = parseArgs(process.argv.slice(2));
  if (!existsSync(cli.dir)) {
    console.error(`[seed:books] no such folder: ${cli.dir}`);
    return 1;
  }

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
  await ensureMigrations(db);

  const opts: SeedBooksOptions = { dir: cli.dir, log: (line) => console.log(line) };
  if (cli.only !== undefined) opts.only = cli.only;
  if (cli.maxPages !== undefined) opts.maxPages = cli.maxPages;
  if (cli.dataDir !== undefined) opts.dataDir = cli.dataDir;

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
  console.log('[seed:books] confirm codes and calibrate page offsets in the app (FR11.1).');
  return 0;
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
