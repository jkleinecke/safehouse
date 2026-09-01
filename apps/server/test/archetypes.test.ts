/**
 * Starter archetype library (M10 cold start, FR10.1 / G9).
 *
 * The bug this suite pins down: a GM who created their own campaign opened the
 * NPC generator on an empty dropdown, because the only archetypes in the repo
 * were seeded into the demo campaign. The library has to be installable into
 * ANY campaign, idempotently, and what it installs has to be indistinguishable
 * from a hand-authored template afterwards.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { npcTemplates, wsEvents } from '@safehouse/db';
import { bootstrapCampaign, joinAs, makeTestApp, type TestApp } from './core-helpers.js';
import {
  installStarterArchetypes,
  starterCatalogue,
  starterIdOf,
} from '../src/services/archetypes.js';

interface LibraryEntry {
  id: string;
  name: string;
  summary: string;
  roleTags: string[];
  tiers: Array<{ id: string; label: string }>;
  installed: boolean;
  templateId: string | null;
  installedAs: string | null;
}

interface TemplateRow {
  id: string;
  name: string;
  gen: { roleTags?: string[]; tiers?: Array<{ id: string; label: string }>; starterId?: string };
}

let t: TestApp;
let campaignId: string;
let gmToken: string;

const gm = (token = gmToken): { authorization: string } => ({ authorization: `Bearer ${token}` });

/** A further campaign for the same GM (the unauthenticated bootstrap is one-shot). */
async function newCampaign(name: string): Promise<{ campaignId: string; token: string }> {
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/campaigns',
    headers: gm(),
    payload: { name },
  });
  expect(res.statusCode).toBe(201);
  const body = res.json() as { campaignId: string; token: string };
  return { campaignId: body.campaignId, token: body.token };
}

async function library(id = campaignId, token = gmToken): Promise<LibraryEntry[]> {
  const res = await t.app.inject({
    method: 'GET',
    url: `/api/campaigns/${id}/archetype-library`,
    headers: gm(token),
  });
  expect(res.statusCode).toBe(200);
  return (res.json() as { entries: LibraryEntry[] }).entries;
}

async function install(
  id = campaignId,
  payload: Record<string, unknown> = {},
  token = gmToken,
): Promise<{ installed: TemplateRow[]; alreadyInstalled: string[]; entries: LibraryEntry[] }> {
  const res = await t.app.inject({
    method: 'POST',
    url: `/api/campaigns/${id}/archetype-library/install`,
    headers: gm(token),
    payload,
  });
  expect(res.statusCode).toBe(200);
  return res.json() as { installed: TemplateRow[]; alreadyInstalled: string[]; entries: LibraryEntry[] };
}

async function templates(id = campaignId, token = gmToken): Promise<TemplateRow[]> {
  const res = await t.app.inject({
    method: 'GET',
    url: `/api/campaigns/${id}/npc-templates`,
    headers: gm(token),
  });
  expect(res.statusCode).toBe(200);
  return (res.json() as { templates: TemplateRow[] }).templates;
}

async function wipeTemplates(id: string, token: string): Promise<void> {
  for (const row of await templates(id, token)) {
    const res = await t.app.inject({
      method: 'DELETE',
      url: `/api/npc-templates/${row.id}`,
      headers: gm(token),
    });
    expect(res.statusCode).toBe(204);
  }
}

async function eventCount(id: string): Promise<number> {
  const rows = await t.db
    .select({ n: sql<number>`count(*)::int` })
    .from(wsEvents)
    .where(eq(wsEvents.campaignId, id));
  return rows[0]?.n ?? 0;
}

beforeAll(async () => {
  t = await makeTestApp('archetypes');
  const boot = await bootstrapCampaign(t.app, 'Cold Start');
  campaignId = boot.campaignId;
  gmToken = boot.gmToken;
}, 60_000);

afterAll(async () => {
  await t.close();
});

// ---------------------------------------------------------------------------

describe('the catalogue itself (§14/D10)', () => {
  it('ships at least one original archetype, each with a stable id and real tiers', () => {
    const catalogue = starterCatalogue();
    expect(catalogue.length).toBeGreaterThan(0);
    const ids = new Set<string>();
    for (const archetype of catalogue) {
      expect(archetype.id).toMatch(/\S/);
      expect(ids.has(archetype.id)).toBe(false);
      ids.add(archetype.id);
      expect(archetype.name).toMatch(/\S/);
      expect(archetype.gen.tiers.length).toBeGreaterThan(0);
      // FR10.1: an archetype is generation ranges, not a stat block.
      for (const tier of archetype.gen.tiers) {
        expect(tier.professionalRating.min).toBeLessThanOrEqual(tier.professionalRating.max);
        expect(Object.keys(tier.attributes).length).toBeGreaterThan(0);
        expect(Object.keys(tier.skills).length).toBeGreaterThan(0);
      }
    }
  });
});

describe('a new campaign is not born empty (the reported bug)', () => {
  it('bootstraps with the starter library already installed', async () => {
    const rows = await templates();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.map((r) => r.gen.starterId).filter(Boolean).length).toBe(starterCatalogue().length);
  });

  it('marks every catalogue entry as installed, with the row that claims it', async () => {
    const entries = await library();
    expect(entries).toHaveLength(starterCatalogue().length);
    for (const entry of entries) {
      expect(entry.installed).toBe(true);
      expect(entry.templateId).toMatch(/\S/);
      expect(entry.installedAs).toBe(entry.name);
      expect(entry.tiers.length).toBeGreaterThan(0);
    }
  });

  it('auto-install is held back on a campaign that already owns a template', async () => {
    const fresh = await newCampaign('Hand authored');
    await wipeTemplates(fresh.campaignId, fresh.token);
    await t.db.insert(npcTemplates).values({
      campaignId: fresh.campaignId,
      name: 'My own thing',
      statblock: {},
      gen: {},
      persona: {},
    });

    const result = await installStarterArchetypes(t.db, fresh.campaignId, { onlyWhenEmpty: true });
    expect(result.heldBack).toBe(true);
    expect(result.installed).toHaveLength(0);
    expect(await templates(fresh.campaignId, fresh.token)).toHaveLength(1);
  });
});

describe('install is idempotent', () => {
  it('a second install creates nothing and duplicates nothing', async () => {
    const before = await templates();
    const first = await install();
    expect(first.installed).toHaveLength(0);
    expect(first.alreadyInstalled).toHaveLength(starterCatalogue().length);

    const second = await install();
    expect(second.installed).toHaveLength(0);

    const after = await templates();
    expect(after).toHaveLength(before.length);
    const starterIds = after.map((r) => r.gen.starterId).filter(Boolean);
    expect(new Set(starterIds).size).toBe(starterIds.length);
  });

  it('installs only the named subset, and the rest stay available', async () => {
    const fresh = await newCampaign('Subset');
    await wipeTemplates(fresh.campaignId, fresh.token);
    const emptied = await library(fresh.campaignId, fresh.token);
    expect(emptied.every((e) => !e.installed)).toBe(true);

    const wanted = starterCatalogue().slice(0, 1).map((a) => a.id);
    const result = await install(fresh.campaignId, { ids: wanted }, fresh.token);
    expect(result.installed).toHaveLength(wanted.length);
    expect(await templates(fresh.campaignId, fresh.token)).toHaveLength(wanted.length);

    const entries = await library(fresh.campaignId, fresh.token);
    for (const entry of entries) {
      expect(entry.installed).toBe(wanted.includes(entry.id));
    }

    // And re-running the subset install stays a no-op.
    const again = await install(fresh.campaignId, { ids: wanted }, fresh.token);
    expect(again.installed).toHaveLength(0);
    expect(again.alreadyInstalled).toEqual(wanted);
  });

  it('rejects ids it does not ship', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/campaigns/${campaignId}/archetype-library/install`,
      headers: gm(),
      payload: { ids: ['starter.not-a-thing'] },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe('bad_request');
  });
});

describe('installed templates are ordinary templates (FR10.1)', () => {
  it('every tier of every installed archetype generates an engine-valid NPC', async () => {
    const rows = (await templates()).filter((r) => r.gen.starterId);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      for (const tier of row.gen.tiers ?? []) {
        const res = await t.app.inject({
          method: 'POST',
          url: '/api/generator/npc',
          headers: gm(),
          payload: { templateId: row.id, tierId: tier.id, seed: 20_760_413 },
        });
        expect(res.statusCode).toBe(200);
        const body = res.json() as {
          npc: {
            name: string;
            sheet: { v: number; attributes: Record<string, unknown>; skills: unknown[] };
            monitors: { physical: number; stun: number };
            professionalRating: number;
            corrections: string[];
            loadout: Record<string, string[]>;
          };
        };
        // D13: the ranges are engine-valid as shipped — no clamping needed.
        expect(body.npc.corrections).toEqual([]);
        expect(body.npc.sheet.v).toBe(1);
        expect(body.npc.sheet.skills.length).toBeGreaterThan(0);
        expect(body.npc.monitors.physical).toBeGreaterThanOrEqual(9);
        expect(body.npc.monitors.stun).toBeGreaterThanOrEqual(9);
        expect(body.npc.professionalRating).toBeGreaterThanOrEqual(0);
        // FR10.1: loadout slots resolve against the template's own records.
        expect(Object.keys(body.npc.loadout).length).toBeGreaterThan(0);
      }
    }
  }, 60_000);

  it('a renamed installed template is not re-offered', async () => {
    const entries = await library();
    const target = entries[0]!;
    const renamed = await t.app.inject({
      method: 'PATCH',
      url: `/api/npc-templates/${target.templateId}`,
      headers: gm(),
      payload: { name: 'Dock crew (house rules)' },
    });
    expect(renamed.statusCode).toBe(200);

    const after = await library();
    const entry = after.find((e) => e.id === target.id)!;
    expect(entry.installed).toBe(true);
    expect(entry.installedAs).toBe('Dock crew (house rules)');

    const result = await install();
    expect(result.installed).toHaveLength(0);
    expect(result.alreadyInstalled).toContain(target.id);
  });

  it('survives a GM retuning the tier curves — editing does not orphan the row', async () => {
    const entries = await library();
    const target = entries[1] ?? entries[0]!;
    const row = (await templates()).find((r) => r.id === target.templateId)!;
    const tiers = (row.gen.tiers ?? []).map((tier) => ({
      ...(tier as unknown as Record<string, unknown>),
      label: `${tier.label} (tuned)`,
    }));

    const patched = await t.app.inject({
      method: 'PATCH',
      url: `/api/npc-templates/${target.templateId}`,
      headers: gm(),
      payload: { gen: { roleTags: ['house'], tiers } },
    });
    expect(patched.statusCode).toBe(200);
    const patchedRow = (patched.json() as { template: TemplateRow }).template;
    expect(patchedRow.gen.roleTags).toEqual(['house']);
    expect(starterIdOf(patchedRow.gen)).toBe(target.id);

    const entry = (await library()).find((e) => e.id === target.id)!;
    expect(entry.installed).toBe(true);
    const result = await install();
    expect(result.installed).toHaveLength(0);
  });

  it('deleting one genuinely uninstalls it, and it can be installed again', async () => {
    const target = (await library()).find((e) => e.installed)!;
    const deleted = await t.app.inject({
      method: 'DELETE',
      url: `/api/npc-templates/${target.templateId}`,
      headers: gm(),
    });
    expect(deleted.statusCode).toBe(204);

    const gone = (await library()).find((e) => e.id === target.id)!;
    expect(gone.installed).toBe(false);
    expect(gone.templateId).toBeNull();

    const result = await install(campaignId, { ids: [target.id] });
    expect(result.installed).toHaveLength(1);
    expect(result.installed[0]!.name).toBe(target.name);
    expect((await library()).find((e) => e.id === target.id)!.installed).toBe(true);
  });
});

describe('prep stays GM-only and silent (Principle 4 / §13)', () => {
  it('emits nothing to the table', async () => {
    const fresh = await newCampaign('Silent');
    await wipeTemplates(fresh.campaignId, fresh.token);
    const before = await eventCount(fresh.campaignId);
    await install(fresh.campaignId, {}, fresh.token);
    expect(await eventCount(fresh.campaignId)).toBe(before);
  });

  it('refuses a player on both routes', async () => {
    const player = await joinAs(t.app, campaignId, gmToken, 'player', 'Static');
    for (const [method, url] of [
      ['GET', `/api/campaigns/${campaignId}/archetype-library`],
      ['POST', `/api/campaigns/${campaignId}/archetype-library/install`],
    ] as const) {
      const res = await t.app.inject({
        method,
        url,
        headers: { authorization: `Bearer ${player.token}` },
        ...(method === 'POST' ? { payload: {} } : {}),
      });
      expect(res.statusCode).toBe(403);
      expect((res.json() as { error: { code: string } }).error.code).toBe('forbidden');
    }
  });

  it('refuses a GM from another campaign', async () => {
    const other = await newCampaign('Elsewhere');
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/campaigns/${campaignId}/archetype-library`,
      headers: gm(other.token),
    });
    expect(res.statusCode).toBe(403);
  });
});
