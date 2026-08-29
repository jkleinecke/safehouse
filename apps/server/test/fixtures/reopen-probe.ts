/**
 * Child-process probe for `test/seed-durability.test.ts`. NOT a test suite —
 * vitest only collects `test/**\/*.test.ts`.
 *
 * Runs as the SECOND process over a DATA_DIR some other process seeded and
 * exited from: reports the state the directory was handed over in, then does
 * the thing the field report said was broken — append an event and read it
 * back out of the shared log.
 *
 * Prints one `PROBE {json}` line on stdout. Anything else on stdout is noise
 * the caller ignores.
 */
import { eq, sql } from 'drizzle-orm';
import { campaigns, rolls, wsEvents } from '@safehouse/db';
import { buildApp } from '../../src/app.js';
import { closeDatabase } from '../../src/shutdown.js';

interface Rows<T> {
  rows: T[];
}

const token = process.env['PROBE_TOKEN'] ?? '';
const campaignName = process.env['PROBE_CAMPAIGN_NAME'] ?? '';

const app = await buildApp({ webDist: false, logger: false });

/** `last_value` vs `max(id)`: equal only when the writer checkpointed on exit. */
const seq = (await app.db.execute(
  sql`select last_value::int as lv, is_called from public.ws_events_id_seq`,
)) as unknown as Rows<{ lv: number; is_called: boolean }>;
const agg = (await app.db.execute(
  sql`select coalesce(max(id), 0)::int as m, count(*)::int as c from ws_events`,
)) as unknown as Rows<{ m: number; c: number }>;

const campaign = (
  await app.db.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.name, campaignName)).limit(1)
)[0];
const campaignId = campaign?.id ?? '';

const logBefore = await app.inject({
  method: 'GET',
  url: `/api/campaigns/${campaignId}/log`,
  headers: { authorization: `Bearer ${token}` },
});

const rollRes = await app.inject({
  method: 'POST',
  url: '/api/rolls',
  headers: { authorization: `Bearer ${token}` },
  payload: {
    kind: 'simple',
    pool: 6,
    breakdown: [{ label: 'reopen probe', value: 6 }],
    visibility: 'public',
    actor: { gm: true },
  },
});

const logAfter = await app.inject({
  method: 'GET',
  url: `/api/campaigns/${campaignId}/log`,
  headers: { authorization: `Bearer ${token}` },
});
const rollList = await app.inject({
  method: 'GET',
  url: `/api/campaigns/${campaignId}/rolls`,
  headers: { authorization: `Bearer ${token}` },
});

const countOf = (res: { statusCode: number; body: string }, key: string): number => {
  if (res.statusCode !== 200) return -1;
  const parsed = JSON.parse(res.body) as Record<string, unknown>;
  const list = parsed[key];
  return Array.isArray(list) ? list.length : -1;
};

const rollRows = await app.db.select({ n: sql<number>`count(*)::int` }).from(rolls);
const created = await app.db
  .select({ n: sql<number>`count(*)::int` })
  .from(wsEvents)
  .where(eq(wsEvents.type, 'roll.created'));

console.log(
  `PROBE ${JSON.stringify({
    campaignId,
    seqLastValue: seq.rows[0]?.lv ?? null,
    maxEventId: agg.rows[0]?.m ?? null,
    eventCount: agg.rows[0]?.c ?? null,
    logBefore: countOf(logBefore, 'events'),
    logAfter: countOf(logAfter, 'events'),
    rollStatus: rollRes.statusCode,
    rollError: rollRes.statusCode === 201 ? null : rollRes.body.slice(0, 400),
    listedRolls: countOf(rollList, 'rolls'),
    rollRowCount: rollRows[0]?.n ?? null,
    rollCreatedEvents: created[0]?.n ?? null,
  })}`,
);

await app.close();
await closeDatabase(app.db);
process.exit(0);
