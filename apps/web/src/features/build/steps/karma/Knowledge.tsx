/**
 * Knowledge skills and languages bought with leftover Karma (FR3.9,
 * docs/CHARGEN.md §4.4 Step 8 "a knowledge or language (new × 1)").
 *
 * The same raise rows as the active skills — the rating step 6 gave, what
 * Karma added, a stepper refusing past the creation maximum with the
 * validator's sentence — and two small forms for a knowledge skill or
 * language the runner does not have yet. A new knowledge skill always asks
 * for its category: the engine prices Uneducated's doubling off it and the
 * validator wants it, so the form never leaves the player a warning to come
 * back for. A name already on the runner is refused in words, pointing at
 * its row instead. Native languages have no rating and are not listed.
 */
import { useId, useState } from 'react';
import { KNOWLEDGE_CATEGORIES, type KnowledgeCategory } from '@safehouse/contracts';
import { KARMA_COSTS } from '@safehouse/rules';
import { knownName, type TapGate } from './logic.js';
import { EmptyLine, RaiseRow, Section, SubHeading, TapButton, WAITING, inputClass, labelClass } from './parts.js';
import type { KarmaSectionProps } from './taps.js';

const refused = (reason: string): TapGate => ({ open: false, refusal: { reason }, consequences: [] });

function LearnKnowledge({ step, taps, readOnly, list }: KarmaSectionProps & { list: 'knowledge' | 'language' }) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState<KnowledgeCategory>('street');
  const nameId = useId();
  const categoryId = useId();
  if (readOnly) return null;
  const trimmed = name.trim();
  const noun = list === 'knowledge' ? 'knowledge skill' : 'language';
  const known = trimmed !== '' && knownName(step.ratings, list, trimmed);
  const tap =
    trimmed && !known
      ? taps.raise(list === 'knowledge' ? { kind: 'knowledge', name: trimmed, category } : { kind: 'language', name: trimmed }, 0)
      : null;
  const gate = tap?.gate ?? (known ? refused(`${trimmed} is already on this runner; raise it in the list above.`) : WAITING);
  const hint = trimmed === '' ? `Name the ${noun} first.` : null;
  return (
    <div className="space-y-2" data-testid={`karma-learn-${list}`}>
      <SubHeading>{list === 'knowledge' ? 'Learn a new knowledge skill' : 'Learn a new language'}</SubHeading>
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label htmlFor={nameId} className={labelClass}>
            {noun}
          </label>
          <input id={nameId} className={inputClass} value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
        </div>
        {list === 'knowledge' && (
          <div>
            <label htmlFor={categoryId} className={labelClass}>
              category
            </label>
            <select id={categoryId} className={inputClass} value={category} onChange={(e) => setCategory(e.target.value as KnowledgeCategory)}>
              {KNOWLEDGE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      <TapButton
        label="learn at 1"
        ariaLabel={trimmed ? `learn ${trimmed} at rating 1` : `learn the named ${noun} at rating 1`}
        gate={gate}
        hint={hint}
        price={tap?.price ?? null}
        budgets={step.budgets}
        readOnly={readOnly}
        testId={`karma-learn-${list}-button`}
        onPress={() => {
          if (!tap) return;
          step.update(tap.up);
          setName('');
        }}
      />
    </div>
  );
}

export default function Knowledge(section: KarmaSectionProps) {
  const { step, taps, readOnly } = section;
  const knowledge = step.ratings.knowledge.filter((k) => k.name);
  const languages = step.ratings.languages.filter((l) => l.name && !l.native);
  const natives = step.ratings.languages.filter((l) => l.name && l.native);
  return (
    <Section
      title="Knowledge and languages"
      refValue={KARMA_COSTS.ref}
      lead="Each new rating costs its own number in Karma, so a new one at rating 1 costs 1."
      testId="karma-knowledge"
    >
      {knowledge.length === 0 ? (
        <EmptyLine>No knowledge skills yet.</EmptyLine>
      ) : (
        <ul className="divide-y divide-edge/60" aria-label="Knowledge skills">
          {knowledge.map((k) => (
            <RaiseRow
              key={k.name}
              name={k.name}
              detail={[
                k.category ?? 'no category',
                `${k.creation} before Karma`,
                ...(k.karma > 0 ? [`+${k.karma} with Karma`] : []),
                ...(k.specs.length > 0 ? [`specialised: ${k.specs.join(', ')}`] : []),
              ].join(' · ')}
              tap={taps.raise({ kind: 'knowledge', name: k.name, ...(k.category ? { category: k.category } : {}) }, k.rating)}
              budgets={step.budgets}
              update={step.update}
              readOnly={readOnly}
            />
          ))}
        </ul>
      )}
      <LearnKnowledge {...section} list="knowledge" />

      <SubHeading>Languages</SubHeading>
      {natives.length > 0 && (
        <p className="text-xs text-faint" data-testid="karma-native-languages">
          Native: {natives.map((l) => l.name).join(', ')}
        </p>
      )}
      {languages.length === 0 ? (
        <EmptyLine>No rated languages yet.</EmptyLine>
      ) : (
        <ul className="divide-y divide-edge/60" aria-label="Languages">
          {languages.map((l) => (
            <RaiseRow
              key={l.name}
              name={l.name}
              detail={[`${l.creation} before Karma`, ...(l.karma > 0 ? [`+${l.karma} with Karma`] : [])].join(' · ')}
              tap={taps.raise({ kind: 'language', name: l.name }, l.rating)}
              budgets={step.budgets}
              update={step.update}
              readOnly={readOnly}
            />
          ))}
        </ul>
      )}
      <LearnKnowledge {...section} list="language" />
    </Section>
  );
}
