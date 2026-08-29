/**
 * Beat four — the Fixer (M12), spoken to over a real HTTP + SSE inference box
 * that happens to be `src/fixer/mock-llm.ts`.
 *
 * Three things are worth proving and only one of them is "the model answered":
 *
 *  - the read catalog (FR12.17) answers from LIVE state, not from the prompt —
 *    which is why every assertion here checks a number the script changed a
 *    minute earlier and a canned string could not possibly contain;
 *  - the four tools this round added (`search_codex`, `list_contacts`,
 *    `list_runs`, `get_calendar`) reach the campaign the table is actually
 *    playing, including the GM-only halves, flagged as such;
 *  - `propose_geometry` (FR12.11) produces grid-true geometry and lands as a
 *    DRAFT. Nothing it returns has touched a scene (Principle 8) — asserted by
 *    reading the scene back afterwards, not by trusting the response.
 */
import { MockLlmServer } from '../../src/fixer/mock-llm.js';
import { respond } from './mock-script.js';
import type { Api } from './harness.js';
import type { World } from './setup.js';
import type { Ctx, Dict, Phone, SceneView } from './types.js';

interface ChatTurn {
  text: string;
  tools: { name: string; ok: boolean }[];
  rounds: number;
  snapshotApplied: boolean;
}

interface Generation {
  id: string;
  kind: string;
  status: string;
  output: Dict;
}

interface Status {
  enabled: boolean;
  models: { primary: string; fast: string } | null;
  vision: {
    supported: boolean;
    via: string;
    model: string | null;
    note: string;
    checkedAt: string;
  };
}

export interface FixerResult {
  mock: MockLlmServer;
  /** The Rusted Halo template id, for the firefight's generator calls. */
  templateId: string;
}

export async function fixer(
  ctx: Ctx,
  world: World,
  gm: Api,
  phones: Record<string, Phone>,
  hiddenNames: string[],
): Promise<FixerResult> {
  const { checks, story } = ctx;
  const cid = world.campaignId;
  checks.beat('4 · The Fixer (mock inference box)');
  story.beat('Beat two — the GM asks the Fixer who to worry about');

  const mock = await MockLlmServer.start({ responder: respond });
  process.env['LLM_BASE_URL'] = mock.baseUrl;
  process.env['LLM_MODEL_PRIMARY'] = 'mock-primary';
  process.env['LLM_MODEL_FAST'] = 'mock-fast';
  const status = await gm.get<Status>('/api/fixer/status?probe=refresh');
  checks.eq('AI entry points switch on with LLM_BASE_URL set', true, status.enabled);

  await visionProbe(ctx, gm, status);

  const chat = await gm.post<ChatTurn>('/api/fixer/chat', {
    campaignId: cid,
    message: 'Who looks dangerous here?',
  });
  checks.eq('the model reached for get_scene', ['get_scene'], chat.tools.map((t) => t.name));
  checks.eq('…and the tool ran', true, chat.tools[0]?.ok === true);
  const toolJson = mock.toolResults().map((m) => String(m.content)).join('\n');
  let mainFloorRevealed = false;
  try {
    const parsed = JSON.parse(String(mock.toolResults()[0]?.content ?? '{}')) as {
      fog?: { regions?: { name: string; revealed: boolean }[] };
    };
    mainFloorRevealed = parsed.fog?.regions?.find((r) => r.name === 'Main Floor')?.revealed === true;
  } catch {
    mainFloorRevealed = false;
  }
  checks.record(
    'the tool answered from live state, not from the prompt',
    'all five staged tokens, and the reveal we made a minute ago',
    `${hiddenNames.filter((n) => toolJson.includes(n)).length}/5 token names · Main Floor revealed: ${mainFloorRevealed}`,
    hiddenNames.every((n) => toolJson.includes(n)) && mainFloorRevealed,
  );
  checks.record('the answer quotes the live count back', 'a sentence naming 4 hidden tokens', chat.text, chat.text.includes('4 still hidden'));
  checks.eq('a live session prefixes the situation snapshot (FR12.18)', true, chat.snapshotApplied);
  // The catalog route lists every tool that exists; what matters is the list
  // actually put on the wire, which is where the FR12.11 flag bites.
  const offered = (mock.lastRequest()?.tools ?? []).map((t) => t.function.name);
  checks.record(
    'the model is never offered the tool this box cannot run (FR12.11)',
    'read_map_image absent from the tools sent to the model',
    `${offered.length} tools offered, read_map_image ${offered.includes('read_map_image') ? 'OFFERED' : 'withheld'}`,
    offered.length > 0 && !offered.includes('read_map_image'),
  );
  story.say(`**Fixer:** ${chat.text}`);

  await catalog(ctx, world, gm, mock, phones);
  await library(ctx, world, gm, phones);
  const templateId = await generation(ctx, world, gm);
  await layout(ctx, world, gm);
  return { mock, templateId };
}

// ---------------------------------------------------------------------------
// FR12.11 — "requires a vision-capable local model; the feature hides otherwise"
// ---------------------------------------------------------------------------

/**
 * The capability probe, on a box that cannot read images.
 *
 * This is the ordinary case on the table's hardware: the inference box runs a
 * text-only instruct model, because that is the one that fits. The FR does not
 * ask the app to cope — it asks it to *hide the feature*, which means something
 * has to answer "does this box read images?" before a map is ever sent
 * anywhere. The mock refuses the probe's image content part exactly the way
 * llama.cpp with no projector does (see `mock-script.ts`), so what is asserted
 * here is the real probe path: `GET /props` says nothing, the image probe is
 * refused, and the answer is a clean, explained `supported: false` — not a
 * crash, not a silent success, and not a map read by a model that never looked.
 */
async function visionProbe(ctx: Ctx, gm: Api, status: Status): Promise<void> {
  const { checks, story } = ctx;
  checks.record(
    'the vision probe reports cleanly on a model with no image support (FR12.11)',
    'supported false, via `probe`, with a reason the GM can read',
    `supported ${status.vision.supported} · via ${status.vision.via} · model ${String(
      status.vision.model,
    )} · “${status.vision.note}”`,
    status.vision.supported === false &&
      status.vision.via === 'probe' &&
      status.vision.model === 'mock-primary' &&
      status.vision.note.length > 0,
  );
  checks.record(
    '…and it is an answer, not an outage: the rest of the Fixer is on',
    'enabled true beside vision false',
    `enabled ${status.enabled}, vision ${status.vision.supported}`,
    status.enabled && !status.vision.supported,
  );

  // The one route that needs the capability says so with its own status code,
  // so the button can be hidden before it is ever pressed rather than failing
  // in the GM's hands.
  const refused = await gm.raw('POST', '/api/fixer/read-map', {});
  const body = JSON.parse(refused.body || '{}') as { error?: { code?: string; message?: string } };
  checks.record(
    'the map-vision lane refuses by name rather than pretending',
    '501 vision_unsupported, explaining which box and which model',
    `${refused.status} ${String(body.error?.code)}: ${String(body.error?.message)}`,
    refused.status === 501 &&
      body.error?.code === 'vision_unsupported' &&
      String(body.error?.message).includes('cannot read images'),
  );

  story.say(
    'Before anything else, the app asks the box a question it will not guess at: *do you read images?* The box ' +
      'refuses the test image, which is the answer — so the map-vision half of the layout copilot simply is not ' +
      'there tonight. The model is never offered the tool, the button reports `vision_unsupported` rather than ' +
      'failing in the GM\'s hands, and everything else the Fixer does carries on unaffected.',
  );
}

// ---------------------------------------------------------------------------
// FR12.17 — the four tools this round added
// ---------------------------------------------------------------------------

async function catalog(
  ctx: Ctx,
  world: World,
  gm: Api,
  mock: MockLlmServer,
  phones: Record<string, Phone>,
): Promise<void> {
  const { checks, story } = ctx;
  const cid = world.campaignId;

  const surfaced = await gm.get<{ tools: { name: string; kind: string }[]; reads: number; drafts: number }>(
    '/api/fixer/tools',
  );
  const names = surfaced.tools.map((t) => t.name);
  const wanted = ['search_codex', 'get_page', 'list_contacts', 'list_runs', 'get_calendar'];
  checks.record(
    'the catalog now covers the FR12.17 rows the codex was blocking',
    wanted.join(', '),
    wanted.filter((w) => names.includes(w)).join(', ') || 'none',
    wanted.every((w) => names.includes(w)),
  );
  checks.record(
    '…and every one of them is declared read-only',
    'kind read',
    surfaced.tools.filter((t) => wanted.includes(t.name)).map((t) => `${t.name}:${t.kind}`).join(' '),
    surfaced.tools.filter((t) => wanted.includes(t.name)).every((t) => t.kind === 'read'),
  );

  const turn = await gm.post<ChatTurn>('/api/fixer/chat', {
    campaignId: cid,
    message: 'Brief me on the state of the job: the gang page, who we know, what we are owed, what is coming.',
  });
  checks.eq(
    'one turn reaches all four of them',
    ['search_codex', 'list_contacts', 'list_runs', 'get_calendar'],
    turn.tools.map((t) => t.name),
  );
  checks.record('…and all four ran', 'every tool ok', turn.tools.map((t) => `${t.name}:${t.ok}`).join(' '), turn.tools.every((t) => t.ok));

  const results = mock.toolResults().map((m) => String(m.content));
  const [codex, contacts, runs, calendar] = results.slice(-4);
  const codexHits = JSON.parse(codex ?? '{}') as {
    hits: Array<{ title: string; gmOnly: boolean; snippet: string }>;
  };
  checks.record(
    'search_codex finds the page the GM wrote ten minutes ago',
    'a hit titled "The Rusted Halo"',
    codexHits.hits.map((h) => `${h.title} (gmOnly ${h.gmOnly})`).join(', ') || 'none',
    codexHits.hits.some((h) => h.title === 'The Rusted Halo'),
  );
  const contactState = JSON.parse(contacts ?? '{}') as {
    characters: Array<{ name: string; contacts: Array<{ name: string; connection: number; favors: { owing: number; source: string } }> }>;
  };
  const pell = contactState.characters.flatMap((c) => c.contacts).find((c) => c.name === 'Mr. Pell');
  checks.record(
    'list_contacts reads the contact off the live sheet, favours and all',
    'Mr. Pell, Connection 4, one favour owing, read from the structured field',
    pell ? `${pell.name} C${pell.connection} owing ${pell.favors.owing} (${pell.favors.source})` : 'missing',
    pell?.connection === 4 && pell.favors.owing === 1 && pell.favors.source === 'structured',
  );
  const runState = JSON.parse(runs ?? '{}') as { runs: Array<{ title: string; state: string; johnson: string | null; payout: Dict }> };
  const job = runState.runs.find((r) => r.title === 'Static on the Line');
  checks.record(
    'list_runs knows the job, its state, its Johnson page and its agreed payout',
    'Static on the Line, prep, 8,000¥, linked to the gang page',
    job ? `${job.title} (${job.state}) ${String(job.payout['nuyen'])}¥ · Johnson "${String(job.johnson)}"` : 'missing',
    job?.state === 'prep' && job.payout['nuyen'] === 8000 && job.johnson === 'The Rusted Halo',
  );
  const calendarState = JSON.parse(calendar ?? '{}') as {
    ingameDate: string | null;
    events: Array<{ title: string }>;
    lifestyles: Array<{ characterName: string; overdue: boolean }>;
  };
  checks.record(
    'get_calendar carries the in-game date, the pinned beat and the rent',
    '2076-06-12, the hand-over beat, three lifestyles',
    `${calendarState.ingameDate} · ${calendarState.events.map((e) => e.title).join(', ')} · ${calendarState.lifestyles.length} lifestyle(s)`,
    calendarState.ingameDate === '2076-06-12' &&
      calendarState.events.some((e) => e.title.includes('Hand-over')) &&
      calendarState.lifestyles.length === 3,
  );
  checks.record(
    'reads are free — nothing the four tools did left a draft behind',
    'no new ai_generations rows',
    `${(await gm.get<{ generations: Generation[] }>(`/api/campaigns/${cid}/generations`)).generations.length} generation(s)`,
    (await gm.get<{ generations: Generation[] }>(`/api/campaigns/${cid}/generations`)).generations.length === 0,
  );
  const playerAsked = await phones['Torque']!.api.status('POST', '/api/fixer/chat', {
    campaignId: cid,
    message: 'what do you know',
  });
  checks.eq('…and only the GM ever talks to it', 403, playerAsked);

  story.say(`**Fixer:** ${turn.text}`);
  story.say(
    'None of that came out of the model. Four typed tools ran against the live database while it was waiting — ' +
      'the codex page written before the session, the contact Torque typed on her phone, the job with its ' +
      "payout, the calendar with the hand-over on it — and the model got the answers back to write a sentence " +
      'around. It never sees a number the engine did not give it.',
  );
}

// ---------------------------------------------------------------------------
// The rules library the citations come from (M11 / FR12.14)
// ---------------------------------------------------------------------------

async function library(ctx: Ctx, world: World, gm: Api, phones: Record<string, Phone>): Promise<void> {
  const { checks, story } = ctx;
  const books = await gm.get<{ books: { code: string; pageOffset: number; shared: boolean }[] }>('/api/books');
  const sr5 = books.books.find((b) => b.code === 'SR5');
  if (!sr5) {
    checks.skip('the core rulebook is registered', 'SR5 in the book registry', 'no PDF beside DESIGN.md on this machine');
    return;
  }
  checks.eq('the core rulebook is registered at its measured page offset', 5, sr5.pageOffset);
  checks.eq('…and shared with the whole table (FR11.5)', true, sr5.shared);
  const hits = await phones['Sparrow']!.api.get<{ hits: { book: string; page: number; ref: string; readUrl: string }[] }>(
    '/api/books/search?q=initiative&limit=3',
  );
  checks.record(
    'a player can search the library and gets real page provenance',
    'hits carrying {book, printed page} and a reader URL',
    hits.hits.map((h) => h.ref).join(', ') || 'none',
    hits.hits.length > 0 && hits.hits.every((h) => h.book === 'SR5' && h.page > 0 && h.readUrl.includes('?p=')),
  );
  story.say(
    `The library is already registered — SR5 at its measured +5 offset — so a citation is a page number the ` +
      `server can prove: searching it from a *player's* phone comes back ${hits.hits.map((h) => `\`${h.ref}\``).join(', ')}, ` +
      "each one a tap away from the right page of the GM's own PDF.",
  );
}

// ---------------------------------------------------------------------------
// Seeded generation (FR10.2)
// ---------------------------------------------------------------------------

async function generation(ctx: Ctx, world: World, gm: Api): Promise<string> {
  const { checks, story } = ctx;
  const cid = world.campaignId;
  const templates = await gm.get<{ templates: { id: string; name: string }[] }>(`/api/campaigns/${cid}/npc-templates`);
  const halo = templates.templates.find((t) => t.name.includes('Rusted Halo'));
  if (!halo) throw new Error('seed left no Rusted Halo template');
  const seeds = [20760612, 20760613, 20760614];
  const rolled: { seed: number; npc: Dict }[] = [];
  for (const seed of seeds) {
    rolled.push(await gm.post<{ seed: number; npc: Dict }>('/api/generator/npc', { templateId: halo.id, tierId: 'blooded', seed }));
  }
  const rerun = await gm.post<{ npc: Dict }>('/api/generator/npc', { templateId: halo.id, tierId: 'blooded', seed: seeds[0] });
  checks.record(
    'the same seed reproduces the same ganger, bone for bone',
    'byte-identical NPC',
    `${String(rolled[0]?.npc['name'])} vs ${String(rerun.npc['name'])}`,
    JSON.stringify(rolled[0]?.npc) === JSON.stringify(rerun.npc),
  );
  const names = rolled.map((r) => String(r.npc['name']));
  checks.record('…and three different seeds are three different people', 'three distinct names', names.join(', '), new Set(names).size === 3);
  story.say(
    `Three bodies come off the *Rusted Halo* template at **blooded** in about as long as it takes to say it: ` +
      `${names.join(', ')}. Rerun with the same seed and you get the same three, down to the loadout — which is ` +
      'the difference between a generator and a random number.',
  );
  return halo.id;
}

// ---------------------------------------------------------------------------
// FR12.11 — the layout copilot
// ---------------------------------------------------------------------------

interface GeometryOutput {
  sceneId: string;
  unitM: number;
  rooms: Array<{ name: string; kind: string; sizeM: { w: number; h: number }; areaM2: number }>;
  geometry: { walls: unknown[]; doors: unknown[]; zones: unknown[] };
  fogRegions: Array<{ id: string; name: string }>;
  warnings: string[];
}

async function layout(ctx: Ctx, world: World, gm: Api): Promise<void> {
  const { checks, story } = ctx;
  const cid = world.campaignId;

  // Next week's job, on a scene of its own: a 40 × 30 m plate at 1 m per square.
  const created = await gm.post<{ scene: { id: string; state: string } }>(`/api/campaigns/${cid}/scenes`, {
    name: 'Renraku branch office (unbuilt)',
    grid: { unitM: 1, cols: 40, rows: 30 },
  });
  const sceneId = created.scene.id;
  checks.eq('the GM opens a blank scene for next week', 'draft', created.scene.state);

  const turn = await gm.post<ChatTurn>('/api/fixer/chat', {
    campaignId: cid,
    message: `Lay out the Renraku branch office on scene ${sceneId}: lobby, security checkpoint, server room, exec office.`,
  });
  checks.eq('the model reached for propose_geometry', ['propose_geometry'], turn.tools.map((t) => t.name));

  const drafts = await gm.get<{ generations: Generation[] }>(`/api/campaigns/${cid}/generations?status=draft`);
  const draft = drafts.generations.find((g) => g.kind === 'geometry');
  checks.record(
    'the layout lands as an ai_generations DRAFT, never on the scene',
    'kind geometry, status draft',
    draft ? `${draft.kind} / ${draft.status}` : 'missing',
    draft?.kind === 'geometry' && draft.status === 'draft',
  );
  const out = draft?.output as unknown as GeometryOutput;
  checks.record(
    'it is grid-true: whole squares, and metres from the scene\'s own grid',
    'every room an integer number of 1 m squares, area = w × h',
    out.rooms.map((r) => `${r.name} ${r.sizeM.w}×${r.sizeM.h} m`).join(' · '),
    out.unitM === 1 &&
      out.rooms.length === 4 &&
      out.rooms.every(
        (r) => Number.isInteger(r.sizeM.w) && Number.isInteger(r.sizeM.h) && r.areaM2 === r.sizeM.w * r.sizeM.h,
      ),
  );
  checks.record(
    '…and it compiled walls, doors and unrevealed fog regions the Grid can draw',
    'walls + doors + one named fog region per room',
    `${out.geometry.walls.length} walls · ${out.geometry.doors.length} doors · ${out.fogRegions.map((r) => r.name).join(', ')}`,
    out.geometry.walls.length > 0 && out.geometry.doors.length > 0 && out.fogRegions.length === 4,
  );
  checks.eq('nothing had to be clamped off the plate', [], out.warnings);

  const onTheScene = await gm.get<SceneView>(`/api/scenes/${sceneId}`);
  const geometry = (onTheScene.scene as unknown as { geometry: { walls: unknown[]; doors: unknown[] } }).geometry;
  checks.record(
    'the scene itself is untouched until the GM accepts (Principle 8)',
    'still an empty plate: 0 walls, 0 doors, 0 fog regions',
    `${geometry.walls.length} walls · ${geometry.doors.length} doors · ${onTheScene.scene.fog.regions.length} regions`,
    geometry.walls.length === 0 && geometry.doors.length === 0 && onTheScene.scene.fog.regions.length === 0,
  );

  // The same tool without a model at all (NG7): the GM's own button.
  const direct = await gm.post<{ status: string; counts: { rooms: number } }>('/api/fixer/propose-geometry', {
    campaignId: cid,
    sceneId,
    title: 'Renraku branch office — second pass',
    rooms: [{ name: 'Loading bay', kind: 'storage', x: 0, y: 22, w: 12, h: 8 }],
    doors: [{ room: 'Loading bay', wall: 'n', offset: 4, width: 2, open: true }],
  });
  checks.record(
    'and the GM can reach it with no inference box configured at all (NG7)',
    'a draft straight off the deterministic route',
    `${direct.status} · ${direct.counts.rooms} room(s)`,
    direct.status === 'draft' && direct.counts.rooms === 1,
  );

  story.say(
    'While the crew argues about the roller door, the GM asks the Fixer for next week: *lay out the Renraku ' +
      'branch — lobby, checkpoint, server room, exec office.* The model never draws anything. It fills in four ' +
      'rectangles measured in grid squares, and the server compiles them into ' +
      `${out.geometry.walls.length} walls, ${out.geometry.doors.length} doors and ${out.fogRegions.length} named ` +
      'fog regions on a 1 m grid — as a draft. The scene is still an empty plate until she says otherwise.',
  );
}
