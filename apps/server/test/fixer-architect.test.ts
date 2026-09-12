/**
 * The Architect (fixer/architect.ts): one brief becomes an outline; the ticked
 * items become drafts and staged scenes through the lanes that already exist.
 *
 * A mock box answers each ask by what it is asked: the outline prompt gets an
 * outline, a page prompt gets Markdown, a floor prompt gets a floor plan.
 * Cancelling mid-build answers 200 with what landed, and the activity bar
 * hears `cancelled`.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { npcTemplates } from '@safehouse/db';
import { MockLlmServer, type MockChatRequest } from '../src/fixer/mock-llm.js';
import { resetRunsForTests } from '../src/fixer/activity.js';
import { ArchitectOutlineSchema, mergePersona, pickArchetype, type ArchitectOutlineInput } from '../src/fixer/architect.js';
import { bootstrapCampaign, makeTestApp, wsUrl, WsTestClient, type BootstrapResult, type Frame, type TestApp } from './core-helpers.js';
import { disableAi, enableAi, seedFixerFixture, type FixerFixture } from './fixer-helpers.js';

let t: TestApp;
let boot: BootstrapResult;
let fixture: FixerFixture;
const mocks: MockLlmServer[] = [];
const sockets: WsTestClient[] = [];

const OUTLINE: ArchitectOutlineInput = {
  title: 'Rust on the Water',
  premise: 'A dockside smuggling ring is moving something the corps want back, and the runners are hired from both sides.',
  lore: [
    { title: 'Pier 23', kind: 'location', summary: 'A container pier run by a crew that answers to nobody on paper.' },
    { title: 'The Rusted Halo', kind: 'faction', summary: 'The smugglers: six boats, one warehouse, a lot of debt.' },
  ],
  npcs: [
    {
      name: 'Marisol Kane',
      role: 'dock foreman and fixer',
      archetype: 'Street enforcer',
      persona: { traits: ['unhurried', 'counts everything twice'], voice: 'low, dry, never raises it', goals: ['keep the pier hers'], secrets: ['owes the Halo more than the pier is worth'] },
    },
  ],
  scenes: [
    {
      name: 'Warehouse 9',
      purpose: 'The exchange goes wrong here.',
      floor: 'One big warehouse floor with crates, a small office in the north-east corner with a door to the floor, a loading door on the south wall.',
      cols: 24,
      rows: 16,
      tileset: 'docklands',
    },
  ],
};

const PLAN = {
  title: 'Warehouse 9',
  rooms: [
    { name: 'warehouse floor', kind: 'room', x: 1, y: 1, w: 16, h: 12, props: [{ tile: 'crates', x: 4, y: 4 }] },
    { name: 'office', kind: 'room', x: 16, y: 1, w: 6, h: 5 },
  ],
  openings: [
    { room: 'warehouse floor', wall: 's', offset: 6, width: 3, kind: 'door' },
    { room: 'office', wall: 'w', offset: 2, kind: 'door' },
  ],
  stairs: [],
  notes: 'Office shares its west wall with the floor.',
};

const textOf = (req: MockChatRequest): string =>
  req.messages.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n');

/** Answers by what is asked; `slowPages` stalls the page ask so a cancel can land. */
async function architectBox(slowPagesMs = 0): Promise<MockLlmServer> {
  const mock = await MockLlmServer.start({
    responder: (req) => {
      if (req.messages.some((m) => Array.isArray(m.content as unknown))) return { content: 'ok' };
      const text = textOf(req);
      if (text.includes('campaign architect')) return { content: `<think>plan it</think>\n${JSON.stringify(OUTLINE)}`, usage: { promptTokens: 900, completionTokens: 500 } };
      if (text.includes('lay out one floor')) return { content: JSON.stringify(PLAN), usage: { promptTokens: 400, completionTokens: 200 } };
      if (text.includes('codex pages')) {
        return { content: '# Pier 23\n\nA container pier that answers to nobody on paper.\n\n- Six cranes\n- One office', usage: { promptTokens: 300, completionTokens: 120 }, delayMs: slowPagesMs };
      }
      return { content: 'The mock box has nothing to say to that.' };
    },
  });
  mocks.push(mock);
  enableAi(mock.baseUrl);
  return mock;
}

beforeAll(async () => {
  t = await makeTestApp('fixer-architect');
  await t.app.listen({ port: 0, host: '127.0.0.1' });
  boot = await bootstrapCampaign(t.app, 'Architect');
  fixture = await seedFixerFixture(t.app.db, boot.campaignId);
}, 180_000);

afterEach(async () => {
  disableAi();
  resetRunsForTests();
  for (const m of mocks.splice(0)) await m.close();
});

afterAll(async () => {
  for (const s of sockets.splice(0)) s.close();
  await t.close();
});

const auth = () => ({ authorization: `Bearer ${boot.gmToken}` });
const activity = (f: Frame) => f.type === 'ai.activity';
const payload = (f: Frame) => f.payload as { state: string; kind?: string; label?: string; outcome?: string };

describe('the outline', () => {
  it('turns a brief into an outline the schema accepts, through a think block', async () => {
    await architectBox();
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/fixer/architect/outline',
      headers: auth(),
      payload: { campaignId: boot.campaignId, brief: 'A dockside smuggling ring, the corps want their crate back, three sessions of play.' },
    });
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json() as { outline: unknown; usage: { totalTokens: number } };
    const outline = ArchitectOutlineSchema.parse(body.outline);
    expect(outline.title).toBe('Rust on the Water');
    expect(outline.lore).toHaveLength(2);
    expect(outline.npcs[0]?.persona.goals).toEqual(['keep the pier hers']);
    expect(outline.scenes[0]?.cols).toBe(24);
    expect(body.usage.totalTokens).toBe(1400);
  });

  it('is off when the AI is', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/fixer/architect/outline',
      headers: auth(),
      payload: { campaignId: boot.campaignId, brief: 'anything at all, long enough to pass' },
    });
    expect(res.statusCode).toBe(503);
    expect((res.json() as { error: { code: string } }).error.code).toBe('ai_disabled');
  });

  it('rejects a brief too short to mean anything', async () => {
    await architectBox();
    const res = await t.app.inject({ method: 'POST', url: '/api/fixer/architect/outline', headers: auth(), payload: { campaignId: boot.campaignId, brief: 'docks' } });
    expect(res.statusCode).toBe(400);
  });
});

describe('the build', () => {
  it('lands pages and NPCs as drafts and a scene as a staged floor, one label per item', async () => {
    await architectBox();
    const ws = await WsTestClient.connect(wsUrl(t.app, boot.campaignId, boot.gmToken));
    sockets.push(ws);
    await ws.next((f) => f.type === 'hello');
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/fixer/architect/build',
      headers: auth(),
      payload: { campaignId: boot.campaignId, outline: OUTLINE, select: { lore: [0, 1], npcs: [0], scenes: [0] } },
    });
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json() as {
      results: Array<{ type: string; name: string; ok: boolean; id?: string; landed?: string; note?: string }>;
      cancelled: boolean;
      usage: { totalTokens: number };
    };
    expect(body.cancelled).toBe(false);
    expect(body.results.map((r) => [r.type, r.name, r.ok, r.landed]), JSON.stringify(body.results.map((r) => r.note))).toEqual([
      ['lore', 'Pier 23', true, 'drafts'],
      ['lore', 'The Rusted Halo', true, 'drafts'],
      ['npc', 'Marisol Kane', true, 'drafts'],
      ['scene', 'Warehouse 9', true, 'scenes'],
    ]);
    expect(body.results[2]?.note).toContain('Street enforcer');
    expect(body.results[3]?.note).toMatch(/2 rooms, \d+ floor squares, \d+ doors/);
    // Two pages and the floor were model turns; the NPC was rolled, not asked.
    expect(body.usage.totalTokens).toBe(420 * 2 + 600);

    // The drafts are the inbox's shapes.
    const drafts = await t.app.inject({ method: 'GET', url: `/api/campaigns/${boot.campaignId}/generations`, headers: auth() });
    expect(drafts.statusCode, drafts.body).toBe(200);
    const list = (drafts.json() as { generations: Array<{ id: string; kind: string; output: Record<string, unknown> }> }).generations;
    const page = list.find((d) => d.id === body.results[0]?.id);
    expect(page).toMatchObject({ kind: 'wiki_page', output: { title: 'Pier 23', kind: 'location', tags: ['architect'] } });
    expect(String(page?.output['contentMd'])).toContain('# Pier 23');
    const npc = list.find((d) => d.id === body.results[2]?.id);
    expect(npc).toMatchObject({ kind: 'npc', output: { name: 'Marisol Kane', sourceTemplateId: fixture.templateId } });
    const persona = npc?.output['persona'] as { voice?: string; goals: string[]; traits: string[] };
    expect(persona.voice).toBe('low, dry, never raises it');
    expect(persona.goals).toEqual(['keep the pier hers']);
    expect(npc?.output['statblock']).toBeTruthy();

    // The scene is staged, not active, with the floor painted in the set asked for.
    const scene = await t.app.inject({ method: 'GET', url: `/api/scenes/${body.results[3]?.id}`, headers: auth() });
    expect(scene.statusCode).toBe(200);
    const s = (scene.json() as { scene: { name: string; state: string; grid: { cols: number; rows: number }; tiles?: { tilesetId: string; ground: Record<string, string>; structure: Record<string, string> }; notes?: string } }).scene;
    expect(s.name).toBe('Warehouse 9');
    expect(s.state).not.toBe('active');
    expect(s.grid).toMatchObject({ cols: 24, rows: 16 });
    expect(s.tiles?.tilesetId).toBe('docklands');
    expect(Object.keys(s.tiles?.ground ?? {}).length).toBeGreaterThan(50);
    expect(Object.keys(s.tiles?.structure ?? {}).length).toBeGreaterThan(20);
    expect(s.notes).toContain('The exchange goes wrong here.');

    // The run was renamed as it went, and ended done.
    const idle = await ws.next((f) => activity(f) && payload(f).state === 'idle');
    const labels = ws.frames.filter((f) => activity(f) && payload(f).state === 'busy').map((f) => payload(f).label ?? '');
    expect(labels[0]).toContain('building 4 items');
    expect(labels).toEqual(expect.arrayContaining([expect.stringContaining('writing “Pier 23” (1 of 4)'), expect.stringContaining('rolling Marisol Kane (3 of 4)'), expect.stringContaining('laying out Warehouse 9 (4 of 4)')]));
    expect(payload(idle)).toMatchObject({ state: 'idle', kind: 'architect', outcome: 'done' });
  });

  it('stops when the GM cancels and hands back what landed', async () => {
    await architectBox(3_000);
    const ws = await WsTestClient.connect(wsUrl(t.app, boot.campaignId, boot.gmToken));
    sockets.push(ws);
    await ws.next((f) => f.type === 'hello');
    const build = t.app.inject({
      method: 'POST',
      url: '/api/fixer/architect/build',
      headers: auth(),
      payload: { campaignId: boot.campaignId, outline: OUTLINE, select: { lore: [0, 1], npcs: [0], scenes: [0] } },
    });
    await ws.next((f) => activity(f) && (payload(f).label ?? '').includes('writing'));
    const cancel = await t.app.inject({ method: 'POST', url: '/api/fixer/cancel', headers: auth(), payload: { campaignId: boot.campaignId } });
    expect(cancel.json()).toEqual({ cancelled: true });
    const res = await build;
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json() as { results: unknown[]; cancelled: boolean };
    expect(body.cancelled).toBe(true);
    expect(body.results).toEqual([]);
    const idle = payload(await ws.next((f) => activity(f) && payload(f).state === 'idle'));
    expect(idle).toMatchObject({ kind: 'architect', outcome: 'cancelled' });
  });

  // Last, because it takes the campaign's archetypes away for good.
  it('says which NPC could not be rolled when there is no archetype, and still builds the rest', async () => {
    await architectBox();
    await t.app.db.delete(npcTemplates).where(eq(npcTemplates.campaignId, boot.campaignId));
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/fixer/architect/build',
      headers: auth(),
      payload: { campaignId: boot.campaignId, outline: OUTLINE, select: { lore: [0], npcs: [0], scenes: [] } },
    });
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json() as { results: Array<{ type: string; ok: boolean; note?: string }> };
    expect(body.results.map((r) => [r.type, r.ok])).toEqual([
      ['lore', true],
      ['npc', false],
    ]);
    expect(body.results[1]?.note).toContain('no archetypes on file');
  });
});

describe('the helpers', () => {
  const templates = [{ name: 'Street enforcer' }, { name: 'Corp security' }, { name: 'Ganger' }];
  it('picks the hinted archetype, then one that sounds like the role, then the first', () => {
    expect(pickArchetype(templates, 'corp security', 'anything')?.name).toBe('Corp security');
    expect(pickArchetype(templates, 'Security', 'anything')?.name).toBe('Corp security');
    expect(pickArchetype(templates, undefined, 'a ganger with a grudge')?.name).toBe('Ganger');
    expect(pickArchetype(templates, undefined, 'dock foreman')?.name).toBe('Street enforcer');
    expect(pickArchetype([], 'x', 'y')).toBeNull();
  });
  it('lets the outline speak only where it said something', () => {
    const base = { traits: ['tough'], goals: ['survive'], secrets: [], knowledge: ['the docks'], mannerisms: [], hooks: [], voice: 'gruff' };
    const merged = mergePersona(base, { traits: [], goals: ['keep the pier'], secrets: [], knowledge: [], mannerisms: [], hooks: [], backstory: 'grew up here' });
    expect(merged).toEqual({ ...base, goals: ['keep the pier'], backstory: 'grew up here' });
  });
});
