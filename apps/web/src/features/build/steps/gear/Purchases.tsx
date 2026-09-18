/**
 * What the runner has bought, grouped the way the sheet will list it (FR3.9,
 * docs/CHARGEN.md §4.4 Step 7, §8.3 "purchases carry grade, rating, qty, unit
 * cost, avail, essence").
 *
 * Each line reads the way a player checks a receipt: the unit price times
 * the quantity, the grade and the Essence it costs at that grade, the rating,
 * the Availability with the grade's modifier — every figure the engine's
 * (`lineWords`) — and underneath, whatever the validator says about that one
 * line, in its words and with its page: over the cap, unreadable, Restricted
 * and waiting on the GM, or decided. Each list says what it costs in all, and
 * the section opens with the Essence the implants leave and the Magic or
 * Resonance that leaves, since those are the numbers 'ware moves.
 *
 * "edit" opens one line at a time: the quantity (refusing a count that breaks
 * a cap, and saying what one more would take from Magic), the grade for 'ware
 * (the grades not sold at creation greyed, a grade that would break a cap
 * refusing with the engine's sentence), and the price each for a table that
 * pays its own. The rating is not edited here — a rated row's price and
 * Availability come from the book at that rating, so a different rating is
 * bought again from the shelf. "remove" takes the line out.
 *
 * The GM reviewing a submitted build decides each Restricted or Forbidden
 * line here, beside the line (`actions.setApprovals`).
 */
import { useId, useMemo, useState } from 'react';
import type { AugmentGrade, Budgets, CharacterBuild, ChargenSettings, Issue } from '@safehouse/contracts';
import { qualityEffects } from '@safehouse/rules';
import { RefChip } from '../../../gm/books/RefChip.js';
import type { BuildProber } from '../../analysis.js';
import LimitStepper from '../../components/LimitStepper.js';
import { ChoiceCards, type Choice } from '../../kit/index.js';
import type { BuildUpdater } from '../../session.js';
import type { BuildActions } from '../types.js';
import {
  approvalsByLine,
  formatEssence,
  gradeOptions,
  groupPurchases,
  groupWords,
  issuesForLine,
  lineWords,
  quoteCandidate,
  stepWideIssues,
  typedNumber,
  withPurchaseChange,
  withoutPurchase,
  type LineApproval,
  type QuoteContext,
} from './gear.js';
import { GearSection, IssueNotes, SubHeading, TOUCH_CHIP } from './parts.js';

export interface PurchasesProps {
  build: CharacterBuild;
  settings: ChargenSettings;
  budgets: Budgets;
  issues: readonly Issue[];
  probe: BuildProber;
  update: (fn: BuildUpdater) => void;
  readOnly: boolean;
  reviewMode: boolean;
  actions: Pick<BuildActions, 'setApprovals' | 'busy'>;
  /** The line open for editing, by index. */
  editing: number | null;
  onEdit: (index: number | null) => void;
}

/** The quantity, grade and price of one line, each change asked of the engine first. */
function LineEditor({ index, ctx, update, onDone }: { index: number; ctx: QuoteContext; update: PurchasesProps['update']; onDone: () => void }) {
  const line = ctx.build.purchases[index];
  const lossId = useId();
  const [price, setPrice] = useState(() => String(line?.cost ?? ''));
  const up = useMemo(
    () => (line ? quoteCandidate(withPurchaseChange(ctx.build, index, { qty: line.qty + 1 }), `gear:line:${index}:qty:${line.qty + 1}`, ctx) : null),
    [ctx, index, line],
  );
  const grades = useMemo((): Choice<AugmentGrade>[] => {
    if (!line || line.list !== 'augments') return [];
    return gradeOptions().map((option) => {
      if (option.refusal || option.grade === line.grade) return { value: option.grade, title: option.label, detail: option.detail, refusal: option.refusal };
      const q = quoteCandidate(withPurchaseChange(ctx.build, index, { grade: option.grade }), `gear:line:${index}:grade:${option.grade}`, ctx);
      const loss = q.loss ? ` · takes ${q.loss.attribute} to ${q.loss.after}` : '';
      return { value: option.grade, title: option.label, detail: `${option.detail}${loss}`, refusal: q.refusal };
    });
  }, [ctx, index, line]);
  if (!line) return null;
  return (
    <div className="space-y-3 rounded-md border border-edge bg-deck/60 p-3" data-testid="gear-line-editor">
      <div className="space-y-1">
        <LimitStepper
          label={`Quantity of ${line.name}`}
          value={line.qty}
          min={1}
          onChange={(qty) => update((b) => withPurchaseChange(b, index, { qty }))}
          refuseIncrease={up?.refusal ?? null}
          {...(up?.loss && !up.refusal ? { increaseDescribedBy: lossId } : {})}
          testId="gear-line-qty"
        />
        {up?.loss && !up.refusal && (
          // Read with the + button it warns about; the glyph stays beside the sentence however narrow.
          <p id={lossId} className="flex items-baseline gap-1.5 text-xs text-warn" data-testid="gear-line-loss">
            <span aria-hidden className="shrink-0">
              ⚠
            </span>
            <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1">
              <span>
                One more takes {up.loss.attribute} from {up.loss.before} to {up.loss.after}.
              </span>
              <RefChip refValue={up.loss.ref} className={TOUCH_CHIP} />
            </span>
          </p>
        )}
      </div>
      {line.list === 'augments' && line.grade && (
        <ChoiceCards
          label={`Grade of ${line.name}`}
          choices={grades}
          value={line.grade}
          onChange={(grade) => update((b) => withPurchaseChange(b, index, { grade }))}
          columns={2}
          testId="gear-line-grade"
        />
      )}
      <label className="flex flex-col gap-0.5">
        <span className="mono-label">Price each, in nuyen, before grade</span>
        <input
          className="w-full rounded-md border border-edge bg-deck px-2.5 py-1.5 text-sm text-ink focus:border-cyan focus:outline-none sm:w-40"
          inputMode="numeric"
          value={price}
          onChange={(e) => {
            setPrice(e.target.value);
            const n = typedNumber(e.target.value);
            if (n !== null) update((b) => withPurchaseChange(b, index, { cost: n }));
          }}
          data-testid="gear-line-price"
        />
      </label>
      <button type="button" className="btn px-3 py-1" onClick={onDone} data-testid="gear-line-done">
        done
      </button>
    </div>
  );
}

/** What the GM has made of a Restricted or Forbidden line, and — reviewing — the two ways to decide it. */
function ApprovalRow({ approval, reviewMode, actions }: { approval: LineApproval; reviewMode: boolean; actions: PurchasesProps['actions'] }) {
  const { issue, decision } = approval;
  const words = decision === 'approved' ? 'the GM said yes' : decision === 'denied' ? 'the GM said no' : 'needs the GM';
  const tone = decision === 'approved' ? 'text-ok' : decision === 'denied' ? 'text-danger' : 'text-magenta';
  const busy = actions.busy === 'approvals';
  const decide = (d: 'approved' | 'denied') => {
    if (!busy) void actions.setApprovals({ [issue.code]: d }).catch(() => undefined);
  };
  return (
    <li className="flex flex-wrap items-center gap-1.5 text-xs" data-approval={issue.code} data-decision={decision ?? 'undecided'}>
      <span className={`mono-label ${tone}`}>{words}</span>
      <span className="text-ink">{issue.message}</span>
      <RefChip refValue={issue.ref} className={TOUCH_CHIP} />
      {reviewMode && (
        <span className="flex gap-1.5">
          {decision !== 'approved' && (
            <button type="button" className="btn px-3 py-1" {...(busy ? { 'aria-disabled': true } : {})} onClick={() => decide('approved')} aria-label={`approve: ${issue.message}`}>
              approve
            </button>
          )}
          {decision !== 'denied' && (
            <button type="button" className="btn px-3 py-1" {...(busy ? { 'aria-disabled': true } : {})} onClick={() => decide('denied')} aria-label={`deny: ${issue.message}`}>
              deny
            </button>
          )}
        </span>
      )}
    </li>
  );
}

export default function Purchases(props: PurchasesProps) {
  const { build, settings, budgets, issues, probe, update, readOnly, reviewMode, actions, editing, onEdit } = props;
  const headingId = useId();
  const ctx = useMemo((): QuoteContext => ({ build, settings, budgets, probe }), [build, settings, budgets, probe]);
  const effects = useMemo(() => qualityEffects(build), [build]);
  const groups = useMemo(() => groupPurchases(build.purchases, effects), [build.purchases, effects]);
  const approvals = useMemo(() => approvalsByLine(build, settings), [build, settings]);
  const wide = stepWideIssues(issues);
  const preview = budgets.preview;
  const attribute =
    preview?.magic !== undefined ? `Magic ${preview.magic}` : preview?.resonance !== undefined ? `Resonance ${preview.resonance}` : null;
  return (
    <GearSection
      headingId={headingId}
      title="Bought"
      aside={
        <span className="mono-label text-dim" data-testid="gear-essence">
          Essence {formatEssence(preview?.essence ?? 6)}
          {attribute ? ` · ${attribute}` : ''}
        </span>
      }
      testId="gear-purchases"
    >
      <IssueNotes issues={wide} testId="gear-step-issues" />
      {groups.length === 0 && (
        <p className="text-sm text-dim" data-testid="gear-purchases-empty">
          {readOnly ? 'Nothing was bought.' : 'Nothing bought yet. Open a shelf above, or start from the list of what most runners need.'}
        </p>
      )}
      {groups.map((group) => {
        const groupId = `${headingId}-${group.list}`;
        return (
          <div key={group.list} className="space-y-1" data-testid="gear-group" data-list={group.list}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <SubHeading id={groupId}>{group.title}</SubHeading>
              <span className="mono-label text-faint">{groupWords(group)}</span>
            </div>
            <ul aria-labelledby={groupId} className="divide-y divide-edge/60">
              {group.lines.map(({ purchase, index }) => {
                // The GM's part (a denied item turns error) is the approval row's to say, once.
                const lineIssues = issuesForLine(issues, index).filter((i) => i.severity !== 'approval' && !i.code.startsWith('approval-'));
                const lineApprovals = approvals.get(index) ?? [];
                return (
                  <li key={index} className="space-y-1.5 py-2" data-testid="gear-line" data-index={index}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 flex-1 text-sm text-ink">
                        {purchase.name}
                        {purchase.qty > 1 && <span className="text-dim"> × {purchase.qty}</span>}
                      </span>
                      {purchase.ref && <RefChip refValue={purchase.ref} className={TOUCH_CHIP} />}
                      {!readOnly && (
                        <>
                          <button
                            type="button"
                            className="btn px-3 py-1"
                            aria-expanded={editing === index}
                            aria-label={`edit ${purchase.name}`}
                            onClick={() => onEdit(editing === index ? null : index)}
                            data-testid="gear-line-edit"
                          >
                            edit
                          </button>
                          <button
                            type="button"
                            className="btn px-3 py-1"
                            aria-label={`remove ${purchase.name}`}
                            onClick={() => {
                              if (editing !== null) onEdit(null);
                              update((b) => withoutPurchase(b, index));
                            }}
                            data-testid="gear-line-remove"
                          >
                            remove
                          </button>
                        </>
                      )}
                    </div>
                    <p className="text-xs text-dim" data-testid="gear-line-figures">
                      {lineWords(purchase, effects).join(' · ')}
                    </p>
                    <IssueNotes issues={lineIssues} />
                    {lineApprovals.length > 0 && (
                      <ul className="space-y-1">
                        {lineApprovals.map((approval) => (
                          <ApprovalRow key={approval.issue.code} approval={approval} reviewMode={reviewMode} actions={actions} />
                        ))}
                      </ul>
                    )}
                    {!readOnly && editing === index && <LineEditor key={index} index={index} ctx={ctx} update={update} onDone={() => onEdit(null)} />}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </GearSection>
  );
}
