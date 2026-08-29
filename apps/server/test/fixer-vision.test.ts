/**
 * Map vision (FR12.11, lane 2) — the capability-flagged half.
 *
 * DESIGN.md is explicit that this lane *requires a vision-capable local model;
 * the feature hides otherwise*, so most of this file is about the hiding: a
 * text-only box must make the feature disappear from the status endpoint and
 * from the tool catalog, and answer the direct route with a code the client can
 * switch on — never a stack trace at the moment the GM taps the button.
 *
 * The happy path is checked too: an image really is sent as an OpenAI-style
 * `image_url` content part carrying a base64 data URI, the answer is
 * constrained to the same integer geometry schema as the text lane, and what
 * comes back is a DRAFT that only touches the scene when the GM accepts.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { attachments, scenes } from '@safehouse/db';
import {
  bootstrapCampaign,
  joinAs,
  makeTestApp,
  type BootstrapResult,
  type JoinResult,
  type TestApp,
} from './core-helpers.js';
import { MockLlmServer, type MockChatRequest } from '../src/fixer/mock-llm.js';
import { disableAi, enableAi, seedFixerFixture, type FixerFixture } from './fixer-helpers.js';
import { filesDir } from '../src/services/scenes.js';
import {
  PROBE_IMAGE_DATA_URI,
  cachedVisionCapability,
  gridAlignmentWarnings,
  parseModelJson,
  readPropsVision,
  resetVisionCache,
  visionCapability,
} from '../src/fixer/vision.js';
import { llmConfigFromEnv } from '../src/fixer/llm.js';

let t: TestApp;
let boot: BootstrapResult;
let player: JoinResult;
let fx: FixerFixture;
let mapAttachmentId = '';
const mocks: MockLlmServer[] = [];

/** The layout the "vision-capable" mock claims to read off the map. */
const LAYOUT = {
  title: 'Dock warehouse, ground floor',
  rooms: [
    { name: 'loading dock', kind: 'storage', x: 0, y: 0, w: 8, h: 6 },
    { name: 'foreman office', kind: 'office', x: 8, y: 0, w: 5, h: 6 },
  ],
  doors: [{ room: 'foreman office', wall: 'w', offset: 2, width: 1 }],
  notes: 'The grid lines on the photo are 1 m squares.',
  gridCols: 20,
  gridRows: 20,
  gridConfidence: 'high',
};

/** True when this request carried a real image content part. */
function hasImagePart(req: MockChatRequest): boolean {
  return req.messages.some((m) => {
    const content = m.content as unknown;
    return (
      Array.isArray(content) &&
      content.some(
        (part) =>
          typeof part === 'object' &&
          part !== null &&
          (part as { type?: unknown }).type === 'image_url',
      )
    );
  });
}

function dataUriOf(req: MockChatRequest): string {
  for (const message of req.messages) {
    const content = message.content as unknown;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      const url = (part as { image_url?: { url?: unknown } })?.image_url?.url;
      if (typeof url === 'string') return url;
    }
  }
  return '';
}

async function mock(opts: Parameters<typeof MockLlmServer.start>[0] = {}): Promise<MockLlmServer> {
  const server = await MockLlmServer.start(opts);
  mocks.push(server);
  enableAi(server.baseUrl);
  resetVisionCache();
  return server;
}

/** A box whose model reads images: it answers the probe, the map, and plain chat. */
function visionResponder() {
  return (req: MockChatRequest) => {
    if (!hasImagePart(req)) return { content: 'ok, chummer' };
    // The probe asks for one token; the real call wants the layout JSON.
    const maxTokens = (req as unknown as { max_tokens?: number }).max_tokens;
    if (maxTokens === 1) return { content: 'ok' };
    return { content: JSON.stringify(LAYOUT) };
  };
}

/** A text-only box: image content is a 400/500, exactly like llama.cpp with no projector. */
function textOnlyResponder() {
  return (req: MockChatRequest) => {
    if (hasImagePart(req)) throw new Error('this model does not support image input');
    return { content: 'text only, chummer' };
  };
}

function gm(url: string, payload?: Record<string, unknown>, method: 'GET' | 'POST' = 'POST') {
  return t.app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${boot.gmToken}` },
    ...(payload !== undefined ? { payload } : {}),
  });
}

beforeAll(async () => {
  t = await makeTestApp('fixer-vision');
  boot = await bootstrapCampaign(t.app, 'Neon Rain');
  player = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Kestrel');
  fx = await seedFixerFixture(t.db, boot.campaignId);

  // A real file in the store, and a scene that points at it (FR9.2).
  const bytes = Buffer.from(PROBE_IMAGE_DATA_URI.split(',')[1]!, 'base64');
  await mkdir(filesDir(), { recursive: true });
  await writeFile(join(filesDir(), 'map-fixture.png'), bytes);
  const attachment = (
    await t.db
      .insert(attachments)
      .values({
        campaignId: boot.campaignId,
        kind: 'map',
        path: 'map-fixture.png',
        mime: 'image/png',
        size: bytes.length,
        visibility: 'gm',
      })
      .returning()
  )[0]!;
  mapAttachmentId = attachment.id;
  await t.db
    .update(scenes)
    .set({
      geometry: { walls: [], doors: [], zones: [], pins: [], mapAttachmentIds: [attachment.id] },
    })
    .where(eq(scenes.id, fx.sceneId));
}, 120_000);

afterAll(async () => {
  for (const m of mocks) await m.close();
  disableAi();
  resetVisionCache();
  await t.close();
});

afterEach(() => {
  disableAi();
  resetVisionCache();
});

// ---------------------------------------------------------------------------
// The probe, in pieces
// ---------------------------------------------------------------------------

describe('capability detection', () => {
  it('reads llama.cpp /props, and treats silence as "do not know" rather than "no"', () => {
    expect(readPropsVision({ modalities: { vision: true, audio: false } })).toBe(true);
    expect(readPropsVision({ modalities: { vision: false } })).toBe(false);
    expect(readPropsVision({ mmproj: '/models/projector.gguf' })).toBe(true);
    expect(readPropsVision({ has_multimodal: false })).toBe(false);
    // An older build that says nothing must not be read as a denial.
    expect(readPropsVision({ default_generation_settings: {} })).toBeNull();
    expect(readPropsVision(null)).toBeNull();
    expect(readPropsVision('nope')).toBeNull();
  });

  it('is "unconfigured", not "unsupported", when there is no box at all (NG7)', async () => {
    disableAi();
    const answer = await visionCapability(llmConfigFromEnv());
    expect(answer).toMatchObject({ supported: false, via: 'unconfigured', model: null });
  });

  it('says unsupported when the model refuses an image part, and caches that answer', async () => {
    const server = await mock({ responder: textOnlyResponder() });
    const config = llmConfigFromEnv()!;
    const first = await visionCapability(config);
    expect(first).toMatchObject({ supported: false, via: 'probe' });

    const asked = server.requests.length;
    const second = await visionCapability(config);
    expect(second.checkedAt).toBe(first.checkedAt);
    expect(server.requests.length).toBe(asked); // cached: the box is not asked twice
  });

  it('says supported when the model accepts one, and sends a real data URI', async () => {
    const server = await mock({ responder: visionResponder() });
    const answer = await visionCapability(llmConfigFromEnv()!);
    expect(answer).toMatchObject({ supported: true, via: 'probe' });
    const probe = server.requests.at(-1)!;
    expect(hasImagePart(probe)).toBe(true);
    expect(dataUriOf(probe)).toMatch(/^data:image\/png;base64,/);
  });

  it('honours LLM_VISION as an override without touching the box', async () => {
    const server = await mock({ responder: visionResponder() });
    process.env.LLM_VISION = 'off';
    try {
      const before = server.requests.length;
      const answer = await visionCapability(llmConfigFromEnv()!);
      expect(answer).toMatchObject({ supported: false, via: 'env' });
      expect(server.requests.length).toBe(before);
    } finally {
      delete process.env.LLM_VISION;
    }
  });

  it('reads unprobed as unsupported, so an unasked box hides the feature', async () => {
    await mock({ responder: visionResponder() });
    const cached = cachedVisionCapability(llmConfigFromEnv());
    expect(cached).toMatchObject({ supported: false, via: 'unknown' });
  });
});

// ---------------------------------------------------------------------------
// Degrading cleanly
// ---------------------------------------------------------------------------

describe('a text-only box hides the feature instead of erroring', () => {
  it('reports vision: false on the status endpoint', async () => {
    await mock({ responder: textOnlyResponder() });
    const res = await gm('/api/fixer/status', undefined, 'GET');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      enabled: true,
      vision: { supported: false, via: 'probe' },
    });
    expect(String((res.json() as { vision: { note: string } }).vision.note)).toMatch(/image/i);
  });

  it('drops read_map_image from the catalog the model is shown', async () => {
    const server = await mock({ responder: textOnlyResponder() });
    // Status is what probes; after it the agent's cached answer is "no".
    await gm('/api/fixer/status', undefined, 'GET');
    const chat = await gm('/api/fixer/chat', { message: 'can you read the map?' });
    expect(chat.statusCode).toBe(200);
    const offered = (server.requests.at(-1)!.tools ?? []).map((tool) => tool.function.name);
    expect(offered).toContain('propose_geometry');
    expect(offered).not.toContain('read_map_image');
  });

  it('but offers it once a box that reads images has been probed', async () => {
    const server = await mock({ responder: visionResponder() });
    const status = await gm('/api/fixer/status', undefined, 'GET');
    expect(status.json()).toMatchObject({ vision: { supported: true } });
    const chat = await gm('/api/fixer/chat', { message: 'read the map' });
    expect(chat.statusCode).toBe(200);
    const offered = (server.requests.at(-1)!.tools ?? []).map((tool) => tool.function.name);
    expect(offered).toContain('read_map_image');
  });

  it('answers the direct route 501 vision_unsupported, not a 500', async () => {
    await mock({ responder: textOnlyResponder() });
    const res = await gm('/api/fixer/read-map', { sceneId: fx.sceneId });
    expect(res.statusCode).toBe(501);
    expect((res.json() as { error: { code: string } }).error.code).toBe('vision_unsupported');
  });

  it('answers 503 ai_disabled with no box configured at all', async () => {
    disableAi();
    const res = await gm('/api/fixer/read-map', { sceneId: fx.sceneId });
    expect(res.statusCode).toBe(503);
    expect((res.json() as { error: { code: string } }).error.code).toBe('ai_disabled');

    const status = await gm('/api/fixer/status', undefined, 'GET');
    expect(status.json()).toMatchObject({ enabled: false, vision: { supported: false, via: 'unconfigured' } });
  });
});

// ---------------------------------------------------------------------------
// The lane itself
// ---------------------------------------------------------------------------

describe('reading a map into a draft', () => {
  let generationId = '';

  it('sends the scene map as an image part and compiles the answer onto the scene grid', async () => {
    const server = await mock({ responder: visionResponder() });
    await gm('/api/fixer/status', undefined, 'GET'); // probe first, like the panel does

    const res = await gm('/api/fixer/read-map', { sceneId: fx.sceneId, hint: 'ground floor only' });
    expect(res.statusCode).toBe(201);
    const body = res.json() as Record<string, unknown>;
    generationId = body['generationId'] as string;

    expect(body).toMatchObject({
      status: 'draft',
      sceneId: fx.sceneId,
      attachmentId: mapAttachmentId,
      appliesTo: 'scenes.geometry',
    });
    const counts = body['counts'] as Record<string, number>;
    expect(counts['rooms']).toBe(2);
    expect(counts['walls']).toBeGreaterThan(0);
    expect(counts['doors']).toBe(1);
    expect(counts['fogRegions']).toBe(2);
    expect(body['gridAlignment']).toMatchObject({ cols: 20, rows: 20, confidence: 'high', matchesScene: true });

    // The request that carried the map (not the probe) had the file's bytes.
    const withImage = server.requests.filter(hasImagePart);
    const real = withImage.at(-1)!;
    expect(dataUriOf(real)).toContain('data:image/png;base64,');
    expect(JSON.stringify(real)).toContain('ground floor only');
    // Constrained decoding, same shape as the text lane.
    expect((real as unknown as { response_format?: { type?: string } }).response_format?.type).toBe(
      'json_schema',
    );
  });

  it('changes nothing on the scene until the GM accepts (Principle 8)', async () => {
    const before = (await t.db.select().from(scenes).where(eq(scenes.id, fx.sceneId)).limit(1))[0]!;
    const geo = before.geometry as { walls?: unknown[] };
    expect(geo.walls ?? []).toHaveLength(0);

    expect(generationId).not.toBe('');
    const accepted = await gm(`/api/generations/${generationId}/accept`);
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({ applied: { table: 'scenes', id: fx.sceneId } });

    const after = (await t.db.select().from(scenes).where(eq(scenes.id, fx.sceneId)).limit(1))[0]!;
    const geometry = after.geometry as { walls: unknown[]; doors: unknown[]; zones: unknown[] };
    expect(geometry.walls.length).toBeGreaterThan(0);
    expect(geometry.doors).toHaveLength(1);
    expect(geometry.zones).toHaveLength(2);

    // Fog regions arrive UNREVEALED — drawing a room is not showing it.
    const fog = after.fog as { regions: Array<{ name: string }>; revealed: string[] };
    expect(fog.regions.map((r) => r.name)).toEqual(
      expect.arrayContaining(['loading dock', 'foreman office']),
    );
    expect(fog.revealed).toHaveLength(0);
  });

  it('is GM-only', async () => {
    await mock({ responder: visionResponder() });
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/fixer/read-map',
      headers: { authorization: `Bearer ${player.token}` },
      payload: { sceneId: fx.sceneId },
    });
    expect(res.statusCode).toBe(403);
  });

  it('says so plainly when the scene has no map image', async () => {
    await mock({ responder: visionResponder() });
    await gm('/api/fixer/status', undefined, 'GET');
    const created = await gm(`/api/campaigns/${boot.campaignId}/scenes`, {
      name: 'No map here',
      grid: { unitM: 1, cols: 10, rows: 10 },
    });
    expect(created.statusCode).toBeLessThan(300);
    const sceneId = (created.json() as { scene: { id: string } }).scene.id;
    const res = await gm('/api/fixer/read-map', { sceneId });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe('no_map_image');
  });
});

describe('grid alignment is advice, never an edit', () => {
  it('warns when the image and the scene grid disagree', () => {
    expect(
      gridAlignmentWarnings({ gridCols: 24, gridRows: 18, gridConfidence: 'high' }, { cols: 30, rows: 30 }),
    ).toHaveLength(1);
    expect(
      gridAlignmentWarnings({ gridCols: 30, gridRows: 30, gridConfidence: 'high' }, { cols: 30, rows: 30 }),
    ).toHaveLength(0);
    // No opinion offered, no warning raised.
    expect(gridAlignmentWarnings({ gridConfidence: 'none' }, { cols: 30, rows: 30 })).toHaveLength(0);
  });
});

describe('tolerant JSON reading', () => {
  it('unwraps a fenced answer and finds the object in a chatty one', () => {
    expect(parseModelJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseModelJson('Sure! {"a":2} hope that helps')).toEqual({ a: 2 });
    expect(() => parseModelJson('no json at all')).toThrow();
  });
});
