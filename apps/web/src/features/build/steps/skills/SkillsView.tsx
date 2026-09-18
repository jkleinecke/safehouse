/**
 * The Skills screen's body, stateless (FR3.9, docs/CHARGEN.md §4.4 Step 6).
 *
 * Everything the screen shows comes in as `StepProps`; the only state of its
 * own — the search text and "show only mine" — comes in as `filter` with its
 * setter, so `renderToStaticMarkup` can draw any state a test names and the
 * live wrapper (`../Skills.tsx`) owns nothing but those two values.
 *
 * Order follows p. 90 and the brief: the numbers step 2 chose, the search
 * bar a phone needs to reach one skill out of seventy-five, the groups (whose
 * pool is spent first), the active skills under their attributes, knowledge
 * and languages with their own pool — the rows closed to this runner folded
 * into one list between them (`splitClosed`) — and last anything the validator filed
 * under this step that has no row of its own — so no finding is dropped
 * between the rail's list and this screen.
 */
import { useId } from 'react';
import type { StepProps } from '../types.js';
import ActiveSection, { SkillRow } from './ActiveSection.js';
import GroupsSection, { GroupRow } from './GroupsSection.js';
import KnowledgeSection from './KnowledgeSection.js';
import {
  closedLine,
  countLines,
  filterCountLine,
  filterGroups,
  filterSections,
  groupLines,
  placeIssues,
  priorityLineFor,
  skillSections,
  splitClosed,
  withUnshownInRest,
  type SkillFilter,
} from './model.js';
import { IssueNotes, TextButton } from './parts.js';

export interface SkillsViewProps extends StepProps {
  filter: SkillFilter;
  onFilter: (next: SkillFilter) => void;
}

export default function SkillsView(props: SkillsViewProps) {
  const { build, budgets, ratings, eligibility, filter, onFilter } = props;
  const searchId = useId();
  const countId = useId();
  const restId = useId();
  const closedId = useId();

  const allGroups = groupLines(build, ratings, eligibility);
  const allSections = skillSections(build, ratings, eligibility);
  const groups = filterGroups(allGroups, filter);
  const sections = filterSections(allSections, filter);
  const placed = withUnshownInRest(placeIssues(props.issues), allSections, allGroups);
  const shown = { skills: countLines(sections), groups: groups.length };
  const total = { skills: countLines(allSections), groups: allGroups.length };
  const filtering = filter.query.trim() !== '' || filter.onlyMine;
  const nothing = shown.skills === 0 && shown.groups === 0;
  const split = splitClosed(groups, sections);
  const closedCount = split.closedSkills.length + split.closedGroups.length;

  return (
    <div className="space-y-5" data-testid="skills-step">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-dim" data-testid="skills-priority">
        <span>{priorityLineFor(build.priorities.skills, budgets.pools.skills, budgets.pools.groups)}</span>
        {!build.priorities.skills && !props.readOnly && (
          <TextButton onClick={() => props.goTo(2)} testId="skills-go-priorities">
            set priorities in step 2
          </TextButton>
        )}
      </div>

      <div className="space-y-1.5 rounded-md border border-edge bg-deck p-2.5" role="search" data-testid="skills-filter">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <label htmlFor={searchId} className="sr-only">
            Find a skill or group
          </label>
          <input
            id={searchId}
            type="search"
            className="min-w-[12rem] flex-1 rounded-md border border-edge bg-panel px-2.5 py-1.5 text-sm text-ink placeholder:text-faint focus:border-cyan focus:outline-none"
            placeholder="find a skill or group"
            value={filter.query}
            aria-describedby={countId}
            onChange={(e) => onFilter({ ...filter, query: e.target.value })}
            data-testid="skills-search"
          />
          <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              className="h-5 w-5 accent-cyan"
              checked={filter.onlyMine}
              onChange={(e) => onFilter({ ...filter, onlyMine: e.target.checked })}
              data-testid="skills-only-mine"
            />
            show only mine
          </label>
        </div>
        <p id={countId} className="text-xs text-faint" role="status" aria-live="polite" data-testid="skills-count">
          {filterCountLine(shown, total)}
          {filter.query.trim() ? ' · the knowledge skills and languages below are not searched' : ''}
        </p>
        {nothing && filtering && (
          <div className="flex flex-wrap items-center gap-2 text-sm text-dim" data-testid="skills-filter-empty">
            <span>
              {filter.onlyMine && filter.query.trim() === ''
                ? 'No skill or group is bought for this runner.'
                : `No skill or group matches “${filter.query.trim()}”${filter.onlyMine ? ' among this runner’s own' : ''}.`}
            </span>
            <TextButton onClick={() => onFilter({ query: '', onlyMine: false })} testId="skills-filter-clear">
              show every skill
            </TextButton>
          </div>
        )}
      </div>

      <GroupsSection props={props} lines={split.groups} sections={allSections} issuesByIndex={placed.groups} />
      <ActiveSection props={props} sections={split.sections} issuesByIndex={placed.active} />

      {closedCount > 0 && (
        <section aria-labelledby={closedId} className="space-y-2" data-testid="skills-closed">
          <h2 id={closedId} className="text-base font-semibold text-ink">
            Closed to this runner
          </h2>
          <p className="text-sm text-dim">{closedLine(split.closedSkills.length, split.closedGroups.length)}</p>
          <details className="rounded-md border border-edge bg-deck" {...(filter.query.trim() ? { open: true } : {})}>
            <summary className="flex min-h-10 cursor-pointer items-center px-3 text-sm text-dim hover:text-cyan">show them and why</summary>
            {split.closedGroups.length > 0 && (
              <ul className="divide-y divide-edge border-t border-edge" aria-label="Skill groups closed to this runner">
                {split.closedGroups.map((line) => (
                  <GroupRow key={line.row.id} props={props} line={line} sections={allSections} issues={[]} />
                ))}
              </ul>
            )}
            {split.closedSkills.length > 0 && (
              <ul className="divide-y divide-edge border-t border-edge" aria-label="Skills closed to this runner">
                {split.closedSkills.map((line) => (
                  <SkillRow key={line.row.id} props={props} line={line} issuesByIndex={placed.active} />
                ))}
              </ul>
            )}
          </details>
        </section>
      )}
      <KnowledgeSection
        props={props}
        knowledgeIssues={placed.knowledge}
        languageIssues={placed.languages}
        languageListIssues={placed.languageList}
      />

      {placed.rest.length > 0 && (
        <section aria-labelledby={restId} className="space-y-1.5" data-testid="skills-rest">
          <h2 id={restId} className="text-base font-semibold text-ink">
            Also on this step
          </h2>
          <IssueNotes issues={placed.rest} testId="skills-rest-issues" />
        </section>
      )}
    </div>
  );
}
