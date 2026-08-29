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
 * over real HTTP + SSE).
 *
 * The beats live in ./playthrough/: `pairing` (join paths + GM sign-in),
 * `prep` (codex, contacts, calendar, the job), `scene` (fog, secrecy, LIVE-2,
 * proximity prompts), `fixer` (the tool catalog and the layout copilot),
 * `combat` + `combat-close` + `edge` (the firefight), and the wrap below.
 */
import { fileURLToPath } from 'node:url';
import { aftermath } from './playthrough/aftermath.js';
import { atomicity } from './playthrough/atomicity.js';
import { combat } from './playthrough/combat.js';
import { fixer } from './playthrough/fixer.js';
import { Api, Checks, Live, Story, settle, writeReport } from './playthrough/harness.js';
import { hints } from './playthrough/hints.js';
import { macros } from './playthrough/macros.js';
import { recapContext } from './playthrough/mock-script.js';
import { pairing } from './playthrough/pairing.js';
import { prep } from './playthrough/prep.js';
import { scene } from './playthrough/scene.js';
import { assignCharacter, boot, teardown, type World } from './playthrough/setup.js';
import { sharedLog } from './playthrough/shared-log.js';
import type { Dict, Phone, SceneView } from './playthrough/types.js';

const REPORT_PATH = fileURLToPath(new URL('../../../docs/demo/SESSION_REPORT.md', import.meta.url));
const KEEP = process.env['PLAYTHROUGH_KEEP'] === '1';

const checks = new Checks();
const story = new Story();
const gaps: string[] = [];
const ctx = { checks, story, gaps };
const ALIASES = ['Torque', 'Whisper', 'Sparrow'] as const;

/** Every persisted roll in the campaign, paged (the route caps a page at 200). */
async function countRolls(gm: Api, campaignId: string): Promise<number> {
  let total = 0;
  let cursor: string | null = null;
  for (let page = 0; page < 20; page++) {
    const q: string = cursor ? `&before=${encodeURIComponent(cursor)}` : '';
    const res: { rolls: { id: string }[]; nextCursor: string | null } = await gm.get(
      `/api/campaigns/${campaignId}/rolls?limit=200${q}`,
    );
    total += res.rolls.length;
    if (!res.nextCursor || res.rolls.length === 0) break;
    cursor = res.nextCursor;
  }
  return total;
}
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

  const phones: Record<string, Phone> = {};
  for (const alias of ALIASES) {
    const invite = await gm.post<{ code: string; role: string }>(`/api/campaigns/${cid}/invites`, {
      role: 'player',
    });
    const joined = await anon.get<{ token: string; role: string; user: { id: string } }>(
      `/api/join/${invite.code}?name=${alias}&label=${encodeURIComponent(`${alias}'s phone`)}`,
    );
    checks.eq(`${alias} joins by code → role`, 'player', joined.role);
    const characterId = world.characterIds[alias];
    if (!characterId) throw new Error(`seed left no character for ${alias}`);
    await assignCharacter(gm, characterId, joined.user.id);
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
  const tvJoin = await anon.get<{ token: string; role: string }>(`/api/join/${tvInvite.code}?name=Table%20TV`);
  checks.eq('the TV joins by code → role', 'display', tvJoin.role);
  const tv = { api: new Api(world.baseUrl, tvJoin.token, 'TV'), live: await ws(tvJoin.token, 'TV') };
  const gmLive = await ws(world.gmToken, 'GM');

  const everyone = [gmLive, tv.live, ...ALIASES.map((a) => phones[a]!.live)];
  await Promise.all(everyone.map((l) => l.next((f) => f.type === 'hello')));
  checks.eq('five sockets connected', 5, (await gm.get<{ connected: number }>(`/api/campaigns/${cid}/live`)).connected);

  const planned = await gm.get<{ sessions: { id: string; state: string }[] }>(`/api/campaigns/${cid}/sessions`);
  const sessionId = planned.sessions[0]?.id;
  if (!sessionId) throw new Error('seed left no planned session');
  const started = await gm.post<{ live: boolean }>(`/api/campaigns/${cid}/sessions/start`, {
    sessionId,
    attendance: ALIASES.slice(),
  });
  checks.eq('GM starts the session → live mode', true, started.live);

  // Plant one GM-only line and prove it never reaches a phone or the TV.
  const SECRET = 'GM-ONLY CANARY: Ratchet took a deposit from a second buyer';
  await gm.post(`/api/campaigns/${cid}/log`, { kind: 'gm-note', text: SECRET, visibility: 'gm' });
  await settle();
  const leaked = [tv.live, ...ALIASES.map((a) => phones[a]!.live)].filter((l) =>
    l.frames.some((f) => JSON.stringify(f).includes('CANARY')),
  );
  checks.record('planted GM-only line reaches the GM socket', 1, gmLive.frames.filter((f) => JSON.stringify(f).includes('CANARY')).length, gmLive.frames.some((f) => JSON.stringify(f).includes('CANARY')));
  checks.record('…and no player/display socket', 'no sockets', leaked.map((l) => l.who).join(',') || 'none', leaked.length === 0);
  checks.record(
    'no gm-visibility frame on any player/display socket',
    'none',
    [tv.live, ...ALIASES.map((a) => phones[a]!.live)].flatMap((l) => l.frames.filter((f) => f.visibility === 'gm').map((f) => f.type)).join(',') || 'none',
    [tv.live, ...ALIASES.map((a) => phones[a]!.live)].every((l) => l.frames.every((f) => f.visibility !== 'gm')),
  );

  story.say(
    'Three phones and a television scan the same square of light off the GM\'s laptop and are on the table\'s ' +
      'network inside ten seconds. No passwords, no accounts — one code each, one device token each.',
  );
  story.say(
    'The GM types a note to herself about the lieutenant and the second buyer. It appears on her laptop and ' +
      'nowhere else: the phones and the TV never receive the bytes, so there is nothing on them to peek at.',
  );

  await pairing(ctx, world, gm, anon, phones);
  await macros(ctx, world, gm, phones);

  // =========================================================================
  // 2–5 — prep, the pier, the Fixer, the firefight
  // =========================================================================
  const written = await prep(ctx, world, gm, phones, gmLive);
  const pier = await scene(ctx, world, gm, phones, tv, gmLive);
  const brain = await fixer(ctx, world, gm, phones, pier.hiddenNames);
  const gmScene = await gm.get<SceneView>(`/api/scenes/${pier.sceneId}`);
  await combat(ctx, world, gm, phones, tv, gmLive, pier.sceneId, brain.templateId, gmScene, pier.hiddenNames);

  // The beats above all read their dice back off `rolls`, which is a different
  // write from the log the table stares at. This one reads the log.
  await sharedLog(ctx, world, gm, phones, gmLive);

  // FR10.10, on the planner path that actually carries role tags onto a row.
  await hints(ctx, gm, phones, cid, written.templateId);
  gaps.push(
    '**FR10.10 reaches only the planner path.** `hintForCombatant` looks the template up ' +
      'through `copilot.generator.templateId`, which only `POST /api/encounters/build` and the ' +
      'grunt-group inserter write. A row added through `POST /api/encounters/:id/combatants` with ' +
      "`source: 'generated', sourceId: <templateId>` — how the pier fight's four gangers were " +
      'built, and how the copilot rack is meant to be used — gets `copilot.generator = ' +
      '{ professionalRating }` and no template, so it is silent even with hints switched on. ' +
      'One line in `EncountersService.addCombatant` (carry `sourceId` into `generator.templateId` ' +
      "when `source === 'generated'`) would close it; nothing here is wrong, it is just narrower " +
      'than the FR reads.',
  );

  // =========================================================================
  // 7 — housekeeping
  // =========================================================================
  checks.beat('7 · Wrap');
  story.beat('After — the housekeeping beat, while everyone is still connected');

  // Two roads into the same ledger, both PENDING until the GM says otherwise:
  // a player proposing their own karma (FR3.6) and the job paying out (FR5.5).
  for (const alias of ALIASES) {
    const phone = phones[alias]!;
    const karma = await phone.api.post<{ entry: { state: string } }>(`/api/characters/${phone.characterId}/ledger`, {
      currency: 'karma',
      delta: 4,
      reason: 'Static on the Line — drone recovered intact',
      sessionId,
    });
    checks.eq(`${alias}'s own karma claim lands pending`, 'pending', karma.entry.state);
  }

  const shares: Record<string, number> = { Torque: 2667, Whisper: 2667, Sparrow: 2666 };
  const runBefore = await gm.get<{ run: { awards: { nuyen: number } } }>(`/api/runs/${written.runId}`);
  const award = await gm.post<{ entries: { id: string; state: string; currency: string; delta: number }[]; state: string }>(
    `/api/runs/${written.runId}/award`,
    {
      reason: 'Static on the Line — share of the hand-over',
      entries: ALIASES.map((alias) => ({
        characterId: phones[alias]!.characterId,
        nuyen: shares[alias],
      })),
    },
  );
  checks.eq('the job posts its payout to the ledger (FR5.5)', 3, award.entries.length);
  checks.record(
    '…as pending rows, not as money (FR5.5 → FR3.6)',
    'state pending on every one',
    [...new Set(award.entries.map((e) => e.state))].join(', '),
    award.entries.every((e) => e.state === 'pending') && award.state === 'pending',
  );
  const runAfter = await gm.get<{ run: { awards: { karma: number; nuyen: number } } }>(`/api/runs/${written.runId}`);
  checks.eq(
    '…and the run itself records what it paid',
    runBefore.run.awards.nuyen + 8000,
    runAfter.run.awards.nuyen,
  );

  const pending = await gm.get<{ entries: { id: string; runId?: string | null }[] }>(`/api/campaigns/${cid}/ledger?state=pending`);
  checks.eq('six proposals wait on the GM', 6, pending.entries.length);
  checks.record(
    '…and the three from the job carry the job that earned them',
    'runId on the three nuyen rows',
    `${pending.entries.filter((e) => e.runId === written.runId).length} of 6 linked`,
    pending.entries.filter((e) => e.runId === written.runId).length === 3,
  );
  const housekeepingBefore = await gm.get<{ housekeeping: { pendingLedger: { id: string }[] } }>(
    `/api/sessions/${sessionId}/housekeeping`,
  );
  checks.eq(
    '…and the housekeeping beat is holding exactly those six',
    6,
    housekeepingBefore.housekeeping.pendingLedger.length,
  );
  for (const entry of pending.entries) await gm.post(`/api/ledger/${entry.id}/approve`);
  let karmaTotal = 0;
  let nuyenTotal = 0;
  for (const alias of ALIASES) {
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
    'Nobody stopped breathing on either side, so the bonus karma stands. Each runner proposes their own award on ' +
      "their own phone, the GM posts the job's payout from the run page, and six pending rows queue up on her " +
      `screen — the three from the job carrying the job. She approves them in one pass and the balances move: ` +
      `4 karma each, ${nuyenTotal.toLocaleString('en-US')}¥ across the crew, every row with a reason attached.`,
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

  // --- the recap draft (FR12.12) -------------------------------------------
  // `draft_recap`, not `draft_wiki_page` with a different prompt: the facts come
  // out of the session log rather than out of the model (D13), and the FR12.19
  // spoiler guard runs unconditionally because a recap is player-facing by
  // definition — FR6.3 posts it to Discord, and with the app offline to players
  // between sessions it is their only window into the campaign.
  recapContext.gangerName = pier.hiddenNames.find((n) => n.includes('pallet')) ?? pier.hiddenNames[0] ?? 'Ratchet — catwalk';
  const sessionBeforeRecap = await gm.get<{ session: { recapMd: string | null } }>(`/api/sessions/${sessionId}`);
  const recapTurn = await gm.post<{ tools: { name: string; ok: boolean }[]; text: string }>('/api/fixer/chat', {
    campaignId: cid,
    message: 'Draft the recap for tonight from the log. It goes to the players.',
  });
  checks.eq(
    'the Fixer reads the log, then drafts the recap through draft_recap (FR12.12)',
    ['get_session_log', 'draft_recap'],
    recapTurn.tools.map((t) => t.name),
  );
  const drafts = await gm.get<{ generations: { id: string; kind: string; status: string; output: Dict }[] }>(
    `/api/campaigns/${cid}/generations?status=draft`,
  );
  const recapDraft = drafts.generations.find((g) => g.kind === 'recap');
  checks.record('nothing was applied — it is an ai_generations draft', 'kind recap, status draft', `${recapDraft?.kind ?? 'missing'} / ${recapDraft?.status ?? 'missing'}`, recapDraft?.kind === 'recap' && recapDraft.status === 'draft');
  const recapMd = String(recapDraft?.output['recapMd'] ?? '');
  const digest = (recapDraft?.output['digest'] ?? {}) as Dict;
  const digestRolls = (digest['rolls'] ?? {}) as { total?: number };
  checks.record(
    '…whose numbers came off the log, not out of the model (D13)',
    'the roll tally and the award lines assembled server-side',
    `${String(digestRolls.total)} public rolls · ${((digest['awards'] ?? []) as unknown[]).length} award line(s) in the body`,
    (digestRolls.total ?? 0) > 0 && recapMd.includes('## What the log says'),
  );
  const flags = (recapDraft?.output['spoilerFlags'] ?? []) as { name: string }[];
  checks.record(
    'the spoiler guard caught the GM-only name in it (FR12.19)',
    `a flag naming "${recapContext.gangerName}"`,
    flags.map((f) => f.name).join(', ') || 'none',
    flags.length > 0 && flags.some((f) => f.name === recapContext.gangerName),
  );
  checks.record(
    '…and it never auto-applied: the session still holds whatever the GM last wrote',
    'session.recapMd untouched by the draft',
    (await gm.get<{ session: { recapMd: string | null } }>(`/api/sessions/${sessionId}`)).session.recapMd ===
      sessionBeforeRecap.session.recapMd
      ? 'unchanged'
      : 'WRITTEN WITHOUT CONSENT',
    (await gm.get<{ session: { recapMd: string | null } }>(`/api/sessions/${sessionId}`)).session.recapMd ===
      sessionBeforeRecap.session.recapMd,
  );
  const accepted = await gm.post<{ applied: { table: string; id: string; note?: string } }>(`/api/generations/${recapDraft?.id}/accept`);
  checks.eq('accepting it writes the draft onto the session, and no further', 'game_sessions', accepted.applied.table);
  checks.eq('…the session it was actually about', sessionId, accepted.applied.id);
  const onSession = await gm.get<{ session: { recapMd: string | null } }>(`/api/sessions/${sessionId}`);
  checks.record(
    '…and publishing to Discord is still a separate GM action (Principle 8)',
    'the markdown on the session, still unpublished',
    `${(onSession.session.recapMd ?? '').length} chars on game_sessions.recap_md`,
    onSession.session.recapMd === recapMd,
  );

  const clean = recapMd.replace(recapContext.gangerName, 'the one on the pallet rows');
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
  const persisted = await countRolls(gm, cid);
  checks.record(
    'the session log counted the whole night, copilot dice included',
    'every persisted roll accounted for by the session',
    `${ended.housekeeping.rolls.total} of ${persisted} persisted rolls, ${ended.housekeeping.rolls.glitches} glitches`,
    ended.housekeeping.rolls.total > 0 && ended.housekeeping.rolls.total === persisted,
  );
  story.say(
    `The GM closes the session. ${ended.housekeeping.rolls.total} rolls are on the record with their pools, ` +
      'their receipts and who could see them — the copilot\'s three-card exchanges among them — and the recap is ' +
      'written, edited and posted before anyone has found their coat.',
  );

  // =========================================================================
  // 8–9 — the two things no in-fiction beat can reach
  // =========================================================================
  // Half-commit: break the event log on purpose and prove the domain rows go
  // with it. Run on the real campaign, after the table has stopped playing.
  await atomicity(ctx, world, gm, phones['Torque']!.characterId);

  // Sockets down first — the server is about to stop for the restart.
  for (const l of everyone) l.close();
  await settle();

  await aftermath({
    ctx,
    world,
    sessionId,
    aliases: ALIASES,
    characterIds: world.characterIds,
  });

  await brain.mock.close();
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
