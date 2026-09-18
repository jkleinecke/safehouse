/**
 * Raising attributes with leftover Karma (FR3.9, docs/CHARGEN.md §4.4 Step 8
 * "raise an attribute (new × 5)… a second attribute will not reach its max").
 *
 * One row per attribute this runner has: where its rating came from (the
 * metatype's start and the points spent on step 3), what Karma has added, and
 * the natural maximum. The stepper's price for the next rating is the
 * engine's; its refusals are the validator's — past the natural maximum, a
 * second attribute at its maximum, Magic on a type that cannot use it — each
 * with its sentence and page before the tap. Magic and Resonance appear only
 * for a runner who can use them (`karmaAttributes`).
 */
import { KARMA_COSTS } from '@safehouse/rules';
import { attributeName, karmaAttributes } from './logic.js';
import { RaiseRow, Section } from './parts.js';
import type { KarmaSectionProps } from './taps.js';

export default function Attributes({ step, taps, readOnly }: KarmaSectionProps) {
  const ids = karmaAttributes(step.build, step.ratings);
  return (
    <Section
      title="Attributes"
      refValue={KARMA_COSTS.ref}
      lead="Each new rating costs five times its number. The creation maximums still hold."
      testId="karma-attributes"
    >
      <ul className="divide-y divide-edge/60" aria-label="Attributes">
        {ids.map((id) => {
          const a = step.ratings.attributes[id];
          const name = attributeName(id);
          const parts = [`${a.creation} before Karma`, ...(a.karma > 0 ? [`+${a.karma} with Karma`] : []), `natural max ${a.max}`];
          return (
            <RaiseRow
              key={id}
              name={name}
              detail={parts.join(' · ')}
              tap={taps.raise({ kind: 'attribute', id }, a.rating)}
              budgets={step.budgets}
              update={step.update}
              readOnly={readOnly}
            />
          );
        })}
      </ul>
    </Section>
  );
}
