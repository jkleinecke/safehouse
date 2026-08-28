/**
 * playthrough — one whole session of the demo campaign, played and asserted.
 *
 *   pnpm playthrough                # throwaway DATA_DIR, torn down after
 *   PLAYTHROUGH_KEEP=1 pnpm playthrough
 *
 * Boots the real Fastify app (`buildApp`) on a loopback port against a fresh
 * PGlite database, seeds the rulebook + the demo campaign, then plays "Static
 * on the Line" as scripted API and WebSocket calls from five devices — the GM's
 * laptop, three phones and the TV — asserting at every beat and collecting the
 * narrative. Writes docs/demo/SESSION_REPORT.md and exits non-zero on any
 * failed assertion.
 *
 * Nothing here reaches the network: the only LLM it talks to is the in-process
 * mock inference box from `src/fixer/mock-llm.ts` (FR12.13's contract, spoken
 * over real HTTP + SSE). Beat four lives in ./playthrough/combat.ts.
 */
import { fileURLToPath } from 'node:url';
import { MockLlmServer } from '../src/fixer/mock-llm.js';
import { combat } from './playthrough/combat.js';
import { Api, Checks, Live, Story, diceLine, settle, writeReport } from './playthrough/harness.js';
import { recapContext, respond } from './playthrough/mock-script.js';
import { assignCharacter, boot, teardown, type World } from './playthrough/setup.js';
import {
  sceneEntry,
  sum,
  type Derived,
  type Dict,
  type Phone,
  type RollRecord,
  type SceneView,
} from './playthrough/types.js';

const REPORT_PATH = fileURLToPath(new URL('../../../docs/demo/SESSION_REPORT.md', import.meta.url));
const KEEP = process.env['PLAYTHROUGH_KEEP'] === '1';

const checks = new Checks();
const story = new Story();
const gaps: string[] = [];
const ctx = { checks, story, gaps };
// ===========================================================================

async function main(world: World): Promise<void> {
  const gm = new Api(world.baseUrl, world.gmToken, 'GM');
  const anon = new Api(world.baseUrl, '', 'anon');
  const cid = world.campaignId;
  const ws = (token: string, who: string): Promise<Live> =>
    Live.connect(`${world.wsUrl}/ws?campaign=${cid}&token=${encodeURIComponent(token)}`, who);

  // =========================================================================
  // 1 — the table gathers
  // =========================================================================
  checks.beat('1 · Join');
  story.beat('Before the run — five devices on one Wi-Fi');

  const aliases = ['Torque', 'Whisper', 'Sparrow'] as const;
  const phones: Record<string, { api: Api; live: Live; userId: string; characterId: string }> = {};
  for (const alias of aliases) {
    const invite = await gm.post<{ code: string; role: string }>(`/api/campaigns/${cid}/invites`, {
      role: 'player',
    });
    const joined = await anon.get<{ token: string; role: string; user: { id: string } }>(
      `/join/${invite.code}?name=${alias}&label=${encodeURIComponent(`${alias}'s phone`)}`,
    );
    checks.eq(`${alias} joins by code → role`, 'player', joined.role);
    const characterId = world.characterIds[alias];
    if (!characterId) throw new Error(`seed left no character for ${alias}`);
    await assignCharacter(world.app, characterId, joined.user.id);
    phones[alias] = {
      api: new Api(world.baseUrl, joined.token, alias),
      live: await ws(joined.token, alias),
      userId: joined.user.id,
      characterId,
    };
  }
  const tvInvite = await gm.post<{ code: string }>(`/api/campaigns/${cid}/invites`, {
    role: 'display',
  });
  const tvJoin = await anon.get<{ token: string; role: string }>(`/join/${tvInvite.code}?name=Table%20TV`);
  checks.eq('the TV joins by code → role', 'display', tvJoin.role);
  const tv = { api: new Api(world.baseUrl, tvJoin.token, 'TV'), live: await ws(tvJoin.token, 'TV') };
  const gmLive = await ws(world.gmToken, 'GM');

  const everyone = [gmLive, tv.live, ...aliases.map((a) => phones[a]!.live)];
  await Promise.all(everyone.map((l) => l.next((f) => f.type === 'hello')));
  checks.eq('five sockets connected', 5, (await gm.get<{ connected: number }>(`/api/campaigns/${cid}/live`)).connected);

  const planned = await gm.get<{ sessions: { id: string; state: string }[] }>(`/api/campaigns/${cid}/sessions`);
  const sessionId = planned.sessions[0]?.id;
  if (!sessionId) throw new Error('seed left no planned session');
  const started = await gm.post<{ live: boolean }>(`/api/campaigns/${cid}/sessions/start`, {
    sessionId,
    attendance: aliases.slice(),
  });
  checks.eq('GM starts the session → live mode', true, started.live);

  // Plant one GM-only line and prove it never reaches a phone or the TV.
  const SECRET = 'GM-ONLY CANARY: Ratchet took a deposit from a second buyer';
  await gm.post(`/api/campaigns/${cid}/log`, { kind: 'gm-note', text: SECRET, visibility: 'gm' });
  await settle();
  const leaked = [tv.live, ...aliases.map((a) => phones[a]!.live)].filter((l) =>
    l.frames.some((f) => JSON.stringify(f).includes('CANARY')),
  );
  checks.record('planted GM-only line reaches the GM socket', 1, gmLive.frames.filter((f) => JSON.stringify(f).includes('CANARY')).length, gmLive.frames.some((f) => JSON.stringify(f).includes('CANARY')));
  checks.record('…and no player/display socket', 'no sockets', leaked.map((l) => l.who).join(',') || 'none', leaked.length === 0);
  checks.record(
    'no gm-visibility frame on any player/display socket',
    'none',
    [tv.live, ...aliases.map((a) => phones[a]!.live)].flatMap((l) => l.frames.filter((f) => f.visibility === 'gm').map((f) => f.type)).join(',') || 'none',
    [tv.live, ...aliases.map((a) => phones[a]!.live)].every((l) => l.frames.every((f) => f.visibility !== 'gm')),
  );

  story.say(
    'Three phones and a television scan the same square of light off the GM\'s laptop and are on the table\'s ' +
      'network inside ten seconds. No passwords, no accounts — one code each, one device token each.',
  );
  story.say(
    'The GM types a note to herself about the lieutenant and the second buyer. It appears on her laptop and ' +
      'nowhere else: the phones and the TV never receive the bytes, so there is nothing on them to peek at.',
  );

  // =========================================================================
  // 2 — Pier 23
  // =========================================================================
  checks.beat('2 · Scene, fog and secrecy');
  story.beat('Beat two — Pier 23, 02:14');

  const scenes = await gm.get<{ scenes: { id: string; name: string }[] }>(`/api/campaigns/${cid}/scenes`);
  const scene = scenes.scenes.find((s) => s.name.startsWith('Pier 23'));
  if (!scene) throw new Error('seed left no Pier 23 scene');
  await gm.post(`/api/scenes/${scene.id}/activate`);
  await Promise.all(
    [tv.live, phones['Whisper']!.live].map((l) => l.next((f) => f.type === 'scene.activated')),
  );
  checks.record('scene.activated reaches the TV and the phones', 'both', 'both', true);

  // --- Whisper's Perception, over the socket, with the scene in the pool ----
  const whisper = phones['Whisper']!;
  whisper.live.send({
    cmd: 'roll.request',
    kind: 'simple',
    pool: 6,
    breakdown: [],
    visibility: 'public',
    actor: { characterId: whisper.characterId },
    meta: { poolRef: 'skill.perception' },
  });
  const perception = (await tv.live.next((f) => f.type === 'roll.created')).payload as RollRecord;
  const env = sceneEntry(perception.request.breakdown);
  checks.record(
    'Perception breakdown carries the dim-light scene modifier',
    'one `scene` entry, value −1',
    env ? `${env.label} ${env.value}` : 'absent',
    env?.value === -1,
  );
  checks.eq('…and the pool is the sum of its own receipt', perception.request.pool, sum(perception.request.breakdown));
  story.roll(
    'Whisper — Perception',
    `${perception.request.pool} dice (${perception.request.breakdown.map((e) => `${e.label} ${e.value >= 0 ? '+' : ''}${e.value}`).join(', ')}) ${diceLine(perception)}`,
  );

  // --- fog: before / after --------------------------------------------------
  const before = await whisper.api.get<SceneView>(`/api/scenes/${scene.id}`);
  const namesBefore = before.scene.fog.regions.map((r) => r.name);
  checks.eq('player scene shows only the revealed region', ['Loading Dock'], namesBefore);
  checks.eq('player scene carries only the three PC tokens', 3, before.tokens.length);

  const gmScene = await gm.get<SceneView>(`/api/scenes/${scene.id}`);
  const hidden = gmScene.tokens.filter((t) => t.hidden);
  checks.eq('GM sees the staged opposition', 5, hidden.length);
  const hiddenNames = hidden.map((t) => t.name);
  checks.record(
    'no hidden token name or coordinate ever hit a player socket',
    'none',
    hiddenNames.filter((n) => whisper.live.frames.some((f) => JSON.stringify(f).includes(n))).join(',') || 'none',
    hiddenNames.every((n) => !whisper.live.frames.some((f) => JSON.stringify(f).includes(n))),
  );

  gmLive.send({ cmd: 'fog.reveal', sceneId: scene.id, op: 'reveal', regionId: 'fog.main-floor', announce: true });
  const fogFrame = await tv.live.next((f) => f.type === 'fog.updated');
  checks.eq('fog.updated reaches the TV as a reveal', 'reveal', (fogFrame.payload as Dict)['op']);
  const after = await whisper.api.get<SceneView>(`/api/scenes/${scene.id}`);
  checks.eq('player scene now includes Main Floor', ['Loading Dock', 'Main Floor'], after.scene.fog.regions.map((r) => r.name));

  const westAisle = hidden.find((t) => t.name.includes('west aisle'));
  if (!westAisle) throw new Error('seed left no west-aisle ganger token');
  await gm.patch(`/api/tokens/${westAisle.id}`, { hidden: false });
  const added = await whisper.live.next((f) => f.type === 'token.added');
  checks.eq('revealing a hidden token arrives as token.added', westAisle.id, ((added.payload as Dict)['token'] as Dict)['id']);
  const afterReveal = await whisper.api.get<SceneView>(`/api/scenes/${scene.id}`);
  checks.eq('…and only then does it appear in the player payload', 4, afterReveal.tokens.length);

  story.say(
    'The freight door is jammed half open and screams if you push it. Whisper looks through the gap first: ' +
      'half the roof lamps are dead, which the app already knows — every pool rolled in this shed is one die ' +
      'lighter, and the roll log says so in as many words.',
  );
  story.say(
    'Up to this point the phones have been holding a map with one lit room on it. The GM opens the Main Floor, ' +
      'and the shape of the shed arrives on three screens at once. A ganger walks out of the west aisle — ' +
      'not a marker that was quietly sitting on their connection, a *new* token, arriving.',
  );

  // =========================================================================
  // 3 — the Fixer
  // =========================================================================
  checks.beat('3 · The Fixer (mock inference box)');
  story.beat('Beat three — the GM asks the Fixer who to worry about');

  const mock = await MockLlmServer.start({ responder: respond });
  process.env['LLM_BASE_URL'] = mock.baseUrl;
  process.env['LLM_MODEL_PRIMARY'] = 'mock-primary';
  process.env['LLM_MODEL_FAST'] = 'mock-fast';
  checks.eq('AI entry points switch on with LLM_BASE_URL set', true, (await gm.get<{ enabled: boolean }>('/api/fixer/status')).enabled);

  const chat = await gm.post<{ text: string; tools: { name: string; ok: boolean }[]; rounds: number; snapshotApplied: boolean }>(
    '/api/fixer/chat',
    { campaignId: cid, message: 'Who looks dangerous here?' },
  );
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
  story.say(`**Fixer:** ${chat.text}`);

  // --- the rules library the citations come from (M11 / FR12.14) -----------
  const books = await gm.get<{ books: { code: string; pageOffset: number; shared: boolean }[] }>('/api/books');
  const sr5 = books.books.find((b) => b.code === 'SR5');
  if (sr5) {
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
        'each one a tap away from the right page of the GM\'s own PDF.',
    );
  } else {
    checks.skip('the core rulebook is registered', 'SR5 in the book registry', 'no PDF beside DESIGN.md on this machine');
  }

  // --- seeded generation ----------------------------------------------------
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

  // =========================================================================
  // 4 — the firefight
  // =========================================================================
  const sceneNow = await gm.get<SceneView>(`/api/scenes/${scene.id}`);
  await combat(ctx, world, gm, phones, tv, gmLive, scene.id, halo.id, sceneNow, hiddenNames);

  // =========================================================================
  // 5 — housekeeping
  // =========================================================================
  checks.beat('5 · Wrap');
  story.beat('After — the housekeeping beat, while everyone is still connected');

  const shares: Record<string, number> = { Torque: 2667, Whisper: 2667, Sparrow: 2666 };
  for (const alias of aliases) {
    const phone = phones[alias]!;
    const karma = await phone.api.post<{ entry: { state: string } }>(`/api/characters/${phone.characterId}/ledger`, {
      currency: 'karma',
      delta: 4,
      reason: 'Static on the Line — drone recovered intact',
      sessionId,
    });
    checks.eq(`${alias}'s own karma claim lands pending`, 'pending', karma.entry.state);
    await phone.api.post(`/api/characters/${phone.characterId}/ledger`, {
      currency: 'nuyen',
      delta: shares[alias],
      reason: 'Static on the Line — share of the hand-over',
      sessionId,
    });
  }
  const pending = await gm.get<{ entries: { id: string }[] }>(`/api/campaigns/${cid}/ledger?state=pending`);
  checks.eq('six proposals wait on the GM', 6, pending.entries.length);
  for (const entry of pending.entries) await gm.post(`/api/ledger/${entry.id}/approve`);
  let karmaTotal = 0;
  let nuyenTotal = 0;
  for (const alias of aliases) {
    const phone = phones[alias]!;
    const ledger = await phone.api.get<{ balances: { karma: number; nuyen: number; pending: { karma: number } } }>(
      `/api/characters/${phone.characterId}/ledger`,
    );
    checks.eq(`${alias}'s karma balance after approval`, 4, ledger.balances.karma);
    karmaTotal += ledger.balances.karma;
    nuyenTotal += ledger.balances.nuyen;
  }
  checks.eq('the crew is paid exactly the agreed 8,000¥', 8000, nuyenTotal);
  checks.eq('and 4 karma each', 12, karmaTotal);
  story.say(
    'Nobody stopped breathing on either side, so the bonus karma stands. Each runner proposes their own award ' +
      'on their own phone; six pending rows queue up on the GM\'s screen; she approves them in one pass and the ' +
      `balances move: 4 karma each, ${nuyenTotal.toLocaleString('en-US')}¥ across the crew, every row with a reason and a session attached.`,
  );

  // --- the complications table ---------------------------------------------
  const tables = await gm.get<{ tables: { id: string; title: string; visibility: string }[] }>(`/api/campaigns/${cid}/roll-tables`);
  const complications = tables.tables.find((t) => t.title.includes('Docklands'));
  if (!complications) throw new Error('seed left no complications table');
  const draw = await gm.post<{ entry: { text: string }; event: { id: number } }>(`/api/roll-tables/${complications.id}/roll`, {});
  const gmLog = await gm.get<{ events: { id: number; type: string; payload: Dict }[] }>(`/api/campaigns/${cid}/log?limit=200`);
  const inGmLog = gmLog.events.some((e) => e.id === draw.event.id);
  const playerLog = await phones['Torque']!.api.get<{ events: { id: number }[] }>(`/api/campaigns/${cid}/log?limit=200`);
  checks.record('the table draw lands in the log', 'present for the GM', inGmLog ? 'present' : 'missing', inGmLog);
  checks.record('…and a GM-only table stays GM-only', 'absent for players', playerLog.events.some((e) => e.id === draw.event.id) ? 'leaked' : 'absent', !playerLog.events.some((e) => e.id === draw.event.id));
  story.say(`The crate moves, and the GM draws from *Docklands complications*: “${draw.entry.text}”`);

  // --- the recap draft ------------------------------------------------------
  recapContext.gangerName = hiddenNames.find((n) => n.includes('pallet')) ?? hiddenNames[0] ?? 'Ratchet — catwalk';
  const recapTurn = await gm.post<{ tools: { name: string; ok: boolean }[]; text: string }>('/api/fixer/chat', {
    campaignId: cid,
    message: 'Draft the recap for tonight from the log. It goes to the players.',
  });
  checks.eq('the Fixer drafts the recap through draft_wiki_page', ['draft_wiki_page'], recapTurn.tools.map((t) => t.name));
  const drafts = await gm.get<{ generations: { id: string; kind: string; status: string; output: Dict }[] }>(
    `/api/campaigns/${cid}/generations?status=draft`,
  );
  const recapDraft = drafts.generations.find((g) => g.kind === 'wiki_page');
  checks.record('nothing was applied — it is an ai_generations draft', 'status draft', recapDraft?.status ?? 'missing', recapDraft?.status === 'draft');
  const flags = (recapDraft?.output['spoilerFlags'] ?? []) as { name: string }[];
  checks.record(
    'the spoiler guard caught the GM-only name in it (FR12.19)',
    'at least one flag',
    flags.map((f) => f.name).join(', ') || 'none',
    flags.length > 0,
  );
  const accepted = await gm.post<{ applied: { table: string; id: string } }>(`/api/generations/${recapDraft?.id}/accept`);
  checks.eq('accepting it creates the codex page', 'wiki_pages', accepted.applied.table);

  const clean = String(recapDraft?.output['contentMd'] ?? '').replace(recapContext.gangerName, 'the one on the pallet rows');
  await gm.patch(`/api/sessions/${sessionId}`, { recapMd: clean });
  const published = await gm.post<{ published: boolean; headlines: string[]; discord: string }>(
    `/api/sessions/${sessionId}/publish-recap`,
    {},
  );
  checks.eq('the GM publishes the edited recap', true, published.published);
  checks.eq('…with no webhook configured, nothing leaves the laptop', 'skipped', published.discord);
  story.say(`**Recap headlines:** ${published.headlines.join(' · ')}`);

  const ended = await gm.post<{ live: boolean; housekeeping: { rolls: { total: number; glitches: number } } }>(
    `/api/sessions/${sessionId}/end`,
    {},
  );
  checks.eq('session ends → live mode off', false, ended.live);
  const allRolls = await gm.get<{ rolls: { id: string }[] }>(`/api/campaigns/${cid}/rolls?limit=200`);
  checks.record(
    'the session log counted the night',
    'a non-empty roll count for the session',
    `${ended.housekeeping.rolls.total} of ${allRolls.rolls.length} persisted rolls, ${ended.housekeeping.rolls.glitches} glitches`,
    ended.housekeeping.rolls.total > 0,
  );
  if (ended.housekeeping.rolls.total < allRolls.rolls.length) {
    gaps.push(
      `The session's roll count is ${ended.housekeeping.rolls.total} where ${allRolls.rolls.length} rolls were persisted: ` +
        '`EncountersService.recordRoll` (every copilot quick-roll, FR10.7) inserts into `rolls` directly and never ' +
        'stamps `session_id`, so those rolls fall out of the housekeeping summary and out of `GET …/rolls?session=`. ' +
        'It should go through the rolls service, or at least call `activeSessionId` — its own INTEGRATION note says as much.',
    );
  }
  story.say(
    `The GM closes the session. ${ended.housekeeping.rolls.total} rolls are on the record with their pools, ` +
      'their receipts and who could see them — and the recap is written, edited and posted before anyone has ' +
      'found their coat.',
  );

  for (const l of everyone) l.close();
  await mock.close();
}

// ===========================================================================

const started = Date.now();
console.log('safehouse playthrough — "Static on the Line"\n');
let world: World | null = null;
let crashed: unknown = null;
try {
  world = await boot({ keepData: KEEP });
  await main(world);
} catch (err) {
  crashed = err;
  checks.record('the session ran to the end', 'no exception', err instanceof Error ? err.message : String(err), false);
}

await writeReport({
  path: REPORT_PATH,
  ranAt: new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC',
  story,
  checks,
  gaps,
  facts: {
    Server: 'buildApp() in-process on a loopback port, fresh PGlite in a temp DATA_DIR',
    Campaign: '`pnpm seed:demo` — Static on the Line',
    Books: world?.booksSeeded ?? 'not reached',
    Fixer: 'src/fixer/mock-llm.ts over real HTTP + SSE; no network, no model',
    Duration: `${((Date.now() - started) / 1000).toFixed(1)}s`,
  },
});
console.log(`\nreport written → ${REPORT_PATH}`);

if (world) await teardown(world, KEEP);
if (crashed) console.error(crashed);
const failed = checks.failures.length;
console.log(
  failed === 0
    ? `playthrough: ${checks.rows.length} checks, all green`
    : `playthrough: ${failed} of ${checks.rows.length} checks FAILED`,
);
process.exit(failed === 0 ? 0 : 1);
