/**
 * Starting a fight from a scene's tokens (FR9.10) brings BODIES to the
 * tracker, not names.
 *
 * A GM places gangers on the map from an archetype long before the fight.
 * The archetype is generation ranges, so staging it used to produce a row
 * with 0+1d6 and ten boxes — a fight that could not be run without hand-
 * editing every NPC. Staging now rolls one body per token through the same
 * engine the encounter builder uses, seeded by the token, so the row has a
 * real initiative line, real monitors and a copilot rack, and staging the
 * same token again is the same ganger.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCampaign, makeTestApp, type BootstrapResult, type TestApp } from './core-helpers.js';

let t: TestApp;
let boot: BootstrapResult;
let sceneId: string;
let archetypeId: string;

interface Row {
  id: string;
  name: string;
  source: string;
  initBase: number;
  initDice: number;
  visibility: string;
  monitors: { physical: { max: number }; stun: { max: number } };
  copilot?: Record<string, unknown>;
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}
async function gm<T = Record<string, any>>(method: 'GET' | 'POST', url: string, payload?: unknown): Promise<T> {
  const res = await t.app.inject({ method, url, headers: auth(boot.gmToken), ...(payload ? { payload: payload as object } : {}) });
  if (res.statusCode >= 400) throw new Error(`${method} ${url} → ${res.statusCode} ${res.body}`);
  return res.json() as T;
}
async function stageFight(name: string): Promise<Row[]> {
  const staged = await gm('POST', `/api/scenes/${sceneId}/stage-encounter`, { name });
  const view = await gm('GET', `/api/encounters/${staged['encounterId']}`);
  return view['combatants'] as Row[];
}

beforeAll(async () => {
  t = await makeTestApp('fight-from-scene');
  boot = await bootstrapCampaign(t.app, 'Pier 23');
  const scene = await gm('POST', `/api/campaigns/${boot.campaignId}/scenes`, { name: 'Warehouse floor' });
  sceneId = scene['scene'].id;
  // The starter library ships with the campaign; any tiered archetype will do.
  const templates = await gm<{ templates: Array<{ id: string; name: string; gen?: { tiers?: { id: string }[] } }> }>(
    'GET',
    `/api/campaigns/${boot.campaignId}/npc-templates`,
  );
  const tiered = templates.templates.find((x) => (x.gen?.tiers?.length ?? 0) > 0);
  if (!tiered) throw new Error('the starter library has no tiered archetype to stage from');
  archetypeId = tiered.id;
}, 180_000);

afterAll(async () => {
  await t.close();
});

describe('an NPC token placed from an archetype', () => {
  it('stages as a rolled body: an initiative line, monitors from the sheet, and a rack', async () => {
    await gm('POST', `/api/scenes/${sceneId}/tokens`, {
      source: 'npc_template',
      sourceId: archetypeId,
      name: 'Ganger — west aisle',
      x: 12,
      y: 6,
      hidden: true,
    });
    const rows = await stageFight('The ambush');
    const ganger = rows.find((r) => r.name === 'Ganger — west aisle');
    expect(ganger).toBeDefined();
    // REA + INT of a rolled body, never the 0 of an unrolled one.
    expect(ganger!.initBase).toBeGreaterThanOrEqual(2);
    expect(ganger!.initDice).toBeGreaterThanOrEqual(1);
    expect(ganger!.visibility).toBe('gm');
    // The copilot sheet and the generator receipt are what give the row a rack
    // and let the builder's levers re-roll it later.
    const copilot = ganger!.copilot ?? {};
    expect((copilot['generator'] as { templateId?: string } | undefined)?.templateId).toBe(archetypeId);
    expect(copilot['sheet']).toBeDefined();
  });

  it('is the same body every time the token is staged', async () => {
    const first = (await stageFight('Take one')).find((r) => r.name === 'Ganger — west aisle')!;
    const second = (await stageFight('Take two')).find((r) => r.name === 'Ganger — west aisle')!;
    expect(second.initBase).toBe(first.initBase);
    expect(second.initDice).toBe(first.initDice);
    expect(second.monitors).toEqual(first.monitors);
    const seed = (c: Row) => (c.copilot?.['generator'] as { seed?: number } | undefined)?.seed;
    expect(seed(second)).toBe(seed(first));
  });

  it('a template that is a full statblock derives straight from it', async () => {
    const made = await gm('POST', `/api/campaigns/${boot.campaignId}/npc-templates`, {
      name: 'Dock bruiser',
      statblock: {
        v: 1,
        identity: { alias: 'Dock bruiser' },
        attributes: { bod: 6, agi: 3, rea: 4, str: 6, wil: 3, log: 2, int: 3, cha: 2, edg: { max: 2, current: 2 }, ess: 6 },
        skills: [{ id: 'clubs', rating: 4, attr: 'agi' }],
      },
    });
    await gm('POST', `/api/scenes/${sceneId}/tokens`, {
      source: 'npc_template',
      sourceId: made['template'].id,
      name: 'Bruiser at the door',
      x: 20,
      y: 10,
    });
    const rows = await stageFight('Take three');
    const bruiser = rows.find((r) => r.name === 'Bruiser at the door')!;
    expect(bruiser.initBase).toBe(7); // REA 4 + INT 3
    expect(bruiser.initDice).toBe(1);
    expect(bruiser.monitors.physical.max).toBe(11); // 8 + ceil(6/2)
    expect(bruiser.visibility).toBe('public');
  });
});
