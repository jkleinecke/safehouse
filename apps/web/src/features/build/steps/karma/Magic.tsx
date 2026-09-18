/**
 * What leftover Karma buys the Awakened and the Emerged (FR3.9,
 * docs/CHARGEN.md §4.4 Step 8 "a spell (5), a complex form (4), Power Points
 * (5), bound spirits and registered sprites (1 per service or task,
 * Force/Level = Magic/Resonance, count ≤ Charisma), foci to bond (the Focus
 * Table cost, total Force ≤ Magic × 2)").
 *
 * Each part shows only for a runner who can use it — the engine's
 * `knowsFormulaGroup`, `summonsSpirits`, `usesMagic`, `usesResonance` and the
 * magic kind's power-point row decide — or who already bought one, so a
 * spend a later change made illegal can still be seen and released.
 *
 * - **Spells and complex forms** come from the campaign's books through the
 *   kit's `CataloguePicker`, mounted only while open (so the step renders
 *   without a query client until a player asks for the list). The price is
 *   quoted on the button that opens it; whether one more may be learned at
 *   all is probed before it opens, and each picked row is probed again with
 *   its own category, refusing with the validator's sentence (a ritual
 *   over its own cap) rather than adding a line the rail would turn red.
 * - **Power points** for a mystic adept: a stepper whose refusal is the
 *   validator's "no more than Magic".
 * - **Bound spirits and registered sprites**: each line's services or tasks on
 *   a stepper, one Karma apiece; binding another is refused past Charisma.
 * - **Foci**: a focus must be bought before it is bonded, so the gear lines
 *   that read as foci are offered to bond — the engine's pairing says which
 *   still have a free bond — at the Force they were bought at, the Focus
 *   Table's Karma quoted before the tap. With none bought, the section says
 *   so and offers step 7.
 */
import { useId, useState } from 'react';
import { FOCUS_FORCE_MAX, INITIATION_GRADE_MAX, type KarmaSpend } from '@safehouse/contracts';
import {
  FOCUS_LIMITS,
  FOCUS_TYPES,
  FOCUS_TYPE_IDS,
  INITIATION_REFS,
  MAGIC_KIND_TABLE,
  effectiveTables,
  SPIRIT_TYPES_REF,
  SPIRIT_TYPE_IDS,
  SPRITE_TYPE_IDS,
  KARMA_COSTS,
  knowsFormulaGroup,
  powerPointsBought,
  setPowerPointsBought,
  summonsSpirits,
  usesMagic,
  usesResonance,
  type FocusType,
} from '@safehouse/rules';
import type { Refusal } from '../../components/LimitStepper.js';
import LimitStepper, { SplitStepper } from '../../components/LimitStepper.js';
import CataloguePicker from '../../kit/CataloguePicker.js';
import CostQuote from '../../kit/CostQuote.js';
import PoolLine from '../../kit/PoolLine.js';
import WhyLink from '../../kit/WhyLink.js';
import { hitToPick } from '../../kit/mappers.js';
import type { CatalogueHit } from '../../../sheet/catalogue/toSheet.js';
import {
  companionSpend,
  focusCandidates,
  focusSpend,
  initiateGrade,
  knownPickIds,
  setInitiateGrade,
  spendsOfKind,
  withSpendAt,
  withoutSpend,
  type FocusCandidate,
} from './logic.js';
import { ConsequenceNote, EmptyLine, RefusalLine, Section, SubHeading, TapButton, WAITING, inputClass, labelClass } from './parts.js';
import type { KarmaSectionProps } from './taps.js';

const FORMULA_GROUPS = ['spells', 'rituals', 'preparations'] as const;

/** "an air spirit", "a fire spirit". */
const withArticle = (words: string): string => `${/^[aeiou]/i.test(words) ? 'an' : 'a'} ${words}`;

/** Which parts of this section the runner sees. */
export function magicParts(step: Pick<KarmaSectionProps['step'], 'build' | 'settings'>): {
  spells: boolean;
  forms: boolean;
  powerPoints: boolean;
  initiation: boolean;
  spirits: boolean;
  sprites: boolean;
  foci: boolean;
} {
  const b = step.build;
  const has = (kind: KarmaSpend['kind']) => b.karma.spends.some((s) => s.kind === kind);
  // Initiation is the prime runner's alone at creation (SR5 p.64, p.98), and
  // the level is the campaign's, so the preset the engine ran with decides —
  // the same read Step 1 prints "Initiation at creation: allowed" from.
  const canInitiate = effectiveTables(b, step.settings).preset.canInitiate;
  return {
    spells: FORMULA_GROUPS.some((g) => knowsFormulaGroup(b.magic, g)) || has('spell'),
    forms: usesResonance(b) || has('form'),
    powerPoints: MAGIC_KIND_TABLE[b.magic.kind].powerPoints === 'karma' || has('powerPoint'),
    initiation: (canInitiate && (usesMagic(b) || usesResonance(b))) || has('initiation'),
    spirits: summonsSpirits(b.magic) || has('spirit'),
    sprites: usesResonance(b) || has('sprite'),
    foci: usesMagic(b) || has('focus'),
  };
}

// ---------------------------------------------------------------------------
// Spells and complex forms
// ---------------------------------------------------------------------------

function Formulae({ step, taps, readOnly, kind }: KarmaSectionProps & { kind: 'spell' | 'form' }) {
  const [open, setOpen] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const toggleId = useId();
  const b = step.build;
  const spell = kind === 'spell';
  const noun = spell ? 'spell' : 'complex form';
  const granted = spell ? b.grants.spells.length : b.grants.forms.length;
  const learned = spendsOfKind(b, kind);
  // One more of the kind this runner may know, probed before the list opens.
  const group = spell ? (FORMULA_GROUPS.find((g) => knowsFormulaGroup(b.magic, g)) ?? 'spells') : null;
  const stand: KarmaSpend = spell
    ? { kind: 'spell', name: 'probe', ...(group === 'rituals' ? { category: 'ritual' } : group === 'preparations' ? { category: 'preparation' } : {}) }
    : { kind: 'form', name: 'probe' };
  const any = taps.add(stand, `${kind}:any`);

  /** The spend a row would add, or why the row cannot make one. */
  const spendOf = (hit: CatalogueHit): KarmaSpend | Refusal => {
    try {
      const picked = hitToPick(hit);
      return kind === 'spell' ? { kind: 'spell', ...picked } : { kind: 'form', ...picked };
    } catch (err) {
      return { reason: `${hit.name} cannot be learned from this row: ${err instanceof Error ? err.message : String(err)}` };
    }
  };
  // Each row asked before the tap, with its own category (a ritual over the rituals cap is shut on the row).
  const rowRefusal = (hit: CatalogueHit): Refusal | null => {
    const spend = spendOf(hit);
    if ('reason' in spend) return spend;
    const tap = taps.add(spend, `${kind}:${hit.id}`);
    return tap.gate.open ? null : tap.gate.refusal;
  };

  const pick = (hit: CatalogueHit) => {
    const spend = spendOf(hit);
    if ('reason' in spend) {
      setRefusal(spend);
      return;
    }
    const tap = taps.add(spend, `${kind}:${hit.id}`);
    if (!tap.gate.open) {
      setRefusal(tap.gate.refusal);
      return;
    }
    setRefusal(null);
    step.update(tap.apply);
  };

  return (
    <Section
      title={spell ? 'Spells, rituals and preparations' : 'Complex forms'}
      refValue={KARMA_COSTS.ref}
      lead={spell ? 'Each costs a flat price, and the number known is capped by Magic.' : 'Each costs a flat price, and the number known is capped by Resonance.'}
      testId={spell ? 'karma-spells' : 'karma-forms'}
    >
      <PoolLine budgets={step.budgets} pool={spell ? 'spells' : 'forms'} />
      <p className="text-xs text-dim" data-testid={`karma-${kind}-known`}>
        {granted} from step 4
        {learned.length > 0 ? ` · learned with Karma: ${learned.map((l) => l.spend.name).join(', ')}` : ''}
      </p>
      {!readOnly && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={`btn px-3 ${any.gate.open ? '' : 'cursor-not-allowed opacity-60'}`}
              aria-expanded={open}
              {...(any.gate.open ? {} : { 'aria-disabled': true })}
              aria-describedby={toggleId}
              data-testid={`karma-${kind}-open`}
              data-refused={any.gate.open ? 'no' : 'yes'}
              onClick={() => {
                if (open) setOpen(false);
                else if (any.gate.open) setOpen(true);
              }}
            >
              {open ? `close the ${noun} list` : `learn a ${noun}`}
            </button>
            {any.gate.open && <CostQuote amount={any.price} budgets={step.budgets} id={toggleId} />}
          </div>
          {any.gate.refusal && <RefusalLine refusal={any.gate.refusal} id={toggleId} />}
          <div role="status" aria-live="polite" data-testid={`karma-${kind}-pick-refusal`}>
            {refusal && <RefusalLine refusal={refusal} id={`${toggleId}-pick`} />}
          </div>
          {open && (
            <CataloguePicker
              campaignId={step.campaignId}
              kind={spell ? 'spell' : 'complex_form'}
              caps={step.settings}
              onPick={pick}
              rowRefusal={rowRefusal}
              pickLabel="learn"
              taken={knownPickIds(b, kind)}
              testId={`karma-${kind}-picker`}
            />
          )}
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Power points
// ---------------------------------------------------------------------------

function PowerPoints({ step, taps, readOnly }: KarmaSectionProps) {
  const quoteId = useId();
  const bought = powerPointsBought(step.build);
  const price = taps.priceOf({ kind: 'powerPoint', count: 1 });
  const more = taps.change((b) => setPowerPointsBought(b, bought + 1), `pp:${bought + 1}`, price);
  return (
    <Section title="Power points" refValue={MAGIC_KIND_TABLE.mysticAdept.ref} lead="A mystic adept buys power points with Karma, up to Magic." testId="karma-power-points">
      <PoolLine budgets={step.budgets} pool="powerPoints" />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <LimitStepper
          label="Power points bought"
          value={bought}
          min={0}
          onChange={(n) => step.update((b) => setPowerPointsBought(b, n))}
          refuseIncrease={more.gate.refusal}
          readOnly={readOnly}
          {...(!readOnly && more.gate.open ? { increaseDescribedBy: quoteId } : {})}
          testId="karma-power-points-stepper"
        />
        {!readOnly && more.gate.open && (
          <p id={quoteId} className="text-xs text-dim">
            <span>one more: </span>
            <CostQuote amount={price} budgets={step.budgets} />
          </p>
        )}
      </div>
      {!readOnly && <ConsequenceNote gate={more.gate} />}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Initiation and submersion
// ---------------------------------------------------------------------------

/**
 * A grade of initiation (a magician's, SR5 p.325) or submersion (a
 * technomancer's, p.259), at 10 + grade x 3 Karma. Step 1 has always told a
 * prime table "Initiation at creation: allowed"; this is the control that
 * makes the promise good.
 *
 * A stepper on the grade rather than a list of lines: grades go one at a time
 * from 1 up, because each one's price depends on the one below it, so "grade
 * 2" is two spends and taking it back releases both.
 */
function Initiation({ step, taps, readOnly }: KarmaSectionProps) {
  const quoteId = useId();
  const grade = initiateGrade(step.build);
  const emerged = usesResonance(step.build) && !usesMagic(step.build);
  const noun = emerged ? 'Submersion' : 'Initiation';
  const price = taps.priceOf({ kind: 'initiation', grade: grade + 1 });
  const next = taps.change((b) => setInitiateGrade(b, grade + 1), `initiation:${grade + 1}`, price);
  return (
    <Section
      title={noun}
      refValue={emerged ? INITIATION_REFS.submersion : INITIATION_REFS.initiation}
      lead={`${noun} costs 10 Karma plus 3 for each grade, and only a prime runner takes a grade at creation.`}
      testId="karma-initiation"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <LimitStepper
          label={`${noun} grade`}
          value={grade}
          min={0}
          max={INITIATION_GRADE_MAX}
          onChange={(n) => step.update((b) => setInitiateGrade(b, n))}
          refuseIncrease={next.gate.refusal}
          readOnly={readOnly}
          {...(!readOnly && next.gate.open ? { increaseDescribedBy: quoteId } : {})}
          testId="karma-initiation-stepper"
        />
        {!readOnly && next.gate.open && (
          <p id={quoteId} className="text-xs text-dim">
            <span>grade {grade + 1}: </span>
            <CostQuote amount={price} budgets={step.budgets} />
          </p>
        )}
      </div>
      {!readOnly && <ConsequenceNote gate={next.gate} />}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Bound spirits and registered sprites
// ---------------------------------------------------------------------------

function Companions({ step, taps, readOnly, kind }: KarmaSectionProps & { kind: 'spirit' | 'sprite' }) {
  const spirit = kind === 'spirit';
  // Both are picked from the engine's lists of types (ids only), never typed.
  const types: readonly string[] = spirit ? SPIRIT_TYPE_IDS : SPRITE_TYPE_IDS;
  const [type, setType] = useState<string>(types[0] ?? kind);
  const [count, setCount] = useState(1);
  const typeId = useId();
  const b = step.build;
  const lines = spendsOfKind(b, kind);
  const unit = spirit ? 'service' : 'task';
  const power = spirit ? (step.budgets.preview?.magic ?? step.ratings.attributes.mag.rating) : (step.budgets.preview?.resonance ?? step.ratings.attributes.res.rating);
  const cha = step.ratings.attributes.cha.rating;
  const trimmed = type.trim();
  const draft = trimmed ? companionSpend(kind, trimmed, count) : null;
  const bind = draft ? taps.add(draft, `${kind}:${trimmed.toLowerCase()}:${count}`) : null;
  const perUnit = taps.priceOf(companionSpend(kind, trimmed || kind, 1));
  return (
    <Section
      title={spirit ? 'Bound spirits' : 'Registered sprites'}
      refValue={spirit ? SPIRIT_TYPES_REF : KARMA_COSTS.ref}
      lead={
        spirit
          ? `Each is bound at Force ${power} (your Magic), one Karma per service; Charisma ${cha} is how many may be bound.`
          : `Each is registered at Level ${power} (your Resonance), one Karma per task; Charisma ${cha} is how many may be registered.`
      }
      testId={spirit ? 'karma-spirits' : 'karma-sprites'}
    >
      {lines.length === 0 ? (
        <EmptyLine>{spirit ? 'No spirits bound yet.' : 'No sprites registered yet.'}</EmptyLine>
      ) : (
        <ul className="divide-y divide-edge/60" aria-label={spirit ? 'Bound spirits' : 'Registered sprites'}>
          {lines.map(({ index, spend }, position) => {
            const n = spend.kind === 'spirit' ? spend.services : spend.kind === 'sprite' ? spend.tasks : 0;
            const name = `${spend.type} ${kind}`;
            // Two spirits of one type are told apart by their place in the list.
            const spoken = lines.filter((l) => l.spend.type === spend.type).length > 1 ? `${name} ${position + 1}` : name;
            const more = taps.change(
              (bb) => withSpendAt(bb, index, companionSpend(kind, spend.type, n + 1)),
              `${kind}:${index}:${n + 1}`,
              perUnit,
            );
            return (
              <SplitStepper
                key={index}
                label={`${unit}s owed by the ${spoken}`}
                hideLabel
                value={n}
                min={1}
                max={999}
                onChange={(v) => step.update((bb) => withSpendAt(bb, index, companionSpend(kind, spend.type, v)))}
                refuseIncrease={more.gate.refusal}
                readOnly={readOnly}
                unit={n === 1 ? unit : `${unit}s`}
              >
                {({ controls, refusal }) => (
              <li className="space-y-1 py-2" data-testid={`karma-${kind}`}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="min-w-0 flex-1 basis-32 text-sm text-ink">{name}</span>
                {controls}
                {!readOnly && (
                  <button
                    type="button"
                    className="btn px-3"
                    aria-label={`release the ${spoken}, giving back ${taps.priceOf(spend)} Karma`}
                    data-testid={`karma-${kind}-release`}
                    onClick={() => step.update((bb) => withoutSpend(bb, index))}
                  >
                    release
                  </button>
                )}
                </div>
                {refusal}
              </li>
                )}
              </SplitStepper>
            );
          })}
        </ul>
      )}
      {!readOnly && (
        <div className="space-y-2" data-testid={`karma-add-${kind}`}>
          <SubHeading>{spirit ? 'Bind a spirit' : 'Register a sprite'}</SubHeading>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label htmlFor={typeId} className={labelClass}>
                {spirit ? 'spirit type' : 'sprite type'}
              </label>
              <select id={typeId} className={inputClass} value={type} onChange={(e) => setType(e.target.value)} data-testid={`karma-${kind}-type`}>
                {types.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <LimitStepper label={`${unit}s`} value={count} min={1} max={999} onChange={setCount} />
          </div>
          <TapButton
            label={spirit ? 'bind' : 'register'}
            ariaLabel={`${spirit ? 'bind' : 'register'} ${withArticle(`${trimmed || 'named'} ${kind}`)} owing ${count} ${count === 1 ? unit : `${unit}s`}`}
            gate={bind?.gate ?? WAITING}
            hint={null}
            price={bind?.price ?? null}
            budgets={step.budgets}
            readOnly={readOnly}
            testId={`karma-${kind}-add`}
            onPress={() => {
              if (!bind) return;
              step.update(bind.apply);
              setCount(1);
            }}
          />
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Foci
// ---------------------------------------------------------------------------

function FocusBond({ step, taps, readOnly, candidate }: KarmaSectionProps & { candidate: FocusCandidate }) {
  const choices: readonly FocusType[] = candidate.types.length > 0 ? candidate.types : FOCUS_TYPE_IDS;
  const [type, setType] = useState<FocusType>(choices[0] ?? 'spell');
  const [force, setForce] = useState(candidate.force ?? 1);
  const typeId = useId();
  const p = candidate.purchase;
  const chosenForce = candidate.force ?? force;
  const spend = focusSpend(p, type, chosenForce);
  const tap = taps.add(spend, `focus:${candidate.index}:${type}:${chosenForce}`);
  return (
    <li className="space-y-2 py-2" data-testid="karma-focus-candidate">
      <div className="text-sm text-ink">
        {p.name}
        <span className="text-xs text-faint">
          {' '}
          · {candidate.free} of {p.qty} free to bond{candidate.force !== null ? ` · bought at Force ${candidate.force}` : ''}
        </span>
      </div>
      {!readOnly && (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            {choices.length === 1 ? (
              <p className="text-sm text-ink">
                <span className={labelClass}>focus type</span>
                {type}
              </p>
            ) : (
              <div>
                <label htmlFor={typeId} className={labelClass}>
                  focus type
                </label>
                <select id={typeId} className={inputClass} value={type} onChange={(e) => setType(e.target.value as FocusType)}>
                  {choices.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {candidate.force === null ? (
              <LimitStepper label="Force" value={force} min={1} max={FOCUS_FORCE_MAX} onChange={setForce} />
            ) : (
              <p className="self-end text-sm text-dim">Force {candidate.force}</p>
            )}
          </div>
          <TapButton
            label="bond"
            ariaLabel={`bond ${p.name} as ${withArticle(`${type} focus`)} at Force ${chosenForce}`}
            gate={tap.gate}
            price={tap.price}
            budgets={step.budgets}
            readOnly={readOnly}
            testId="karma-focus-bond"
            onPress={() => step.update(tap.apply)}
          />
        </>
      )}
    </li>
  );
}

function Foci(section: KarmaSectionProps) {
  const { step, readOnly } = section;
  const bought = focusCandidates(step.build);
  const candidates = bought.filter((c) => c.free > 0);
  const anyBought = bought.length > 0;
  return (
    <Section
      title="Foci"
      refValue={FOCUS_LIMITS.creationRef}
      lead="A focus bought on step 7 is bonded here for Karma by its type and Force. Bonded Force in total may not pass twice your Magic."
      testId="karma-foci"
    >
      <PoolLine budgets={step.budgets} pool="foci" />
      <div className="flex flex-wrap items-center gap-2 text-xs text-dim">
        <span>Bonding Karma by focus type:</span>
        <WhyLink refValue={FOCUS_TYPES.spell.ref} label="focus table" />
      </div>
      {candidates.length === 0 ? (
        <div className="space-y-2" data-testid="karma-foci-none">
          <EmptyLine>
            {anyBought ? 'Every focus bought is already bonded.' : 'No focus is in the gear yet: a focus has to be bought before it can be bonded.'}
          </EmptyLine>
          {!readOnly && !anyBought && (
            <button type="button" className="btn px-3" onClick={() => step.goTo(7)} data-testid="karma-foci-gear">
              buy one on step 7
            </button>
          )}
        </div>
      ) : (
        <ul className="divide-y divide-edge/60" aria-label="Foci to bond">
          {candidates.map((c) => (
            <FocusBond key={c.index} {...section} candidate={c} />
          ))}
        </ul>
      )}
    </Section>
  );
}

export default function Magic(section: KarmaSectionProps) {
  const parts = magicParts(section.step);
  const none = !Object.values(parts).some(Boolean);
  if (none) {
    return (
      <p className="text-sm text-faint" data-testid="karma-magic-none">
        Spells, complex forms, spirits, sprites, foci and initiation are for a magical or resonant runner, chosen on step 4.
      </p>
    );
  }
  return (
    <>
      {parts.spells && <Formulae {...section} kind="spell" />}
      {parts.forms && <Formulae {...section} kind="form" />}
      {parts.powerPoints && <PowerPoints {...section} />}
      {parts.initiation && <Initiation {...section} />}
      {parts.spirits && <Companions {...section} kind="spirit" />}
      {parts.sprites && <Companions {...section} kind="sprite" />}
      {parts.foci && <Foci {...section} />}
    </>
  );
}
