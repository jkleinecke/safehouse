/**
 * What this step's Karma bought, one line per spend, each with its price and
 * an undo (FR3.9, docs/CHARGEN.md §4.4 Step 8).
 *
 * The steppers below raise and lower things one rating at a time; the ledger
 * is where every spend can be seen whole and taken back in one tap —
 * including the ones no stepper reaches any more, such as a raise an upstream
 * change left stale, or a spell the character can no longer learn. Each
 * line's price is the engine's `spendKarma` over the build's pricing, the
 * same figure the rail subtracts, and the validator's findings on a spend
 * (`karma.spends.N…`) sit under the line they name, so "redo this raise" is
 * next to the undo that does it.
 */
import type { CharacterBuild, Issue } from '@safehouse/contracts';
import type { BuildUpdater } from '../../session.js';
import { spendLabel, withoutSpend } from './logic.js';
import { EmptyLine, IssueNotes, Section } from './parts.js';
import type { KarmaTaps } from './taps.js';

export interface LedgerProps {
  build: CharacterBuild;
  taps: KarmaTaps;
  /** Issues by spend index (`placeIssues(...).spends`). */
  issues: ReadonlyMap<number, readonly Issue[]>;
  update: (fn: BuildUpdater) => void;
  readOnly: boolean;
}

export default function Ledger({ build, taps, issues, update, readOnly }: LedgerProps) {
  const spends = build.karma.spends;
  return (
    <Section title="Bought with Karma" testId="karma-ledger">
      {spends.length === 0 ? (
        <EmptyLine testId="karma-ledger-empty">
          Nothing is bought with Karma yet. Every price below is quoted before you take it, and anything taken can be undone here.
        </EmptyLine>
      ) : (
        <ol className="divide-y divide-edge/60" aria-label="Karma spends">
          {spends.map((spend, index) => {
            const label = spendLabel(spend);
            const price = taps.priceOf(spend);
            const found = issues.get(index) ?? [];
            return (
              <li key={`${spend.kind}-${index}`} className="space-y-1 py-2" data-testid="karma-spend" data-kind={spend.kind}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 basis-40 text-sm text-ink">{label}</span>
                  <span className="font-label text-xs text-dim" data-testid="karma-spend-price">
                    {price} Karma
                  </span>
                  {!readOnly && (
                    <button
                      type="button"
                      className="btn px-3 pointer-coarse:min-w-10"
                      aria-label={`undo ${label}, giving back ${price} Karma`}
                      data-testid="karma-undo"
                      onClick={() => update((b) => withoutSpend(b, index))}
                    >
                      undo
                    </button>
                  )}
                </div>
                <IssueNotes issues={found} testId="karma-spend-issues" />
              </li>
            );
          })}
        </ol>
      )}
    </Section>
  );
}
