/**
 * Beat four — the extraction firefight, front half.
 *
 * Stages the encounter off the map (FR9.10), swaps the token placeholders for
 * statblocks the generator rolled (FR10.2), rolls initiative and walks the
 * FR4.3 pass loop, then resolves Torque's exchange card by card (FR10.8) and
 * her Edge-pushed follow-up. The rest of the fight is `./combat-close.ts` —
 * one continuous encounter, split for file length.
 */
import { closeFight } from './combat-close.js';
import { diceLine, type Api, type Live } from './harness.js';
import type { World } from './setup.js';
import {
  dist,
  type Combatant,
  type Ctx,
  type Derived,
  type Dict,
  type Entry,
  type Phone,
  type RollResult,
  type SceneView,
} from './types.js';

export async function combat(
  ctx: Ctx,
  world: World,
  gm: Api,
  phones: Record<string, Phone>,
  tv: { api: Api; live: Live },
  gmLive: Live,
  sceneId: string,
  templateId: string,
  gmScene: SceneView,
  hiddenNames: string[],
): Promise<void> {
  const { checks, story, gaps } = ctx;
  checks.beat('4 · The extraction firefight');
  story.beat('Beat four — the extraction, 02:31');
  const cid = world.campaignId;

  // --- stage from the map (FR9.10) -----------------------------------------
  const staged = await gm.post<{ encounterId: string; combatantIds: string[] }>(
    `/api/scenes/${sceneId}/stage-encounter`,
    { name: 'Pier 23 — the extraction' },
  );
  const eid = staged.encounterId;
  const stillHidden = gmScene.tokens.filter((t) => t.hidden).map((t) => t.name);
  checks.eq('every character/NPC token on the map became a combatant', 8, staged.combatantIds.length);
  const playerView = await phones['Torque']!.api.get<{ combatants: { name: string }[]; scope: string }>(`/api/encounters/${eid}`);
  checks.eq('the phones see only what has been revealed', 4, playerView.combatants.length);
  checks.record(
    'the four hidden rows are absent, not redacted',
    'no still-hidden name anywhere in the player payload',
    stillHidden.filter((n) => JSON.stringify(playerView).includes(n)).join(', ') || 'none',
    stillHidden.length === 4 && stillHidden.every((n) => !JSON.stringify(playerView).includes(n)),
  );

  let roster = (await gm.get<{ combatants: Combatant[] }>(`/api/encounters/${eid}`)).combatants;

  // Staging knows a token, not a sheet: the NPC rows land without statblocks
  // and every initiative line reads REA+INT off the RAW sheet, so augments and
  // adept powers are missing. The GM fixes both before the first die.
  const torqueDerived = await gm.get<Derived>(`/api/characters/${phones['Torque']!.characterId}/derived`);
  const stagedTorque = roster.find((c) => c.name === 'Torque')!;
  const trueBase = torqueDerived.derived.initiative.physical.base.value;
  const trueDice = torqueDerived.derived.initiative.physical.dice.value;
  if (stagedTorque.initDice !== trueDice || stagedTorque.initBase !== trueBase) {
    gaps.push(
      '`POST /api/scenes/:id/stage-encounter` builds initiative lines from the raw sheet ' +
        `(\`REA + INT\`, 1d6): it staged Torque at ${stagedTorque.initBase} + ${stagedTorque.initDice}d6 where the ` +
        `engine derives ${trueBase} + ${trueDice}d6 — wired reflexes and adept powers are dropped. ` +
        '`services/scenes.ts stageEncounter` should call `deriveFor(sheet, kind)` the way `addCombatant` does.',
    );
  }
  for (const alias of ['Torque', 'Whisper', 'Sparrow'] as const) {
    const d = await gm.get<Derived>(`/api/characters/${phones[alias]!.characterId}/derived`);
    const row = roster.find((c) => c.name === alias)!;
    await gm.post(`/api/combatants/${row.id}/initiative`, {
      base: d.derived.initiative.physical.base.value,
      dice: d.derived.initiative.physical.dice.value,
      kind: 'physical',
    });
  }

  // --- swap the placeholders for rolled statblocks (FR10.2) ----------------
  const gangerTokens = gmScene.tokens.filter((t) => t.name.startsWith('Halo ganger'));
  const placeholders = roster.filter((c) => c.source === 'npc_template');
  for (const row of placeholders) await gm.del(`/api/combatants/${row.id}`);
  const gangers: Combatant[] = [];
  const gangerGuns: Record<string, { name: string; modes: string[] }> = {};
  for (let i = 0; i < gangerTokens.length; i++) {
    const token = gangerTokens[i]!;
    const gen = await gm.post<{ npc: { name: string; sheet: { weapons: { name: string; modes: string[] }[] }; professionalRating: number } }>(
      '/api/generator/npc',
      { templateId, tierId: 'blooded', seed: 20760612 + i },
    );
    const created = await gm.post<{ combatant: Combatant }>(`/api/encounters/${eid}/combatants`, {
      source: 'generated',
      sourceId: templateId,
      name: `Ganger-${i + 1} · ${gen.npc.name}`,
      sheet: gen.npc.sheet,
      tokenId: token.id,
      visibility: token.hidden ? 'gm' : 'public',
    });
    gangers.push(created.combatant);
    const gun = gen.npc.sheet.weapons[0];
    if (gun) gangerGuns[created.combatant.id] = { name: gun.name, modes: gun.modes };
  }
  const rackBefore = await gm.get<{ woundModifier: number; entries: { key: string; pool: number }[] }>(
    `/api/combatants/${gangers[0]!.id}/quick-rolls`,
  );
  checks.eq('four rolled gangers stand the shed up', 4, gangers.length);
  checks.eq('an unhurt ganger carries no wound modifier', 0, rackBefore.woundModifier);
  checks.record(
    'a combatant added with a sheet derives its own monitors',
    'physical track sized from BOD',
    gangers.map((g) => g.monitors.physical.max).join('/'),
    gangers.every((g) => g.monitors.physical.max >= 9),
  );
  gaps.push(
    '`POST /api/encounters/:id/combatants` has no way to carry a Professional Rating onto the row ' +
      '(`copilot.generator` is set only by the generator\'s own encounter builder), so FR10.9 morale for ' +
      'hand-added NPCs measures pressure against PR 0. `AddCombatantBody` needs a `professionalRating` field.',
  );

  await gm.patch(`/api/encounters/${eid}`, { state: 'live' });
  story.say(
    'The crate is chest-high and second from the bottom, and moving it takes two people. That is the moment ' +
      'somebody on the catwalk decides to find out who is downstairs.',
  );
  story.say(
    'The GM does not build an encounter: she launches one off the map. Every token that is a person becomes a ' +
      'row in the tracker, the four Halo bodies come off the *blooded* tier of the gang\'s own template, and the ' +
      'phones are handed exactly the rows they are allowed to know exist.',
  );

  // --- initiative (FR4.2) ---------------------------------------------------
  const init = await gm.post<{ details: { combatantId: string; base: number; dice: number; rolls: number[]; score: number }[] }>(
    `/api/encounters/${eid}/roll-initiative`,
    {},
  );
  roster = (await gm.get<{ combatants: Combatant[] }>(`/api/encounters/${eid}`)).combatants;
  const byId = (id: string): Combatant => roster.find((c) => c.id === id)!;
  const torque = roster.find((c) => c.name === 'Torque')!;
  const sparrow = roster.find((c) => c.name === 'Sparrow')!;
  const whisperC = roster.find((c) => c.name === 'Whisper')!;
  const torqueInit = init.details.find((d) => d.combatantId === torque.id)!;
  checks.eq('Torque rolls two initiative dice (wired reflexes)', 2, torqueInit.rolls.length);
  checks.eq('…on the engine-derived base REA+INT', torqueDerived.derived.initiative.physical.base.value, torqueInit.base);
  checks.eq('Sparrow rolls two as well (Quickened Reflexes)', 2, init.details.find((d) => d.combatantId === sparrow.id)!.rolls.length);
  checks.eq('Whisper, unaugmented, rolls one', 1, init.details.find((d) => d.combatantId === whisperC.id)!.rolls.length);
  story.roll(
    'Initiative',
    init.details
      .map((d) => `${byId(d.combatantId).name} ${d.base}+${d.rolls.join('+')} = **${d.score}**`)
      .join(' · '),
  );

  story.say(
    'Torque and Sparrow both roll two initiative dice and neither of them typed that in: the wired reflexes on ' +
      'one sheet and the adept power on the other are ordinary modifiers, and the tracker asked the engine.',
  );

  // --- the pass loop (FR4.3) ------------------------------------------------
  const order = [...roster]
    .filter((c) => c.initScore > 0)
    .sort((a, b) => b.initScore - a.initScore || b.initBase - a.initBase || (a.id < b.id ? -1 : 1));
  const first = await gm.post<{ acted: Combatant | null; active: Combatant | null }>(`/api/encounters/${eid}/next-actor`, {});
  checks.eq('the highest Initiative Score acts first', order[0]!.id, first.acted?.id);

  const ganger1 = gangers[0]!;
  let actors = 1;
  for (let guard = 0; guard < 20; guard++) {
    const step = await gm.post<{ acted: Combatant | null; active: Combatant | null }>(`/api/encounters/${eid}/next-actor`, {});
    if (!step.acted) break;
    actors++;
    if (!step.active) break;
  }
  checks.eq('everyone above 0 acts exactly once in the pass', order.length, actors);

  const passBefore = (await gm.get<{ encounter: { pass: number; turn: number } }>(`/api/encounters/${eid}`)).encounter;
  const scoresBefore = new Map((await gm.get<{ combatants: Combatant[] }>(`/api/encounters/${eid}`)).combatants.map((c) => [c.id, c.initScore]));
  const passEnd = await gm.post<{ encounter: { pass: number }; combatants: Combatant[]; anyActive: boolean }>(
    `/api/encounters/${eid}/end-pass`,
    {},
  );
  const dropped = passEnd.combatants.every((c) => c.initScore === Math.max(0, (scoresBefore.get(c.id) ?? 0) - 10));
  checks.record('end of pass takes 10 off every score', 'score − 10, floored at 0', dropped ? 'every row' : 'mismatch', dropped);
  checks.eq('the pass counter advances', passBefore.pass + 1, passEnd.encounter.pass);
  if (passBefore.turn === 0 || passBefore.pass === 0) {
    gaps.push(
      'An encounter that is staged (or created through `POST /api/campaigns/:id/encounters`) and then rolled ' +
        `starts at turn ${passBefore.turn} / pass ${passBefore.pass}: only \`newTurn\` ever initialises those columns, ` +
        'so the tracker reads a pass behind for the whole first turn (FR4.3 "the UI always shows current pass"). ' +
        '`rollInitiativeAll` should set `turn = max(1, turn)` and `pass = 1` when the encounter has not started.',
    );
  }

  story.say(
    'Everyone above zero acts once, then every score in the shed drops by ten and the ones still standing above ' +
      'zero go again. Nobody at the table counts anything.',
  );

  const torquePass2 = passEnd.combatants.find((c) => c.id === torque.id)!;
  if ((scoresBefore.get(torque.id) ?? 0) > 10) {
    checks.record('Torque acts twice in turn 1', 'still above 0 after −10', `${scoresBefore.get(torque.id)} → ${torquePass2.initScore}`, torquePass2.initScore > 0);
  } else {
    checks.skip('Torque acts twice in turn 1', 'score ≥ 11 after the roll', `rolled ${scoresBefore.get(torque.id)} — one pass only this turn`);
  }

  // --- Torque vs Ganger-1: the whole exchange, step by step (FR10.8) --------
  const torqueToken = gmScene.tokens.find((t) => t.name === 'Torque')!;
  const g1Token = gmScene.tokens.find((t) => t.id === ganger1.tokenId)!;
  const metres = dist(torqueToken, g1Token);
  const rollsBeforeChain = (await gm.get<{ rolls: { id: string }[] }>(`/api/campaigns/${cid}/rolls?limit=200`)).rolls.length;
  type Chain = {
    cards: { step: string; label: string; data: Dict }[];
    suggested: { boxes: number; track: string } | null;
    notes: string[];
  };
  const shoot = (): Promise<Chain> =>
    gm.post<Chain>(`/api/encounters/${eid}/resolve-chain`, {
      attackerId: torque.id,
      defenderId: ganger1.id,
      weaponName: 'Hammer',
      distanceM: metres,
      mode: 'SA',
    });
  // She keeps firing until something connects — the shed is four seconds of
  // noise, not one tidy exchange. Nothing is persisted by a chain that misses.
  let chain = await shoot();
  for (let shot = 1; shot < 4 && !chain.suggested; shot++) {
    const missed = chain.cards.find((c) => c.step === 'attack')!;
    story.roll(
      `Torque — Hammer, shot ${shot}`,
      `${missed.data['pool']} dice ${diceLine(missed.data['roll'] as RollResult)} — ${String(chain.notes[0] ?? 'no effect')}`,
    );
    chain = await shoot();
  }
  const attackCard = chain.cards.find((c) => c.step === 'attack')!;
  const attackBreakdown = attackCard.data['breakdown'] as Entry[];
  checks.eq('the chain walks attack → defense', ['attack', 'defense'], chain.cards.slice(0, 2).map((c) => c.step));
  checks.eq('the attack is capped by the weapon\'s Accuracy', { kind: 'accuracy', value: 5 }, attackCard.data['limit']);
  checks.record(
    'the shot carries the scene and the range band in its receipt',
    'a `scene` −1 and a `range` −1 (medium, heavy pistol)',
    attackBreakdown.filter((e) => e.source === 'scene' || e.source === 'range').map((e) => `${e.label} ${e.value}`).join(' · ') || 'none',
    attackBreakdown.some((e) => e.source === 'scene' && e.value === -1) &&
      attackBreakdown.some((e) => e.source === 'range' && e.value === -1),
  );
  const attackRoll = attackCard.data['roll'] as RollResult;
  const defenseCard = chain.cards.find((c) => c.step === 'defense')!;
  const defenseRoll = defenseCard.data['roll'] as RollResult;
  checks.eq(
    'net hits are the attacker\'s limited hits minus the defence',
    attackRoll.limitedHits - defenseRoll.hits,
    defenseCard.data['netHits'],
  );
  story.roll(
    'Torque — Hammer, single shot',
    `${attackCard.data['pool']} dice at ${metres} m ${diceLine(attackRoll)} vs defence ${defenseCard.data['pool']} ${diceLine(defenseRoll)} → ${String(defenseCard.data['netHits'])} net`,
  );

  if (chain.suggested) {
    const damageCard = chain.cards.find((c) => c.step === 'damage')!;
    const soakCard = chain.cards.find((c) => c.step === 'soak')!;
    const soakRoll = soakCard.data['roll'] as RollResult;
    checks.eq(
      'modified DV is the weapon\'s DV plus net hits',
      (damageCard.data['base'] as { value: number }).value + (defenseCard.data['netHits'] as number),
      damageCard.data['modifiedDv'],
    );
    checks.eq(
      'boxes are modified DV minus soak hits',
      Math.max(0, (damageCard.data['modifiedDv'] as number) - soakRoll.hits),
      soakCard.data['boxes'],
    );
    story.roll(
      'Ganger-1 — soak',
      `${soakCard.data['pool']} dice (BOD + armour) ${diceLine(soakRoll)} → **${String(soakCard.data['boxes'])} boxes** of ${String(soakCard.data['track'])}`,
    );
    const committed = await gm.post<{ combatant: Combatant; committed: boolean }>(`/api/encounters/${eid}/resolve-chain/commit`, {
      defenderId: ganger1.id,
      boxes: chain.suggested.boxes,
      track: chain.suggested.track,
      note: 'Torque, first shot',
    });
    checks.eq('nothing is written until the GM commits the card', true, committed.committed);
    checks.eq(
      'the boxes land on the right monitor',
      chain.suggested.boxes,
      chain.suggested.track === 'physical' ? committed.combatant.monitors.physical.filled : committed.combatant.monitors.stun.filled,
    );
  } else {
    checks.skip('the chain resolves damage → soak → boxes', 'a hit', `${String(defenseCard.data['netHits'])} net hits — the defence held`);
    story.say('The shot goes wide of the aisle and buries itself in a pallet.');
  }

  const rollsAfterChain = (await gm.get<{ rolls: { id: string }[] }>(`/api/campaigns/${cid}/rolls?limit=200`)).rolls.length;
  if (rollsAfterChain === rollsBeforeChain) {
    gaps.push(
      "`POST /api/encounters/:id/resolve-chain` rolls three server-side pools (attack, defence, soak) and " +
        'persists none of them: the roll log gained 0 rows across the whole exchange. The damage staying ' +
        'uncommitted is deliberate (Principle 2), but G5/FR2.1 want the dice themselves on the immutable record — ' +
        'the cards should write `rolls` rows (visibility `gm`) as they are produced, or on commit.',
    );
  }

  // --- push the limit: Torque's second action ------------------------------
  const push = await gm.post<{ entry: { pool: number }; request: { pool: number; limit?: { value: number } }; result: RollResult }>(
    `/api/combatants/${torque.id}/quick-roll`,
    { key: 'attack:Hammer', edge: 'push_pre', edgeDice: 3 },
  );
  checks.eq('Push the Limit adds the Edge dice to the pool', push.request.pool + 3, push.result.faces.length);
  checks.eq('…and ignores the Accuracy limit entirely', push.result.hits, push.result.limitedHits);
  const sixes = push.result.faces.filter((f) => f === 6).length;
  if (sixes > 0) {
    checks.record('…and every six rolls again (Rule of Six)', `at least ${sixes} exploded dice`, (push.result.exploded ?? []).join(' ') || 'none', (push.result.exploded ?? []).length >= sixes);
  } else {
    checks.skip('…and every six rolls again (Rule of Six)', 'exploded dice', 'no six came up on the pushed pool this run');
  }
  story.say(
    'Second action of the turn, and Torque burns a point of Edge to push it: three more dice, every six rolls ' +
      'again, and the pistol\'s Accuracy stops applying for one shot.',
  );
  story.roll('Torque — Push the Limit', `${push.request.pool}+3 dice ${diceLine(push.result)}`);

  const g1Defense = await gm.post<{ result: RollResult }>(`/api/combatants/${ganger1.id}/quick-roll`, { key: 'defense' });
  const g1Soak = await gm.post<{ result: RollResult }>(`/api/combatants/${ganger1.id}/quick-roll`, { key: 'soak' });
  const netHits = Math.max(0, push.result.limitedHits - g1Defense.result.hits);
  const second = await gm.post<{ combatant: Combatant; boxes: number; morale: Dict | null }>(`/api/encounters/${eid}/damage/from-roll`, {
    targetId: ganger1.id,
    baseDv: 8,
    netHits,
    soakHits: g1Soak.result.hits,
    damageType: 'P',
    note: 'Torque, second shot (Edge)',
  });
  checks.eq('damage-from-roll is (DV + net) − soak', Math.max(0, 8 + netHits - g1Soak.result.hits), second.boxes);

  // The wound modifier has to reach the NEXT pool this combatant rolls.
  const rackAfter = await gm.get<{ woundModifier: number; entries: { key: string; pool: number }[] }>(`/api/combatants/${ganger1.id}/quick-rolls`);
  const expectedWound = -Math.floor(second.combatant.monitors.physical.filled / 3) - Math.floor(second.combatant.monitors.stun.filled / 3);
  checks.eq('the ganger\'s wound modifier recomputes from the filled boxes', expectedWound || 0, rackAfter.woundModifier);
  const defBefore = rackBefore.entries.find((e) => e.key === 'defense')?.pool ?? 0;
  const defAfter = rackAfter.entries.find((e) => e.key === 'defense')?.pool ?? 0;
  checks.record(
    'and his next defence pool is that much smaller',
    `${defBefore} ${expectedWound || 0} = ${defBefore + (expectedWound || 0)}`,
    `${defBefore} → ${defAfter}`,
    defAfter === defBefore + (expectedWound || 0),
  );
  story.roll(
    'Ganger-1 — the receipt',
    `physical ${second.combatant.monitors.physical.filled}/${second.combatant.monitors.physical.max}, wound modifier ${rackAfter.woundModifier}, defence ${defBefore} → ${defAfter}`,
  );

  // The fight continues in combat-close.ts (length only; same encounter).
  await closeFight({
    ctx,
    gm,
    phones,
    tv,
    gmLive,
    campaignId: cid,
    encounterId: eid,
    gangers,
    gangerGuns,
    torque,
    sparrow,
    whisper: whisperC,
    hiddenNames,
  });
}
