/**
 * The tool catalog and the draft pipeline (FR12.14–12.15, 12.17, 12.19).
 *
 * These run the tools directly — no model involved — because the contract
 * that matters is "the tool returns what the table is actually playing with,
 * and every write lands as a draft".
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { aiGenerations, books, bookPages, npcTemplates, scenes, type Db } from '@safehouse/db';
import { FogStateSchema } from '@safehouse/contracts';
import {
  bootstrapCampaign,
  makeTestApp,
  type BootstrapResult,
  type TestApp,
} from './core-helpers.js';
import { FIXER_TOOLS, executeTool, toolDefinitions, toolParameters, type ToolContext } from '../src/fixer/tools.js';
import { acceptDraft, listDrafts, rejectDraft, spoilerScan } from '../src/fixer/drafts.js';
import { UsageMeter } from '../src/fixer/usage.js';
import { seedFixerFixture, type FixerFixture } from './fixer-helpers.js';

let t: TestApp;
let boot: BootstrapResult;
let fx: FixerFixture;
let ctx: ToolContext;

async function call(name: string, args: unknown = {}): Promise<Record<string, unknown>> {
  const res = await executeTool(name, JSON.stringify(args), ctx);
  if (!res.ok) throw new Error(`tool ${name} failed: ${res.error}`);
  return res.result as Record<string, unknown>;
}

beforeAll(async () => {
  t = await makeTestApp('fixer-tools');
  boot = await bootstrapCampaign(t.app, 'Tool Catalog');
  fx = await seedFixerFixture(t.db, boot.campaignId);
  ctx = { db: t.db as Db, campaignId: boot.campaignId, prompt: 'test prompt', model: 'mock-primary' };
}, 120_000);

afterAll(async () => {
  await t.close();
});

describe('JSON schema for the API (FR12.13)', () => {
  it('describes every tool with a closed object schema', () => {
    const defs = toolDefinitions();
    expect(defs).toHaveLength(FIXER_TOOLS.length);
    for (const def of defs) {
      expect(def.type).toBe('function');
      expect(def.function.description.length).toBeGreaterThan(20);
      const params = def.function.parameters;
      expect(params['$schema']).toBeUndefined();
      expect(params['type']).toBe('object');
      expect(params['additionalProperties']).toBe(false);
    }
    expect(defs.map((d) => d.function.name)).toEqual(
      expect.arrayContaining([
        'get_campaign',
        'list_characters',
        'get_character',
        'get_ledger',
        'get_encounter',
        'get_scene',
        'get_session_log',
        'search_books',
        'list_npcs',
        'get_npc',
        'get_threat_readout',
        'generate_npc',
        'draft_wiki_page',
        'suggest_fog_reveal',
      ]),
    );
  });

  it('marks required arguments', () => {
    const schema = FIXER_TOOLS.find((tool) => tool.name === 'get_character')!.schema;
    expect(toolParameters(schema)['required']).toEqual(['characterId']);
  });

  it('turns bad calls into tool messages, never exceptions', async () => {
    const unknown = await executeTool('get_the_future', '{}', ctx);
    expect(unknown.ok).toBe(false);
    expect(unknown.content).toContain('unknown tool');

    const badJson = await executeTool('get_character', '{oops', ctx);
    expect(badJson.ok).toBe(false);
    expect(badJson.error).toContain('not valid JSON');

    const badArgs = await executeTool('get_character', '{"characterId": 7}', ctx);
    expect(badArgs.ok).toBe(false);
    expect(badArgs.error).toContain('invalid arguments');
  });
});

describe('read tools return live, engine-derived state (FR12.17)', () => {
  it('get_campaign sees the live session and active scene', async () => {
    const campaign = await call('get_campaign');
    expect(campaign).toMatchObject({ name: 'Tool Catalog', characters: 2 });
    expect(campaign['liveEncounter']).toMatchObject({ turn: 2, pass: 1 });
    expect(campaign['activeScene']).toMatchObject({ name: 'Rooftop, Redmond' });
  });

  it('list_characters applies the wound modifier from the running fight', async () => {
    const list = (await call('list_characters'))['characters'] as Array<Record<string, unknown>>;
    const wounded = list.find((c) => c['name'] === 'Static')!;
    expect(wounded['wounds']).toEqual({ physical: 7, stun: 1 });
    // 7 physical + 1 stun = -3 and -0 in SR5 box math; the engine owns the number.
    expect(wounded['woundModifier']).toBeLessThan(0);
  });

  it('get_character carries pools with their breakdown (Principle 3)', async () => {
    const character = await call('get_character', { characterId: fx.staticId });
    const derived = character['derived'] as {
      pools: Record<string, { total: number; breakdown: unknown[] }>;
      monitors: { physical: { value: number } };
      woundModifier?: { value: number };
    };
    const pool = derived.pools['skill.perception']!;
    expect(pool.breakdown.length).toBeGreaterThan(0);
    expect(derived.monitors.physical.value).toBe(10);
    expect(derived.woundModifier?.value).toBeLessThan(0);
    expect(character['balances']).toEqual({ karma: 0, nuyen: 0 });
  });

  it('get_encounter reports order, pass and who is up next', async () => {
    const encounter = await call('get_encounter');
    expect(encounter).toMatchObject({ turn: 2, pass: 1, state: 'live' });
    const order = encounter['order'] as Array<{ name: string; initScore: number; damageTaken: number }>;
    expect(order.map((c) => c.name)).toEqual(['Static', 'Kestrel', 'Ganger with the shotgun']);
    expect(encounter['upNext']).toMatchObject({ name: 'Kestrel' });
    expect(order[0]!.damageTaken).toBe(8);
  });

  it('get_scene shows the GM everything, hidden tokens included', async () => {
    const scene = await call('get_scene');
    const tokens = scene['tokens'] as Array<{ name: string; hidden: boolean }>;
    expect(tokens.find((token) => token.name === fx.hiddenTokenName)?.hidden).toBe(true);
    expect(scene['environment']).toMatchObject({ light: 2, wind: 1, note: 'sheeting rain' });
    const fog = scene['fog'] as { regions: Array<{ name: string; revealed: boolean }> };
    expect(fog.regions[0]).toMatchObject({ name: 'stairwell', revealed: false });
  });

  it('get_session_log, get_ledger, list_npcs and get_npc answer', async () => {
    const log = (await call('get_session_log', { limit: 5 }))['events'];
    expect(Array.isArray(log)).toBe(true);

    const ledger = (await call('get_ledger'))['characters'] as unknown[];
    expect(ledger).toHaveLength(2);

    const npcs = (await call('list_npcs'))['npcs'] as Array<{ id: string; roleTags: string[] }>;
    expect(npcs[0]?.roleTags).toEqual(['muscle']);

    const npc = await call('get_npc', { npcId: fx.templateId });
    expect(npc['name']).toBe('Street enforcer');
  });

  it('get_threat_readout estimates the fight with the math on display', async () => {
    const readout = await call('get_threat_readout', { encounterId: fx.encounterId });
    expect(readout['estimate']).toBe(true);
    expect(typeof readout['method']).toBe('string');
    expect(readout).toHaveProperty('initiative');
  });

  it('search_books cites the page the text actually came from (FR12.2/12.14)', async () => {
    const book = (
      await t.db
        .insert(books)
        .values({ campaignId: boot.campaignId, code: 'HOUSE', title: 'House Rules Folio' })
        .returning()
    )[0]!;
    await t.db.insert(bookPages).values({
      bookId: book.id,
      printedPage: 42,
      text: 'Sheeting rain on sprawl rooftops adds a visibility penalty to every ranged test at the table.',
    });

    const found = await call('search_books', { query: 'sprawl rooftops rain', limit: 3 });
    const hits = found['hits'] as Array<{ ref: { book: string; page: number }; snippet: string }>;
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.ref).toEqual({ book: 'HOUSE', page: 42 });
    expect(found['provenance']).toEqual([{ book: 'HOUSE', page: 42 }]);
  });
});

describe('every write is a draft (Principle 8, FR12.15)', () => {
  it('generate_npc rolls a rules-valid NPC into a draft, and accept creates the template', async () => {
    const before = await t.db
      .select({ id: npcTemplates.id })
      .from(npcTemplates)
      .where(eq(npcTemplates.campaignId, boot.campaignId));

    const result = await call('generate_npc', {
      templateId: fx.templateId,
      tierId: 'street',
      seed: 4242,
      persona: { traits: ['bored', 'patient'], voice: 'flat, bored, never raises it' },
    });
    expect(result['status']).toBe('draft');
    const generationId = result['generationId'] as string;

    // Nothing at the table changed yet.
    const afterDraft = await t.db
      .select({ id: npcTemplates.id })
      .from(npcTemplates)
      .where(eq(npcTemplates.campaignId, boot.campaignId));
    expect(afterDraft).toHaveLength(before.length);

    const drafts = await listDrafts(t.db as Db, boot.campaignId, { status: 'draft' });
    expect(drafts.find((d) => d.id === generationId)).toMatchObject({ kind: 'npc', status: 'draft' });

    const accepted = await acceptDraft(t.db as Db, boot.campaignId, generationId);
    expect(accepted.applied.table).toBe('npc_templates');
    expect(accepted.generation.status).toBe('accepted');
    expect(accepted.generation.target).toMatchObject({ table: 'npc_templates', id: accepted.applied.id });

    const created = (
      await t.db.select().from(npcTemplates).where(eq(npcTemplates.id, accepted.applied.id)).limit(1)
    )[0]!;
    expect(created.name).toBe(result['name']);
    const persona = created.persona as Record<string, unknown>;
    expect(persona['voice']).toBe('flat, bored, never raises it');
    expect(persona['aiProvenance']).toMatchObject({ generationId, model: 'mock-primary' });
    const statblock = created.statblock as { v: number; attributes: { bod: number } };
    expect(statblock.v).toBe(1);
    expect(statblock.attributes.bod).toBeGreaterThanOrEqual(4);
  });

  it('refuses to accept the same draft twice', async () => {
    const draft = await call('draft_wiki_page', {
      title: 'The Pike Street safehouse',
      contentMd: 'A walk-up over a noodle bar. Two exits, one of them a lie.',
      tags: ['location'],
    });
    const id = draft['generationId'] as string;
    await acceptDraft(t.db as Db, boot.campaignId, id);
    await expect(acceptDraft(t.db as Db, boot.campaignId, id)).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it('rejects a draft without applying it', async () => {
    const draft = await call('draft_wiki_page', { title: 'Discarded idea', contentMd: 'No.' });
    const generation = await rejectDraft(t.db as Db, boot.campaignId, draft['generationId'] as string);
    expect(generation.status).toBe('rejected');
    const row = (
      await t.db.select().from(aiGenerations).where(eq(aiGenerations.id, generation.id)).limit(1)
    )[0]!;
    expect(row.target).toBeNull();
  });

  it('suggest_fog_reveal only reveals once the GM accepts', async () => {
    const draft = await call('suggest_fog_reveal', {
      regions: ['stairwell'],
      reason: 'the team is at the door',
    });
    expect(draft['willReveal']).toEqual(['stairwell']);

    const beforeRow = (await t.db.select().from(scenes).where(eq(scenes.id, fx.sceneId)).limit(1))[0]!;
    expect(FogStateSchema.parse(beforeRow.fog).revealed).toEqual([]);

    await acceptDraft(t.db as Db, boot.campaignId, draft['generationId'] as string);
    const afterRow = (await t.db.select().from(scenes).where(eq(scenes.id, fx.sceneId)).limit(1))[0]!;
    expect(FogStateSchema.parse(afterRow.fog).revealed).toEqual([fx.fogRegionId]);
  });
});

describe('spoiler guard (FR12.19)', () => {
  it('flags GM-only names in player-facing prose', async () => {
    const flags = await spoilerScan(
      t.db as Db,
      boot.campaignId,
      'The team escaped the roof, unaware of the Watcher on the water tower, and Mister Kavanagh paid up.',
    );
    expect(flags.map((f) => f.name).sort()).toEqual(['Mister Kavanagh', 'Watcher on the water tower']);
  });

  it('attaches the flags to a player-facing draft', async () => {
    const draft = await call('draft_wiki_page', {
      title: 'Session recap',
      contentMd: 'Nothing on the roof but rain — and Mister Kavanagh, waiting.',
      playerFacing: true,
    });
    const flags = draft['spoilerFlags'] as Array<{ name: string }>;
    expect(flags.map((f) => f.name)).toContain('Mister Kavanagh');
  });

  it('leaves GM-only drafts alone', async () => {
    const draft = await call('draft_wiki_page', {
      title: 'GM notes',
      contentMd: 'Mister Kavanagh is lying about the payout.',
    });
    expect(draft['spoilerFlags']).toEqual([]);
  });
});

describe('usage meter (FR12.15/12.16)', () => {
  it('accumulates tokens and latency per campaign and per model', () => {
    const meter = new UsageMeter();
    meter.record('c1', {
      model: 'primary',
      usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
      latencyMs: 400,
    });
    meter.record('c1', {
      model: 'fast',
      usage: { promptTokens: 40, completionTokens: 10, totalTokens: 50 },
      latencyMs: 100,
    });
    const totals = meter.totals('c1');
    expect(totals).toMatchObject({ calls: 2, totalTokens: 170, latencyMsTotal: 500, latencyMsAvg: 250 });
    expect(totals.byModel['fast']).toMatchObject({ calls: 1, totalTokens: 50 });
    expect(meter.totals('other').calls).toBe(0);
  });
});
