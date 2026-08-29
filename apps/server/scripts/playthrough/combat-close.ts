/**
 * The back half of beat four: the mage pays for her spell, the adept spends
 * Initiative Score to dodge, the gang gets its shots in, two of them stop
 * getting up, and the tracker offers the morale call it will never make.
 *
 * Split from combat.ts only for length; it is one continuous fight.
 */
import { diceLine, settle, type Api, type Live } from './harness.js';
import {
  sceneEntry,
  type Combatant,
  type Ctx,
  type Dict,
  type Entry,
  type Monitors,
  type Phone,
  type RollRecord,
  type RollResult,
} from './types.js';

/** Everything the first half of the fight already established. */
export interface Fight {
  ctx: Ctx;
  gm: Api;
  phones: Record<string, Phone>;
  tv: { api: Api; live: Live };
  gmLive: Live;
  campaignId: string;
  encounterId: string;
  gangers: Combatant[];
  gangerGuns: Record<string, { name: string; modes: string[] }>;
  torque: Combatant;
  sparrow: Combatant;
  whisper: Combatant;
  hiddenNames: string[];
}

export async function closeFight(fight: Fight): Promise<void> {
  const { ctx, gm, phones, tv, gmLive, gangers, gangerGuns, hiddenNames } = fight;
  const { checks, story } = ctx;
  const cid = fight.campaignId;
  const eid = fight.encounterId;
  const torque = fight.torque;
  const sparrow = fight.sparrow;
  const whisperC = fight.whisper;

  // --- Whisper's spike, and what it costs her ------------------------------
  const ganger3 = gangers[2]!;
  const whisperPhone = phones['Whisper']!;
  const cast = await whisperPhone.api.post<{ roll: RollRecord }>('/api/rolls', {
    kind: 'simple',
    pool: 12,
    breakdown: [],
    limit: { kind: 'force', value: 4 },
    visibility: 'public',
    actor: { characterId: whisperPhone.characterId },
    meta: { poolRef: 'spell.Neural Spike', force: 4 },
  });
  checks.eq('the cast is limited by its Force', 4, cast.roll.request.limit?.value);
  checks.record(
    'the shed\'s dim light is in the casting pool too',
    'a `scene` −1',
    sceneEntry(cast.roll.request.breakdown)?.value ?? 'absent',
    sceneEntry(cast.roll.request.breakdown)?.value === -1,
  );
  const resist = await gm.post<{ roll: RollRecord }>('/api/rolls', {
    kind: 'simple',
    pool: 4,
    breakdown: [{ label: 'WIL', value: 4, source: 'attribute' }],
    visibility: 'gm',
    actor: { combatantId: ganger3.id },
    meta: { opposedRollId: cast.roll.id, note: 'Neural Spike — resisted' },
  });
  const spikeNet = Math.max(0, cast.roll.limitedHits - resist.roll.limitedHits);
  const spiked = await gm.post<{ combatant: Combatant; boxes: number }>(`/api/encounters/${eid}/damage/from-roll`, {
    targetId: ganger3.id,
    baseDv: 4,
    netHits: spikeNet,
    soakHits: 0,
    damageType: 'S',
    note: 'Neural Spike, Force 4',
  });
  checks.eq('the spike lands as Stun', spiked.boxes, spiked.combatant.monitors.stun.filled);

  const DRAIN_DV = 2; // 'F-3' at Force 4 → 1, floored at the minimum of 2
  const drain = await whisperPhone.api.post<{ roll: RollRecord & { detail?: Dict } }>('/api/rolls', {
    kind: 'threshold',
    pool: 11,
    breakdown: [
      { label: 'WIL', value: 5, source: 'attribute' },
      { label: 'LOG', value: 6, source: 'attribute' },
    ],
    visibility: 'public',
    actor: { characterId: whisperPhone.characterId },
    meta: { threshold: DRAIN_DV, drainFor: 'Neural Spike', force: 4 },
  });
  checks.record('a Drain resistance roll follows the cast', `threshold ${DRAIN_DV}`, drain.roll.detail?.['threshold'] ?? 'absent', drain.roll.detail?.['threshold'] === DRAIN_DV);
  const drainBoxes = Math.max(0, DRAIN_DV - drain.roll.limitedHits);
  const whisperAfter = await gm.post<{ combatant: Combatant }>(`/api/encounters/${eid}/damage`, {
    targetId: whisperC.id,
    boxes: drainBoxes,
    track: 'stun',
    note: `unresisted Drain (${DRAIN_DV} − ${drain.roll.limitedHits})`,
  });
  checks.eq('the unresisted margin lands on the caster\'s Stun track', drainBoxes, whisperAfter.combatant.monitors.stun.filled);
  story.say(
    'Whisper puts a Neural Spike through the pallet rows at Force 4 — the cast limited by the Force she chose, ' +
      'the shed\'s dim light already docked off her pool — and then pays for it, because the app rolls the Drain ' +
      'right behind the spell without being asked.',
  );
  story.roll('Whisper — Neural Spike, Force 4', `${cast.roll.request.pool} dice ${diceLine(cast.roll)} vs WIL ${diceLine(resist.roll)} → ${spiked.boxes} Stun`);
  story.roll('Whisper — Drain', `11 dice against DV ${DRAIN_DV} ${diceLine(drain.roll)} → ${drainBoxes} Stun to the caster`);

  // --- Sparrow dodges -------------------------------------------------------
  const sparrowBefore = (await gm.get<{ combatants: Combatant[] }>(`/api/encounters/${eid}`)).combatants.find((c) => c.id === sparrow.id)!;
  const dodge = await gm.post<{ combatant: Combatant; action: { name: string; cost: number } }>(`/api/combatants/${sparrow.id}/interrupt`, {
    actionId: 'dodge',
  });
  checks.eq('Dodge costs 5 off the Initiative Score, immediately', sparrowBefore.initScore - 5, dodge.combatant.initScore);
  story.say(
    'Somebody swings at Sparrow on their way past and she interrupts to dodge. The cost comes off her Initiative ' +
      'Score the instant she declares it — no note in a margin, no argument about it three actions later.',
  );
  story.roll('Sparrow — Dodge (interrupt)', `Initiative Score ${sparrowBefore.initScore} → ${dodge.combatant.initScore}`);

  // --- a ganger finds Torque -----------------------------------------------
  const torquePhone = phones['Torque']!;
  let landed: { boxes: number; track: string } | null = null;
  let recoilChecked = false;
  for (const shooter of [gangers[2]!, gangers[3]!, gangers[1]!, gangers[3]!]) {
    const gun = gangerGuns[shooter.id];
    const burst = gun?.modes.includes('BF') === true;
    const shot = await gm.post<{ cards: { step: string; data: Dict }[]; suggested: { boxes: number; track: string } | null }>(
      `/api/encounters/${eid}/resolve-chain`,
      {
        attackerId: shooter.id,
        defenderId: torque.id,
        ...(burst ? { mode: 'BF', bullets: 3 } : {}),
      },
    );
    const atk = shot.cards.find((c) => c.step === 'attack')!;
    story.roll(
      `${shooter.name} — ${burst ? 'three-round burst' : gun?.name ?? 'attack'} at Torque`,
      `${atk.data['pool']} dice ${diceLine(atk.data['roll'] as RollResult)} vs Torque's defence ${diceLine((shot.cards.find((c) => c.step === 'defense')!).data['roll'] as RollResult)}`,
    );
    const recoil = (atk.data['breakdown'] as Entry[]).find((e) => e.label.startsWith('recoil'));
    if (recoil && !recoilChecked) {
      recoilChecked = true;
      checks.record('a three-round burst pays uncompensated recoil', 'a negative `recoil` entry', `${recoil.label} ${recoil.value}`, recoil.value < 0);
    }
    if (shot.suggested && shot.suggested.boxes > 0) {
      await gm.post(`/api/encounters/${eid}/resolve-chain/commit`, {
        defenderId: torque.id,
        boxes: shot.suggested.boxes,
        track: shot.suggested.track,
        note: `${shooter.name}, burst`,
      });
      landed = shot.suggested;
      break;
    }
  }
  if (!landed) {
    const fallback = await gm.post<{ combatant: Combatant }>(`/api/encounters/${eid}/damage`, {
      targetId: torque.id,
      boxes: 3,
      track: 'stun',
      note: 'GM call: the aisle fills with fire and something connects',
    });
    landed = { boxes: 3, track: 'stun' };
    checks.record('the GM can always apply boxes by hand (Principle 2)', 'monitor moves', `stun ${fallback.combatant.monitors.stun.filled}`, fallback.combatant.monitors.stun.filled >= 3);
  }
  if (!recoilChecked) {
    checks.skip('a three-round burst pays uncompensated recoil', 'a negative `recoil` entry', 'none of the shooters drew a burst-capable weapon from the loadout table');
  }
  const mirror = await torquePhone.live.next((f) => f.type === 'sheet.updated' && JSON.stringify(f.payload).includes('monitors'));
  const mirrorPayload = mirror.payload as { monitors?: Monitors };
  checks.record(
    'damage in the tracker mirrors to the owner\'s sheet — and only the owner',
    'sheet.updated at gm_owner visibility on Torque\'s phone',
    `${mirror.visibility} · physical ${mirrorPayload.monitors?.physical.filled}/${mirrorPayload.monitors?.physical.max} stun ${mirrorPayload.monitors?.stun.filled}`,
    mirror.visibility === 'gm_owner' && mirrorPayload.monitors !== undefined,
  );
  const torqueCharacterId = torquePhone.characterId;
  const otherPhonesSaw = [phones['Whisper']!.live, phones['Sparrow']!.live, tv.live].some((l) =>
    l.frames.some(
      (f) => f.type === 'sheet.updated' && (f.payload as Dict)['characterId'] === torqueCharacterId && (f.payload as Dict)['monitors'] !== undefined,
    ),
  );
  checks.record('…nobody else\'s phone got it', 'no monitor mirror for Torque elsewhere', otherPhonesSaw ? 'leaked' : 'none', !otherPhonesSaw);
  story.say(
    `Torque takes ${landed.boxes} boxes of ${landed.track} and her own phone updates before the GM has finished ` +
      'saying so. Nobody else\'s does.',
  );

  // --- two down, and the shed loses its nerve (FR10.9) ----------------------
  const sparrowChain = await gm.post<{ suggested: { boxes: number; track: string } | null }>(`/api/encounters/${eid}/resolve-chain`, {
    attackerId: sparrow.id,
    defenderId: gangers[1]!.id,
    weaponName: 'Killing hands',
  });
  if (sparrowChain.suggested && sparrowChain.suggested.boxes > 0) {
    await gm.post(`/api/encounters/${eid}/resolve-chain/commit`, {
      defenderId: gangers[1]!.id,
      boxes: sparrowChain.suggested.boxes,
      track: sparrowChain.suggested.track,
      note: 'Sparrow, open hand',
    });
  }
  story.say(
    'Sparrow crosses four metres of oil-slick concrete without appearing to hurry and puts the second one ' +
      'through a pallet stack.',
  );

  const finish = async (target: Combatant, note: string): Promise<Dict | null> => {
    const current = (await gm.get<{ combatants: Combatant[] }>(`/api/encounters/${eid}`)).combatants.find((c) => c.id === target.id)!;
    const remaining = current.monitors.physical.max - current.monitors.physical.filled;
    const out = await gm.post<{ combatant: Combatant; morale: Dict | null }>(`/api/encounters/${eid}/damage`, {
      targetId: target.id,
      boxes: Math.max(1, remaining),
      track: 'physical',
      note,
    });
    return out.morale;
  };
  await finish(gangers[0]!, 'Torque finishes the exchange');
  const morale = await finish(gangers[1]!, 'Sparrow finishes the exchange');
  await settle();

  checks.record('two of four down fires the morale suggestion', 'a morale report', morale ? JSON.stringify(morale['reasons']) : 'none', morale !== null);
  checks.record(
    '…because the squad is at half strength',
    'reasons include "at half strength"',
    (morale?.['reasons'] as string[] | undefined)?.join(', ') ?? 'none',
    ((morale?.['reasons'] as string[] | undefined) ?? []).includes('at half strength'),
  );
  checks.record(
    '…and it is measured against a real Professional Rating, not 0 (FR4.6)',
    'a non-zero threshold on a hand-added NPC row',
    `pressure ${String(morale?.['pressure'])} vs PR ${String(morale?.['threshold'])}`,
    typeof morale?.['threshold'] === 'number' && (morale['threshold'] as number) > 0,
  );
  const moraleLog = gmLive.frames.filter((f) => f.type === 'log.posted' && (f.payload as Dict)['kind'] === 'morale');
  checks.record('the suggestion is logged GM-only, never acted on', 'a gm-visibility log line', `${moraleLog.length} line(s), visibility ${moraleLog[0]?.visibility}`, moraleLog.length > 0 && moraleLog.every((f) => f.visibility === 'gm'));
  const playersSawMorale = [tv.live, ...Object.values(phones).map((p) => p.live)].some((l) =>
    l.frames.some((f) => f.type === 'log.posted' && (f.payload as Dict)['kind'] === 'morale'),
  );
  checks.record('…and the players never see the prompt', 'absent', playersSawMorale ? 'leaked' : 'absent', !playersSawMorale);
  story.say(
    `Two of the four are on the floor. The tracker does not decide anything — it says, quietly and only to the GM: ` +
      `*${String(morale?.['suggestion']).replace(/_/g, ' ')}*. The GM decides.`,
  );

  // --- Ratchet calls it -----------------------------------------------------
  const ratchet = hiddenNames.find((n) => n.startsWith('Ratchet')) ?? 'Ratchet';
  await gm.post(`/api/campaigns/${cid}/log`, {
    kind: 'talk',
    visibility: 'public',
    text: '“Leave it.” The voice comes from the catwalk, unhurried. “Take the crate, chief. Take it and go, and tell whoever sent you that Pier 23 was empty when you got here.”',
  });
  const closed = await gm.patch<{ encounter: { state: string } }>(`/api/encounters/${eid}`, { state: 'done' });
  checks.eq('the GM ends the encounter on that call', 'done', closed.encounter.state);
  story.say(
    `${ratchet.split(' —')[0]} never comes down the stair. She calls it off, and the shed goes quiet enough to ` +
      'hear the tide horn. The crate is still in the aisle, mislabelled *hydroponics, fragile*, and nobody on ' +
      'either side has stopped breathing.',
  );
}
