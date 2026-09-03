/**
 * Cover, as a modifier with provenance.
 *
 * ## Read this before trusting the numbers
 *
 * Nothing in DESIGN.md or the rest of the engine specified cover values, so
 * these constants are the FIRST place the app takes a position on the rule.
 * The table plays RAW, which means the values below must match the book rather
 * than match a guess — they are isolated here, named, and used nowhere else so
 * that correcting them is a one-line change with no archaeology.
 *
 * The mechanic is modelled the way SR5 frames it: cover helps the person being
 * shot at. It is a bonus to the DEFENDER's dice pool, not a penalty on the
 * attacker's, and those are not interchangeable in an opposed-roll system —
 * they change who benefits from Edge, who can glitch, and what the limit does.
 *
 * Full cover emits nothing at all. Something that stops the sightline is not a
 * harder shot, it is no shot: `lineOfSight` already returned `clear: false` and
 * the attack should be refused rather than quietly penalised.
 */
import type { Modifier } from '@safehouse/contracts';
import type { CoverLevel } from './los.js';

/**
 * Defender dice-pool bonus per cover level. THE numbers to check against the
 * book — see the header.
 */
export const COVER_DEFENCE_BONUS: Readonly<Record<CoverLevel, number>> = {
  none: 0,
  partial: 2,
  full: 0, // no shot exists; see the header
};

/** The defence-pool target cover applies to. */
export const COVER_TARGET = 'pool.defense';

export interface CoverModifierOptions {
  /** What is providing it — a cell key or wall id, straight from `LosResult`. */
  because?: string | null | undefined;
}

/**
 * The defender's cover bonus, or null when there is nothing to say.
 *
 * `null` rather than a zero-valued modifier: an unobstructed shot should not
 * put a line in the provenance breakdown claiming cover was considered and
 * found to be nothing. Range does emit its zero (`rangeModifier`) because the
 * BAND is information — "short range" is a fact about the shot. "No cover" is
 * the absence of a fact.
 */
export function coverModifier(
  cover: CoverLevel,
  opts: CoverModifierOptions = {},
): Modifier | null {
  const value = COVER_DEFENCE_BONUS[cover] ?? 0;
  if (value === 0) return null;

  const because = opts.because;
  return {
    id: `cover.${cover}`,
    source: { kind: 'situational', ref: 'cover' },
    target: COVER_TARGET,
    op: 'add',
    value,
    active: true,
    note: because
      ? `${cover} cover (+${value} to defend) — behind ${because}`
      : `${cover} cover (+${value} to defend)`,
  };
}

// ---------------------------------------------------------------------------
// Suggested, then decided
// ---------------------------------------------------------------------------

/**
 * A cover ruling: what the map says, what the GM said, and which one counts.
 *
 * The map is good at geometry and bad at everything else. It knows a counter
 * is between the shooter and the target; it does not know the target is prone,
 * that the counter is glass, that the ganger is firing through his own mate, or
 * that the GM has already narrated the crate being blown apart. Those calls
 * belong to the person running the game.
 *
 * So the system SUGGESTS and the GM DECIDES, and the difference is recorded
 * rather than hidden. That is the same shape as every other derived value in
 * the engine (FR3.5): an override is honoured, flagged, and explained, so the
 * roll's breakdown never presents a GM's judgement as arithmetic — or
 * arithmetic as a GM's judgement.
 */
export interface CoverCall {
  /** What the sightline found. */
  suggested: CoverLevel;
  /** What the GM set, when they set anything. */
  override?: CoverLevel | undefined;
  /** The one that applies. */
  effective: CoverLevel;
  /** True when the GM's answer differs from the map's. */
  overridden: boolean;
  /** One line for the roll log and the panel. */
  why: string;
}

const COVER_WORD: Readonly<Record<CoverLevel, string>> = {
  none: 'no cover',
  partial: 'partial cover',
  full: 'full cover — no shot',
};

/**
 * Resolve a ruling. `override` of `undefined` means the GM has not spoken and
 * the map's answer stands; an override EQUAL to the suggestion is still not an
 * override, so agreeing with the map does not clutter the breakdown.
 */
export function coverCall(suggested: CoverLevel, override?: CoverLevel | undefined): CoverCall {
  const effective = override ?? suggested;
  const overridden = override !== undefined && override !== suggested;
  return {
    suggested,
    override,
    effective,
    overridden,
    why: overridden
      ? `${COVER_WORD[effective]} — GM's call (the map showed ${COVER_WORD[suggested]})`
      : COVER_WORD[effective],
  };
}

/**
 * The modifier for a ruling, with the override visible in its provenance.
 *
 * `source.kind` stays `situational` either way — it is still a modifier on this
 * shot — but an overridden call says so in the note, because a player looking
 * at why they missed deserves to know whether that +2 came from the floor plan
 * or from the GM.
 */
export function coverCallModifier(
  call: CoverCall,
  opts: CoverModifierOptions = {},
): Modifier | null {
  const base = coverModifier(call.effective, opts);
  if (base === null) return null;
  if (!call.overridden) return base;
  return {
    ...base,
    id: `${base.id}.gm`,
    source: { kind: 'override', ref: 'cover' },
    note: `${base.note ?? ''} — GM's call, map showed ${COVER_WORD[call.suggested]}`.trim(),
  };
}
