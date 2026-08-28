/**
 * Campaign rollable tables (FR2.11): CRUD, GM-only visibility, and the draw
 * landing in the session log as a persisted `log.posted` event (FR2.9).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { recentEvents } from '@safehouse/db';
import { pickWeighted } from '../src/plugins/tables.js';
import {
  bootstrapCampaign,
  joinAs,
  makeTestApp,
  type BootstrapResult,
  type JoinResult,
  type TestApp,
} from './core-helpers.js';

let t: TestApp;
let boot: BootstrapResult;
let player: JoinResult;
let observer: JoinResult;
let publicTableId: string;
let secretTableId: string;

const COMPLICATIONS = [
  { weight: 3, text: 'A rival crew is already casing the target.' },
  { weight: 1, text: 'The fixer calls mid-run with a change of terms.' },
  { weight: 1, text: 'Building security rotates an hour early.' },
];

async function req(
  method: 'POST' | 'GET' | 'PATCH' | 'DELETE',
  url: string,
  token: string,
  payload?: Record<string, unknown>,
) {
  return t.app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${token}` },
    ...(payload !== undefined ? { payload } : {}),
  });
}

beforeAll(async () => {
  t = await makeTestApp('roll-tables');
  boot = await bootstrapCampaign(t.app, 'Table Table');
  player = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Static');
  observer = await joinAs(t.app, boot.campaignId, boot.gmToken, 'observer', 'The TV');
  const created = await req('POST', `/api/campaigns/${boot.campaignId}/roll-tables`, boot.gmToken, {
    kind: 'custom',
    title: 'Run complications',
    entries: COMPLICATIONS,
    visibility: 'public',
  });
  publicTableId = (created.json() as { table: { id: string } }).table.id;
  const secret = await req('POST', `/api/campaigns/${boot.campaignId}/roll-tables`, boot.gmToken, {
    kind: 'custom',
    title: 'What the Johnson is hiding',
    entries: [{ weight: 1, text: 'He is buying back his own stolen prototype.' }],
    visibility: 'gm',
  });
  secretTableId = (secret.json() as { table: { id: string } }).table.id;
}, 120_000);

afterAll(async () => {
  await t.close();
});

describe('weighted draw', () => {
  it('respects the weights across the cumulative range', () => {
    expect(pickWeighted(COMPLICATIONS, 0)).toBe(0);
    expect(pickWeighted(COMPLICATIONS, 0.55)).toBe(0); // weight 3 of 5 → [0, .6)
    expect(pickWeighted(COMPLICATIONS, 0.65)).toBe(1);
    expect(pickWeighted(COMPLICATIONS, 0.999999)).toBe(2);
  });
});

describe('CRUD (§12)', () => {
  it('lists campaign tables, filtered by visibility', async () => {
    const gm = await req('GET', `/api/campaigns/${boot.campaignId}/roll-tables`, boot.gmToken);
    const gmTitles = (gm.json() as { tables: { title: string }[] }).tables.map((x) => x.title);
    expect(gmTitles).toContain('Run complications');
    expect(gmTitles).toContain('What the Johnson is hiding');

    const seen = await req('GET', `/api/campaigns/${boot.campaignId}/roll-tables`, player.token);
    const playerTitles = (seen.json() as { tables: { title: string }[] }).tables.map((x) => x.title);
    expect(playerTitles).toEqual(['Run complications']);
  });

  it('hides a GM-only table behind a 404 on read', async () => {
    expect((await req('GET', `/api/roll-tables/${secretTableId}`, player.token)).statusCode).toBe(404);
    expect((await req('GET', `/api/roll-tables/${secretTableId}`, boot.gmToken)).statusCode).toBe(200);
  });

  it('lets only the GM create, edit, and delete', async () => {
    const denied = await req('POST', `/api/campaigns/${boot.campaignId}/roll-tables`, player.token, {
      title: 'Player table',
      entries: [{ weight: 1, text: 'nope' }],
    });
    expect(denied.statusCode).toBe(403);

    const patched = await req('PATCH', `/api/roll-tables/${publicTableId}`, boot.gmToken, {
      title: 'Run complications (Seattle)',
    });
    expect((patched.json() as { table: { title: string } }).table.title).toBe(
      'Run complications (Seattle)',
    );
    expect((await req('PATCH', `/api/roll-tables/${publicTableId}`, player.token, { title: 'x' })).statusCode).toBe(403);

    const doomed = await req('POST', `/api/campaigns/${boot.campaignId}/roll-tables`, boot.gmToken, {
      title: 'Scratch',
      entries: [{ weight: 1, text: 'delete me' }],
    });
    const doomedId = (doomed.json() as { table: { id: string } }).table.id;
    expect((await req('DELETE', `/api/roll-tables/${doomedId}`, boot.gmToken)).statusCode).toBe(200);
    expect((await req('GET', `/api/roll-tables/${doomedId}`, boot.gmToken)).statusCode).toBe(404);
  });

  it('rejects an empty entry list', async () => {
    const res = await req('POST', `/api/campaigns/${boot.campaignId}/roll-tables`, boot.gmToken, {
      title: 'Nothing',
      entries: [],
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('rolling a table (FR2.11)', () => {
  it('lands the result in the session log', async () => {
    const res = await req('POST', `/api/roll-tables/${publicTableId}/roll`, player.token, {
      note: 'pre-run complication',
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      index: number;
      entry: { text: string };
      event: { id: number };
    };
    expect(COMPLICATIONS.map((e) => e.text)).toContain(body.entry.text);

    const events = await recentEvents(t.db, boot.campaignId, 20);
    const logged = events.find((e) => e.id === body.event.id);
    expect(logged?.type).toBe('log.posted');
    expect(logged?.visibility).toBe('public');
    const payload = logged?.payload as { kind: string; text: string; tableId: string; note?: string };
    expect(payload.kind).toBe('table');
    expect(payload.tableId).toBe(publicTableId);
    expect(payload.text).toContain(body.entry.text);
    expect(payload.note).toBe('pre-run complication');
  });

  it('keeps a GM-only table GM-only when rolled', async () => {
    expect((await req('POST', `/api/roll-tables/${secretTableId}/roll`, player.token)).statusCode).toBe(404);
    const res = await req('POST', `/api/roll-tables/${secretTableId}/roll`, boot.gmToken);
    expect(res.statusCode).toBe(201);
    const eventId = (res.json() as { event: { id: number } }).event.id;
    const events = await recentEvents(t.db, boot.campaignId, 10);
    expect(events.find((e) => e.id === eventId)?.visibility).toBe('gm');
  });

  it('refuses observers (§13)', async () => {
    const res = await req('POST', `/api/roll-tables/${publicTableId}/roll`, observer.token);
    expect(res.statusCode).toBe(403);
  });
});
