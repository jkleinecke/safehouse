/**
 * Step 6's active skills, under their linked attributes as p. 90 lists them
 * (FR3.9, docs/CHARGEN.md §4.4 Step 6).
 *
 * Every skill is a row whatever the build holds, because a first-timer picks
 * skills by reading the list, not by knowing names to search for. What each
 * row offers is decided by the engine's answers, not by rules restated here:
 *
 * - **Rated through a bought group** (`ratings.groups`): the rating and the
 *   group's name, locked — no stepper and no specialisation, since a group
 *   cannot be broken at creation. A member still holding points of its own
 *   shows the validator's sentence and a button that gives them back.
 * - **Closed to this runner** (`skillEligibilityIn`): greyed, with the
 *   validator's own sentence and page for why — Magic skills for a mundane,
 *   Resonance skills for anyone but a technomancer, an aspected magician's
 *   other groups, Assensing without astral perception.
 * - **Granted in step 4** (`ratings.skills[].grant`): shown at the granted
 *   rating, which is locked here (the stepper will not go below it and says
 *   where to change it); points may still raise it.
 * - Otherwise a refusing stepper whose ceiling is the engine's — 6, or 7 for
 *   the Aptitude skill — with the sentence from `probe`; a specialisation
 *   slot once the skill has a rating, its price quoted from `budgets` when
 *   the field opens; a
 *   weapon or vehicle field for the three specific skills, which may be taken
 *   once per weapon or vehicle; and the dice pool play will roll, read off
 *   `preview.derived`.
 */
import { useId, type ReactNode } from 'react';
import type { Issue } from '@safehouse/contracts';
import { CREATION_SKILL_RULES, SKILL_GROUP_BY_ID } from '@safehouse/rules';
import { SplitStepper, type Refusal } from '../../components/LimitStepper.js';
import { PoolLine, WhyLink } from '../../kit/index.js';
import type { StepProps } from '../types.js';
import {
  SKILL_RAISE_CODES,
  SPEC_FLOOR_CODES,
  activeSpecPrice,
  addSpecificEntry,
  capRefusal,
  diceLabel,
  diceWords,
  fenceRefusal,
  mayPassMax,
  mainCost,
  removeActiveEntry,
  returnActivePoints,
  setActivePoints,
  setActiveSpec,
  setActiveTarget,
  skillDice,
  skillLabel,
  targetNoun,
  type EntryRef,
  type SkillEntryLine,
  type SkillLine,
  type SkillSection,
} from './model.js';
import { Badge, ClosedNote, IssueNotes, SpecSlot, TextButton, TextField } from './parts.js';

export interface ActiveSectionProps {
  props: StepProps;
  sections: readonly SkillSection[];
  issuesByIndex: ReadonlyMap<number, Issue[]>;
}

const entryKey = (line: SkillLine, entry: SkillEntryLine): string => `${line.row.id}:${entry.index ?? 'new'}`;

/** The skill's name and badges; beside the stepper when the skill has one entry, above the entries when it has several. */
function SkillHeader({ props, line }: { props: StepProps; line: SkillLine }) {
  const { row } = line;
  const idle = !line.eligibility.allowed && !line.mine;
  const dice = line.entries.length === 1 ? skillDice(props.preview.derived, row.id) : null;
  const grant = line.entries.reduce((n, e) => Math.max(n, e.grant), 0);
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
      <span className={`text-sm ${idle ? 'text-dim' : 'text-ink'}`}>{row.name}</span>
      {row.group && !line.group && <span className="text-xs text-faint">· {SKILL_GROUP_BY_ID[row.group].name} group</span>}
      {grant > 0 && (
        <Badge tone="text-magenta" testId="skill-grant">
          <span aria-hidden>🔒 </span>granted {grant}
        </Badge>
      )}
      {dice && (
        <Badge tone="text-cyan" spoken={diceLabel(dice)} testId="skill-dice">
          {diceWords(dice)}
        </Badge>
      )}
    </div>
  );
}

function EntryControls({
  props,
  line,
  entry,
  issues,
  removable,
  header,
}: {
  props: StepProps;
  line: SkillLine;
  entry: SkillEntryLine;
  issues: readonly Issue[];
  removable: boolean;
  /** The row's name, sharing the stepper's line (a skill with one entry). */
  header: ReactNode;
}) {
  const { row } = line;
  const readOnly = props.readOnly;
  const ref: EntryRef = { id: row.id, index: entry.index };
  const key = entryKey(line, entry);
  const label = skillLabel(row, entry.target);
  const closed = !line.eligibility.allowed;

  // Rated through a bought group: locked, unless this entry still holds points of its own.
  if (line.group) {
    const conflict = entry.index !== null && (entry.points > 0 || entry.spec.trim() !== '');
    return (
      <div className="space-y-1" data-testid="skill-locked">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          {header}
          <span className="text-xs text-dim">
            <span aria-hidden>🔒 </span>
            Rated {line.group.rating} through the {line.group.name} group.
          </span>
        </div>
        {conflict && entry.index !== null && !readOnly && (
          <TextButton
            onClick={() => props.update((b) => returnActivePoints(b, entry.index!))}
            label={`give back ${label}'s own points`}
            testId="skill-return-points"
          >
            give back its points
          </TextButton>
        )}
        <IssueNotes issues={issues} />
      </div>
    );
  }

  const fence = closed ? fenceRefusal(line.eligibility, row.name, props.build) : null;

  // Closed and holding nothing: say why, quietly, offer nothing.
  if (closed && entry.own === 0 && entry.total === 0 && entry.index === null) {
    return (
      <div className="space-y-1">
        {header}
        {fence && <ClosedNote refusal={fence} testId="skill-closed" />}
      </div>
    );
  }

  // Only a rank that could pass the engine's maximum is worth validating the build for.
  const raise: Refusal | null =
    fence ??
    (mayPassMax(entry.total, entry.max)
      ? capRefusal(props.probe((b) => setActivePoints(b, ref, entry.points + 1), `skill+:${key}`), SKILL_RAISE_CODES, props.allIssues, `at ${entry.max}`)
      : null);
  const floor: Refusal | null =
    entry.grant > 0 && entry.points === 0
      ? { reason: `${entry.grant} of ${row.name} was granted in step 4; change it there.` }
      : entry.points > 0 && entry.spec.trim()
        ? capRefusal(props.probe((b) => setActivePoints(b, ref, entry.points - 1), `skill-:${key}`), SPEC_FLOOR_CODES, props.allIssues)
        : null;

  return (
    <SplitStepper
      label={label}
      hideLabel
      value={entry.own}
      min={entry.grant}
      onChange={(v) => props.update((b) => setActivePoints(b, ref, v - entry.grant))}
      refuseIncrease={raise}
      {...(floor ? { refuseDecrease: floor } : {})}
      readOnly={readOnly}
    >
      {({ controls, refusal }) => (
    <div className="space-y-1.5" data-testid="skill-entry" data-entry={entry.index ?? 'new'}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        {header}
        {row.specific && (
          <TextField
            label={`${targetNoun(row) === 'vehicle' ? 'Vehicle' : 'Weapon'} for ${row.name}`}
            value={entry.target}
            onChange={(text) => props.update((b) => setActiveTarget(b, ref, text))}
            readOnly={readOnly}
            hint={`which ${targetNoun(row)}?`}
            className="min-w-[10rem] flex-1"
            testId="skill-target"
          />
        )}
        <div className="flex flex-wrap items-center gap-2" data-testid="skill-stepper">
          {controls}
          {removable && !readOnly && entry.index !== null && (
            <TextButton onClick={() => props.update((b) => removeActiveEntry(b, entry.index!))} label={`remove ${label}`} tone="danger" testId="skill-remove">
              remove
            </TextButton>
          )}
        </div>
      </div>
      {refusal}
      {entry.karma > 0 && (
        <p className="text-xs text-dim" data-testid="skill-karma">
          Raised to {entry.total} with Karma in step 8.
        </p>
      )}
      <SpecSlot
        name={label}
        spec={entry.spec}
        rated={entry.own > 0}
        readOnly={readOnly}
        onChange={(text) => props.update((b) => setActiveSpec(b, ref, text))}
        price={() => mainCost(activeSpecPrice(props.build, props.settings, props.budgets, ref))}
        budgets={props.budgets}
        testId="skill-spec"
      />
      <IssueNotes issues={issues} />
    </div>
      )}
    </SplitStepper>
  );
}

export function SkillRow({ props, line, issuesByIndex }: { props: StepProps; line: SkillLine; issuesByIndex: ReadonlyMap<number, Issue[]> }) {
  const { row } = line;
  const closed = !line.eligibility.allowed;
  const idle = closed && !line.mine;
  // One entry: the name shares the stepper's line. Several (one per weapon or vehicle): the name heads them.
  const inline = line.entries.length === 1 && !row.specific;
  const header = <SkillHeader props={props} line={line} />;
  const canAddAnother = row.specific && !props.readOnly && !closed && line.entries.every((e) => e.index !== null && e.target.trim() !== '');
  return (
    <li
      className={`space-y-1.5 p-2.5 ${idle ? 'opacity-70' : ''}`}
      data-testid="skill-row"
      data-skill={row.id}
      data-mine={line.mine ? 'yes' : 'no'}
      data-closed={closed ? 'yes' : 'no'}
    >
      {!inline && header}
      {line.entries.map((entry, position) => (
        <EntryControls
          // By position, so a first keystroke that turns the empty slot into an entry keeps the field (and its focus).
          key={position}
          props={props}
          line={line}
          entry={entry}
          issues={entry.index !== null ? (issuesByIndex.get(entry.index) ?? []) : []}
          removable={row.specific || line.entries.length > 1}
          header={inline ? header : null}
        />
      ))}
      {canAddAnother && (
        <TextButton onClick={() => props.update((b) => addSpecificEntry(b, row.id))} label={`add another ${targetNoun(row)} for ${row.name}`} testId="skill-add-target">
          + another {targetNoun(row)}
        </TextButton>
      )}
    </li>
  );
}

export default function ActiveSection({ props, sections, issuesByIndex }: ActiveSectionProps) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="space-y-2" data-testid="skills-active">
      <h2 id={headingId} className="text-base font-semibold text-ink">
        Active skills
      </h2>
      <PoolLine budgets={props.budgets} pool="skills" />
      <p className="flex flex-wrap items-center gap-x-2 text-sm text-dim">
        <span>
          A rank costs a skill point and a specialisation one more. No skill starts above {CREATION_SKILL_RULES.maxRating} unless a quality
          lifts it.
        </span>
        <WhyLink refValue={CREATION_SKILL_RULES.ref} />
      </p>
      {sections.length === 0 ? (
        <p className="text-sm text-faint" data-testid="skills-none">
          No skill matches.
        </p>
      ) : (
        sections.map((section) => (
          <div key={section.attr} className="space-y-1.5" data-testid="skill-section" data-attr={section.attr}>
            <h3 className="mono-label text-cyan">
              {section.title} <span className="text-faint">· {section.short}</span>
            </h3>
            <ul className="divide-y divide-edge rounded-md border border-edge bg-deck" aria-label={`${section.title} skills`}>
              {section.lines.map((line) => (
                <SkillRow key={line.row.id} props={props} line={line} issuesByIndex={issuesByIndex} />
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}
