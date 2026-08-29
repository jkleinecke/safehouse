/**
 * Beat three — Pier 23: the scene goes live, fog opens a room at a time, and
 * the dim light lands in the dice.
 *
 * Two defects found by driving the real app live in a browser are pinned here:
 *
 *  - **LIVE-2.** The active scene's environment was applied TWICE — once by the
 *    server's derived pool, once again by the roll dialog re-sending it as a
 *    situational chip — so the sheet said Perception 5 and the dialog offered
 *    four dice, and the persisted receipt carried the same scene line twice.
 *    One authority: the server's. The regression check is the arithmetic
 *    property that broke — `pool === sum(breakdown)` with exactly one `scene`
 *    entry — asserted against the roll as PERSISTED, three ways in.
 *  - **FR12.8 proximity.** A token walking up to a still-fogged named region
 *    nudges the GM, and only the GM: unrevealed regions and hidden tokens are
 *    precisely what players must not learn about (Principle 4).
 */
import { diceLine, settle, type Api, type Live } from './harness.js';
import type { World } from './setup.js';
import {
  sceneEntry,
  sum,
  type Ctx,
  type Derived,
  type Dict,
  type Entry,
  type Phone,
  type RollRecord,
  type SceneView,
} from './types.js';

export interface SceneResult {
  sceneId: string;
  /** GM-visible names of the tokens still staged behind the fog. */
  hiddenNames: string[];
}

const sceneEntries = (b: Entry[]): Entry[] => b.filter((e) => e.source === 'scene');

export async function scene(
  ctx: Ctx,
  world: World,
  gm: Api,
  phones: Record<string, Phone>,
  tv: { api: Api; live: Live },
  gmLive: Live,
): Promise<SceneResult> {
  const { checks, story } = ctx;
  const cid = world.campaignId;
  checks.beat('3 · Scene, fog and secrecy');
  story.beat('Beat one — Pier 23, 02:14');

  const scenes = await gm.get<{ scenes: { id: string; name: string }[] }>(`/api/campaigns/${cid}/scenes`);
  const found = scenes.scenes.find((s) => s.name.startsWith('Pier 23'));
  if (!found) throw new Error('seed left no Pier 23 scene');
  const sceneId = found.id;
  await gm.post(`/api/scenes/${sceneId}/activate`);
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

  await liveTwo(ctx, gm, whisper, perception);

  // --- fog: before / after --------------------------------------------------
  const before = await whisper.api.get<SceneView>(`/api/scenes/${sceneId}`);
  checks.eq('player scene shows only the revealed region', ['Loading Dock'], before.scene.fog.regions.map((r) => r.name));
  checks.eq('player scene carries only the three PC tokens', 3, before.tokens.length);

  const gmScene = await gm.get<SceneView>(`/api/scenes/${sceneId}`);
  const hidden = gmScene.tokens.filter((t) => t.hidden);
  checks.eq('GM sees the staged opposition', 5, hidden.length);
  const hiddenNames = hidden.map((t) => t.name);
  checks.record(
    'no hidden token name or coordinate ever hit a player socket',
    'none',
    hiddenNames.filter((n) => whisper.live.frames.some((f) => JSON.stringify(f).includes(n))).join(',') || 'none',
    hiddenNames.every((n) => !whisper.live.frames.some((f) => JSON.stringify(f).includes(n))),
  );

  gmLive.send({ cmd: 'fog.reveal', sceneId, op: 'reveal', regionId: 'fog.main-floor', announce: true });
  const fogFrame = await tv.live.next((f) => f.type === 'fog.updated');
  checks.eq('fog.updated reaches the TV as a reveal', 'reveal', (fogFrame.payload as Dict)['op']);
  const after = await whisper.api.get<SceneView>(`/api/scenes/${sceneId}`);
  checks.eq('player scene now includes Main Floor', ['Loading Dock', 'Main Floor'], after.scene.fog.regions.map((r) => r.name));

  const westAisle = hidden.find((t) => t.name.includes('west aisle'));
  if (!westAisle) throw new Error('seed left no west-aisle ganger token');
  await gm.patch(`/api/tokens/${westAisle.id}`, { hidden: false });
  const added = await whisper.live.next((f) => f.type === 'token.added');
  checks.eq('revealing a hidden token arrives as token.added', westAisle.id, ((added.payload as Dict)['token'] as Dict)['id']);
  const afterReveal = await whisper.api.get<SceneView>(`/api/scenes/${sceneId}`);
  checks.eq('…and only then does it appear in the player payload', 4, afterReveal.tokens.length);

  story.say(
    'The freight door is jammed half open and screams if you push it. Whisper looks through the gap first: ' +
      'half the roof lamps are dead, which the app already knows — every pool rolled in this shed is one die ' +
      'lighter, and the roll log says so in as many words. Once.',
  );
  story.say(
    'Up to this point the phones have been holding a map with one lit room on it. The GM opens the Main Floor, ' +
      'and the shape of the shed arrives on three screens at once. A ganger walks out of the west aisle — ' +
      'not a marker that was quietly sitting on their connection, a *new* token, arriving.',
  );

  await proximity(ctx, gm, phones, tv, gmLive, sceneId, cid);
  return { sceneId, hiddenNames };
}

// ---------------------------------------------------------------------------
// LIVE-2 — one authority for the scene's environment
// ---------------------------------------------------------------------------

/**
 * The sheet, the clean roll and the two shapes the buggy client sent must all
 * agree on the same number, and every persisted receipt must sum to its own
 * pool with exactly one `scene` line in it.
 */
async function liveTwo(ctx: Ctx, gm: Api, whisper: Phone, clean: RollRecord): Promise<void> {
  const { checks, story } = ctx;
  const sheet = await gm.get<Derived>(`/api/characters/${whisper.characterId}/derived`);
  const shown = sheet.derived.pools['skill.perception']?.total ?? -1;
  const cleanScene = sceneEntries(clean.request.breakdown);

  checks.eq(
    'the sheet and the roll agree on the pool (LIVE-2: they did not)',
    shown,
    clean.request.pool,
  );
  checks.record(
    'the persisted receipt names the scene exactly once',
    'one `scene` entry',
    cleanScene.map((e) => `${e.label} ${e.value}`).join(' · ') || 'none',
    cleanScene.length === 1,
  );

  // Shape 1: the dialog re-sends the scene as a removable situational chip.
  const chipped = await whisper.api.post<{ roll: RollRecord }>('/api/rolls', {
    kind: 'simple',
    pool: clean.request.pool - 1,
    breakdown: [],
    visibility: 'public',
    actor: { characterId: whisper.characterId },
    meta: {
      poolRef: 'skill.perception',
      mods: [
        {
          id: 'scene.light.echo',
          source: { kind: 'scene' },
          target: 'pool.all',
          op: 'add',
          value: -1,
          active: true,
          note: 'dim light (client chip)',
        },
      ],
    },
  });
  const chippedScene = sceneEntries(chipped.roll.request.breakdown);
  checks.record(
    'a client that re-sends the scene as a chip does not pay for it twice',
    `pool ${clean.request.pool}, one \`scene\` entry`,
    `pool ${chipped.roll.request.pool}, ${chippedScene.length} scene entr${chippedScene.length === 1 ? 'y' : 'ies'}`,
    chipped.roll.request.pool === clean.request.pool && chippedScene.length === 1,
  );
  checks.eq(
    '…and that roll still sums to its own receipt',
    chipped.roll.request.pool,
    sum(chipped.roll.request.breakdown),
  );

  // Shape 2: the receipt itself arrives with the scene line duplicated — the
  // exact bytes the browser persisted the night this was found.
  const doubled = [...clean.request.breakdown, ...cleanScene];
  const echoed = await whisper.api.post<{ roll: RollRecord }>('/api/rolls', {
    kind: 'simple',
    pool: clean.request.pool - 1,
    breakdown: doubled,
    visibility: 'public',
    actor: { characterId: whisper.characterId },
    meta: { note: 'free-form pool typed with the scene already in it' },
  });
  const echoedScene = sceneEntries(echoed.roll.request.breakdown);
  checks.record(
    'a receipt that names the scene twice is repaired, and the dice are given back',
    `one \`scene\` entry, pool ${clean.request.pool}`,
    `${echoedScene.length} scene entr${echoedScene.length === 1 ? 'y' : 'ies'}, pool ${echoed.roll.request.pool}`,
    echoedScene.length === 1 && echoed.roll.request.pool === clean.request.pool,
  );
  checks.eq(
    '…and it too sums to its own receipt',
    echoed.roll.request.pool,
    sum(echoed.roll.request.breakdown),
  );
  const refused = (echoed.roll.request as unknown as { meta?: Dict }).meta?.['dedupedScene'];
  checks.record(
    '…and the log records what it refused, rather than quietly fixing it',
    'a `dedupedScene` note on the stored roll',
    JSON.stringify(refused ?? null),
    Array.isArray(refused) && refused.length === 1,
  );

  story.say(
    `Whisper's sheet says Perception **${shown}**. The roll dialog offers ${shown} dice, the server rolls ` +
      `${shown}, and the receipt on the log adds up to ${shown} with the shed's dim light in it exactly once. ` +
      'That reads like nothing at all, which is the point: for one build the scene was counted twice and the ' +
      'dialog quietly offered a die fewer than the sheet.',
  );
}

// ---------------------------------------------------------------------------
// FR12.8 — "they're at the office door, reveal?"
// ---------------------------------------------------------------------------

interface Suggestion {
  kind: string;
  sceneName: string;
  radiusM: number;
  prompts: Array<{ tokenName: string; regionName: string; distanceM: number; tokenHidden: boolean }>;
  action: { tool: string; regions: string[] };
}

async function proximity(
  ctx: Ctx,
  gm: Api,
  phones: Record<string, Phone>,
  tv: { api: Api; live: Live },
  gmLive: Live,
  sceneId: string,
  campaignId: string,
): Promise<void> {
  const { checks, story } = ctx;
  const gmScene = await gm.get<SceneView>(`/api/scenes/${sceneId}`);
  const sparrowToken = gmScene.tokens.find((t) => t.name === 'Sparrow');
  if (!sparrowToken) throw new Error('seed left no Sparrow token');
  const home = { x: sparrowToken.x, y: sparrowToken.y };

  // The office is a named region nobody has revealed. Two metres from its wall
  // is "at the door"; the default ring is three.
  gmLive.send({ cmd: 'token.move', tokenId: sparrowToken.id, x: 22, y: 16 });
  const frame = await gmLive.next(
    (f) => f.type === 'fixer.suggestion' && (f.payload as Dict)['kind'] === 'fog_proximity',
  );
  const suggestion = frame.payload as unknown as Suggestion;
  const atTheDoor = suggestion.prompts.find(
    (p) => p.tokenName === 'Sparrow' && p.regionName === 'Office',
  );
  checks.record(
    'a token at an unrevealed region nudges the GM (FR12.8)',
    'Sparrow, ~2 m from the Office, inside the 3 m ring',
    atTheDoor ? `${atTheDoor.tokenName} → ${atTheDoor.regionName} at ${atTheDoor.distanceM} m` : 'no prompt',
    atTheDoor !== undefined && atTheDoor.distanceM <= suggestion.radiusM,
  );
  checks.record(
    '…and it suggests, it never reveals',
    'a pointer at suggest_fog_reveal, sent ephemerally',
    `${suggestion.action.tool} · ephemeral ${String(frame.ephemeral)}`,
    suggestion.action.tool === 'suggest_fog_reveal' && frame.ephemeral === true,
  );
  const stillFogged = await phones['Sparrow']!.api.get<SceneView>(`/api/scenes/${sceneId}`);
  checks.record(
    '…so the Office is still fogged on the phones',
    'no Office region in the player payload',
    stillFogged.scene.fog.regions.map((r) => r.name).join(', '),
    !stillFogged.scene.fog.regions.some((r) => r.name === 'Office'),
  );
  await settle();
  const leaked = [tv.live, ...Object.values(phones).map((p) => p.live)].filter((l) =>
    l.frames.some((f) => f.type === 'fixer.suggestion'),
  );
  checks.record(
    'the prompt reaches no player or display socket at all',
    'none',
    leaked.map((l) => l.who).join(', ') || 'none',
    leaked.length === 0,
  );
  const aboutHidden = suggestion.prompts.filter((p) => p.tokenHidden);
  checks.record(
    '…which matters, because it names the tokens they cannot see',
    'at least one prompt about a hidden token',
    aboutHidden.map((p) => `${p.tokenName} → ${p.regionName}`).join(' · ') || 'none',
    aboutHidden.length > 0,
  );

  const log = await gm.get<{ events: { type: string }[] }>(`/api/campaigns/${campaignId}/log?limit=200`);
  checks.record(
    '…and it is never written down, so a replay cannot leak it either',
    'no fixer.suggestion in the persisted event log',
    log.events.filter((e) => e.type === 'fixer.suggestion').length === 0 ? 'absent' : 'persisted',
    log.events.every((e) => e.type !== 'fixer.suggestion'),
  );

  // Put her back where the fight expects her.
  gmLive.send({ cmd: 'token.move', tokenId: sparrowToken.id, x: home.x, y: home.y });
  await settle();
  const restored = (await gm.get<SceneView>(`/api/scenes/${sceneId}`)).tokens.find(
    (t) => t.id === sparrowToken.id,
  );
  checks.eq('the token walks back and the server has the final say on where it is', home, {
    x: restored?.x,
    y: restored?.y,
  });

  story.say(
    'Sparrow works east along the pallet rows and stops two metres short of the office door. Nothing on the map ' +
      'changes — but a line appears on the GM\'s panel and nowhere else: *Sparrow is 2.0 m from "Office" — ' +
      'reveal?* It names tokens the players do not know exist, so it is GM-only and it is never written down.',
  );
}
