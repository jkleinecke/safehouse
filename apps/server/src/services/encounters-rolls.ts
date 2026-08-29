/**
 * The copilot's half of the roll record (G5 / FR2.1 / FR6.1).
 *
 * Two jobs, kept away from `services/encounters.ts` so the tracker file stays
 * about combat:
 *   1. `chainRollInputs` — PURE: one resolved FR10.8 chain → the roll rows it
 *      earned. `POST /api/encounters/:id/resolve-chain` throws three real pools
 *      server-side (attack, defence, soak) and used to persist NONE of them.
 *   2. `recordCopilotRoll` / `recordChainRolls` — the writes: a `rolls` row
 *      stamped with the campaign's LIVE session id, plus the `roll.created`
 *      broadcast.
 *
 * Chain rows are `gm` visibility: players see the cards the GM chooses to show,
 * never the behind-the-screen dice (Principle 4 / FR2.7). Damage is a separate
 * question — nothing is APPLIED until `…/resolve-chain/commit` (Principle 2).
 */
import { randomUUID } from 'node:crypto';
import {
  RollRequestSchema,
  type LimitRef,
  type RollResult,
  type Visibility,
} from '@safehouse/contracts';
import { rolls, type Db } from '@safehouse/db';
import type { Hub } from '../hub.js';
import type { ChainOutcome } from './encounters-copilot.js';
import { toRecord } from './roll-log.js';
import { activeSessionId } from './rolls.js';

/** The two sides of the exchange, as the log needs to name them. */
export interface ChainRollTarget {
  id: string;
  name: string;
}

/** One persistable roll produced by a chain step. */
export interface ChainRollInput {
  step: 'attack' | 'defense' | 'soak';
  /** Copilot kind stamped onto `request.copilot` (matches the rack's kinds). */
  kind: 'attack' | 'defense' | 'soak';
  combatantId: string;
  actorName: string;
  label: string;
  request: Record<string, unknown>;
  result: RollResult;
  limit?: LimitRef | null;
  meta: Record<string, unknown>;
}

export interface ChainRollContext {
  chainId: string;
  encounterId: string;
  attacker: ChainRollTarget;
  defender: ChainRollTarget;
  weaponName: string;
}

function request(opts: {
  pool: number;
  breakdown: ChainOutcome['result']['attack']['breakdown'];
  limit?: LimitRef | undefined;
  combatantId: string;
  meta: Record<string, unknown>;
}): Record<string, unknown> {
  return RollRequestSchema.parse({
    kind: 'simple',
    pool: Math.max(0, opts.pool),
    breakdown: opts.breakdown,
    ...(opts.limit ? { limit: opts.limit } : {}),
    edge: null,
    visibility: 'gm',
    actor: { combatantId: opts.combatantId },
    meta: opts.meta,
  }) as unknown as Record<string, unknown>;
}

/**
 * Attack, defence and soak as roll rows, in the order the chain threw them.
 * The soak row is absent when the attack missed (no soak was rolled), which is
 * exactly what the record should say.
 */
export function chainRollInputs(outcome: ChainOutcome, ctx: ChainRollContext): ChainRollInput[] {
  const { attacker, defender, weaponName } = ctx;
  const shared = {
    chainId: ctx.chainId,
    encounterId: ctx.encounterId,
    attackerId: attacker.id,
    defenderId: defender.id,
    weapon: weaponName,
  };
  const result = outcome.result;
  const inputs: ChainRollInput[] = [
    {
      step: 'attack',
      kind: 'attack',
      combatantId: attacker.id,
      actorName: attacker.name,
      label: `${attacker.name} — Attack (${weaponName})`,
      request: request({
        pool: result.attack.pool,
        breakdown: result.attack.breakdown,
        limit: result.attack.limit,
        combatantId: attacker.id,
        meta: { ...shared, step: 'attack' },
      }),
      result: result.attack.roll,
      limit: result.attack.limit ?? null,
      meta: { ...shared, step: 'attack' },
    },
    {
      step: 'defense',
      kind: 'defense',
      combatantId: defender.id,
      actorName: defender.name,
      label: result.defense.fullDefense
        ? `${defender.name} — Full Defense`
        : `${defender.name} — Defense`,
      request: request({
        pool: result.defense.pool,
        breakdown: result.defense.breakdown,
        combatantId: defender.id,
        meta: {
          ...shared,
          step: 'defense',
          fullDefense: result.defense.fullDefense,
          netHits: result.netHits,
          outcome: result.outcome,
        },
      }),
      result: result.defense.roll,
      limit: null,
      meta: {
        ...shared,
        step: 'defense',
        fullDefense: result.defense.fullDefense,
        netHits: result.netHits,
        outcome: result.outcome,
      },
    },
  ];
  if (result.soak) {
    const soakMeta = {
      ...shared,
      step: 'soak',
      modifiedDv: result.damage?.modifiedDv ?? null,
      boxes: result.soak.boxes,
      track: result.soak.track,
    };
    inputs.push({
      step: 'soak',
      kind: 'soak',
      combatantId: defender.id,
      actorName: defender.name,
      label: `${defender.name} — Soak`,
      request: request({
        pool: result.soak.pool,
        breakdown: result.soak.breakdown,
        combatantId: defender.id,
        meta: soakMeta,
      }),
      result: result.soak.roll,
      limit: null,
      meta: soakMeta,
    });
  }
  return inputs;
}

// ---------------------------------------------------------------------------
// The writes
// ---------------------------------------------------------------------------

/** One copilot roll on its way to the immutable log. */
export interface CopilotRollInput {
  campaignId: string;
  combatantId: string;
  /** Copilot kind (`attack`, `defense`, `soak`, a rack key…). */
  kind: string;
  request: Record<string, unknown>;
  result: {
    faces: number[];
    hits: number;
    ones: number;
    glitch: 'none' | 'glitch' | 'critical';
    limitedHits: number;
  };
  limit?: { kind: string; value: number } | null;
  visibility: Visibility;
  label: string;
  /** Display name for the log line (the combatant's, normally). */
  actorName?: string;
  /** Extra `request.meta` for the receipt (chain id, step, encounter…). */
  meta?: Record<string, unknown>;
}

/**
 * Persist one copilot roll (G5) and announce it.
 *
 * The row is stamped with the campaign's LIVE session id, exactly as
 * `RollService.persistAndEmit` does — without it a copilot quick-roll (and
 * every die an FR10.8 chain throws) fell out of `GET /api/sessions/:id/
 * housekeeping` and `GET …/rolls?session=`, so the session's own record
 * disagreed with what happened at the table.
 *
 * The rolls domain owns `roll.created` end to end; this writes the same row
 * shape directly rather than routing a combatant-actor roll through a service
 * built around characters. The emitted payload is the persisted record
 * (`toRecord`) plus `label`/`actorName`/`result`, so a client hydrating from
 * `GET …/rolls` and one merging live events agree — which is the property that
 * actually matters, and the one a test should hold to.
 */
export async function recordCopilotRoll(
  db: Db,
  hub: Hub,
  input: CopilotRollInput,
): Promise<{ rollId: string }> {
  const actor = { combatantId: input.combatantId };
  const baseMeta =
    typeof input.request['meta'] === 'object' && input.request['meta'] !== null
      ? (input.request['meta'] as Record<string, unknown>)
      : {};
  const persistedRequest = {
    ...input.request,
    label: input.label,
    copilot: input.kind,
    meta: {
      ...baseMeta,
      ...(input.meta ?? {}),
      label: input.label,
      copilot: input.kind,
      ...(input.actorName ? { actorName: input.actorName } : {}),
    },
  };
  const sessionId = await activeSessionId(db, input.campaignId);
  const row = (
    await db
      .insert(rolls)
      .values({
        campaignId: input.campaignId,
        sessionId,
        actor,
        kind: 'simple',
        request: persistedRequest,
        faces: input.result.faces,
        hits: input.result.hits,
        ones: input.result.ones,
        glitch: input.result.glitch,
        limit: input.limit ?? null,
        limitedHits: input.result.limitedHits,
        visibility: input.visibility,
      })
      .returning()
  )[0]!;
  await hub.emit(input.campaignId, {
    type: 'roll.created',
    payload: {
      ...toRecord(row),
      label: input.label,
      ...(input.actorName ? { actorName: input.actorName } : {}),
      result: input.result,
    },
    visibility: input.visibility,
  });
  return { rollId: row.id };
}

/**
 * Persist the dice an FR10.8 chain threw: attack, defence and soak, each its
 * own `rolls` row at `gm` visibility, written AS PRODUCED (the moment the
 * server rolled them) — G5/FR2.1 are about the dice, not about the damage, and
 * the damage still lands only on `…/resolve-chain/commit` (Principle 2). Rows
 * are linked by `request.meta.chainId` so the log can group one exchange.
 */
export async function recordChainRolls(
  db: Db,
  hub: Hub,
  input: {
    campaignId: string;
    encounterId: string;
    attacker: ChainRollTarget;
    defender: ChainRollTarget;
    weaponName: string;
    outcome: ChainOutcome;
  },
): Promise<{ chainId: string; rolls: Array<{ step: string; rollId: string }> }> {
  const chainId = randomUUID();
  const steps = chainRollInputs(input.outcome, {
    chainId,
    encounterId: input.encounterId,
    attacker: input.attacker,
    defender: input.defender,
    weaponName: input.weaponName,
  });
  const out: Array<{ step: string; rollId: string }> = [];
  for (const step of steps) {
    const { rollId } = await recordCopilotRoll(db, hub, {
      campaignId: input.campaignId,
      combatantId: step.combatantId,
      kind: step.kind,
      request: step.request,
      result: step.result,
      limit: step.limit ?? null,
      visibility: 'gm',
      label: step.label,
      actorName: step.actorName,
      meta: step.meta,
    });
    out.push({ step: step.step, rollId });
  }
  return { chainId, rolls: out };
}
