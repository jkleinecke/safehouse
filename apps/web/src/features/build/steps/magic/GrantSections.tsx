/**
 * What the Magic row hands over, laid out as lists to fill (FR3.9,
 * docs/CHARGEN.md §4.4 Step 4: "two magical skills at rating 5", "10 spells,
 * rituals or preparations", each fed by the catalogue and counted against the
 * caps; complete when every grant is filled or explicitly waived).
 *
 * Four grants, one block each, all built the same way: a heading that names
 * the grant in numbers, a count in words ("3 of 7 picked, 4 to go"), the
 * picks already made with a remove button each and the validator's finding
 * under any pick it objects to, the control that adds one more, and a waiver
 * ("waive the rest", tied to what it gives up) — the only way a grant is settled
 * short, because §4.4 asks for an explicit choice rather than a silent gap.
 *
 * Adding refuses before the fact. The granted-skill select lists only skills
 * the engine's fences leave open (`skillEligibilityIn`; the closed ones are
 * listed apart with why), and its button is probed with the chosen skill so a
 * pick that would break a rule elsewhere (a rating past 6 with the points
 * already on it) says so before the tap. Spells and complex forms come from
 * the campaign's books through the kit's `CataloguePicker`; one more of the
 * group being learned is probed first, so a grant that is full or a Magic × 2
 * cap that is reached shuts the picker's buttons with the validator's own
 * sentence, and a pick that would break something the pre-check could not
 * foresee (a ritual when only spells were probed) is refused at the tap with
 * the same words.
 *
 * Picks the chosen kind cannot hold — a magician's spells left behind by a
 * switch to adept — are listed with a "remove all", because the engine's
 * `setMagicKind` keeps them and a section that vanished would leave them
 * unreachable.
 */
import { useId, useState } from 'react';
import type { BuildPick, Issue } from '@safehouse/contracts';
import {
  activeSkillRow,
  formulaGroup,
  groupEligibilityIn,
  skillGroupRow,
  type BuildTally,
  type MagicPriorityOption,
} from '@safehouse/rules';
import { RefChip } from '../../../gm/books/RefChip.js';
import type { Refusal } from '../../components/LimitStepper.js';
import CataloguePicker from '../../kit/CataloguePicker.js';
import PoolLine from '../../kit/PoolLine.js';
import { hitToPick } from '../../kit/mappers.js';
import type { StepProps } from '../types.js';
import {
  FORMULA_WORD,
  addForm,
  addFormula,
  addGrantGroup,
  addGrantSkill,
  clearGrant,
  formulaPickRefusal,
  grantCountWords,
  grantRatingsDiffer,
  grantSkillCandidates,
  grantSkillTitleOrDefault,
  learnAs,
  learnableGroups,
  probeFormula,
  refusalOf,
  removeForm,
  removeFormula,
  removeGrantGroup,
  removeGrantSkill,
  rerateGrants,
  setWaived,
  splitByIndex,
  takenIds,
  type GrantKey,
  type GrantState,
  type LearnAs,
} from './model.js';
import { IssueNotes, RefusalLine, RemoveButton, StepLink } from './parts.js';

type GrantProps = Pick<
  StepProps,
  'build' | 'settings' | 'budgets' | 'eligibility' | 'probe' | 'update' | 'goTo' | 'steps' | 'meta' | 'mode' | 'readOnly' | 'campaignId'
>;

// ---------------------------------------------------------------------------
// The heading, count and waiver every grant shares
// ---------------------------------------------------------------------------

function GrantHead({
  title,
  state,
  readOnly,
  update,
}: {
  title: string;
  state: GrantState;
  readOnly: boolean;
  update: StepProps['update'];
}) {
  const noteId = useId();
  const tone = state.over ? 'text-danger' : state.settled ? 'text-ok' : 'text-warn';
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-sm font-medium text-ink">{title}</h3>
        <span className={`text-xs ${tone}`} data-testid={`grant-${state.key}-count`}>
          <span aria-hidden>{state.over ? '✕ ' : state.settled ? '● ' : '○ '}</span>
          {grantCountWords(state)}
        </span>
      </div>
      {state.open > 0 && !state.waived && !readOnly && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn px-2.5 py-1 text-xs"
            aria-describedby={noteId}
            onClick={() => update((b) => setWaived(b, state.key, true))}
            data-testid={`grant-${state.key}-waive`}
          >
            waive the rest
          </button>
          <span id={noteId} className="text-xs text-faint">
            Gives up the {state.open} still open; the step then counts this grant as done.
          </span>
        </div>
      )}
      {state.open > 0 && state.waived && (
        <div className="flex flex-wrap items-center gap-2" data-testid={`grant-${state.key}-waived`}>
          <span id={noteId} className="text-xs text-dim">
            Waived: {state.open} left unpicked on purpose.
          </span>
          {!readOnly && (
            <button
              type="button"
              className="btn px-2.5 py-1 text-xs"
              aria-describedby={noteId}
              onClick={() => update((b) => setWaived(b, state.key, false))}
              data-testid={`grant-${state.key}-unwaive`}
            >
              undo waive
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Picks this kind gets none of, left on the record by an earlier choice. */
function Leftovers({ state, readOnly, update, noun }: { state: GrantState; readOnly: boolean; update: StepProps['update']; noun: string }) {
  if (state.want > 0 || state.picked === 0 || readOnly) return null;
  return (
    <p className="flex flex-wrap items-center gap-2 text-xs text-dim">
      <span>This kind gets no {noun} from the priority; these stay from an earlier choice until removed.</span>
      <button type="button" className="btn px-2.5 py-1 text-xs" onClick={() => update((b) => clearGrant(b, state.key))} data-testid={`grant-${state.key}-clear`}>
        remove all
      </button>
    </p>
  );
}

// ---------------------------------------------------------------------------
// Granted skills
// ---------------------------------------------------------------------------

function AddGrantSkill({ p, option }: { p: GrantProps; option: MagicPriorityOption }) {
  const grant = option.skills!;
  const [choice, setChoice] = useState('');
  const selectId = useId();
  const reasonId = useId();
  const closedId = useId();
  const candidates = grantSkillCandidates(grant.pool, p.eligibility, p.build.grants.skills);
  const selected = candidates.open.find((row) => row.id === choice) ?? null;
  const refusal: Refusal | null = selected
    ? refusalOf(p.probe((b) => addGrantSkill(b, selected.id, grant.rating), `grant-skill+${selected.id}:${grant.rating}`))
    : null;
  const hint: Refusal | null = selected ? null : { reason: 'Choose a skill first.' };
  const shut = refusal ?? hint;
  return (
    <div className="space-y-2" data-testid="grant-skills-add">
      {candidates.open.length > 0 ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex min-w-0 flex-1 basis-48 flex-col gap-1">
            <label htmlFor={selectId} className="mono-label">
              Add a granted skill
            </label>
            <select
              id={selectId}
              className="w-full rounded-md border border-edge bg-deck px-2.5 py-1.5 text-sm text-ink focus:border-cyan focus:outline-none"
              value={choice}
              onChange={(e) => setChoice(e.target.value)}
              data-testid="grant-skills-select"
            >
              <option value="">choose a skill…</option>
              {candidates.open.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className={`btn px-3 py-1.5 ${shut ? 'cursor-not-allowed opacity-60' : 'btn-accent'}`}
            {...(shut ? { 'aria-disabled': true, 'aria-describedby': reasonId } : {})}
            onClick={() => {
              if (shut || !selected) return;
              p.update((b) => addGrantSkill(b, selected.id, grant.rating));
              setChoice('');
            }}
            data-testid="grant-skills-take"
            data-refused={refusal ? 'yes' : 'no'}
          >
            take at rating {grant.rating}
          </button>
        </div>
      ) : (
        <p className="text-xs text-warn">No skill this grant offers is open to this runner.</p>
      )}
      {shut && <RefusalLine id={reasonId} refusal={shut} tone={refusal ? 'refusal' : 'hint'} testId="grant-skills-refusal" />}
      {candidates.closed.length > 0 && (
        <details className="text-xs" data-testid="grant-skills-closed">
          <summary className="cursor-pointer py-2 text-dim" id={closedId}>
            Not open to this runner ({candidates.closed.length})
          </summary>
          <ul className="mt-1 space-y-1" aria-labelledby={closedId}>
            {candidates.closed.map(({ row, refusal: why }) => (
              <li key={row.id} className="flex flex-wrap items-center gap-1.5 text-faint" data-closed={row.id}>
                <span className="text-dim">{row.name}</span>
                <span>— {why.reason}</span>
                {why.ref && <RefChip refValue={why.ref} className="pointer-coarse:min-h-10" />}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export function SkillGrant({ p, option, state, issues }: { p: GrantProps; option: MagicPriorityOption | null; state: GrantState; issues: readonly Issue[] }) {
  const grant = option?.skills ?? null;
  const picked = p.build.grants.skills;
  const { whole, at } = splitByIndex(issues, 'grants.skills');
  return (
    <div className="space-y-2 border-t border-edge/60 pt-3 first:border-t-0 first:pt-0" data-testid="grant-skills" data-settled={state.settled ? 'yes' : 'no'}>
      <GrantHead title={grantSkillTitleOrDefault(option)} state={state} readOnly={p.readOnly} update={p.update} />
      {picked.length > 0 && (
        <ul className="space-y-1.5" aria-label="Granted skills">
          {picked.map((g, i) => {
            const name = activeSkillRow(g.id)?.name ?? g.id;
            return (
              <li key={`${g.id}-${i}`} className="space-y-1" data-grant-skill={g.id}>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-ink">{name}</span>
                  <span className="mono-label text-dim">rating {g.rating}</span>
                  {!p.readOnly && <RemoveButton what={`granted skill ${name}`} onRemove={() => p.update((b) => removeGrantSkill(b, i))} testId="grant-skills-remove" />}
                </div>
                <IssueNotes issues={at(i)} />
              </li>
            );
          })}
        </ul>
      )}
      {grant && grantRatingsDiffer(picked, grant.rating) && !p.readOnly && (
        <button type="button" className="btn px-2.5 py-1 text-xs" onClick={() => p.update((b) => rerateGrants(b, 'skills', grant.rating))} data-testid="grant-skills-rerate">
          set them to rating {grant.rating}
        </button>
      )}
      <Leftovers state={state} readOnly={p.readOnly} update={p.update} noun="skills" />
      {grant && option && state.open > 0 && !p.readOnly && <AddGrantSkill p={p} option={option} />}
      <IssueNotes issues={whole} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// The granted skill group (aspected magicians)
// ---------------------------------------------------------------------------

function TakeGroup({ p, id, rating }: { p: GrantProps; id: string; rating: number }) {
  const reasonId = useId();
  const name = skillGroupRow(id)?.name ?? id;
  const refusal = refusalOf(p.probe((b) => addGrantGroup(b, id, rating), `grant-group+${id}:${rating}`));
  return (
    <div className="space-y-1">
      <button
        type="button"
        className={`btn px-3 py-1.5 ${refusal ? 'cursor-not-allowed opacity-60' : 'btn-accent'}`}
        {...(refusal ? { 'aria-disabled': true, 'aria-describedby': reasonId } : {})}
        onClick={() => {
          if (!refusal) p.update((b) => addGrantGroup(b, id, rating));
        }}
        data-testid="grant-groups-take"
        data-group={id}
      >
        take the {name} group at rating {rating}
      </button>
      {refusal && <RefusalLine id={reasonId} refusal={refusal} testId="grant-groups-refusal" />}
    </div>
  );
}

export function GroupGrant({ p, option, state, issues }: { p: GrantProps; option: MagicPriorityOption | null; state: GrantState; issues: readonly Issue[] }) {
  const grant = option?.groups ?? null;
  const picked = p.build.grants.groups;
  const { whole, at } = splitByIndex(issues, 'grants.groups');
  const title = grant ? `${grant.count} magical skill ${grant.count === 1 ? 'group' : 'groups'} at rating ${grant.rating}` : 'Granted skill groups';
  const taken = new Set(picked.map((g) => g.id));
  const open = grant
    ? grant.groups.filter((id) => {
        const row = skillGroupRow(id);
        return !taken.has(id) && !!row && groupEligibilityIn(p.eligibility, row).allowed;
      })
    : [];
  const waitingOnAspect = p.build.magic.kind === 'aspected' && !p.build.magic.aspect;
  return (
    <div className="space-y-2 border-t border-edge/60 pt-3 first:border-t-0 first:pt-0" data-testid="grant-groups" data-settled={state.settled ? 'yes' : 'no'}>
      <GrantHead title={title} state={state} readOnly={p.readOnly} update={p.update} />
      {picked.length > 0 && (
        <ul className="space-y-1.5" aria-label="Granted skill groups">
          {picked.map((g, i) => {
            const name = skillGroupRow(g.id)?.name ?? g.id;
            return (
              <li key={`${g.id}-${i}`} className="space-y-1" data-grant-group={g.id}>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-ink">{name} group</span>
                  <span className="mono-label text-dim">rating {g.rating}</span>
                  {!p.readOnly && <RemoveButton what={`granted group ${name}`} onRemove={() => p.update((b) => removeGrantGroup(b, i))} testId="grant-groups-remove" />}
                </div>
                <IssueNotes issues={at(i)} />
              </li>
            );
          })}
        </ul>
      )}
      {grant && grantRatingsDiffer(picked, grant.rating) && !p.readOnly && (
        <button type="button" className="btn px-2.5 py-1 text-xs" onClick={() => p.update((b) => rerateGrants(b, 'groups', grant.rating))} data-testid="grant-groups-rerate">
          set it to rating {grant.rating}
        </button>
      )}
      <Leftovers state={state} readOnly={p.readOnly} update={p.update} noun="skill groups" />
      {grant && state.open > 0 && !p.readOnly && (
        waitingOnAspect ? (
          <p className="text-xs text-faint" data-testid="grant-groups-wait">
            Choose the aspect above: its group is the one granted.
          </p>
        ) : open.length > 0 ? (
          open.map((id) => <TakeGroup key={id} p={p} id={id} rating={grant.rating} />)
        ) : (
          <p className="text-xs text-warn">No group this grant offers is open to this runner.</p>
        )
      )}
      <IssueNotes issues={whole} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Spells, rituals and preparations
// ---------------------------------------------------------------------------

function PickList({
  picks,
  label,
  wordOf,
  onRemove,
  readOnly,
  testId,
}: {
  picks: readonly BuildPick[];
  label: string;
  wordOf: (pick: BuildPick) => string | null;
  onRemove: (index: number) => void;
  readOnly: boolean;
  testId: string;
}) {
  if (picks.length === 0) return null;
  return (
    <ul className="divide-y divide-edge/60" aria-label={label} data-testid={`${testId}-list`}>
      {picks.map((pick, i) => {
        const word = wordOf(pick);
        return (
          <li key={`${pick.catalogueId ?? pick.name}-${i}`} className="flex flex-wrap items-center gap-2 py-1.5 text-sm" data-pick={pick.name}>
            <span className="min-w-0 flex-1 basis-40 text-ink">{pick.name}</span>
            {word && <span className="mono-label text-dim">{word}</span>}
            {pick.ref && <RefChip refValue={pick.ref} className="pointer-coarse:min-h-10" />}
            {!readOnly && <RemoveButton what={pick.name} onRemove={() => onRemove(i)} testId={`${testId}-remove`} />}
          </li>
        );
      })}
    </ul>
  );
}

/** A refusal raised at the tap, kept until the next pick. */
function TapNotice({ notice, testId }: { notice: Refusal | null; testId: string }) {
  if (!notice) return null;
  return (
    <p role="alert" className="flex items-baseline gap-1.5 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn" data-testid={testId}>
      <span aria-hidden className="shrink-0">
        ⛔
      </span>
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1">
        <span>Not added: {notice.reason}</span>
        {notice.ref && <RefChip refValue={notice.ref} className="pointer-coarse:min-h-10" />}
      </span>
    </p>
  );
}

export function FormulaGrant({
  p,
  state,
  issues,
  tally,
}: {
  p: GrantProps;
  state: GrantState;
  issues: readonly Issue[];
  tally: Pick<BuildTally, 'formulae' | 'magic'>;
}) {
  const [as, setAs] = useState<LearnAs>('spells');
  const [notice, setNotice] = useState<Refusal | null>(null);
  const reasonId = useId();
  const legendId = useId();
  const groups = learnableGroups(p.build.magic);
  const canPrepare = groups.includes('spells') && groups.includes('preparations');
  const learning: LearnAs = canPrepare ? as : groups.includes('preparations') && !groups.includes('spells') ? 'preparations' : 'spells';
  const refusal =
    state.open > 0 && !p.readOnly ? refusalOf(p.probe((b) => addFormula(b, probeFormula(learning)), `formula+:${learning}`)) : null;
  const title = state.want > 0 ? `${state.want} spells, rituals or preparations` : 'Free spells, rituals and preparations';
  const counts = (['spells', 'rituals', 'preparations'] as const).map((g) => `${FORMULA_WORD[g]}s ${tally.formulae[g]}`).join(' · ');
  const cap = p.budgets.pools.spells.available;

  // Each row asked before the tap with its own category (a ritual over its cap is shut on the row).
  const rowRefusal = (hit: Parameters<typeof hitToPick>[0]): Refusal | null => {
    try {
      return formulaPickRefusal(p.probe, hitToPick(hit), learning);
    } catch (err) {
      return { reason: err instanceof Error ? err.message : String(err) };
    }
  };

  const pick = (hit: Parameters<typeof hitToPick>[0]) => {
    let candidate: BuildPick;
    try {
      candidate = learnAs(hitToPick(hit), learning);
    } catch (err) {
      setNotice({ reason: err instanceof Error ? err.message : String(err) });
      return;
    }
    const why = refusalOf(p.probe((b) => addFormula(b, candidate)));
    setNotice(why);
    if (!why) p.update((b) => addFormula(b, candidate));
  };

  return (
    <div className="space-y-2 border-t border-edge/60 pt-3 first:border-t-0 first:pt-0" data-testid="grant-spells" data-settled={state.settled ? 'yes' : 'no'}>
      <GrantHead title={title} state={state} readOnly={p.readOnly} update={p.update} />
      <p className="text-xs text-dim" data-testid="grant-spells-caps">
        Known now: {counts}.{' '}
        {cap > 0 ? `Magic ${tally.magic} lets this runner know up to ${cap} of each at creation, Karma buys included.` : ''}
      </p>
      <PickList
        picks={p.build.grants.spells}
        label="Free spells, rituals and preparations"
        wordOf={(pick) => FORMULA_WORD[formulaGroup(pick)]}
        onRemove={(i) => p.update((b) => removeFormula(b, i))}
        readOnly={p.readOnly}
        testId="grant-spells"
      />
      <Leftovers state={state} readOnly={p.readOnly} update={p.update} noun="spells" />
      {state.want > 0 && state.open === 0 && !state.over && (
        <p className="flex flex-wrap items-center gap-2 text-xs text-dim" data-testid="grant-spells-full">
          <span>Every free pick is made; more are bought with Karma in step 8.</span>
          <StepLink step={8} jump={p} />
        </p>
      )}
      {state.open > 0 && !p.readOnly && (
        <div className="space-y-2">
          {canPrepare && (
            <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1" aria-describedby={legendId}>
              <legend className="mono-label">Learn picks as</legend>
              {(['spells', 'preparations'] as const).map((value) => (
                <label key={value} className="inline-flex min-h-10 items-center gap-1.5 text-sm text-ink">
                  <input type="radio" name={`${legendId}-as`} value={value} checked={as === value} onChange={() => setAs(value)} />
                  {value === 'spells' ? 'spells (a ritual stays a ritual)' : 'alchemical preparations'}
                </label>
              ))}
              <span id={legendId} className="basis-full text-xs text-faint">
                Each kind counts against its own cap.
              </span>
            </fieldset>
          )}
          {refusal && <RefusalLine id={reasonId} refusal={refusal} testId="grant-spells-refusal" />}
          <TapNotice notice={notice} testId="grant-spells-notice" />
          <CataloguePicker
            campaignId={p.campaignId}
            kind="spell"
            label="spells and rituals"
            caps={p.settings}
            taken={takenIds(p.build.grants.spells)}
            readOnly={refusal !== null}
            rowRefusal={rowRefusal}
            onPick={pick}
            testId="spell-picker"
          />
        </div>
      )}
      <IssueNotes issues={issues} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Complex forms
// ---------------------------------------------------------------------------

export function FormGrant({ p, state, issues }: { p: GrantProps; state: GrantState; issues: readonly Issue[] }) {
  const [notice, setNotice] = useState<Refusal | null>(null);
  const reasonId = useId();
  const refusal =
    state.open > 0 && !p.readOnly ? refusalOf(p.probe((b) => addForm(b, { name: 'one more complex form' }), 'form+')) : null;
  const title = state.want > 0 ? `${state.want} complex ${state.want === 1 ? 'form' : 'forms'}` : 'Free complex forms';

  const pick = (hit: Parameters<typeof hitToPick>[0]) => {
    let candidate: BuildPick;
    try {
      candidate = hitToPick(hit);
    } catch (err) {
      setNotice({ reason: err instanceof Error ? err.message : String(err) });
      return;
    }
    const why = refusalOf(p.probe((b) => addForm(b, candidate)));
    setNotice(why);
    if (!why) p.update((b) => addForm(b, candidate));
  };

  return (
    <div className="space-y-2 border-t border-edge/60 pt-3 first:border-t-0 first:pt-0" data-testid="grant-forms" data-settled={state.settled ? 'yes' : 'no'}>
      <GrantHead title={title} state={state} readOnly={p.readOnly} update={p.update} />
      <PoolLine budgets={p.budgets} pool="forms" className="text-xs" />
      <PickList
        picks={p.build.grants.forms}
        label="Free complex forms"
        wordOf={() => null}
        onRemove={(i) => p.update((b) => removeForm(b, i))}
        readOnly={p.readOnly}
        testId="grant-forms"
      />
      <Leftovers state={state} readOnly={p.readOnly} update={p.update} noun="complex forms" />
      {state.want > 0 && state.open === 0 && !state.over && (
        <p className="flex flex-wrap items-center gap-2 text-xs text-dim" data-testid="grant-forms-full">
          <span>Every free pick is made; more are bought with Karma in step 8.</span>
          <StepLink step={8} jump={p} />
        </p>
      )}
      {state.open > 0 && !p.readOnly && (
        <div className="space-y-2">
          {refusal && <RefusalLine id={reasonId} refusal={refusal} testId="grant-forms-refusal" />}
          <TapNotice notice={notice} testId="grant-forms-notice" />
          <CataloguePicker
            campaignId={p.campaignId}
            kind="complex_form"
            caps={p.settings}
            taken={takenIds(p.build.grants.forms)}
            readOnly={refusal !== null}
            onPick={pick}
            testId="form-picker"
          />
        </div>
      )}
      <IssueNotes issues={issues} />
    </div>
  );
}

/** The grant blocks in order, for the states that show. */
export function grantOrder(states: Record<GrantKey, GrantState>): GrantKey[] {
  return (['skills', 'groups', 'spells', 'forms'] as const).filter((key) => states[key].shown);
}

export type { GrantProps };
