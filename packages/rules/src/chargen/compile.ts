/**
 * Build → sheet (FR3.9, docs/CHARGEN.md §4.1 "compile is a pure function",
 * §8.2 where things land, §8.5 what approval writes).
 *
 * The finished build becomes the `SheetV1` every other part of the app
 * already reads, parsed through `SheetV1Schema` so what comes out is exactly
 * what the server would store; `deriveCharacter` then gives it initiative,
 * limits and monitors like any imported sheet. Nothing in play reads the
 * build again (§4.1).
 *
 * How each decision lands:
 *
 * - **Ratings** — natural ratings before Karma go on the sheet, then every
 *   Karma spend is applied in order through `applySpend`, the function
 *   advancement in play uses (so a raise at creation and a raise in play are
 *   one code path). Edge's current equals its maximum; Essence stays the
 *   base 6 and each implant carries its own grade-applied cost, which is what
 *   derive subtracts (and what takes Magic with it).
 * - **Skills** — a group's members at the group's rating with the group's
 *   name; knowledge skills and languages on their own lists (§8.3).
 * - **Spells and complex forms** — as the sheet keeps them (`sheetSpellOf`,
 *   `sheetFormOf`): category, drain or fading and target, page and note, so
 *   the approved sheet rolls drain off the code the book prints.
 * - **Qualities** — name, page, type, Karma, rating and the hand-entered
 *   modifiers (§8.1). One whitelisted consequence derive can show is written
 *   for the player: Will to Live's extra overflow box per rating, when no
 *   overflow modifier was entered by hand. Racial traits are not written at
 *   all: derive reads them off `identity.metatype` (vision, a troll's dermal
 *   armor), so an imported troll and a built one agree and nothing counts
 *   twice.
 * - **Gear** — each purchase's `item`, the catalogue's own mapping, with the
 *   purchase's rating, quantity, grade and grade-applied Essence written over
 *   it. The highest-rated armor is worn and the rest carried, since derive
 *   counts only worn armor. Lifestyles at their monthly cost with the metatype multiplier and
 *   Dependents surcharge applied; `paidThrough` is the server's, from the
 *   campaign date.
 * - **Off the sheet** — contacts become rows for the `contacts` table
 *   (`role` → `archetype`); bound spirits, registered sprites and bonded
 *   foci come back as plain records for the magic store (§8.2), within its
 *   bounds, each focus with the type it bonds as, the gear line it was
 *   bought as and what it feeds in play; lifestyles come back beside the
 *   sheet with their months, for the ledger's `paidThrough`.
 * - **Opening balances** — the Karma and nuyen that carry (capped), and the
 *   starting-nuyen roll the chosen lifestyle calls for. The roll is the
 *   server's to make on the record (G5); pass its dice total and the total
 *   comes back as roll × multiplier + carry-over (p. 95).
 *
 * Compile never refuses: a half-built draft compiles too, so the rail can
 * preview it. `issues` says whether it should be approved.
 *
 * Pure — no I/O. Numbers and page refs only (DESIGN.md §14).
 */
import {
  ATTRIBUTE_CODES,
  SheetV1Schema,
  type CharacterBuild,
  type ChargenSettings,
  type Issue,
  type LifestyleTier,
  type Modifier,
  type Ref,
  type SheetAwakening,
  type SheetQuality,
  type SheetV1,
  type SheetV1Input,
  type SkillAttr,
} from '@safehouse/contracts';
import { applySpend, sheetFormOf, sheetSpellOf } from './advance.js';
import { focusPurchaseMatches, lifestyleMonthlyCost, purchaseEssence, startingLifestyle, tallyBuild } from './budget.js';
import { focusBondingKarma, focusSpendType, type FocusType } from './foci.js';
import { LIFESTYLES } from './lifestyles.js';
import { MAGIC_KIND_TABLE } from './priority.js';
import { qualityRatingOf } from './ratings.js';
import { SKILL_GROUP_BY_ID, activeSkillRow } from './skills.js';
import { TRADITIONS } from './traditions.js';
import { validate } from './validate.js';
import { skillAttrFor } from '../generator/validity.js';

/** A row for the `contacts` table (§8.2). */
export interface CompiledContact {
  name: string;
  archetype: string;
  connection: number;
  loyalty: number;
  notes: string | null;
}

/** A bound spirit for the magic store: Force is the summoner's Magic (p. 98). */
export interface CompiledSpirit {
  spiritType: string;
  force: number;
  services: number;
  bound: true;
}

/**
 * A registered sprite: Level is the technomancer's Resonance (p. 98). The
 * magic store has no sprite list yet; the decision is that sprites join it
 * as `campaigns.settings.magic.sprites` beside `spirits`, bounded the same
 * way (type 80 characters, tasks 999), and approval writes them there. Until
 * that store exists the server must keep these rather than drop them.
 */
export interface CompiledSprite {
  spriteType: string;
  level: number;
  tasks: number;
  registered: true;
}

/**
 * A focus bonded at creation, shaped for the magic store's focus record
 * (name ≤ 120, kind ≤ 60, Force ≤ 12). `kind` is the Focus Table type the
 * bond resolves to (a sustaining focus is `spell`), or '' when it resolves to
 * none — which the validator refuses, so an approvable build never has one.
 * `purchaseIndex` is the gear line the focus was bought as, so the server
 * can carry the item's ref and note across. What the focus does in play —
 * `sourceKind`, `targets`, `mods` — is what the player entered on the spend
 * with the page open, as for any focus added in play (FR8.4), with the
 * store's own defaults (`power`, none, none) where they entered nothing.
 */
export interface CompiledFocus {
  name: string;
  kind: FocusType | '';
  force: number;
  bonded: true;
  bondKarma: number;
  purchaseIndex: number | null;
  sourceKind: 'power' | 'spell';
  targets: string[];
  mods: Modifier[];
  ref?: Ref;
  catalogueId?: string;
}

/**
 * A lifestyle as the ledger opens it: the sheet line plus the tier and months
 * paid, index for index with `sheet.lifestyles`, so the server sets each
 * `paidThrough` without re-reading the build.
 */
export interface CompiledLifestyle {
  name: string;
  tier: LifestyleTier;
  months: number;
  costPerMonth: number;
}

export interface CompiledOpening {
  /** Karma carried into play, at most the carry cap (p. 98). */
  karma: number;
  /** Unspent nuyen carried into play, at most the carry cap (p. 94). */
  nuyenCarry: number;
  /** The lifestyle's starting-nuyen roll; `total` = dice total × multiplier + carry-over, when a roll was given. */
  startingNuyen: { dice: number; multiplier: number; total?: number };
}

export interface CompiledBuild {
  sheet: SheetV1;
  awakening: SheetAwakening;
  contacts: CompiledContact[];
  spirits: CompiledSpirit[];
  sprites: CompiledSprite[];
  foci: CompiledFocus[];
  lifestyles: CompiledLifestyle[];
  opening: CompiledOpening;
  issues: Issue[];
}

export interface CompileOptions {
  /** The total of the starting-nuyen dice the server rolled (e.g. 22 on 4D6). */
  startingNuyenRoll?: number;
}

/** The drain (or fading) pair: the tradition's (p. 279–280); Willpower + Resonance for a technomancer (p. 250). */
function drainPair(build: CharacterBuild): [SkillAttr, SkillAttr] | null {
  if (build.magic.kind === 'technomancer') return ['wil', 'res'];
  if (build.magic.tradition && MAGIC_KIND_TABLE[build.magic.kind].attribute === 'mag') {
    const [a, b] = TRADITIONS[build.magic.tradition].drain;
    return [a, b];
  }
  return null;
}

/** Compile a build into a sheet, the records that live beside it, and its opening balances. */
export function compileBuild(
  build: CharacterBuild,
  settings: ChargenSettings,
  options: CompileOptions = {},
): CompiledBuild {
  const t = tallyBuild(build, settings);
  const { ratings: r, tables, effects } = t;
  const meta = tables.metatype;
  const kind = build.magic.kind;

  // --- Ratings before Karma ---
  const attrs = Object.fromEntries(ATTRIBUTE_CODES.map((c) => [c, r.attributes[c].creation])) as Record<
    (typeof ATTRIBUTE_CODES)[number],
    number
  >;
  const skills: NonNullable<SheetV1Input['skills']> = [];
  for (const sk of r.skills) {
    if (sk.creation <= 0) continue;
    const row = sk.row ?? activeSkillRow(sk.id);
    skills.push({
      id: sk.id,
      rating: sk.creation,
      attr: row?.attr ?? skillAttrFor(sk.id),
      ...(sk.pointSpec ? { spec: sk.pointSpec } : {}),
      ...(sk.group ? { group: SKILL_GROUP_BY_ID[sk.group].name } : {}),
      ...(sk.target ? { target: sk.target } : {}),
    });
  }
  const knowledge: NonNullable<SheetV1Input['knowledge']> = [];
  for (const k of r.knowledge) {
    if (!k.name || k.creation <= 0 || !k.category) continue;
    knowledge.push({ name: k.name, category: k.category, rating: k.creation, ...(k.pointSpec ? { spec: k.pointSpec } : {}) });
  }
  const languages: NonNullable<SheetV1Input['languages']> = [];
  for (const l of r.languages) {
    if (!l.name || (!l.native && l.creation <= 0)) continue;
    languages.push({
      name: l.name,
      native: l.native,
      rating: l.native ? 0 : l.creation,
      ...(l.pointSpec ? { spec: l.pointSpec } : {}),
    });
  }

  // --- Qualities ---
  // Will to Live's box goes on the first line held; a second line is the
  // validator's `quality-once`, never a second box.
  const overflowLine = effects.held.find((h) => h.rule?.rules.some((rule) => rule.kind === 'overflowPerRating'));
  const qualities: SheetQuality[] = build.qualities.map((q, index) => {
    const mods = [...q.mods];
    const entry = overflowLine?.index === index ? overflowLine.rule : null;
    const overflow = entry?.rules.find((rule) => rule.kind === 'overflowPerRating');
    if (overflow && overflow.kind === 'overflowPerRating' && !mods.some((m) => m.target === 'monitor.overflow')) {
      mods.push({
        id: `chargen.quality.${index}.overflow`,
        source: { kind: 'quality', ref: q.name },
        target: 'monitor.overflow',
        op: 'add',
        value: Math.min(overflow.max, qualityRatingOf({ quality: q, rule: entry })),
        active: true,
        note: q.name,
      });
    }
    const note = q.note ?? (q.target ? q.target : undefined);
    return {
      name: q.name,
      ...(q.ref ? { ref: q.ref } : {}),
      mods,
      ...(note ? { note } : {}),
      type: q.type,
      karma: q.karma,
      ...(q.rating !== null ? { rating: q.rating } : {}),
    };
  });

  // --- Purchases ---
  const augments: NonNullable<SheetV1Input['augments']> = [];
  const weapons: NonNullable<SheetV1Input['weapons']> = [];
  const armor: NonNullable<SheetV1Input['armor']> = [];
  const gear: NonNullable<SheetV1Input['gear']> = [];
  for (const p of build.purchases) {
    const ref = p.item.ref ?? p.ref;
    const withRef = ref ? { ref } : {};
    switch (p.list) {
      case 'augments':
        augments.push({
          ...p.item,
          ...withRef,
          essence: purchaseEssence(p, effects),
          ...(p.grade ? { grade: p.grade } : {}),
          ...(p.rating !== null ? { rating: p.rating } : {}),
        });
        break;
      case 'weapons':
        for (let n = 0; n < Math.min(p.qty, 50); n++) weapons.push({ ...p.item, ...withRef });
        break;
      case 'armor':
        // Every copy carried for now; the one suit worn is chosen below.
        for (let n = 0; n < Math.min(p.qty, 50); n++) armor.push({ ...p.item, ...withRef, worn: false });
        break;
      case 'gear':
        gear.push({ ...p.item, ...withRef, qty: p.qty, ...(p.rating !== null ? { rating: p.rating } : {}) });
        break;
    }
  }

  // A runner walks into play wearing their best suit: derive counts only worn
  // armor, the highest rating of it (derive-pools `deriveArmor`), so creation
  // armor left carried would leave the Armor pool at the racial bonus alone.
  // One piece — the highest rated, the first of equals — the rest carried, as
  // the sheet's worn/stowed toggle expects.
  const best = armor.reduce<number>((at, a, i) => (at === -1 || a.rating > armor[at]!.rating ? i : at), -1);
  if (best !== -1) armor[best] = { ...armor[best]!, worn: true };

  // --- Awakening ---
  const kindRow = MAGIC_KIND_TABLE[kind];
  const awakening0: SheetAwakening = {
    kind,
    aspect: kind === 'aspected' ? (build.magic.aspect ?? null) : null,
    tradition: build.magic.tradition ?? null,
    drain: drainPair(build),
    mentor: build.magic.mentor?.trim() || null,
    powerPoints: kindRow.powerPoints === 'free' ? t.magic : 0,
    // 0 here; the initiation spends raise it through `applySpend` below, the
    // same path an approved advancement takes in play.
    grade: 0,
  };

  const background = build.identity.background?.trim();
  const alias = build.identity.alias.trim();
  let sheet = SheetV1Schema.parse({
    v: 1,
    identity: {
      alias: alias || 'Unnamed runner',
      metatype: meta?.id ?? build.metatype ?? 'human',
      ...(build.identity.realName ? { realName: build.identity.realName } : {}),
      ...(typeof build.identity.age === 'number' ? { age: build.identity.age } : {}),
      ...(build.identity.sex ? { sex: build.identity.sex } : {}),
      ...(background ? { notes: background } : {}),
    },
    attributes: {
      ...attrs,
      edg: { max: r.attributes.edg.creation, current: r.attributes.edg.creation },
      ess: 6,
      mag: r.attributes.mag.creation,
      res: r.attributes.res.creation,
    },
    skills,
    knowledge,
    languages,
    qualities,
    augments,
    weapons,
    armor,
    spells: build.grants.spells.map(sheetSpellOf),
    powers: build.powers.map((p) => ({
      name: p.name,
      rating: p.levels,
      cost: p.cost,
      mods: p.mods,
      ...(p.ref ? { ref: p.ref } : {}),
      ...(p.target ? { note: p.target } : {}),
    })),
    complexForms: build.grants.forms.map(sheetFormOf),
    gear,
    lifestyles: build.lifestyles.map((l) => ({
      name: l.name,
      costPerMonth: lifestyleMonthlyCost(l, t.lifestyleMultiplier, effects.dependentsMultiplier),
    })),
    awakening: awakening0,
  } satisfies SheetV1Input);

  // --- Karma spends, through the advancement path ---
  for (const spend of build.karma.spends) sheet = applySpend(sheet, spend);
  sheet = SheetV1Schema.parse(sheet);

  // --- Beside the sheet ---
  const contacts: CompiledContact[] = build.karma.contacts.map((c) => ({
    name: c.name.trim() || 'Unnamed contact',
    archetype: c.role.trim(),
    connection: c.connection,
    loyalty: c.loyalty,
    notes: c.notes?.trim() || null,
  }));
  const spirits: CompiledSpirit[] = [];
  const sprites: CompiledSprite[] = [];
  const foci: CompiledFocus[] = [];
  const bought = focusPurchaseMatches(build);
  build.karma.spends.forEach((s, i) => {
    if (s.kind === 'spirit') spirits.push({ spiritType: s.type, force: Math.max(1, t.magic), services: s.services, bound: true });
    if (s.kind === 'sprite') sprites.push({ spriteType: s.type, level: Math.max(1, t.resonance), tasks: s.tasks, registered: true });
    if (s.kind === 'focus') {
      const type = focusSpendType(s);
      foci.push({
        name: s.name,
        kind: type ?? '',
        force: s.force,
        bonded: true,
        bondKarma: type ? focusBondingKarma(type, s.force) : s.bondKarma,
        purchaseIndex: bought[i] ?? null,
        sourceKind: s.sourceKind ?? 'power',
        targets: [...(s.targets ?? [])],
        mods: [...(s.mods ?? [])],
        ...(s.ref ? { ref: s.ref } : {}),
        ...(s.catalogueId ? { catalogueId: s.catalogueId } : {}),
      });
    }
  });
  const lifestyles: CompiledLifestyle[] = build.lifestyles.map((l) => ({
    name: l.name,
    tier: l.tier,
    months: l.months,
    costPerMonth: lifestyleMonthlyCost(l, t.lifestyleMultiplier, effects.dependentsMultiplier),
  }));

  // --- Opening balances ---
  const { preset } = tables;
  const nuyenCarry = Math.min(Math.max(0, t.nuyenRemaining), preset.nuyenCarry);
  const lifestyle = LIFESTYLES[startingLifestyle(build) ?? 'street'];
  const roll = options.startingNuyenRoll;
  const opening: CompiledOpening = {
    karma: Math.min(Math.max(0, t.karmaRemaining), preset.karmaCarry),
    nuyenCarry,
    startingNuyen: {
      dice: lifestyle.startingDice,
      multiplier: lifestyle.startingMultiplier,
      ...(roll === undefined ? {} : { total: roll * lifestyle.startingMultiplier + nuyenCarry }),
    },
  };

  return {
    sheet,
    awakening: sheet.awakening,
    contacts,
    spirits,
    sprites,
    foci,
    lifestyles,
    opening,
    issues: validate(build, settings),
  };
}
