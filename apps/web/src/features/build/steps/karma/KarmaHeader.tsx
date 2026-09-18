/**
 * The top of the Karma step: how much Karma is left, big, and what happens
 * to it (FR3.9, docs/CHARGEN.md §4.4 Step 8 "Complete when: Karma carried is
 * 7 or less").
 *
 * Everything below this spends one number, so the number comes first and is
 * the largest thing on the screen — on a phone the rail is folded away and
 * this is the only place it shows. Under it, where the pool came from (the
 * level's start, the qualities, the Karma turned into nuyen, this step's own
 * spends), read off the engine's tally so the lines add up to the number by
 * construction; then the carry-over, which is the step's one completion
 * rule: Karma above the cap is marked in words and the warning colour, and so
 * is an overspend. The step's issues that name no single line sit last.
 */
import { useId } from 'react';
import type { Budgets, CharacterBuild, ChargenSettings, Issue } from '@safehouse/contracts';
import { issueRule, type BuildTally } from '@safehouse/rules';
import WhyLink from '../../kit/WhyLink.js';
import { carrySentence, carryState, karmaLines, signedAmount } from './logic.js';
import { IssueNotes } from './parts.js';

/** The two issues the header already says in words of its own. */
const SAID_ABOVE = new Set(['karma-carry-over', 'karma-overspent']);

export interface KarmaHeaderProps {
  build: CharacterBuild;
  budgets: Budgets;
  settings: ChargenSettings;
  tally: BuildTally;
  /** This step's issues that name no single spend or contact. */
  general: readonly Issue[];
}

export default function KarmaHeader({ build, budgets, settings, tally, general }: KarmaHeaderProps) {
  const carry = carryState(budgets, settings);
  const remaining = budgets.pools.karma.remaining;
  const lines = karmaLines(build, tally);
  const carryRef = issueRule('karma-carry-over')?.ref;
  const marked = carry.overspent > 0 || carry.lost > 0;
  const rest = general.filter((i) => !SAID_ABOVE.has(i.code));
  const headingId = useId();
  return (
    <section className="panel space-y-3 p-3 sm:p-4" aria-labelledby={headingId} data-testid="karma-header">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id={headingId} className="mono-label text-dim">
            {remaining < 0 ? 'Karma overspent' : 'Karma left'}
          </h2>
          <p
            className={`font-label text-5xl leading-none ${remaining < 0 ? 'text-danger' : carry.lost > 0 ? 'text-warn' : 'text-ink'}`}
            data-testid="karma-left"
            data-over={remaining < 0 ? 'yes' : 'no'}
          >
            {remaining < 0 && <span aria-hidden>✕ </span>}
            {Math.abs(remaining)}
            <span className="sr-only">{remaining < 0 ? ' Karma over' : ' Karma left'}</span>
          </p>
        </div>
        <p className="text-sm text-dim" data-testid="karma-carried">
          carries into play: <span className="text-ink">{carry.carried}</span> of at most {carry.cap}
        </p>
      </div>

      <ul className="grid gap-x-4 gap-y-0.5 text-xs text-dim sm:grid-cols-2" aria-label="Where the Karma came from" data-testid="karma-lines">
        {lines.map((line) => (
          <li key={line.key} className="flex gap-2" data-line={line.key}>
            <span className={`w-10 shrink-0 text-right font-label ${line.amount < 0 ? 'text-faint' : 'text-ink'}`}>
              {line.key === 'start' ? line.amount : signedAmount(line.amount)}
            </span>
            <span>{line.label}</span>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-2">
        <p
          className={`text-sm ${marked ? 'text-danger' : 'text-ok'}`}
          data-testid="karma-carry"
          data-over-carry={carry.lost > 0 ? 'yes' : 'no'}
          data-overspent={carry.overspent > 0 ? 'yes' : 'no'}
        >
          <span aria-hidden>{marked ? '✕ ' : '● '}</span>
          {carrySentence(carry)}
        </p>
        {carryRef && <WhyLink refValue={carryRef} />}
      </div>

      <IssueNotes issues={rest} testId="karma-general-issues" />
    </section>
  );
}
