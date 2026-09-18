/**
 * The metatype half of Step 3 (FR3.9, docs/CHARGEN.md §4.4 "Metatype cards
 * with base/max for each attribute and the racial traits in plain words, the
 * special points this priority grants that metatype, and the lifestyle
 * multiplier").
 *
 * A first-timer choosing between an ork and a troll is choosing between two
 * rows of a table they have not read, at a priority chosen a step ago. So each
 * card says the numbers that decide it — where every attribute starts and
 * tops out, what the runner is born with, the special points *this* build's
 * Metatype row gives, and what a lifestyle costs — and a card the row does
 * not offer stays on screen, greyed, with the validator's sentence and page
 * instead of vanishing. The core five are always there; when the campaign
 * allows them, the metavariants, metasapients and shapeshifters sit under
 * their own headings, folded until opened (thirty cards is a long scroll on a
 * phone), each saying the extra Karma it costs, if any.
 *
 * Every figure comes from `metatypeSection` (`./model.ts`); the tap is
 * `setMetatype`, the updater the refusal was probed with.
 */
import { useId } from 'react';
import type { Issue, Ref } from '@safehouse/contracts';
import { issueRule, setMetatype } from '@safehouse/rules';
import ChoiceCards, { type Choice } from '../../kit/ChoiceCards.js';
import WhyLink from '../../kit/WhyLink.js';
import type { BuildUpdater } from '../../session.js';
import IssueNotes from './IssueNotes.js';
import {
  issuesBesideCards,
  metatypePriorityWords,
  type MetatypeCard,
  type MetatypeGroupState,
  type MetatypeSection,
  type StepNav,
} from './model.js';

export interface MetatypeCardsProps {
  section: MetatypeSection;
  /** Findings about the metatype (this step's, and any filed elsewhere). */
  issues: readonly Issue[];
  readOnly: boolean;
  update: (fn: BuildUpdater) => void;
  nav: StepNav;
}

/** A card's body: ranges, traits, and the notes that are not traits. Phrasing content only — it sits inside a button. */
export function CardDetail({ card }: { card: MetatypeCard }) {
  const lines = [
    ...(card.karmaWords ? [card.karmaWords] : []),
    card.traits.length > 0 ? card.traits.join(', ') : 'no racial traits',
    ...card.notes,
    ...(card.lifestyle ? [card.lifestyle] : []),
    ...(card.byRow ? [`special points by row: ${card.byRow}`] : []),
  ];
  return (
    <span className="flex flex-col gap-1" data-testid="metatype-card-detail">
      <span className="flex flex-wrap gap-x-2.5 gap-y-0.5 font-label text-dim" data-testid="metatype-ranges">
        {card.ranges.map((r) => (
          <span key={r.id} className="whitespace-nowrap" data-range={r.id}>
            <span aria-hidden>
              <span className="text-faint">{r.short}</span> {r.base}/{r.max}
            </span>
            <span className="sr-only">
              {r.name} {r.base} to {r.max},{' '}
            </span>
          </span>
        ))}
      </span>
      {lines.map((line) => (
        <span key={line}>{line}</span>
      ))}
    </span>
  );
}

function choicesOf(group: MetatypeGroupState): Choice[] {
  return group.choices.map(({ card, refusal }) => ({
    value: card.id,
    title: card.title,
    ...(card.aside ? { aside: card.aside } : {}),
    detail: <CardDetail card={card} />,
    refusal,
  }));
}

export default function MetatypeCards({ section, issues, readOnly, update, nav }: MetatypeCardsProps) {
  const headingId = useId();
  const onChange = (id: string) => update((b) => setMetatype(b, id));
  const core = section.groups.find((g) => g.family === 'core');
  const others = section.groups.filter((g) => g.family !== 'core');
  const extraRef = issueRule('metatype-not-allowed')?.ref;

  return (
    <section aria-labelledby={headingId} className="space-y-3" data-testid="metatype-section">
      <div className="space-y-1">
        <h2 id={headingId} className="text-base font-semibold text-ink">
          Metatype
        </h2>
        <p className="flex flex-wrap items-center gap-2 text-sm text-dim" data-testid="metatype-priority">
          <span>{metatypePriorityWords(section.level)}</span>
          {section.level === null && !readOnly && (
            <button type="button" className="btn px-2 py-0.5 text-xs pointer-coarse:min-h-10" onClick={() => nav.goTo(2)}>
              choose priorities
            </button>
          )}
        </p>
      </div>

      <IssueNotes issues={issuesBesideCards(issues, section)} nav={nav} testId="metatype-issues" />

      {section.groups.length === 0 && (
        <p className="text-sm text-dim" data-testid="metatype-none">
          No metatype chosen yet.
        </p>
      )}

      {core && (
        <div className="space-y-2" data-family="core">
          {others.length > 0 && <h3 className="text-sm font-semibold text-ink">{core.label}</h3>}
          <ChoiceCards
            label={core.label}
            choices={choicesOf(core)}
            value={core.holdsChoice ? section.chosen : null}
            onChange={onChange}
            readOnly={readOnly}
            columns={2}
            testId="metatype-cards-core"
          />
        </div>
      )}

      {others.map((group) => (
        <FamilyGroup
          key={group.family}
          group={group}
          chosen={section.chosen}
          readOnly={readOnly}
          onChange={onChange}
          extraRef={extraRef ?? null}
        />
      ))}
    </section>
  );
}

function FamilyGroup({
  group,
  chosen,
  readOnly,
  onChange,
  extraRef,
}: {
  group: MetatypeGroupState;
  chosen: string | null;
  readOnly: boolean;
  onChange: (id: string) => void;
  extraRef: Ref | null;
}) {
  const headingId = useId();
  const cards = (
    <ChoiceCards
      label={group.label}
      choices={choicesOf(group)}
      value={group.holdsChoice ? chosen : null}
      onChange={onChange}
      readOnly={readOnly}
      columns={2}
      testId={`metatype-cards-${group.family}`}
    />
  );
  return (
    <section aria-labelledby={headingId} className="space-y-2" data-family={group.family}>
      <h3 id={headingId} className="text-sm font-semibold text-ink">
        {group.label}
      </h3>
      {readOnly ? (
        cards
      ) : (
        <>
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-dim">
            <span>
              Any extra Karma a card names is paid on top of the priority and does not count toward the cap on positive
              qualities.
            </span>
            {extraRef && <WhyLink refValue={extraRef} />}
          </p>
          <details
            open={group.holdsChoice}
            className="group rounded-md border border-edge"
            data-testid={`metatype-fold-${group.family}`}
          >
            <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm text-dim">
              <span aria-hidden className="text-faint transition-transform group-open:rotate-90">
                ▸
              </span>
              {group.choices.length} to choose from
            </summary>
            <div className="p-2 pt-0">{cards}</div>
          </details>
        </>
      )}
    </section>
  );
}
