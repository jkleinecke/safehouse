/**
 * The concept cards on Step 1, and the question a card asks before it
 * writes over the player's work (FR3.9, docs/CHARGEN.md §4.4 Step 1).
 *
 * The cards are the engine's presets (`CONCEPT_PRESETS`, "start from nothing"
 * last) in the kit's radio group, each with its title, its one-line pitch and
 * what it fills in — the priority order, the metatype it suggests and the
 * kind of magic — seen as a short line and heard with the columns named. A
 * card is optional, and the line under the group says what the chosen card
 * did: every later step holds its suggestion, all of it editable there.
 *
 * What a tap does is `./plan.ts`'s call, never this file's: a card that would
 * change nothing the player did goes straight on; one that would is held
 * back and `ConceptConfirm` names every section it changes — the player's own
 * changes marked as theirs — and says that who the runner is stays. The
 * question is the app's dialog (`Sheet`: a bottom sheet on a phone, centred on
 * a laptop, focus kept inside, Escape to back out), because on a phone the
 * card tapped can be fifteen cards away from anything inline.
 *
 * When the player has changed the chosen card's suggestion, the line under
 * the cards names those changes and offers to put the card back, through the
 * same plan and the same question.
 */
import { useId } from 'react';
import type { CharacterBuild, ChargenSettings } from '@safehouse/contracts';
import { BLANK_CONCEPT_ID, CONCEPT_PRESETS } from '@safehouse/rules';
import { Sheet } from '../../../sheet/components/ui.js';
import ChoiceCards, { type Choice } from '../../kit/ChoiceCards.js';
import {
  cardFills,
  changeLine,
  chosenConcept,
  conceptPlan,
  keptSentence,
  listWords,
  ownChanges,
  planGoLabel,
  planTitle,
  type ConceptPlan,
} from './plan.js';

/** The cards as the radio group lays them out. */
export function conceptChoices(): Choice[] {
  return CONCEPT_PRESETS.map((preset) => {
    const fills = cardFills(preset);
    return {
      value: preset.id,
      title: preset.title,
      detail: (
        <>
          <span className="block">{preset.pitch}</span>
          <span aria-hidden className="mt-1 block font-label text-[0.6875rem] text-faint" data-fills={preset.id}>
            {fills.seen}
          </span>
          <span className="sr-only">{fills.heard}</span>
        </>
      ),
    };
  });
}

/** The line under the cards: what the chosen card did, and what has changed since. */
export interface CardStatus {
  kind: 'none' | 'blank' | 'held' | 'changed';
  text: string;
  /** The card's own title, when one is chosen. */
  title: string | null;
}

export function cardStatus(build: CharacterBuild, plan: ConceptPlan | null): CardStatus {
  const chosen = chosenConcept(build);
  if (!chosen) return { kind: 'none', title: null, text: 'A card is optional: without one, each step starts empty and is yours to fill.' };
  if (chosen.id === BLANK_CONCEPT_ID || !chosen.spend) {
    return { kind: 'blank', title: chosen.title, text: 'Started from nothing: each step is yours to fill.' };
  }
  const own = plan ? ownChanges(plan) : [];
  if (own.length === 0) {
    return {
      kind: 'held',
      title: chosen.title,
      text: `Every later step holds the “${chosen.title}” suggestion; change any of it there.`,
    };
  }
  return {
    kind: 'changed',
    title: chosen.title,
    text: `Changed since the “${chosen.title}” card: ${listWords(own.map((c) => c.label))}.`,
  };
}

export interface ConceptConfirmProps {
  plan: ConceptPlan;
  onConfirm: () => void;
  onCancel: () => void;
}

/** The question: every section the card changes, the player's own marked, and what stays. */
export function ConceptConfirm({ plan, onConfirm, onCancel }: ConceptConfirmProps) {
  return (
    <Sheet open onClose={onCancel} title={planTitle(plan)}>
      <div className="space-y-3 text-sm" data-testid="concept-confirm" data-card={plan.preset.id}>
        {plan.changes.length > 0 ? (
          <>
            <p className="text-ink">This changes:</p>
            <ul className="space-y-1.5" data-testid="concept-confirm-changes">
              {plan.changes.map((change) => (
                <li
                  key={change.section}
                  className="flex items-baseline gap-x-2 text-dim"
                  data-section={change.section}
                  data-own={change.own ? 'yes' : 'no'}
                >
                  <span aria-hidden className={`shrink-0 ${change.own ? 'text-warn' : 'text-faint'}`}>
                    {change.own ? '!' : '·'}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="min-w-0 break-words">{changeLine(change)}</span>
                    {change.own && <span className="chip border-warn/40 text-warn">your change</span>}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-ink">Nothing on the build changes but the card.</p>
        )}
        <p className="text-dim" data-testid="concept-confirm-kept">
          {keptSentence(plan)}
        </p>
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <button type="button" className="btn px-3 py-1.5" onClick={onCancel} data-testid="concept-confirm-cancel">
            keep the build as it is
          </button>
          <button type="button" className="btn btn-accent px-3 py-1.5" onClick={onConfirm} data-testid="concept-confirm-go">
            {planGoLabel(plan)}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

export interface ConceptCardsProps {
  build: CharacterBuild;
  settings: ChargenSettings;
  readOnly: boolean;
  /** The card waiting on the player's answer, if any. */
  pending: string | null;
  /** A card tapped (or the chosen card's "put back"). */
  onPick: (id: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConceptCards({ build, settings, readOnly, pending, onPick, onConfirm, onCancel }: ConceptCardsProps) {
  const headingId = useId();
  const chosen = chosenConcept(build);
  const again = chosen?.spend ? conceptPlan(build, chosen.id, settings) : null;
  const status = cardStatus(build, again);
  const pendingPlan = pending && !readOnly ? conceptPlan(build, pending, settings) : null;

  return (
    <section aria-labelledby={headingId} className="space-y-2" data-testid="concept-cards-section">
      <div>
        <h2 id={headingId} className="mono-label text-cyan">
          Concept
        </h2>
        <p className="mt-1 text-xs text-dim">
          A card fills in every later step with a suggestion. Its line reads priorities as metatype / attributes / magic /
          skills / resources.
        </p>
      </div>
      <ChoiceCards
        label="Concept card"
        choices={conceptChoices()}
        value={chosen?.id ?? null}
        onChange={onPick}
        readOnly={readOnly}
        columns={2}
        testId="concept-cards"
      />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2" data-testid="concept-card-status" data-status={status.kind}>
        <p role="status" className={`min-w-0 flex-1 text-xs ${status.kind === 'changed' ? 'text-warn' : 'text-dim'}`}>
          {status.text}
        </p>
        {status.kind === 'changed' && chosen && !readOnly && (
          <button type="button" className="btn px-3 py-1.5" onClick={() => onPick(chosen.id)} data-testid="concept-put-back">
            put the card back
          </button>
        )}
      </div>
      {pendingPlan && <ConceptConfirm plan={pendingPlan} onConfirm={onConfirm} onCancel={onCancel} />}
    </section>
  );
}
