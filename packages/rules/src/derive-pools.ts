import type {
  DerivedValue,
  LimitKind,
  Modifier,
  PoolBreakdown,
  ProvenanceEntry,
  SheetV1,
  SkillAttr,
} from '@safehouse/contracts';
import { metatypeRow } from './chargen/metatypes.js';
import { applyPipeline, baseEntry } from './derive-pipeline.js';

/** Which inherent limit a skill test uses, keyed by the skill's linked attribute. */
export function skillLimitKind(attr: SkillAttr): Exclude<LimitKind, 'accuracy' | 'force'> | null {
  switch (attr) {
    case 'bod':
    case 'agi':
    case 'rea':
    case 'str':
      return 'physical';
    case 'wil':
    case 'log':
    case 'int':
      return 'mental';
    case 'cha':
      return 'social';
    default:
      // mag / res tests are limited by Force / level, set per-cast — no static limit.
      return null;
  }
}

interface LimitsIn {
  physical: DerivedValue;
  mental: DerivedValue;
  social: DerivedValue;
}

/**
 * The pool key for one skill row. A row that names no target keeps the key
 * every reader already has (`skill.perception`), so old macros, `rollRefs`
 * and stored `meta.poolRef` values keep resolving. A row that names one —
 * Exotic Melee, Exotic Ranged, Pilot Exotic Vehicle, which the sheet stores
 * as one row per weapon or vehicle (`SheetSkillSchema.target`) — gets the
 * target appended after `::`, because two such rows share an id and keying by
 * the id alone let the second silently overwrite the first's pool.
 *
 * The target is slugged (lower case, runs of anything but a letter or digit
 * collapsed to one `-`) so the key is stable across capitalisation and
 * spacing, and never carries a character a modifier target cannot spell.
 */
export function skillPoolKey(id: string, target?: string | null): string {
  const slug = (target ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug ? `skill.${id}::${slug}` : `skill.${id}`;
}

function attrValue(attrs: Record<string, DerivedValue>, code: string): number {
  return attrs[code]?.value ?? 0;
}

/** Orthoskin, by name — the implant that replaces natural dermal deposits. */
const ORTHOSKIN_RE = /orthoskin/i;

/**
 * The armor a metatype is born with: a troll's +1 dermal armor (SR5 p.66),
 * read from the metatype table's `dermalArmor` trait so the number lives in
 * one place. It stacks with whatever is worn and needs no modifier on the
 * sheet, so an imported troll gets it as surely as a built one — the same
 * footing as racial vision, which is also read from the metatype.
 *
 * Orthoskin replaces the natural dermal deposits and the bonus goes with
 * them (SR5 p.94). The implant is recognised by name, as racial vision
 * recognises cybereyes.
 */
function racialArmorEntry(sheet: SheetV1): ProvenanceEntry | null {
  const row = metatypeRow(sheet.identity.metatype);
  const trait = row?.traits.find((t) => t.id === 'dermalArmor');
  if (!row || !trait?.value) return null;
  if (sheet.augments.some((aug) => ORTHOSKIN_RE.test(aug.name))) return null;
  return { label: `dermal armor (${row.id})`, value: trait.value, source: 'racial' };
}

/**
 * Derived armor value: highest worn armor item (SR5 wears one suit; stacking
 * accessories land as `armor`-targeted modifiers), plus racial dermal armor,
 * plus `armor` modifiers.
 */
export function deriveArmor(sheet: SheetV1, mods: readonly Modifier[]): PoolBreakdown {
  const worn = sheet.armor.filter((a) => a.worn);
  let base = 0;
  const entries: ProvenanceEntry[] = [];
  if (worn.length > 0) {
    const best = worn.reduce((a, b) => (b.rating > a.rating ? b : a));
    base = best.rating;
    entries.push(baseEntry(best.name, best.rating));
  }
  const racial = racialArmorEntry(sheet);
  if (racial) {
    base += racial.value;
    entries.push(racial);
  }
  const res = applyPipeline(base, entries, ['armor'], mods, { floorZero: true });
  return { total: res.value, breakdown: res.breakdown };
}

/**
 * Build every dice pool with provenance (FR3.3): one per skill, per weapon,
 * per spell, plus `defense`, `soak`, and the derived `armor` value.
 *
 * Modifier targets honored per pool: `pool.skill.<id>`, `pool.weapon.<name>`,
 * `pool.spell.<name>`, `pool.defense`, `pool.soak`, and `pool.all` (which hits
 * every pool EXCEPT `soak` and `armor` — damage-resistance tests are exempt
 * from wound/scene/sustaining penalties).
 *
 * A skill row that names a target is keyed `skill.<id>::<target>`
 * (`skillPoolKey`) and answers to `pool.skill.<id>::<target>` as well as the
 * bare `pool.skill.<id>`.
 */
export function buildPools(
  sheet: SheetV1,
  attrs: Record<string, DerivedValue>,
  limits: LimitsIn,
  mods: readonly Modifier[],
): Record<string, PoolBreakdown> {
  const pools: Record<string, PoolBreakdown> = {};

  const armor = deriveArmor(sheet, mods);
  pools['armor'] = armor;

  // Skill pools: linked attribute + rating.
  for (const skill of sheet.skills) {
    const av = attrValue(attrs, skill.attr);
    const key = skillPoolKey(skill.id, skill.target);
    const entries: ProvenanceEntry[] = [
      { label: skill.attr.toUpperCase(), value: av, source: 'attribute' },
      { label: skill.target ? `${skill.id} (${skill.target})` : skill.id, value: skill.rating, source: 'skill' },
    ];
    // A targeted row answers to its own target AND to the bare skill, so a
    // power or a quality written for Exotic Ranged reaches every weapon of it.
    const targets =
      key === `skill.${skill.id}`
        ? [`pool.skill.${skill.id}`, 'pool.all']
        : [`pool.${key}`, `pool.skill.${skill.id}`, 'pool.all'];
    const res = applyPipeline(av + skill.rating, entries, targets, mods, { floorZero: true });
    const lk = skillLimitKind(skill.attr);
    pools[key] = {
      total: res.value,
      breakdown: res.breakdown,
      ...(lk ? { limit: { kind: lk, value: limits[lk].value } } : {}),
    };
  }

  // Weapon pools: the weapon's skill pool (defaulting AGI−1 when the skill is
  // missing), limited by Accuracy when the sheet provides one.
  for (const weapon of sheet.weapons) {
    const skill = sheet.skills.find((s) => s.id === weapon.skillId);
    let base: number;
    const entries: ProvenanceEntry[] = [];
    if (skill) {
      const av = attrValue(attrs, skill.attr);
      base = av + skill.rating;
      entries.push(
        { label: skill.attr.toUpperCase(), value: av, source: 'attribute' },
        { label: skill.id, value: skill.rating, source: 'skill' },
      );
    } else {
      const agi = attrValue(attrs, 'agi');
      base = agi - 1;
      entries.push(
        { label: 'AGI', value: agi, source: 'attribute' },
        { label: `defaulting (no ${weapon.skillId})`, value: -1, source: 'skill' },
      );
    }
    const res = applyPipeline(
      base,
      entries,
      [`pool.weapon.${weapon.name}`, `pool.skill.${weapon.skillId}`, 'pool.all'],
      mods,
      { floorZero: true },
    );
    pools[`weapon.${weapon.name}`] = {
      total: res.value,
      breakdown: res.breakdown,
      ...(weapon.acc !== undefined
        ? { limit: { kind: 'accuracy' as const, value: weapon.acc } }
        : {}),
    };
  }

  // Spell pools: MAG + Spellcasting (skill id 'spellcasting' when present).
  // The limit is Force, chosen at cast time — no static limit attached.
  if (sheet.spells.length > 0) {
    const casting = sheet.skills.find((s) => s.id === 'spellcasting');
    const mag = attrValue(attrs, 'mag');
    for (const spell of sheet.spells) {
      const entries: ProvenanceEntry[] = [{ label: 'MAG', value: mag, source: 'attribute' }];
      let base = mag;
      if (casting) {
        base += casting.rating;
        entries.push({ label: casting.id, value: casting.rating, source: 'skill' });
      }
      const targets = [`pool.spell.${spell.name}`, 'pool.all'];
      if (casting) targets.push(`pool.skill.${casting.id}`);
      const res = applyPipeline(base, entries, targets, mods, { floorZero: true });
      pools[`spell.${spell.name}`] = { total: res.value, breakdown: res.breakdown };
    }
  }

  // Defense: REA + INT (FR10.8's baseline defense pool).
  {
    const rea = attrValue(attrs, 'rea');
    const int = attrValue(attrs, 'int');
    const res = applyPipeline(
      rea + int,
      [
        { label: 'REA', value: rea, source: 'attribute' },
        { label: 'INT', value: int, source: 'attribute' },
      ],
      ['pool.defense', 'pool.all'],
      mods,
      { floorZero: true },
    );
    pools['defense'] = { total: res.value, breakdown: res.breakdown };
  }

  // Soak: BOD + modified armor. Exempt from `pool.all` (damage resistance
  // ignores wound modifiers, sustaining and scene penalties per §10.2 soak).
  {
    const bod = attrValue(attrs, 'bod');
    const res = applyPipeline(
      bod + armor.total,
      [
        { label: 'BOD', value: bod, source: 'attribute' },
        { label: 'Armor', value: armor.total, source: 'armor' },
      ],
      ['pool.soak'],
      mods,
      { floorZero: true },
    );
    pools['soak'] = { total: res.value, breakdown: res.breakdown };
  }

  return pools;
}
