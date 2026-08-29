/**
 * Pure state for the roll dialog — the pool arithmetic and the request that
 * goes on the wire. No React, no I/O, so the numbers are testable directly.
 *
 * ## LIVE-2: one authority for the scene environment
 *
 * Observed at the table: a sheet showing Perception 5 opened a dialog offering
 * "Roll 4d6", and the persisted receipt carried
 * `environment: light 1 → light (-1) -1` **twice**.
 *
 * The cause was two authorities for one modifier. `GET /api/characters/:id/derived`
 * already derives every pool with the active scene's environment folded in
 * (`services/characters.ts deriveView` → `activeSceneModifiers`), and the
 * dialog then added the same scene as a removable situational chip on top.
 *
 * The rule here is now: **the server owns the scene, the client never re-sends
 * it.** Scene lines that arrive inside `baseBreakdown` are surfaced as
 * read-only context ("already in this pool") so the player can still see why
 * their dice are down, and `sceneChips` is gone. What the client may still
 * contribute is what only the client knows — the specialization it offered,
 * the recoil it counted, the range to a target the player typed in, an ad-hoc
 * situational bump.
 *
 * ## Sheet rolls take the authoritative path
 *
 * `services/rolls.ts resolvePool` recomputes a sheet-backed roll from the live
 * state when it is given `meta.poolRef`; without it the roll falls through to
 * the repair path that merely de-duplicates the client's receipt. The dialog
 * therefore sends `poolRef` AND ships its own chips as `meta.mods` Modifiers,
 * so the server's recompute keeps the recoil/range/spec the client priced in.
 */
import type {
  LimitRef,
  Modifier,
  PoolBreakdown,
  ProvenanceEntry,
  RollKind,
  SheetSkill,
  Visibility,
} from '@safehouse/contracts';
import type { PendingRollMod } from '../../live/rollHandoff.js';
import { chipEntries, chipSum, clampPool, type RollChip } from './lib.js';

export interface RollConfig {
  title: string;
  /** One-line context under the title (drain DV, threshold, linked roll…). */
  note?: string;
  kind?: RollKind;
  baseTotal: number;
  baseBreakdown: ProvenanceEntry[];
  limit?: LimitRef;
  /**
   * Pre-baked situational chips (recoil, range, specialization…). A chip with
   * `active: false` renders as an offer — one tap arms it for this roll.
   * Scene environment is NOT a chip: see LIVE-2 above.
   */
  extraChips?: RollChip[];
  meta?: Record<string, unknown>;
  defaultVisibility?: Visibility;
}

/** The chip id a handed-over range measurement lands under. */
export const RANGE_CHIP_ID = 'range.measured';

/**
 * Fold the Grid ruler's measurement into a roll about to open (FR9.9).
 *
 * The ruler prices a range band ("medium range (9.5 m, heavy_pistol) −1") and
 * publishes it through `live/rollHandoff`; without this the number died on the
 * map and the player re-typed it as an ad-hoc situational, losing the
 * provenance that made the receipt readable.
 *
 * It arrives ARMED, because tapping "apply" on the ruler is already the
 * decision — but it is still a chip, so one tap drops it, and it carries
 * `source: 'range'` so `chipModifiers` sends it to the server as a range
 * Modifier rather than an anonymous bump.
 *
 * A config that already offers its own range chip wins: a weapon roll built
 * from a live target distance knows more than a measurement someone left
 * lying around.
 */
export function withPendingRangeChip(
  config: RollConfig,
  pending: PendingRollMod | null | undefined,
): RollConfig {
  if (!pending || pending.value === 0) return config;
  const existing = config.extraChips ?? [];
  if (existing.some((c) => c.source === 'range')) return config;
  return {
    ...config,
    extraChips: [
      ...existing,
      {
        id: RANGE_CHIP_ID,
        label: pending.label,
        value: pending.value,
        active: true,
        source: 'range',
      },
    ],
  };
}

export type EdgeChoice = 'none' | 'push_pre' | 'second_chance';

/** +2 for a specialization — offered as an off-by-default chip (SR5 p.130). */
export const SPEC_BONUS = 2;

/**
 * The config a skill row opens the dialog with. Extracted from the row so the
 * whole path — row → config → pool → wire request — is one testable chain,
 * which is how the keyboard-only roll flow is exercised without a DOM.
 *
 * `pool` is the DERIVED pool: the server already folded the scene, the wounds
 * and any sustained spells into it. Nothing here re-applies them.
 */
export function skillRollConfig(skill: SheetSkill, pool: PoolBreakdown): RollConfig {
  const ref = `skill.${skill.id}`;
  return {
    title: skill.id,
    baseTotal: pool.total,
    baseBreakdown: pool.breakdown,
    ...(pool.limit ? { limit: pool.limit } : {}),
    ...(skill.spec
      ? {
          extraChips: [
            {
              id: `spec.${skill.id}`,
              label: `spec: ${skill.spec}`,
              value: SPEC_BONUS,
              active: false,
              source: 'situational',
            },
          ],
        }
      : {}),
    // `poolRef` is what puts this roll on §10.1's authoritative path: the
    // server recomputes from the live sheet rather than trusting our number.
    // `poolKey` rides along for anything still reading the older name.
    meta: { poolRef: ref, poolKey: ref },
  };
}

/**
 * The pool key this roll came from (`skill.perception`, `weapon.Ares Light`,
 * `spell.Stunbolt`, `defense`, `soak`) — the server's `meta.poolRef`.
 * Historically the sheet sent it as `poolKey`, which the roll service does not
 * read, so every sheet roll quietly skipped the §10.1 recompute. Both spellings
 * are accepted on the way in; only `poolRef` goes out (plus `poolKey`, kept so
 * anything already reading the old name in the log keeps working).
 */
export function poolRefOf(meta: Record<string, unknown> | undefined): string | null {
  if (!meta) return null;
  const ref = meta['poolRef'] ?? meta['poolKey'];
  return typeof ref === 'string' && ref.length > 0 ? ref : null;
}

/** The modifier target a client chip must carry to hit this pool server-side. */
export function chipTarget(poolRef: string | null): string {
  return poolRef ? `pool.${poolRef}` : 'pool.all';
}

/**
 * Scene lines already inside the derived pool. Rendered as context, never
 * summed again (LIVE-2). The engine tags every scene contribution
 * `source: 'scene'` (`derive-pipeline.ts`), which is what makes this reliable
 * whether the breakdown came from the server or the local fallback derive.
 */
export function appliedSceneEntries(
  breakdown: readonly ProvenanceEntry[],
): ProvenanceEntry[] {
  return breakdown.filter((e) => e.source === 'scene');
}

/** The rest of the receipt — the compact line under the pool. */
export function nonSceneEntries(breakdown: readonly ProvenanceEntry[]): ProvenanceEntry[] {
  return breakdown.filter((e) => e.source !== 'scene');
}

/**
 * The chips the dialog offers. `flipped` holds the ids the user tapped away
 * from their default state, so an offered chip (spec +2) arms and an applied
 * one (recoil −3) drops.
 */
export function activeChips(
  config: RollConfig | null,
  flipped: Readonly<Record<string, boolean>>,
): RollChip[] {
  return (config?.extraChips ?? []).map((chip) => ({
    ...chip,
    active: chip.active !== Boolean(flipped[chip.id]),
  }));
}

/**
 * Dice for this roll. Because the scene is no longer added twice, this equals
 * the pool the sheet shows whenever no chip is armed — the LIVE-2 acceptance
 * test.
 */
export function rollPool(
  baseTotal: number,
  chips: readonly RollChip[],
  situational: number,
): number {
  return clampPool(baseTotal + chipSum(chips) + situational);
}

export const MANUAL_SITUATIONAL_ID = 'situational.manual';

/**
 * Client-only contributions as Modifiers for `meta.mods`. The server folds
 * these into its own recompute and drops anything it owns itself (`scene`,
 * `wound`, `spell` kinds are refused in `situationalFor`), so a chip can never
 * smuggle a second scene penalty back in.
 */
export function chipModifiers(
  chips: readonly RollChip[],
  situational: number,
  poolRef: string | null,
): Modifier[] {
  const target = chipTarget(poolRef);
  const mods: Modifier[] = [];
  for (const chip of chips) {
    if (!chip.active || chip.value === 0) continue;
    if (chip.source === 'scene' || chip.source === 'wound' || chip.source === 'spell') continue;
    mods.push({
      id: chip.id,
      source: { kind: chip.source === 'range' ? 'range' : 'situational' },
      target,
      op: 'add',
      value: chip.value,
      active: true,
      note: chip.label,
    });
  }
  if (situational !== 0) {
    mods.push({
      id: MANUAL_SITUATIONAL_ID,
      source: { kind: 'situational' },
      target,
      op: 'add',
      value: situational,
      active: true,
      note: 'situational',
    });
  }
  return mods;
}

/**
 * The roll's receipt. `baseBreakdown` already carries the scene (and wounds,
 * and sustaining) because the server derived it that way; only the client's
 * own chips are appended.
 */
export function rollBreakdown(
  config: RollConfig,
  chips: readonly RollChip[],
  situational: number,
): ProvenanceEntry[] {
  return [
    ...config.baseBreakdown,
    ...chipEntries(chips),
    ...(situational !== 0
      ? [{ label: 'situational', value: situational, source: 'situational' }]
      : []),
  ];
}

export interface BuildRequestOpts {
  config: RollConfig;
  chips: readonly RollChip[];
  situational: number;
  edge: EdgeChoice;
  visibility: Visibility;
  characterId: string;
  /** Current Edge — a hint the server records but recomputes for itself. */
  edgeCurrent: number;
}

export interface RollRequestWire {
  kind: RollKind;
  pool: number;
  breakdown: ProvenanceEntry[];
  limit?: LimitRef;
  edge: Exclude<EdgeChoice, 'none'> | null;
  visibility: Visibility;
  actor: { characterId: string };
  meta: Record<string, unknown>;
}

/** Everything the WS command (and its REST twin) needs, in one pure fold. */
export function buildRollRequest(opts: BuildRequestOpts): RollRequestWire {
  const { config, chips, situational } = opts;
  const poolRef = poolRefOf(config.meta);
  const mods = chipModifiers(chips, situational, poolRef);
  return {
    kind: config.kind ?? 'simple',
    pool: rollPool(config.baseTotal, chips, situational),
    breakdown: rollBreakdown(config, chips, situational),
    ...(config.limit ? { limit: config.limit } : {}),
    edge: opts.edge === 'none' ? null : opts.edge,
    visibility: opts.visibility,
    actor: { characterId: opts.characterId },
    meta: {
      ...config.meta,
      title: config.title,
      // §10.1: with a poolRef the server recomputes from the live sheet and
      // the client's number becomes `meta.claimedPool` if it disagreed.
      ...(poolRef ? { poolRef } : {}),
      ...(mods.length > 0 ? { mods } : {}),
      // A hint only: the server recomputes the Edge dice from the stored sheet.
      ...(opts.edge === 'push_pre' ? { edgeDice: opts.edgeCurrent } : {}),
    },
  };
}
