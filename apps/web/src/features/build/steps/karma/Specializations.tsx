/**
 * A specialisation bought with leftover Karma (FR3.9, docs/CHARGEN.md §4.4
 * Step 8 "a specialisation (7)").
 *
 * Any rated active skill, knowledge skill or language can take one: pick it,
 * name the specialisation, and the button quotes the engine's price — 7, or
 * double on a skill Uncouth or Uneducated covers, which `spendKarma` answers
 * — before it is pressed. The validator refuses a second specialisation on
 * one skill at creation, and a group, with its sentence and page; the
 * refusal shows as soon as the skill is picked, before any name is typed.
 * Specialisations already held are listed on each skill's row above and in
 * the ledger, where they are undone.
 */
import { useId, useState } from 'react';
import { KARMA_COSTS } from '@safehouse/rules';
import { specSpend, specTargets, withSpend, type TapGate } from './logic.js';
import { EmptyLine, Section, TapButton, WAITING, inputClass, labelClass } from './parts.js';
import type { KarmaSectionProps } from './taps.js';

/** The name a specialisation is probed with before the player has typed one: only its skill decides what it breaks. */
const PROBE_NAME = 'specialisation';

export default function Specializations({ step, taps, readOnly }: KarmaSectionProps) {
  const [value, setValue] = useState('');
  const [spec, setSpec] = useState('');
  const targetId = useId();
  const specId = useId();
  if (readOnly) return null;
  const targets = specTargets(step.ratings);
  const target = targets.find((t) => t.value === value) ?? null;
  const trimmed = spec.trim();
  // Probe the skill with a stand-in name, so a refusal shows before typing.
  const probeTap = target ? taps.add(specSpend(target, PROBE_NAME), `spec:${target.value}`) : null;
  const gate: TapGate = probeTap?.gate ?? WAITING;
  // A refusal the skill already earns shows before any name is typed.
  const hint = !target ? 'Choose a skill first.' : gate.open && trimmed === '' ? 'Name the specialisation first.' : null;
  return (
    <Section
      title="Specializations"
      refValue={KARMA_COSTS.ref}
      lead="One specialisation per skill at creation."
      testId="karma-specs"
    >
      {targets.length === 0 ? (
        <EmptyLine>A specialisation needs a rated skill to go on.</EmptyLine>
      ) : (
        <div className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label htmlFor={targetId} className={labelClass}>
                skill
              </label>
              <select id={targetId} className={inputClass} value={value} onChange={(e) => setValue(e.target.value)}>
                <option value="">choose a skill</option>
                {targets.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={specId} className={labelClass}>
                specialisation
              </label>
              <input id={specId} className={inputClass} value={spec} maxLength={200} onChange={(e) => setSpec(e.target.value)} />
            </div>
          </div>
          <TapButton
            label="add"
            ariaLabel={target && trimmed ? `add ${trimmed} to ${target.label}` : 'add the specialisation'}
            gate={gate}
            hint={hint}
            price={probeTap?.price ?? null}
            budgets={step.budgets}
            readOnly={readOnly}
            testId="karma-add-spec"
            onPress={() => {
              if (!target || !trimmed) return;
              const spend = specSpend(target, trimmed);
              step.update((b) => withSpend(b, spend));
              // Start the next one from nothing: the skill just specialised is no longer offered.
              setSpec('');
              setValue('');
            }}
          />
        </div>
      )}
    </Section>
  );
}
