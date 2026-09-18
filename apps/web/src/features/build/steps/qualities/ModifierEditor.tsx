/**
 * The modifiers a player enters by hand for what a quality does in play
 * (FR3.9, docs/CHARGEN.md §4.4 Step 5 "effects the app cannot know are
 * entered as modifiers with the page open beside them", §8.1).
 *
 * The engine applies a handful of qualities' creation rules itself; what the
 * other few hundred do at the table — a point of a limit, a die on a skill,
 * an extra box — lives on their page, and the app never carries that text
 * (DESIGN.md §14). So the player reads the page (its chip sits right here)
 * and says what it changes: a number the derive pipeline reads, how, and by
 * how much. The modifier rides on the quality line into the compiled sheet,
 * where the rail's derived numbers pick it up exactly as play will.
 *
 * The sheet has no modifier editor to reuse — its qualities list shows
 * modifiers but never made them — so this is a small one: a grouped target
 * picker (`MOD_TARGET_GROUPS`), add / set to / cap at, a value, and the
 * modifiers already entered, each removable. The draft is the only local
 * state; the modifiers themselves are the build's, edited through the step's
 * `update` with the pure updaters in `model.ts`.
 */
import { useId, useState } from 'react';
import type { BuildQuality, Modifier, ModifierOp } from '@safehouse/contracts';
import { RefChip } from '../../../gm/books/RefChip.js';
import {
  EMPTY_MOD_DRAFT,
  MOD_OPS,
  MOD_TARGET_GROUPS,
  modDraftProblem,
  modFromDraft,
  modLine,
  newModifierId,
  type ModDraft,
} from './model.js';

export const FIELD_CLASS =
  'w-full rounded border border-edge bg-ground px-2 py-1.5 text-sm text-ink placeholder:text-faint focus:border-cyan focus:outline-none pointer-coarse:min-h-10';

export interface ModifierEditorProps {
  quality: BuildQuality;
  onAdd: (mod: Modifier) => void;
  onRemove: (modId: string) => void;
  readOnly: boolean;
  /** Open the add form on first paint (a test, or a quality just added). */
  initiallyOpen?: boolean;
  testId?: string;
}

export default function ModifierEditor({ quality, onAdd, onRemove, readOnly, initiallyOpen = false, testId = 'quality-mods' }: ModifierEditorProps) {
  const [draft, setDraft] = useState<ModDraft>(EMPTY_MOD_DRAFT);
  const [tried, setTried] = useState(false);
  const problemId = useId();
  const listId = useId();
  const problem = modDraftProblem(draft);
  const set = (patch: Partial<ModDraft>) => setDraft((d) => ({ ...d, ...patch }));

  if (readOnly && quality.mods.length === 0) return null;

  return (
    <div className="space-y-1.5" data-testid={testId}>
      {quality.mods.length > 0 && (
        <ul id={listId} className="space-y-1" aria-label={`Modifiers entered for ${quality.name}`} data-testid={`${testId}-list`}>
          {quality.mods.map((mod) => (
            <li key={mod.id} className="flex flex-wrap items-center gap-2 text-xs text-ink" data-testid={`${testId}-item`}>
              <span className="font-label">{modLine(mod)}</span>
              {!readOnly && (
                <button
                  type="button"
                  className="btn px-2 py-0.5 text-[0.65rem]"
                  aria-label={`remove the modifier ${modLine(mod)} from ${quality.name}`}
                  onClick={() => onRemove(mod.id)}
                  data-testid={`${testId}-remove`}
                >
                  remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!readOnly && (
        <details className="rounded border border-edge/70 bg-ground/40 px-2 py-1.5" {...(initiallyOpen ? { open: true } : {})}>
          <summary className="cursor-pointer py-1 text-xs text-dim pointer-coarse:min-h-10 pointer-coarse:py-2.5">
            {quality.mods.length > 0 ? 'enter another modifier' : 'enter what it changes'}
          </summary>
          <form
            className="mt-1.5 space-y-2"
            data-testid={`${testId}-form`}
            onSubmit={(e) => {
              e.preventDefault();
              setTried(true);
              const mod = modFromDraft(quality, draft, newModifierId());
              if (!mod) return;
              onAdd(mod);
              setDraft(EMPTY_MOD_DRAFT);
              setTried(false);
            }}
          >
            <p className="flex flex-wrap items-center gap-1.5 text-xs text-dim">
              <span>Read the page, then enter the number it moves.</span>
              {quality.ref && <RefChip refValue={quality.ref} className="pointer-coarse:min-h-10" />}
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto_5rem]">
              <label className="block min-w-0">
                <span className="mono-label block">Changes</span>
                <select
                  className={FIELD_CLASS}
                  value={draft.target}
                  onChange={(e) => set({ target: e.target.value })}
                  data-testid={`${testId}-target`}
                >
                  {MOD_TARGET_GROUPS.map((g) => (
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
              <label className="block">
                <span className="mono-label block">How</span>
                <select className={FIELD_CLASS} value={draft.op} onChange={(e) => set({ op: e.target.value as ModifierOp })} data-testid={`${testId}-op`}>
                  {MOD_OPS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mono-label block">Value</span>
                <input
                  className={FIELD_CLASS}
                  inputMode="decimal"
                  value={draft.value}
                  onChange={(e) => set({ value: e.target.value })}
                  {...(tried && problem ? { 'aria-invalid': true, 'aria-describedby': problemId } : {})}
                  data-testid={`${testId}-value`}
                />
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="submit" className="btn px-3 py-1" aria-label={`add modifier to ${quality.name}`} data-testid={`${testId}-add`}>
                add modifier
              </button>
              {tried && problem && (
                <p id={problemId} className="text-xs text-warn" role="alert">
                  {problem}
                </p>
              )}
            </div>
          </form>
        </details>
      )}
    </div>
  );
}
