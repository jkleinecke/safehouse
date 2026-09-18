/**
 * The Gear step's nuyen: where it comes from, what converting Karma adds, and
 * what is left when shopping stops (FR3.9, docs/CHARGEN.md §4.4 Step 7 "a
 * 'convert Karma to nuyen' control … shows what it costs the Karma pool",
 * "the 5,000¥ carry-over is shown and anything above it is named as lost").
 *
 * A first-timer's surprise on this step is usually one of two things: that
 * Karma can become nuyen at all, and that nuyen they did not spend is mostly
 * gone. So the panel says both before the shopping starts. The pool is the
 * rail's (`PoolLine`); the Resources row and the conversion are taken apart
 * from it (`nuyenSummary`); the conversion is a refusing stepper whose limit
 * is the level's, refused with the validator's own sentence through `probe`,
 * with the next point's price quoted against the Karma pool beside it. What
 * would be lost is the validator's warning, word for word — the frame asks
 * for the acknowledgement at Next (`confirm.ts`), this only says it early.
 */
import { useId } from 'react';
import type { Budgets, CharacterBuild, ChargenSettings, Issue } from '@safehouse/contracts';
import type { BuildProber } from '../../analysis.js';
import LimitStepper from '../../components/LimitStepper.js';
import { CostQuote, PoolLine, WhyLink } from '../../kit/index.js';
import { formatNuyen } from '../../lib.js';
import type { BuildUpdater } from '../../session.js';
import { NUYEN_CODES, carryWords, karmaConversion, nuyenSourceWords, nuyenSummary, refusalFrom, withKarmaToNuyen } from './gear.js';
import { GearSection, IssueNotes } from './parts.js';

export interface NuyenPanelProps {
  build: CharacterBuild;
  settings: ChargenSettings;
  budgets: Budgets;
  /** The step's issues; the panel shows the nuyen pool's own. */
  issues: readonly Issue[];
  probe: BuildProber;
  update: (fn: BuildUpdater) => void;
  readOnly: boolean;
}

export default function NuyenPanel({ build, settings, budgets, issues, probe, update, readOnly }: NuyenPanelProps) {
  const headingId = useId();
  const quoteId = useId();
  const summary = nuyenSummary(build, settings, budgets);
  const conversion = karmaConversion(build, settings);
  const next = conversion.value + 1;
  const refuseIncrease = readOnly ? null : refusalFrom(probe((b) => withKarmaToNuyen(b, next), `gear:toNuyen:${next}`));
  const own = issues.filter((i) => NUYEN_CODES.has(i.code));
  return (
    <GearSection headingId={headingId} title="Nuyen" testId="gear-nuyen">
      <div className="space-y-1">
        <PoolLine budgets={budgets} pool="nuyen" className="font-semibold" />
        <p className="text-xs text-dim" data-testid="gear-nuyen-sources">
          {nuyenSourceWords(summary, conversion.value)}
        </p>
      </div>
      <IssueNotes issues={own} testId="gear-nuyen-issues" />
      <div className="space-y-1.5 rounded-md border border-edge bg-deck/60 p-3" data-testid="gear-karma-conversion">
        <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
          <LimitStepper
            label="Karma converted to nuyen"
            value={conversion.value}
            min={0}
            max={conversion.max}
            onChange={(n) => update((b) => withKarmaToNuyen(b, n))}
            refuseIncrease={refuseIncrease}
            readOnly={readOnly}
            testId="gear-karma-stepper"
          />
          {!readOnly && (
            <span className="flex flex-wrap items-center gap-1 pt-2 text-xs text-dim">
              <span>the next point</span>
              <CostQuote amount={1} budgets={budgets} pool="karma" id={quoteId} />
            </span>
          )}
        </div>
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-dim">
          <span>
            Each point of Karma buys {formatNuyen(conversion.perKarma)}, up to {conversion.max} at this level.
          </span>
          <WhyLink refValue={conversion.ref} />
        </p>
      </div>
      <p className="text-xs text-dim" data-testid="gear-carry">
        {carryWords(summary)}
      </p>
    </GearSection>
  );
}
