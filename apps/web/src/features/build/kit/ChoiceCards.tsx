/**
 * Pick one of a few cards — a concept, a metatype, a kind of magic (FR3.9,
 * docs/CHARGEN.md §4.4 Steps 1, 3 and 4).
 *
 * Three steps open with the same gesture: a handful of choices, each with a
 * title and a line on what it is for, one of them taken. That is a radio
 * group, and it is built as one (WAI-ARIA radio group): the cards are
 * `role="radio"` inside `role="radiogroup"`, one tab stop for the group,
 * arrow keys move between cards, Home and End go to the ends, and Space or
 * Enter (or a tap) takes the focused card.
 *
 * Moving never takes. The usual radio group checks whatever the arrows land
 * on, but a card here rewrites the build — a concept card refits every step
 * and asks first when there is a spend to lose, a kind of magic reshapes
 * step 4 — so a keyboard user browsing the cards would open the concept
 * confirm, or rewrite the record, on every key. The tab stop roves with focus
 * while focus is inside the group (`choiceKeyDown` moves focus and nothing
 * else) and goes back to the chosen card once focus leaves. The priority
 * table's pickers work the same way, for the same reason.
 *
 * A card the rules shut ("at priority D only adept and aspected magician")
 * stays in the group and focusable — `aria-disabled`, its reason a sentence
 * under it tied with `aria-describedby`, with the page — so a keyboard or
 * screen-reader user meets the reason where a sighted player sees it. Chosen
 * is marked with a filled dot and the word, not colour alone.
 *
 * The reason comes from the engine (`magicPriorityOption`, the validator's
 * sentences via `probe`); this only lays the cards out and handles the keys
 * (`choiceKeyTarget` and `choiceKeyDown`, pure functions). One column on a
 * phone, where the title keeps a few characters of width and the figure
 * beside it wraps to its own line instead of running into the title;
 * `columns` widens from `sm`.
 */
import { useId, useRef, useState, type FocusEvent, type ReactNode } from 'react';
import { RefChip } from '../../gm/books/RefChip.js';
import type { Refusal } from '../components/LimitStepper.js';

export interface Choice<V extends string = string> {
  value: V;
  title: string;
  /** One line on what the choice is for. */
  detail?: ReactNode;
  /** A short figure beside the title ("7 special points"). */
  aside?: ReactNode;
  /** Why this card cannot be taken now; it stays visible and says so. */
  refusal?: Refusal | null;
}

export interface ChoiceCardsProps<V extends string = string> {
  /** The group's accessible name ("Metatype"). */
  label: string;
  /** The id of a sentence that describes the whole group (what choosing here means for good). */
  describedBy?: string;
  choices: readonly Choice<V>[];
  value: V | null;
  onChange: (value: V) => void;
  readOnly?: boolean;
  /** Cards per row from `sm` up (default 2). */
  columns?: 1 | 2 | 3;
  testId?: string;
}

/**
 * Where a key moves focus in a group of `count` cards from `index`: arrows
 * wrap, Home and End go to the ends; null for any other key.
 */
export function choiceKeyTarget(count: number, index: number, key: string): number | null {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (index + 1) % count;
    case 'ArrowLeft':
    case 'ArrowUp':
      return (index - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

/** The card that holds the group's one tab stop: the chosen card, else the first. */
export function choiceTabStop(choices: readonly Pick<Choice, 'value'>[], value: string | null): number {
  const at = value === null ? -1 : choices.findIndex((c) => c.value === value);
  return at === -1 ? 0 : at;
}

/** The slice of a key event the handler reads. */
export interface ChoiceKey {
  key: string;
  preventDefault(): void;
}

/**
 * A key pressed on the card at `index`: an arrow, Home or End moves focus to
 * the card `choiceKeyTarget` names and reports the key handled. Nothing here
 * takes a card — Space and Enter are the button's own click, and the click
 * takes it — so browsing the group never changes the build.
 */
export function choiceKeyDown(event: ChoiceKey, count: number, index: number, focus: (index: number) => void): boolean {
  const target = choiceKeyTarget(count, index, event.key);
  if (target === null) return false;
  event.preventDefault();
  focus(target);
  return true;
}

const COLUMNS: Readonly<Record<1 | 2 | 3, string>> = {
  1: '',
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-2 lg:grid-cols-3',
};

export default function ChoiceCards<V extends string = string>({
  label,
  describedBy,
  choices,
  value,
  onChange,
  readOnly = false,
  columns = 2,
  testId = 'choice-cards',
}: ChoiceCardsProps<V>) {
  const id = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  // The card focus is on while focus is inside the group; null once it leaves.
  const [focused, setFocused] = useState<number | null>(null);
  const tabStop = focused !== null && focused < choices.length ? focused : choiceTabStop(choices, value);

  const take = (choice: Choice<V>) => {
    if (readOnly || choice.refusal) return;
    if (choice.value !== value) onChange(choice.value);
  };

  const leave = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(null);
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      {...(describedBy ? { 'aria-describedby': describedBy } : {})}
      {...(readOnly ? { 'aria-readonly': true } : {})}
      className={`grid grid-cols-1 gap-2 ${COLUMNS[columns]}`}
      data-testid={testId}
      onBlur={leave}
    >
      {choices.map((choice, index) => {
        const checked = choice.value === value;
        const refused = Boolean(choice.refusal);
        const reasonId = `${id}-why-${index}`;
        const titleId = `${id}-title-${index}`;
        const asideId = `${id}-aside-${index}`;
        const detailId = `${id}-detail-${index}`;
        // Named by its title (and figure); the line on what it is for, and any refusal, describe it.
        const labelledBy = [titleId, ...(choice.aside ? [asideId] : [])].join(' ');
        const describedBy = [...(choice.detail ? [detailId] : []), ...(refused ? [reasonId] : [])].join(' ');
        return (
          <div key={choice.value} className="flex min-w-0 flex-col gap-1" data-choice={choice.value}>
            <button
              ref={(el) => {
                refs.current[index] = el;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-labelledby={labelledBy}
              {...(describedBy ? { 'aria-describedby': describedBy } : {})}
              {...(refused || readOnly ? { 'aria-disabled': true } : {})}
              tabIndex={index === tabStop ? 0 : -1}
              onClick={() => take(choice)}
              onFocus={() => setFocused(index)}
              onKeyDown={(e) => {
                choiceKeyDown(e, choices.length, index, (at) => refs.current[at]?.focus());
              }}
              data-checked={checked ? 'yes' : 'no'}
              data-refused={refused ? 'yes' : 'no'}
              className={`flex min-h-11 w-full flex-col items-start gap-1 rounded-md border p-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan ${
                checked ? 'border-cyan bg-cyan/5' : 'border-edge bg-deck hover:border-edge-bright'
              } ${refused ? 'cursor-not-allowed opacity-70' : ''}`}
            >
              <span className="flex w-full flex-wrap items-baseline gap-x-2">
                <span aria-hidden className={checked ? 'text-cyan' : 'text-faint'}>
                  {checked ? '●' : '○'}
                </span>
                <span id={titleId} className="min-w-[8ch] flex-auto break-words text-sm font-semibold text-ink">
                  {choice.title}
                </span>
                {choice.aside && (
                  <span id={asideId} className="mono-label max-w-full break-words text-dim">
                    {choice.aside}
                  </span>
                )}
                {checked && (
                  <span aria-hidden className="mono-label text-cyan">
                    chosen
                  </span>
                )}
              </span>
              {choice.detail && (
                <span id={detailId} className="text-xs text-dim">
                  {choice.detail}
                </span>
              )}
            </button>
            {choice.refusal && (
              // The glyph stays beside the first line of its sentence however narrow the card.
              <p id={reasonId} className="flex items-baseline gap-1.5 text-xs text-warn" data-refusal={choice.value}>
                <span aria-hidden className="shrink-0">
                  ⛔
                </span>
                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1">
                  <span>{choice.refusal.reason}</span>
                  {choice.refusal.ref && <RefChip refValue={choice.refusal.ref} />}
                </span>
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
