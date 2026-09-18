/**
 * The rating of a rated item, chosen before it is added (FR3.9,
 * docs/CHARGEN.md §4.4 Step 5 "a rating-scaled quality asks for its rating",
 * Step 7 "rating for rated items").
 *
 * A refusing stepper (`LimitStepper`) bounded by the book's range —
 * `hitRatingRange` reads it off the row — that says where the range ends
 * ("up to 3", or that the book prints no maximum) and passes on any rule that
 * shuts it sooner (a device rating over the campaign's cap, from
 * `hitCapRefusals` at the next rating). Past the book's own maximum the
 * stepper refuses with its sentence; the price at the chosen rating is the
 * caller's to quote beside it.
 */
import type { Refusal } from '../components/LimitStepper.js';
import LimitStepper from '../components/LimitStepper.js';

export interface RatingPickerProps {
  /** The item's name, for the accessible label ("Rating of Knit Weave"). */
  itemName: string;
  value: number;
  /** The lowest rating (default 1). */
  min?: number;
  /** The book's highest rating; null when it prints none. */
  max: number | null;
  onChange: (rating: number) => void;
  /** A rule that shuts raising before the book's maximum does. */
  refuseIncrease?: Refusal | null;
  readOnly?: boolean;
  /** Visually hide "Rating of …" where the row already names the item (it stays the accessible name). */
  hideLabel?: boolean;
  /** The id of a note beside the picker that says what one more rating does (a price, a Magic loss), read with +. */
  increaseDescribedBy?: string;
  testId?: string;
}

export default function RatingPicker({ itemName, value, min = 1, max, onChange, refuseIncrease, readOnly, hideLabel, increaseDescribedBy, testId }: RatingPickerProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1" data-testid={testId ?? 'rating-picker'}>
      <LimitStepper
        label={`Rating of ${itemName}`}
        value={value}
        min={min}
        {...(max !== null ? { max } : {})}
        onChange={onChange}
        {...(refuseIncrease ? { refuseIncrease } : {})}
        {...(readOnly ? { readOnly } : {})}
        {...(hideLabel ? { hideLabel } : {})}
        {...(increaseDescribedBy ? { increaseDescribedBy } : {})}
      />
      <span className="mono-label text-faint" data-testid="rating-range">
        {max !== null ? `rating ${min} to ${max}` : 'no maximum printed'}
      </span>
    </div>
  );
}
