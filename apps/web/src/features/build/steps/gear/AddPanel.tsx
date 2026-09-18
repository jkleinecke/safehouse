/**
 * Buying one row: the few questions the book needs, and everything the rules
 * will say about it, before the tap (FR3.9, docs/CHARGEN.md §4.4 Step 7
 * "adding an item asks only what the book needs: quantity, rating for rated
 * items, grade for 'ware", "a warning before the first point of Magic goes").
 *
 * The sheet's add dialog adds and asks later; character creation cannot,
 * because a purchase here can break a cap (alphaware's +2 Availability), cost
 * a point of Magic that no refund brings back in play, or push another step's
 * pool over (an adept's power points). So the panel builds the line the tap
 * would add (`quoteDraft`, the kit's `hitToPurchase` under it) and asks the
 * engine about the build with that line in it:
 *
 * - its price against the nuyen pool (`CostQuote`), its Essence at the grade,
 *   its Availability with the grade's modifier;
 * - a cap it would break — the add button refuses, focusable, with the
 *   validator's sentence tied to it, and so does any stepper or grade card
 *   whose next value would break one (`draftRefusal`);
 * - Magic or Resonance it would take, in numbers, with the page — and the
 *   add button's own words say it ("add … and lose 1 Magic"), so the loss is
 *   acknowledged by the tap that makes it;
 * - what it would break on another step, allowed and named;
 * - the GM's part: a Restricted or Forbidden row "needs the GM", in the
 *   validator's words.
 *
 * `AddPanelView` is what a static render sees; `AddPanel` owns the draft.
 */
import { useId, useMemo, useState } from 'react';
import type { AugmentGrade, Budgets } from '@safehouse/contracts';
import { RefChip } from '../../../gm/books/RefChip.js';
import type { CatalogueHit } from '../../../sheet/catalogue/toSheet.js';
import LimitStepper, { type Refusal } from '../../components/LimitStepper.js';
import { ChoiceCards, CostQuote, RatingPicker, hitRatingRange, hitRef, type Choice } from '../../kit/index.js';
import { stepMeta } from '../meta.js';
import {
  addLabel,
  draftRefusal,
  formatEssence,
  gradeOptions,
  initialDraft,
  quoteDraft,
  shiftWords,
  typedNumber,
  type DraftQuote,
  type PurchaseDraft,
  type QuoteContext,
} from './gear.js';
import { IssueNote, TOUCH_CHIP } from './parts.js';

export interface AddPanelViewProps {
  hit: CatalogueHit;
  draft: PurchaseDraft;
  quote: DraftQuote;
  budgets: Budgets;
  onDraft: (draft: PurchaseDraft) => void;
  onAdd: () => void;
  onCancel: () => void;
  /** The cap one more would break. */
  qtyRefusal: Refusal | null;
  /** The cap the next rating would break. */
  ratingRefusal: Refusal | null;
  /** The cap each grade would break, beside the grades not sold at creation. */
  gradeRefusals: Partial<Record<AugmentGrade, Refusal | null>>;
}

export function AddPanelView(p: AddPanelViewProps) {
  const { hit, draft, quote } = p;
  const quoteId = useId();
  const lossId = useId();
  const refusalId = useId();
  const errorId = useId();
  const range = hitRatingRange(hit);
  const ref = hitRef(hit);
  const refusal = quote.quote?.refusal ?? null;
  const loss = quote.quote?.loss ?? null;
  const consequences = quote.quote?.consequences ?? [];
  const shifts = quote.quote ? shiftWords(quote.quote.change) : [];
  const shut = refusal !== null || quote.error !== null || quote.priceMissing || quote.purchase === null;
  const describedBy = [
    quoteId,
    ...(loss ? [lossId] : []),
    ...(refusal ? [refusalId] : []),
    ...(quote.error || quote.priceMissing ? [errorId] : []),
  ].join(' ');

  const grades: Choice<AugmentGrade>[] = gradeOptions().map((option) => ({
    value: option.grade,
    title: option.label,
    detail: option.detail,
    refusal: option.refusal ?? p.gradeRefusals[option.grade] ?? null,
  }));

  return (
    <div className="space-y-3" data-testid="gear-add">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-sm font-semibold text-ink" data-testid="gear-add-name">
          {hit.name}
        </p>
        {ref && <RefChip refValue={ref} className={TOUCH_CHIP} />}
      </div>

      {range && draft.rating !== null && (
        <RatingPicker
          itemName={hit.name}
          value={draft.rating}
          min={range.min}
          max={range.max}
          onChange={(rating) => p.onDraft({ ...draft, rating })}
          refuseIncrease={p.ratingRefusal}
          testId="gear-add-rating"
        />
      )}

      <LimitStepper
        label={`Quantity of ${hit.name}`}
        value={draft.qty}
        min={1}
        onChange={(qty) => p.onDraft({ ...draft, qty })}
        refuseIncrease={p.qtyRefusal}
        testId="gear-add-qty"
      />

      {draft.grade !== null && (
        <ChoiceCards
          label={`Grade of ${hit.name}`}
          choices={grades}
          value={draft.grade}
          onChange={(grade) => p.onDraft({ ...draft, grade })}
          columns={2}
          testId="gear-add-grade"
        />
      )}

      {(quote.priceMissing || draft.price !== null) && (
        <label className="flex flex-col gap-0.5">
          <span className="mono-label">Price each, in nuyen</span>
          <input
            className="w-full rounded-md border border-edge bg-deck px-2.5 py-1.5 text-sm text-ink focus:border-cyan focus:outline-none sm:w-40"
            inputMode="numeric"
            value={draft.price ?? ''}
            onChange={(e) => p.onDraft({ ...draft, price: typedNumber(e.target.value) })}
            {...(quote.error || quote.priceMissing ? { 'aria-describedby': errorId } : {})}
            data-testid="gear-add-price"
          />
        </label>
      )}

      <ul className="space-y-1 text-xs text-dim" data-testid="gear-add-figures">
        <li>
          <CostQuote amount={quote.cost} budgets={p.budgets} pool="nuyen" id={quoteId} />
        </li>
        {quote.purchase?.list === 'augments' && <li>Essence {formatEssence(quote.essence)}</li>}
        {quote.availability && <li>{quote.availability}</li>}
        {shifts.length > 0 && <li data-testid="gear-add-shifts">on the rail: {shifts.join(' · ')}</li>}
      </ul>

      {loss && (
        <p id={lossId} className="flex flex-wrap items-center gap-1.5 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn" data-testid="gear-add-loss">
          <span aria-hidden>⚠</span>
          <span>{loss.text}</span>
          <RefChip refValue={loss.ref} className={TOUCH_CHIP} />
        </p>
      )}

      {consequences.length > 0 && (
        <div className="space-y-1" data-testid="gear-add-consequences">
          <p className="text-xs text-dim">Adding it also leaves this to fix on another step:</p>
          <ul className="space-y-1">
            {consequences.map((issue, i) => (
              <IssueNote key={`${issue.code}-${i}`} issue={{ ...issue, message: `${issue.message} (${stepMeta(issue.step).title})` }} />
            ))}
          </ul>
        </div>
      )}

      {quote.notes.length > 0 && (
        <ul className="space-y-1" data-testid="gear-add-notes">
          {quote.notes.map((issue, i) => (
            <IssueNote key={`${issue.code}-${i}`} issue={issue} />
          ))}
        </ul>
      )}

      {refusal && (
        <p id={refusalId} className="flex flex-wrap items-center gap-1.5 text-xs text-warn" data-testid="gear-add-refusal">
          <span aria-hidden>⛔</span>
          <span>{refusal.reason}</span>
          {refusal.ref && <RefChip refValue={refusal.ref} className={TOUCH_CHIP} />}
        </p>
      )}
      {(quote.error || quote.priceMissing) && (
        <p id={errorId} className="text-xs text-warn" data-testid="gear-add-error">
          {quote.error ?? 'The books print no price this can read; type what it costs each.'}
        </p>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          className={`btn px-3 py-1.5 ${shut ? 'cursor-not-allowed opacity-60' : 'btn-accent'}`}
          {...(shut ? { 'aria-disabled': true } : {})}
          aria-describedby={describedBy}
          onClick={() => {
            if (!shut) p.onAdd();
          }}
          data-testid="gear-add-confirm"
          data-refused={shut ? 'yes' : 'no'}
        >
          {addLabel(hit.name, quote)}
        </button>
        <button type="button" className="btn px-3 py-1.5" onClick={p.onCancel} data-testid="gear-add-cancel">
          not now
        </button>
      </div>
    </div>
  );
}

export interface AddPanelProps {
  hit: CatalogueHit;
  ctx: QuoteContext;
  onAdd: (draft: DraftQuote) => void;
  onCancel: () => void;
}

/** The live panel: the draft, and the engine asked about it and the choices beside it. */
export default function AddPanel({ hit, ctx, onAdd, onCancel }: AddPanelProps) {
  const [draft, setDraft] = useState<PurchaseDraft>(() => initialDraft(hit));
  const quote = useMemo(() => quoteDraft(hit, draft, ctx), [hit, draft, ctx]);
  const qtyRefusal = useMemo(() => draftRefusal(hit, { ...draft, qty: draft.qty + 1 }, ctx), [hit, draft, ctx]);
  const ratingRefusal = useMemo(
    () => (draft.rating === null ? null : draftRefusal(hit, { ...draft, rating: draft.rating + 1 }, ctx)),
    [hit, draft, ctx],
  );
  const gradeRefusals = useMemo(() => {
    if (draft.grade === null) return {};
    const out: Partial<Record<AugmentGrade, Refusal | null>> = {};
    for (const option of gradeOptions()) {
      if (!option.atCreation || option.grade === draft.grade) continue;
      out[option.grade] = draftRefusal(hit, { ...draft, grade: option.grade }, ctx);
    }
    return out;
  }, [hit, draft, ctx]);
  return (
    <AddPanelView
      hit={hit}
      draft={draft}
      quote={quote}
      budgets={ctx.budgets}
      onDraft={setDraft}
      onAdd={() => onAdd(quote)}
      onCancel={onCancel}
      qtyRefusal={qtyRefusal}
      ratingRefusal={ratingRefusal}
      gradeRefusals={gradeRefusals}
    />
  );
}
