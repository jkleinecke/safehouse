/**
 * What the copilot owes the immutable record (G5 / FR2.1 / FR2.7 / FR6.1).
 *
 * Two defects the build report ranked third and fourth, asserted as ordinary
 * properties of the log:
 *
 *  - a resolved FR10.8 chain threw three real server-side pools (attack,
 *    defence, soak) and persisted NONE of them — a whole firefight added zero
 *    rows to `rolls`. They belong on the record as they are thrown, at `gm`
 *    visibility, linked by one `chainId`. The DAMAGE still waits for the GM
 *    (Principle 2); the dice do not.
 *  - `EncountersService.recordRoll` wrote copilot rolls without a `session_id`,
 *    so every quick-roll and every chain die fell out of the housekeeping
 *    summary and out of `GET …/rolls?session=`. The session's own record
 *    disagreed with what happened at the table.
 */
import type { Api } from './harness.js';
import type { Ctx, PersistedRoll, Phone, RollResult } from './types.js';

export interface ChainRolls {
  chainId: string;
  rolls: { step: string; rollId: string }[];
}

/** The chain's three pools, on the record and behind the screen. */
export async function chainOnTheRecord(opts: {
  ctx: Ctx;
  gm: Api;
  phones: Record<string, Phone>;
  campaignId: string;
  chain: ChainRolls;
  hit: boolean;
  attackRoll: RollResult;
  rollsBefore: number;
}): Promise<void> {
  const { ctx, gm, phones, campaignId, chain } = opts;
  const { checks } = ctx;

  const after = (await gm.get<{ rolls: { id: string }[] }>(`/api/campaigns/${campaignId}/rolls?limit=200`)).rolls.length;
  const expected = opts.hit ? ['attack', 'defense', 'soak'] : ['attack', 'defense'];
  checks.eq('the chain persists every pool it threw', expected, chain.rolls.map((r) => r.step));
  checks.record(
    '…and the roll log grew by at least that many rows',
    `${opts.rollsBefore} → at least ${opts.rollsBefore + expected.length}`,
    `${opts.rollsBefore} → ${after}`,
    after >= opts.rollsBefore + expected.length,
  );

  const rows = await Promise.all(
    chain.rolls.map((r) => gm.get<{ roll: PersistedRoll }>(`/api/rolls/${r.rollId}`)),
  );
  checks.record(
    'every one of them is behind the screen and stamped with the chain',
    `visibility gm, chainId ${chain.chainId}`,
    rows.map((r) => `${String(r.roll.request.meta?.['step'])}:${r.roll.visibility}`).join(' '),
    rows.every((r) => r.roll.visibility === 'gm' && r.roll.request.meta?.['chainId'] === chain.chainId),
  );
  checks.record(
    '…and the faces on the record are the faces on the card',
    'the attack card and its stored row agree, die for die',
    JSON.stringify(rows[0]?.roll.faces ?? []),
    JSON.stringify(rows[0]?.roll.faces ?? []) === JSON.stringify(opts.attackRoll.faces),
  );

  const torque = phones['Torque']!;
  const playerLog = await torque.api.get<{ rolls: { id: string }[] }>(
    `/api/campaigns/${campaignId}/rolls?limit=200`,
  );
  const ids = new Set(chain.rolls.map((r) => r.rollId));
  checks.record(
    '…and no phone can read them (FR2.7)',
    'none of the chain rows in a player roll log',
    playerLog.rolls.some((r) => ids.has(r.id)) ? 'leaked' : 'absent',
    playerLog.rolls.every((r) => !ids.has(r.id)),
  );
  checks.eq('…not even by id', 404, await torque.api.status('GET', `/api/rolls/${chain.rolls[0]!.rollId}`));
}

/** Every copilot die belongs to the session it was thrown in. */
export async function copilotDiceInSession(opts: {
  ctx: Ctx;
  gm: Api;
  campaignId: string;
  rollIds: string[];
}): Promise<void> {
  const { ctx, gm, campaignId, rollIds } = opts;
  const { checks } = ctx;
  const live = (await gm.get<{ sessionId: string | null }>(`/api/campaigns/${campaignId}/live`)).sessionId;
  const rows = await Promise.all(
    rollIds.map((id) => gm.get<{ roll: PersistedRoll }>(`/api/rolls/${id}`)),
  );
  checks.record(
    'every copilot roll is stamped with the running session',
    `${rollIds.length} rolls carrying session ${String(live).slice(0, 8)}…`,
    `${rows.filter((r) => r.roll.sessionId === live).length}/${rollIds.length}`,
    live !== null && rows.every((r) => r.roll.sessionId === live),
  );
  const page = await gm.get<{ rolls: { id: string }[] }>(
    `/api/campaigns/${campaignId}/rolls?session=${live}&limit=200`,
  );
  const inSession = new Set(page.rolls.map((r) => r.id));
  checks.record(
    "…so they are in the session's own roll log, not floating beside it",
    'every copilot roll in GET …/rolls?session=',
    `${rollIds.filter((id) => inSession.has(id)).length}/${rollIds.length}`,
    rollIds.every((id) => inSession.has(id)),
  );
}
