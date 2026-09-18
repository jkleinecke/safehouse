/**
 * What a build's decisions add up to (FR3.9, docs/CHARGEN.md §4.1, §8.4):
 * the tables that apply to it, what its qualities change, and every rating
 * it produces.
 *
 * A build stores points spent, never ratings (§4.1), so everything the rail,
 * the validator and the compiler show is recomputed from here:
 *
 * - `effectiveTables` — which printing of the priority table, which creation
 *   level, and the five rows the build's priorities pick. The campaign's
 *   settings are authoritative for level and printing: the GM sets them and
 *   a draft follows (a build whose own `level`/`table` disagree gets a
 *   warning from the validator, not a different set of numbers).
 * - `qualityEffects` — the whitelisted qualities held (§8.4) resolved into
 *   the handful of facts creation needs: which attribute Exceptional
 *   Attribute lifts, which skill Aptitude opens to 7, how many native
 *   languages, the Dependents lifestyle surcharge, the groups a quality bars.
 * - `ratings` — base + points + Karma for all eleven attributes with the
 *   natural maximum after qualities, and every active skill, group,
 *   knowledge skill and language with where each rank came from.
 *
 * Karma raises follow `applySpend` (advance.ts): a raise sets the rating to
 * the higher of the running rating and its `to`, so the compiled sheet and
 * these ratings agree on every build, stale or not.
 *
 * Pure — no I/O. Numbers and page refs only (DESIGN.md §14).
 */
import {
  ATTRIBUTE_CODES,
  type AttributeCode,
  type BuildAttributeId,
  type BuildQuality,
  type CharacterBuild,
  type ChargenSettings,
  type CreationLevel,
  type KnowledgeCategory,
  type PriorityColumn,
  type PriorityTable,
} from '@safehouse/contracts';
import { attributeCode } from '../refs.js';
import { BOOK_QUALITY_CAP, CREATION_LEVEL_PRESETS, type CreationLevelPreset } from './levels.js';
import {
  CREATION_ATTRIBUTE_RULES,
  METATYPE_BY_ID,
  metatypeRow,
  type MetatypePriorityCell,
  type MetatypeRow,
} from './metatypes.js';
import {
  MAGIC_KIND_TABLE,
  PRIORITY_CHARTS,
  magicPriorityOption,
  type MagicPriorityOption,
  type PriorityChart,
  type PriorityRow,
} from './priority.js';
import { isQualityBuyOff, qualityRuleFor, racialQualities, type QualityRuleEntry, type QualityRuleId } from './qualityRules.js';
import {
  CREATION_SKILL_RULES,
  SKILL_GROUP_TABLE,
  activeSkillRow,
  skillGroupRow,
  type ActiveSkillRow,
  type SkillGroupId,
} from './skills.js';

// ---------------------------------------------------------------------------
// Effective tables
// ---------------------------------------------------------------------------

export interface EffectiveTables {
  level: CreationLevel;
  table: PriorityTable;
  chart: PriorityChart;
  /** The level's numbers with the campaign's caps and carry-over applied, and the quality cap the settings choose. */
  preset: CreationLevelPreset;
  /** The row each column's priority picks; null while the slot is empty. */
  rows: Readonly<Record<PriorityColumn, PriorityRow | null>>;
  /** The metatype row, or null when none (or an unknown id) is picked. */
  metatype: MetatypeRow | null;
  /** The metatype's cell on its priority row; null when it is not on that row. */
  metatypeCell: MetatypePriorityCell | null;
  /** The Magic/Resonance option the kind has on the magic row; null for a mundane or an option the row lacks. */
  magicOption: MagicPriorityOption | null;
  settings: ChargenSettings;
}

/** The priority table printing, level preset and rows that apply to a build under a campaign's settings. */
export function effectiveTables(build: CharacterBuild, settings: ChargenSettings): EffectiveTables {
  const level = settings.level;
  const table = settings.table;
  const chart = PRIORITY_CHARTS[table];
  const base = CREATION_LEVEL_PRESETS[level];
  const preset: CreationLevelPreset = {
    ...base,
    qualityCap: settings.levelQualityCaps ? base.qualityCap : BOOK_QUALITY_CAP,
    maxAvailability: settings.maxAvailability,
    maxDeviceRating: settings.maxDeviceRating,
    karmaCarry: settings.karmaCarry,
    nuyenCarry: settings.nuyenCarry,
  };
  const p = build.priorities;
  const row = (col: PriorityColumn): PriorityRow | null => {
    const lvl = p[col];
    return lvl ? chart[lvl] : null;
  };
  const metatype = metatypeRow(build.metatype ?? undefined);
  const metatypeCell = metatype && p.metatype ? metatype.priority[p.metatype] : null;
  const magicOption =
    p.magic && build.magic.kind !== 'mundane' ? magicPriorityOption(table, p.magic, build.magic.kind) : null;
  return {
    level,
    table,
    chart,
    preset,
    rows: {
      metatype: row('metatype'),
      attributes: row('attributes'),
      magic: row('magic'),
      skills: row('skills'),
      resources: row('resources'),
    },
    metatype,
    metatypeCell,
    magicOption,
    settings,
  };
}

// ---------------------------------------------------------------------------
// Quality effects
// ---------------------------------------------------------------------------

export interface HeldQuality {
  index: number;
  quality: BuildQuality;
  /** The whitelist entry, or null for a quality the engine leaves to the page (and for a buy-off line). */
  rule: QualityRuleEntry | null;
}

export interface QualityEffects {
  held: readonly HeldQuality[];
  /** Whitelisted ids held, each once however many times it was taken. */
  ids: ReadonlySet<QualityRuleId>;
  /** The attribute Exceptional Attribute lifts — never Edge — or null (none held, or no usable target). */
  exceptionalAttribute: Exclude<BuildAttributeId, 'edg'> | null;
  /** The active skill id Aptitude lets reach 7, or null. */
  aptitudeSkill: string | null;
  lucky: boolean;
  /** Free native languages: 1, or 2 with Bilingual (p. 89, p. 91). */
  nativeLanguages: number;
  /** Will to Live's rating, 0 when not held. */
  willToLive: number;
  /** Lifestyle cost multiplier from Dependents (1 when not held). */
  dependentsMultiplier: number;
  uncouth: boolean;
  /** Uneducated held as a quality or by birth (a metasapient's racial trait, RF p. 102). */
  uneducated: boolean;
  /** Whitelisted qualities the metatype is born with and has not bought off. */
  racial: readonly QualityRuleId[];
  sensitiveSystem: boolean;
  /** Groups a quality says can never be owned (Incompetent's chosen group; Uncouth's social groups). */
  barredGroups: readonly SkillGroupId[];
}

/** The text a quality names its target by: `target`, or the bracketed part of the name. */
function namedTarget(q: BuildQuality): string | null {
  if (q.target && q.target.trim()) return q.target.trim();
  const m = /[([{]\s*([^)\]}]+?)\s*[)\]}]/.exec(q.name);
  return m?.[1] ?? null;
}

const normId = (id: string): string => id.trim().toLowerCase().replace(/[\s_]+/g, '-');

/**
 * A whitelisted rated quality's rating: its `rating`, or the rating its Karma
 * pays for — the Dependents level with that Karma, Will to Live's Karma over
 * its per-rating cost. Whether the two agree when both are given is the
 * validator's question (`quality-karma-mismatch`).
 */
export function qualityRatingOf(held: Pick<HeldQuality, 'quality' | 'rule'>): number {
  if (held.quality.rating !== null) return held.quality.rating;
  for (const rule of held.rule?.rules ?? []) {
    if (rule.kind === 'lifestyleMultiplierByRating') {
      const level = rule.levels.find((l) => l.karma === held.quality.karma);
      if (level) return level.rating;
    }
    if (rule.kind === 'overflowPerRating' && rule.karmaPerRating > 0) {
      return Math.max(1, Math.floor(held.quality.karma / rule.karmaPerRating));
    }
  }
  return 1;
}

/** What a build's qualities change about creation (the §8.4 whitelist). */
export function qualityEffects(build: CharacterBuild): QualityEffects {
  const held: HeldQuality[] = build.qualities.map((quality, index) => ({
    index,
    quality,
    rule: isQualityBuyOff(quality, build.metatype) ? null : qualityRuleFor(quality.name),
  }));
  const ids = new Set<QualityRuleId>();
  for (const h of held) if (h.rule) ids.add(h.rule.id);
  const first = (id: QualityRuleId): HeldQuality | undefined => held.find((h) => h.rule?.id === id);

  let exceptionalAttribute: QualityEffects['exceptionalAttribute'] = null;
  const ea = first('exceptionalAttribute');
  if (ea) {
    const text = namedTarget(ea.quality);
    const code = text ? attributeCode(text) : null;
    if (code && (ATTRIBUTE_CODES as readonly string[]).includes(code)) exceptionalAttribute = code as AttributeCode;
    else if (code === 'mag' || code === 'res') exceptionalAttribute = code;
  }

  let aptitudeSkill: string | null = null;
  const apt = first('aptitude');
  if (apt) {
    const text = namedTarget(apt.quality);
    if (text) aptitudeSkill = activeSkillRow(text)?.id ?? null;
  }

  let willToLive = 0;
  let dependentsMultiplier = 1;
  for (const h of held) {
    for (const rule of h.rule?.rules ?? []) {
      if (rule.kind === 'overflowPerRating') willToLive = Math.max(willToLive, Math.min(rule.max, qualityRatingOf(h)));
      if (rule.kind === 'lifestyleMultiplierByRating') {
        const r = qualityRatingOf(h);
        const level = rule.levels.find((l) => l.rating === r) ?? rule.levels[rule.levels.length - 1];
        if (level) dependentsMultiplier = Math.max(dependentsMultiplier, level.multiplier);
      }
    }
  }

  const racial = racialQualities(build.metatype, build.qualities);

  const barred = new Set<SkillGroupId>();
  for (const h of held) {
    for (const rule of h.rule?.rules ?? []) {
      if (rule.kind !== 'barsGroup') continue;
      if (rule.groups === 'chosen') {
        const text = namedTarget(h.quality);
        const group = text ? skillGroupRow(normId(text)) : null;
        if (group) barred.add(group.id);
      } else {
        for (const g of rule.groups) barred.add(g);
      }
    }
  }

  return {
    held,
    ids,
    exceptionalAttribute,
    aptitudeSkill,
    lucky: ids.has('lucky'),
    nativeLanguages: ids.has('bilingual')
      ? CREATION_SKILL_RULES.nativeLanguagesWithBilingual
      : CREATION_SKILL_RULES.nativeLanguages,
    willToLive,
    dependentsMultiplier,
    uncouth: ids.has('uncouth'),
    uneducated: ids.has('uneducated') || racial.includes('uneducated'),
    racial,
    sensitiveSystem: ids.has('sensitiveSystem'),
    barredGroups: [...barred],
  };
}

// ---------------------------------------------------------------------------
// Ratings
// ---------------------------------------------------------------------------

export interface AttributeRating {
  id: BuildAttributeId;
  /** Free: the metatype's starting rating, or the Magic/Resonance rating the priority grants. */
  base: number;
  /** Attribute points (the eight) or special points (Edge, Magic, Resonance). */
  points: number;
  /** base + points — the rating before any Karma. */
  creation: number;
  /** Ranks added with Karma. */
  karma: number;
  rating: number;
  /** Natural maximum after Exceptional Attribute or Lucky. */
  max: number;
  /** The metatype table's own maximum. */
  tableMax: number;
}

export interface SkillRating {
  id: string;
  target?: string;
  /** The table row; null for an id the skill table does not know. */
  row: ActiveSkillRow | null;
  /** The group this skill is rated through, when that group is owned. */
  group: SkillGroupId | null;
  groupRating: number;
  /** The free rating the Magic/Resonance column granted. */
  grant: number;
  points: number;
  /** The specialisation bought with a skill point, if any. */
  pointSpec: string | null;
  /** Every specialisation: the point-bought one first, then Karma ones. */
  specs: readonly string[];
  creation: number;
  karma: number;
  rating: number;
  /** 6, or 7 for the Aptitude skill (p. 88). */
  max: number;
  /** Index in `skills.active`, or null for a skill only a group, grant or Karma gave. */
  index: number | null;
}

export interface GroupRating {
  id: string;
  row: ReturnType<typeof skillGroupRow>;
  grant: number;
  points: number;
  creation: number;
  karma: number;
  rating: number;
  /** Index in `skills.groups`, or null. */
  index: number | null;
}

export interface KnowledgeRating {
  name: string;
  /** Null for a knowledge skill learned only with Karma and never given a category. */
  category: KnowledgeCategory | null;
  points: number;
  skillPoints: number;
  pointSpec: string | null;
  specs: readonly string[];
  creation: number;
  karma: number;
  rating: number;
  index: number | null;
}

export interface LanguageRating {
  name: string;
  native: boolean;
  points: number;
  skillPoints: number;
  pointSpec: string | null;
  specs: readonly string[];
  creation: number;
  karma: number;
  rating: number;
  index: number | null;
}

export interface BuildRatings {
  /** The metatype row; null when none is picked (ratings then preview a human's bases). */
  metatype: MetatypeRow | null;
  attributes: Readonly<Record<BuildAttributeId, AttributeRating>>;
  skills: readonly SkillRating[];
  groups: readonly GroupRating[];
  knowledge: readonly KnowledgeRating[];
  languages: readonly LanguageRating[];
}

/** Names are matched case- and space-insensitively, so one key per name. */
const lc = (s: string): string => s.trim().toLowerCase();

/** One `Map` entry raised to the highest `to` any spend asked for. */
function raise(into: Map<string, number>, key: string, to: number): void {
  const held = into.get(key);
  if (held === undefined || to > held) into.set(key, to);
}

function collect(into: Map<string, string[]>, key: string, value: string): void {
  const held = into.get(key);
  if (held) held.push(value);
  else into.set(key, [value]);
}

/**
 * The Karma spends, read ONCE into lookups keyed the way each rating asks for
 * them.
 *
 * `ratings` used to walk the whole spend list again for every attribute,
 * group, skill, knowledge skill and language it was building — and the
 * knowledge and language lists were themselves grown with a linear `find` per
 * entry. Both are O(n²) in the number of spends, which the record's lists did
 * not bound: `budgets`, `validate` and `compileBuild` all run through here, so
 * a long record turned each of them from milliseconds into seconds, and on the
 * server those passes sat in front of the table's one database connection.
 *
 * The lists are bounded now (`BUILD_LIST_MAX`), so this is no longer the only
 * thing standing between a build and a frozen table — but the same passes run
 * in the browser on every keystroke, and one walk is the honest cost of them.
 *
 * Insertion order is the spend list's order, so the rows this creates for
 * spends on things the build did not otherwise name appear exactly where the
 * old per-spend loops put them.
 */
interface SpendIndex {
  /** Highest rating asked for, by attribute code. */
  attribute: Map<string, number>;
  /** Highest rating, by canonical group id; `first` is the id as the first spend spelled it. */
  group: Map<string, { id: string; to: number }>;
  /** Highest rating, by `skillKey` (id and target). */
  skill: Map<string, { id: string; target: string | null; to: number }>;
  /**
   * Highest rating, by lower-cased name; `name` and `category` are the first
   * spend's, which is the one the old loop would have created a row from.
   */
  knowledge: Map<string, { name: string; category: KnowledgeCategory | null; to: number }>;
  language: Map<string, { name: string; to: number }>;
  /** Specialisations bought with Karma, by `${list}|${normalised id}`, in spend order. */
  specs: Map<string, string[]>;
}

function spendIndex(spends: readonly CharacterBuild['karma']['spends'][number][]): SpendIndex {
  const index: SpendIndex = {
    attribute: new Map(),
    group: new Map(),
    skill: new Map(),
    knowledge: new Map(),
    language: new Map(),
    specs: new Map(),
  };
  for (const s of spends) {
    switch (s.kind) {
      case 'attribute':
        raise(index.attribute, s.id, s.to);
        break;
      case 'group': {
        const key = skillGroupRow(s.id)?.id ?? normId(s.id);
        const held = index.group.get(key);
        if (held) held.to = Math.max(held.to, s.to);
        else index.group.set(key, { id: s.id, to: s.to });
        break;
      }
      case 'skill': {
        const key = skillKey(s.id, s.target);
        const held = index.skill.get(key);
        if (held) held.to = Math.max(held.to, s.to);
        else index.skill.set(key, { id: s.id, target: s.target ?? null, to: s.to });
        break;
      }
      case 'knowledge': {
        const held = index.knowledge.get(lc(s.name));
        if (held) held.to = Math.max(held.to, s.to);
        else index.knowledge.set(lc(s.name), { name: s.name, category: s.category ?? null, to: s.to });
        break;
      }
      case 'language': {
        const held = index.language.get(lc(s.name));
        if (held) held.to = Math.max(held.to, s.to);
        else index.language.set(lc(s.name), { name: s.name, to: s.to });
        break;
      }
      case 'specialization': {
        const id = s.list === 'active' ? (activeSkillRow(s.id)?.id ?? normId(s.id)) : lc(s.id);
        collect(index.specs, `${s.list}|${id}`, s.spec.trim());
        break;
      }
      default:
        break;
    }
  }
  return index;
}
const skillKey = (id: string, target?: string | null): string =>
  `${activeSkillRow(id)?.id ?? normId(id)}|${(target ?? '').trim().toLowerCase()}`;

/**
 * Every rating a build produces. `settings` picks the printing whose Magic or
 * Resonance rating applies (both printings agree on the ratings, so the
 * build's own `table` is a fine default).
 */
export function ratings(build: CharacterBuild, settings?: Pick<ChargenSettings, 'table'>): BuildRatings {
  const metatype = metatypeRow(build.metatype ?? undefined);
  const meta = metatype ?? METATYPE_BY_ID.human;
  const effects = qualityEffects(build);
  const table = settings?.table ?? build.table;
  const kind = build.magic.kind;
  const kindRow = MAGIC_KIND_TABLE[kind];
  const option = build.priorities.magic && kind !== 'mundane' ? magicPriorityOption(table, build.priorities.magic, kind) : null;
  const spends = build.karma.spends;
  const spent = spendIndex(spends);

  // --- Attributes ---
  const attributes = {} as Record<BuildAttributeId, AttributeRating>;
  const finish = (id: BuildAttributeId, base: number, points: number, max: number, tableMax: number): void => {
    const creation = base + points;
    const running = Math.max(creation, spent.attribute.get(id) ?? 0);
    attributes[id] = { id, base, points, creation, karma: running - creation, rating: running, max, tableMax };
  };
  for (const code of ATTRIBUTE_CODES) {
    const range = meta.attributes[code];
    finish(code, range.base, build.attributes[code], range.max + (effects.exceptionalAttribute === code ? 1 : 0), range.max);
  }
  const edge = meta.attributes.edg;
  finish('edg', edge.base, build.special.edg, edge.max + (effects.lucky ? 1 : 0), edge.max);
  const magBase = kindRow.attribute === 'mag' && option ? option.rating : meta.magic.base;
  const magMax = Math.min(meta.magic.max, CREATION_ATTRIBUTE_RULES.specialMax);
  finish('mag', magBase, build.special.mag, magMax + (effects.exceptionalAttribute === 'mag' ? 1 : 0), magMax);
  const resBase = kindRow.attribute === 'res' && option ? option.rating : (meta.resonance?.base ?? 0);
  const resMax = meta.resonance ? Math.min(meta.resonance.max, CREATION_ATTRIBUTE_RULES.specialMax) : 0;
  finish('res', resBase, build.special.res, resMax + (effects.exceptionalAttribute === 'res' ? 1 : 0), resMax);

  // --- Groups (points + aspected grant, then Karma) ---
  const groupMap = new Map<string, GroupRating>();
  const groupOf = (id: string): GroupRating => {
    const key = skillGroupRow(id)?.id ?? normId(id);
    let g = groupMap.get(key);
    if (!g) {
      g = { id: key, row: skillGroupRow(key), grant: 0, points: 0, creation: 0, karma: 0, rating: 0, index: null };
      groupMap.set(key, g);
    }
    return g;
  };
  build.skills.groups.forEach((entry, index) => {
    const g = groupOf(entry.id);
    g.points += entry.points;
    if (g.index === null) g.index = index;
  });
  for (const grant of build.grants.groups) groupOf(grant.id).grant = Math.max(groupOf(grant.id).grant, grant.rating);
  for (const g of groupMap.values()) g.creation = g.grant + g.points;
  const groupCreation = new Map([...groupMap].map(([k, g]) => [k, g.creation] as const));
  for (const g of groupMap.values()) g.rating = g.creation;
  for (const raised of spent.group.values()) {
    const g = groupOf(raised.id);
    g.rating = Math.max(g.rating, raised.to);
  }
  for (const g of groupMap.values()) g.karma = g.rating - g.creation;
  const groups = [...groupMap.values()];
  const ownedGroupOf = (row: ActiveSkillRow | null): { id: SkillGroupId; creation: number; final: number } | null => {
    if (!row?.group) return null;
    const g = groupMap.get(row.group);
    if (!g || g.rating <= 0) return null;
    return { id: row.group, creation: groupCreation.get(row.group) ?? 0, final: g.rating };
  };

  // --- Active skills ---
  const skillMap = new Map<string, SkillRating>();
  const skillOf = (id: string, target?: string | null): SkillRating => {
    const key = skillKey(id, target);
    let sk = skillMap.get(key);
    if (!sk) {
      const row = activeSkillRow(id);
      const t = target?.trim();
      sk = {
        id: row?.id ?? normId(id),
        ...(t ? { target: t } : {}),
        row,
        group: null,
        groupRating: 0,
        grant: 0,
        points: 0,
        pointSpec: null,
        specs: [],
        creation: 0,
        karma: 0,
        rating: 0,
        max: 0,
        index: null,
      };
      skillMap.set(key, sk);
    }
    return sk;
  };
  // Members of owned groups, in table order.
  for (const g of SKILL_GROUP_TABLE) {
    if ((groupMap.get(g.id)?.rating ?? 0) > 0) for (const member of g.skills) skillOf(member);
  }
  build.skills.active.forEach((entry, index) => {
    const sk = skillOf(entry.id, entry.target);
    sk.points += entry.points;
    if (sk.index === null) sk.index = index;
    if (entry.spec && entry.spec.trim() && sk.pointSpec === null) sk.pointSpec = entry.spec.trim();
  });
  for (const grant of build.grants.skills) {
    const sk = skillOf(grant.id);
    sk.grant = Math.max(sk.grant, grant.rating);
  }
  for (const raised of spent.skill.values()) skillOf(raised.id, raised.target);

  const karmaSpecs = (list: 'active' | 'knowledge' | 'language', id: string): readonly string[] =>
    spent.specs.get(`${list}|${id}`) ?? [];

  for (const sk of skillMap.values()) {
    const owned = ownedGroupOf(sk.row);
    sk.group = owned?.id ?? null;
    sk.groupRating = owned?.creation ?? 0;
    sk.creation = sk.groupRating + sk.grant + sk.points;
    let running = Math.max(sk.creation, spent.skill.get(skillKey(sk.id, sk.target))?.to ?? 0);
    if (owned) running = Math.max(running, owned.final);
    sk.rating = running;
    sk.karma = running - sk.creation;
    sk.max = effects.aptitudeSkill === sk.id ? CREATION_SKILL_RULES.maxRatingWithAptitude : CREATION_SKILL_RULES.maxRating;
    sk.specs = [...(sk.pointSpec ? [sk.pointSpec] : []), ...karmaSpecs('active', sk.id)];
  }

  // --- Knowledge and languages ---
  // Two indexes, not one: an entry with no name never merges with another
  // unnamed entry (each blank row is its own line on the screen), but a SPEND
  // with no name does find one, because `some(k => same(k.name, ''))` did.
  const knowledge: KnowledgeRating[] = [];
  const knowledgeNamed = new Map<string, KnowledgeRating>();
  const knowledgeNames = new Set<string>();
  build.skills.knowledge.forEach((entry, index) => {
    const key = lc(entry.name);
    const existing = key ? knowledgeNamed.get(key) : undefined;
    if (existing) {
      existing.points += entry.points;
      existing.skillPoints += entry.skillPoints;
      return;
    }
    const added: KnowledgeRating = {
      name: entry.name.trim(),
      category: entry.category,
      points: entry.points,
      skillPoints: entry.skillPoints,
      pointSpec: entry.spec?.trim() || null,
      specs: [],
      creation: 0,
      karma: 0,
      rating: 0,
      index,
    };
    knowledge.push(added);
    knowledgeNames.add(key);
    if (key) knowledgeNamed.set(key, added);
  });
  const languages: LanguageRating[] = [];
  const languagesNamed = new Map<string, LanguageRating>();
  const languageNames = new Set<string>();
  build.skills.languages.forEach((entry, index) => {
    const key = lc(entry.name);
    const existing = key ? languagesNamed.get(key) : undefined;
    if (existing) {
      existing.points += entry.points;
      existing.skillPoints += entry.skillPoints;
      existing.native = existing.native || entry.native;
      return;
    }
    const added: LanguageRating = {
      name: entry.name.trim(),
      native: entry.native,
      points: entry.points,
      skillPoints: entry.skillPoints,
      pointSpec: entry.spec?.trim() || null,
      specs: [],
      creation: 0,
      karma: 0,
      rating: 0,
      index,
    };
    languages.push(added);
    languageNames.add(key);
    if (key) languagesNamed.set(key, added);
  });
  // A spend on something the build did not otherwise name gets a row of its
  // own, in the order the spends first named it.
  for (const [key, raised] of spent.knowledge) {
    if (knowledgeNames.has(key)) continue;
    knowledgeNames.add(key);
    knowledge.push({
      name: raised.name.trim(),
      category: raised.category,
      points: 0,
      skillPoints: 0,
      pointSpec: null,
      specs: [],
      creation: 0,
      karma: 0,
      rating: 0,
      index: null,
    });
  }
  for (const [key, raised] of spent.language) {
    if (languageNames.has(key)) continue;
    languageNames.add(key);
    languages.push({
      name: raised.name.trim(),
      native: false,
      points: 0,
      skillPoints: 0,
      pointSpec: null,
      specs: [],
      creation: 0,
      karma: 0,
      rating: 0,
      index: null,
    });
  }
  for (const k of knowledge) {
    k.creation = k.points + k.skillPoints;
    const running = Math.max(k.creation, spent.knowledge.get(lc(k.name))?.to ?? 0);
    k.rating = running;
    k.karma = running - k.creation;
    k.specs = [...(k.pointSpec ? [k.pointSpec] : []), ...karmaSpecs('knowledge', lc(k.name))];
  }
  for (const l of languages) {
    l.creation = l.points + l.skillPoints;
    const running = Math.max(l.creation, spent.language.get(lc(l.name))?.to ?? 0);
    l.rating = running;
    l.karma = running - l.creation;
    l.specs = [...(l.pointSpec ? [l.pointSpec] : []), ...karmaSpecs('language', lc(l.name))];
  }

  return {
    metatype,
    attributes,
    skills: [...skillMap.values()],
    groups,
    knowledge,
    languages,
  };
}
