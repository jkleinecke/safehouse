/**
 * Step 8's arithmetic of *editing*, kept apart from its screen (FR3.9,
 * docs/CHARGEN.md §4.4 Step 8).
 *
 * The Karma step changes one list — `karma.spends` — in more ways than any
 * other step changes anything: a raise that extends, a raise taken back one
 * rating at a time, a power point bought and returned, a spirit's services
 * turned up, a focus bonded to the line it was bought as, a contact added
 * and tuned. Every one of those is a small pure `CharacterBuild →
 * CharacterBuild` function here, so the screen hands `update` a function the
 * tests have already run, and a stepper pressed twice never leaves two spends
 * where the book would write one.
 *
 * What these functions decide is *shape*, never Shadowrun:
 *
 * - **A raise is one spend per thing raised.** Tapping + on Agility at 4
 *   extends the spend that brought it to 4 (3 → 4 becomes 3 → 5) rather than
 *   stacking a second one, because the engine prices a spend from its `from`
 *   to its `to` by the same rule either way, and one line reads better in the
 *   ledger and undoes in one tap. Only the raise at the top of the chain — the
 *   last one for that thing, ending at the rating on screen — is extended or
 *   taken back; a raise the rating has moved past (a stale chain after a change
 *   upstream) is left for the validator to name and the ledger to undo.
 * - **Whether a tap may go.** Prices are the engine's `spendKarma` over
 *   `buildPricing` — Uncouth and Uneducated doubling included — and what a
 *   candidate change would break is the shell's `probe`. `gateTap` only sorts
 *   the two answers: a cap the change would break refuses with the
 *   validator's own sentence and page; a price the Karma pool cannot pay
 *   refuses too, in words, because leftover Karma is exactly what this step
 *   spends and spending past it is never what a player meant; and another
 *   step's points left to spend (raising Intuition grows the knowledge pool)
 *   goes through and is said beside the control, because that is not a
 *   ceiling the book puts on this tap. Taking something back never refuses:
 *   the ledger's undo is always the way out, and the validator names what it
 *   left behind.
 * - **Where an issue belongs.** The validator points at `karma.spends.3` or
 *   `karma.contacts.1.name`; `placeIssues` files those under the ledger line
 *   or the contact they name, and leaves the rest for the top of the step.
 *
 * No JSX, no React; tested in `logic.test.ts` against builds the engine made.
 */
import {
  BuildContactSchema,
  CONTACT_BOUNDS,
  FOCUS_FORCE_MAX,
  INITIATION_GRADE_MAX,
  KarmaSpendSchema,
  type BuildAttributeId,
  type BuildContact,
  type BuildPurchase,
  type Budgets,
  type CharacterBuild,
  type ChargenSettings,
  type Issue,
  type KarmaSpend,
  type KnowledgeCategory,
  type Ref,
} from '@safehouse/contracts';
import {
  ACTIVE_SKILL_TABLE,
  BUILD_ATTRIBUTE_NAMES,
  SKILL_GROUP_TABLE,
  activeSkillRow,
  focusBondingKarma,
  focusPurchaseMatches,
  focusTypesOf,
  formulaGroup,
  groupEligibilityIn,
  issueRule,
  skillEligibilityIn,
  skillGroupRow,
  usesMagic,
  usesResonance,
  type ActiveSkillRow,
  type BuildRatings,
  type BuildTally,
  type EligibilityContext,
  type FocusType,
  type SkillGroupRow,
} from '@safehouse/rules';
import type { BuildProbe } from '../../analysis.js';
import type { Refusal } from '../../components/LimitStepper.js';

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/** The eleven attributes a Karma raise can target, in the sheet's order. */
export const KARMA_ATTRIBUTES: readonly BuildAttributeId[] = ['bod', 'agi', 'rea', 'str', 'wil', 'log', 'int', 'cha', 'edg', 'mag', 'res'];

/** An attribute's name — the engine's one label map (`BUILD_ATTRIBUTE_NAMES`), so every step names it alike. */
export function attributeName(id: BuildAttributeId): string {
  return BUILD_ATTRIBUTE_NAMES[id].name;
}

/**
 * The attributes this runner's steppers show: the eight and Edge always;
 * Magic and Resonance when the build can use them (the engine's `usesMagic`,
 * `usesResonance`) or already raised them with Karma — so a raise the
 * validator refuses can still be seen and taken back.
 */
export function karmaAttributes(build: CharacterBuild, ratings: BuildRatings): BuildAttributeId[] {
  return KARMA_ATTRIBUTES.filter((id) => {
    if (id === 'mag') return usesMagic(build) || ratings.attributes.mag.karma > 0;
    if (id === 'res') return usesResonance(build) || ratings.attributes.res.karma > 0;
    return true;
  });
}

/** A skill's table name, with the weapon or vehicle a specific skill names. */
export function skillName(id: string, target?: string | null): string {
  const name = activeSkillRow(id)?.name ?? id;
  const t = target?.trim();
  return t ? `${name}: ${t}` : name;
}

export function groupName(id: string): string {
  return skillGroupRow(id)?.name ?? id;
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** One ledger line in words: "Agility 3 → 5", "Pistols, new at 1", "Bound fire spirit, 3 services". */
export function spendLabel(spend: KarmaSpend): string {
  const arrow = (name: string, from: number, to: number) => (from === 0 ? `${name}, new at ${to}` : `${name} ${from} → ${to}`);
  switch (spend.kind) {
    case 'attribute':
      return arrow(attributeName(spend.id), spend.from, spend.to);
    case 'skill':
      return arrow(skillName(spend.id, spend.target), spend.from, spend.to);
    case 'group':
      return arrow(`${groupName(spend.id)} group`, spend.from, spend.to);
    case 'knowledge':
      return arrow(`${spend.name} (knowledge)`, spend.from, spend.to);
    case 'language':
      return arrow(`${spend.name} (language)`, spend.from, spend.to);
    case 'specialization': {
      const on = spend.list === 'active' ? skillName(spend.id) : spend.id;
      return `${on}: ${spend.spec} (specialization)`;
    }
    case 'spell': {
      const group = formulaGroup(spend);
      return `${group === 'rituals' ? 'Ritual' : group === 'preparations' ? 'Preparation' : 'Spell'}: ${spend.name}`;
    }
    case 'form':
      return `Complex form: ${spend.name}`;
    case 'powerPoint':
      return plural(spend.count, 'power point');
    case 'initiation':
      return `Grade ${spend.grade}${spend.metamagic ? `: ${spend.metamagic}` : ''}`;
    case 'spirit':
      return `Bound ${spend.type} spirit, ${plural(spend.services, 'service')}`;
    case 'sprite':
      return `Registered ${spend.type} sprite, ${plural(spend.tasks, 'task')}`;
    case 'focus':
      return `Bonded ${spend.name}, Force ${spend.force}`;
  }
}

// ---------------------------------------------------------------------------
// The spends list
// ---------------------------------------------------------------------------

function withSpends(build: CharacterBuild, spends: KarmaSpend[]): CharacterBuild {
  return { ...build, karma: { ...build.karma, spends } };
}

/** A spend added to the end of the list, parsed with the contract so a line the autosave would refuse fails here. */
export function withSpend(build: CharacterBuild, spend: KarmaSpend): CharacterBuild {
  return withSpends(build, [...build.karma.spends, KarmaSpendSchema.parse(spend)]);
}

/** The spend at `index` taken back. */
export function withoutSpend(build: CharacterBuild, index: number): CharacterBuild {
  if (index < 0 || index >= build.karma.spends.length) return build;
  return withSpends(
    build,
    build.karma.spends.filter((_, i) => i !== index),
  );
}

/** The spend at `index` replaced (a spirit's services, a sprite's tasks). */
export function withSpendAt(build: CharacterBuild, index: number, spend: KarmaSpend): CharacterBuild {
  if (index < 0 || index >= build.karma.spends.length) return build;
  const parsed = KarmaSpendSchema.parse(spend);
  return withSpends(
    build,
    build.karma.spends.map((s, i) => (i === index ? parsed : s)),
  );
}

/** Every spend of one kind, with its index in the list. */
export function spendsOfKind<K extends KarmaSpend['kind']>(
  build: CharacterBuild,
  kind: K,
): Array<{ index: number; spend: Extract<KarmaSpend, { kind: K }> }> {
  const out: Array<{ index: number; spend: Extract<KarmaSpend, { kind: K }> }> = [];
  build.karma.spends.forEach((spend, index) => {
    if (spend.kind === kind) out.push({ index, spend: spend as Extract<KarmaSpend, { kind: K }> });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Raises
// ---------------------------------------------------------------------------

/** Something a Karma raise lifts a rating on. */
export type RaiseTarget =
  | { kind: 'attribute'; id: BuildAttributeId }
  | { kind: 'skill'; id: string; target?: string }
  | { kind: 'group'; id: string }
  | { kind: 'knowledge'; name: string; category?: KnowledgeCategory }
  | { kind: 'language'; name: string };

export type RaiseSpend = Extract<KarmaSpend, { kind: 'attribute' | 'skill' | 'group' | 'knowledge' | 'language' }>;

export function isRaise(spend: KarmaSpend): spend is RaiseSpend {
  return (
    spend.kind === 'attribute' || spend.kind === 'skill' || spend.kind === 'group' || spend.kind === 'knowledge' || spend.kind === 'language'
  );
}

const norm = (s: string | undefined): string => (s ?? '').trim().toLowerCase();

/** Which thing a raise lifts — the same identity for a target and for a spend that raised it. */
export function raiseKey(t: RaiseTarget | RaiseSpend): string {
  switch (t.kind) {
    case 'attribute':
      return `attribute|${t.id}`;
    case 'skill':
      return `skill|${activeSkillRow(t.id)?.id ?? norm(t.id)}|${norm(t.target)}`;
    case 'group':
      return `group|${skillGroupRow(t.id)?.id ?? norm(t.id)}`;
    case 'knowledge':
      return `knowledge|${norm(t.name)}`;
    case 'language':
      return `language|${norm(t.name)}`;
  }
}

/** A raise of `t` from one rating to another, as the contract writes it. */
export function raiseSpend(t: RaiseTarget, from: number, to: number): RaiseSpend {
  switch (t.kind) {
    case 'attribute':
      return { kind: 'attribute', id: t.id, from, to };
    case 'skill':
      return { kind: 'skill', id: t.id, from, to, ...(t.target?.trim() ? { target: t.target.trim().slice(0, 200) } : {}) };
    case 'group':
      return { kind: 'group', id: t.id, from, to };
    case 'knowledge':
      return { kind: 'knowledge', name: t.name.trim().slice(0, 200), ...(t.category ? { category: t.category } : {}), from, to };
    case 'language':
      return { kind: 'language', name: t.name.trim().slice(0, 200), from, to };
  }
}

/**
 * The index of the raise at the top of `t`'s chain: the last raise of it,
 * when that raise ends at the rating on screen. Null when nothing was raised,
 * or when the rating has moved past the last raise (a group raise carried the
 * skill higher, or points changed upstream).
 */
export function chainTop(build: CharacterBuild, t: RaiseTarget, rating: number): number | null {
  const key = raiseKey(t);
  const spends = build.karma.spends;
  for (let i = spends.length - 1; i >= 0; i--) {
    const s = spends[i]!;
    if (isRaise(s) && raiseKey(s) === key) return s.to === rating ? i : null;
  }
  return null;
}

/** `t` raised one rating from `rating`: the chain's top spend extended, or a new spend. */
export function withRaise(build: CharacterBuild, t: RaiseTarget, rating: number): CharacterBuild {
  const top = chainTop(build, t, rating);
  if (top === null) return withSpend(build, raiseSpend(t, rating, rating + 1));
  const s = build.karma.spends[top] as RaiseSpend;
  return withSpendAt(build, top, { ...s, to: rating + 1 });
}

/** The lowest rating the stepper may take `t` back to: where the chain's top spend started, or the rating itself. */
export function raiseFloor(build: CharacterBuild, t: RaiseTarget, rating: number): number {
  const top = chainTop(build, t, rating);
  if (top === null) return rating;
  return Math.min(rating, (build.karma.spends[top] as RaiseSpend).from);
}

/** `t` taken back one rating: the chain's top spend shortened, or removed when nothing is left of it. */
export function withLower(build: CharacterBuild, t: RaiseTarget, rating: number): CharacterBuild {
  const top = chainTop(build, t, rating);
  if (top === null) return build;
  const s = build.karma.spends[top] as RaiseSpend;
  return rating - 1 <= s.from ? withoutSpend(build, top) : withSpendAt(build, top, { ...s, to: rating - 1 });
}

// ---------------------------------------------------------------------------
// Whether a tap may go
// ---------------------------------------------------------------------------

/**
 * Errors a tap may bring in without being refused: another step's points left
 * to spend (raising Intuition grows the knowledge pool) — work for later, not
 * a ceiling on this tap. Overspent Karma is not one of these; `gateTap`
 * refuses it in words of its own.
 */
export function isConsequence(issue: Pick<Issue, 'code'>): boolean {
  return /-unspent$/.test(issue.code);
}

/** What a tap costs against the Karma pool, when the step knows it before the tap. */
export interface TapPrice {
  /** Karma the tap takes (0 or less: free). */
  amount: number;
  /** Karma left before the tap (below zero when already overspent). */
  remaining: number;
}

export interface TapGate {
  /** Whether the tap may go. */
  open: boolean;
  /** Why not: the validator's sentence and page for a cap, or the shortfall in words. */
  refusal: Refusal | null;
  /** What the tap would leave to do elsewhere, when it goes — the engine's words. */
  consequences: Issue[];
}

// The few neutral words a stepper shows until its refused + is pressed (the sentence shows then).
const refusalOf = (issue: Issue, hint = 'at the cap'): Refusal => ({ reason: issue.message, ref: issue.ref, hint });

/** The page the Karma pool's limits are on. */
export const KARMA_POOL_REF: Ref | undefined = issueRule('karma-overspent')?.ref;

/** Karma a price cannot be paid from, in words; null when it can. */
export function shortfall(price: TapPrice): Refusal | null {
  if (price.amount <= 0) return null;
  const ref = KARMA_POOL_REF ? { ref: KARMA_POOL_REF } : {};
  if (price.remaining < 0) {
    return { reason: `Karma is already ${price.remaining * -1} over; take something back first.`, hint: 'Karma overspent', ...ref };
  }
  if (price.amount > price.remaining) {
    return { reason: `This costs ${price.amount} Karma and ${price.remaining} ${price.remaining === 1 ? 'is' : 'are'} left.`, hint: `can't afford ${price.amount}`, ...ref };
  }
  return null;
}

/**
 * A probe's answer and a price sorted into "go" or "refuse, and why". A cap
 * the change breaks is named first (it is the reason the tap can never go),
 * then a price the pool cannot pay, then an overspend the probe found that the
 * step could not price beforehand (a contact past the free pool).
 */
export function gateTap(probe: BuildProbe, price: TapPrice | null = null): TapGate {
  const cap = probe.introduced.find((i) => !isConsequence(i) && i.code !== 'karma-overspent');
  if (cap) return { open: false, refusal: refusalOf(cap), consequences: [] };
  const short = price ? shortfall(price) : null;
  if (short) return { open: false, refusal: short, consequences: [] };
  const overspent = probe.introduced.find((i) => i.code === 'karma-overspent');
  if (overspent) return { open: false, refusal: refusalOf(overspent, "can't afford"), consequences: [] };
  return { open: true, refusal: null, consequences: probe.introduced.filter(isConsequence) };
}

/**
 * What a change took from the pools, read off the engine's budgets before and
 * after it: the Karma it cost and the free contact Karma it used. A contact's
 * Connection costs contact Karma until that pool is spent and Karma after —
 * the engine's rule, answered here by asking the engine twice.
 */
export function changeCost(before: Budgets, after: Budgets): { karma: number; contactKarma: number } {
  // The free pool's own remainder below zero is the part Karma paid for, not more of the pool.
  const free = (b: Budgets) => Math.max(0, b.pools.contactKarma.remaining);
  return {
    karma: before.pools.karma.remaining - after.pools.karma.remaining,
    contactKarma: free(before) - free(after),
  };
}

/**
 * How a contact tap is quoted: against free contact Karma while that pays for
 * all of it, against Karma once any of it comes from there — with the last of
 * the free pool named first when the two share it.
 */
export function contactQuote(cost: { karma: number; contactKarma: number }): {
  amount: number;
  pool: 'karma' | 'contactKarma';
  lead: string;
} {
  if (cost.karma <= 0) return { amount: cost.contactKarma, pool: 'contactKarma', lead: '' };
  return { amount: cost.karma, pool: 'karma', lead: cost.contactKarma > 0 ? `uses the last ${cost.contactKarma} contact Karma and` : '' };
}

// ---------------------------------------------------------------------------
// Where the step's issues sit
// ---------------------------------------------------------------------------

export interface PlacedIssues {
  /** Issues naming one spend, by its index. */
  spends: ReadonlyMap<number, readonly Issue[]>;
  /** Issues naming one contact, by its index. */
  contacts: ReadonlyMap<number, readonly Issue[]>;
  /** Everything else: said at the top of the step. */
  general: readonly Issue[];
}

const ROW_PATH = /^karma\.(spends|contacts)\.(\d+)(?:\.|$)/;

/** File each issue under the ledger line or contact its path names; the rest are the step's own. */
export function placeIssues(issues: readonly Issue[]): PlacedIssues {
  const spends = new Map<number, Issue[]>();
  const contacts = new Map<number, Issue[]>();
  const general: Issue[] = [];
  for (const issue of issues) {
    const m = ROW_PATH.exec(issue.path ?? '');
    if (!m) {
      general.push(issue);
      continue;
    }
    const map = m[1] === 'spends' ? spends : contacts;
    const at = Number(m[2]);
    map.set(at, [...(map.get(at) ?? []), issue]);
  }
  return { spends, contacts, general };
}

// ---------------------------------------------------------------------------
// Karma left and carried
// ---------------------------------------------------------------------------

export interface CarryState {
  /** Karma not yet spent (0 when overspent). */
  left: number;
  /** Karma spent past the pool (0 when not). */
  overspent: number;
  /** What would carry into play. */
  carried: number;
  /** What the cap would lose — this step is not done while it is above 0. */
  lost: number;
  /** The most Karma that carries into play. */
  cap: number;
}

/** Karma left against the carry cap, read off the engine's pool and preview. */
export function carryState(budgets: Budgets, settings: Pick<ChargenSettings, 'karmaCarry'>): CarryState {
  const remaining = budgets.pools.karma.remaining;
  const left = Math.max(0, remaining);
  const cap = settings.karmaCarry;
  return {
    left,
    overspent: Math.max(0, -remaining),
    // The engine's own split of what is left (it always fills both); none is claimed without it.
    carried: budgets.preview?.karmaCarried ?? 0,
    lost: budgets.preview?.karmaLost ?? 0,
    cap,
  };
}

/** The carry-over in one sentence, over-carry and overspend said in words. */
export function carrySentence(c: CarryState): string {
  if (c.overspent > 0) return `${c.overspent} Karma overspent: take something back before this step is done.`;
  if (c.lost > 0) {
    return `At most ${c.cap} Karma carries into play, so ${c.lost} more must be spent before this step is done.`;
  }
  if (c.left === 0) return 'Every point of Karma is spent; nothing carries into play.';
  return `All ${c.left} carries into play (at most ${c.cap} may).`;
}

/** One line of where the Karma pool came from and went. */
export interface KarmaLine {
  key: 'start' | 'negative' | 'positive' | 'metatype' | 'nuyen' | 'spends' | 'contacts';
  label: string;
  /** Signed: what the line adds to the pool. */
  amount: number;
}

/**
 * The pool as the earlier steps left it, then what this step spent: the
 * level's starting Karma, the qualities, a metavariant's price, the Karma
 * turned into nuyen on step 7, the spends, and contacts past their own pool.
 * Lines that are zero are left out, except the start.
 */
export function karmaLines(build: CharacterBuild, tally: BuildTally): KarmaLine[] {
  const spent = tally.spendCosts.reduce((s, n) => s + n, 0);
  const contactsOver = Math.max(0, -tally.pools.contactKarma.remaining);
  const lines: KarmaLine[] = [
    { key: 'start', label: `to start at the ${tally.tables.level} level`, amount: tally.tables.preset.karma },
    { key: 'negative', label: 'from negative qualities (step 5)', amount: tally.negativeKarma },
    { key: 'positive', label: 'on positive qualities (step 5)', amount: -tally.positiveKarma },
    { key: 'metatype', label: 'for the metatype (step 3)', amount: -tally.metatypeKarma },
    { key: 'nuyen', label: 'turned into nuyen (step 7)', amount: -build.karma.toNuyen },
    { key: 'spends', label: 'on this step’s spends', amount: -spent },
    { key: 'contacts', label: 'on contacts past their own pool', amount: -contactsOver },
  ];
  return lines.filter((l) => l.key === 'start' || l.amount !== 0);
}

/** "+25", "−8": a signed amount with a real minus sign. */
export function signedAmount(n: number): string {
  return n < 0 ? `−${-n}` : `+${n}`;
}

// ---------------------------------------------------------------------------
// What can be learned, specialised and bonded
// ---------------------------------------------------------------------------

/** Skills with no rating yet that this runner may take (a specific skill may be learned again for another target). */
export function learnableSkills(ratings: BuildRatings, eligibility: EligibilityContext): ActiveSkillRow[] {
  const held = new Set(ratings.skills.filter((s) => s.rating > 0).map((s) => s.id));
  return ACTIVE_SKILL_TABLE.filter((row) => (row.specific || !held.has(row.id)) && skillEligibilityIn(eligibility, row).allowed);
}

/** Groups not yet owned that this runner may take. */
export function learnableGroups(ratings: BuildRatings, eligibility: EligibilityContext): SkillGroupRow[] {
  const owned = new Set(ratings.groups.filter((g) => g.rating > 0).map((g) => g.id));
  return SKILL_GROUP_TABLE.filter((row) => !owned.has(row.id) && groupEligibilityIn(eligibility, row).allowed);
}

/** Whether a knowledge skill or language of this name is already on the runner (in any spelling of case and space). */
export function knownName(ratings: BuildRatings, list: 'knowledge' | 'language', name: string): boolean {
  const rows = list === 'knowledge' ? ratings.knowledge : ratings.languages;
  return rows.some((r) => norm(r.name) === norm(name) && norm(name) !== '');
}

/** A skill a specialisation can go on. */
export interface SpecTarget {
  /** The option value: `active|pistols`, `knowledge|Local gangs`. */
  value: string;
  label: string;
  list: 'active' | 'knowledge' | 'language';
  id: string;
}

/**
 * Every rated skill, knowledge skill and language that has no specialisation
 * yet: the things one can go on at creation. A skill that already has one is
 * left out — it would only earn "one is allowed" — and a skill rated through
 * a group says what specialising it costs the group.
 */
export function specTargets(ratings: BuildRatings): SpecTarget[] {
  return [
    ...ratings.skills
      .filter((s) => s.rating > 0 && s.specs.length === 0)
      .map((s): SpecTarget => ({
        value: `active|${s.id}`,
        label: s.group ? `${skillName(s.id, s.target)} — stops the ${groupName(s.group)} group being raised` : skillName(s.id, s.target),
        list: 'active',
        id: s.id,
      })),
    ...ratings.knowledge
      .filter((k) => k.rating > 0 && k.name && k.specs.length === 0)
      .map((k): SpecTarget => ({ value: `knowledge|${k.name}`, label: `${k.name} (knowledge)`, list: 'knowledge', id: k.name })),
    ...ratings.languages
      .filter((l) => l.rating > 0 && l.name && l.specs.length === 0)
      .map((l): SpecTarget => ({ value: `language|${l.name}`, label: `${l.name} (language)`, list: 'language', id: l.name })),
  ];
}

export function specSpend(target: Pick<SpecTarget, 'list' | 'id'>, spec: string): KarmaSpend {
  return { kind: 'specialization', list: target.list, id: target.id, spec: spec.trim().slice(0, 200) };
}

// Power points bought are the engine's `powerPointsBought` / `setPowerPointsBought` — one updater, shared with step 4.

/** A bound spirit or registered sprite, its type trimmed to what the magic store keeps. */
/**
 * The grade of initiation or submersion the build has paid for: 0 when it has
 * paid for none. Read off the spends rather than stored, like every other
 * rating on this step — each grade is its own spend, because each grade's
 * price depends on the one below it (SR5 p.325).
 */
export function initiateGrade(build: CharacterBuild): number {
  return build.karma.spends.reduce((top, s) => (s.kind === 'initiation' ? Math.max(top, s.grade) : top), 0);
}

/**
 * The build with every grade up to `grade` paid for and none above it. Going
 * down releases the grades above, which is what the stepper's minus does; the
 * spends stay in grade order so the Karma ledger reads 1, 2, 3.
 */
export function setInitiateGrade(build: CharacterBuild, grade: number): CharacterBuild {
  const want = Math.max(0, Math.min(INITIATION_GRADE_MAX, Math.round(grade)));
  const others = build.karma.spends.filter((s) => s.kind !== 'initiation');
  const taken: KarmaSpend[] = Array.from({ length: want }, (_, i) => ({ kind: 'initiation', grade: i + 1 }));
  return withSpends(build, [...others, ...taken].map((s) => KarmaSpendSchema.parse(s)));
}

export function companionSpend(kind: 'spirit' | 'sprite', type: string, count: number): KarmaSpend {
  const t = type.trim().slice(0, 80);
  const n = Math.min(999, Math.max(1, Math.round(count)));
  return kind === 'spirit' ? { kind: 'spirit', type: t, services: n } : { kind: 'sprite', type: t, tasks: n };
}

/** A purchase that could be the focus a bond is for. */
export interface FocusCandidate {
  /** Its index in `purchases`. */
  index: number;
  purchase: BuildPurchase;
  /** The Focus Table types its name or heading reads as, dearest first. */
  types: FocusType[];
  /** Bonds this line already answers. */
  bonded: number;
  /** How many more bonds it can answer (its quantity less those). */
  free: number;
  /** The Force the line was bought at, when it records one — a bond must match it. */
  force: number | null;
}

/**
 * The gear lines a focus bond could be for: anything not implanted whose name
 * or table heading reads as a focus type, or says "focus" at all (the type is
 * then asked for). How many bonds each line already answers is the engine's
 * pairing (`focusPurchaseMatches`), so a line of quantity 1 with a bond on it
 * is not offered twice.
 */
export function focusCandidates(build: CharacterBuild): FocusCandidate[] {
  const matches = focusPurchaseMatches(build);
  const held = new Map<number, number>();
  for (const at of matches) if (typeof at === 'number') held.set(at, (held.get(at) ?? 0) + 1);
  const out: FocusCandidate[] = [];
  build.purchases.forEach((purchase, index) => {
    if (purchase.list === 'augments') return;
    const types = focusTypesOf(purchase.name, purchase.category);
    if (types.length === 0 && !/\bfoc(?:us|i)\b/i.test(`${purchase.name} ${purchase.kind} ${purchase.category ?? ''}`)) return;
    const bonded = held.get(index) ?? 0;
    out.push({ index, purchase, types, bonded, free: Math.max(0, purchase.qty - bonded), force: purchase.rating });
  });
  return out;
}

/** The bond for a purchased focus at a type and Force, its Karma from the Focus Table. */
export function focusSpend(purchase: Pick<BuildPurchase, 'name' | 'ref' | 'catalogueId'>, type: FocusType, force: number): KarmaSpend {
  const f = Math.min(FOCUS_FORCE_MAX, Math.max(1, Math.round(force)));
  return {
    kind: 'focus',
    name: purchase.name.slice(0, 120),
    focusType: type,
    force: f,
    bondKarma: focusBondingKarma(type, f),
    ...(purchase.ref ? { ref: purchase.ref } : {}),
    ...(purchase.catalogueId ? { catalogueId: purchase.catalogueId } : {}),
  };
}

/** Catalogue ids of every spell or complex form the runner already knows, granted or bought. */
export function knownPickIds(build: CharacterBuild, kind: 'spell' | 'form'): Set<string> {
  const grants = kind === 'spell' ? build.grants.spells : build.grants.forms;
  const ids = new Set<string>();
  for (const pick of grants) if (pick.catalogueId) ids.add(pick.catalogueId);
  for (const s of build.karma.spends) if (s.kind === kind && s.catalogueId) ids.add(s.catalogueId);
  return ids;
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

function withContacts(build: CharacterBuild, contacts: BuildContact[]): CharacterBuild {
  return { ...build, karma: { ...build.karma, contacts } };
}

/** A new contact at the contract's defaults (Connection 1, Loyalty 1, no name yet). */
export function withNewContact(build: CharacterBuild): CharacterBuild {
  return withContacts(build, [...build.karma.contacts, BuildContactSchema.parse({})]);
}

/**
 * One contact's fields changed, held inside the contract's bounds (names 200
 * characters, notes 4,000, Connection 1–12, Loyalty 1–6) so a keystroke can
 * never make a record the autosave would refuse. The creation limit of 7 per
 * contact is the validator's, asked through the probe, not clamped here.
 */
export function withContactPatch(build: CharacterBuild, index: number, patch: Partial<BuildContact>): CharacterBuild {
  const current = build.karma.contacts[index];
  if (!current) return build;
  const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(n)));
  const merged = { ...current, ...patch };
  const next = BuildContactSchema.parse({
    name: merged.name.slice(0, 200),
    role: merged.role.slice(0, 200),
    connection: clamp(merged.connection, CONTACT_BOUNDS.connection.min, CONTACT_BOUNDS.connection.max),
    loyalty: clamp(merged.loyalty, CONTACT_BOUNDS.loyalty.min, CONTACT_BOUNDS.loyalty.max),
    ...(merged.notes !== undefined ? { notes: merged.notes.slice(0, 4000) } : {}),
  });
  return withContacts(
    build,
    build.karma.contacts.map((c, i) => (i === index ? next : c)),
  );
}

export function withoutContact(build: CharacterBuild, index: number): CharacterBuild {
  if (index < 0 || index >= build.karma.contacts.length) return build;
  return withContacts(
    build,
    build.karma.contacts.filter((_, i) => i !== index),
  );
}
