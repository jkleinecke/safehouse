/**
 * Power points and adept powers (FR3.9, docs/CHARGEN.md §4.4 Step 4: "a
 * mystic adept sees 'Power Points: 0 of up to 6 — buy in Step 8 at 5 Karma
 * each' and a shortcut to do it now, which is what the book's own example
 * does").
 *
 * An adept's points are Magic and there is nothing to buy; the pool says so.
 * A mystic adept's are bought, and the shortcut is the same Karma spend Step 8
 * lists — a refusing stepper over the `powerPoint` spend, with its price
 * quoted against the Karma pool before the tap, refusing past Magic with the
 * validator's own sentence. It does not refuse a Karma overspend: the price
 * says "short" in words and the rail turns red, because a player may still
 * take a negative quality in step 5.
 *
 * A power is chosen from the campaign's books (`CataloguePicker`, kind power)
 * and staged before it is added: its levels, when the row prices per level
 * (refusing past Magic, again in the engine's words), an optional note of
 * what it is aimed at, and its cost quoted against the power point pool. The
 * add button is probed with the power at those levels, so a power the pool
 * cannot pay for is refused before it lands, with the sentence and page. A
 * row whose cost the engine cannot read ("Varies") asks for the cost with the
 * page beside it, and Add stays shut until one is typed — a power added at 0
 * PP would never count against the pool, so an overspend could never show.
 *
 * Points bought, or powers taken, by a kind that has no use for them stay on
 * the record after a kind change (the engine keeps them); they are listed
 * with a way to remove them.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { BuildPowerPickSchema, type BuildPowerPick, type Issue } from '@safehouse/contracts';
import { KARMA_COSTS, MAGIC_KIND_TABLE, cataloguePowerPoints } from '@safehouse/rules';
import { RefChip } from '../../../gm/books/RefChip.js';
import type { CatalogueHit } from '../../../sheet/catalogue/toSheet.js';
import LimitStepper from '../../components/LimitStepper.js';
import CataloguePicker from '../../kit/CataloguePicker.js';
import CostQuote from '../../kit/CostQuote.js';
import PoolLine from '../../kit/PoolLine.js';
import { hitRef, hitToPower } from '../../kit/mappers.js';
import type { StepProps } from '../types.js';
import { powerPointsBought, setPowerPointsBought } from '@safehouse/rules';
import { addPower, ppWords, refusalOf, removePower, splitByIndex, typedPowerPoints } from './model.js';
import { IssueNotes, RefusalLine, RemoveButton, Section, StepLink } from './parts.js';

const IGNORE_KARMA_OVERSPEND: ReadonlySet<string> = new Set(['karma-overspent']);
const LEVEL_CAP: ReadonlySet<string> = new Set(['power-levels-over-magic']);

export function PowerPointSection({ props, issues }: { props: StepProps; issues: readonly Issue[] }) {
  const headingId = useId();
  const quoteId = useId();
  const { build, budgets } = props;
  const kind = build.magic.kind;
  const how = MAGIC_KIND_TABLE[kind].powerPoints;
  const bought = powerPointsBought(build);
  const magic = budgets.preview?.magic ?? props.ratings.attributes.mag.rating;
  const refuseIncrease =
    how === 'karma' && !props.readOnly
      ? refusalOf(props.probe((b) => setPowerPointsBought(b, bought + 1), `pp-bought:${bought + 1}`), { ignore: IGNORE_KARMA_OVERSPEND })
      : null;
  return (
    <Section id={headingId} title="Power points" testId="magic-pp-section">
      {how !== null && <PoolLine budgets={budgets} pool="powerPoints" />}
      {how === 'free' && (
        <p className="text-sm text-dim" data-testid="magic-pp-free">
          An adept’s power points equal Magic, {magic} now; nothing to buy.
        </p>
      )}
      {how === 'karma' && (
        <div className="space-y-2" data-testid="magic-pp-buy">
          <p className="flex flex-wrap items-center gap-2 text-sm text-dim">
            <span>
              Power points: {budgets.pools.powerPoints.available} of up to {magic}. A mystic adept buys them at {KARMA_COSTS.powerPoint} Karma each,
              a spend step 8 lists with the rest; buying them here is the same spend, made now.
            </span>
            <StepLink step={8} label="Karma spends in step 8" jump={props} />
          </p>
          <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
            <LimitStepper
              label="Power points bought"
              value={bought}
              min={0}
              onChange={(n) => props.update((b) => setPowerPointsBought(b, n))}
              refuseIncrease={refuseIncrease}
              readOnly={props.readOnly}
              {...(props.readOnly ? {} : { increaseDescribedBy: quoteId })}
              testId="magic-pp-stepper"
            />
            {!props.readOnly && <CostQuote id={quoteId} amount={KARMA_COSTS.powerPoint} budgets={budgets} pool="karma" className="self-center" />}
          </div>
        </div>
      )}
      {how !== 'karma' && bought > 0 && (
        <p className="flex flex-wrap items-center gap-2 text-sm text-dim" data-testid="magic-pp-leftover">
          <span>
            {bought} power {bought === 1 ? 'point' : 'points'} bought with Karma stay from an earlier choice; only a mystic adept buys them.
          </span>
          {!props.readOnly && (
            <button type="button" className="btn px-2.5 py-1 text-xs" onClick={() => props.update((b) => setPowerPointsBought(b, 0))} data-testid="magic-pp-clear">
              remove the purchase
            </button>
          )}
        </p>
      )}
      <IssueNotes issues={issues} testId="magic-pp-issues" />
    </Section>
  );
}

interface Staged {
  hit: CatalogueHit;
  levels: number;
  target: string;
  /** The power point cost as typed, for a row that prints none the engine can read. */
  cost?: string;
}

/** Why a staged power whose row prints no readable cost cannot be added yet. */
export const UNPRICED_POWER = 'Type its power point cost first.';

/**
 * The power a staged row would add at these levels, or why the row cannot
 * make one. The cost is the row's, read by the engine; only when the row has
 * none it can read does `typedCost` stand in, and without one there is no
 * power to add.
 */
export function stagePower(
  hit: CatalogueHit,
  levels: number,
  target: string,
  typedCost: number | null = null,
): { power: BuildPowerPick | null; error: string | null } {
  try {
    const power = hitToPower(hit, levels, target.trim() || undefined);
    if (cataloguePowerPoints(hit.stats, power.levels).points !== null) return { power, error: null };
    if (typedCost === null) return { power: null, error: UNPRICED_POWER };
    return { power: BuildPowerPickSchema.parse({ ...power, cost: typedCost }), error: null };
  } catch (err) {
    return { power: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/** A power staged before it is added: levels, what it is aimed at, and its price. */
function StagedPower({ props, staged, onChange, onDone }: { props: StepProps; staged: Staged; onChange: (s: Staged) => void; onDone: () => void }) {
  const titleId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const quoteId = useId();
  // A row chosen far down the list stages above it: take the eye (and a
  // screen reader) to the staged power rather than leave them on the row.
  useEffect(() => {
    headingRef.current?.focus();
    headingRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [staged.hit.id]);
  const reasonId = useId();
  const targetId = useId();
  const costId = useId();
  const costNoteId = useId();
  const { hit, levels, target, cost = '' } = staged;
  const reading = cataloguePowerPoints(hit.stats, levels);
  const unpriced = reading.points === null;
  const typedCost = unpriced ? typedPowerPoints(cost) : null;
  const ref = hitRef(hit);
  const now = stagePower(hit, levels, target, typedCost);
  const next = reading.perLevel ? stagePower(hit, levels + 1, target, typedCost) : null;
  const power = now.power;
  const levelRefusal =
    next?.power ? refusalOf(props.probe((b) => addPower(b, next.power!), `power+:${hit.id}:${levels + 1}`), { only: LEVEL_CAP }) : null;
  const refusal = power
    ? refusalOf(props.probe((b) => addPower(b, power), `power+:${hit.id}:${levels}:${power.cost}`))
    : { reason: now.error ?? 'This power cannot be added.' };
  // Waiting on a typed cost is a field to fill, not a rule saying no.
  const waiting = !power && now.error === UNPRICED_POWER;
  return (
    <div role="group" aria-labelledby={titleId} className="space-y-2 rounded-md border border-cyan-dim/60 bg-deck p-3" data-testid="magic-power-staged">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={titleId} ref={headingRef} tabIndex={-1} className="text-sm font-semibold text-ink outline-none">
          {hit.name}
        </h3>
        {ref && <RefChip refValue={ref} className="pointer-coarse:min-h-10" />}
      </div>
      {unpriced && (
        <div className="flex flex-col gap-1" data-testid="magic-power-unpriced">
          <label htmlFor={costId} className="mono-label">
            Power point cost
          </label>
          <input
            id={costId}
            type="text"
            inputMode="decimal"
            className="w-full rounded-md border border-edge bg-panel px-2.5 py-1.5 text-sm text-ink focus:border-cyan focus:outline-none sm:w-40"
            value={cost}
            onChange={(e) => onChange({ ...staged, cost: e.target.value })}
            aria-describedby={costNoteId}
            {...(cost.trim() && typedCost === null ? { 'aria-invalid': true } : {})}
            data-testid="magic-power-cost"
          />
          <p id={costNoteId} className="text-xs text-dim">
            This row prints no power point cost the app can read; type it from the page
            {cost.trim() && typedCost === null ? ', as a number above 0 (0.25, 0.5, 1…)' : ''}.
          </p>
        </div>
      )}
      {reading.perLevel && (
        <LimitStepper
          label={`Levels of ${hit.name}`}
          value={levels}
          min={1}
          onChange={(n) => onChange({ ...staged, levels: n })}
          refuseIncrease={levelRefusal}
          testId="magic-power-levels"
        />
      )}
      <div className="flex flex-col gap-1">
        <label htmlFor={targetId} className="mono-label">
          Aimed at (optional: a skill, attribute or limit)
        </label>
        <input
          id={targetId}
          type="text"
          maxLength={200}
          className="w-full rounded-md border border-edge bg-panel px-2.5 py-1.5 text-sm text-ink focus:border-cyan focus:outline-none"
          value={target}
          onChange={(e) => onChange({ ...staged, target: e.target.value })}
          data-testid="magic-power-target"
        />
      </div>
      {power && <CostQuote id={quoteId} amount={power.cost} budgets={props.budgets} pool="powerPoints" />}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={`btn px-3 py-1.5 ${refusal ? 'cursor-not-allowed opacity-60' : 'btn-accent'}`}
          aria-describedby={[...(power ? [quoteId] : []), ...(refusal ? [reasonId] : [])].join(' ') || undefined}
          {...(refusal ? { 'aria-disabled': true } : {})}
          onClick={() => {
            if (refusal || !power) return;
            const chosen = power;
            props.update((b) => addPower(b, chosen));
            onDone();
          }}
          data-testid="magic-power-add"
          data-refused={refusal ? 'yes' : 'no'}
        >
          add {hit.name}
        </button>
        <button type="button" className="btn px-3 py-1.5" onClick={onDone} data-testid="magic-power-cancel">
          cancel
        </button>
      </div>
      {refusal && <RefusalLine id={reasonId} refusal={refusal} tone={waiting ? 'hint' : 'refusal'} testId="magic-power-refusal" />}
    </div>
  );
}

export function PowersSection({ props, issues, initialStaged = null }: { props: StepProps; issues: readonly Issue[]; initialStaged?: Staged | null }) {
  const headingId = useId();
  const [staged, setStaged] = useState<Staged | null>(initialStaged);
  const { build } = props;
  const uses = MAGIC_KIND_TABLE[build.magic.kind].powerPoints !== null;
  const { whole, at } = splitByIndex(issues, 'powers');
  return (
    <Section id={headingId} title="Adept powers" testId="magic-powers-section">
      {!uses && build.powers.length > 0 && (
        <p className="flex flex-wrap items-center gap-2 text-sm text-dim">
          <span>These powers stay from an earlier choice; this kind takes none.</span>
          {!props.readOnly && (
            <button type="button" className="btn px-2.5 py-1 text-xs" onClick={() => props.update((b) => ({ ...b, powers: [] }))} data-testid="magic-powers-clear">
              remove all
            </button>
          )}
        </p>
      )}
      {build.powers.length > 0 ? (
        <ul className="divide-y divide-edge/60" aria-label="Adept powers taken" data-testid="magic-powers-list">
          {build.powers.map((power, i) => (
            <li key={`${power.catalogueId ?? power.name}-${i}`} className="space-y-1 py-1.5" data-power={power.name}>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 basis-40 text-ink">
                  {power.name}
                  {power.levels > 1 ? ` · level ${power.levels}` : ''}
                  {power.target ? ` (${power.target})` : ''}
                </span>
                <span className="mono-label text-dim">{ppWords(power.cost)}</span>
                {power.ref && <RefChip refValue={power.ref} className="pointer-coarse:min-h-10" />}
                {!props.readOnly && <RemoveButton what={power.name} onRemove={() => props.update((b) => removePower(b, i))} testId="magic-powers-remove" />}
              </div>
              <IssueNotes issues={at(i)} />
            </li>
          ))}
        </ul>
      ) : (
        uses && <p className="text-sm text-dim">No powers taken yet.</p>
      )}
      {uses && !props.readOnly && (
        <>
          {staged && <StagedPower props={props} staged={staged} onChange={setStaged} onDone={() => setStaged(null)} />}
          <CataloguePicker
            campaignId={props.campaignId}
            kind="power"
            caps={props.settings}
            pickLabel="choose"
            onPick={(hit) => setStaged({ hit, levels: 1, target: '' })}
            testId="power-picker"
          />
        </>
      )}
      <IssueNotes issues={whole} testId="magic-powers-issues" />
    </Section>
  );
}

export type { Staged as StagedPowerChoice };
