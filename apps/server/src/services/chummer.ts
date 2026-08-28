/**
 * Chummer5a `.chum5` import (FR3.1, DESIGN.md §6 M3 / §14.5).
 *
 * Three pieces, all pure (no I/O, no db) so the plugin stays thin:
 *
 * 1. The forgiving XML walker in `chummer-xml.ts` (no new dependency),
 *    re-exported here so callers have one import site.
 * 2. `importChummer(xml)` → `{ sheet, report, karma, nuyen }`: maps attributes,
 *    skills, qualities, cyberware/bioware, weapons, armor, gear, lifestyles,
 *    spells, powers and complex forms into `SheetV1`, and lists every
 *    data-bearing node name it did NOT understand so the owner can enter it by
 *    hand (Principle 5).
 * 3. `diffSheets(before, after)` → field-level diff, so a re-import can show
 *    what would change before anything is overwritten (FR3.1).
 *
 * We parse the user's own save; we never bundle or redistribute Chummer's data
 * files (§14.5). Nothing in here ships book content — names, numbers and
 * `{book,page}` refs all come out of the user's file.
 */
import {
  SheetV1Schema,
  SkillAttrSchema,
  type Ref,
  type SheetArmor,
  type SheetAugment,
  type SheetGear,
  type SheetSkill,
  type SheetV1,
  type SheetWeapon,
} from '@safehouse/contracts';

import { deepAll, deepFind, flag, kid, num, parseXml, txt, type XmlNode } from './chummer-xml.js';

// One import site for the importer: the walker is re-exported here.
export {
  decodeEntities,
  deepAll,
  deepFind,
  flag,
  kid,
  kids,
  num,
  parseXml,
  txt,
  type XmlNode,
} from './chummer-xml.js';

// ---------------------------------------------------------------------------
// 2. Mapping → SheetV1
// ---------------------------------------------------------------------------

export interface ChummerReport {
  format: 'chummer5';
  /** How many of each list we mapped. */
  counts: Record<string, number>;
  /** Data-bearing node names we did not map — enter these by hand (FR3.1). */
  unmapped: string[];
  /** Assumptions worth reading before trusting the sheet. */
  notes: string[];
}

export interface ChummerImport {
  sheet: SheetV1;
  report: ChummerReport;
  /** Chummer's current karma balance — seeds the ledger, never the sheet (FR3.6). */
  karma: number;
  /** Chummer's current nuyen balance — seeds the ledger (FR3.6). */
  nuyen: number;
}

/** Node names we map (directly or as a container). */
const HANDLED = new Set([
  'alias', 'name', 'metatype', 'metavariant', 'notes', 'karma', 'totalkarma', 'nuyen',
  'essence', 'attributes', 'newskills', 'skills', 'knoskills', 'qualities', 'cyberwares',
  'biowares', 'weapons', 'armors', 'gears', 'lifestyles', 'spells', 'powers', 'adeptpowers',
  'complexforms', 'metatypebp',
]);

/** Save metadata — deliberately ignored, and not worth reporting. */
const IGNORED = new Set([
  'appversion', 'gameedition', 'settings', 'buildmethod', 'created', 'sex', 'age', 'height',
  'weight', 'eyes', 'hair', 'skin', 'description', 'background', 'concept', 'playername',
  'gamenotes', 'mugshots', 'mainmugshotindex', 'calendar', 'sources', 'customdatadirectorynames',
  'buildpoints', 'sumtoten', 'maxnuyen', 'nuyenbp', 'ignorerules', 'prioritymetatype',
  'priorityattributes', 'priorityspecial', 'priorityskills', 'priorityresources', 'prioritytalent',
]);

const ATTR_KEYS: Record<string, keyof SheetV1['attributes'] | 'edg'> = {
  bod: 'bod', agi: 'agi', rea: 'rea', str: 'str', wil: 'wil', log: 'log', int: 'int', cha: 'cha',
  edg: 'edg', mag: 'mag', res: 'res',
};

/** `Assault Rifles` → `assault-rifles`; the id shape pools are keyed by. */
export function slug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Weapon category → the active skill that fires it (SR5 skill names). */
const CATEGORY_SKILL: ReadonlyArray<readonly [RegExp, string]> = [
  [/machine pistol|submachine|assault rifle|machine gun|automatics/i, 'automatics'],
  [/pistol|hold-?out|revolver/i, 'pistols'],
  [/sniper|sporting rifle|shotgun|longarm|rifle|carbine/i, 'longarms'],
  [/launcher|cannon|heavy weapon|missile|grenade/i, 'heavy-weapons'],
  [/bow|crossbow|throw/i, 'archery'],
  [/blade|sword|knife|axe/i, 'blades'],
  [/club|baton|hammer|staff/i, 'clubs'],
  [/unarmed|cyber-?implant|exotic melee/i, 'unarmed-combat'],
];

function refOf(node: XmlNode): Ref | undefined {
  const book = txt(node, 'source');
  const page = num(node, 'page', 0);
  if (book.length === 0 || page <= 0) return undefined;
  return { book, page: Math.trunc(page) };
}

function attributeTotal(node: XmlNode): number {
  const explicit = kid(node, 'totalvalue') ?? kid(node, 'value') ?? kid(node, 'total');
  if (explicit && txt(explicit).length > 0) return Math.max(0, Math.round(num(explicit)));
  const min = kid(node, 'metatypemin') ? num(node, 'metatypemin', 0) : 0;
  return Math.max(0, Math.round(min + num(node, 'base', 0) + num(node, 'karma', 0)));
}

function mapAttributes(character: XmlNode, sheet: Record<string, unknown>, report: ChummerReport): void {
  const attrs: Record<string, number> = {};
  let edge = 0;
  for (const node of deepAll(character, 'attribute')) {
    const code = txt(node, 'name').toLowerCase();
    const key = ATTR_KEYS[code];
    if (!key) {
      if (code.length > 0 && code !== 'ess' && code !== 'dep') {
        report.notes.push(`attribute '${code}' not part of SheetV1 — skipped`);
      }
      continue;
    }
    const total = attributeTotal(node);
    if (key === 'edg') edge = total;
    else attrs[key] = total;
  }
  // SheetV1.attributes.ess is BASE Essence — the engine subtracts each
  // augment's cost itself (§10.2). Chummer stores the net value, so rebuild
  // the base from it: base = net + Σ costs (6 for an unaugmented metahuman).
  const augments = (sheet['augments'] as SheetAugment[] | undefined) ?? [];
  const essSpent = augments.reduce((sum, a) => sum + a.essence, 0);
  const declared = kid(character, 'essence');
  const net = declared && txt(declared).length > 0 ? Number.parseFloat(txt(declared)) : null;
  const ess = net !== null && Number.isFinite(net) ? net + essSpent : 6;
  if (Math.abs(ess - 6) > 0.01) {
    report.notes.push(`base Essence reconstructed as ${Math.round(ess * 100) / 100} (net ${net ?? '?'} + ${Math.round(essSpent * 100) / 100} of 'ware)`);
  }
  sheet['attributes'] = {
    bod: attrs['bod'] ?? 1,
    agi: attrs['agi'] ?? 1,
    rea: attrs['rea'] ?? 1,
    str: attrs['str'] ?? 1,
    wil: attrs['wil'] ?? 1,
    log: attrs['log'] ?? 1,
    int: attrs['int'] ?? 1,
    cha: attrs['cha'] ?? 1,
    edg: { max: edge, current: edge },
    ess: Number.isFinite(ess) ? Math.round(ess * 100) / 100 : 6,
    mag: attrs['mag'] ?? 0,
    res: attrs['res'] ?? 0,
  };
  report.counts['attributes'] = Object.keys(attrs).length + (edge > 0 ? 1 : 0);
}

function mapSkills(character: XmlNode, report: ChummerReport): SheetSkill[] {
  const out: SheetSkill[] = [];
  const seen = new Set<string>();
  for (const node of deepAll(character, 'skill')) {
    const name = txt(node, 'name');
    if (name.length === 0) continue;
    const id = slug(name);
    if (id.length === 0 || seen.has(id)) continue;
    const rating = Math.max(0, Math.round(num(node, 'base', 0) + num(node, 'karma', 0)));
    const attrRaw = txt(node, 'attribute').toLowerCase();
    const attr = SkillAttrSchema.safeParse(attrRaw);
    if (!attr.success) {
      report.notes.push(`skill '${name}': unknown linked attribute '${attrRaw}' — defaulted to LOG`);
    }
    const specNode = kid(node, 'specs') ?? kid(node, 'specializations');
    const spec = txt(kid(specNode, 'spec') ?? kid(specNode, 'specialization'), 'name')
      || txt(node, 'specialization');
    const group = txt(node, 'skillgroup');
    seen.add(id);
    out.push({
      id,
      rating,
      attr: attr.success ? attr.data : 'log',
      spec: spec.length > 0 ? spec : null,
      group: group.length > 0 ? group : null,
    });
  }
  report.counts['skills'] = out.length;
  return out;
}

function mapAugments(character: XmlNode, report: ChummerReport): SheetAugment[] {
  const out: SheetAugment[] = [];
  for (const kind of ['cyberware', 'bioware'] as const) {
    for (const node of deepAll(character, kind)) {
      const name = txt(node, 'name');
      if (name.length === 0) continue;
      const ref = refOf(node);
      const rating = num(node, 'rating', 0);
      out.push({
        name: rating > 0 ? `${name} (R${Math.trunc(rating)})` : name,
        essence: Math.max(0, num(node, 'ess', num(node, 'essence', 0))),
        mods: [],
        ...(ref ? { ref } : {}),
      });
    }
  }
  report.counts['augments'] = out.length;
  if (out.length > 0) {
    report.notes.push(
      "cyberware/bioware bonuses are not imported — Chummer's <improvements> are its own data; add them as Modifiers on the augment (Principle 2/5)",
    );
  }
  return out;
}

function weaponSkillId(category: string, known: ReadonlySet<string>, report: ChummerReport, name: string): string {
  const bySlug = slug(category);
  if (known.has(bySlug)) return bySlug;
  for (const [re, id] of CATEGORY_SKILL) {
    if (re.test(category)) {
      if (!known.has(id)) {
        report.notes.push(`weapon '${name}': assumed skill '${id}' from category '${category}' (no matching skill on the sheet)`);
      }
      return id;
    }
  }
  report.notes.push(`weapon '${name}': no skill match for category '${category}' — pool will default`);
  return bySlug.length > 0 ? bySlug : 'unarmed-combat';
}

function mapWeapons(character: XmlNode, skills: SheetSkill[], report: ChummerReport): SheetWeapon[] {
  const known = new Set(skills.map((s) => s.id));
  const out: SheetWeapon[] = [];
  for (const node of deepAll(character, 'weapon')) {
    const name = txt(node, 'name');
    if (name.length === 0) continue;
    const category = txt(node, 'category');
    const modes = txt(node, 'mode')
      .split(/[\/,]/)
      .map((m) => m.trim())
      .filter((m) => m.length > 0 && m !== '0');
    const ammoRaw = txt(node, 'ammo');
    const cap = /^\s*(\d+)/.exec(ammoRaw);
    const capacity = cap ? Number.parseInt(cap[1]!, 10) : 0;
    const remaining = kid(node, 'ammoremaining') ? Math.max(0, Math.trunc(num(node, 'ammoremaining', capacity))) : capacity;
    const rangeCat = slug(txt(node, 'range') || category);
    const acc = num(node, 'accuracy', 0);
    const ref = refOf(node);
    const dv = txt(node, 'damage');
    out.push({
      name,
      skillId: weaponSkillId(category, known, report, name),
      ...(acc > 0 ? { acc: Math.trunc(acc) } : {}),
      ...(dv.length > 0 ? { dv } : {}),
      ap: Math.trunc(num(node, 'ap', 0)),
      modes,
      ...(capacity > 0 && rangeCat.length > 0 ? { rangeCat } : {}),
      ...(capacity > 0 ? { ammo: { cap: capacity, current: Math.min(remaining, capacity) } } : {}),
      recoilComp: Math.trunc(num(node, 'rc', 0)),
      ...(ref ? { ref } : {}),
    });
  }
  report.counts['weapons'] = out.length;
  if (out.some((w) => w.rangeCat)) {
    report.notes.push(
      'range bands are not in the Chummer save — enter meters per category in the sheet\'s rangeTables (G6: user-entered numbers only)',
    );
  }
  return out;
}

function mapArmor(character: XmlNode, report: ChummerReport): SheetArmor[] {
  const out: SheetArmor[] = [];
  for (const node of deepAll(character, 'armor')) {
    const name = txt(node, 'name');
    if (name.length === 0) continue; // the <armor> rating child of an armor node
    const ref = refOf(node);
    out.push({
      name,
      rating: Math.trunc(num(node, 'armor', num(node, 'armorvalue', 0))),
      worn: flag(node, 'equipped', false),
      ...(ref ? { ref } : {}),
    });
  }
  report.counts['armor'] = out.length;
  return out;
}

function mapGear(character: XmlNode, report: ChummerReport): SheetGear[] {
  const out: SheetGear[] = [];
  for (const node of deepAll(character, 'gear')) {
    const name = txt(node, 'name');
    if (name.length === 0) continue;
    const rating = Math.trunc(num(node, 'rating', 0));
    const ref = refOf(node);
    out.push({
      name,
      qty: Math.max(1, Math.trunc(num(node, 'qty', num(node, 'quantity', 1)))),
      ...(rating > 0 ? { rating } : {}),
      ...(ref ? { ref } : {}),
    });
  }
  report.counts['gear'] = out.length;
  return out;
}

/**
 * Map a `.chum5` save into `SheetV1` plus an import report (FR3.1). Never
 * throws on bad XML — an unreadable file yields an near-empty sheet whose
 * report says so.
 */
export function importChummer(xml: string): ChummerImport {
  const doc = parseXml(xml);
  const character = deepFind(doc, 'character') ?? doc;
  const report: ChummerReport = { format: 'chummer5', counts: {}, unmapped: [], notes: [] };

  const alias = txt(character, 'alias') || txt(character, 'name') || 'Unnamed runner';
  const realName = txt(character, 'name');
  const noteParts = [txt(character, 'notes')];
  if (realName.length > 0 && realName !== alias) noteParts.unshift(`Legal name: ${realName}`);
  const notes = noteParts.filter((p) => p.length > 0).join('\n\n');

  const augments = mapAugments(character, report);
  const skills = mapSkills(character, report);
  const weapons = mapWeapons(character, skills, report);

  const draft: Record<string, unknown> = {
    v: 1,
    identity: {
      alias,
      metatype: (txt(character, 'metatype') || 'human').toLowerCase(),
      portraitId: null,
      ...(notes.length > 0 ? { notes } : {}),
    },
    skills,
    qualities: deepAll(character, 'quality')
      .filter((n) => txt(n, 'name').length > 0)
      .map((n) => {
        const ref = refOf(n);
        return { name: txt(n, 'name'), mods: [], ...(ref ? { ref } : {}) };
      }),
    augments,
    weapons,
    armor: mapArmor(character, report),
    spells: deepAll(character, 'spell')
      .filter((n) => txt(n, 'name').length > 0)
      .map((n) => {
        const ref = refOf(n);
        const category = txt(n, 'category');
        const drain = txt(n, 'dv') || txt(n, 'drain');
        return {
          name: txt(n, 'name'),
          ...(category.length > 0 ? { category } : {}),
          ...(drain.length > 0 ? { drain } : {}),
          ...(ref ? { ref } : {}),
        };
      }),
    powers: deepAll(character, 'power')
      .filter((n) => txt(n, 'name').length > 0)
      .map((n) => {
        const ref = refOf(n);
        const rating = Math.trunc(num(n, 'rating', 0));
        return {
          name: txt(n, 'name'),
          ...(rating > 0 ? { rating } : {}),
          cost: num(n, 'pointsperlevel', 0) * Math.max(1, rating),
          mods: [],
          ...(ref ? { ref } : {}),
        };
      }),
    complexForms: deepAll(character, 'complexform')
      .filter((n) => txt(n, 'name').length > 0)
      .map((n) => {
        const ref = refOf(n);
        const target = txt(n, 'target');
        const fading = txt(n, 'fv') || txt(n, 'fading');
        return {
          name: txt(n, 'name'),
          ...(target.length > 0 ? { target } : {}),
          ...(fading.length > 0 ? { fading } : {}),
          ...(ref ? { ref } : {}),
        };
      }),
    gear: mapGear(character, report),
    lifestyles: deepAll(character, 'lifestyle')
      .filter((n) => txt(n, 'name').length > 0 || txt(n, 'baselifestyle').length > 0)
      .map((n) => ({
        name: txt(n, 'name') || txt(n, 'baselifestyle'),
        costPerMonth: Math.max(0, num(n, 'cost', num(n, 'totalcost', 0))),
      })),
    matrix: {},
    rangeTables: {},
    overrides: [],
  };
  mapAttributes(character, draft, report);

  report.counts['qualities'] = (draft['qualities'] as unknown[]).length;
  report.counts['spells'] = (draft['spells'] as unknown[]).length;
  report.counts['powers'] = (draft['powers'] as unknown[]).length;
  report.counts['lifestyles'] = (draft['lifestyles'] as unknown[]).length;

  // Anything data-bearing we did not touch, for manual entry (FR3.1).
  const unmapped = new Set<string>();
  for (const child of character.children) {
    if (HANDLED.has(child.name) || IGNORED.has(child.name)) continue;
    if (child.children.length === 0 && child.text.trim().length === 0) continue;
    unmapped.add(child.name);
  }
  report.unmapped = [...unmapped].sort();

  const parsed = SheetV1Schema.safeParse(draft);
  if (!parsed.success) {
    report.notes.push(`sheet validation fell back to a minimal sheet: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
  }
  const sheet = parsed.success
    ? parsed.data
    : SheetV1Schema.parse({
        v: 1,
        identity: { alias },
        attributes: { bod: 1, agi: 1, rea: 1, str: 1, wil: 1, log: 1, int: 1, cha: 1, edg: { max: 1, current: 1 } },
      });

  return {
    sheet,
    report,
    karma: Math.trunc(num(character, 'karma', 0)),
    nuyen: Math.trunc(num(character, 'nuyen', 0)),
  };
}

// ---------------------------------------------------------------------------
// 3. Field-level diff (re-import shows changes before overwriting — FR3.1)
// ---------------------------------------------------------------------------

export interface SheetDiffEntry {
  /** Dotted path, arrays keyed by item name/id: `weapons[Kestrel A4].ammo.cap`. */
  path: string;
  op: 'added' | 'removed' | 'changed';
  from?: unknown;
  to?: unknown;
}

function flatten(value: unknown, path: string, out: Map<string, unknown>): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      const rec = item as { name?: unknown; id?: unknown } | null;
      const key =
        rec && typeof rec === 'object' && typeof rec.name === 'string'
          ? rec.name
          : rec && typeof rec === 'object' && typeof rec.id === 'string'
            ? rec.id
            : String(index);
      flatten(item, `${path}[${key}]`, out);
    });
    if (value.length === 0) out.set(path, '[]');
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      flatten(v, path.length > 0 ? `${path}.${k}` : k, out);
    }
    return;
  }
  out.set(path, value);
}

/**
 * Field-level diff between two sheets, sorted by path. Used by re-import
 * (`confirm=false` returns this first) and by revision comparison.
 */
export function diffSheets(before: SheetV1, after: SheetV1): SheetDiffEntry[] {
  const a = new Map<string, unknown>();
  const b = new Map<string, unknown>();
  flatten(before, '', a);
  flatten(after, '', b);
  const paths = [...new Set([...a.keys(), ...b.keys()])].sort();
  const out: SheetDiffEntry[] = [];
  for (const path of paths) {
    const has = { a: a.has(path), b: b.has(path) };
    const from = a.get(path);
    const to = b.get(path);
    if (has.a && !has.b) out.push({ path, op: 'removed', from });
    else if (!has.a && has.b) out.push({ path, op: 'added', to });
    else if (!Object.is(from, to)) out.push({ path, op: 'changed', from, to });
  }
  return out;
}
