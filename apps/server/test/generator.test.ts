/**
 * M10 generator suite (FR10.1–10.4): templates CRUD, seeded generation
 * (same seed → identical squad), field locks, promote roundtrip, and the
 * encounter builder with scene staging.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { campaigns, combatants, scenes, tokens } from '@safehouse/db';
import { bootstrapCampaign, joinAs, makeTestApp, type TestApp } from './core-helpers.js';

/**
 * An ORIGINAL archetype template (§14: no book stat blocks anywhere). Two
 * tiers with GM-editable labels, per-tier ranges, and loadout slots that
 * resolve against the template's own statblock records (FR10.1).
 */
const TEMPLATE = {
  name: 'Dock Enforcer',
  statblock: {
    weapons: [
      { name: 'Snub Revolver', skillId: 'firearms', acc: 5, dv: '7P', ap: 0, modes: ['SS'] },
      { name: 'Riot Baton', skillId: 'clubs', acc: 4, dv: '6S', ap: 0 },
    ],
    armor: [{ name: 'Dock Vest', rating: 9, worn: true }],
    gear: [{ name: 'Commlink', qty: 1 }],
  },
  gen: {
    roleTags: ['muscle', 'ganger'],
    tiers: [
      {
        id: 'street',
        label: 'Street',
        attributes: {
          bod: { min: 3, max: 5 },
          agi: { min: 3, max: 5 },
          rea: { min: 2, max: 4 },
          int: { min: 2, max: 4 },
        },
        skills: { firearms: { min: 2, max: 4 }, clubs: { min: 2, max: 4 } },
        professionalRating: { min: 1, max: 2 },
        metatypeWeights: { human: 3, ork: 2 },
        loadout: [
          { slot: 'primary', options: ['Snub Revolver', 'Riot Baton'] },
          { slot: 'armor', options: ['Dock Vest'] },
          { slot: 'utility', options: ['Commlink'] },
        ],
      },
      {
        id: 'pro',
        label: 'Professional',
        attributes: {
          bod: { min: 5, max: 6 },
          agi: { min: 5, max: 6 },
          rea: { min: 4, max: 5 },
          int: { min: 3, max: 5 },
        },
        skills: { firearms: { min: 5, max: 6 }, clubs: { min: 4, max: 5 } },
        professionalRating: { min: 3, max: 4 },
        loadout: [
          { slot: 'primary', options: ['Snub Revolver'] },
          { slot: 'armor', options: ['Dock Vest'] },
        ],
      },
    ],
  },
} as const;

let t: TestApp;
let campaignId: string;
let gmToken: string;
let gmUserId: string;
let templateId: string;

const gm = (): { authorization: string } => ({ authorization: `Bearer ${gmToken}` });

beforeAll(async () => {
  t = await makeTestApp('generator');
  const boot = await bootstrapCampaign(t.app, 'Dockside');
  campaignId = boot.campaignId;
  gmToken = boot.gmToken;
  gmUserId = boot.gmUserId;
  const res = await t.app.inject({
    method: 'POST',
    url: `/api/campaigns/${campaignId}/npc-templates`,
    headers: gm(),
    payload: TEMPLATE,
  });
  expect(res.statusCode).toBe(201);
  templateId = (res.json() as { template: { id: string } }).template.id;
});

afterAll(async () => {
  await t.close();
});

describe('npc_templates CRUD (FR10.1)', () => {
  it('lists, patches and deletes templates; tier labels are editable data', async () => {
    const list = await t.app.inject({
      method: 'GET',
      url: `/api/campaigns/${campaignId}/npc-templates`,
      headers: gm(),
    });
    expect(list.statusCode).toBe(200);
    const { templates } = list.json() as { templates: Array<{ id: string; gen: unknown }> };
    expect(templates.map((x) => x.id)).toContain(templateId);

    const patched = await t.app.inject({
      method: 'PATCH',
      url: `/api/npc-templates/${templateId}`,
      headers: gm(),
      payload: { name: 'Dock Enforcer (rev 2)' },
    });
    expect(patched.statusCode).toBe(200);
    expect((patched.json() as { template: { name: string } }).template.name).toBe(
      'Dock Enforcer (rev 2)',
    );

    const created = await t.app.inject({
      method: 'POST',
      url: `/api/campaigns/${campaignId}/npc-templates`,
      headers: gm(),
      payload: { name: 'Throwaway', gen: TEMPLATE.gen },
    });
    const throwawayId = (created.json() as { template: { id: string } }).template.id;
    const deleted = await t.app.inject({
      method: 'DELETE',
      url: `/api/npc-templates/${throwawayId}`,
      headers: gm(),
    });
    expect(deleted.statusCode).toBe(204);
    const gone = await t.app.inject({
      method: 'GET',
      url: `/api/npc-templates/${throwawayId}`,
      headers: gm(),
    });
    expect(gone.statusCode).toBe(404);
  });

  it('is GM-only prep material (Principle 4)', async () => {
    const player = await joinAs(t.app, campaignId, gmToken, 'player', 'Static');
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/campaigns/${campaignId}/npc-templates`,
      headers: { authorization: `Bearer ${player.token}` },
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: { code: string } }).error.code).toBe('forbidden');
  });
});

describe('generation is seeded (FR10.2)', () => {
  const genNpc = async (payload: Record<string, unknown>) =>
    t.app.inject({ method: 'POST', url: '/api/generator/npc', headers: gm(), payload });

  it('same seed → identical NPC, and the seed comes back for reroll', async () => {
    const a = await genNpc({ templateId, tierId: 'street', seed: 987654 });
    const b = await genNpc({ templateId, tier: 'street', seed: 987654 });
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    const one = a.json() as { seed: number; npc: unknown };
    const two = b.json() as { seed: number; npc: unknown };
    expect(one.npc).toEqual(two.npc);
    expect(one.seed).toBe(two.seed);

    const other = await genNpc({ templateId, tierId: 'street', seed: 24680 });
    expect((other.json() as { npc: unknown }).npc).not.toEqual(one.npc);
  });

  it('generates a playable sheet inside the tier ranges', async () => {
    const res = await genNpc({ templateId, tierId: 'pro', seed: 5150 });
    const { npc } = res.json() as {
      npc: {
        professionalRating: number;
        sheet: { attributes: Record<string, number>; skills: Array<{ id: string; rating: number }> };
        monitors: { physical: number; stun: number };
        loadout: Record<string, string[]>;
      };
    };
    expect(npc.sheet.attributes['bod']).toBeGreaterThanOrEqual(5);
    expect(npc.sheet.attributes['bod']).toBeLessThanOrEqual(6);
    const firearms = npc.sheet.skills.find((s) => s.id === 'firearms');
    expect(firearms?.rating).toBeGreaterThanOrEqual(5);
    expect(npc.professionalRating).toBeGreaterThanOrEqual(3);
    expect(npc.monitors.physical).toBeGreaterThan(0);
    expect(npc.loadout['primary']).toEqual(['Snub Revolver']);
  });

  it('locks keep the stats and reroll the names', async () => {
    const prev = (
      await genNpc({ templateId, tierId: 'street', seed: 1111 })
    ).json() as { npc: { sheet: { attributes: unknown; skills: unknown }; name: string } };
    const fresh = (
      await genNpc({ templateId, tierId: 'street', seed: 2222 })
    ).json() as { npc: { name: string; sheet: { attributes: unknown } } };
    const locked = (
      await genNpc({
        templateId,
        tierId: 'street',
        seed: 2222,
        prevSeed: 1111,
        locks: ['stats', 'metatype'],
      })
    ).json() as { npc: { name: string; sheet: { attributes: unknown; skills: unknown } } };

    expect(locked.npc.sheet.attributes).toEqual(prev.npc.sheet.attributes);
    expect(locked.npc.sheet.skills).toEqual(prev.npc.sheet.skills);
    expect(locked.npc.name).toBe(fresh.npc.name);
  });

  it('rejects locks without prevSeed and unknown lock aspects', async () => {
    const noPrev = await genNpc({ templateId, tierId: 'street', seed: 3, locks: ['stats'] });
    expect(noPrev.statusCode).toBe(400);
    const bogus = await genNpc({
      templateId,
      tierId: 'street',
      seed: 3,
      prevSeed: 4,
      locks: ['soul'],
    });
    expect(bogus.statusCode).toBe(400);
  });

  it('same seed → identical grunt squad, one statblock and N faces', async () => {
    const payload = { templateId, tierId: 'street', size: 5, seed: 424242 };
    const a = await t.app.inject({
      method: 'POST',
      url: '/api/generator/group',
      headers: gm(),
      payload,
    });
    const b = await t.app.inject({
      method: 'POST',
      url: '/api/generator/group',
      headers: gm(),
      payload,
    });
    const one = a.json() as {
      seed: number;
      group: { statblock: unknown; members: Array<{ name: string }> };
    };
    const two = b.json() as { group: { statblock: unknown; members: Array<{ name: string }> } };
    expect(one.group).toEqual(two.group);
    expect(one.group.members).toHaveLength(5);
    expect(one.group.members.map((m) => m.name)).toEqual(two.group.members.map((m) => m.name));
    expect(one.seed).toBeTypeOf('number');
  });
});

describe('promote roundtrip (FR10.3)', () => {
  it('promotes a generated NPC into a template whose sheet regenerates identically', async () => {
    const rolled = (
      await t.app.inject({
        method: 'POST',
        url: '/api/generator/npc',
        headers: gm(),
        payload: { templateId, tierId: 'pro', seed: 777001 },
      })
    ).json() as { seed: number; npc: { name: string; sheet: unknown; persona: unknown } };

    const promoted = await t.app.inject({
      method: 'POST',
      url: '/api/generator/promote',
      headers: gm(),
      payload: { templateId, tierId: 'pro', seed: rolled.seed },
    });
    expect(promoted.statusCode).toBe(201);
    const { template } = promoted.json() as {
      template: { id: string; name: string; statblock: unknown; persona: unknown };
    };
    expect(template.name).toBe(rolled.npc.name);
    expect(template.statblock).toEqual(rolled.npc.sheet);
    expect(template.persona).toEqual(rolled.npc.persona);

    // Round-trips: the promoted template kept the gen params, so rolling the
    // same tier + seed off it reproduces the same NPC.
    const again = (
      await t.app.inject({
        method: 'POST',
        url: '/api/generator/npc',
        headers: gm(),
        payload: { templateId: template.id, tierId: 'pro', seed: rolled.seed },
      })
    ).json() as { npc: { sheet: unknown } };
    expect(again.npc.sheet).toEqual(rolled.npc.sheet);

    // ...and the promoted row is a normal template: fetch + edit still work.
    const fetched = await t.app.inject({
      method: 'GET',
      url: `/api/npc-templates/${template.id}`,
      headers: gm(),
    });
    expect(fetched.statusCode).toBe(200);
    expect((fetched.json() as { template: { statblock: unknown } }).template.statblock).toEqual(
      rolled.npc.sheet,
    );
  });

  it('a GM-edited statblock wins over the roll (edits round-trip)', async () => {
    const rolled = (
      await t.app.inject({
        method: 'POST',
        url: '/api/generator/npc',
        headers: gm(),
        payload: { templateId, tierId: 'street', seed: 909 },
      })
    ).json() as { seed: number; npc: { sheet: { identity: { alias: string } } } };
    const edited = {
      ...rolled.npc.sheet,
      identity: { ...rolled.npc.sheet.identity, alias: 'Hand-tuned Bruiser' },
    };
    const promoted = await t.app.inject({
      method: 'POST',
      url: '/api/generator/promote',
      headers: gm(),
      payload: {
        templateId,
        tierId: 'street',
        seed: rolled.seed,
        name: 'Hand-tuned Bruiser',
        statblock: edited,
      },
    });
    expect(promoted.statusCode).toBe(201);
    const { template } = promoted.json() as {
      template: { statblock: { identity: { alias: string } } };
    };
    expect(template.statblock.identity.alias).toBe('Hand-tuned Bruiser');
  });
});

describe('encounter builder (FR10.4)', () => {
  it('builds a prep encounter and stages hidden tokens on the linked scene', async () => {
    const scene = (
      await t.db.insert(scenes).values({ campaignId, name: 'Pier 41' }).returning()
    )[0]!;

    const res = await t.app.inject({
      method: 'POST',
      url: '/api/encounters/build',
      headers: gm(),
      payload: {
        campaignId,
        sceneId: scene.id,
        name: 'Pier ambush',
        parts: [
          { templateId, tierId: 'pro', count: 2, seed: 31337 },
          { templateId, tierId: 'street', size: 4, seed: 4242 },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      encounter: { id: string; state: string; sceneId: string };
      combatants: Array<{
        id: string;
        name: string;
        source: string;
        visibility: string;
        initBase: number;
        tokenId: string | null;
      }>;
      tokens: Array<{ id: string; hidden: boolean; sceneId: string }>;
      parts: Array<{ kind: string; seed: number }>;
    };
    expect(body.encounter.state).toBe('prep');
    expect(body.encounter.sceneId).toBe(scene.id);
    expect(body.combatants).toHaveLength(3); // 2 NPCs + 1 grunt-group row
    expect(body.combatants.filter((c) => c.source === 'generated')).toHaveLength(2);
    expect(body.combatants.filter((c) => c.source === 'grunt_group')).toHaveLength(1);
    expect(body.combatants.every((c) => c.visibility === 'gm')).toBe(true);
    expect(body.combatants.every((c) => typeof c.tokenId === 'string')).toBe(true);
    expect(body.tokens).toHaveLength(3);
    expect(body.tokens.every((tk) => tk.hidden)).toBe(true);
    expect(body.parts.map((p) => p.kind)).toEqual(['npc', 'gruntGroup']);

    const rows = await t.db
      .select()
      .from(combatants)
      .where(eq(combatants.encounterId, body.encounter.id));
    expect(rows).toHaveLength(3);
    const staged = await t.db.select().from(tokens).where(eq(tokens.sceneId, scene.id));
    expect(staged).toHaveLength(3);

    // Same seeds → the identical squad again (reroll-identical, FR10.2).
    const rebuilt = await t.app.inject({
      method: 'POST',
      url: '/api/encounters/build',
      headers: gm(),
      payload: {
        campaignId,
        name: 'Pier ambush (take 2)',
        parts: [
          { templateId, tierId: 'pro', count: 2, seed: 31337 },
          { templateId, tierId: 'street', size: 4, seed: 4242 },
        ],
      },
    });
    const second = rebuilt.json() as {
      combatants: Array<{ name: string; monitors: unknown; initBase: number }>;
      tokens: unknown[];
    };
    expect(second.tokens).toHaveLength(0); // no scene → nothing staged
    expect(second.combatants.map((c) => c.name)).toEqual(body.combatants.map((c) => c.name));
    expect(second.combatants.map((c) => c.initBase)).toEqual(
      body.combatants.map((c) => c.initBase),
    );
  });

  it('refuses a scene from another campaign', async () => {
    const other = (
      await t.db.insert(campaigns).values({ name: 'Other Table', gmUserId }).returning()
    )[0]!;
    const foreign = (
      await t.db.insert(scenes).values({ campaignId: other.id, name: 'Elsewhere' }).returning()
    )[0]!;
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/encounters/build',
      headers: gm(),
      payload: {
        campaignId,
        sceneId: foreign.id,
        name: 'Nope',
        parts: [{ templateId, tierId: 'street', count: 1 }],
      },
    });
    expect(res.statusCode).toBe(400);
  });
});
