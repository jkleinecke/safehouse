/**
 * The at-the-table Fixer tools: proximity prompts (FR12.8), token
 * identification (FR12.9) and the layout copilot (FR12.11).
 *
 * The guarantees under test are the ones that keep the table safe:
 *  - the layout schema is a hard constraint, so a local model cannot emit a
 *    shape the Grid could not draw, and whatever arrives is snapped to the
 *    scene's own metres-per-square;
 *  - proximity prompts are GM-only and never reveal anything themselves;
 *  - both write-shaped tools land as drafts and change NOTHING until the GM
 *    accepts (Principle 8) — asserted against the rows, not the return value;
 *  - and once accepted, a fog reveal or a layout reaches the table the way
 *    the GM's own fog ops do: told, with the guards it uncovers or covers
 *    arriving and leaving in the same commit (P6).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { FogStateSchema, SceneGeometrySchema } from '@safehouse/contracts';
import { aiGenerations, scenes, tokens, type Db } from '@safehouse/db';
import {
  bootstrapCampaign,
  joinAs,
  makeTestApp,
  type BootstrapResult,
  type JoinResult,
  type TestApp,
} from './core-helpers.js';
import { executeTool, type ToolContext } from '../src/fixer/tools.js';
import { acceptDraft, listDrafts } from '../src/fixer/drafts.js';
import { compileLayout, layoutJsonSchema } from '../src/fixer/geometry.js';
import {
  emitFogProximity,
  fogProximityPrompts,
  fogProximityState,
  resetProximityMemory,
} from '../src/fixer/proximity.js';
import { baseName, identifyTokensState } from '../src/fixer/token-id.js';
import { runFixerChat } from '../src/fixer/agent.js';
import { LlmClient, llmConfigFromEnv } from '../src/fixer/llm.js';
import { MockLlmServer } from '../src/fixer/mock-llm.js';
import { disableAi, enableAi, seedFixerFixture, type FixerFixture } from './fixer-helpers.js';

let t: TestApp;
let boot: BootstrapResult;
let player: JoinResult;
let fx: FixerFixture;
let ctx: ToolContext;
let wideSceneId: string;
const mocks: MockLlmServer[] = [];

async function call(name: string, args: unknown = {}): Promise<Record<string, unknown>> {
  const res = await executeTool(name, JSON.stringify(args), ctx);
  if (!res.ok) throw new Error(`tool ${name} failed: ${res.error}`);
  return res.result as Record<string, unknown>;
}

function gmGet(url: string) {
  return t.app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${boot.gmToken}` } });
}

function gmPost(url: string, payload: Record<string, unknown>) {
  return t.app.inject({
    method: 'POST',
    url,
    headers: { authorization: `Bearer ${boot.gmToken}` },
    payload,
  });
}

/** A simple office block: lobby, corridor, server room, one door each way. */
const OFFICE = {
  title: 'Renraku branch, ground floor',
  rooms: [
    { name: 'Lobby', kind: 'lobby' as const, x: 0, y: 0, w: 6, h: 4 },
    { name: 'Corridor', kind: 'corridor' as const, x: 6, y: 0, w: 2, h: 4 },
    { name: 'Server room', kind: 'server_room' as const, x: 8, y: 0, w: 6, h: 4 },
  ],
  doors: [
    { room: 'Lobby', wall: 'e' as const, offset: 1, width: 1, to: 'Corridor' },
    { room: 'Server room', wall: 'w' as const, offset: 1, width: 1, to: 'Corridor' },
  ],
};

beforeAll(async () => {
  t = await makeTestApp('fixer-table');
  boot = await bootstrapCampaign(t.app, 'Table Tools');
  player = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Kestrel');
  fx = await seedFixerFixture(t.db, boot.campaignId);
  ctx = { db: t.db as Db, campaignId: boot.campaignId, prompt: 'table test', model: 'mock-fast' };

  // Three identical grunts plus two tokens whose names brush a GM-only page.
  await t.db.insert(tokens).values([
    { sceneId: fx.sceneId, source: 'prop', name: 'Ganger with the shotgun', x: 12, y: 12 },
    { sceneId: fx.sceneId, source: 'prop', name: 'Ganger with the shotgun', x: 13, y: 12 },
    { sceneId: fx.sceneId, source: 'prop', name: 'Ganger with the shotgun', x: 12, y: 13 },
    { sceneId: fx.sceneId, source: 'prop', name: "Mister Kavanagh's driver", x: 15, y: 15 },
    { sceneId: fx.sceneId, source: 'prop', name: "Mister Kavanagh's driver", x: 16, y: 15 },
  ]);

  // A second scene on a 2 m grid — the layout must follow the scene, not a
  // hardcoded metre.
  const wide = (
    await t.db
      .insert(scenes)
      .values({
        campaignId: boot.campaignId,
        name: 'Warehouse floor',
        state: 'draft',
        grid: { unitM: 2, cols: 20, rows: 20, offset: { x: 0, y: 0 }, projection: 'topdown' as const },
        geometry: { walls: [], doors: [], zones: [], pins: [] },
        fog: { regions: [], revealed: [], revealedShapes: [] },
      })
      .returning()
  )[0]!;
  wideSceneId = wide.id;
  resetProximityMemory();
}, 120_000);

afterAll(async () => {
  for (const m of mocks) await m.close();
  disableAi();
  await t.close();
});

// ---------------------------------------------------------------------------
// FR12.9 — token identification
// ---------------------------------------------------------------------------

describe('token identification (FR12.9)', () => {
  it('strips an existing ordinal off a name', () => {
    expect(baseName('Ganger with the shotgun #3')).toBe('Ganger with the shotgun');
    expect(baseName('Ganger (2)')).toBe('Ganger');
    expect(baseName('Static')).toBe('Static');
  });

  it('numbers the grunts and leaves unique names alone', async () => {
    const state = await identifyTokensState(t.db as Db, boot.campaignId, { sceneId: fx.sceneId });
    const gangers = state.tokens.filter((token) => baseName(token.currentName).startsWith('Ganger'));
    expect(gangers.map((g) => g.label)).toEqual([
      'Ganger with the shotgun #1',
      'Ganger with the shotgun #2',
      'Ganger with the shotgun #3',
    ]);
    const pc = state.tokens.find((token) => token.currentName === 'Static')!;
    expect(pc.label).toBe('Static');
    expect(pc.changed).toBe(false);
    expect(pc.confidence).toBe('high');
    expect(pc.description).toContain('player character');
  });

  it('describes the live combatant behind a token, boxes and all', async () => {
    const state = await identifyTokensState(t.db as Db, boot.campaignId, { sceneId: fx.sceneId });
    const pc = state.tokens.find((token) => token.currentName === 'Static')!;
    // Static is on 7 physical / 1 stun in the running fight (fixer-helpers).
    expect(pc.description).toContain('7/10P 1/10S');
    expect(pc.description).toContain('init 17');
  });

  it('marks a hidden token hidden without hiding it from the GM', async () => {
    const state = await identifyTokensState(t.db as Db, boot.campaignId, { sceneId: fx.sceneId });
    const watcher = state.tokens.find((token) => token.currentName === fx.hiddenTokenName)!;
    expect(watcher.hidden).toBe(true);
    expect(watcher.description).toContain('hidden from players');
  });

  it('spoiler-checks the labels that would become player-visible (FR12.19)', async () => {
    const result = await call('identify_tokens', { sceneId: fx.sceneId });
    const flags = result['spoilerFlags'] as Array<{ name: string }>;
    expect(flags.map((f) => f.name)).toContain('Mister Kavanagh');
  });

  it('renames nothing until the GM accepts (Principle 8)', async () => {
    const before = await t.db.select().from(tokens).where(eq(tokens.sceneId, fx.sceneId));
    const draft = await call('identify_tokens', { sceneId: fx.sceneId, note: 'mid-fight' });
    expect(draft['status']).toBe('draft');
    expect(Number(draft['renames'])).toBeGreaterThan(0);

    const untouched = await t.db.select().from(tokens).where(eq(tokens.sceneId, fx.sceneId));
    expect(untouched.map((token) => token.name).sort()).toEqual(
      before.map((token) => token.name).sort(),
    );

    const accepted = await acceptDraft(t.app.hub, boot.campaignId, draft['generationId'] as string);
    expect(accepted.applied.table).toBe('tokens');
    const after = await t.db.select().from(tokens).where(eq(tokens.sceneId, fx.sceneId));
    const names = after.map((token) => token.name);
    expect(names).toContain('Ganger with the shotgun #1');
    expect(names).toContain('Ganger with the shotgun #3');
    // A token that needed no rename kept its name exactly.
    expect(names).toContain('Static');
  });
});

// ---------------------------------------------------------------------------
// FR12.11 — layout copilot
// ---------------------------------------------------------------------------

describe('layout copilot produces grid-true geometry (FR12.11)', () => {
  it('constrains the proposal so an invalid shape cannot be expressed', async () => {
    const fractional = await executeTool(
      'propose_geometry',
      JSON.stringify({ title: 'bad', rooms: [{ name: 'A', x: 0, y: 0, w: 2.5, h: 3 }] }),
      ctx,
    );
    expect(fractional.ok).toBe(false);
    expect(fractional.error).toContain('invalid arguments');

    const noRooms = await executeTool('propose_geometry', JSON.stringify({ title: 'bad', rooms: [] }), ctx);
    expect(noRooms.ok).toBe(false);

    const schema = layoutJsonSchema() as { properties: Record<string, Record<string, unknown>> };
    const room = schema.properties['rooms'] as { items: { properties: Record<string, { type?: string }> } };
    expect(room.items.properties['x']?.type).toBe('integer');
    expect(room.items.properties['w']?.type).toBe('integer');
  });

  it('snaps rooms to the grid and cuts real doorways in the walls', () => {
    const compiled = compileLayout(
      { ...OFFICE, notes: '' },
      { unitM: 1, cols: 20, rows: 20, offset: { x: 0, y: 0 }, projection: 'topdown' as const },
    );
    expect(compiled.warnings).toEqual([]);
    expect(compiled.rooms.map((r) => r.name)).toEqual(['Lobby', 'Corridor', 'Server room']);
    expect(compiled.geometry.doors).toHaveLength(2);

    // The lobby/corridor party wall sits on x = 6 and is broken between y 1..2.
    const onSix = compiled.geometry.walls.filter((w) => w.a.x === 6 && w.b.x === 6);
    expect(onSix.length).toBeGreaterThan(0);
    const covers = (y: number): boolean =>
      onSix.some((w) => Math.min(w.a.y, w.b.y) < y && y < Math.max(w.a.y, w.b.y));
    expect(covers(1.5)).toBe(false); // the doorway
    expect(covers(0.5)).toBe(true); // wall above it
    expect(covers(3)).toBe(true); // wall below it

    // Every room also becomes a named fog region, ready for staged reveals.
    expect(compiled.fogRegions.map((r) => r.name)).toEqual(['Lobby', 'Corridor', 'Server room']);
    expect(SceneGeometrySchema.safeParse(compiled.geometry).success).toBe(true);
  });

  it('measures in the scene’s own metres per square', () => {
    const oneMetre = compileLayout({ ...OFFICE, notes: '' }, { unitM: 1, cols: 20, rows: 20 });
    const twoMetre = compileLayout({ ...OFFICE, notes: '' }, { unitM: 2, cols: 20, rows: 20 });
    expect(oneMetre.rooms[0]!.sizeM).toEqual({ w: 6, h: 4 });
    expect(twoMetre.rooms[0]!.sizeM).toEqual({ w: 12, h: 8 });
    expect(twoMetre.rooms[0]!.areaM2).toBe(96);
    // Coordinates stay whole squares regardless of the metric scale.
    expect(twoMetre.rooms[0]!.rect).toEqual({ x: 0, y: 0, w: 6, h: 4 });
  });

  it('clamps a room that runs off the grid and says it did', () => {
    const compiled = compileLayout(
      {
        title: 'Overhang',
        rooms: [{ name: 'Annex', kind: 'room', x: 18, y: 0, w: 10, h: 4, level: 0, fogRegion: true }],
        doors: [],
        notes: '',
      },
      { unitM: 1, cols: 20, rows: 20 },
    );
    expect(compiled.rooms[0]!.rect).toMatchObject({ x: 18, w: 2 });
    expect(compiled.warnings.join(' ')).toContain('clamped to the grid');
  });

  it('snaps a door that was placed off the end of its wall', () => {
    const compiled = compileLayout(
      {
        title: 'Bad door',
        rooms: [{ name: 'Cell', kind: 'room', x: 0, y: 0, w: 3, h: 3, level: 0, fogRegion: true }],
        doors: [{ room: 'Cell', wall: 'n', offset: 40, width: 9, open: false }],
        notes: '',
      },
      { unitM: 1, cols: 20, rows: 20 },
    );
    const door = compiled.geometry.doors[0]!;
    expect(door.a).toEqual({ x: 0, y: 0 });
    expect(door.b).toEqual({ x: 3, y: 0 });
    expect(compiled.warnings.join(' ')).toContain('snapped onto the wall');
  });

  it('draws nothing on the scene until the GM accepts', async () => {
    const draft = await call('propose_geometry', { ...OFFICE, sceneId: wideSceneId, notes: 'ground floor' });
    expect(draft['status']).toBe('draft');
    expect(draft['counts']).toMatchObject({ rooms: 3, doors: 2, fogRegions: 3 });

    const before = (await t.db.select().from(scenes).where(eq(scenes.id, wideSceneId)).limit(1))[0]!;
    expect(SceneGeometrySchema.parse(before.geometry).walls).toEqual([]);
    expect(FogStateSchema.parse(before.fog).regions).toEqual([]);

    const accepted = await acceptDraft(t.app.hub, boot.campaignId, draft['generationId'] as string);
    expect(accepted.applied.table).toBe('scenes');
    const after = (await t.db.select().from(scenes).where(eq(scenes.id, wideSceneId)).limit(1))[0]!;
    const geometry = SceneGeometrySchema.parse(after.geometry);
    expect(geometry.walls.length).toBeGreaterThan(0);
    expect(geometry.doors).toHaveLength(2);
    expect(geometry.zones.map((z) => z.name)).toEqual(['Lobby', 'Corridor', 'Server room']);

    // Regions arrive but stay fogged: drawing a room is not showing it.
    const fog = FogStateSchema.parse(after.fog);
    expect(fog.regions).toHaveLength(3);
    expect(fog.revealed).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// FR12.8 — proximity prompts
// ---------------------------------------------------------------------------

describe('fog proximity prompts (FR12.8)', () => {
  it('notices a token standing at an unrevealed region', async () => {
    const state = await fogProximityState(t.db as Db, boot.campaignId, { sceneId: fx.sceneId });
    expect(state.radiusM).toBe(3);
    const prompt = state.prompts.find((p) => p.regionId === fx.fogRegionId);
    expect(prompt).toBeDefined();
    expect(prompt!.tokenName).toBe('Static');
    expect(prompt!.message).toContain('reveal?');
    expect(prompt!.distanceM).toBeLessThanOrEqual(3);
  });

  it('goes quiet once the region is revealed', async () => {
    const scene = (await t.db.select().from(scenes).where(eq(scenes.id, fx.sceneId)).limit(1))[0]!;
    const fog = FogStateSchema.parse(scene.fog);
    await t.db
      .update(scenes)
      .set({ fog: { ...fog, revealed: [fx.fogRegionId] } })
      .where(eq(scenes.id, fx.sceneId));
    const state = await fogProximityState(t.db as Db, boot.campaignId, { sceneId: fx.sceneId });
    expect(state.prompts.find((p) => p.regionId === fx.fogRegionId)).toBeUndefined();
    await t.db.update(scenes).set({ fog }).where(eq(scenes.id, fx.sceneId));
  });

  it('emits GM-only, never persists, and never nags twice', async () => {
    resetProximityMemory(boot.campaignId);
    const seen: Array<{ type: string; visibility?: string; payload: unknown }> = [];
    const hub = {
      emitEphemeral(_campaignId: string, input: { type: string; payload: unknown; visibility?: string }) {
        seen.push(input as { type: string; visibility?: string; payload: unknown });
      },
    };
    const first = await emitFogProximity(t.db as Db, hub, boot.campaignId, { sceneId: fx.sceneId });
    expect(first.length).toBeGreaterThan(0);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.type).toBe('fixer.suggestion');
    // The whole point: an unrevealed region is GM-only knowledge.
    expect(seen[0]!.visibility).toBe('gm');
    const payload = seen[0]!.payload as { action: { tool: string } };
    expect(payload.action.tool).toBe('suggest_fog_reveal');

    const second = await emitFogProximity(t.db as Db, hub, boot.campaignId, { sceneId: fx.sceneId });
    expect(second).toEqual([]);
    expect(seen).toHaveLength(1);
  });

  it('suggests a live reveal of a room shown as seen before only to a token inside it, and nothing on a scene with sightlines (P6)', () => {
    const grid = { unitM: 1, cols: 20, rows: 20, offset: { x: 0, y: 0 }, projection: 'topdown' as const };
    const lab = { id: 'lab', name: 'the lab', polygon: [{ x: 5, y: 5 }, { x: 10, y: 5 }, { x: 10, y: 10 }, { x: 5, y: 10 }] };
    const atTheDoor = { id: 't1', name: 'Static', x: 4.5, y: 7.5, hidden: false };
    const inside = { id: 't2', name: 'Kestrel', x: 7.5, y: 7.5, hidden: false };
    const fog = (over: Record<string, unknown>) => ({ regions: [lab], revealed: [], revealedShapes: [], ...over });
    const prompts = (over: Record<string, unknown>, vision?: unknown) =>
      fogProximityPrompts({ grid, fog: fog(over), tokens: [atTheDoor, inside], ...(vision !== undefined ? { vision } : {}) }).prompts;

    // Still fogged: at the door and inside, as it always was.
    expect(prompts({}).map((p) => [p.tokenName, p.shownAs])).toEqual([
      ['Kestrel', 'hidden'],
      ['Static', 'hidden'],
    ]);
    // Seen before: the table sees the room already, so the door says nothing;
    // a runner inside it is the moment to open it live.
    const remembered = prompts({ exploredRegionIds: ['lab'] });
    expect(remembered.map((p) => [p.tokenName, p.shownAs, p.inside])).toEqual([['Kestrel', 'explored', true]]);
    expect(remembered[0]!.message).toContain('reveal it live?');
    // Live: nothing to suggest.
    expect(prompts({ revealed: ['lab'] })).toEqual([]);
    // Sightlines on: the party's eyes do the unmasking, and a region opened
    // live would stay open behind them.
    expect(prompts({}, { playersSeeOwnSight: false, sight: 'on' })).toEqual([]);
    expect(prompts({}, { playersSeeOwnSight: false, sight: 'off' })).toHaveLength(2);
  });

  it('reveals nothing by itself', async () => {
    const before = (await t.db.select().from(scenes).where(eq(scenes.id, fx.sceneId)).limit(1))[0]!;
    await fogProximityState(t.db as Db, boot.campaignId, { sceneId: fx.sceneId });
    await emitFogProximity(t.db as Db, undefined, boot.campaignId, { sceneId: fx.sceneId });
    const after = (await t.db.select().from(scenes).where(eq(scenes.id, fx.sceneId)).limit(1))[0]!;
    expect(FogStateSchema.parse(after.fog).revealed).toEqual(
      FogStateSchema.parse(before.fog).revealed,
    );
  });
});

// ---------------------------------------------------------------------------
// Accepted drafts reach the table (P6)
// ---------------------------------------------------------------------------

describe('an accepted fog or layout draft reaches the table like the GM’s own fog ops (P6)', () => {
  const box = (x0: number, y0: number, x1: number, y1: number) => [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];

  /** The public events a player can read back that arrived after `since`, oldest first. */
  async function tableSince(since: number): Promise<{ type: string; payload: Record<string, unknown> }[]> {
    const log = await t.app.inject({
      method: 'GET',
      url: `/api/campaigns/${boot.campaignId}/log?limit=500`,
      headers: { authorization: `Bearer ${player.token}` },
    });
    expect(log.statusCode).toBe(200);
    const events = (log.json() as { events: { id: unknown; type: string; payload: Record<string, unknown> }[] }).events;
    return events
      .filter((e) => Number(e.id) > since)
      .reverse()
      .map((e) => ({ type: e.type, payload: e.payload }));
  }

  async function mark(): Promise<number> {
    const log = await gmGet(`/api/campaigns/${boot.campaignId}/log?limit=1`);
    const events = (log.json() as { events: { id: unknown }[] }).events;
    return Math.max(0, ...events.map((e) => Number(e.id)));
  }

  /**
   * A scene of the test's own. Made the table's scene (activated, as the GM
   * would) unless `staged`: only the active scene has a table to tell, and
   * everything that happens on a staged one is the GM's alone (P6 secrecy
   * sweep, `sceneOnTable`).
   */
  async function newScene(name: string, fog: Record<string, unknown>, opts: { staged?: boolean } = {}): Promise<string> {
    const row = (
      await t.db
        .insert(scenes)
        .values({
          campaignId: boot.campaignId,
          name,
          state: 'draft',
          grid: { unitM: 1, cols: 20, rows: 20, offset: { x: 0, y: 0 }, projection: 'topdown' as const },
          geometry: { walls: [], doors: [], zones: [], pins: [] },
          fog: { regions: [], revealed: [], revealedShapes: [], ...fog },
        })
        .returning()
    )[0]!;
    if (!opts.staged) expect((await gmPost(`/api/scenes/${row.id}/activate`, {})).statusCode).toBe(200);
    return row.id;
  }

  // The fixture's scene is the table's again for the blocks after this one.
  afterAll(async () => {
    expect((await gmPost(`/api/scenes/${fx.sceneId}/activate`, {})).statusCode).toBe(200);
  });

  it('opens a region live, out of the seen-before list, and sends the guard standing in it', async () => {
    const vault = { id: 'region-vault', name: 'vault', polygon: box(10, 10, 14, 14) };
    const vaultSceneId = await newScene('Vault level', {
      regions: [vault],
      exploredRegionIds: [vault.id],
      enabled: true,
    });
    const guard = (
      await t.db
        .insert(tokens)
        .values({ sceneId: vaultSceneId, source: 'prop', name: 'Vault guard', x: 12.5, y: 12.5 })
        .returning()
    )[0]!;

    const draft = await call('suggest_fog_reveal', { sceneId: vaultSceneId, regions: ['vault'], reason: 'they cracked it' });
    const since = await mark();
    const accepted = await acceptDraft(t.app.hub, boot.campaignId, draft['generationId'] as string);
    expect(accepted.applied.note).toContain('revealed 1 fog region(s) live');

    // In one list, the live one.
    const row = (await t.db.select().from(scenes).where(eq(scenes.id, vaultSceneId)).limit(1))[0]!;
    const fog = FogStateSchema.parse(row.fog);
    expect(fog.revealed).toEqual([vault.id]);
    expect(fog.exploredRegionIds).toBeUndefined();

    // The table heard the reveal, as the GM's own button says it, then the guard arrived.
    const events = await tableSince(since);
    expect(events.map((e) => e.type)).toEqual(['fog.updated', 'token.added']);
    expect(events[0]!.payload).toEqual({ sceneId: vaultSceneId, op: 'reveal', regionId: vault.id, region: vault, as: 'live', active: true });
    expect(events[1]!.payload['token']).toMatchObject({ id: guard.id, name: 'Vault guard' });

    // A region already live is left alone: a second accept says nothing.
    const again = await call('suggest_fog_reveal', { sceneId: vaultSceneId, regions: ['vault'] });
    const since2 = await mark();
    await acceptDraft(t.app.hub, boot.campaignId, again['generationId'] as string);
    expect(await tableSince(since2)).toEqual([]);
  });

  it('draws a layout and tells the table: the walls, the fog its first regions turn on, and the guard it covers', async () => {
    const annexSceneId = await newScene('Annex', {});
    const guard = (
      await t.db
        .insert(tokens)
        .values({ sceneId: annexSceneId, source: 'prop', name: 'Annex guard', x: 2.5, y: 1.5 })
        .returning()
    )[0]!;
    const draft = await call('propose_geometry', { ...OFFICE, sceneId: annexSceneId, notes: 'the annex' });
    const since = await mark();
    await acceptDraft(t.app.hub, boot.campaignId, draft['generationId'] as string);

    const events = await tableSince(since);
    // The walls as a public delta; the regions' own defines are the GM's and
    // never reach a player, but the fog they switch on does, as one bit.
    expect(events.map((e) => [e.type, e.payload['op'] ?? e.payload['changed']])).toEqual([
      ['scene.updated', ['geometry']],
      ['fog.updated', 'define'],
      ['token.removed', undefined],
    ]);
    expect(events[1]!.payload).toEqual({ sceneId: annexSceneId, op: 'define', active: true });
    expect(events[2]!.payload).toEqual({ tokenId: guard.id, sceneId: annexSceneId });
    expect(JSON.stringify(events)).not.toContain('Server room');
  });

  it('tells the table nothing of a draft accepted on a scene the GM is still staging but that the scene changed', async () => {
    const vault = { id: 'region-back-vault', name: 'back vault', polygon: box(10, 10, 14, 14) };
    const stagedId = await newScene('Back office', { regions: [vault], enabled: true }, { staged: true });
    const guard = (
      await t.db
        .insert(tokens)
        .values({ sceneId: stagedId, source: 'prop', name: 'Back office guard', x: 12.5, y: 12.5 })
        .returning()
    )[0]!;

    const reveal = await call('suggest_fog_reveal', { sceneId: stagedId, regions: ['back vault'] });
    const layout = await call('propose_geometry', { ...OFFICE, sceneId: stagedId, notes: 'the back office' });
    const since = await mark();
    await acceptDraft(t.app.hub, boot.campaignId, reveal['generationId'] as string);
    await acceptDraft(t.app.hub, boot.campaignId, layout['generationId'] as string);

    // The walls went up (a bare "the scene changed", as every scene edit
    // says), and nothing else: no reveal with the vault's name and outline,
    // no fog word, no guard arriving or leaving.
    const events = await tableSince(since);
    expect(events.map((e) => [e.type, e.payload['changed']])).toEqual([['scene.updated', ['geometry']]]);
    const raw = JSON.stringify(events);
    for (const secret of ['back vault', guard.id, 'Back office guard', 'Server room']) expect(raw).not.toContain(secret);
  });
});

// ---------------------------------------------------------------------------
// The HTTP surface
// ---------------------------------------------------------------------------

describe('the GM-only HTTP surface', () => {
  it('serves the catalog and the constrained layout schema', async () => {
    const catalog = await gmGet('/api/fixer/tools');
    expect(catalog.statusCode).toBe(200);
    const names = (catalog.json() as { tools: Array<{ name: string }> }).tools.map((x) => x.name);
    expect(names).toEqual(expect.arrayContaining(['identify_tokens', 'propose_geometry', 'get_calendar']));

    const schema = await gmGet('/api/fixer/geometry-schema');
    expect(schema.statusCode).toBe(200);
    expect((schema.json() as { units: string }).units).toContain('grid squares');
  });

  it('answers "who is this?" without writing a draft when asked not to', async () => {
    const before = (await t.db.select().from(aiGenerations)).length;
    const res = await gmPost('/api/fixer/identify-tokens', { sceneId: fx.sceneId, draft: false });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { tokens: unknown[] }).tokens.length).toBeGreaterThan(0);
    expect((await t.db.select().from(aiGenerations)).length).toBe(before);
  });

  it('takes a layout over HTTP and files it as a draft', async () => {
    const res = await gmPost('/api/fixer/propose-geometry', { ...OFFICE, sceneId: wideSceneId });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { generationId: string; status: string };
    expect(body.status).toBe('draft');
    const drafts = await listDrafts(t.db as Db, boot.campaignId, { kind: 'geometry' });
    expect(drafts.some((d) => d.id === body.generationId && d.status === 'draft')).toBe(true);
  });

  it('reports proximity and can push the prompt to the panel', async () => {
    resetProximityMemory(boot.campaignId);
    const res = await gmGet(`/api/fixer/fog-proximity?sceneId=${fx.sceneId}&announce=true`);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { prompts: unknown[]; announced: number; radiusM: number };
    expect(body.prompts.length).toBeGreaterThan(0);
    expect(body.announced).toBeGreaterThan(0);
  });

  it('keeps players out of all of it (§13)', async () => {
    for (const url of ['/api/fixer/tools', `/api/fixer/fog-proximity?sceneId=${fx.sceneId}`]) {
      const res = await t.app.inject({
        method: 'GET',
        url,
        headers: { authorization: `Bearer ${player.token}` },
      });
      expect(res.statusCode).toBe(403);
    }
    const post = await t.app.inject({
      method: 'POST',
      url: '/api/fixer/identify-tokens',
      headers: { authorization: `Bearer ${player.token}` },
      payload: { sceneId: fx.sceneId },
    });
    expect(post.statusCode).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Through the model
// ---------------------------------------------------------------------------

describe('the model reaches the new tools and still cannot apply anything', () => {
  it('calls identify_tokens through the agent loop, and the table does not move', async () => {
    const mock = await MockLlmServer.start({
      turns: [
        { toolCalls: [{ name: 'identify_tokens', arguments: { sceneId: fx.sceneId } }] },
        { content: 'Numbered them. Draft is waiting for you.' },
      ],
    });
    mocks.push(mock);
    enableAi(mock.baseUrl);
    const config = llmConfigFromEnv()!;

    const namesBefore = (await t.db.select().from(tokens).where(eq(tokens.sceneId, fx.sceneId)))
      .map((token) => token.name)
      .sort();

    const result = await runFixerChat(
      { db: t.db as Db, llm: new LlmClient(config) },
      { campaignId: boot.campaignId, message: 'who are all these gangers?', slot: 'fast' },
    );
    expect(result.tools.map((tool) => tool.name)).toEqual(['identify_tokens']);
    expect(result.tools[0]!.ok).toBe(true);
    expect(result.text).toContain('Draft');

    const namesAfter = (await t.db.select().from(tokens).where(eq(tokens.sceneId, fx.sceneId)))
      .map((token) => token.name)
      .sort();
    expect(namesAfter).toEqual(namesBefore);

    const drafts = await listDrafts(t.db as Db, boot.campaignId, { kind: 'token_label' });
    expect(drafts.some((d) => d.status === 'draft')).toBe(true);
    disableAi();
  });

  it('is handed the layout tool with an all-integer schema', async () => {
    const mock = await MockLlmServer.start({ turns: [{ content: 'noted' }] });
    mocks.push(mock);
    enableAi(mock.baseUrl);
    await runFixerChat(
      { db: t.db as Db, llm: new LlmClient(llmConfigFromEnv()!) },
      { campaignId: boot.campaignId, message: 'lay out a branch office', slot: 'fast' },
    );
    const sent = mock.requests[0]!;
    const layout = sent.tools?.find((tool) => tool.function.name === 'propose_geometry');
    expect(layout).toBeDefined();
    const params = layout!.function.parameters as {
      properties: { rooms: { items: { properties: Record<string, { type?: string }> } } };
    };
    expect(params.properties.rooms.items.properties['h']?.type).toBe('integer');
    disableAi();
  });
});
