/**
 * Step 4 — Magic or Resonance (FR3.9, docs/CHARGEN.md §4.4 Step 4, §8.3).
 *
 * The step the book spends three pages on and a first-timer most often gets
 * half right: the Magic column decides which kinds of practitioner are on
 * offer, the kind decides what comes free, and every free thing has its own
 * fence and cap. So the screen is laid out in the order those decisions
 * depend on each other, and each part only appears once the part above it
 * gives it something to say:
 *
 * 1. **Kind** — every kind as a card, the ones the row does not offer greyed
 *    with the validator's sentence (`ChoiceCards`, `kindChoices`).
 * 2. **Aspect**, for an aspected magician, with the permanent consequence
 *    stated before the tap.
 * 3. **What the priority hands over** — the grants as lists to fill: granted
 *    skills from the skills the engine's fences leave open, the aspected
 *    group, spells, rituals and preparations or complex forms from the
 *    campaign's books, each counted, each waivable (`GrantSections`).
 * 4. **Tradition** with its Drain pair in this runner's numbers, and the
 *    **mentor spirit**, noting that it is a quality in step 5.
 * 5. **Power points** and **adept powers** for adepts and mystic adepts —
 *    the mystic adept's Karma shortcut quoted before the tap, a power staged
 *    with its levels and price and refused if the pool cannot pay.
 * 6. **Living persona** for a technomancer, from the derived character.
 *
 * A build with no Magic priority yet is sent to step 2; a mundane on a row
 * that offers nothing gets one line and the same way back, and the frame
 * marks the step skipped. Picks an earlier kind left behind are never
 * hidden: their section stays, with a way to remove them — and that holds
 * for a mundane too. A runner who became mundane and then lost the Magic row
 * keeps granted skills, powers and bought power points on the record (the
 * engine's `setMagicKind` keeps every pick), and the errors they raise can
 * only be fixed here, so such a runner gets the one line *and* the sections
 * that hold what is left, never the bare "nothing to choose" (`magicStage`).
 *
 * A link to a later step is offered only where guided mode would let the
 * player land (`StepLink`, the progress strip's `canReach`), so a shortcut
 * never walks round Next's gate.
 *
 * Everything is read from `StepProps` and written through `update(fn)` with
 * the pure updaters in `./magic/model.ts`; the Shadowrun is the engine's.
 */
import { useId, useMemo } from 'react';
import { magicPriorityOption, powerPointsBought, tallyBuild } from '@safehouse/rules';
import { AspectSection, KindSection, MentorSection, TraditionSection } from './magic/ChoiceSections.js';
import { FormGrant, FormulaGrant, GroupGrant, SkillGrant, grantOrder } from './magic/GrantSections.js';
import { PersonaSection } from './magic/PersonaSection.js';
import { PowerPointSection, PowersSection } from './magic/PowerSections.js';
import {
  KIND_TITLE,
  grantStates,
  issuesBySection,
  magicStage,
  takesMentor,
  takesTradition,
  usesPowers,
} from './magic/model.js';
import { IssueNotes, Section, StepLink } from './magic/parts.js';
import type { StepProps } from './types.js';

function NoPriority({ props }: { props: StepProps }) {
  return (
    <div className="panel flex flex-wrap items-center gap-2 p-3 text-sm text-dim" data-testid="magic-no-priority">
      <span>The Magic or Resonance priority is not chosen yet, and the kinds on offer depend on it.</span>
      <StepLink step={2} label="choose it in step 2" jump={props} />
    </div>
  );
}

/**
 * The mundane's line. The frame already says the step is skipped, so this
 * says why, once. When an earlier kind left picks on the record it says so
 * too, and the sections that hold them follow.
 */
function Mundane({ props, leftovers }: { props: StepProps; leftovers: boolean }) {
  return (
    <div
      className="panel space-y-2 p-3 text-sm text-dim"
      data-testid="magic-mundane"
      data-stage={leftovers ? 'mundane-leftovers' : 'mundane'}
    >
      <p className="flex flex-wrap items-center gap-2">
        <span>Magic priority {props.build.priorities.magic} buys no magic and no Resonance, so this runner is mundane.</span>
        <StepLink step={2} label="change priorities in step 2" jump={props} />
      </p>
      {leftovers && (
        <p className="text-warn" data-testid="magic-mundane-leftovers">
          {props.readOnly
            ? 'Picks from an earlier choice are still on the record.'
            : 'Picks from an earlier choice are still on the record and count for nothing at this priority; remove them below.'}
        </p>
      )}
    </div>
  );
}

function MagicScreen({ stage, ...props }: StepProps & { stage: 'choose' | 'mundane-leftovers' }) {
  const { build, settings } = props;
  const grantsId = useId();
  const otherId = useId();
  const kind = build.magic.kind;
  const level = build.priorities.magic;
  const option = level && kind !== 'mundane' ? magicPriorityOption(settings.table, level, kind) : null;
  const states = grantStates(build, option);
  const sections = issuesBySection(props.issues);
  const tally = useMemo(() => tallyBuild(build, settings), [build, settings]);
  const grants = grantOrder(states);
  const bought = powerPointsBought(build);

  const leftovers = stage === 'mundane-leftovers';
  const shown = {
    kind: !leftovers,
    aspect: kind === 'aspected',
    grants: kind !== 'mundane' || grants.length > 0,
    tradition: takesTradition(kind),
    mentor: takesMentor(kind),
    powerPoints: usesPowers(kind) || bought > 0,
    powers: usesPowers(kind) || build.powers.length > 0,
    persona: kind === 'technomancer',
  };
  // A finding whose section this kind does not show still has to be seen.
  const orphans = [
    ...sections.other,
    ...(shown.kind ? [] : sections.kind),
    ...(shown.aspect ? [] : sections.aspect),
    ...(shown.tradition ? [] : sections.tradition),
    ...(shown.mentor ? [] : sections.mentor),
    ...(shown.powerPoints ? [] : sections.powerPoints),
    ...(shown.powers ? [] : sections.powers),
    ...(['skills', 'groups', 'spells', 'forms'] as const).flatMap((key) => (shown.grants && states[key].shown ? [] : sections[key])),
  ];
  const p = props;

  return (
    <div className="space-y-4" data-testid="magic-step" data-kind={kind}>
      {shown.kind ? <KindSection props={props} issues={sections.kind} /> : <Mundane props={props} leftovers />}
      {shown.aspect && <AspectSection props={props} option={option} issues={sections.aspect} />}
      {shown.grants && (
        <Section id={grantsId} title="What the priority hands over" testId="magic-grants-section">
          {grants.length === 0 ? (
            <p className="text-sm text-dim" data-testid="magic-grants-none">
              {option
                ? `At Magic priority ${level} ${KIND_TITLE[kind].toLowerCase()} gets nothing more to pick.`
                : `${KIND_TITLE[kind]} is not on this Magic row, so it hands over nothing here.`}
            </p>
          ) : (
            grants.map((key) =>
              key === 'skills' ? (
                <SkillGrant key={key} p={p} option={option} state={states.skills} issues={sections.skills} />
              ) : key === 'groups' ? (
                <GroupGrant key={key} p={p} option={option} state={states.groups} issues={sections.groups} />
              ) : key === 'spells' ? (
                <FormulaGrant key={key} p={p} state={states.spells} issues={sections.spells} tally={tally} />
              ) : (
                <FormGrant key={key} p={p} state={states.forms} issues={sections.forms} />
              ),
            )
          )}
        </Section>
      )}
      {shown.tradition && <TraditionSection props={props} issues={sections.tradition} />}
      {shown.mentor && <MentorSection props={props} issues={sections.mentor} />}
      {shown.powerPoints && <PowerPointSection props={props} issues={sections.powerPoints} />}
      {shown.powers && <PowersSection props={props} issues={sections.powers} />}
      {shown.persona && <PersonaSection props={props} issues={[]} />}
      {orphans.length > 0 && (
        <Section id={otherId} title="Also on this step" testId="magic-other-section">
          <IssueNotes issues={orphans} testId="magic-other-issues" />
        </Section>
      )}
    </div>
  );
}

export default function MagicStep(props: StepProps) {
  const stage = magicStage(props.build, props.settings.table, props.issues);
  if (stage === 'no-priority') return <NoPriority props={props} />;
  if (stage === 'mundane') return <Mundane props={props} leftovers={false} />;
  return <MagicScreen {...props} stage={stage} />;
}
