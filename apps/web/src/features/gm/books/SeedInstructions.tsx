/**
 * What to run to get the books in (FR11.7), and what it will actually do.
 *
 * This is the screen a GM hits before the library exists, so it is the one
 * place the instructions have to be exactly right. Every command here has been
 * run against the full seventeen-book production set; none uses the `-- --list`
 * separator form, which pnpm forwards to the script so it dies on "unknown
 * flag: --".
 *
 * The import step carries `--calibrate` because the plain command leaves every
 * book but the core rulebook at offset +0, and measurement put 15 of the 17
 * somewhere else — meaning the plain command's real output is fifteen books
 * whose ref chips silently open the wrong page. Telling a GM to run the fast
 * one and fix it later is telling them to do sixteen manual calibrations.
 */
import {
  IMAGE_ONLY_NOTE,
  SEED_BOOK_COUNT,
  SEED_COMMAND,
  SEED_DURATION,
  SEED_EXPLANATION,
  SEED_LIST_COMMAND,
  SEED_MEASURED_COUNT,
  SEED_PAGE_COUNT,
} from './calibration.js';

function Cmd({ children }: { children: string }) {
  return (
    <code className="rounded bg-deck px-1.5 py-0.5 font-mono text-xs text-cyan">{children}</code>
  );
}

export default function SeedInstructions({ compact = false }: { compact?: boolean }) {
  return (
    <div className="panel p-4" data-testid="seed-instructions">
      <div className="mono-label text-cyan">no books registered</div>
      <p className="mt-2 max-w-2xl text-sm text-dim">{SEED_EXPLANATION}</p>

      <ol className="mt-3 max-w-2xl space-y-2 text-sm text-dim">
        <li>
          <span className="mono-label text-faint">1 · dry run</span>
          <div className="mt-1">
            <Cmd>{SEED_LIST_COMMAND}</Cmd> — prints the code and title guessed for every PDF it
            found, and writes nothing. Check the codes; they are what ref chips key on.
          </div>
        </li>
        <li>
          <span className="mono-label text-faint">2 · import</span>
          <div className="mt-1">
            <Cmd>{SEED_COMMAND}</Cmd> — registers each book, measures its page offset, and
            extracts per-page text. {SEED_BOOK_COUNT} books /{' '}
            {SEED_PAGE_COUNT.toLocaleString('en-US')} pages takes {SEED_DURATION}. One book at a
            time with <Cmd>--only SR5</Cmd>.
          </div>
          <div className="mt-1 text-xs text-faint">
            Keep <Cmd>--calibrate</Cmd>. Without it every book but the core rulebook is filed at
            offset +0, and that guess is wrong for 15 of the {SEED_BOOK_COUNT} — sixteen books of
            ref chips opening the wrong page, and sixteen calibrations to do by hand.
          </div>
        </li>
        <li>
          <span className="mono-label text-faint">3 · check</span>
          <div className="mt-1">
            Come back here. The run prints what it measured per book; on this library it
            measured all {SEED_MEASURED_COUNT}. Anything it declined shows as{' '}
            <span className="text-warn">not calibrated</span> on its card, with the reason and a
            manual nudge beside it.
          </div>
        </li>
      </ol>

      {!compact && (
        <>
          <p className="mt-3 max-w-2xl text-xs text-faint">{IMAGE_ONLY_NOTE}</p>
          <p className="mt-2 max-w-2xl text-xs text-faint">
            Stop the server before re-seeding: the embedded database is single-process, so a
            running server and the seed script cannot hold the same <Cmd>DATA_DIR</Cmd> at once.
          </p>
        </>
      )}
    </div>
  );
}
