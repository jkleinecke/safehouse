/**
 * Contacts (M5 — FR5.8): Connection/Loyalty/favours per character, linkable to
 * a codex NPC page, owner-or-GM only. The web sheet has been calling
 * `GET /api/characters/:id/contacts` since M3 (apps/web/src/features/sheet).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  makeTestApp,
  bootstrapCampaign,
  joinAs,
  type BootstrapResult,
  type JoinResult,
  type TestApp,
} from './core-helpers.js';

let t: TestApp;
let boot: BootstrapResult;
let player: JoinResult;
let other: JoinResult;
let characterId: string;
let npcPageId: string;
let contactId: string;

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

interface ContactDto {
  id: string;
  characterId: string;
  name: string;
  archetype: string;
  connection: number;
  loyalty: number;
  notes: string;
  favours: { owed: number; owing: number };
  npcPageId: string | null;
}

async function post(token: string, url: string, payload: unknown) {
  return t.app.inject({ method: 'POST', url, headers: auth(token), payload: payload as never });
}

async function get(token: string, url: string) {
  return t.app.inject({ method: 'GET', url, headers: auth(token) });
}

async function list(token: string): Promise<ContactDto[]> {
  const res = await get(token, `/api/characters/${characterId}/contacts`);
  expect(res.statusCode).toBe(200);
  return (res.json() as { contacts: ContactDto[] }).contacts;
}

beforeAll(async () => {
  t = await makeTestApp('contacts');
  boot = await bootstrapCampaign(t.app);
  player = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Rivet');
  other = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Nomad');
  const created = await post(boot.gmToken, '/api/characters', {
    campaignId: boot.campaignId,
    name: 'Rivet',
    ownerUserId: player.user.id,
  });
  characterId = (created.json() as { character: { id: string } }).character.id;
  const page = await post(boot.gmToken, `/api/campaigns/${boot.campaignId}/wiki`, {
    kind: 'npc',
    title: 'Marla Quint',
    visibility: 'public',
    contentMd: 'Cargo fixer. Answers her comm exactly once.',
  });
  npcPageId = (page.json() as { page: { id: string } }).page.id;
}, 120_000);

afterAll(async () => {
  await t.close();
}, 60_000);

describe('contacts round-trip (FR5.8)', () => {
  it('creates a contact and reads it back', async () => {
    const res = await post(player.token, `/api/characters/${characterId}/contacts`, {
      name: 'Marla Quint',
      archetype: 'Cargo fixer',
      connection: 4,
      loyalty: 3,
      notes: 'Met her on the dockside job. Do not call twice in one week.',
      favours: { owed: 1, owing: 2 },
      npcPageId,
    });
    expect(res.statusCode).toBe(201);
    const contact = (res.json() as { contact: ContactDto }).contact;
    contactId = contact.id;

    const rows = await list(player.token);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: 'Marla Quint',
      archetype: 'Cargo fixer',
      connection: 4,
      loyalty: 3,
      notes: 'Met her on the dockside job. Do not call twice in one week.',
      favours: { owed: 1, owing: 2 },
      npcPageId,
    });
  });

  it('keeps plain notes plain when there are no favours', async () => {
    const res = await post(player.token, `/api/characters/${characterId}/contacts`, {
      name: 'Doc Pellet',
      archetype: 'Street doc',
      connection: 2,
      loyalty: 4,
      notes: 'Cash only.',
    });
    expect(res.statusCode).toBe(201);
    const contact = (res.json() as { contact: ContactDto }).contact;
    expect(contact.notes).toBe('Cash only.');
    expect(contact.favours).toEqual({ owed: 0, owing: 0 });
  });

  it('patches ratings, favours and notes independently', async () => {
    const bump = await t.app.inject({
      method: 'PATCH',
      url: `/api/contacts/${contactId}`,
      headers: auth(player.token),
      payload: { loyalty: 4, favours: { owed: 0, owing: 3 } },
    });
    expect(bump.statusCode).toBe(200);
    const contact = (bump.json() as { contact: ContactDto }).contact;
    expect(contact.loyalty).toBe(4);
    expect(contact.connection).toBe(4);
    expect(contact.notes).toBe('Met her on the dockside job. Do not call twice in one week.');
    expect(contact.favours).toEqual({ owed: 0, owing: 3 });

    const empty = await t.app.inject({
      method: 'PATCH',
      url: `/api/contacts/${contactId}`,
      headers: auth(player.token),
      payload: {},
    });
    expect(empty.statusCode).toBe(400);
  });

  it('validates the SR5 rating bands and the codex link', async () => {
    const bad = await post(player.token, `/api/characters/${characterId}/contacts`, {
      name: 'Overclocked',
      connection: 13,
    });
    expect(bad.statusCode).toBe(400);
    const badLoyalty = await post(player.token, `/api/characters/${characterId}/contacts`, {
      name: 'Overclocked',
      loyalty: 7,
    });
    expect(badLoyalty.statusCode).toBe(400);
    const badPage = await post(player.token, `/api/characters/${characterId}/contacts`, {
      name: 'Ghost',
      npcPageId: '00000000-0000-4000-8000-000000000000',
    });
    expect(badPage.statusCode).toBe(404);
  });
});

describe('access (FR5.8 — shared with the GM, not with the table)', () => {
  it('the GM may read and write another character’s contacts', async () => {
    const rows = await list(boot.gmToken);
    expect(rows.map((c) => c.name).sort()).toEqual(['Doc Pellet', 'Marla Quint']);
    const added = await post(boot.gmToken, `/api/characters/${characterId}/contacts`, {
      name: 'Whisper',
      archetype: 'Decker',
    });
    expect(added.statusCode).toBe(201);
  });

  it('another player may not read or write them', async () => {
    const read = await get(other.token, `/api/characters/${characterId}/contacts`);
    expect(read.statusCode).toBe(403);
    const write = await post(other.token, `/api/characters/${characterId}/contacts`, { name: 'Mole' });
    expect(write.statusCode).toBe(403);
    const patch = await t.app.inject({
      method: 'PATCH',
      url: `/api/contacts/${contactId}`,
      headers: auth(other.token),
      payload: { loyalty: 1 },
    });
    expect(patch.statusCode).toBe(403);
  });

  it('the GM roster spans the table and resolves codex links', async () => {
    const res = await get(boot.gmToken, `/api/campaigns/${boot.campaignId}/contacts`);
    expect(res.statusCode).toBe(200);
    const rows = (res.json() as {
      contacts: Array<ContactDto & { characterName: string; npcPageTitle?: string }>;
    }).contacts;
    expect(rows).toHaveLength(3);
    expect(rows.every((c) => c.characterName === 'Rivet')).toBe(true);
    expect(rows.find((c) => c.name === 'Marla Quint')?.npcPageTitle).toBe('Marla Quint');

    const denied = await get(player.token, `/api/campaigns/${boot.campaignId}/contacts`);
    expect(denied.statusCode).toBe(403);
  });

  it('deletes a contact', async () => {
    const res = await t.app.inject({
      method: 'DELETE',
      url: `/api/contacts/${contactId}`,
      headers: auth(player.token),
    });
    expect(res.statusCode).toBe(200);
    expect((await list(player.token)).map((c) => c.name).sort()).toEqual(['Doc Pellet', 'Whisper']);
  });
});
