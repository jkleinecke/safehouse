/**
 * Bonded foci as real modifier sources (FR8.4).
 *
 * The modifier pipeline already accepts them — a focus is just another thing
 * that changes a number (§7.2) — so the only work here is turning the
 * bookkeeping the table keeps on paper (what is bonded, what is switched on
 * right now, at what Force) into `Modifier[]` the engine can consume.
 *
 * Two gates, both real: a focus that is not **bonded** contributes nothing at
 * all, and a bonded focus that is not **active** contributes nothing this
 * instant. That is the whole toggle, and it is why the derived pool moves the
 * moment the mage flips it.
 *
 * No book data (§14): the focus's name, kind and what it feeds are the user's
 * own entry. When they gave no explicit modifiers we apply the generic
 * mechanic — a focus adds its Force to the tests it is for.
 */
import type { Modifier, Ref } from '@safehouse/contracts';

/** Foci read as magic, so they land in the pipeline's magic phase. */
export type FocusSourceKind = 'power' | 'spell';

export interface BondedFocus {
  id: string;
  name: string;
  /** GM's own label ("power focus", "the ring") — never book text. */
  kind?: string;
  /** Focus Force/rating; the dice a bare focus contributes. */
  force: number;
  /** Unbonded foci are inert, however switched-on they look. */
  bonded: boolean;
  /** The toggle the mage flips at the table. */
  active: boolean;
  sourceKind?: FocusSourceKind;
  /** Pipeline targets fed when no explicit `mods` are given. */
  targets?: readonly string[];
  /** Explicit modifiers; when present these win over `targets`. */
  mods?: readonly Modifier[];
  ref?: Ref;
  note?: string;
}

/** A focus contributes only when it is both bonded and switched on. */
export function focusIsLive(focus: Pick<BondedFocus, 'bonded' | 'active'>): boolean {
  return focus.bonded === true && focus.active === true;
}

function focusLabel(focus: BondedFocus): string {
  const kind = focus.kind?.trim();
  const force = Math.max(0, Math.trunc(focus.force));
  return `${focus.name}${kind ? ` (${kind})` : ''} — Force ${force}`;
}

/**
 * The line this focus writes on a pool's receipt (Principle 3).
 *
 * A GM's own `note` is kept — it is usually why the focus is interesting — but
 * it never *replaces* the name, because a receipt reading "a band of scorched
 * brass · +2" does not tell the table which toggle to flip to make it stop. The
 * name leads; the flavour follows.
 */
function focusReceipt(focus: BondedFocus): string {
  const note = focus.note?.trim();
  return note ? `${focus.name} — ${note}` : focusLabel(focus);
}

/**
 * The modifiers one focus contributes right now. Returns `[]` for anything
 * unbonded or switched off, so a caller can hand the whole rack in without
 * filtering first.
 */
export function modifiersForFocus(focus: BondedFocus): Modifier[] {
  if (!focusIsLive(focus)) return [];
  const kind: FocusSourceKind = focus.sourceKind ?? 'power';
  const label = focusReceipt(focus);
  const explicit = focus.mods ?? [];
  if (explicit.length > 0) {
    return explicit.map((m, i) => ({
      ...m,
      id: `focus.${focus.id}.${m.id || i}`,
      source: { kind, ref: focus.name },
      active: true,
      note: m.note ?? label,
    }));
  }
  const force = Math.max(0, Math.trunc(focus.force));
  return (focus.targets ?? []).map((target, i) => ({
    id: `focus.${focus.id}.${i}`,
    source: { kind, ref: focus.name },
    target,
    op: 'add' as const,
    value: force,
    active: true,
    note: label,
  }));
}

/** Every live focus in a rack, flattened into pipeline modifiers. */
export function focusModifiers(foci: readonly BondedFocus[]): Modifier[] {
  return foci.flatMap((f) => modifiersForFocus(f));
}

/** What the sheet header shows: how many are bonded, how many are burning now. */
export function focusSummary(foci: readonly BondedFocus[]): {
  bonded: number;
  active: number;
  contributing: number;
} {
  const bonded = foci.filter((f) => f.bonded).length;
  const active = foci.filter((f) => f.active).length;
  const contributing = foci.filter((f) => focusIsLive(f) && modifiersForFocus(f).length > 0).length;
  return { bonded, active, contributing };
}
