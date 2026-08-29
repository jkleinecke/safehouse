/**
 * Who is holding the spell up (FR8.2 × FR8.3).
 *
 * Sustaining costs the caster −2 dice on everything, *unless something else is
 * doing the holding*. The sheet already knows about the focus/quickening case
 * as an `exempt` toggle; a spirit ordered to sustain is the third way, and it
 * has to read identically — same toggle, same receipt line, so a pool never
 * gets two different answers depending on who asked.
 *
 * Pure: the caller owns the writing back. This half says which entries a live
 * spirit is carrying and what the remaining penalty is.
 */

/** −2 dice for each spell the caster is holding up themselves (§10.2). */
export const SUSTAINING_PENALTY_PER_SPELL = -2;

export interface SustainedEntry {
  id: string;
  name: string;
  /** Held by a focus, a quickening, or a spirit — the caster pays nothing. */
  exempt: boolean;
}

export interface SustainingSpirit {
  id: string;
  name?: string;
  /** The sustained-entry id this spirit is holding, if any. */
  sustainingSpellId?: string | null;
  /** A dismissed spirit holds nothing, whatever the field still says. */
  active?: boolean;
}

function carries(spirit: SustainingSpirit): boolean {
  return spirit.active !== false && typeof spirit.sustainingSpellId === 'string' && spirit.sustainingSpellId.length > 0;
}

/** The sustained-entry ids currently carried by a live spirit. */
export function spiritSustainedSpellIds(spirits: readonly SustainingSpirit[]): string[] {
  const seen = new Set<string>();
  for (const s of spirits) {
    if (carries(s)) seen.add(s.sustainingSpellId as string);
  }
  return [...seen];
}

/**
 * Stamp the exemption a spirit provides onto the caster's sustained list.
 * Entries already exempt (focus, quickening) stay exempt — this only ever
 * removes a penalty, never adds one.
 */
export function applySpiritSustaining(
  sustained: readonly SustainedEntry[],
  spirits: readonly SustainingSpirit[],
): SustainedEntry[] {
  const carried = new Set(spiritSustainedSpellIds(spirits));
  return sustained.map((s) => (carried.has(s.id) && !s.exempt ? { ...s, exempt: true } : { ...s }));
}

/** Total dice penalty the caster is eating right now (0 or negative, never −0). */
export function sustainingPenalty(sustained: readonly SustainedEntry[]): number {
  const held = sustained.filter((s) => !s.exempt).length;
  return held === 0 ? 0 : held * SUSTAINING_PENALTY_PER_SPELL;
}

export type ExemptionSource = 'spirit' | 'focus_or_quickening' | null;

export interface SustainingLine {
  id: string;
  name: string;
  exempt: boolean;
  /** Why it is free — a spirit by name, or the sheet's own toggle. */
  exemptBy: ExemptionSource;
  spiritId: string | null;
  spiritName: string | null;
  /** This entry's contribution to the caster's pools. */
  penalty: number;
}

export interface SustainingReport {
  lines: SustainingLine[];
  /** Sum of the lines — what `pool.all` is actually docked. */
  penalty: number;
  /** How many the caster is holding up personally. */
  selfSustained: number;
}

/** The full "who is holding what" picture, ready to render or to hand the Fixer. */
export function sustainingReport(
  sustained: readonly SustainedEntry[],
  spirits: readonly SustainingSpirit[] = [],
): SustainingReport {
  const byId = new Map<string, SustainingSpirit>();
  for (const s of spirits) {
    if (carries(s) && !byId.has(s.sustainingSpellId as string)) {
      byId.set(s.sustainingSpellId as string, s);
    }
  }
  const lines: SustainingLine[] = sustained.map((entry) => {
    const spirit = byId.get(entry.id);
    const exempt = entry.exempt || spirit !== undefined;
    const exemptBy: ExemptionSource = spirit ? 'spirit' : exempt ? 'focus_or_quickening' : null;
    return {
      id: entry.id,
      name: entry.name,
      exempt,
      exemptBy,
      spiritId: spirit?.id ?? null,
      spiritName: spirit?.name ?? null,
      penalty: exempt ? 0 : SUSTAINING_PENALTY_PER_SPELL,
    };
  });
  return {
    lines,
    penalty: lines.reduce((sum, l) => sum + l.penalty, 0),
    selfSustained: lines.filter((l) => !l.exempt).length,
  };
}
