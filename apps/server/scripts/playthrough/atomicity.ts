/**
 * The half-commit probe — LIVE-4's shape, checked on a live campaign rather
 * than on a fixture (`docs/BUILD_REPORT.md` §6.2).
 *
 * LIVE-4 was a roll that landed in `rolls` with no event and no socket frame,
 * on a fully green build, because the domain row and its event were two
 * statements instead of one transaction. `Hub.atomic` fixed the roll path; the
 * ledger, encounter damage and the campaign clock were converted after it. This
 * beat is the proof that the conversion took, run against the same server the
 * rest of the night ran on.
 *
 * The method is `test/core-atomicity-domains.test.ts`'s, deliberately: make the
 * path's event type fail the way a genuine database fault would — a CHECK
 * constraint on `ws_events`, a real Postgres error through the real driver,
 * never a stubbed method — then assert BOTH halves:
 *
 *   1. the caller got a *named* error (`event_append_failed`, naming the event
 *      type, and never a raw SQL statement), and
 *   2. **the domain row did not land.**
 *
 * (2) is the one that matters. "The request failed" is compatible with the bug:
 * LIVE-4's roll returned 500 *and* persisted. `NOT VALID` is used because this
 * campaign has already emitted every type being blocked, and a validating CHECK
 * refuses to be created over rows that violate it; it still enforces on INSERT,
 * which is the only half needed.
 *
 * Everything here is restored before the beat ends: the constraint is dropped
 * on every path, and the in-game date is put back where the session left it.
 */
import { sql } from 'drizzle-orm';
import type { Api } from './harness.js';
import type { World } from './setup.js';
import type { Combatant, Ctx, Monitors } from './types.js';

interface Refusal {
  status: number;
  code: string;
  message: string;
}

/** The 500 envelope the hub raises when an event could not be recorded. */
function refusalOf(raw: { status: number; body: string }): Refusal {
  let code = '';
  let message = '';
  try {
    const parsed = JSON.parse(raw.body) as { error?: { code?: string; message?: string } };
    code = parsed.error?.code ?? '';
    message = parsed.error?.message ?? '';
  } catch {
    message = raw.body.slice(0, 200);
  }
  return { status: raw.status, code, message };
}

function refusalIsClean(refusal: Refusal, eventType: string): boolean {
  return (
    refusal.status === 500 &&
    refusal.code === 'event_append_failed' &&
    refusal.message.includes(eventType) &&
    // The field report's 500 body was drizzle's raw statement. Never again.
    !refusal.message.includes('insert into')
  );
}

export async function atomicity(ctx: Ctx, world: World, gm: Api, characterId: string): Promise<void> {
  const { checks, story } = ctx;
  const cid = world.campaignId;
  checks.beat('8 · Half-commit probes (LIVE-4)');

  const db = world.app.db;
  const block = async (type: string): Promise<void> => {
    await db.execute(
      sql`alter table ws_events add constraint playthrough_atomicity check (type <> ${sql.raw(
        `'${type}'`,
      )}) not valid`,
    );
  };
  const unblock = async (): Promise<void> => {
    await db.execute(sql`alter table ws_events drop constraint if exists playthrough_atomicity`);
  };

  /** Run `body` with `type` un-appendable, and always clear the fault after. */
  const withBlocked = async <T>(type: string, body: () => Promise<T>): Promise<T> => {
    await block(type);
    try {
      return await body();
    } finally {
      await unblock();
    }
  };

  // --- 1. the ledger: money -------------------------------------------------
  const before = await gm.get<{ entries: { id: string }[] }>(`/api/campaigns/${cid}/ledger`);
  const ledgerRefusal = await withBlocked('ledger.changed', async () =>
    refusalOf(
      await gm.raw('POST', `/api/characters/${characterId}/ledger`, {
        currency: 'nuyen',
        delta: 12_000,
        reason: 'a payout nobody was ever told about',
        state: 'approved',
      }),
    ),
  );
  const after = await gm.get<{ entries: { id: string }[] }>(`/api/campaigns/${cid}/ledger`);
  checks.record(
    'a ledger write that cannot be announced fails loudly',
    '500 event_append_failed, naming ledger.changed, no SQL in the message',
    `${ledgerRefusal.status} ${ledgerRefusal.code}: ${ledgerRefusal.message}`,
    refusalIsClean(ledgerRefusal, 'ledger.changed'),
  );
  checks.record(
    '…and leaves NO orphan entry behind (the LIVE-4 shape, on money)',
    `still ${before.entries.length} ledger rows`,
    `${after.entries.length} rows`,
    after.entries.length === before.entries.length,
  );

  // --- 2. encounter damage: monitors ---------------------------------------
  // A staged fight of its own, so the probe cannot perturb the night's own
  // encounter — the point is the write path, not this particular NPC.
  const staged = await gm.post<{ encounter: { id: string } }>(`/api/campaigns/${cid}/encounters`, {
    name: 'Pier 23 — the follow-up (staged, unrun)',
  });
  const eid = staged.encounter.id;
  const dockhand = await gm.post<{ combatant: Combatant }>(`/api/encounters/${eid}/combatants`, {
    source: 'manual',
    name: 'Halo lookout',
    initBase: 8,
    initDice: 1,
    initScore: 12,
    visibility: 'gm',
    monitors: {
      physical: { max: 10, filled: 0 },
      stun: { max: 10, filled: 0 },
      overflow: { max: 4, filled: 0 },
    },
    professionalRating: 2,
  });
  const target = dockhand.combatant;
  const monitorsOf = async (): Promise<Monitors> =>
    (await gm.get<{ combatants: Combatant[] }>(`/api/encounters/${eid}`)).combatants.find(
      (c) => c.id === target.id,
    )!.monitors;
  const healthy = await monitorsOf();
  const damageRefusal = await withBlocked('combatant.damaged', async () =>
    refusalOf(
      await gm.raw('POST', `/api/encounters/${eid}/damage`, {
        targetId: target.id,
        boxes: 6,
        track: 'physical',
      }),
    ),
  );
  const stillHealthy = await monitorsOf();
  checks.record(
    'damage that cannot be announced fails the same way',
    '500 event_append_failed, naming combatant.damaged',
    `${damageRefusal.status} ${damageRefusal.code}: ${damageRefusal.message}`,
    refusalIsClean(damageRefusal, 'combatant.damaged'),
  );
  checks.record(
    '…and fills no boxes: no monitor moved that no screen was told about',
    `physical ${healthy.physical.filled}/${healthy.physical.max}, unchanged`,
    `physical ${stillHealthy.physical.filled}/${stillHealthy.physical.max}, stun ${stillHealthy.stun.filled}`,
    stillHealthy.physical.filled === healthy.physical.filled &&
      stillHealthy.stun.filled === healthy.stun.filled,
  );
  // Once the fault clears, the same call goes through — the transaction is a
  // guard, not a new way to lose a write.
  const landed = await gm.post<{ combatant: Combatant }>(`/api/encounters/${eid}/damage`, {
    targetId: target.id,
    boxes: 6,
    track: 'physical',
  });
  checks.eq('…and the identical call lands once the fault clears', 6, landed.combatant.monitors.physical.filled);

  // --- 3. the campaign clock ------------------------------------------------
  const campaignBefore = await gm.get<{ ingameDate: string | null }>(`/api/campaigns/${cid}`);
  const clockRefusal = await withBlocked('clock.advanced', async () =>
    refusalOf(await gm.raw('PATCH', `/api/campaigns/${cid}`, { ingameDate: '2076-07-04' })),
  );
  const campaignAfter = await gm.get<{ ingameDate: string | null }>(`/api/campaigns/${cid}`);
  checks.record(
    'the clock refuses to move when the tick cannot be recorded',
    '500 event_append_failed, naming clock.advanced',
    `${clockRefusal.status} ${clockRefusal.code}: ${clockRefusal.message}`,
    refusalIsClean(clockRefusal, 'clock.advanced'),
  );
  checks.record(
    '…and the in-game date does not move (FR5.7)',
    `still ${String(campaignBefore.ingameDate)}`,
    String(campaignAfter.ingameDate),
    campaignAfter.ingameDate === campaignBefore.ingameDate,
  );
  // A settings-only patch raises no event at all, so a blocked clock type is
  // irrelevant to it: the transaction must not turn an unrelated edit into a 500.
  const settingsWhileBlocked = await withBlocked('clock.advanced', async () =>
    gm.status('PATCH', `/api/campaigns/${cid}`, { settings: { atomicityProbe: null } }),
  );
  checks.eq('…while an edit that announces nothing is untouched by the fault', 200, settingsWhileBlocked);

  // PGlite and node-postgres disagree about whether `execute` returns the rows
  // or an object holding them; `ensureSequences` reads it the same tolerant way.
  const left = await db.execute<{ n: number } & Record<string, unknown>>(
    sql`select count(*)::int as n from pg_constraint where conname = 'playthrough_atomicity'`,
  );
  const leftRows = Array.isArray(left)
    ? (left as Array<{ n: number }>)
    : ((left as { rows?: Array<{ n: number }> }).rows ?? []);
  checks.eq('the probe leaves the database exactly as it found it', 0, leftRows[0]?.n ?? -1);

  story.beat('After the settle-up — the probe nobody at the table sees');
  story.say(
    'With the session closed, the harness does something the table never would: it breaks the event log on ' +
      'purpose, one event type at a time, and tries to move money, fill a monitor and advance the calendar while ' +
      'it is broken.',
  );
  story.say(
    'All three refuse, by name — *event_append_failed*, naming the event that could not be written — and, more ' +
      'importantly, all three leave nothing behind: no ledger row, no filled box, no moved date. That is the ' +
      'defect that started this: a roll that was in the database and on nobody’s screen, with nothing anywhere ' +
      'that could ever notice the difference. The moment the fault clears, the same calls go through.',
  );
}
