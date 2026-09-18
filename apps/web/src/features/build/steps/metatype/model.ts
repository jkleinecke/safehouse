/**
 * What the Metatype & attributes screen says, as plain functions (FR3.9,
 * docs/CHARGEN.md §4.4 Step 3) — no JSX, no React, so every sentence and every
 * refusal on the screen is tested as a function under node.
 *
 * The screen is mostly the engine's numbers laid out: the metatype table's
 * base/max, special points and lifestyle multiplier (`METATYPE_TABLE`), every
 * attribute's base, points, Karma and natural maximum (`ratings`), the pools
 * (`budgets`), and the augmented figure play will use (`preview.derived`).
 * What it adds is vocabulary the engine deliberately does not carry — racial
 * traits are ids there (DESIGN.md §14), attribute names are abbreviations —
 * and one question the engine answers only indirectly: *which* of the errors
 * a candidate change would bring should shut this control.
 *
 * That last one matters because a probe sees the whole build. Raising Logic
 * gives more knowledge points and so "introduces" an unspent-knowledge error
 * on step 6; raising Body past a troll's 10 introduces an over-maximum error
 * that the validator files on step 5, where Exceptional Attribute would fix
 * it. The first is not a reason to refuse an attribute point and the second
 * is exactly one. So a control refuses on the caps that belong to it — the
 * attribute's own maximum, the one-at-maximum rule, a metatype not on its
 * row — whichever step the validator filed them under, and with the
 * validator's own sentence and page (which, filed on step 5, names the
 * quality that would allow it). An error the change makes *worse* counts as
 * well as a new one (a third attribute joining two already at maximum
 * changes the sentence, not the code), which is why `worsenedErrors` compares
 * messages rather than using the probe's `introduced` alone.
 *
 * Overspending a pool is not refused here: with a stepper per attribute a
 * refusal would print the same "17 of 16" sentence eight times over, and the
 * pool line, the rail and Next already say it once. That is the step's design
 * call the step contract leaves open (`steps/types.ts`); caps never are.
 *
 * Every word here is ours; numbers, ids and pages are the engine's.
 */
import {
  ATTRIBUTE_CODES,
  PRIORITY_LEVELS,
  type AttributeCode,
  type BuildAttributeId,
  type BuildMode,
  type BuildStep,
  type CharacterBuild,
  type ChargenSettings,
  type DerivedCharacter,
  type Issue,
  type PriorityLevel,
  type PriorityTable,
} from '@safehouse/contracts';
import {
  BUILD_ATTRIBUTE_NAMES,
  METATYPE_ATTRIBUTES,
  METATYPE_BY_ID,
  METATYPE_TABLE,
  issueRule,
  magicRowOffers,
  metatypeRow,
  setAttributePoints,
  setMetatype,
  setSpecialPoints,
  usesMagic,
  usesResonance,
  type AttributeRating,
  type BuildRatings,
  type MetatypeAttribute,
  type MetatypeFamily,
  type MetatypeRow,
  type RacialTrait,
  type RacialTraitId,
} from '@safehouse/rules';
import type { BuildProbe, BuildProber } from '../../analysis.js';
import type { Refusal } from '../../components/LimitStepper.js';
import { canReach, type StepGate } from '../../lib.js';

/** This screen's walkthrough number (§8.7). */
export const METATYPE_STEP: BuildStep = 3;

// ---------------------------------------------------------------------------
// Links to other steps
// ---------------------------------------------------------------------------

/** How the screen moves the walkthrough: `goTo`, offered only where `canGo`. */
export interface StepNav {
  goTo(step: BuildStep): void;
  canGo(step: BuildStep): boolean;
}

/**
 * The shell's `goTo`, with the progress strip's gate beside it. The shell
 * moves to any step it is asked for, so a button here that jumped forward past
 * an unfinished step would walk round guided mode's Next; `canGo` is
 * `canReach` — back always, forward in guided mode only across steps that are
 * complete or skipped, anywhere in free mode.
 */
export function stepNav(input: {
  goTo: (step: BuildStep) => void;
  steps: readonly StepGate[];
  meta: { step: BuildStep };
  mode: BuildMode;
}): StepNav {
  const { goTo, steps, meta, mode } = input;
  return { goTo, canGo: (step) => canReach(steps, step, meta.step, mode) };
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/** The eight in the order the metatype table prints them, then the three special attributes. */
export const EIGHT: readonly AttributeCode[] = ATTRIBUTE_CODES;
export const SPECIAL = ['edg', 'mag', 'res'] as const;
export type SpecialId = (typeof SPECIAL)[number];

// Attribute names and abbreviations are the engine's one map (`BUILD_ATTRIBUTE_NAMES`), so every step names them alike.
const isAttributeId = (s: string | undefined): s is BuildAttributeId => s !== undefined && s in BUILD_ATTRIBUTE_NAMES;

/**
 * Probe keys carry the step, because the probe cache belongs to the draft,
 * not to the screen: another step's "agi+1" (a Karma raise) must never answer
 * for this step's attribute point.
 */
export const probeKey = {
  metatype: (id: string): string => `s3:metatype:${id}`,
  increase: (id: BuildAttributeId, value: number): string => `s3:points:${id}:${value + 1}`,
};

// ---------------------------------------------------------------------------
// Racial traits in plain words
// ---------------------------------------------------------------------------

type TraitWords = string | ((value: number | undefined) => string);

const signed = (v: number | undefined, fallback = 1): string => `+${v ?? fallback}`;

/**
 * Our words for every racial trait id. A trait whose effect is a number the
 * table carries says the number; the rest are named, not described — what a
 * trait does at the table is the book's to say, and the frame's page chip
 * opens it. Typed as a full record, so a trait id added to the engine
 * without words here fails the typecheck.
 */
const TRAIT_WORDS: Readonly<Record<RacialTraitId, TraitWords>> = {
  lowLight: 'low-light vision',
  thermographic: 'thermographic vision',
  reach: (v) => `${signed(v)} Reach`,
  dermalArmor: (v) => `${signed(v)} armor from tough skin`,
  toxinDice: (v) => `${signed(v, 2)} dice against toxins and disease`,
  allergy: 'an allergy',
  arcaneArrester: (v) => (v === undefined ? 'arcane arrester' : `arcane arrester ${v}`),
  armor: (v) => (v === undefined ? 'natural armor' : `natural armor ${v}`),
  astralPerception: 'astral perception',
  balanceReceptor: 'keen balance',
  broadenedAuditorySpectrum: 'wider hearing range',
  celerity: 'celerity',
  coldBlooded: 'cold-blooded',
  concealment: 'natural concealment',
  cyclopeanEye: 'a single eye',
  dermalAlteration: 'altered skin',
  dualNatured: 'dual-natured',
  elongatedLimbs: 'long limbs',
  fangs: 'fangs',
  glamour: 'glamour',
  goringHorns: 'goring horns',
  guard: 'guard',
  hawkEyed: 'hawk-eyed',
  initiativeDice: (v) => `${signed(v)} initiative ${(v ?? 1) === 1 ? 'die' : 'dice'}`,
  keenEared: 'keen hearing',
  magicSense: 'magic sense',
  mimicry: 'mimicry',
  monkeyPaws: 'grasping feet',
  naturalWeapon: 'natural weapons',
  neoteny: 'neoteny',
  nocturnal: 'nocturnal',
  ogreStomach: 'iron stomach',
  pathogenResistance: 'resists disease',
  pathogenToxinResistance: 'resists disease and toxins',
  photometabolism: 'feeds on sunlight',
  poorSelfControl: 'poor self-control',
  prehensileTail: 'prehensile tail',
  satyrLegs: 'hoofed legs',
  search: 'search',
  shift: 'shifts between forms',
  shivaArms: 'a second pair of arms',
  strikingSkinPigmentation: 'striking skin colour',
  symbiosis: 'symbiosis',
  underwaterVision: 'underwater vision',
  uneducated: 'Uneducated from birth',
  unusualHair: 'unusual hair',
  vanishing: 'vanishing',
  venom: 'venom',
  vomeronasalOrgan: 'keen sense of smell',
  webbedDigits: 'webbed fingers and toes',
};

/** One racial trait in our words: "thermographic vision", "+1 Reach". */
export function traitWords(trait: RacialTrait): string {
  const words = TRAIT_WORDS[trait.id];
  return typeof words === 'function' ? words(trait.value) : words;
}

/** Every racial trait a metatype is born with, in our words, in the table's order. */
export function traitsOf(row: Pick<MetatypeRow, 'traits'>): string[] {
  return row.traits.map(traitWords);
}

/** "lifestyles cost ×1.2" for a multiplier above 1; null at 1. */
export function lifestyleWords(multiplier: number): string | null {
  if (!(multiplier > 1)) return null;
  return `lifestyles cost ×${Math.round(multiplier * 100) / 100}`;
}

// ---------------------------------------------------------------------------
// Metatype cards
// ---------------------------------------------------------------------------

export const FAMILY_LABEL: Readonly<Record<MetatypeFamily, string>> = {
  core: 'Metatypes',
  metavariant: 'Metavariants',
  metasapient: 'Metasapients',
  shapeshifter: 'Shapeshifters',
};

const FAMILY_ORDER: readonly MetatypeFamily[] = ['core', 'metavariant', 'metasapient', 'shapeshifter'];

export interface MetatypeGroup {
  family: MetatypeFamily;
  label: string;
  rows: MetatypeRow[];
  /** The chosen metatype is in this group. */
  holdsChoice: boolean;
}

/** The chosen metatype's table id, whatever case the record spells it in; null when none or unknown. */
export function chosenMetatypeId(build: Pick<CharacterBuild, 'metatype'>): string | null {
  return metatypeRow(build.metatype ?? undefined)?.id ?? null;
}

/**
 * The cards to offer, grouped by family in table order: the five core
 * metatypes always; the metavariants, metasapients and shapeshifters when the
 * campaign allows them — and a metatype already on the record even when it
 * does not, so the card that explains the refusal is there to read.
 * `onlyChosen` narrows every group to the chosen card (a read-only view).
 */
export function metatypeGroups(allowMetavariants: boolean, chosen: string | null, onlyChosen = false): MetatypeGroup[] {
  const chosenId = metatypeRow(chosen ?? undefined)?.id ?? null;
  return FAMILY_ORDER.flatMap((family) => {
    const rows = METATYPE_TABLE.filter(
      (row) =>
        row.family === family &&
        (onlyChosen ? row.id === chosenId : family === 'core' || allowMetavariants || row.id === chosenId),
    );
    if (rows.length === 0) return [];
    return [{ family, label: FAMILY_LABEL[family], rows, holdsChoice: rows.some((r) => r.id === chosenId) }];
  });
}

/** The Karma a metatype costs, as its chart prints it (the same on every row it is on); 0 for the core five. */
export function listedKarma(row: Pick<MetatypeRow, 'priority'>): number {
  for (const level of PRIORITY_LEVELS) {
    const cell = row.priority[level];
    if (cell) return cell.karma;
  }
  return 0;
}

/**
 * The figure beside a card's title: special points at the build's row ("7
 * special points", "no special points"), or "not on row C" where the
 * metatype is not on it; null while the build has no Metatype row. Kept to
 * one short figure so it shares a phone-width line with the longest name —
 * the extra Karma a non-core metatype costs is the first line of its body.
 */
export function metatypeAside(row: Pick<MetatypeRow, 'priority'>, level: PriorityLevel | null): string | null {
  if (!level) return null;
  const cell = row.priority[level];
  if (!cell) return `not on row ${level}`;
  return cell.special === 0 ? 'no special points' : `${cell.special} special point${cell.special === 1 ? '' : 's'}`;
}

/** "costs 12 Karma" for a metatype priced beyond its priority; null for the core five. */
export function karmaCostWords(row: Pick<MetatypeRow, 'priority'>): string | null {
  const karma = listedKarma(row);
  return karma > 0 ? `costs ${karma} Karma` : null;
}

/** "A 9 · B 7 · C 5 · D 3 · E –": special points on every row, for a build whose metatype row is not chosen yet. */
export function specialByRow(row: Pick<MetatypeRow, 'priority'>): string {
  return PRIORITY_LEVELS.map((level) => `${level} ${row.priority[level]?.special ?? '–'}`).join(' · ');
}

export interface RangeCell {
  id: MetatypeAttribute;
  short: string;
  name: string;
  base: number;
  max: number;
}

/** The metatype table's base/max for the nine attributes it prints, in its order. */
export function rangesOf(row: Pick<MetatypeRow, 'attributes'>): RangeCell[] {
  return METATYPE_ATTRIBUTES.map((id) => ({
    id,
    ...BUILD_ATTRIBUTE_NAMES[id],
    ...row.attributes[id],
  }));
}

/** The lines under a card's ranges that are not traits: whose variant it is, born Awakened, never Resonance. */
export function metatypeNotes(row: MetatypeRow): string[] {
  const notes: string[] = [];
  if (row.variantOf) notes.push(`${METATYPE_BY_ID[row.variantOf].name} variant`);
  if (row.magic.base > 0) notes.push(`born with Magic ${row.magic.base}`);
  if (row.resonance === null) notes.push('can never have Resonance');
  return notes;
}

/** Everything one metatype card shows, before any JSX. */
export interface MetatypeCard {
  id: string;
  title: string;
  /** Special points at the build's row and the extra Karma (the card's figure). */
  aside: string | null;
  ranges: RangeCell[];
  traits: string[];
  notes: string[];
  lifestyle: string | null;
  /** Special points on every row, while the build has no Metatype priority. */
  byRow: string | null;
  /** The extra Karma this metatype costs; 0 for the core five. */
  karma: number;
  /** That Karma in words ("costs 12 Karma"); null for the core five. */
  karmaWords: string | null;
}

export function metatypeCard(row: MetatypeRow, level: PriorityLevel | null): MetatypeCard {
  return {
    id: row.id,
    title: row.name,
    aside: metatypeAside(row, level),
    ranges: rangesOf(row),
    traits: traitsOf(row),
    notes: metatypeNotes(row),
    lifestyle: lifestyleWords(row.lifestyleMultiplier),
    byRow: level ? null : specialByRow(row),
    karma: listedKarma(row),
    karmaWords: karmaCostWords(row),
  };
}

export interface MetatypeChoiceState {
  card: MetatypeCard;
  /** Why the card cannot be taken (not on the row, not allowed here), in the validator's words. */
  refusal: Refusal | null;
}

export interface MetatypeGroupState {
  family: MetatypeFamily;
  label: string;
  holdsChoice: boolean;
  choices: MetatypeChoiceState[];
}

export interface MetatypeSection {
  /** The chosen metatype's table id; null when none (or an id the table does not know). */
  chosen: string | null;
  level: PriorityLevel | null;
  groups: MetatypeGroupState[];
}

/**
 * The metatype cards as the screen offers them: grouped by family, each with
 * its figures and — from a probe of `setMetatype`, the updater a tap applies —
 * the validator's reason it cannot be taken. Read-only shows the chosen card
 * alone.
 */
export function metatypeSection(input: {
  build: CharacterBuild;
  settings: Pick<ChargenSettings, 'allowMetavariants'>;
  probe: BuildProber;
  readOnly: boolean;
}): MetatypeSection {
  const { build, settings, probe, readOnly } = input;
  const chosen = chosenMetatypeId(build);
  const level = build.priorities.metatype;
  const groups = metatypeGroups(settings.allowMetavariants, chosen, readOnly).map((group) => ({
    family: group.family,
    label: group.label,
    holdsChoice: group.holdsChoice,
    choices: group.rows.map((row) => ({
      card: metatypeCard(row, level),
      refusal: metatypeRefusal(probe((b) => setMetatype(b, row.id), probeKey.metatype(row.id))),
    })),
  }));
  return { chosen, level, groups };
}

/**
 * The metatype findings still to say above the cards: those the chosen card
 * does not already carry as its refusal ("Troll cannot be taken at Metatype
 * priority C" sits under the troll card, once).
 */
export function issuesBesideCards(issues: readonly Issue[], section: Pick<MetatypeSection, 'chosen' | 'groups'>): Issue[] {
  const onCard = new Set(
    section.groups
      .flatMap((g) => g.choices)
      .filter((c) => c.card.id === section.chosen && c.refusal)
      .map((c) => c.refusal!.reason),
  );
  return issues.filter((i) => !onCard.has(i.message));
}

/** The line under the Metatype heading: which row the special points come from. */
export function metatypePriorityWords(level: PriorityLevel | null): string {
  return level
    ? `Metatype is priority ${level}: each card shows the special points it gets on that row.`
    : 'No Metatype priority yet, so each card lists its special points on every row.';
}

/** Said over the rows while no metatype is chosen: the engine previews a human's bases and maximums. */
export function previewBasesWords(metatype: Pick<MetatypeRow, 'id'> | null): string | null {
  return metatype ? null : "No metatype yet, so the rows show a human's starting ratings and maximums.";
}

/** The line under the Attributes heading: which row the attribute points come from. */
export function attributePriorityWords(level: PriorityLevel | null): string {
  return level
    ? `Attributes is priority ${level}. Each point raises one attribute by one, up to its natural maximum.`
    : 'No Attributes priority yet, so there are no attribute points to spend.';
}

// ---------------------------------------------------------------------------
// Refusals from the probe
// ---------------------------------------------------------------------------

/** The errors that shut an attribute's increase: its own maximum, and the one-at-maximum rule. */
export const ATTRIBUTE_CAP_CODES = ['attribute-over-max', 'attribute-max-more-than-one'] as const;

/**
 * The errors that shut a special attribute's increase: its maximum, and a type
 * that cannot use it. The last two count only when the validator files them
 * on this step, where the Magic row offers no type that uses the attribute;
 * filed on step 4 they are a kind still to choose there
 * (`SPECIAL_DECISION_CODES`), not a cap.
 */
export const SPECIAL_CAP_CODES = ['attribute-over-max', 'special-points-no-magic', 'special-points-no-resonance'] as const;

/** Special-point findings that, filed on another step, name a decision that step makes rather than a cap. */
export const SPECIAL_DECISION_CODES: ReadonlySet<string> = new Set(['special-points-no-magic', 'special-points-no-resonance']);

/** The errors that shut a metatype card: not on the build's row, not allowed in this campaign. */
export const METATYPE_CAP_CODES = ['metatype-not-on-row', 'metatype-not-allowed'] as const;

const errorKey = (i: Pick<Issue, 'code' | 'step' | 'path' | 'message'>): string =>
  `${i.code}|${i.step}|${i.path ?? ''}|${i.message}`;

/**
 * The errors a candidate change brings in or makes worse: every error the
 * changed record has that the record as it stands does not have in the same
 * words. `current` is every issue on the build; non-errors are ignored.
 */
export function worsenedErrors(probe: Pick<BuildProbe, 'blocking'>, current: readonly Issue[]): Issue[] {
  const now = new Set(current.filter((i) => i.severity === 'error').map(errorKey));
  return probe.blocking.filter((i) => i.severity === 'error' && !now.has(errorKey(i)));
}

/** An issue as a stepper's or card's refusal: the engine's sentence and page. */
export function refusalOf(issue: Pick<Issue, 'message' | 'ref'>): Refusal {
  return { reason: issue.message, ref: issue.ref };
}

/** The first of `issues` whose code is in `codes`, taken in the order `codes` lists them. */
export function refusalFrom(issues: readonly Issue[], codes: readonly string[]): Refusal | null {
  for (const code of codes) {
    const hit = issues.find((i) => i.code === code);
    if (hit) return refusalOf(hit);
  }
  return null;
}

/**
 * How closely an issue concerns attribute `id`: its own path first
 * (`attributes.agi`), then a rule about the attributes together (the
 * one-at-maximum rule, a quality that would lift a maximum), and only then one
 * pinned to a different attribute — which a change can drag along (raising
 * Agility one over its maximum makes a Body already one over stop being the
 * only one Exceptional Attribute could settle).
 */
function closeness(issue: Issue, id: BuildAttributeId): number {
  const tail = (issue.path ?? '').split('.')[1];
  if (tail === id) return 0;
  return isAttributeId(tail) ? 2 : 1;
}

/**
 * The error that shuts one more point on `id`, from the probe of that change;
 * null when nothing would. The issue, not just its sentence, so the screen can
 * see the validator filed the fix on step 5 and offer the way there.
 */
export function increaseRefusingIssue(
  probe: Pick<BuildProbe, 'blocking'>,
  current: readonly Issue[],
  id: BuildAttributeId,
): Issue | null {
  const codes: readonly string[] = (SPECIAL as readonly string[]).includes(id) ? SPECIAL_CAP_CODES : ATTRIBUTE_CAP_CODES;
  const candidates = worsenedErrors(probe, current).filter(
    (i) => codes.includes(i.code) && !(SPECIAL_DECISION_CODES.has(i.code) && i.step !== METATYPE_STEP),
  );
  candidates.sort((a, b) => closeness(a, id) - closeness(b, id) || codes.indexOf(a.code) - codes.indexOf(b.code));
  return candidates[0] ?? null;
}

/**
 * Why a metatype card cannot be taken, from the probe of choosing it; null
 * when it can. Every metatype error the candidate has counts, not only new
 * ones: the chosen card on a row it is not on carries its reason too.
 */
export function metatypeRefusal(probe: Pick<BuildProbe, 'blocking'>): Refusal | null {
  return refusalFrom(probe.blocking, METATYPE_CAP_CODES);
}

// ---------------------------------------------------------------------------
// Attribute rows
// ---------------------------------------------------------------------------

export interface AttributeLine {
  id: BuildAttributeId;
  name: string;
  short: string;
  base: number;
  points: number;
  karma: number;
  rating: number;
  /** What play will see after 'ware and other modifiers, when that differs from the rating; null otherwise. */
  augmented: number | null;
  /** The natural maximum after Exceptional Attribute or Lucky. */
  max: number;
  /** A quality lifted the maximum above the table's. */
  lifted: boolean;
  /** The rating sits at (or past) its natural maximum. */
  atMax: boolean;
}

/**
 * One attribute's row from the engine's rating and the derived preview.
 * `augmented` is set only when the derived value differs: for the eight it is
 * the book's `4 (6)`; Magic and Resonance use it for what Essence loss leaves;
 * Edge never has one.
 */
export function attributeLine(a: AttributeRating, derived: DerivedCharacter | null): AttributeLine {
  const shown = a.id === 'edg' ? undefined : derived?.attributes[a.id]?.value;
  return {
    id: a.id,
    ...BUILD_ATTRIBUTE_NAMES[a.id],
    base: a.base,
    points: a.points,
    karma: a.karma,
    rating: a.rating,
    augmented: shown !== undefined && shown !== a.rating ? shown : null,
    max: a.max,
    lifted: a.max > a.tableMax,
    atMax: a.max > 0 && a.rating >= a.max,
  };
}

/** The eight rows and the three special rows, in the table's order. */
export function attributeLines(
  ratings: Pick<BuildRatings, 'attributes'>,
  derived: DerivedCharacter | null,
): { eight: AttributeLine[]; special: AttributeLine[] } {
  return {
    eight: EIGHT.map((id) => attributeLine(ratings.attributes[id], derived)),
    special: SPECIAL.map((id) => attributeLine(ratings.attributes[id], derived)),
  };
}

const lossOnly = (line: Pick<AttributeLine, 'id'>): boolean => line.id === 'mag' || line.id === 'res';

/** The rating as the book writes it: "4", "4 (6)" with the augmented value, "6, 5 after Essence loss" for Magic. */
export function ratingText(line: Pick<AttributeLine, 'id' | 'rating' | 'augmented'>): string {
  if (line.augmented === null) return String(line.rating);
  return lossOnly(line) && line.augmented < line.rating
    ? `${line.rating}, ${line.augmented} after Essence loss`
    : `${line.rating} (${line.augmented})`;
}

/** The rating read aloud: "Agility 4, augmented 6". Magic and Resonance say what Essence leaves instead. */
export function ratingSpoken(line: Pick<AttributeLine, 'id' | 'name' | 'rating' | 'augmented'>): string {
  if (line.augmented === null) return `${line.name} ${line.rating}`;
  return lossOnly(line) && line.augmented < line.rating
    ? `${line.name} ${line.rating}, ${line.augmented} after Essence loss`
    : `${line.name} ${line.rating}, augmented ${line.augmented}`;
}

/** The Karma column: raises are bought on step 8 and only shown here. */
export function karmaWords(line: Pick<AttributeLine, 'karma'>): string {
  return line.karma > 0 ? `+${line.karma}, raised in step 8` : 'none yet, raised in step 8';
}

/** The maximum column: "6", "7, lifted by a quality". */
export function maxWords(line: Pick<AttributeLine, 'max' | 'lifted'>): string {
  return line.lifted ? `${line.max}, lifted by a quality` : String(line.max);
}

/**
 * Where a special attribute's stepper stands for this build:
 *
 * - `open` — Edge always; Magic or Resonance when the build uses it (a type
 *   that uses it, or a metatype born Awakened), and also while the kind is
 *   still to be chosen on step 4 and the Magic row offers a type that uses
 *   it. The walkthrough puts this step before that one, the book's own
 *   technomancer spends special points on Resonance before taking the column
 *   (p. 67, p. 70), and the validator files the missing type on step 4
 *   rather than refusing the point — so the screen does not refuse it either.
 * - `no-priority` — no Magic priority yet: step 2 decides.
 * - `not-on-row` — the Magic row offers no type that uses it: step 2 again,
 *   never the Magic step, which a mundane on that row skips.
 * - `other-kind` — the row offers one, but the kind chosen does not use it:
 *   step 4 could change that.
 * - `never` — the metatype can never have it (Resonance).
 *
 * The engine answers each part: `usesMagic` / `usesResonance`, the metatype
 * row, and the priority chart's options for the row (`magicRowOffers`, the
 * reading the validator makes when it decides which step to file on).
 */
export type SpecialState = 'open' | 'no-priority' | 'not-on-row' | 'other-kind' | 'never';

export function specialState(
  build: Pick<CharacterBuild, 'magic' | 'metatype' | 'priorities'>,
  ratings: Pick<BuildRatings, 'metatype'>,
  id: SpecialId,
  table: PriorityTable,
): SpecialState {
  if (id === 'edg') return 'open';
  if (id === 'res' && ratings.metatype && ratings.metatype.resonance === null) return 'never';
  if (id === 'mag' ? usesMagic(build) : usesResonance(build)) return 'open';
  const level = build.priorities.magic;
  if (!level) return 'no-priority';
  if (!magicRowOffers(table, level, id)) return 'not-on-row';
  return build.magic.kind === 'mundane' ? 'open' : 'other-kind';
}

/** The sentence and page a shut Magic or Resonance row shows, and the step that would open it (null when none would). */
export function specialClosed(
  id: Exclude<SpecialId, 'edg'>,
  state: Exclude<SpecialState, 'open'>,
  level: PriorityLevel | null,
): { refusal: Refusal; opensInStep: BuildStep | null } {
  const name = BUILD_ATTRIBUTE_NAMES[id].name;
  const withRef = (reason: string, code: string): Refusal => {
    const ref = issueRule(code)?.ref;
    return ref ? { reason, ref } : { reason };
  };
  switch (state) {
    case 'never':
      return { refusal: withRef(`This metatype can never have ${name}.`, 'resonance-not-allowed'), opensInStep: null };
    case 'no-priority':
      return {
        refusal: withRef(`${name} opens once step 2 sets the Magic or Resonance priority.`, 'magic-kind-not-offered'),
        opensInStep: 2,
      };
    case 'not-on-row':
      return { refusal: withRef(`Magic priority ${level ?? '–'} gives no ${name}.`, 'magic-kind-not-offered'), opensInStep: 2 };
    case 'other-kind':
      return {
        refusal:
          id === 'mag'
            ? withRef('Magic opens if step 4 gives this runner a type that uses it.', 'special-points-no-magic')
            : withRef('Resonance opens if step 4 makes this runner a technomancer.', 'special-points-no-resonance'),
        opensInStep: 4,
      };
  }
}

export interface AttributeRowState {
  line: AttributeLine;
  /**
   * `stepper` offers −/+ on the points; `closed` shows why in place of one —
   * Magic or Resonance this build cannot use, with nothing spent on it.
   */
  control: 'stepper' | 'closed';
  /** What shuts the increase (or, for a closed row, the whole row), in the engine's words and page. */
  refusal: Refusal | null;
  /** The validator's issue behind `refusal`, when a probe answered it. */
  refusingIssue: Issue | null;
  /** The step that would open a shut row (2 for the Magic row, 4 for a type that uses it); null when none would. */
  opensInStep: BuildStep | null;
}

export interface AttributeRowsInput {
  build: CharacterBuild;
  /** The campaign's printing of the priority table, which says what each Magic row offers. */
  table: PriorityTable;
  ratings: Pick<BuildRatings, 'attributes' | 'metatype'>;
  derived: DerivedCharacter | null;
  probe: BuildProber;
  /** Every issue on the build as it stands (a probe's errors are compared against these). */
  allIssues: readonly Issue[];
  /** Nothing is offered, so nothing is probed. */
  readOnly: boolean;
}

/**
 * Every attribute row's control and refusal. Each open increase is probed
 * once per draft under its own key — the eight with `setAttributePoints`,
 * the special three with `setSpecialPoints`, the very updaters a tap applies
 * — so what the stepper refuses is exactly what the tap would have broken.
 */
export function attributeRows(input: AttributeRowsInput): { eight: AttributeRowState[]; special: AttributeRowState[] } {
  const { build, table, ratings, derived, probe, allIssues, readOnly } = input;
  const lines = attributeLines(ratings, derived);
  const probed = (line: AttributeLine, fn: (b: CharacterBuild) => CharacterBuild): AttributeRowState => {
    const refusingIssue = readOnly
      ? null
      : increaseRefusingIssue(probe(fn, probeKey.increase(line.id, line.points)), allIssues, line.id);
    const refusal = refusingIssue ? refusalOf(refusingIssue) : null;
    return { line, control: 'stepper', refusal, refusingIssue, opensInStep: null };
  };
  const eight = lines.eight.map((line) =>
    probed(line, (b) => setAttributePoints(b, line.id as AttributeCode, b.attributes[line.id as AttributeCode] + 1)),
  );
  const special = lines.special.map((line): AttributeRowState => {
    const id = line.id as SpecialId;
    const state = specialState(build, ratings, id, table);
    if (state === 'open') return probed(line, (b) => setSpecialPoints(b, id, b.special[id] + 1));
    const closed = specialClosed(id as Exclude<SpecialId, 'edg'>, state, build.priorities.magic);
    return {
      line,
      // Points already there (a concept card, a type changed since) stay reachable, so they can be taken back.
      control: line.points > 0 ? 'stepper' : 'closed',
      refusal: closed.refusal,
      refusingIssue: null,
      opensInStep: closed.opensInStep,
    };
  });
  return { eight, special };
}

/** Whether any refusal on screen is one a quality on step 5 would lift (Exceptional Attribute, Lucky). */
export function qualityWouldLift(rows: readonly AttributeRowState[]): boolean {
  return rows.some((r) => r.refusingIssue?.step === 5);
}

// ---------------------------------------------------------------------------
// Issues placed beside the control they concern
// ---------------------------------------------------------------------------

/** Pool-count issues the pool lines already say in numbers; listing them again would say it twice. */
export const SAID_BY_POOL_LINE: ReadonlySet<string> = new Set([
  'attribute-points-over',
  'attribute-points-unspent',
  'special-points-over',
]);

/**
 * Issues about this step's choices that the validator files on another step
 * — an attribute one over its maximum that a quality would allow (step 5),
 * special points on Magic before the type that uses them (step 4), a Karma
 * raise past a maximum (step 8). The registry says a code belongs to step 3;
 * the issue says where it is fixed. Shown here with a way there.
 */
export function issuesElsewhere(allIssues: readonly Issue[]): Issue[] {
  return allIssues.filter((i) => i.step !== METATYPE_STEP && issueRule(i.code)?.step === METATYPE_STEP);
}

export interface PlacedIssues {
  metatype: Issue[];
  attributes: Issue[];
  special: Issue[];
  rows: Readonly<Partial<Record<BuildAttributeId, Issue[]>>>;
  other: Issue[];
}

/**
 * Issues split by where the screen shows them: under the metatype cards,
 * under one attribute's row, under the attribute or special pool, and
 * whatever is left for a closing list — so every issue is said once, next to
 * the thing that fixes it. Placement reads the path first and the code's
 * family second (a step 5 issue about the attributes has the path
 * `qualities`, but it still belongs beside them).
 */
export function placeIssues(issues: readonly Issue[]): PlacedIssues {
  const placed: PlacedIssues & { rows: Partial<Record<BuildAttributeId, Issue[]>> } = {
    metatype: [],
    attributes: [],
    special: [],
    rows: {},
    other: [],
  };
  for (const issue of issues) {
    if (SAID_BY_POOL_LINE.has(issue.code)) continue;
    const [head, tail] = (issue.path ?? '').split('.', 2) as [string, string | undefined];
    if (head === 'metatype' || issue.code.startsWith('metatype-')) placed.metatype.push(issue);
    else if ((head === 'attributes' || head === 'special') && isAttributeId(tail)) (placed.rows[tail] ??= []).push(issue);
    else if (head === 'special' || issue.code.startsWith('special-points-')) placed.special.push(issue);
    else if (head === 'attributes' || issue.code.startsWith('attribute-')) placed.attributes.push(issue);
    else placed.other.push(issue);
  }
  return placed;
}
