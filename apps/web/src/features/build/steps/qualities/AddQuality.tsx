/**
 * Adding a quality: the questions a picked row still asks, and the form for
 * a quality in no book the campaign shares (FR3.9, docs/CHARGEN.md §4.4 Step
 * 5 "a rating-scaled quality asks for its rating").
 *
 * A row from the books often cannot go straight onto the build. Priced per
 * rating, it needs a rating (`RatingPicker`, refusing past the book's maximum
 * or the cap); priced as a band ("4 to 20 Karma"), it needs the Karma the
 * table settled on; priced as a list ("7 or 14 Karma"), it offers only the
 * listed amounts as cards, never a stepper that walks through 8 to 13; a row that does not say which side it is on needs a
 * side; a quality that names an attribute, skill or group needs that named.
 * So the tap opens this panel with those questions, the price quoted against
 * the Karma pool (`CostQuote`), and one button that adds the line.
 *
 * That button refuses before the fact, in the validator's own words: the
 * candidate is probed (`readPending` in `model.ts`) and a refusal that
 * belongs to the quality — Lucky with Exceptional Attribute, Distinctive
 * Style with Blandness, a second of a once-only quality, the cap passed, a
 * Magic or metatype fence — is a sentence under the button with its page,
 * tied to it by `aria-describedby`, the button left focusable
 * (`aria-disabled`). What adding it would flag on another step (a group the
 * runner already owns that Incompetent would close) is said too, as a
 * consequence the player may accept.
 *
 * "Write your own" is the same path for a quality typed by hand: name, side,
 * Karma and, if there is one, the page — it becomes a row through the sheet's
 * `customHit` and then goes through the same panel, so a hand-typed
 * "Exceptional Attribute" still asks which attribute and still refuses beside
 * Lucky.
 */
import { useEffect, useId, useRef } from 'react';
import type { BuildStep, Budgets, QualityType } from '@safehouse/contracts';
import { RefChip } from '../../../gm/books/RefChip.js';
import LimitStepper from '../../components/LimitStepper.js';
import ChoiceCards from '../../kit/ChoiceCards.js';
import CostQuote from '../../kit/CostQuote.js';
import RatingPicker from '../../kit/RatingPicker.js';
import { hitRef } from '../../kit/mappers.js';
import { hitPrice } from '../../kit/catalogue.js';
import { stepMeta } from '../meta.js';
import { FIELD_CLASS } from './ModifierEditor.js';
import type { TargetChoices } from './QualityList.js';
import {
  TARGET_QUESTION,
  customQualityProblem,
  effectLines,
  type CustomQualityDraft,
  type PendingQuality,
  type PendingReading,
} from './model.js';

const SIDE_CHOICES = [
  { value: 'positive' as const, title: 'Positive', detail: 'costs Karma' },
  { value: 'negative' as const, title: 'Negative', detail: 'gives Karma' },
];

export interface PendingPanelProps {
  pending: PendingQuality;
  reading: PendingReading;
  budgets: Budgets;
  targets: TargetChoices;
  onChange(patch: Partial<Omit<PendingQuality, 'hit'>>): void;
  onConfirm(): void;
  onCancel(): void;
  onGoTo(step: BuildStep): void;
}

export function PendingPanel({ pending, reading, budgets, targets, onChange, onConfirm, onCancel, onGoTo }: PendingPanelProps) {
  const headingId = useId();
  const reasonId = useId();
  const quoteId = useId();
  const targetId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const { hit } = pending;
  const { needs, line, verdict } = reading;
  const ref = hitRef(hit);
  const type: QualityType = line?.type ?? pending.type;
  const effects = effectLines(needs.entry);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: false });
  }, [hit.id, hit.name]);

  const describedBy = [line ? quoteId : null, reading.canAdd ? null : reasonId].filter(Boolean).join(' ');

  return (
    <section
      aria-labelledby={headingId}
      className="space-y-3 rounded-md border border-cyan-dim/60 bg-deck p-3"
      data-testid="quality-pending"
      data-can-add={reading.canAdd ? 'yes' : 'no'}
    >
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1 basis-40">
          <h3 id={headingId} ref={headingRef} tabIndex={-1} className="break-words text-sm font-semibold text-ink outline-none">
            Adding {hit.name}
          </h3>
          <p className="text-xs text-dim">{hitPrice(hit) ?? 'Karma not printed'}</p>
        </div>
        {ref && <RefChip refValue={ref} className="pointer-coarse:min-h-10" />}
      </div>

      {effects.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-4 text-xs text-dim" aria-label={`What ${hit.name} changes at creation`}>
          {effects.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
      {needs.entry?.needsApproval && (
        <p className="text-xs text-magenta" data-testid="quality-pending-approval">
          <span aria-hidden>? </span>The GM decides whether this runner may take it.
        </p>
      )}

      {needs.askType && (
        <ChoiceCards
          label={`Is ${hit.name} positive or negative?`}
          choices={SIDE_CHOICES}
          value={pending.type}
          onChange={(value) => onChange({ type: value })}
          columns={2}
          testId="quality-pending-type"
        />
      )}

      {needs.rating && (
        <RatingPicker
          itemName={hit.name}
          value={pending.rating}
          min={needs.rating.min}
          max={needs.rating.max}
          onChange={(rating) => onChange({ rating })}
          refuseIncrease={reading.ratingRefusal}
          testId="quality-pending-rating"
        />
      )}

      {needs.band && line && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="quality-pending-band">
          <LimitStepper
            label={`Karma for ${hit.name}`}
            value={line.karma}
            min={needs.band.min}
            max={needs.band.max}
            onChange={(karma) => onChange({ karma })}
            refuseIncrease={reading.bandRefusal}
          />
          <span className="mono-label text-faint">
            {needs.band.min} to {needs.band.max} Karma, as the table agrees
          </span>
        </div>
      )}

      {needs.choices && line && (
        <div className="space-y-1" data-testid="quality-pending-choices">
          <ChoiceCards
            label={`Karma for ${hit.name}`}
            choices={reading.choiceReadings.map((c) => ({
              value: String(c.karma),
              title: `${c.karma} Karma`,
              ...(c.refusal ? { refusal: c.refusal } : {}),
            }))}
            value={String(line.karma)}
            onChange={(value) => onChange({ karma: Number(value) })}
            columns={2}
            testId="quality-pending-choice"
          />
          <p className="mono-label text-faint">the book lists only these amounts</p>
        </div>
      )}

      {needs.target && (
        <label htmlFor={targetId} className="block max-w-sm">
          <span className="mono-label block">{TARGET_QUESTION[needs.target]}</span>
          <select
            id={targetId}
            className={FIELD_CLASS}
            value={pending.target}
            onChange={(e) => onChange({ target: e.target.value })}
            data-testid="quality-pending-target"
          >
            <option value="">choose…</option>
            {needs.target === 'attribute' &&
              targets.attribute.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            {needs.target === 'group' &&
              targets.group.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            {needs.target === 'skill' &&
              targets.skill.map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {g.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </optgroup>
              ))}
          </select>
        </label>
      )}

      {verdict.breaks.length > 0 && (
        <div className="space-y-1" data-testid="quality-pending-breaks">
          <p className="text-xs text-warn">Taking it would also flag this elsewhere:</p>
          <ul className="space-y-1">
            {verdict.breaks.map((issue, i) => (
              <li key={`${issue.code}-${i}`} className="flex flex-wrap items-center gap-1.5 text-xs text-warn">
                <span aria-hidden>!</span>
                <span>{issue.message}</span>
                <RefChip refValue={issue.ref} />
                {issue.step !== 5 && (
                  <button
                    type="button"
                    className="chip text-dim hover:text-cyan pointer-coarse:min-h-10"
                    onClick={() => onGoTo(issue.step)}
                    aria-label={`step ${issue.step} — go to ${stepMeta(issue.step).title}`}
                  >
                    step {issue.step}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-edge/70 pt-2">
        <button
          type="button"
          className={`btn px-3 py-1.5 ${reading.canAdd ? 'btn-accent' : 'cursor-not-allowed opacity-60'}`}
          aria-label={`add ${hit.name} to the ${type} qualities`}
          {...(reading.canAdd ? {} : { 'aria-disabled': true })}
          {...(describedBy ? { 'aria-describedby': describedBy } : {})}
          onClick={() => {
            if (reading.canAdd) onConfirm();
          }}
          data-testid="quality-pending-add"
        >
          add {hit.name}
        </button>
        <button type="button" className="btn px-3 py-1.5" onClick={onCancel} data-testid="quality-pending-cancel">
          cancel
        </button>
        {line && <CostQuote id={quoteId} amount={type === 'negative' ? -line.karma : line.karma} budgets={budgets} />}
      </div>
      {!reading.canAdd && (
        <div id={reasonId} className="space-y-1" data-testid="quality-pending-refusal">
          {reading.lineError && <p className="text-xs text-warn">{reading.lineError}</p>}
          {verdict.refusals.map((issue, i) => (
            <p key={`${issue.code}-${i}`} className="flex flex-wrap items-center gap-1.5 text-xs text-warn" data-issue={issue.code}>
              <span aria-hidden>⛔</span>
              <span>{issue.message}</span>
              <RefChip refValue={issue.ref} />
            </p>
          ))}
        </div>
      )}
    </section>
  );
}

export interface CustomQualityFormProps {
  draft: CustomQualityDraft;
  onDraft(patch: Partial<CustomQualityDraft>): void;
  onSubmit(): void;
  /** A submit was tried, so a problem is worth saying. */
  tried: boolean;
}

export function CustomQualityForm({ draft, onDraft, onSubmit, tried }: CustomQualityFormProps) {
  const problemId = useId();
  const problem = customQualityProblem(draft);
  const show = tried && problem !== null;
  return (
    <form
      className="space-y-3 rounded-md border border-edge bg-deck/60 p-3"
      data-testid="quality-custom"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <p className="text-xs text-dim">For a quality in no book this campaign shares, or one the GM wrote: your own words, its Karma, and its page if it has one.</p>
      <p className="text-xs text-magenta" data-testid="quality-custom-gm">
        <span aria-hidden>? </span>A quality written here waits on the GM, who decides whether it stands at that Karma.
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="mono-label block">Name</span>
          <input
            className={FIELD_CLASS}
            value={draft.name}
            onChange={(e) => onDraft({ name: e.target.value })}
            data-testid="quality-custom-name"
          />
        </label>
        <label className="block">
          <span className="mono-label block">Karma</span>
          <input
            className={FIELD_CLASS}
            inputMode="numeric"
            value={draft.karma}
            placeholder="e.g. 5"
            onChange={(e) => onDraft({ karma: e.target.value })}
            data-testid="quality-custom-karma"
          />
        </label>
        <div className="flex gap-2">
          <label className="block w-20">
            <span className="mono-label block">Book</span>
            <input className={FIELD_CLASS} value={draft.book} placeholder="e.g. SR5" onChange={(e) => onDraft({ book: e.target.value })} data-testid="quality-custom-book" />
          </label>
          <label className="block w-24">
            <span className="mono-label block">Page</span>
            <input
              className={FIELD_CLASS}
              inputMode="numeric"
              value={draft.page}
              onChange={(e) => onDraft({ page: e.target.value })}
              data-testid="quality-custom-page"
            />
          </label>
        </div>
      </div>
      <ChoiceCards
        label="Positive or negative"
        choices={SIDE_CHOICES}
        value={draft.type}
        onChange={(type) => onDraft({ type })}
        columns={2}
        testId="quality-custom-type"
      />
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className="btn btn-accent px-3 py-1.5" {...(show ? { 'aria-describedby': problemId } : {})} data-testid="quality-custom-add">
          add {draft.name.trim() || 'this quality'}
        </button>
        {show && (
          <p id={problemId} className="text-xs text-warn" role="alert" data-testid="quality-custom-problem">
            {problem}
          </p>
        )}
      </div>
    </form>
  );
}
