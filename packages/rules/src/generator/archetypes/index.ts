/**
 * The starter archetype library (FR10.1) — sixteen archetypes so a brand new
 * campaign opens the generator on a full dropdown instead of an empty one.
 *
 * §14 says the app ships no *book* content. It does not say the app ships
 * nothing: these archetypes, their gear, their spells and their tier labels are
 * all our own writing, exactly like the flavour tables in `tables.ts`. They are
 * *ranges*, not stat blocks — the engine rolls every number (D10/D13), so the
 * GM gets a different body each time and can retune any curve in the archetype
 * editor without leaving the app.
 *
 * INTEGRATION (seeding, owned elsewhere): a campaign bootstrap inserts one
 * `npc_templates` row per entry — `name`, `statblock` (these gear records, which
 * is what `catalogOf` resolves loadout options against), `gen`, `persona` — and
 * leaves `pageRef` null. Rows are per-campaign copies, so a GM editing or
 * deleting a starter archetype only touches their own campaign. `id` here is a
 * stable seeding key, not a database id; carry it in the row's own metadata if
 * the seeder needs to recognise a starter archetype later.
 */
import type { SheetV1Input } from '@safehouse/contracts';
import type { LoadoutCatalog } from '../generate.js';
import { BAR_STAFF, DOOR_HEAVY, GANG_LIEUTENANT, STREET_GANGER, WIRED_ENFORCER } from './street.js';
import { CLOSE_PROTECTION, CORP_GUARD, LEGWORK_INVESTIGATOR, PATROL_OFFICER } from './corporate.js';
import { BROKER, CONTRACT_SHOOTER, STREET_DOC } from './specialists.js';
import { COMBAT_ADEPT, COMBAT_MAGE } from './awakened.js';
import { DRONE_RIGGER, GRID_DECKER } from './technical.js';
import type { StarterArchetype } from './types.js';

export {
  STARTER_TIER_IDS,
  type StarterArchetype,
  type StarterTierId,
  type TierSpec,
} from './types.js';
export { STARTER_ARMOR, STARTER_GEAR, STARTER_RANGE_TABLES, STARTER_WEAPONS } from './gear.js';

/**
 * Ordered the way a GM scans a list: the bodies they need most often first,
 * then the specialists, then the two who never stand in the firing lane.
 */
export const STARTER_ARCHETYPES: readonly StarterArchetype[] = [
  STREET_GANGER,
  GANG_LIEUTENANT,
  DOOR_HEAVY,
  WIRED_ENFORCER,
  CORP_GUARD,
  CLOSE_PROTECTION,
  PATROL_OFFICER,
  LEGWORK_INVESTIGATOR,
  CONTRACT_SHOOTER,
  STREET_DOC,
  BROKER,
  COMBAT_MAGE,
  COMBAT_ADEPT,
  DRONE_RIGGER,
  GRID_DECKER,
  BAR_STAFF,
];

export function starterArchetype(id: string): StarterArchetype | undefined {
  return STARTER_ARCHETYPES.find((a) => a.id === id);
}

/**
 * The loadout catalog for one archetype, keyed by record name — the same
 * resolution the server performs on a GM's own template statblock, available
 * here so the pure engine (and its tests) can generate without a database.
 */
export function starterCatalog(a: StarterArchetype): LoadoutCatalog {
  const sb: Partial<SheetV1Input> = a.statblock;
  const catalog: Required<Pick<LoadoutCatalog, 'weapons' | 'armor' | 'gear'>> = {
    weapons: {},
    armor: {},
    gear: {},
  };
  for (const w of sb.weapons ?? []) catalog.weapons[w.name] = w;
  for (const r of sb.armor ?? []) catalog.armor[r.name] = r;
  for (const g of sb.gear ?? []) catalog.gear[g.name] = g;
  return catalog;
}
