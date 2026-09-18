/**
 * The choices Step 4 makes once: the kind, an aspected magician's aspect, the
 * tradition and the mentor spirit (FR3.9, docs/CHARGEN.md §4.4 Step 4: "the
 * type picker is gated by the column … Tradition (drain attributes) and
 * mentor spirit are picked here; an aspected magician chooses their one group
 * and the walkthrough states that the other two are closed to them for good").
 *
 * The kind is a radio group of cards (`ChoiceCards`) with every kind in it,
 * mundane included: a kind the Magic row does not offer stays on screen,
 * greyed, with the validator's sentence and page, so a player at priority D
 * learns why the magician they wanted is not there instead of wondering
 * whether it exists. Each card says what the row gives that kind in numbers.
 *
 * The aspect states its consequence before it is taken, not after. The
 * tradition cards carry their Drain pair as this runner's numbers ("Logic 4 +
 * Willpower 5 = 9"), read from the derived character play will use. The
 * mentor spirit is typed, with its page, and says plainly that naming one
 * here does nothing until the quality is taken in step 5.
 */
import { useId } from 'react';
import type { AttributeCode, Issue, MagicAspect, MagicKind, MagicTradition } from '@safehouse/contracts';
import { MAGIC_KIND_TABLE, QUALITY_RULE_BY_ID, qualityEffects, type MagicPriorityOption } from '@safehouse/rules';
import ChoiceCards, { type Choice } from '../../kit/ChoiceCards.js';
import WhyLink from '../../kit/WhyLink.js';
import type { StepProps } from '../types.js';
import {
  ASPECT_DETAIL,
  ASPECT_ORDER,
  ASPECT_TITLE,
  KIND_TITLE,
  TRADITION_ORDER,
  TRADITION_TITLE,
  chooseAspect,
  chooseKind,
  chooseTradition,
  drainPair,
  kindChoices,
  offeredKinds,
  orList,
  setMentor,
} from './model.js';
import { IssueNotes, Section, StepLink } from './parts.js';

export function KindSection({ props, issues }: { props: StepProps; issues: readonly Issue[] }) {
  const { build, settings } = props;
  const headingId = useId();
  const level = build.priorities.magic;
  const offered = level ? offeredKinds(settings.table, level) : [];
  const choices: Choice<MagicKind>[] = kindChoices(build, settings.table, props.probe).map((c) => ({
    value: c.value,
    title: c.title,
    detail: c.detail,
    ...(c.aside ? { aside: c.aside } : {}),
    refusal: c.refusal,
  }));
  return (
    <Section id={headingId} title="Kind" testId="magic-kind-section">
      <p className="flex flex-wrap items-center gap-2 text-sm text-dim" data-testid="magic-row">
        <span>
          Magic priority {level}{' '}
          {offered.length > 0 ? `offers ${orList(offered.map((k) => KIND_TITLE[k].toLowerCase()))}.` : 'offers no magic and no Resonance.'}
        </span>
        <StepLink step={2} label="change priorities in step 2" jump={props} />
      </p>
      <ChoiceCards
        label="Kind of magic or Resonance"
        choices={choices}
        value={build.magic.kind}
        onChange={(kind) => props.update((b) => chooseKind(b, kind))}
        readOnly={props.readOnly}
        columns={2}
        testId="magic-kind"
      />
      <IssueNotes issues={issues} testId="magic-kind-issues" />
    </Section>
  );
}

export function AspectSection({ props, option, issues }: { props: StepProps; option: MagicPriorityOption | null; issues: readonly Issue[] }) {
  const headingId = useId();
  const consequenceId = useId();
  const choices: Choice<MagicAspect>[] = ASPECT_ORDER.map((aspect) => ({
    value: aspect,
    title: ASPECT_TITLE[aspect],
    detail: ASPECT_DETAIL[aspect],
  }));
  return (
    <Section id={headingId} title="Aspect" testId="magic-aspect-section">
      <p id={consequenceId} className="flex flex-wrap items-center gap-2 text-sm text-warn" data-testid="magic-aspect-consequence">
        <span>
          This choice is for good: the other two groups, and every skill in them, stay closed to this runner at creation and in play.
        </span>
        <WhyLink refValue={MAGIC_KIND_TABLE.aspected.ref} />
      </p>
      <ChoiceCards
        label="Aspect"
        describedBy={consequenceId}
        choices={choices}
        value={props.build.magic.aspect ?? null}
        onChange={(aspect) => props.update((b) => chooseAspect(b, aspect, option))}
        readOnly={props.readOnly}
        columns={3}
        testId="magic-aspect"
      />
      <IssueNotes issues={issues} testId="magic-aspect-issues" />
    </Section>
  );
}

export function TraditionSection({ props, issues }: { props: StepProps; issues: readonly Issue[] }) {
  const headingId = useId();
  const derived = props.preview.derived;
  const valueOf = (code: AttributeCode): number => derived?.attributes[code]?.value ?? props.ratings.attributes[code].rating;
  const chosen = props.build.magic.tradition ?? null;
  const choices: Choice<MagicTradition>[] = TRADITION_ORDER.map((tradition) => ({
    value: tradition,
    title: TRADITION_TITLE[tradition],
    detail: `Resists Drain with ${drainPair(tradition, valueOf).words}.`,
  }));
  return (
    <Section id={headingId} title="Tradition" testId="magic-tradition-section">
      <p className="flex flex-wrap items-center gap-2 text-sm text-dim">
        <span>The tradition decides which two attributes resist Drain, and which spirits answer.</span>
        <WhyLink refValue={drainPair(chosen ?? 'hermetic', valueOf).ref} />
      </p>
      <ChoiceCards
        label="Tradition"
        choices={choices}
        value={chosen}
        onChange={(tradition) => props.update((b) => chooseTradition(b, tradition))}
        readOnly={props.readOnly}
        columns={2}
        testId="magic-tradition"
      />
      <IssueNotes issues={issues} testId="magic-tradition-issues" />
    </Section>
  );
}

export function MentorSection({ props, issues }: { props: StepProps; issues: readonly Issue[] }) {
  const headingId = useId();
  const inputId = useId();
  const noteId = useId();
  const held = qualityEffects(props.build).ids.has('mentorSpirit');
  const mentor = props.build.magic.mentor ?? '';
  return (
    <Section id={headingId} title="Mentor spirit" testId="magic-mentor-section">
      {props.readOnly ? (
        <p className="text-sm text-ink" data-testid="magic-mentor-value">
          {mentor.trim() ? mentor : 'No mentor spirit named.'}
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          <label htmlFor={inputId} className="mono-label">
            Name of the mentor spirit (optional)
          </label>
          <input
            id={inputId}
            type="text"
            className="w-full rounded-md border border-edge bg-deck px-2.5 py-1.5 text-sm text-ink placeholder:text-faint focus:border-cyan focus:outline-none"
            value={mentor}
            maxLength={200}
            onChange={(e) => props.update((b) => setMentor(b, e.target.value))}
            aria-describedby={noteId}
            data-testid="magic-mentor-input"
          />
        </div>
      )}
      <p id={noteId} className="flex flex-wrap items-center gap-2 text-xs text-dim" data-testid="magic-mentor-note" data-held={held ? 'yes' : 'no'}>
        <span>
          A mentor spirit is also a positive quality, and it only counts once that quality is taken in step 5.{' '}
          {held ? 'This runner has taken it.' : 'This runner has not taken it yet.'}
        </span>
        <WhyLink refValue={QUALITY_RULE_BY_ID.mentorSpirit.ref} />
        <StepLink step={5} label="qualities in step 5" jump={props} />
      </p>
      <IssueNotes issues={issues} testId="magic-mentor-issues" />
    </Section>
  );
}
