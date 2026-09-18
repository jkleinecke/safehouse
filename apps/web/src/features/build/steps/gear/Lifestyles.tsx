/**
 * The Gear step's lifestyles — where the runner lives, paid ahead (FR3.9,
 * docs/CHARGEN.md §4.4 Step 7 "lifestyle rows take months and apply the
 * metatype multiplier", "complete when … a lifestyle exists").
 *
 * The one thing this step needs before Next is a lifestyle, and the one
 * number on it a first-timer gets wrong is the price: a troll pays double, a
 * dwarf a fifth more, Dependents add on top. So every price here is what
 * *this* runner pays — the engine's `lifestyleMonthlyCost`, never the listed
 * figure alone — and the surcharges are named with their pages above the
 * lines. Each line takes a name ("Low (safehouse)"), a tier and a number of
 * months; several may be kept, each at full cost. Adding one is a row of
 * buttons, one per tier, each priced for this runner and naming the
 * starting-nuyen dice that tier would set; the dice the dearest kept tier
 * sets are stated below, since that roll is made when the GM approves.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { LIFESTYLE_TIERS, type Budgets, type CharacterBuild, type Issue, type LifestyleTier } from '@safehouse/contracts';
import { qualityEffects } from '@safehouse/rules';
import { RefChip } from '../../../gm/books/RefChip.js';
import LimitStepper from '../../components/LimitStepper.js';
import { formatNuyen } from '../../lib.js';
import type { BuildUpdater } from '../../session.js';
import {
  LIFESTYLE_LABEL,
  lifestyleLines,
  lifestyleSurcharges,
  lifestyleWords,
  startingNuyenWords,
  tierOptions,
  withLifestyle,
  withLifestyleMonths,
  withLifestyleName,
  withLifestyleTier,
  withoutLifestyle,
  type LifestyleLine,
} from './gear.js';
import { GearSection, IssueNotes, SubHeading, TOUCH_CHIP } from './parts.js';

export interface LifestylesProps {
  id: string;
  build: CharacterBuild;
  budgets: Budgets;
  /** The step's issues; the section shows the lifestyle ones. */
  issues: readonly Issue[];
  update: (fn: BuildUpdater) => void;
  readOnly: boolean;
}

/** The line's name as typed: committed while it says something, put back to the tier's name if left empty. */
function NameField({ line, update }: { line: LifestyleLine; update: LifestylesProps['update'] }) {
  const input = useRef<HTMLInputElement | null>(null);
  const [text, setText] = useState(line.lifestyle.name);
  useEffect(() => {
    if (typeof document === 'undefined' || document.activeElement !== input.current) setText(line.lifestyle.name);
  }, [line.lifestyle.name]);
  return (
    <label className="flex min-w-0 flex-1 basis-40 flex-col gap-0.5">
      <span className="mono-label">Name</span>
      <input
        ref={input}
        className="w-full rounded-md border border-edge bg-deck px-2.5 py-1.5 text-sm text-ink focus:border-cyan focus:outline-none"
        value={text}
        maxLength={120}
        aria-label={`Name of lifestyle ${line.index + 1}`}
        onChange={(e) => {
          setText(e.target.value);
          if (e.target.value.trim()) update((b) => withLifestyleName(b, line.index, e.target.value));
        }}
        onBlur={() => {
          if (!text.trim()) {
            update((b) => withLifestyleName(b, line.index, ''));
            setText(LIFESTYLE_LABEL[line.lifestyle.tier]);
          }
        }}
        data-testid="gear-lifestyle-name"
      />
    </label>
  );
}

function LineRow({ line, update, readOnly }: { line: LifestyleLine; update: LifestylesProps['update']; readOnly: boolean }) {
  const { lifestyle } = line;
  const listed = line.listed !== line.monthly ? ` (listed at ${formatNuyen(line.listed)})` : '';
  return (
    <li className="space-y-2 py-2" data-testid="gear-lifestyle" data-tier={lifestyle.tier}>
      {readOnly ? (
        <p className="text-sm text-ink">
          {lifestyle.name}
          <span className="text-dim"> · {LIFESTYLE_LABEL[lifestyle.tier]} · {lifestyle.months} {lifestyle.months === 1 ? 'month' : 'months'}</span>
        </p>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <NameField line={line} update={update} />
          <label className="flex flex-col gap-0.5">
            <span className="mono-label">Tier</span>
            <select
              className="rounded-md border border-edge bg-deck px-2 py-1.5 text-sm text-ink focus:border-cyan focus:outline-none"
              value={lifestyle.tier}
              aria-label={`Tier of ${lifestyle.name}`}
              onChange={(e) => update((b) => withLifestyleTier(b, line.index, e.target.value as LifestyleTier))}
              data-testid="gear-lifestyle-tier"
            >
              {LIFESTYLE_TIERS.map((tier) => (
                <option key={tier} value={tier}>
                  {LIFESTYLE_LABEL[tier]}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {!readOnly && (
          <LimitStepper
            label={`Months of ${lifestyle.name}`}
            value={lifestyle.months}
            min={1}
            onChange={(n) => update((b) => withLifestyleMonths(b, line.index, n))}
            testId="gear-lifestyle-months"
          />
        )}
        <span className="text-sm text-ink" data-testid="gear-lifestyle-cost">
          {lifestyleWords(line)}
          <span className="text-xs text-dim">{listed}</span>
        </span>
        {!readOnly && (
          <button
            type="button"
            className="btn ml-auto px-3 py-1"
            aria-label={`remove the ${lifestyle.name} lifestyle`}
            onClick={() => update((b) => withoutLifestyle(b, line.index))}
            data-testid="gear-lifestyle-remove"
          >
            remove
          </button>
        )}
      </div>
    </li>
  );
}

export default function Lifestyles({ id, build, budgets, issues, update, readOnly }: LifestylesProps) {
  const headingId = useId();
  const addId = useId();
  const multiplier = budgets.preview?.lifestyleMultiplier ?? 1;
  const dependents = qualityEffects(build).dependentsMultiplier;
  const lines = lifestyleLines(build, multiplier, dependents);
  const surcharges = lifestyleSurcharges(multiplier, dependents);
  const starting = startingNuyenWords(build, budgets);
  const own = issues.filter((i) => i.code === 'lifestyle-missing');
  return (
    <GearSection id={id} headingId={headingId} title="Lifestyles" testId="gear-lifestyles">
      <p className="text-xs text-dim">
        Where the runner lives, paid a month or more ahead. The step needs one; keep a second for a safehouse, each at full price.
      </p>
      {surcharges.length > 0 && (
        <ul className="space-y-1" data-testid="gear-lifestyle-surcharges">
          {surcharges.map((s) => (
            <li key={s.text} className="flex flex-wrap items-center gap-1.5 text-xs text-dim">
              <span>{s.text}</span>
              <RefChip refValue={s.ref} className={TOUCH_CHIP} />
            </li>
          ))}
        </ul>
      )}
      <IssueNotes issues={own} testId="gear-lifestyle-issues" />
      {lines.length > 0 && (
        <ul className="divide-y divide-edge/60" aria-label="Lifestyles kept">
          {lines.map((line) => (
            <LineRow key={line.index} line={line} update={update} readOnly={readOnly} />
          ))}
        </ul>
      )}
      {!readOnly && (
        <div className="space-y-1.5">
          <SubHeading id={addId}>{lines.length === 0 ? 'Pick one' : 'Add another'}</SubHeading>
          <ul aria-labelledby={addId} className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {tierOptions(multiplier, dependents).map((option) => (
              <li key={option.tier}>
                <button
                  type="button"
                  className="btn w-full flex-wrap justify-between gap-x-3 gap-y-0.5 px-3 py-1.5 text-left normal-case tracking-normal"
                  onClick={() => update((b) => withLifestyle(b, option.tier))}
                  aria-label={`add a ${option.label} lifestyle, ${formatNuyen(option.monthly)} a month, starting nuyen ${option.dice}`}
                  data-testid="gear-lifestyle-add"
                  data-tier={option.tier}
                >
                  <span className="font-sans text-sm text-ink">{option.label}</span>
                  <span className="text-xs text-dim">
                    {formatNuyen(option.monthly)} a month · {option.dice}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {starting && (
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-dim" data-testid="gear-starting-nuyen">
          <span>{starting.text}</span>
          <RefChip refValue={starting.ref} className={TOUCH_CHIP} />
        </p>
      )}
    </GearSection>
  );
}
