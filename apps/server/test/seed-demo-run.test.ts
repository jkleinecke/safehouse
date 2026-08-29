/**
 * The demo campaign's run row, through the route that owns it (FR5.5).
 *
 * `seed/demo.ts` claims in its own header that every seeded row goes through
 * the same validation a GM's click would. That was true of the sheets, the
 * scene, the tokens, the fog and the session — and not of the run, which was
 * inserted straight into the table while `POST /api/campaigns/:id/runs` sat
 * right there. So the one row nothing validated was the one carrying the
 * payout, and its shape had quietly drifted away from what the route accepts:
 * a `payout` blob of `{ currency, total, upfront, onDelivery, terms }` against
 * a schema expecting `{ nuyen, karma, notes }`, plus a pre-filled `awards`
 * that the route does not accept at all and the ledger would never have
 * approved.
 *
 * Nothing caught it because nothing could: the payload lived inside a script
 * with top-level `await` and a `process.exit`, so no test could import it.
 * It lives in `seed/assets/run.ts` now, and this suite feeds that exact
 * constant to the real route.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { demoRun } from '../seed/assets/run.js';
import {
  WHISPER,
  WHISPERS_DRAMS,
  WHISPERS_FOCUS,
  WHISPERS_SPIRIT,
} from '../seed/assets/runners.js';
import {
  bootstrapCampaign,
  joinAs,
  makeTestApp,
  type BootstrapResult,
  type JoinResult,
  type TestApp,
} from './core-helpers.js';

const CAMPAIGN_NAME = 'Static on the Line';
const INGAME_DATE = '2076-06-12';

interface RunDto {
  id: string;
  title: string;
  state: string;
  hook: string;
  objectives: Array<{ id: string; text: string; state: string }>;
  opposition: unknown[];
  payout: { nuyen?: number; karma?: number; notes?: string };
  awards: { karma: number; nuyen: number; history: unknown[] };
  recapMd: string;
  ingameDate: string | null;
}

let t: TestApp;
let boot: BootstrapResult;
let player: JoinResult;
let created: RunDto;

beforeAll(async () => {
  t = await makeTestApp('seed-demo-run');
  boot = await bootstrapCampaign(t.app, CAMPAIGN_NAME);
  player = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Torque');
}, 120_000);

afterAll(async () => {
  await t.close();
});

describe('the seeded run', () => {
  it('is accepted by POST /api/campaigns/:id/runs', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/campaigns/${boot.campaignId}/runs`,
      headers: { authorization: `Bearer ${boot.gmToken}` },
      payload: demoRun(CAMPAIGN_NAME, INGAME_DATE),
    });
    expect(res.statusCode, res.body).toBe(201);
    created = (res.json() as { run: RunDto }).run;
  });

  it('round-trips the brief the demo actually describes', async () => {
    const source = demoRun(CAMPAIGN_NAME, INGAME_DATE);
    expect(created.title).toBe(CAMPAIGN_NAME);
    expect(created.state).toBe('prep');
    expect(created.ingameDate).toBe(INGAME_DATE);
    expect(created.hook).toBe(source.hook);
    expect(created.objectives.map((o) => o.text)).toEqual(source.objectives.map((o) => o.text));
    // The route mints ids for objectives the payload left unnamed; without them
    // the GM cannot tick one off.
    for (const objective of created.objectives) {
      expect(objective.id).toMatch(/^[0-9a-f-]{36}$/i);
      expect(objective.state).toBe('open');
    }
    expect(created.payout).toEqual(source.payout);
  });

  it('leaves the ledger untouched — nothing is awarded by seeding', async () => {
    // The old raw insert wrote `awards: { karma: 4, nuyen: 8000 }`, which is
    // money on the table nobody confirmed. Awards are the `/award` route's job
    // and land pending for the GM to approve (FR3.6).
    expect(created.awards).toEqual({ karma: 0, nuyen: 0, history: [] });
    expect(created.recapMd).toBe('');
  });

  it('reads back through GET, still whole', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/runs/${created.id}`,
      headers: { authorization: `Bearer ${boot.gmToken}` },
    });
    expect(res.statusCode).toBe(200);
    const run = (res.json() as { run: RunDto }).run;
    expect(run.objectives).toHaveLength(3);
    expect(run.payout.nuyen).toBe(8000);
    expect(run.payout.karma).toBe(4);
  });

  it('keeps the brief off a player device while the job is in prep', async () => {
    // Going through the route rather than the table is also what puts the run
    // behind the server-side cut (Principle 4) — a raw insert got the row into
    // the table but never proved the players could not read the brief.
    const list = await t.app.inject({
      method: 'GET',
      url: `/api/campaigns/${boot.campaignId}/runs`,
      headers: { authorization: `Bearer ${player.token}` },
    });
    expect(list.statusCode).toBe(200);
    expect((list.json() as { runs: unknown[] }).runs).toHaveLength(0);

    const direct = await t.app.inject({
      method: 'GET',
      url: `/api/runs/${created.id}`,
      headers: { authorization: `Bearer ${player.token}` },
    });
    expect(direct.statusCode).toBe(404);
  });

  it('is original content — no page refs, no transcribed text', () => {
    const source = demoRun(CAMPAIGN_NAME, INGAME_DATE);
    const prose = [source.hook, source.payout.notes, ...source.objectives.map((o) => o.text)].join(' ');
    expect(prose).not.toMatch(/\bp\.\s?\d+/i);
    expect(prose.length).toBeGreaterThan(0);
  });
});

/**
 * The same argument, one table over. The mage's bound spirit, her focus and her
 * reagents used to be *gear lines* — a name, a rating and a note, because
 * SheetV1 has no slot for any of them. A gear line cannot spend a service and
 * cannot move a pool, so the demo campaign opened with a summoner whose spirit
 * was a piece of text. FR8.3/FR8.4 gave all three real homes; these constants
 * are what `seed/demo.ts` posts, and this suite feeds them to the real routes.
 */
describe('the seeded mage’s magic state', () => {
  let mageId: string;

  it('creates the bound spirit through the summon route, playable on arrival', async () => {
    const created = await t.app.inject({
      method: 'POST',
      url: '/api/characters',
      headers: { authorization: `Bearer ${boot.gmToken}` },
      payload: { campaignId: boot.campaignId, name: 'Whisper', sheet: WHISPER },
    });
    expect(created.statusCode, created.body).toBe(201);
    mageId = (created.json() as { character: { id: string } }).character.id;

    const res = await t.app.inject({
      method: 'POST',
      url: `/api/campaigns/${boot.campaignId}/magic/spirits`,
      headers: { authorization: `Bearer ${boot.gmToken}` },
      payload: { ...WHISPERS_SPIRIT, characterId: mageId },
    });
    expect(res.statusCode, res.body).toBe(201);
    const out = res.json() as {
      spirit: { id: string; services: number; bound: boolean; force: number };
      derived: {
        attributes: Record<string, { value: number; breakdown: Array<{ label: string }> }>;
        monitors: { physical: { value: number } };
      };
    };
    expect(out.spirit).toMatchObject({ bound: true, force: 4, services: 2 });
    // Derived from Force by the engine, not typed by hand — with its receipt.
    expect(out.derived.attributes['rea']!.value).toBe(WHISPERS_SPIRIT.force + 3);
    expect(out.derived.attributes['rea']!.breakdown.length).toBeGreaterThan(0);
    expect(out.derived.monitors.physical.value).toBeGreaterThan(0);
  });

  it('spends a service off the seeded count', async () => {
    const list = await t.app.inject({
      method: 'GET',
      url: `/api/campaigns/${boot.campaignId}/magic`,
      headers: { authorization: `Bearer ${boot.gmToken}` },
    });
    const spiritId = (list.json() as { spirits: Array<{ id: string }> }).spirits[0]!.id;
    const spent = await t.app.inject({
      method: 'POST',
      url: `/api/campaigns/${boot.campaignId}/magic/spirits/${spiritId}/services`,
      headers: { authorization: `Bearer ${boot.gmToken}` },
      payload: {},
    });
    expect(spent.statusCode).toBe(200);
    expect((spent.json() as { spirit: { services: number } }).spirit.services).toBe(1);
  });

  it('adds the focus as a live toggle that moves the pool it names', async () => {
    const before = await derivedPool(mageId, 'skill.spellcasting');
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/characters/${mageId}/foci`,
      headers: { authorization: `Bearer ${boot.gmToken}` },
      payload: WHISPERS_FOCUS,
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(await derivedPool(mageId, 'skill.spellcasting')).toBe(before + WHISPERS_FOCUS.force);
  });

  it('sets the reagent count through its own route', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/characters/${mageId}/reagents`,
      headers: { authorization: `Bearer ${boot.gmToken}` },
      payload: { op: 'set', amount: WHISPERS_DRAMS },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { after: number }).after).toBe(WHISPERS_DRAMS);
  });

  it('leaves nothing pretending to be tracked state on the gear list', () => {
    const gearText = WHISPER.gear!.map((g) => `${g.name} ${g.note ?? ''}`).join(' ').toLowerCase();
    expect(gearText).not.toContain('bound spirit');
    expect(gearText).not.toContain('services remaining');
  });
});

async function derivedPool(characterId: string, poolId: string): Promise<number> {
  const res = await t.app.inject({
    method: 'GET',
    url: `/api/characters/${characterId}/derived`,
    headers: { authorization: `Bearer ${boot.gmToken}` },
  });
  expect(res.statusCode).toBe(200);
  const body = res.json() as { derived: { pools: Record<string, { total: number }> } };
  return body.derived.pools[poolId]!.total;
}
