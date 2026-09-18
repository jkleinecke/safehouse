/**
 * The step kit: the pieces every walkthrough screen reaches for, so nine
 * screens say the same things the same way (FR3.9, docs/CHARGEN.md §4.4,
 * §8.6). A step reads everything from `StepProps` (`../steps/types.ts`) and
 * builds its body from these:
 *
 * Picking from the books
 * - `CataloguePicker` — search + alphabetical browse of one kind from the
 *   campaign's creation books, "show more" paging, each row with its page,
 *   price and Availability; rows over the campaign caps greyed with the
 *   number and why, never hidden. `onPick(hit)`.
 * - `useBuilderCatalogue({ campaignId, kind, q, offset, limit })` — the same
 *   list as a hook, for a step that lays rows out its own way.
 * - `hitToPurchase`, `hitToQuality`, `hitToPick`, `hitToPower` — a picked row
 *   as a build line, through `toSheetItem` and the rules engine's catalogue
 *   readers; parsed with the contract, so a line the server would refuse
 *   fails at the tap.
 * - `hitPrice`, `hitAvailability`, `hitCapRefusals`, `hitRatingRange` — what
 *   a row costs, how available it is, which caps it is over, and whether it
 *   asks for a rating.
 *
 * Saying the numbers
 * - `PoolLine` — "12 of 28 skill points left"; an overspend in words.
 * - `CostQuote` — "costs 10 Karma — you have 26", before the tap.
 * - `WhyLink` — "why?" and the reader chip at a rule's page.
 * - `poolSentence`, `costQuote`, `amountOf` — the same words as strings.
 *
 * Choosing
 * - `ChoiceCards` — a radio group of cards whose arrows move focus and never
 *   take (Space, Enter or a tap does), a refused card staying visible with
 *   its reason (concept, metatype, magic type).
 * - `RatingPicker` — a rated item's rating inside the book's range, refusing
 *   past it with a sentence (over `LimitStepper`).
 *
 * The refusing stepper itself is `../components/LimitStepper.tsx`; losses at
 * Next are `../steps/confirm.ts`.
 */
export { default as CataloguePicker, CataloguePickerView, pickerCountLine, pickerRowGate } from './CataloguePicker.js';
export type { CataloguePickerProps, CataloguePickerViewProps, PickerCaps } from './CataloguePicker.js';
export {
  BUILDER_CATALOGUE_LIMIT,
  builderCatalogueKey,
  builderCataloguePath,
  useBuilderCatalogue,
  type BuilderCatalogue,
  type BuilderCatalogueQuery,
} from './useBuilderCatalogue.js';
export {
  hitRef,
  hitToPick,
  hitToPower,
  hitToPurchase,
  hitQualityType,
  hitToQuality,
  purchaseListFor,
  type PurchaseChoice,
  type QualityChoice,
} from './mappers.js';
export {
  boughtWithNuyen,
  hitAvailability,
  hitCapRefusals,
  hitGmNote,
  hitPrice,
  hitRatingRange,
  mergeCataloguePages,
  nextPageOffset,
  readCataloguePage,
  type HitReading,
  type RatingRange,
} from './catalogue.js';
export { amountOf, costQuote, poolOf, poolSentence, POOL_NOUNS, type CostQuoteWords } from './words.js';
export { default as PoolLine, type PoolLineProps } from './PoolLine.js';
export { default as CostQuote, type CostQuoteProps } from './CostQuote.js';
export { default as WhyLink, type WhyLinkProps } from './WhyLink.js';
export {
  default as ChoiceCards,
  choiceKeyDown,
  choiceKeyTarget,
  choiceTabStop,
  type Choice,
  type ChoiceCardsProps,
  type ChoiceKey,
} from './ChoiceCards.js';
export { default as RatingPicker, type RatingPickerProps } from './RatingPicker.js';
