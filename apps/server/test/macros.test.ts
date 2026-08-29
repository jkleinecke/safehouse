/**
 * Personal macros (FR2.8) — `/api/campaigns/:id/macros`.
 *
 * The bug this closes is not a crash; it is a shape. Macros lived in one
 * browser's `localStorage`, so "personal macro" actually meant "macro on this
 * handset", and a player who borrowed a phone mid-fight opened an empty rack.
 * The tests below are therefore about IDENTITY rather than CRUD:
 *
 *   - two device tokens for the same person see one rack (the borrowed phone);
 *   - two people on one campaign see two racks, and neither can address the
 *     other's rows even with the id in hand (Principle 4);
 *   - pushing the same rack twice converges instead of doubling, which is what
 *     makes the web app's one-time migration off localStorage safe to retry.
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
/** A SECOND device token for the SAME GM user — the borrowed phone. */
let gmPhoneToken: string;
let player: JoinResult;

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

interface MacroDto {
  id: string;
  name: string;
  label: string;
  pool: number;
  limitKind?: string;
  limitValue?: number;
  edge?: string;
  visibility: string;
  sortOrder: number;
}

const path = (campaignId: string) => `/api/campaigns/${campaignId}/macros`;

async function get(token: string, url: string) {
  return t.app.inject({ method: 'GET', url, headers: auth(token) });
}

async function send(method: 'POST' | 'PUT' | 'PATCH', token: string, url: string, payload: unknown) {
  return t.app.inject({ method, url, headers: auth(token), payload: payload as never });
}

async function rack(token: string): Promise<MacroDto[]> {
  const res = await get(token, path(boot.campaignId));
  expect(res.statusCode).toBe(200);
  return (res.json() as { macros: MacroDto[] }).macros;
}

beforeAll(async () => {
  t = await makeTestApp('macros');
  boot = await bootstrapCampaign(t.app);
  // Same user, new token: exactly what `POST /api/campaigns/:id/gm-device` is
  // for, and exactly the situation the old localStorage rack could not survive.
  const second = await send('POST', boot.gmToken, `/api/campaigns/${boot.campaignId}/gm-device`, {
    label: "GM's phone",
  });
  expect(second.statusCode).toBe(201);
  const body = second.json() as { token: string; user: { id: string } };
  expect(body.user.id).toBe(boot.gmUserId);
  gmPhoneToken = body.token;
  player = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Whisper');
}, 120_000);

afterAll(async () => {
  await t.close();
});

describe('the rack follows the person', () => {
  it('starts empty', async () => {
    expect(await rack(boot.gmToken)).toEqual([]);
  });

  it('a macro saved on the laptop is on the phone', async () => {
    const created = await send('POST', boot.gmToken, path(boot.campaignId), {
      name: 'Full auto burst',
      pool: 14,
      limitKind: 'accuracy',
      limitValue: 5,
      edge: 'push_pre',
    });
    expect(created.statusCode).toBe(201);
    const macro = (created.json() as { macro: MacroDto }).macro;
    expect(macro).toMatchObject({
      name: 'Full auto burst',
      label: 'Full auto burst',
      pool: 14,
      limitKind: 'accuracy',
      limitValue: 5,
      edge: 'push_pre',
      visibility: 'public',
    });

    // The other device. Nothing was synced, nothing was copied — it is one row.
    const fromPhone = await rack(gmPhoneToken);
    expect(fromPhone).toHaveLength(1);
    expect(fromPhone[0]!.id).toBe(macro.id);
    expect(fromPhone[0]!.pool).toBe(14);
  });

  it('an edit on the phone is on the laptop', async () => {
    const [existing] = await rack(gmPhoneToken);
    const patched = await send(
      'PATCH',
      gmPhoneToken,
      `${path(boot.campaignId)}/${existing!.id}`,
      { pool: 12, visibility: 'gm' },
    );
    expect(patched.statusCode).toBe(200);
    const fromLaptop = await rack(boot.gmToken);
    expect(fromLaptop[0]).toMatchObject({ pool: 12, visibility: 'gm', limitValue: 5 });
    // A partial edit leaves the rest of the config alone.
    expect(fromLaptop[0]!.limitKind).toBe('accuracy');
    expect(fromLaptop[0]!.edge).toBe('push_pre');
  });

  it('clears a limit with an explicit null, and only what was named', async () => {
    const [existing] = await rack(boot.gmToken);
    const res = await send('PATCH', boot.gmToken, `${path(boot.campaignId)}/${existing!.id}`, {
      limitKind: null,
      limitValue: null,
    });
    expect(res.statusCode).toBe(200);
    const macro = (res.json() as { macro: MacroDto }).macro;
    expect(macro.limitKind).toBeUndefined();
    expect(macro.limitValue).toBeUndefined();
    // An omitted field is "leave it", a null is "remove it". The edge action
    // was neither, so it is still there.
    expect(macro.edge).toBe('push_pre');
    expect(macro.pool).toBe(12);
  });

  it('renames without making a second button', async () => {
    const [existing] = await rack(boot.gmToken);
    const res = await send('PATCH', gmPhoneToken, `${path(boot.campaignId)}/${existing!.id}`, {
      name: 'Full auto (narrow)',
    });
    expect(res.statusCode).toBe(200);
    const after = await rack(boot.gmToken);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: existing!.id, name: 'Full auto (narrow)', label: 'Full auto (narrow)' });
    // Put the label back so the rest of the suite reads as written.
    await send('PATCH', boot.gmToken, `${path(boot.campaignId)}/${existing!.id}`, {
      name: 'Full auto burst',
    });
  });

  it('a delete on the phone is a delete everywhere', async () => {
    const created = await send('POST', gmPhoneToken, path(boot.campaignId), {
      name: 'Throwaway',
      pool: 4,
    });
    const id = (created.json() as { macro: MacroDto }).macro.id;
    expect((await rack(boot.gmToken)).some((m) => m.id === id)).toBe(true);
    const deleted = await t.app.inject({
      method: 'DELETE',
      url: `${path(boot.campaignId)}/${id}`,
      headers: auth(gmPhoneToken),
    });
    expect(deleted.statusCode).toBe(200);
    expect((await rack(boot.gmToken)).some((m) => m.id === id)).toBe(false);
  });
});

describe('idempotent creation (the localStorage migration)', () => {
  it('POSTing the same label twice updates one row instead of making two', async () => {
    const before = (await rack(boot.gmToken)).length;
    const first = await send('POST', boot.gmToken, path(boot.campaignId), {
      name: 'Perception',
      pool: 8,
    });
    expect(first.statusCode).toBe(201);
    // The retry — a second phone pushing its leftover rack, or the first phone
    // retrying after a failed PUT. It is not a new button.
    const second = await send('POST', gmPhoneToken, path(boot.campaignId), {
      name: 'Perception',
      pool: 9,
    });
    expect(second.statusCode).toBe(200);
    expect((second.json() as { macro: MacroDto }).macro.id).toBe(
      (first.json() as { macro: MacroDto }).macro.id,
    );
    const after = await rack(boot.gmToken);
    expect(after.length).toBe(before + 1);
    expect(after.find((m) => m.name === 'Perception')!.pool).toBe(9);
  });

  it('PUT replaces the rack and collapses duplicate labels in one payload', async () => {
    const res = await send('PUT', boot.gmToken, path(boot.campaignId), {
      macros: [
        { id: 'm-local-1', name: 'Full auto burst', pool: 14 },
        { id: 'm-local-2', name: 'Sneaking', pool: 9, limitKind: 'physical', limitValue: 6 },
        // The same button from a second device, with its own client-side id.
        { id: 'm-other-9', name: 'Full auto burst', pool: 99 },
      ],
    });
    expect(res.statusCode).toBe(200);
    const macros = (res.json() as { macros: MacroDto[] }).macros;
    expect(macros.map((m) => m.name)).toEqual(['Full auto burst', 'Sneaking']);
    // First occurrence wins: the merged server list is sent ahead of the
    // device's leftovers, so the shared row survives, not the local copy.
    expect(macros[0]!.pool).toBe(14);
    expect(macros[1]).toMatchObject({ limitKind: 'physical', limitValue: 6, sortOrder: 1 });
    // Replace means replace — everything from the earlier tests is gone.
    expect(macros).toHaveLength(2);
    expect(await rack(gmPhoneToken)).toHaveLength(2);
    // Rack order is the payload's order, which is the order the player dragged
    // the buttons into on whichever device they were holding.
    expect(macros.map((m) => m.sortOrder)).toEqual([0, 1]);
  });

  it('PUT is safe to send twice', async () => {
    const payload = {
      macros: [
        { name: 'Full auto burst', pool: 14 },
        { name: 'Sneaking', pool: 9 },
      ],
    };
    await send('PUT', boot.gmToken, path(boot.campaignId), payload);
    const twice = await send('PUT', gmPhoneToken, path(boot.campaignId), payload);
    expect((twice.json() as { macros: MacroDto[] }).macros).toHaveLength(2);
  });

  it('an empty PUT clears the rack', async () => {
    const cleared = await send('PUT', boot.gmToken, path(boot.campaignId), { macros: [] });
    expect((cleared.json() as { macros: MacroDto[] }).macros).toEqual([]);
    await send('PUT', boot.gmToken, path(boot.campaignId), {
      macros: [{ name: 'Full auto burst', pool: 14 }],
    });
  });
});

describe('one rack per person', () => {
  it('a player does not see the GM’s macros', async () => {
    expect(await rack(boot.gmToken)).toHaveLength(1);
    const theirs = await get(player.token, path(boot.campaignId));
    expect(theirs.statusCode).toBe(200);
    expect((theirs.json() as { macros: MacroDto[] }).macros).toEqual([]);
  });

  it('two people may use the same label without colliding', async () => {
    const mine = await send('POST', player.token, path(boot.campaignId), {
      name: 'Full auto burst',
      pool: 11,
    });
    expect(mine.statusCode).toBe(201);
    expect((await rack(player.token))[0]!.pool).toBe(11);
    expect((await rack(boot.gmToken))[0]!.pool).toBe(14);
  });

  it('someone else’s macro id is a 404, not a read and not a write', async () => {
    const gmMacroId = (await rack(boot.gmToken))[0]!.id;
    const peek = await send('PATCH', player.token, `${path(boot.campaignId)}/${gmMacroId}`, {
      pool: 1,
    });
    expect(peek.statusCode).toBe(404);
    const wipe = await t.app.inject({
      method: 'DELETE',
      url: `${path(boot.campaignId)}/${gmMacroId}`,
      headers: auth(player.token),
    });
    expect(wipe.statusCode).toBe(404);
    // Untouched.
    expect((await rack(boot.gmToken))[0]!.pool).toBe(14);
  });

  it('a malformed macro id is a 404, not a driver error', async () => {
    const res = await send('PATCH', boot.gmToken, `${path(boot.campaignId)}/not-a-uuid`, {
      pool: 1,
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('guards', () => {
  it('requires a token', async () => {
    const res = await t.app.inject({ method: 'GET', url: path(boot.campaignId) });
    expect(res.statusCode).toBe(401);
  });

  it('refuses a campaign the device is not bound to', async () => {
    const res = await get(boot.gmToken, path('00000000-0000-4000-8000-000000000000'));
    expect(res.statusCode).toBe(403);
  });

  it('rejects a macro with no name', async () => {
    const res = await send('POST', boot.gmToken, path(boot.campaignId), { pool: 5 });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a pool that is not a die count', async () => {
    for (const pool of [-1, 4.5, 500]) {
      const res = await send('POST', boot.gmToken, path(boot.campaignId), { name: `p${pool}`, pool });
      expect(res.statusCode, `pool ${pool}`).toBe(400);
    }
  });

  it('caps the rack at 24 and says so', async () => {
    await send('PUT', boot.gmToken, path(boot.campaignId), {
      macros: Array.from({ length: 24 }, (_, i) => ({ name: `Macro ${i}`, pool: i + 1 })),
    });
    expect(await rack(boot.gmToken)).toHaveLength(24);
    const overflow = await send('POST', boot.gmToken, path(boot.campaignId), {
      name: 'One too many',
      pool: 3,
    });
    expect(overflow.statusCode).toBe(409);
    expect((overflow.json() as { error: { code: string } }).error.code).toBe('macro_limit');
    // The cap does not block an EDIT of something already in the rack.
    const edit = await send('POST', boot.gmToken, path(boot.campaignId), {
      name: 'Macro 0',
      pool: 7,
    });
    expect(edit.statusCode).toBe(200);
  });

  it('truncates an over-long PUT to the cap rather than failing the save', async () => {
    const res = await send('PUT', boot.gmToken, path(boot.campaignId), {
      macros: Array.from({ length: 40 }, (_, i) => ({ name: `Bulk ${i}`, pool: 1 })),
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { macros: MacroDto[] }).macros).toHaveLength(24);
  });
});
