/**
 * The library instructions have to actually run (M11 / FR11.7).
 *
 * This suite exists because they did not: `apps/server/scripts/seed-books.ts`
 * shipped a usage header reading `seed:books -- --list`, which pnpm forwards
 * verbatim so the parser dies on "unknown flag: --". A GM copying the
 * documented command got an error instead of a library.
 *
 * So every `pnpm ... seed:books ...` command printed in `docs/BOOKS.md`, the
 * README, or the script's own header is extracted and fed through the real
 * `parseArgs`. A command that would not run is a failing test, not a support
 * question. The rest of the file guards the facts a GM cannot afford to have
 * silently drift out of the docs: the measured core-book offset, the
 * image-only page caveat, and the code list the seeder actually emits.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { guessBookFromFilename } from '../src/services/books.js';
import { parseArgs } from '../scripts/seed-books.js';

const REPO_ROOT = new URL('../../../', import.meta.url);

function readDoc(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, REPO_ROOT)), 'utf8');
}

/**
 * Every line that reads like a shell command, from three shapes at once:
 * fenced code blocks, inline `code` spans, and source-comment lines. Comment
 * markers and Markdown list bullets are stripped so a command indented inside
 * a numbered step still counts.
 */
export function extractCommands(text: string): string[] {
  const candidates: string[] = [];

  let fenced = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      continue;
    }
    const bare = line
      .replace(/^\s*(?:\*|\/\/|#|>)\s?/, '') // block-comment / quote markers
      .replace(/^\s*(?:[-+*]|\d+\.)\s+/, '') // list bullets
      .trim();
    if (fenced || bare.startsWith('pnpm')) candidates.push(bare);
    for (const span of line.matchAll(/`([^`\n]+)`/g)) candidates.push(span[1]!.trim());
  }

  return candidates.filter((c) => /^pnpm\b/.test(c) && /\bseed:books\b/.test(c));
}

/** The flags a documented command would hand the script. */
export function argvOf(command: string): string[] {
  const tokens = (command.split('#')[0] ?? '').trim().split(/\s+/);
  const at = tokens.indexOf('seed:books');
  return at === -1 ? [] : tokens.slice(at + 1);
}

/** The seventeen production filenames the owner's library is made of. */
const PRODUCTION_PDFS = [
  'shadowrunfiftheditioncorerulebook_V2.pdf',
  'runandgun.pdf',
  'streetgrimoire.pdf',
  'datatrails.pdf',
  'chromeflesh.pdf',
  'rigger5.pdf',
  'killcode.pdf',
  'runfaster.pdf',
  'howlingshadows.pdf',
  'streetlethal.pdf',
  'forbiddenarcana.pdf',
  'darkterrors.pdf',
  'stolensouls.pdf',
  'marketpanic.pdf',
  'serratededge.pdf',
  'completetrog.pdf',
  'seattlesprawl.pdf',
] as const;

const SOURCES = {
  'docs/BOOKS.md': readDoc('docs/BOOKS.md'),
  'README.md': readDoc('README.md'),
  'apps/server/scripts/seed-books.ts': readDoc('apps/server/scripts/seed-books.ts'),
};

describe('documented seed:books commands', () => {
  for (const [name, text] of Object.entries(SOURCES)) {
    it(`${name} only shows commands the parser accepts`, () => {
      const commands = extractCommands(text);
      expect(commands.length).toBeGreaterThan(0);
      for (const command of commands) {
        const argv = argvOf(command);
        // pnpm forwards a bare `--` to the script; the parser rejects it.
        expect(argv, command).not.toContain('--');
        expect(() => parseArgs(argv), command).not.toThrow();
      }
    });
  }

  it('extracts commands from fenced blocks, inline spans and comments alike', () => {
    const sample = [
      '```',
      'pnpm seed:books      # register the library',
      '```',
      'Run `pnpm --filter @safehouse/server seed:books --list` first.',
      ' *   pnpm seed:books --only SR5 --max-pages 40',
      'Prose mentioning pnpm seed:books in passing is not a command line.',
    ].join('\n');
    const commands = extractCommands(sample);
    expect(commands).toHaveLength(3);
    expect(argvOf(commands[0]!)).toEqual([]); // the trailing `#` comment is dropped
    expect(argvOf(commands[1]!)).toEqual(['--list']);
    expect(argvOf(commands[2]!)).toEqual(['--only', 'SR5', '--max-pages', '40']);
  });

  it('catches the broken form the header used to print', () => {
    const argv = argvOf('pnpm --filter @safehouse/server seed:books -- --list');
    expect(argv).toContain('--');
    expect(() => parseArgs(argv)).toThrow(/unknown flag: --/);
  });

  it('no source still prints the `--` separator form', () => {
    for (const [name, text] of Object.entries(SOURCES)) {
      expect(text, name).not.toMatch(/seed:books\s+--\s+--/);
    }
  });
});

describe('docs/BOOKS.md facts', () => {
  const doc = SOURCES['docs/BOOKS.md'];

  it('carries the measured core-rulebook offset and its worked example', () => {
    const sr5 = guessBookFromFilename('shadowrunfiftheditioncorerulebook_V2.pdf');
    expect(sr5.offset).toBe(5);
    // printed 426 + 5 = PDF 431 — the pair the reader's provenance line prints.
    expect(doc).toMatch(/426/);
    expect(doc).toMatch(/431/);
    expect(doc).toMatch(/\+5/);
  });

  it('says a fresh book seeds at +0 and is wrong until calibrated', () => {
    expect(doc).toMatch(/\+0/);
    expect(doc.toLowerCase()).toContain('not calibrated');
  });

  it('warns that image-only pages are invisible to search and the Fixer', () => {
    expect(doc.toLowerCase()).toContain('image-only');
    expect(doc).toMatch(/invisible to search/i);
  });

  it('names every code the seeder actually emits for the production set', () => {
    for (const file of PRODUCTION_PDFS) {
      const { code } = guessBookFromFilename(file);
      expect(doc, file).toContain(`\`${code}\``);
    }
  });

  it('documents no flag the parser does not have', () => {
    // Scoped to the seeder's OWN flags, from the two places the document
    // promises one is real: §2's flag table, and the flags its worked commands
    // actually pass. §3 documents `docker compose` as well — `--build`,
    // `--env-file`, `--profile` are that CLI's, guarded by
    // infra-seed-compose.test.ts, and feeding them to `parseArgs` proves
    // nothing about either tool.
    const table = doc.slice(doc.indexOf('### Flags')).split(/^---$/m)[0]!;
    expect(doc, 'the flag table §3 defers to is gone').toContain('### Flags');
    // Backtick, flag, then a space (`--dir <path>`) or the closing backtick.
    const flags = new Set([
      ...[...table.matchAll(/`(--[a-z][a-z-]*)(?=[ `])/g)].map((m) => m[1]!),
      ...extractCommands(doc).flatMap(argvOf).filter((t) => t.startsWith('--')),
    ]);
    expect(flags.size).toBeGreaterThan(4);
    for (const flag of flags) {
      // A flag that takes a value throws "needs a value" — still proof it exists.
      expect(() => parseArgs([flag]), flag).not.toThrow(/unknown flag/);
    }
    // The offset measurement is the step this document exists to make happen.
    expect(flags).toContain('--calibrate');
  });

  it('keeps the PDFs-never-leave promise on the page', () => {
    expect(doc).toMatch(/gitignor/i);
    expect(doc.toLowerCase()).toContain('never uploaded');
  });
});

/**
 * The measured-offsets table in §4 is the one thing in this document a GM will
 * act on without re-deriving: it is what says their library is done and which
 * book to distrust. It was produced by `pnpm seed:books --calibrate` on a wiped
 * DATA_DIR against the seventeen production PDFs, twice, identically.
 *
 * These parse the table back out of the prose and check it against itself and
 * against the seeder. A hand-edit that adds a book, drops one, or quietly
 * rounds "15 of the other 16" up to sixteen fails here.
 */
describe('docs/BOOKS.md measured offsets', () => {
  const doc = SOURCES['docs/BOOKS.md'];

  interface Row {
    code: string;
    was: string;
    measured: string;
    result: string;
  }

  /** `| \`CF\` | Chrome Flesh | +0 | **+1** | 98% (47/48) | applied |` */
  const rows: Row[] = [...doc.matchAll(/^\|\s*`([A-Z0-9]{2,4})`\s*\|[^|]*\|\s*([+-]\d+)\s*\|\s*\*\*([+-]\d+)\*\*\s*\|[^|]*\|\s*([^|]+?)\s*\|$/gm)].map(
    (m) => ({ code: m[1]!, was: m[2]!, measured: m[3]!, result: m[4]! }),
  );

  it('has one row per production book, and no extras', () => {
    const expected = PRODUCTION_PDFS.map((f) => guessBookFromFilename(f).code).sort();
    expect(rows.map((r) => r.code).sort()).toEqual(expected);
  });

  it('agrees with the seeder about what each book started at', () => {
    for (const file of PRODUCTION_PDFS) {
      const { code, offset } = guessBookFromFilename(file);
      const row = rows.find((r) => r.code === code);
      expect(row, code).toBeDefined();
      // The "Was" column is the filename guess, which is what a seed without
      // --calibrate leaves behind.
      expect(Number(row!.was), code).toBe(offset);
    }
  });

  it('backs the "15 of the other 16" claim with 15 changed rows', () => {
    const changed = rows.filter((r) => r.was !== r.measured);
    const confirmed = rows.filter((r) => r.was === r.measured);
    expect(changed).toHaveLength(15);
    expect(confirmed.map((r) => r.code).sort()).toEqual(['RG', 'SR5']);
    for (const r of changed) expect(r.result, r.code).toMatch(/applied/);
    for (const r of confirmed) expect(r.result, r.code).toMatch(/confirmed/);
    // The prose must not drift away from the rows underneath it.
    expect(doc).toMatch(/15 of the\s+other 16/);
  });

  it('records the core rulebook as confirmed, not merely assumed', () => {
    const sr5 = rows.find((r) => r.code === 'SR5')!;
    expect(sr5.was).toBe('+5');
    expect(sr5.measured).toBe('+5');
    expect(sr5.result).toMatch(/confirmed/);
  });

  it('does not claim more automation than it earned', () => {
    // 17 measured with nothing left for a human is a strong claim; it has to
    // be stated as a count that matches the table, and the caveats that make
    // it honest have to stay on the page.
    expect(doc).toMatch(/17 of 17 measured/i);
    expect(doc).toMatch(/none declined/i);
    expect(doc).toMatch(/confidence is agreement, not correctness/i);
    // Only five were checked end to end; the doc must say which.
    expect(doc).toMatch(/verified end to end/i);
    for (const code of ['SR5', 'RG', 'SG', 'R5', 'RF']) {
      expect(doc, code).toContain(`\`${code}\``);
    }
  });
});

describe('README', () => {
  it('points at docs/BOOKS.md instead of re-explaining the library', () => {
    expect(SOURCES['README.md']).toContain('docs/BOOKS.md');
  });
});
