/**
 * Characters API (M3): Chummer import over multipart, derived sheet with live
 * wound/scene state, revisions + rollback (FR3.8), flagged overrides (FR3.5),
 * and the live-play widgets (FR3.4/FR2.3/FR8.2).
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scenes } from '@safehouse/db';
import { makeTestApp, bootstrapCampaign, joinAs, type TestApp, type BootstrapResult, type JoinResult } from './core-helpers.js';

const FIXTURE = readFileSync(new URL('./fixtures/chummer-sample.chum5', import.meta.url), 'utf8');

/** Build a multipart/form-data body the way a browser upload arrives (FR3.1). */
function multipart(
  fields: Record<string, string>,
  file?: { field: string; filename: string; content: string },
): { payload: Buffer; headers: Record<string, string> } {
  const boundary = `----safehouse${Math.random().toString(16).slice(2)}`;
  const chunks: string[] = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`);
  }
  if (file) {
    chunks.push(
      `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\n` +
        `Content-Type: application/xml\r\n\r\n${file.content}\r\n`,
    );
  }
  chunks.push(`--${boundary}--\r\n`);
  return {
    payload: Buffer.from(chunks.join(''), 'utf8'),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

let t: TestApp;
let boot: BootstrapResult;
let player: JoinResult;
let characterId: string;
let gmCharacterId: string;

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

beforeAll(async () => {
  t = await makeTestApp('characters');
  boot = await bootstrapCampaign(t.app);
  player = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Rivet');
}, 120_000);

afterAll(async () => {
  await t.close();
}, 60_000);

describe('POST /api/characters — Chummer import (FR3.1)', () => {
  it('imports a .chum5 upload, stores the blob and seeds the ledger', async () => {
    const body = multipart(
      { campaignId: boot.campaignId, ownerUserId: player.user.id },
      { field: 'file', filename: 'rivet.chum5', content: FIXTURE },
    );
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/characters',
      headers: { ...auth(boot.gmToken), ...body.headers },
      payload: body.payload,
    });
    expect(res.statusCode).toBe(201);
    const out = res.json() as {
      character: { id: string; name: string; hasChummerBlob: boolean; balances: { karma: number; nuyen: number } };
      revision: number;
      report: { unmapped: string[] };
    };
    characterId = out.character.id;
    expect(out.character.name).toBe('Rivet');
    expect(out.character.hasChummerBlob).toBe(true);
    expect(out.revision).toBe(1);
    expect(out.report.unmapped).toContain('contacts');
    // Chummer's balances land in the ledger, approved because the GM imported.
    expect(out.character.balances).toMatchObject({ karma: 12, nuyen: 4500 });
  });

  it('creates a blank character from JSON too', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/characters',
      headers: auth(boot.gmToken),
      payload: { campaignId: boot.campaignId, name: 'Ghostline' },
    });
    expect(res.statusCode).toBe(201);
    gmCharacterId = (res.json() as { character: { id: string } }).character.id;
  });

  it('refuses a character in another campaign', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/characters',
      headers: auth(boot.gmToken),
      payload: { campaignId: '00000000-0000-0000-0000-000000000000', name: 'Nope' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('GET /api/characters/:id/derived (FR3.3/3.4)', () => {
  it('returns engine-derived pools, monitors and provenance', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/characters/${characterId}/derived`,
      headers: auth(player.token),
    });
    expect(res.statusCode).toBe(200);
    const view = res.json() as {
      derived: { pools: Record<string, { total: number; breakdown: unknown[] }>; limits: { physical: { value: number } } };
      monitors: { physical: { max: number; filled: number }; stun: { max: number } };
      edge: { max: number; current: number };
      woundSource: string;
      ammo: Record<string, { cap: number; current: number }>;
    };
    expect(view.derived.pools['skill.automatics']?.total).toBe(12);
    expect(view.derived.limits.physical.value).toBe(6);
    expect(view.monitors).toMatchObject({ physical: { max: 11, filled: 0 }, stun: { max: 10 } });
    expect(view.edge).toEqual({ max: 3, current: 3, burned: 0 });
    expect(view.woundSource).toBe('character');
    expect(view.ammo['Kestrel A4']).toEqual({ cap: 30, current: 30 });
  });

  it('lists characters for the campaign with ledger balances', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/campaigns/${boot.campaignId}/characters`,
      headers: auth(player.token),
    });
    expect(res.statusCode).toBe(200);
    const out = res.json() as { characters: Array<{ id: string; balances: { karma: number } }> };
    expect(out.characters).toHaveLength(2);
    expect(out.characters.find((c) => c.id === characterId)?.balances.karma).toBe(12);
  });
});

describe('PATCH + revisions + rollback (FR3.8)', () => {
  it('snapshots a revision on every accepted mutation', async () => {
    const res = await t.app.inject({
      method: 'PATCH',
      url: `/api/characters/${characterId}`,
      headers: auth(player.token),
      payload: {
        cause: 'karma spend: Automatics 6→7',
        sheet: {
          skills: [
            { id: 'automatics', rating: 7, attr: 'agi' },
            { id: 'perception', rating: 3, attr: 'int' },
          ],
        },
      },
    });
    expect(res.statusCode).toBe(200);
    const out = res.json() as { revision: number; character: { sheet: { skills: Array<{ rating: number }> } } };
    expect(out.revision).toBe(2);
    expect(out.character.sheet.skills[0]?.rating).toBe(7);

    const list = await t.app.inject({
      method: 'GET',
      url: `/api/characters/${characterId}/revisions`,
      headers: auth(player.token),
    });
    const revisions = (list.json() as { revisions: Array<{ seq: number; cause: string }> }).revisions;
    expect(revisions.map((r) => r.seq)).toEqual([1, 2]);
    expect(revisions[0]?.cause).toBe('chummer import');
    expect(revisions[1]?.cause).toBe('karma spend: Automatics 6→7');
  });

  it('rolls back to an earlier revision, appending history rather than erasing it', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/characters/${characterId}/rollback`,
      headers: auth(boot.gmToken),
      payload: { seq: 1 },
    });
    expect(res.statusCode).toBe(200);
    const out = res.json() as { revision: number; rolledBackTo: number };
    expect(out).toMatchObject({ revision: 3, rolledBackTo: 1 });

    const derived = await t.app.inject({
      method: 'GET',
      url: `/api/characters/${characterId}/derived`,
      headers: auth(player.token),
    });
    const view = derived.json() as { derived: { pools: Record<string, { total: number }> } };
    expect(view.derived.pools['skill.automatics']?.total).toBe(12);
    expect(view.derived.pools['skill.sneaking']?.total).toBe(9);
  });

  it('404s an unknown revision', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/characters/${characterId}/rollback`,
      headers: auth(boot.gmToken),
      payload: { seq: 99 },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('overrides are owner-or-GM and visibly flagged (FR3.5, Principle 2/3)', () => {
  let overrideId: string;

  it('applies an override and shows it in the pool provenance', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/characters/${characterId}/overrides`,
      headers: auth(player.token),
      payload: { target: 'pool.skill.automatics', op: 'add', value: 2, note: 'house rule: braced' },
    });
    expect(res.statusCode).toBe(201);
    const out = res.json() as {
      override: { id: string; source: { kind: string } };
      derived: {
        overrides: Array<{ id: string }>;
        derived: { pools: Record<string, { total: number; breakdown: Array<{ label: string; source?: string }> }> };
      };
    };
    overrideId = out.override.id;
    expect(out.override.source.kind).toBe('override');
    expect(out.derived.overrides).toHaveLength(1);
    const pool = out.derived.derived.pools['skill.automatics'];
    expect(pool?.total).toBe(14);
    expect(pool?.breakdown.at(-1)).toMatchObject({ label: 'house rule: braced', source: 'override' });
  });

  it('refuses overrides from someone who owns neither the sheet nor the table', async () => {
    const other = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Nomad');
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/characters/${characterId}/overrides`,
      headers: auth(other.token),
      payload: { target: 'pool.all', value: 5 },
    });
    expect(res.statusCode).toBe(403);
  });

  it('removes an override', async () => {
    const res = await t.app.inject({
      method: 'DELETE',
      url: `/api/characters/${characterId}/overrides/${overrideId}`,
      headers: auth(boot.gmToken),
    });
    expect(res.statusCode).toBe(200);
    const out = res.json() as { derived: { derived: { pools: Record<string, { total: number }> } } };
    expect(out.derived.derived.pools['skill.automatics']?.total).toBe(12);
  });
});

describe('live-play widgets (FR3.4)', () => {
  it('applies damage, propagates wound modifiers, and heals back', async () => {
    const hit = await t.app.inject({
      method: 'POST',
      url: `/api/characters/${characterId}/damage`,
      headers: auth(boot.gmToken),
      payload: { monitor: 'physical', boxes: 6, note: 'burst, centre mass' },
    });
    expect(hit.statusCode).toBe(200);
    const out = hit.json() as {
      monitors: { physical: { filled: number } };
      woundModifier: { after: number };
      derived: { derived: { pools: Record<string, { total: number }> }; monitors: { physical: { filled: number } } };
    };
    expect(out.monitors.physical.filled).toBe(6);
    expect(out.woundModifier.after).toBe(-2);
    // −1 per 3 boxes flows straight into every pool (§10.2).
    expect(out.derived.derived.pools['skill.automatics']?.total).toBe(10);
    expect(out.derived.derived.pools['soak']?.total).toBe(17);

    const healed = await t.app.inject({
      method: 'POST',
      url: `/api/characters/${characterId}/damage`,
      headers: auth(player.token),
      payload: { monitor: 'physical', boxes: 6, op: 'heal' },
    });
    const back = healed.json() as { derived: { derived: { pools: Record<string, { total: number }> } } };
    expect(back.derived.derived.pools['skill.automatics']?.total).toBe(12);
  });

  it('spends Edge, and burning it is loud and permanent', async () => {
    const spend = await t.app.inject({
      method: 'POST',
      url: `/api/characters/${characterId}/edge`,
      headers: auth(player.token),
      payload: { op: 'spend', amount: 1, reason: 'Push the Limit' },
    });
    // Spending is live-play state, not a change to the character — no revision.
    expect(spend.json()).toMatchObject({ edge: { max: 3, current: 2 }, revision: null });

    const burn = await t.app.inject({
      method: 'POST',
      url: `/api/characters/${characterId}/edge`,
      headers: auth(player.token),
      payload: { op: 'burn', amount: 1, reason: 'not dying today' },
    });
    const burned = burn.json() as { edge: { max: number; current: number }; burned: number; revision: number };
    expect(burned.edge).toEqual({ max: 2, current: 1 });
    expect(burned.burned).toBe(1);
    // Permanent → it snapshots a revision; spending does not.
    expect(burned.revision).toBeGreaterThan(0);

    const broke = await t.app.inject({
      method: 'POST',
      url: `/api/characters/${characterId}/edge`,
      headers: auth(player.token),
      payload: { op: 'spend', amount: 9 },
    });
    expect(broke.statusCode).toBe(400);
    expect((broke.json() as { error: { code: string } }).error.code).toBe('insufficient_edge');

    await t.app.inject({
      method: 'POST',
      url: `/api/characters/${characterId}/edge`,
      headers: auth(player.token),
      payload: { op: 'refresh' },
    });
  });

  it('tracks ammo and the progressive recoil counter per weapon', async () => {
    const fired = await t.app.inject({
      method: 'POST',
      url: `/api/characters/${characterId}/ammo`,
      headers: auth(player.token),
      payload: { weapon: 'kestrel a4', op: 'fire', rounds: 3 },
    });
    expect(fired.json()).toMatchObject({
      weapon: 'Kestrel A4',
      ammo: { cap: 30, current: 27 },
      recoil: 3,
      recoilComp: 2,
      modifier: -1,
    });

    const more = await t.app.inject({
      method: 'POST',
      url: `/api/characters/${characterId}/recoil`,
      headers: auth(player.token),
      payload: { weapon: 'Kestrel A4', op: 'add', amount: 3 },
    });
    expect(more.json()).toMatchObject({ recoil: 6, modifier: -4 });

    const reloaded = await t.app.inject({
      method: 'POST',
      url: `/api/characters/${characterId}/ammo`,
      headers: auth(player.token),
      payload: { weapon: 'Kestrel A4', op: 'reload' },
    });
    expect(reloaded.json()).toMatchObject({ ammo: { current: 30 }, recoil: 0, modifier: 0 });

    const melee = await t.app.inject({
      method: 'POST',
      url: `/api/characters/${characterId}/ammo`,
      headers: auth(player.token),
      payload: { weapon: 'Sliver Knife', op: 'fire' },
    });
    expect(melee.statusCode).toBe(400);
  });

  it('sustained spells cost −2 each until dropped or focus-exempted (FR8.2)', async () => {
    const first = await t.app.inject({
      method: 'POST',
      url: `/api/characters/${characterId}/sustained`,
      headers: auth(player.token),
      payload: { op: 'add', id: 'sust-1', name: 'Wired Sight' },
    });
    let view = first.json() as {
      sustained: Array<{ id: string }>;
      derived: { derived: { pools: Record<string, { total: number }> } };
    };
    expect(view.derived.derived.pools['skill.automatics']?.total).toBe(10);

    const second = await t.app.inject({
      method: 'POST',
      url: `/api/characters/${characterId}/sustained`,
      headers: auth(player.token),
      payload: { op: 'add', id: 'sust-2', name: 'Static Veil' },
    });
    view = second.json() as typeof view;
    expect(view.derived.derived.pools['skill.automatics']?.total).toBe(8);

    const exempt = await t.app.inject({
      method: 'POST',
      url: `/api/characters/${characterId}/sustained`,
      headers: auth(player.token),
      payload: { op: 'toggle', id: 'sust-2', exempt: true },
    });
    view = exempt.json() as typeof view;
    expect(view.derived.derived.pools['skill.automatics']?.total).toBe(10);

    const cleared = await t.app.inject({
      method: 'POST',
      url: `/api/characters/${characterId}/sustained`,
      headers: auth(player.token),
      payload: { op: 'clear' },
    });
    view = cleared.json() as typeof view;
    expect(view.sustained).toEqual([]);
    expect(view.derived.derived.pools['skill.automatics']?.total).toBe(12);
  });
});

describe('permissions (§13)', () => {
  it("a player cannot mutate someone else's sheet but can read it", async () => {
    const read = await t.app.inject({
      method: 'GET',
      url: `/api/characters/${gmCharacterId}`,
      headers: auth(player.token),
    });
    expect(read.statusCode).toBe(200);
    const write = await t.app.inject({
      method: 'PATCH',
      url: `/api/characters/${gmCharacterId}`,
      headers: auth(player.token),
      payload: { name: 'Mine now' },
    });
    expect(write.statusCode).toBe(403);
  });

  it('an observer may not damage a character', async () => {
    const observer = await joinAs(t.app, boot.campaignId, boot.gmToken, 'observer', 'Bystander');
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/characters/${characterId}/damage`,
      headers: auth(observer.token),
      payload: { monitor: 'stun', boxes: 3 },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects unauthenticated access', async () => {
    const res = await t.app.inject({ method: 'GET', url: `/api/characters/${characterId}` });
    expect(res.statusCode).toBe(401);
  });
});

describe('re-import shows a diff before overwriting (FR3.1)', () => {
  const bumped = FIXTURE.replace(
    /<name>AGI<\/name>[\s\S]*?<totalvalue>6<\/totalvalue>/,
    (block) => block.replace('<base>5</base>', '<base>6</base>').replace('<totalvalue>6</totalvalue>', '<totalvalue>7</totalvalue>'),
  );

  it('returns the diff and changes nothing without confirm', async () => {
    const body = multipart({}, { field: 'file', filename: 'rivet.chum5', content: bumped });
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/characters/${characterId}/import`,
      headers: { ...auth(player.token), ...body.headers },
      payload: body.payload,
    });
    expect(res.statusCode).toBe(200);
    const out = res.json() as { applied: boolean; diff: Array<Record<string, unknown>> };
    expect(out.applied).toBe(false);
    expect(out.diff).toContainEqual({ path: 'attributes.agi', op: 'changed', from: 6, to: 7 });

    const derived = await t.app.inject({
      method: 'GET',
      url: `/api/characters/${characterId}/derived`,
      headers: auth(player.token),
    });
    const view = derived.json() as { derived: { attributes: Record<string, { value: number }> } };
    expect(view.derived.attributes['agi']?.value).toBe(6);
  });

  it('applies with confirm=true and snapshots a revision', async () => {
    const body = multipart({ confirm: 'true' }, { field: 'file', filename: 'rivet.chum5', content: bumped });
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/characters/${characterId}/import`,
      headers: { ...auth(player.token), ...body.headers },
      payload: body.payload,
    });
    const out = res.json() as { applied: boolean; revision: number };
    expect(out.applied).toBe(true);
    expect(out.revision).toBeGreaterThan(4);

    const derived = await t.app.inject({
      method: 'GET',
      url: `/api/characters/${characterId}/derived`,
      headers: auth(player.token),
    });
    const view = derived.json() as {
      derived: { attributes: Record<string, { value: number }>; pools: Record<string, { total: number }> };
    };
    expect(view.derived.attributes['agi']?.value).toBe(7);
    expect(view.derived.pools['skill.automatics']?.total).toBe(13);
  });
});

describe('the active scene feeds every pool (FR9.11)', () => {
  it('injects the scene environment as a situational modifier with provenance', async () => {
    await t.db.insert(scenes).values({
      campaignId: boot.campaignId,
      name: 'Dockside — blackout',
      state: 'active',
      grid: { unitM: 1, cols: 40, rows: 40, offset: { x: 0, y: 0 }, projection: 'topdown' as const },
      environment: { light: 3, visibility: 0, glare: 0, wind: 0 },
    });
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/characters/${characterId}/derived`,
      headers: auth(player.token),
    });
    const view = res.json() as {
      activeSceneId: string | null;
      situational: Array<{ source: { kind: string }; value: number }>;
      derived: { attributes: Record<string, { value: number }>; pools: Record<string, { total: number; breakdown: Array<{ source?: string }> }> };
    };
    expect(view.activeSceneId).not.toBeNull();
    expect(view.situational[0]).toMatchObject({ source: { kind: 'scene' }, value: -6 });
    const agi = view.derived.attributes['agi']?.value ?? 0;
    // AGI + Automatics 6, then the scene's −6.
    expect(view.derived.pools['skill.automatics']?.total).toBe(agi + 6 - 6);
    expect(view.derived.pools['skill.automatics']?.breakdown.some((b) => b.source === 'scene')).toBe(true);
    // Soak stays exempt from pool.all penalties.
    expect(view.derived.pools['soak']?.total).toBe(17);
  });
});
