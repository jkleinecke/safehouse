/**
 * Copilot config parsing (FR10.7). A generator-backed combatant carries
 * `copilot: Record<string, unknown>` on its row; this reads it tolerantly and
 * falls back to attribute math.
 *
 * The rack itself is NOT computed from this any more — `CopilotRack` asks the
 * server for pools that already fold in wounds and scene modifiers. What
 * remains here is `hasCopilotRack` (does this row have a rack at all) and the
 * seed values for the resolve-chain dialog's editable fields, where a rough
 * starting number the GM can correct is exactly what is wanted.
 */
import type { Combatant } from '@safehouse/contracts';
import { computeWoundModifier } from '@safehouse/rules';

export interface CopilotWeapon {
  name: string;
  acc?: number;
  dv?: string;
  ap?: number;
  pool?: number;
}

export interface CopilotView {
  pools: Partial<Record<'attack' | 'defense' | 'soak' | 'composure', number>>;
  attributes: { bod?: number; rea?: number; int?: number; str?: number; wil?: number };
  armor?: number;
  weapons: CopilotWeapon[];
}

const rec = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;
const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.length > 0 ? v : undefined;

/** Parse a combatant's copilot config; null when the row carries none. */
export function parseCopilot(combatant: Combatant): CopilotView | null {
  const raw = rec(combatant.copilot);
  if (Object.keys(raw).length === 0) return null;

  const poolsRaw = rec(raw['pools']);
  const attrsRaw = rec(raw['attributes'] ?? raw['attrs']);
  const attributes = {
    bod: num(attrsRaw['bod']),
    rea: num(attrsRaw['rea']),
    int: num(attrsRaw['int']),
    str: num(attrsRaw['str']),
    wil: num(attrsRaw['wil']),
  };
  const armor = num(raw['armor']);

  const weapons: CopilotWeapon[] = (Array.isArray(raw['weapons']) ? (raw['weapons'] as unknown[]) : [])
    .map(rec)
    .flatMap((w) => {
      const name = str(w['name']);
      if (!name) return [];
      return [{ name, acc: num(w['acc']), dv: str(w['dv']), ap: num(w['ap']), pool: num(w['pool']) }];
    });

  const defense =
    num(poolsRaw['defense']) ??
    num(raw['defense']) ??
    (attributes.rea !== undefined && attributes.int !== undefined
      ? attributes.rea + attributes.int
      : undefined);
  const soak =
    num(poolsRaw['soak']) ??
    num(raw['soak']) ??
    (attributes.bod !== undefined ? attributes.bod + (armor ?? 0) : undefined);

  return {
    pools: {
      attack: num(poolsRaw['attack']) ?? num(raw['attack']) ?? weapons[0]?.pool,
      defense,
      soak,
      composure: num(poolsRaw['composure']) ?? num(raw['composure']),
    },
    attributes,
    armor,
    weapons,
  };
}

/** Rows that get the rack: any non-PC source with copilot data (FR10.7). */
export function hasCopilotRack(combatant: Combatant): boolean {
  return combatant.source !== 'character' && parseCopilot(combatant) !== null;
}

/** Current wound modifier for a rack roll's breakdown (FR10.7: automatic). */
export function copilotWoundModifier(combatant: Combatant): number {
  return computeWoundModifier(combatant.monitors);
}
