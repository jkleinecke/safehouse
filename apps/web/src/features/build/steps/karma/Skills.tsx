/**
 * Raising and learning active skills and skill groups with leftover Karma
 * (FR3.9, docs/CHARGEN.md §4.4 Step 8 "a skill (new × 2), a group (new × 5)…
 * a skill will not go to 7").
 *
 * The rated skills and groups each get a raise row: the rating the earlier
 * steps gave, what Karma added, and a stepper whose refusals are the
 * validator's — past 6 (7 with Aptitude), a group whose skills no longer sit
 * at one rating, a magical skill on a mundane. A skill rated through its
 * group says that raising it on its own breaks the group, because the engine
 * does exactly that when it applies the raise. Below each list, learning a
 * new one: a pick from what this runner may take (the engine's eligibility),
 * the weapon or vehicle a specific skill names, and a button quoting the
 * price at rating 1 before it is pressed.
 */
import { useId, useState } from 'react';
import { KARMA_COSTS, activeSkillRow } from '@safehouse/rules';
import { groupName, learnableGroups, learnableSkills, skillName } from './logic.js';
import { EmptyLine, RaiseRow, Section, SubHeading, TapButton, WAITING, inputClass, labelClass } from './parts.js';
import type { KarmaSectionProps } from './taps.js';

function LearnSkill({ step, taps, readOnly }: KarmaSectionProps) {
  const [id, setId] = useState('');
  const [target, setTarget] = useState('');
  const selectId = useId();
  const targetId = useId();
  if (readOnly) return null;
  const options = [...learnableSkills(step.ratings, step.eligibility)].sort((a, b) => a.name.localeCompare(b.name));
  const row = id ? activeSkillRow(id) : null;
  const needsTarget = row?.specific === true;
  const ready = row !== null && (!needsTarget || target.trim() !== '');
  const tap = ready ? taps.raise({ kind: 'skill', id: row.id, ...(needsTarget ? { target: target.trim() } : {}) }, 0) : null;
  const hint = tap ? null : row ? 'Name the weapon or vehicle it is for first.' : 'Choose a skill first.';
  return (
    <div className="space-y-2" data-testid="karma-learn-skill">
      <SubHeading>Learn a new skill</SubHeading>
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label htmlFor={selectId} className={labelClass}>
            skill
          </label>
          <select id={selectId} className={inputClass} value={id} onChange={(e) => setId(e.target.value)}>
            <option value="">choose a skill</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
        {needsTarget && (
          <div>
            <label htmlFor={targetId} className={labelClass}>
              weapon or vehicle
            </label>
            <input id={targetId} className={inputClass} value={target} maxLength={200} onChange={(e) => setTarget(e.target.value)} />
          </div>
        )}
      </div>
      <TapButton
        label="learn at 1"
        ariaLabel={row ? `learn ${skillName(row.id, target)} at rating 1` : 'learn the chosen skill at rating 1'}
        gate={tap?.gate ?? WAITING}
        hint={hint}
        price={tap?.price ?? null}
        budgets={step.budgets}
        readOnly={readOnly}
        testId="karma-learn-skill-button"
        onPress={() => {
          if (!tap) return;
          step.update(tap.up);
          setId('');
          setTarget('');
        }}
      />
    </div>
  );
}

function LearnGroup({ step, taps, readOnly }: KarmaSectionProps) {
  const [id, setId] = useState('');
  const selectId = useId();
  if (readOnly) return null;
  const options = [...learnableGroups(step.ratings, step.eligibility)].sort((a, b) => a.name.localeCompare(b.name));
  if (options.length === 0) return null;
  const tap = id ? taps.raise({ kind: 'group', id }, 0) : null;
  return (
    <div className="space-y-2" data-testid="karma-learn-group">
      <SubHeading>Learn a new group</SubHeading>
      <div>
        <label htmlFor={selectId} className={labelClass}>
          skill group
        </label>
        <select id={selectId} className={inputClass} value={id} onChange={(e) => setId(e.target.value)}>
          <option value="">choose a group</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </div>
      <TapButton
        label="learn at 1"
        ariaLabel={id ? `learn the ${groupName(id)} group at rating 1` : 'learn the chosen group at rating 1'}
        gate={tap?.gate ?? WAITING}
        hint={tap ? null : 'Choose a group first.'}
        price={tap?.price ?? null}
        budgets={step.budgets}
        readOnly={readOnly}
        testId="karma-learn-group-button"
        onPress={() => {
          if (!tap) return;
          step.update(tap.up);
          setId('');
        }}
      />
    </div>
  );
}

export default function Skills(section: KarmaSectionProps) {
  const { step, taps, readOnly } = section;
  const skills = step.ratings.skills.filter((s) => s.rating > 0);
  const groups = step.ratings.groups.filter((g) => g.rating > 0);
  return (
    <Section
      title="Active skills"
      refValue={KARMA_COSTS.ref}
      lead="A skill's new rating costs twice its number, a group's five times. No skill or group goes past the creation maximum."
      testId="karma-skills"
    >
      {skills.length === 0 ? (
        <EmptyLine>No active skills are rated yet.</EmptyLine>
      ) : (
        <ul className="divide-y divide-edge/60" aria-label="Active skills">
          {skills.map((s) => {
            const name = skillName(s.id, s.target);
            const detail = [
              s.group ? `${s.creation} through its group` : `${s.creation} before Karma`,
              ...(s.karma > 0 ? [`+${s.karma} with Karma`] : []),
              `max ${s.max}`,
              ...(s.specs.length > 0 ? [`specialised: ${s.specs.join(', ')}`] : []),
            ].join(' · ');
            return (
              <RaiseRow
                key={`${s.id}|${s.target ?? ''}`}
                name={name}
                detail={detail}
                tap={taps.raise({ kind: 'skill', id: s.id, ...(s.target ? { target: s.target } : {}) }, s.rating)}
                budgets={step.budgets}
                update={step.update}
                readOnly={readOnly}
              >
                {s.group && !readOnly && (
                  <p className="text-xs text-faint" data-testid="karma-group-note">
                    Raising it on its own breaks the {groupName(s.group)} group.
                  </p>
                )}
              </RaiseRow>
            );
          })}
        </ul>
      )}
      <LearnSkill {...section} />

      <SubHeading>Skill groups</SubHeading>
      {groups.length === 0 ? (
        <EmptyLine>No skill groups are rated yet.</EmptyLine>
      ) : (
        <ul className="divide-y divide-edge/60" aria-label="Skill groups" data-testid="karma-groups">
          {groups.map((g) => (
            <RaiseRow
              key={g.id}
              name={`${groupName(g.id)} group`}
              detail={[`${g.creation} before Karma`, ...(g.karma > 0 ? [`+${g.karma} with Karma`] : [])].join(' · ')}
              tap={taps.raise({ kind: 'group', id: g.id }, g.rating)}
              budgets={step.budgets}
              update={step.update}
              readOnly={readOnly}
            />
          ))}
        </ul>
      )}
      <LearnGroup {...section} />
    </Section>
  );
}
