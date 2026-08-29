/**
 * The magic toolkit at the table (M8: FR8.3 spirits, FR8.4 foci and reagents).
 *
 * Three things the mage's player used to keep on paper beside the sheet, and
 * the reason each one had to stop being paper:
 *
 *  - **Services.** A bound spirit owes a finite number of them. The counter has
 *    to drop where everyone can see it and it must not go negative — asking for
 *    four when one is owed is a *shortfall*, never a loan.
 *  - **A spirit is a combatant.** When Ash-of-Kettles materialises she goes on
 *    the tracker with an initiative line the engine derived from her Force,
 *    through the same `addCombatant` every other row uses — no second write
 *    path, no hand-typed score.
 *  - **A bonded focus is a toggle, not a gear line.** Flipping it moves the
 *    derived pool immediately *and names itself in that pool's receipt*
 *    (Principle 3), because it goes through the ordinary modifier pipeline.
 *
 * Reagents are the smallest of the four and get the same floor as services:
 * a mage who spends more drams than she has ends at zero and is told what she
 * was short.
 *
 * Placed after the morale beat on purpose: a spirit joining the encounter adds
 * a body to the opposition-side arithmetic the FR10.9 triggers count, and the
 * fight's own assertions come first.
 */
import type { Api, Live } from './harness.js';
import type { Combatant, Ctx, Dict, Entry, Phone } from './types.js';

/** A derived value with its receipt, as the wire carries it. */
interface Receipted {
  value: number;
  breakdown: Entry[];
}

/** Just the slice of `DerivedCharacter` this beat reads back. */
interface DerivedBlock {
  initiative: { physical: { base: Receipted; dice: Receipted } };
  pools: Record<string, { total: number; breakdown: Entry[] }>;
}

interface Spirit {
  id: string;
  name: string;
  spiritType: string;
  force: number;
  bound: boolean;
  services: number;
  servicesInitial: number;
  status: string;
  characterId: string | null;
  combatantId: string | null;
  encounterId: string | null;
}

interface ServiceResult {
  spirit: Spirit;
  spent: number;
  shortfall: number;
  remaining: number;
  exhausted: boolean;
}

interface Focus {
  id: string;
  name: string;
  force: number;
  bonded: boolean;
  active: boolean;
  targets: string[];
}

interface MagicView {
  spirits: Spirit[];
  foci: Focus[];
  reagents: Record<string, number>;
  scope: string;
}

interface MagicDerived {
  derived: DerivedBlock;
  focusModifiers: Array<{ target: string; value: number; note?: string }>;
  reagents: number;
}

interface ReagentResult {
  before: number;
  after: number;
  shortfall: number;
}

export interface MagicBeat {
  ctx: Ctx;
  gm: Api;
  gmLive: Live;
  phones: Record<string, Phone>;
  campaignId: string;
  encounterId: string;
}

const SPELLCASTING = 'skill.spellcasting';

/** The `skill.spellcasting` pool and the focus line in its receipt. */
function castingPool(view: MagicDerived): { total: number; focusLine: Entry | undefined } {
  const pool = view.derived.pools[SPELLCASTING];
  return {
    total: pool?.total ?? 0,
    focusLine: (pool?.breakdown ?? []).find((e) => e.label.includes('Kettle-ring')),
  };
}

export async function magic(beat: MagicBeat): Promise<void> {
  const { ctx, gm, gmLive, phones } = beat;
  const { checks, story } = ctx;
  const cid = beat.campaignId;
  const whisper = phones['Whisper']!;
  checks.beat('5b · The mage’s bookkeeping (FR8.3/FR8.4)');

  // --- what the table is holding ------------------------------------------
  const onTheSheet = await whisper.api.get<MagicView>(`/api/campaigns/${cid}/magic`);
  const ash = onTheSheet.spirits.find((s) => s.name === 'Ash-of-Kettles');
  if (!ash) throw new Error('seed left no bound spirit for Whisper');
  checks.record(
    'the mage opens the session with a bound spirit and services owed',
    'Ash-of-Kettles, bound, Force 4, 2 services',
    `${ash.name} ${ash.bound ? 'bound' : 'unbound'} F${ash.force}, ${ash.services} service(s)`,
    ash.bound && ash.force === 4 && ash.services === 2 && ash.characterId === whisper.characterId,
  );

  // --- one tap: spend a service (FR8.3) ------------------------------------
  const spend = await whisper.api.post<ServiceResult>(
    `/api/campaigns/${cid}/magic/spirits/${ash.id}/services`,
    { op: 'spend', count: 1, reason: 'Materialise in the aisle and stand between them' },
  );
  checks.record(
    'spending a service drops the count by exactly one',
    'spent 1, 1 remaining of 2',
    `spent ${spend.spent}, ${spend.remaining} of ${spend.spirit.servicesInitial} remaining`,
    spend.spent === 1 && spend.remaining === 1 && spend.shortfall === 0,
  );
  const spendFrame = await gmLive.next(
    (f) => f.type === 'magic.updated' && (f.payload as Dict)['op'] === 'spirit.service.spend',
  );
  const spendPayload = spendFrame.payload as Dict;
  checks.record(
    '…and the log carries what the spirit was told to do',
    'a magic.updated line naming the spend and its reason',
    `${String(spendPayload['op'])} · remaining ${String(spendPayload['remaining'])} · “${String(
      spendPayload['reason'],
    )}”`,
    spendPayload['remaining'] === 1 &&
      String(spendPayload['reason']).length > 0 &&
      spendFrame.visibility === 'public',
  );
  const onWhispersPhone = await whisper.live.next(
    (f) => f.type === 'magic.updated' && (f.payload as Dict)['op'] === 'spirit.service.spend',
  );
  checks.record(
    '…on the summoner’s own phone too — her spirit is not GM-only',
    'the same frame on Whisper’s socket',
    onWhispersPhone.visibility ?? 'none',
    onWhispersPhone.visibility === 'public',
  );

  // --- the spirit joins the fight (FR8.3 → M4) -----------------------------
  const derivedSpirit = await gm.get<{ derived: DerivedBlock }>(
    `/api/campaigns/${cid}/magic/spirits/${ash.id}/derived`,
  );
  const engineBase = derivedSpirit.derived.initiative.physical.base.value;
  const engineDice = derivedSpirit.derived.initiative.physical.dice.value;
  const joined = await gm.post<{ spirit: Spirit; combatant: Combatant }>(
    `/api/campaigns/${cid}/magic/spirits/${ash.id}/join`,
    { encounterId: beat.encounterId },
  );
  const row = joined.combatant;
  const rowDice = Number(row.copilot?.['initDice'] ?? 0);
  checks.record(
    'the spirit joins the encounter as an ordinary combatant',
    'a tracker row linked back to the spirit',
    `${row.name} · combatantId on the spirit: ${joined.spirit.combatantId === row.id ? 'set' : 'MISSING'}`,
    joined.spirit.combatantId === row.id && joined.spirit.encounterId === beat.encounterId,
  );
  // Force 4 with the GM's +3 REA offset: REA 7 + INT 4 = 11, and the spirit
  // form's 2d6. Nothing here was typed — the engine derived it from Force.
  checks.record(
    '…with a Force-derived initiative line, not a hand-typed one',
    `${engineBase} + ${engineDice}d6, exactly as the engine derives Force ${ash.force}`,
    `${row.initBase} + ${rowDice}d6`,
    row.initBase === engineBase &&
      rowDice === engineDice &&
      engineBase === 2 * ash.force + 3 &&
      engineDice === 2,
  );
  const diceReceipt = derivedSpirit.derived.initiative.physical.dice.breakdown;
  checks.record(
    '…and those extra dice show where they came from (Principle 3)',
    'a `spirit form` line in the initiative receipt',
    diceReceipt.map((e) => `${e.label} ${e.value >= 0 ? '+' : ''}${e.value}`).join(' · '),
    diceReceipt.some((e) => e.label.toLowerCase().includes('spirit')),
  );
  const rosterFromPhone = await whisper.api.get<{ combatants: Combatant[] }>(
    `/api/encounters/${beat.encounterId}`,
  );
  checks.record(
    '…and the phones can see her: a summoned spirit is not hidden opposition',
    'Ash-of-Kettles on the player roster',
    rosterFromPhone.combatants.map((c) => c.name).join(', '),
    rosterFromPhone.combatants.some((c) => c.id === row.id),
  );

  // --- the counter floors at zero ------------------------------------------
  const overspend = await whisper.api.post<ServiceResult>(
    `/api/campaigns/${cid}/magic/spirits/${ash.id}/services`,
    { op: 'spend', count: 9, reason: 'Hold the aisle until we are out' },
  );
  checks.record(
    'asking for more services than are owed is a shortfall, never a loan',
    '1 spent, 8 short, 0 remaining — and never a negative count',
    `spent ${overspend.spent}, short ${overspend.shortfall}, remaining ${overspend.remaining}`,
    overspend.spent === 1 &&
      overspend.shortfall === 8 &&
      overspend.remaining === 0 &&
      overspend.exhausted,
  );

  // --- the focus toggle (FR8.4) --------------------------------------------
  const withFocus = await whisper.api.get<MagicDerived>(
    `/api/characters/${whisper.characterId}/magic/derived`,
  );
  const lit = castingPool(withFocus);
  const kettleRing = (await whisper.api.get<{ foci: Focus[] }>(`/api/characters/${whisper.characterId}/foci`))
    .foci.find((f) => f.name === 'Kettle-ring');
  if (!kettleRing) throw new Error('seed left no bonded focus for Whisper');
  checks.record(
    'the bonded focus is in the casting pool, and says so in the receipt',
    `a +${kettleRing.force} line naming the focus`,
    lit.focusLine ? `${lit.focusLine.label} ${lit.focusLine.value >= 0 ? '+' : ''}${lit.focusLine.value}` : 'absent',
    lit.focusLine?.value === kettleRing.force && lit.focusLine.source === 'spell',
  );

  const off = await whisper.api.patch<{ derived: MagicDerived }>(
    `/api/characters/${whisper.characterId}/foci/${kettleRing.id}`,
    { active: false },
  );
  const dark = castingPool(off.derived);
  checks.record(
    'switching it off moves the derived pool the same instant',
    `spellcasting ${lit.total} → ${lit.total - kettleRing.force}`,
    `${lit.total} → ${dark.total}`,
    dark.total === lit.total - kettleRing.force,
  );
  checks.record(
    '…and the line leaves the receipt with it — no orphan provenance',
    'no focus line in the pool’s breakdown',
    dark.focusLine ? `still there: ${dark.focusLine.label}` : 'gone',
    dark.focusLine === undefined,
  );
  const unbonded = await whisper.api.patch<{ derived: MagicDerived }>(
    `/api/characters/${whisper.characterId}/foci/${kettleRing.id}`,
    { active: true, bonded: false },
  );
  checks.record(
    'an unbonded focus is inert however switched-on it looks (FR8.4)',
    `still ${lit.total - kettleRing.force} with the toggle on but the bond broken`,
    `active, unbonded → ${castingPool(unbonded.derived).total}`,
    castingPool(unbonded.derived).total === lit.total - kettleRing.force,
  );
  const back = await whisper.api.patch<{ derived: MagicDerived }>(
    `/api/characters/${whisper.characterId}/foci/${kettleRing.id}`,
    { active: true, bonded: true },
  );
  checks.eq('bonding it again restores the pool', lit.total, castingPool(back.derived).total);

  // --- reagents (FR8.4) -----------------------------------------------------
  const spentDrams = await whisper.api.post<ReagentResult>(
    `/api/characters/${whisper.characterId}/reagents`,
    { op: 'spend', amount: 2 },
  );
  checks.record(
    'two drams of reagents go into the Neural Spike',
    '6 → 4',
    `${spentDrams.before} → ${spentDrams.after}`,
    spentDrams.before === 6 && spentDrams.after === 4 && spentDrams.shortfall === 0,
  );
  const emptied = await whisper.api.post<ReagentResult>(
    `/api/characters/${whisper.characterId}/reagents`,
    { op: 'spend', amount: 99 },
  );
  checks.record(
    'reagents cannot go negative — the overspend is reported, not borrowed',
    'floors at 0, short 95',
    `${emptied.before} → ${emptied.after}, short ${emptied.shortfall}`,
    emptied.after === 0 && emptied.shortfall === 95,
  );
  const restocked = await whisper.api.post<ReagentResult>(
    `/api/characters/${whisper.characterId}/reagents`,
    { op: 'restock', amount: 4 },
  );
  checks.eq('…and restocking counts back up from the floor', 4, restocked.after);

  story.say(
    'Whisper spends one of Ash-of-Kettles’ two services and the count drops on every screen at once, with the ' +
      'instruction attached to it. The spirit goes on the tracker as an ordinary row — Force 4 in, ' +
      `initiative ${engineBase} + ${engineDice}d6 out, derived by the same engine that does the runners — and the ` +
      'phones can see her, because a summoned spirit is not the GM’s secret.',
  );
  story.say(
    'She asks for nine more services out of habit. She gets the one she is owed and is told, plainly, that she is ' +
      'eight short. The same floor holds under the reagent tin: ninety-nine drams out of four leaves four spent ' +
      'and ninety-five owed to nobody.',
  );
  story.say(
    `And the brass ring on her hand is not a line on the gear list. Switched off, the casting pool falls from ` +
      `**${lit.total}** to **${dark.total}** and the receipt stops mentioning it; break the bond and the toggle ` +
      'does nothing at all. Two gates, both real, both visible in the same tooltip that answers "why is my pool 11?".',
  );
}
