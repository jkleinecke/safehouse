/**
 * Step 6's skill groups, first as p. 90 puts them (FR3.9, docs/CHARGEN.md
 * §4.4 Step 6).
 *
 * Group points buy only groups, and a group bought at N rates every skill in
 * it at N — which is why the groups come before the skills: a player who
 * spends skill points on Pistols and then buys Firearms has paid twice. Each
 * row is the engine's answer laid out: the group's rating and any grant from
 * step 4 (`ratings.groups`), whether the runner may own it at all
 * (`groupEligibilityIn` — a closed group is shown greyed with the
 * validator's own sentence, never hidden), and what raising it would break
 * (`probe`, refused only on the group's own cap or fence, and asked only
 * of a group one rank from that cap). When a member
 * still holds points of its own, the row says so before the group is bought.
 */
import { useId } from 'react';
import type { Issue } from '@safehouse/contracts';
import { CREATION_SKILL_RULES } from '@safehouse/rules';
import { useLimitStepper } from '../../components/LimitStepper.js';
import { PoolLine, WhyLink } from '../../kit/index.js';
import type { StepProps } from '../types.js';
import {
  GROUP_RAISE_CODES,
  capRefusal,
  fenceRefusal,
  mayPassMax,
  holdersLine,
  membersWithOwnPoints,
  setGroupPoints,
  type GroupLine,
  type SkillSection,
} from './model.js';
import { Badge, ClosedNote, IssueNotes } from './parts.js';

export interface GroupsSectionProps {
  props: StepProps;
  lines: readonly GroupLine[];
  /** Every skill section, unfiltered — to find members holding points of their own. */
  sections: readonly SkillSection[];
  issuesByIndex: ReadonlyMap<number, Issue[]>;
}

export function GroupRow({ props, line, sections, issues }: { props: StepProps; line: GroupLine; sections: readonly SkillSection[]; issues: readonly Issue[] }) {
  const { row, eligibility, rating, own, grant, karma } = line;
  const readOnly = props.readOnly;
  const closed = !eligibility.allowed;
  const points = rating?.points ?? 0;
  const fence = closed ? fenceRefusal(eligibility, row.name, props.build) : null;
  const max = CREATION_SKILL_RULES.maxRating;
  const raise =
    !fence && mayPassMax(rating?.rating ?? own, max)
      ? capRefusal(props.probe((b) => setGroupPoints(b, row.id, points + 1), `group+:${row.id}`), GROUP_RAISE_CODES, props.allIssues, `at ${max}`)
      : null;
  const holders = own === 0 && !closed ? membersWithOwnPoints(row, sections) : [];
  const showStepper = !closed || own > 0;
  const { controls, refusal } = useLimitStepper({
    label: `${row.name} group`,
    hideLabel: true,
    value: own,
    min: grant,
    onChange: (v) => props.update((b) => setGroupPoints(b, row.id, v - grant)),
    refuseIncrease: fence ?? raise,
    ...(grant > 0 && own === grant ? { refuseDecrease: { reason: `${grant} of this group was granted in step 4; change it there.` } } : {}),
    readOnly,
  });

  return (
    <li
      className={`p-2.5 ${closed && own === 0 ? 'opacity-70' : ''}`}
      data-testid="group-row"
      data-group={row.id}
      data-mine={line.mine ? 'yes' : 'no'}
      data-closed={closed ? 'yes' : 'no'}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`text-sm ${closed ? 'text-dim' : 'text-ink'}`}>{row.name}</span>
            {grant > 0 && (
              <Badge tone="text-magenta" testId="group-grant">
                granted {grant}
              </Badge>
            )}
            {karma > 0 && <Badge testId="group-karma">+{karma} Karma</Badge>}
          </div>
          <p className="mt-0.5 text-xs text-faint">{line.memberNames.join(', ')}</p>
        </div>
        {showStepper && (
          <div className="shrink-0" data-testid="group-stepper">
            {controls}
          </div>
        )}
      </div>
      {showStepper && refusal}
      {!showStepper && fence && <ClosedNote refusal={fence} testId="group-closed" />}
      {holders.length > 0 && !readOnly && (
        <p className="mt-1 text-xs text-dim" data-testid="group-holders">
          {holdersLine(holders)}
        </p>
      )}
      <IssueNotes issues={issues} />
    </li>
  );
}

export default function GroupsSection({ props, lines, sections, issuesByIndex }: GroupsSectionProps) {
  const headingId = useId();
  const total = props.budgets.pools.groups;
  return (
    <section aria-labelledby={headingId} className="space-y-2" data-testid="skills-groups">
      <h2 id={headingId} className="text-base font-semibold text-ink">
        Skill groups
      </h2>
      <PoolLine budgets={props.budgets} pool="groups" />
      <p className="flex flex-wrap items-center gap-x-2 text-sm text-dim">
        <span>
          A group rates every skill in it at once, and its skills take no points or specialisation of their own here. Karma in step 8
          can specialise one, but that stops the group being raised as a group.
          {total.available === 0 ? ' This priority gives no group points.' : ''}
        </span>
        <WhyLink refValue={CREATION_SKILL_RULES.ref} />
      </p>
      {lines.length === 0 ? (
        <p className="text-sm text-faint" data-testid="groups-none">
          No group matches.
        </p>
      ) : (
        <ul className="divide-y divide-edge rounded-md border border-edge bg-deck" aria-label="Skill groups" data-testid="group-list">
          {lines.map((line) => (
            <GroupRow
              key={line.row.id}
              props={props}
              line={line}
              sections={sections}
              issues={line.indices.flatMap((i) => issuesByIndex.get(i) ?? [])}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
