/**
 * Encounter-builder roster model (FR10.4/10.6) — pure, no React, no I/O.
 *
 * A roster entry is one *part* of an encounter: a template + tier + seed,
 * either as N independent NPCs or one shared-statblock grunt group. The
 * generated sheet is cached on the entry so the THREAT READOUT recomputes
 * locally the instant a lever moves (squad size, PR, which parts are in),
 * with a round trip only when the generation itself must change (tier/seed).
 */
import type { SheetV1 } from '@safehouse/contracts';
import type { GeneratedGruntGroup, GeneratedNpc } from '@safehouse/rules';
import { profileFromSheet, type SideProfile } from './readout.js';

export type PartKind = 'npc' | 'gruntGroup';

/** Matches the server's `BuildPartInput` (apps/server/src/services/generator.ts). */
export interface BuildPart {
  kind: PartKind;
  templateId: string;
  tierId: string;
  /** npc parts: how many independent NPCs. */
  count?: number;
  /** gruntGroup parts: shared-statblock squad size. */
  size?: number;
  seed?: number;
  /**
   * GM override of the rolled Professional Rating (FR10.6 lever; drives morale,
   * FR10.9, not the readout math).
   *
   * The server applies it AFTER generation — to the grunt group row and to both
   * copies inside the combatant's `copilot` — so the sheet the seed reproduces
   * is untouched. Same seed, same body, different nerve.
   */
  professionalRating?: number;
}

/** One row of the builder: a part plus its cached preview. */
export interface RosterEntry {
  /** Client-side id; the encounter row gets a real one on save. */
  id: string;
  kind: PartKind;
  templateId: string;
  templateName: string;
  tierId: string;
  seed: number;
  /** npc: independent bodies. gruntGroup: squad size. Always ≥ 1. */
  count: number;
  /** Display name of the generated preview (falls back to the template name). */
  name: string;
  /** Cached statblock from the last generate call — undefined while pending. */
  sheet?: SheetV1;
  professionalRating?: number;
  /** True while a regeneration is in flight (tier/seed changed). */
  pending?: boolean;
  /** Validity-pass notes from the generator, surfaced beside the row. */
  corrections?: string[];
}

let counter = 0;

/** Monotonic client-side row id (stable within a page session). */
export function nextEntryId(prefix = 'part'): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

export function entryFromNpc(
  npc: GeneratedNpc,
  meta: { templateId: string; templateName: string; count?: number },
): RosterEntry {
  return {
    id: nextEntryId('npc'),
    kind: 'npc',
    templateId: meta.templateId,
    templateName: meta.templateName,
    tierId: npc.tierId,
    seed: npc.seed,
    count: Math.max(1, meta.count ?? 1),
    name: npc.name,
    sheet: npc.sheet,
    professionalRating: npc.professionalRating,
    corrections: npc.corrections,
  };
}

export function entryFromGroup(
  group: GeneratedGruntGroup,
  meta: { templateId: string; templateName: string },
): RosterEntry {
  return {
    id: nextEntryId('grunts'),
    kind: 'gruntGroup',
    templateId: meta.templateId,
    templateName: meta.templateName,
    tierId: group.tierId,
    seed: group.seed,
    count: Math.max(1, group.members.length),
    name: `${meta.templateName} ×${Math.max(1, group.members.length)}`,
    sheet: group.statblock,
    professionalRating: group.professionalRating,
  };
}

/** Encounter payload parts (FR10.4) — what the server rebuilds from. */
export function toParts(entries: readonly RosterEntry[]): BuildPart[] {
  return entries.map((e) => ({
    kind: e.kind,
    templateId: e.templateId,
    tierId: e.tierId,
    seed: e.seed,
    ...(e.kind === 'gruntGroup' ? { size: e.count } : { count: e.count }),
    ...(e.professionalRating !== undefined ? { professionalRating: e.professionalRating } : {}),
  }));
}

/**
 * Readout profiles for the opposition side. An `npc` part with count > 1
 * reuses one rolled statblock × count bodies — an estimate, labeled as one
 * (the saved encounter rolls each NPC independently).
 */
export function oppositionProfiles(entries: readonly RosterEntry[]): SideProfile[] {
  const out: SideProfile[] = [];
  for (const entry of entries) {
    if (!entry.sheet) continue;
    out.push(profileFromSheet(entry.name, 'opposition', entry.sheet, { bodies: entry.count }));
  }
  return out;
}

/** Party profiles from the live PC sheets (FR10.5 — the real party, not a proxy). */
export function partyProfiles(
  party: readonly { id: string; name: string; sheet: SheetV1 }[],
): SideProfile[] {
  return party.map((pc) => profileFromSheet(pc.name, 'party', pc.sheet, { bodies: 1 }));
}

/** True when a lever change needs a fresh roll rather than just re-math. */
export function needsRegen(
  before: Pick<RosterEntry, 'tierId' | 'seed' | 'kind' | 'count'>,
  after: Pick<RosterEntry, 'tierId' | 'seed' | 'kind' | 'count'>,
): boolean {
  if (before.tierId !== after.tierId) return true;
  if (before.seed !== after.seed) return true;
  // Grunt groups share one statblock but the roll walks `size` members.
  return after.kind === 'gruntGroup' && before.count !== after.count;
}

/** Replace one entry immutably (levers edit in place). */
export function patchEntry(
  entries: readonly RosterEntry[],
  id: string,
  patch: Partial<RosterEntry>,
): RosterEntry[] {
  return entries.map((e) => (e.id === id ? { ...e, ...patch } : e));
}

export function removeEntry(entries: readonly RosterEntry[], id: string): RosterEntry[] {
  return entries.filter((e) => e.id !== id);
}

/** Total opposition bodies across the roster — the squad-size lever's headline. */
export function totalBodies(entries: readonly RosterEntry[]): number {
  return entries.reduce((sum, e) => sum + Math.max(1, e.count), 0);
}
