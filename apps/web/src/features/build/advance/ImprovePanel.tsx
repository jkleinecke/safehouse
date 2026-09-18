/**
 * Improve with Karma — the character sheet's advancement panel (FR3.7,
 * docs/CHARGEN.md §8.5 "Advancement").
 *
 * The sheet opens this over itself for the character's owner or the GM
 * (never an observer or the table display). It asks three things in order —
 * what kind of improvement, which one, and how far — and before anything is
 * sent it says what the book would charge, how long the training takes, and
 * every rule that stops it, in the same voice as the builder's Step 8: a
 * rating stepper that refuses past its ceiling with the engine's sentence and
 * page (`LimitStepper`), a price quoted against the Karma available, and a
 * confirm button that stays focusable while it is shut, its reason tied to it.
 *
 * A player's confirm asks the GM: the server writes a pending Karma entry
 * carrying the change, the GM approves it in the ledger they already settle
 * at the table, and approval is what puts it on the sheet. The GM's own
 * confirm is applied at once. Training time is shown, never enforced, and so
 * is the per-downtime ceiling a long raise passes (pp. 105–106): the table
 * decides how many downtimes it covers, but nobody has to remember the rule.
 * Below the form, the character's advances with where each stands.
 *
 * Lives in the builder's chunk so it can use the builder's refusing stepper,
 * and is loaded by the sheet only when opened (`SheetPage`, a dynamic
 * import): the sheet itself stays out of the builder's bundle. The view is a
 * pure function of its props for the tests (`ImprovePanelView`); the default
 * export wires it to the ledger query, the advance mutation and the session.
 */
import { useId, useState } from 'react';
import type { KarmaSpend, LedgerEntry, SheetV1 } from '@safehouse/contracts';
import { KARMA_COSTS } from '@safehouse/rules';
import { ApiError } from '../../../api/client.js';
import { getSession } from '../../../api/session.js';
import { useLedger, type CharacterRecord } from '../../sheet/api.js';
import { Sheet } from '../../sheet/components/ui.js';
import LimitStepper, { RefusalNote } from '../components/LimitStepper.js';
import WhyLink from '../kit/WhyLink.js';
import { costQuote } from '../kit/words.js';
import { useAdvance } from './api.js';
import {
  ADVANCE_STATE_WORDS,
  FORMULA_CATEGORIES,
  KNOWLEDGE_CATEGORY_OPTIONS,
  advanceRows,
  confirmWords,
  doneWords,
  draftCurrent,
  draftFor,
  improveCheck,
  improveKinds,
  improveTargets,
  isRated,
  karmaStanding,
  needsSkillTarget,
  pendingSpends,
  settleDraft,
  stepperRefusal,
  trainingWords,
  type ImproveDraft,
  type ImproveKind,
} from './logic.js';

const inputClass =
  'w-full rounded border border-edge bg-ground px-2 py-1.5 text-sm text-ink placeholder:text-faint focus:border-cyan focus:outline-none pointer-coarse:min-h-10';
const labelClass = 'mono-label mb-1 block text-faint';

const STATE_TONE: Readonly<Record<LedgerEntry['state'], string>> = {
  pending: 'border-warn/50 text-warn',
  approved: 'border-ok/50 text-ok',
  rejected: 'text-faint',
};

export interface ImprovePanelViewProps {
  sheet: SheetV1;
  /** The character's ledger entries (the advance ones are listed; all count toward Karma). */
  entries: readonly LedgerEntry[];
  ledgerLoading?: boolean;
  role: 'gm' | 'player';
  draft: ImproveDraft;
  onDraft: (next: ImproveDraft) => void;
  onConfirm: (spend: KarmaSpend) => void;
  busy?: boolean;
  /** The server's refusal of the last request, in its words. */
  error?: string | null;
  /** What the last request did. */
  done?: string | null;
}

function TextField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <input id={id} className={inputClass} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
  testId,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (v: string) => void;
  testId?: string;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <select id={id} className={inputClass} value={value} onChange={(e) => onChange(e.target.value)} {...(testId ? { 'data-testid': testId } : {})}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function ImprovePanelView({ sheet, entries, ledgerLoading = false, role, draft, onDraft, onConfirm, busy = false, error, done }: ImprovePanelViewProps) {
  const quoteId = useId();
  const refusalId = useId();
  const listId = useId();
  const standing = karmaStanding(entries, role);
  const pending = pendingSpends(entries);
  const check = improveCheck(sheet, draft, { pending, available: standing.available });
  const kinds = improveKinds(sheet);
  const targets = improveTargets(sheet, draft.kind);
  const current = draftCurrent(sheet, draft);
  const rows = advanceRows(entries);
  const shut = check.refusal !== null || busy || ledgerLoading;
  const set = (patch: Partial<ImproveDraft>) => onDraft({ ...draft, ...patch });
  const pool = { available: standing.available, spent: 0, remaining: standing.available };
  const price = check.quote ? costQuote(check.quote.cost, 'karma', pool) : null;
  // An engine refusal is the rule saying no; something still to type is said quietly.
  const voice = check.quote ? 'pressed' : 'quiet';

  return (
    <div className="space-y-4" data-testid="improve-panel">
      <div className="space-y-1 text-sm text-dim">
        <p>
          {role === 'gm'
            ? 'Karma buys an improvement at the book’s price. Yours goes on the sheet at once.'
            : 'Karma buys an improvement at the book’s price. The GM approves it in the ledger, and then it goes on the sheet.'}
        </p>
        <p className="flex flex-wrap items-center gap-x-2">
          <span>Training time is shown, not enforced.</span>
          <WhyLink refValue={KARMA_COSTS.ref} />
        </p>
      </div>

      <p className="font-label text-sm text-ink" data-testid="improve-karma">
        {ledgerLoading ? (
          'Reading the ledger…'
        ) : (
          <>
            {standing.available} Karma available
            <span className="text-faint">
              {' '}
              · {standing.approved} approved{standing.pending !== 0 ? `, ${standing.pending} waiting on the GM` : ''}
            </span>
          </>
        )}
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          label="Improve"
          value={draft.kind}
          options={kinds}
          onChange={(v) => onDraft(draftFor(sheet, v as ImproveKind))}
          testId="improve-kind"
        />
        {targets.length > 0 && (
          <SelectField
            label="Which"
            value={draft.target}
            options={targets}
            onChange={(v) => onDraft({ ...draftFor(sheet, draft.kind, v), spec: draft.spec })}
            testId="improve-target"
          />
        )}
        {needsSkillTarget(sheet, draft) && (
          <TextField label="Weapon or vehicle" value={draft.name} onChange={(name) => set({ name })} placeholder="what this skill is for" />
        )}
        {(draft.kind === 'newKnowledge' || draft.kind === 'newLanguage' || draft.kind === 'spell' || draft.kind === 'form') && (
          <TextField
            label="Name"
            value={draft.name}
            onChange={(name) => set({ name })}
            placeholder={draft.kind === 'newLanguage' ? 'the language' : draft.kind === 'newKnowledge' ? 'the knowledge skill' : 'as the book names it'}
          />
        )}
        {draft.kind === 'newKnowledge' && (
          <SelectField label="Category" value={draft.category} options={KNOWLEDGE_CATEGORY_OPTIONS} onChange={(category) => set({ category })} />
        )}
        {draft.kind === 'spell' && (
          <SelectField label="Kind" value={draft.category} options={FORMULA_CATEGORIES} onChange={(category) => set({ category })} />
        )}
        {draft.kind === 'specialization' && (
          <TextField label="Specialisation" value={draft.spec} onChange={(spec) => set({ spec })} placeholder="e.g. a weapon, a place, a field" />
        )}
      </div>

      {isRated(draft.kind) && (
        <div className="flex flex-wrap items-start gap-x-4 gap-y-2" data-testid="improve-rating">
          <LimitStepper
            label="New rating"
            value={draft.to}
            min={(current ?? 0) + 1}
            onChange={(to) => set({ to })}
            refuseIncrease={stepperRefusal(sheet, draft, standing.available)}
            increaseDescribedBy={quoteId}
          />
          <span className="pt-2 text-xs text-faint">from {current ?? '—'}</span>
        </div>
      )}
      <div id={quoteId} className="panel space-y-0.5 p-3" data-testid="improve-quote" aria-live="polite">
        {check.quote ? (
          <>
            <div className="text-sm text-ink">{check.quote.label}</div>
            {price && <div className={`text-xs ${price.short ? 'text-warn' : 'text-dim'}`}>{price.text}</div>}
            <div className="text-xs text-dim">{trainingWords(check.quote.training)}</div>
            {/* What the book says but nothing here enforces — a downtime ceiling the raise passes (§8.5). */}
            {check.quote.notes.map((note) => (
              <div key={note.message} className="flex flex-wrap items-center gap-x-2 text-xs text-warn" data-testid="improve-note">
                <span>{note.message}</span>
                <WhyLink refValue={note.ref} />
              </div>
            ))}
          </>
        ) : (
          <div className="text-xs text-faint">Nothing to price yet.</div>
        )}
      </div>

      {check.refusal && <RefusalNote id={refusalId} refusal={check.refusal} voice={voice} direction="increase" />}

      <button
        type="button"
        className={`btn btn-accent w-full py-2.5 text-sm ${shut ? 'cursor-not-allowed opacity-60' : ''}`}
        aria-disabled={shut ? 'true' : undefined}
        aria-describedby={check.refusal ? refusalId : quoteId}
        data-testid="improve-confirm"
        onClick={() => {
          if (!shut && check.spend) onConfirm(check.spend);
        }}
      >
        {busy ? 'Sending…' : confirmWords(check.quote, role)}
      </button>
      {error && (
        <p role="alert" className="text-xs text-danger" data-testid="improve-error">
          {error}
        </p>
      )}
      {done && (
        <p role="status" className="text-xs text-ok" data-testid="improve-done">
          {done}
        </p>
      )}

      <section aria-labelledby={listId} data-testid="improve-list">
        <h3 id={listId} className="mono-label mb-2 text-dim">
          Advances
        </h3>
        {rows.length === 0 ? (
          <p className="text-sm text-faint">None asked for yet.</p>
        ) : (
          <ul className="divide-y divide-edge/60">
            {rows.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2" data-state={row.state}>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-ink">{row.label}</span>
                  <span className="mono-label text-faint">
                    {row.cost} Karma · {row.training}
                    {row.day ? ` · ${row.day}` : ''}
                  </span>
                </span>
                <span className={`chip shrink-0 ${STATE_TONE[row.state]}`}>{ADVANCE_STATE_WORDS[row.state]}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** An error from the advance route, in its own words. */
export function advanceErrorText(error: unknown): string {
  if (error instanceof ApiError) return error.status === 0 ? 'Could not reach the server. Try again.' : error.message;
  return error instanceof Error ? error.message : 'The request failed.';
}

export interface ImprovePanelProps {
  character: CharacterRecord;
  onClose: () => void;
}

export default function ImprovePanel({ character, onClose }: ImprovePanelProps) {
  const ledger = useLedger(character.id);
  const advance = useAdvance(character.id);
  const role = getSession()?.role === 'gm' ? 'gm' : 'player';
  const [draft, setDraft] = useState<ImproveDraft>(() => draftFor(character.sheet, 'attribute'));
  const [done, setDone] = useState<string | null>(null);
  // The sheet may move under an open panel (an approval lands): never offer a raise to where it already is.
  const settled = settleDraft(character.sheet, draft);

  return (
    <Sheet open onClose={onClose} title="Improve with Karma">
      <ImprovePanelView
        sheet={character.sheet}
        entries={ledger.data ?? []}
        ledgerLoading={ledger.isPending}
        role={role}
        draft={settled}
        onDraft={(next) => {
          setDraft(next);
          setDone(null);
          advance.reset();
        }}
        onConfirm={(spend) =>
          advance.mutate(
            { spend },
            {
              onSuccess: (out) => {
                setDone(doneWords(out.quote.label, role, out.revision));
                setDraft(draftFor(character.sheet, settled.kind, settled.target));
              },
            },
          )
        }
        busy={advance.isPending}
        error={advance.error ? advanceErrorText(advance.error) : null}
        done={done}
      />
    </Sheet>
  );
}
