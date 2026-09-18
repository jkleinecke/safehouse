/**
 * Step 5 — Qualities (FR3.9, docs/CHARGEN.md §4.4 Step 5, §8.1, §8.4).
 *
 * Two lists, positive and negative, side by side from a tablet up and one
 * above the other on a phone, each with its running Karma against the
 * level's cap and the Karma pool above both — the three pools this step
 * spends, said in words where the eye is rather than only on the rail.
 * Qualities are optional: the step is complete when both totals sit within
 * their caps, and an empty step is a complete one.
 *
 * Adding goes through the step kit. The campaign's books are browsed with
 * `CataloguePicker` (kind quality); a picked row becomes a line through
 * `hitToQuality`, after the questions the row asks — a rating, a Karma inside
 * a band, a side, the attribute, skill or group the quality names — in a
 * panel that quotes the price against the Karma pool and refuses, before the
 * fact, with the validator's own sentence (`readPending` probes the
 * candidate: Lucky beside Exceptional Attribute, Distinctive Style beside
 * Blandness, the cap passed). A quality in no shared book is written by hand
 * — name, side, Karma, page — and takes the same path.
 *
 * Each line then carries what the engine knows about it: the whitelisted
 * qualities' effects in our words and their target pickers, "needs the GM"
 * with the GM's decision (and approve / deny for the GM reviewing), a buy-off
 * of a born quality marked as one, every issue pointing at the line, and the
 * modifiers entered by hand for what the page says it does in play. A
 * metatype born with a quality shows it above the lists, with what the
 * metatype itself costs in Karma.
 *
 * When the campaign's books list no qualities at all, "from the books" is a
 * dead end, so the screen opens on "write your own" instead (unless the
 * player already chose), and the empty picker hands over the same switch.
 *
 * The screen holds only what is not the build: the row being added, the
 * hand-written draft, which way of adding is open, and the last "added"
 * note. Every edit is a pure updater from `qualities/model.ts` through
 * `update`. `QualitiesView` is the whole screen as props — what a node test
 * renders — and the default export wires it to the live picker.
 */
import { useCallback, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ApprovalDecision, QualityType } from '@safehouse/contracts';
import { qualityEffects } from '@safehouse/rules';
import type { CatalogueHit } from '../../sheet/catalogue/toSheet.js';
import { RefChip } from '../../gm/books/RefChip.js';
import CataloguePicker from '../kit/CataloguePicker.js';
import PoolLine from '../kit/PoolLine.js';
import { CustomQualityForm, PendingPanel } from './qualities/AddQuality.js';
import QualitySide, { IssueLine, type QualityRowActions, type TargetChoices } from './qualities/QualityList.js';
import {
  EMPTY_CUSTOM_QUALITY,
  QUALITY_SIDES,
  addQuality,
  addQualityMod,
  addedNote,
  attributeTargetOptions,
  bornQualityModels,
  buyOffDraft,
  customQualityHit,
  groupTargetOptions,
  metatypeKarmaNote,
  qualityLists,
  quickAdd,
  readPending,
  removeQuality,
  removeQualityMod,
  setQualityTarget,
  skillTargetOptions,
  startPending,
  takenCatalogueIds,
  undecidedIssues,
  type BornQualityModel,
  type CustomQualityDraft,
  type PendingQuality,
} from './qualities/model.js';
import type { StepProps } from './types.js';

export type AddMode = 'books' | 'custom';

export interface QualitiesViewProps extends StepProps {
  pending: PendingQuality | null;
  onPendingChange(patch: Partial<Omit<PendingQuality, 'hit'>>): void;
  onPendingConfirm(): void;
  onPendingCancel(): void;
  addMode: AddMode;
  onAddMode(mode: AddMode): void;
  custom: CustomQualityDraft;
  onCustom(patch: Partial<CustomQualityDraft>): void;
  customTried: boolean;
  onCustomSubmit(): void;
  onBuyOff(born: BornQualityModel): void;
  /** The last thing added, for the status region. */
  note: string | null;
  /** The catalogue picker (live, or a static view in a test). */
  picker: ReactNode;
}

function BornWith({ props, onBuyOff }: { props: StepProps; onBuyOff: (born: BornQualityModel) => void }) {
  const headingId = useId();
  const born = bornQualityModels(props.build);
  const metatype = metatypeKarmaNote(props.build, props.ratings);
  if (born.length === 0 && !metatype) return null;
  return (
    <section aria-labelledby={headingId} className="panel space-y-2 p-3" data-testid="qualities-born">
      <h2 id={headingId} className="mono-label text-cyan">
        Born with
      </h2>
      {metatype && (
        <p className="flex flex-wrap items-center gap-1.5 text-sm text-dim" data-testid="qualities-metatype-karma">
          <span>{metatype.text}</span>
          <RefChip refValue={metatype.ref} />
        </p>
      )}
      {born.length > 0 && (
        <ul className="space-y-2">
          {born.map((b) => (
            <li key={b.id} className="space-y-1 rounded-md border border-edge bg-deck p-2.5" data-testid="qualities-born-item" data-bought-off={b.buyOffIndex !== null ? 'yes' : 'no'}>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-ink">{b.name}</h3>
                <span className={`chip ${b.buyOffIndex !== null ? 'border-cyan-dim/60 text-cyan' : 'text-dim'}`}>
                  {b.buyOffIndex !== null ? 'bought off' : 'held from birth · gives no Karma'}
                </span>
                <RefChip refValue={b.ref} className="pointer-coarse:min-h-10" />
                {!props.readOnly && b.buyOffIndex === null && (
                  <button type="button" className="btn px-3 py-1" onClick={() => onBuyOff(b)} aria-label={`buy off ${b.name}`} data-testid="qualities-buy-off">
                    buy off
                  </button>
                )}
              </div>
              {b.buyOffIndex === null && (
                <ul className="list-disc space-y-0.5 pl-4 text-xs text-dim" aria-label={`What ${b.name} changes at creation`}>
                  {b.effects.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              )}
              {b.buyOffIndex === null && !props.readOnly && (
                <p className="text-xs text-faint">Buying it off is a positive line of the same name, at the Karma the table agrees.</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function QualitiesView(props: QualitiesViewProps) {
  const { build, settings, allIssues, issues, ratings, budgets, readOnly, reviewMode, update, actions } = props;
  const looseId = useId();
  const addId = useId();

  const lists = useMemo(
    () =>
      qualityLists({
        build,
        allIssues,
        undecided: undecidedIssues(build, settings, allIssues),
        stepIssues: issues,
        effects: qualityEffects(build),
      }),
    [build, settings, allIssues, issues],
  );
  const targets = useMemo<TargetChoices>(
    () => ({ attribute: attributeTargetOptions(build, ratings), skill: skillTargetOptions(ratings), group: groupTargetOptions() }),
    [build, ratings],
  );
  const reading = useMemo(
    () => (props.pending ? readPending(props.pending, props.probe, allIssues) : null),
    [props.pending, props.probe, allIssues],
  );

  const rowActions: QualityRowActions = {
    onRemove: (row) => update(removeQuality(row.index, row.quality.name)),
    onTarget: (row, target) => update(setQualityTarget(row.index, row.quality.name, target)),
    onAddMod: (row, mod) => update(addQualityMod(row.index, row.quality.name, mod)),
    onRemoveMod: (row, modId) => update(removeQualityMod(row.index, row.quality.name, modId)),
    onGoTo: props.goTo,
    onDecide: reviewMode
      ? (code: string, decision: ApprovalDecision) => {
          actions.setApprovals({ [code]: decision }).catch(() => undefined);
        }
      : undefined,
  };

  return (
    <div className="space-y-4" data-testid="qualities-step">
      <div className="space-y-1">
        <PoolLine budgets={budgets} pool="karma" />
        <p className={props.note ? 'text-xs text-ok' : 'sr-only'} role="status" aria-live="polite" data-testid="qualities-note">
          {props.note ? <><span aria-hidden>● </span>{props.note}</> : ''}
        </p>
      </div>

      {lists.loose.length > 0 && (
        <section aria-labelledby={looseId} className="panel space-y-2 p-3" data-testid="qualities-loose">
          <h2 id={looseId} className="mono-label text-warn">
            Checks on the lists
          </h2>
          <ul className="space-y-1">
            {lists.loose.map((issue, i) => (
              <IssueLine key={`${issue.code}-${i}`} issue={issue} />
            ))}
          </ul>
        </section>
      )}

      <BornWith props={props} onBuyOff={props.onBuyOff} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2" data-testid="qualities-lists">
        {QUALITY_SIDES.map((type: QualityType) => (
          <QualitySide
            key={type}
            type={type}
            rows={lists[type]}
            budgets={budgets}
            targets={targets}
            readOnly={readOnly}
            deciding={actions.busy === 'approvals'}
            {...rowActions}
          />
        ))}
      </div>

      {!readOnly && (
        <section aria-labelledby={addId} className="space-y-3" data-testid="qualities-add">
          <h2 id={addId} className="mono-label text-cyan">
            Add a quality
          </h2>
          {props.pending && reading && (
            <PendingPanel
              pending={props.pending}
              reading={reading}
              budgets={budgets}
              targets={targets}
              onChange={props.onPendingChange}
              onConfirm={props.onPendingConfirm}
              onCancel={props.onPendingCancel}
              onGoTo={props.goTo}
            />
          )}
          <div role="group" aria-label="Where the quality comes from" className="flex flex-wrap gap-2">
            {(
              [
                ['books', 'from the books'],
                ['custom', 'write your own'],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                className={`btn px-3 py-1.5 ${props.addMode === mode ? 'border-cyan-dim text-cyan' : ''}`}
                aria-pressed={props.addMode === mode}
                onClick={() => props.onAddMode(mode)}
                data-testid={`qualities-add-${mode}`}
              >
                {label}
              </button>
            ))}
          </div>
          {props.addMode === 'books' ? (
            props.picker
          ) : (
            <CustomQualityForm draft={props.custom} onDraft={props.onCustom} onSubmit={props.onCustomSubmit} tried={props.customTried} />
          )}
        </section>
      )}
    </div>
  );
}

export default function QualitiesStep(props: StepProps) {
  const { probe, allIssues, update } = props;
  const [pending, setPending] = useState<PendingQuality | null>(null);
  const [addMode, setAddMode] = useState<AddMode>('books');
  // Whether the player picked a way of adding; until they do, an empty shelf opens "write your own".
  const choseMode = useRef(false);
  const chooseMode = useCallback((mode: AddMode) => {
    choseMode.current = true;
    setAddMode(mode);
  }, []);
  const onTotal = useCallback((total: number) => {
    if (total === 0 && !choseMode.current) setAddMode('custom');
  }, []);
  const [custom, setCustom] = useState<CustomQualityDraft>(EMPTY_CUSTOM_QUALITY);
  const [customTried, setCustomTried] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  /** Add a row straight away when it asks nothing and nothing refuses; otherwise open the panel. */
  const begin = useCallback(
    (hit: CatalogueHit, over: Partial<Omit<PendingQuality, 'hit'>> = {}): boolean => {
      const p = startPending(hit, over);
      const line = quickAdd(readPending(p, probe, allIssues));
      if (line) {
        update(addQuality(line));
        setNote(addedNote(line));
        setPending(null);
        return true;
      }
      setNote(null);
      setPending(p);
      return false;
    },
    [probe, allIssues, update],
  );

  const picker = (
    <CataloguePicker
      campaignId={props.campaignId}
      kind="quality"
      label="qualities"
      caps={props.settings}
      pickLabel="take"
      taken={takenCatalogueIds(props.build)}
      onPick={(hit) => begin(hit)}
      onTotal={onTotal}
      emptyAction={
        <button type="button" className="btn px-3 py-1.5" onClick={() => chooseMode('custom')} data-testid="quality-picker-write">
          write your own
        </button>
      }
      testId="quality-picker"
    />
  );

  return (
    <QualitiesView
      {...props}
      pending={pending}
      onPendingChange={(patch) => setPending((p) => (p ? { ...p, ...patch } : p))}
      onPendingConfirm={() => {
        if (!pending) return;
        const reading = readPending(pending, probe, allIssues);
        if (!reading.canAdd || !reading.line) return;
        update(addQuality(reading.line));
        setNote(addedNote(reading.line));
        if (pending.hit.id === 'custom') setCustom(EMPTY_CUSTOM_QUALITY);
        setPending(null);
      }}
      onPendingCancel={() => setPending(null)}
      addMode={addMode}
      onAddMode={chooseMode}
      custom={custom}
      onCustom={(patch) => setCustom((d) => ({ ...d, ...patch }))}
      customTried={customTried}
      onCustomSubmit={() => {
        const hit = customQualityHit(custom);
        if (!hit) {
          setCustomTried(true);
          return;
        }
        setCustomTried(false);
        if (begin(hit, { type: custom.type })) setCustom(EMPTY_CUSTOM_QUALITY);
      }}
      onBuyOff={(born) => {
        setCustom(buyOffDraft(born));
        setCustomTried(false);
        setAddMode('custom');
      }}
      note={note}
      picker={picker}
    />
  );
}
