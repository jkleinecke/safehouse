/**
 * The three Edge actions that are not extra dice (FR2.3, FR4.4): Seize the
 * Initiative, Blitz, Close Call. Push the Limit rides on the roll itself and is
 * asserted in `combat.ts`.
 *
 * What each one has to be true of, beyond "the route answered":
 *
 *  - the point of Edge actually leaves the sheet — a spend that does not
 *    decrement is a house rule, not a rule;
 *  - the ORDER moves with the spend, immediately (Seize puts the actor above
 *    everyone still up; Blitz re-rolls at the SR5 ceiling of 5d6);
 *  - Close Call never edits the roll it answers. `rolls` is append-only (G5),
 *    so the negation is a new log line carrying the roll id, and the stored row
 *    still says it glitched.
 */
import { settle, type Api, type Live } from './harness.js';
import type { Combatant, Ctx, Dict, Phone, RollResult } from './types.js';


interface EdgeState {
  max: number;
  current: number;
}

interface Sheet {
  edge: { max: number; current: number };
}

interface SeizeOut {
  action: string;
  combatant: Combatant;
  outcome: { from: number; to: number; beat: number | null; changed: boolean };
  edge: EdgeState;
}

interface BlitzOut {
  action: string;
  combatant: Combatant;
  outcome: { base: number; dice: number; addedDice: number; rolls: number[]; woundModifier: number; score: number };
  edge: EdgeState;
}

interface CloseOut {
  action: string;
  rollId: string;
  negated: string;
  result: RollResult;
  edge: EdgeState;
}

interface StoredRoll {
  id: string;
  glitch: string;
  faces: number[];
  request: { pool: number };
}

export interface EdgeBeat {
  ctx: Ctx;
  gm: Api;
  gmLive: Live;
  phones: Record<string, Phone>;
  campaignId: string;
  encounterId: string;
  torque: Combatant;
  sparrow: Combatant;
}

const edgeOf = async (api: Api, characterId: string): Promise<number> =>
  (await api.get<Sheet>(`/api/characters/${characterId}/derived`)).edge.current;

export async function edgeActions(beat: EdgeBeat): Promise<void> {
  const { ctx, gm, gmLive, phones, campaignId, encounterId } = beat;
  const { checks, story } = ctx;

  // --- Seize the Initiative -------------------------------------------------
  const sparrowPhone = phones['Sparrow']!;
  const before = (await gm.get<{ combatants: Combatant[] }>(`/api/encounters/${encounterId}`)).combatants;
  const others = before.filter((c) => c.id !== beat.sparrow.id).map((c) => c.initScore);
  const topOfPass = Math.max(...others);
  const edgeBefore = await edgeOf(gm, sparrowPhone.characterId);

  const seized = await gm.post<SeizeOut>('/api/edge/seize-initiative', { combatantId: beat.sparrow.id });
  checks.record(
    'Seize the Initiative puts the actor above everyone still in the pass',
    `strictly above ${topOfPass}`,
    `${seized.outcome.from} → ${seized.outcome.to} (beat ${String(seized.outcome.beat)})`,
    seized.outcome.to > topOfPass && seized.combatant.initScore === seized.outcome.to,
  );
  checks.eq('…and hands the action back — she has not acted this pass', false, seized.combatant.actedThisPass);
  checks.eq('…and it costs exactly one point of Edge', edgeBefore - 1, seized.edge.current);
  checks.eq('…debited on the sheet itself, not in a note', edgeBefore - 1, await edgeOf(gm, sparrowPhone.characterId));

  // --- Blitz ----------------------------------------------------------------
  const torqueEdgeBefore = await edgeOf(gm, phones['Torque']!.characterId);
  const normalDice =
    (await gm.get<{ combatants: Combatant[] }>(`/api/encounters/${encounterId}`)).combatants.find(
      (c) => c.id === beat.torque.id,
    )?.initDice ?? 0;
  const blitzed = await gm.post<BlitzOut>('/api/edge/blitz', { combatantId: beat.torque.id });
  const diceSum = blitzed.outcome.rolls.reduce((n, r) => n + r, 0);
  checks.eq('Blitz rolls the SR5 ceiling of five initiative dice', 5, blitzed.outcome.rolls.length);
  checks.record(
    '…and the score is base + those five dice + the wound modifier',
    `${blitzed.outcome.base} + ${blitzed.outcome.rolls.join('+')} ${blitzed.outcome.woundModifier} = ${blitzed.outcome.base + diceSum + blitzed.outcome.woundModifier}`,
    `${blitzed.outcome.score} (tracker says ${blitzed.combatant.initScore})`,
    blitzed.outcome.score === blitzed.outcome.base + diceSum + blitzed.outcome.woundModifier &&
      blitzed.combatant.initScore === blitzed.outcome.score,
  );
  checks.record(
    '…having bought only the dice her wired reflexes did not already give her',
    `5 − ${normalDice} = ${5 - normalDice} bought`,
    `${blitzed.outcome.addedDice} bought over a normal ${normalDice}d6`,
    normalDice > 0 && blitzed.outcome.addedDice === 5 - normalDice,
  );
  checks.eq('…and it costs one Edge too', torqueEdgeBefore - 1, blitzed.edge.current);

  await settle();
  const announced = gmLive.frames.filter(
    (f) => f.type === 'log.posted' && (f.payload as Dict)['kind'] === 'edge',
  );
  const labels = announced.map((f) => String((f.payload as Dict)['text'] ?? ''));
  checks.record(
    'every spend announces itself, loudly, by name (FR2.3)',
    'log lines naming Seize the Initiative and Blitz, with the Edge left',
    labels.join(' | ') || 'none',
    labels.some((t) => t.includes('Seize the Initiative')) && labels.some((t) => t.includes('Blitz')),
  );

  story.say(
    'Sparrow spends a point of Edge to get in front of the whole shed — the tracker moves her to the top of the ' +
      `pass on the spot (${seized.outcome.from} → ${seized.outcome.to}) and gives her the action back. Torque ` +
      `blitzes hers: five dice instead of two, [${blitzed.outcome.rolls.join(' ')}], initiative ${blitzed.outcome.score}. ` +
      'Both points come off the sheets and both spends say so in the log.',
  );

  await closeCall(beat);
}

// ---------------------------------------------------------------------------
// Close Call — Edge after the fact, on an immutable record
// ---------------------------------------------------------------------------

async function closeCall(beat: EdgeBeat): Promise<void> {
  const { ctx, gm, phones } = beat;
  const { checks, story } = ctx;
  const whisper = phones['Whisper']!;

  // A single die glitches on a 1 (ones > ⌊1/2⌋). Keep throwing until the shed
  // gives us one — the point is the rule, and the dice are the server's.
  const roll = async (): Promise<StoredRoll> =>
    (
      await whisper.api.post<{ roll: StoredRoll }>('/api/rolls', {
        kind: 'simple',
        pool: 1,
        breakdown: [],
        visibility: 'public',
        actor: { characterId: whisper.characterId },
        meta: { note: 'reaching for the catwalk ladder in the dark' },
      })
    ).roll;

  let glitched: StoredRoll | null = null;
  let clean: StoredRoll | null = null;
  for (let attempt = 0; attempt < 60 && (glitched === null || clean === null); attempt++) {
    const r = await roll();
    if (r.glitch === 'none') clean ??= r;
    else glitched ??= r;
  }
  if (!glitched) {
    checks.skip(
      'Close Call negates a glitch after the fact',
      'a glitched roll to spend on',
      'sixty single dice and not one of them came up a 1',
    );
    return;
  }

  const edgeBefore = await edgeOf(gm, whisper.characterId);
  const bought = await whisper.api.post<CloseOut>('/api/edge/close-call', { rollId: glitched.id });
  checks.record(
    'Close Call buys off a glitch after the dice have landed',
    `the ${glitched.glitch} negated`,
    `${bought.negated} → ${bought.result.glitch}`,
    bought.negated === glitched.glitch && bought.result.glitch === 'none',
  );
  checks.eq('…for one point of Edge', edgeBefore - 1, bought.edge.current);
  const stored = (await gm.get<{ roll: StoredRoll }>(`/api/rolls/${glitched.id}`)).roll;
  checks.record(
    '…without editing the roll: the record still says it glitched (G5)',
    `the stored row still ${glitched.glitch}, same faces`,
    `${stored.glitch} · [${stored.faces.join(' ')}]`,
    stored.glitch === glitched.glitch && JSON.stringify(stored.faces) === JSON.stringify(glitched.faces),
  );
  const spentBySomeoneElse = await phones['Sparrow']!.api.status('POST', '/api/edge/close-call', {
    rollId: glitched.id,
  });
  checks.eq("…and nobody else may spend another runner's Edge", 403, spentBySomeoneElse);
  if (clean) {
    const nothingToBuy = await whisper.api.raw('POST', '/api/edge/close-call', { rollId: clean.id });
    checks.record(
      'a roll that did not glitch has nothing to sell',
      '400 no_glitch',
      `${nothingToBuy.status} · ${nothingToBuy.body.slice(0, 70)}`,
      nothingToBuy.status === 400 && nothingToBuy.body.includes('no_glitch'),
    );
  } else {
    checks.skip('a roll that did not glitch has nothing to sell', '400 no_glitch', 'the first die thrown glitched');
  }

  story.roll(
    'Whisper — one die on the ladder',
    `[${glitched.faces.join(' ')}] → **${glitched.glitch.toUpperCase()}**, bought off with a point of Edge`,
  );
  story.say(
    'She misses the rung. The app calls it a ' +
      `${glitched.glitch === 'critical' ? 'critical glitch' : 'glitch'}, she spends the Edge to make it a near thing ` +
      'instead — and the roll on the record still says what it said. The spend is a new line, not an edit: that is ' +
      'what an append-only log is for.',
  );
}
