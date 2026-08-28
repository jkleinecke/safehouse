/**
 * Live-play widget logic (FR3.4, FR2.3, FR8.2) — the arithmetic behind the
 * monitors / Edge / ammo / recoil / sustaining endpoints in
 * `plugins/characters.ts`, kept here so the plugin stays a thin router.
 *
 * Everything is pure apart from throwing the API's own `httpError` envelope:
 * given the current sheet + play state it returns the next ones. Monitor math
 * comes from `@safehouse/rules` so the character track and the combatant track
 * behave identically (§7.2).
 */
import { z } from 'zod';
import type { CombatantMonitors, SheetV1 } from '@safehouse/contracts';
import { applyDamage, computeWoundModifier, healDamage } from '@safehouse/rules';
import { httpError } from './auth.js';
import { slug } from './chummer.js';
import type { PlayState } from './characters.js';

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

export const DamageBody = z.object({
  monitor: z.enum(['physical', 'stun']),
  boxes: z.number().int().min(0).max(99),
  op: z.enum(['damage', 'heal', 'set']).default('damage'),
  note: z.string().max(300).optional(),
});
export type DamageInput = z.infer<typeof DamageBody>;

export const EdgeBody = z.object({
  op: z.enum(['spend', 'burn', 'refresh', 'set']).default('spend'),
  amount: z.number().int().min(0).max(20).default(1),
  reason: z.string().max(300).optional(),
});
export type EdgeInput = z.infer<typeof EdgeBody>;

export const AmmoBody = z.object({
  weapon: z.string().min(1),
  op: z.enum(['fire', 'reload', 'set']).default('fire'),
  rounds: z.number().int().min(0).max(999).default(1),
});
export type AmmoInput = z.infer<typeof AmmoBody>;

export const RecoilBody = z.object({
  weapon: z.string().min(1),
  op: z.enum(['add', 'reset', 'set']).default('add'),
  amount: z.number().int().min(0).max(99).default(1),
});
export type RecoilInput = z.infer<typeof RecoilBody>;

export const SustainedBody = z.object({
  op: z.enum(['add', 'remove', 'toggle', 'clear']).default('add'),
  id: z.string().min(1).optional(),
  name: z.string().min(1).max(120).optional(),
  exempt: z.boolean().optional(),
});
export type SustainedInput = z.infer<typeof SustainedBody>;

// ---------------------------------------------------------------------------
// Monitors (FR3.4 — wound modifiers recompute and propagate, §10.2)
// ---------------------------------------------------------------------------

export interface MonitorChange {
  monitors: CombatantMonitors;
  woundModifier: { before: number; after: number; delta: number };
  applied?: { physical: number; stun: number; overflow: number };
}

export function applyMonitorOp(before: CombatantMonitors, body: DamageInput): MonitorChange {
  if (body.op === 'heal') {
    const healed = healDamage(before, body.boxes, body.monitor);
    return { monitors: healed.monitors, woundModifier: healed.woundModifier };
  }
  if (body.op === 'set') {
    const track = { ...before[body.monitor], filled: Math.min(body.boxes, before[body.monitor].max) };
    const monitors = { ...before, [body.monitor]: track } as CombatantMonitors;
    const was = computeWoundModifier(before);
    const now = computeWoundModifier(monitors);
    return { monitors, woundModifier: { before: was, after: now, delta: now - was } };
  }
  const result = applyDamage(before, body.boxes, body.monitor);
  return { monitors: result.monitors, woundModifier: result.woundModifier, applied: result.applied };
}

/** Fold new monitor state back into the character's play state. */
export function playWithMonitors(play: PlayState, monitors: CombatantMonitors): PlayState {
  return {
    ...play,
    monitors: {
      physical: monitors.physical.filled,
      stun: monitors.stun.filled,
      overflow: monitors.overflow.filled,
    },
  };
}

// ---------------------------------------------------------------------------
// Edge (FR2.3 — burning is loud and permanent)
// ---------------------------------------------------------------------------

export interface EdgeChange {
  sheet: SheetV1;
  play: PlayState;
  edge: { max: number; current: number };
  /** Log line for the session feed. */
  text: string;
  /** Burning changes the character, so it snapshots a revision. */
  permanent: boolean;
}

export function applyEdgeOp(
  sheet: SheetV1,
  play: PlayState,
  body: EdgeInput,
  who: string,
): EdgeChange {
  const edg = { ...sheet.attributes.edg };
  let nextPlay = play;
  let text: string;
  let permanent = false;
  switch (body.op) {
    case 'spend':
      if (edg.current < body.amount) throw httpError(400, 'insufficient_edge', 'not enough Edge');
      edg.current -= body.amount;
      text = `${who} spends ${body.amount} Edge`;
      break;
    case 'burn':
      if (edg.max < body.amount) {
        throw httpError(400, 'insufficient_edge', 'not enough Edge to burn');
      }
      edg.max -= body.amount;
      edg.current = Math.max(0, edg.current - body.amount);
      nextPlay = { ...play, edgeBurned: play.edgeBurned + body.amount };
      text = `${who} BURNS ${body.amount} Edge — permanently`;
      permanent = true;
      break;
    case 'refresh':
      edg.current = edg.max;
      text = `${who} refreshes Edge to ${edg.max}`;
      break;
    default:
      edg.current = Math.min(Math.max(0, body.amount), edg.max);
      text = `${who}'s Edge set to ${edg.current}`;
  }
  return {
    sheet: { ...sheet, attributes: { ...sheet.attributes, edg } },
    play: nextPlay,
    edge: edg,
    text,
    permanent,
  };
}

// ---------------------------------------------------------------------------
// Ammo + progressive recoil, per weapon (FR3.4)
// ---------------------------------------------------------------------------

function findWeapon(sheet: SheetV1, name: string): number {
  const index = sheet.weapons.findIndex((w) => w.name.toLowerCase() === name.toLowerCase());
  if (index < 0) throw httpError(404, 'not_found', `no weapon '${name}' on this sheet`);
  return index;
}

/** Uncompensated recoil as a dice modifier (assistive, GM-editable). */
export function recoilModifier(comp: number, counter: number): number {
  return Math.min(0, comp - counter);
}

export interface AmmoChange {
  sheet: SheetV1;
  play: PlayState;
  weapon: string;
  ammo: { cap: number; current: number };
  recoil: number;
  recoilComp: number;
  modifier: number;
}

export function applyAmmoOp(sheet: SheetV1, play: PlayState, body: AmmoInput): AmmoChange {
  const index = findWeapon(sheet, body.weapon);
  const weapon = sheet.weapons[index]!;
  if (!weapon.ammo) {
    throw httpError(400, 'no_ammo_tracked', `'${weapon.name}' has no ammo capacity`);
  }
  const ammo = { ...weapon.ammo };
  let recoil = play.recoil[weapon.name] ?? 0;
  if (body.op === 'fire') {
    if (ammo.current <= 0) throw httpError(400, 'out_of_ammo', `'${weapon.name}' is empty`);
    const fired = Math.min(body.rounds, ammo.current);
    ammo.current -= fired;
    // Progressive recoil climbs with every round fired in the same phase.
    recoil += fired;
  } else if (body.op === 'reload') {
    ammo.current = ammo.cap;
    recoil = 0;
  } else {
    ammo.current = Math.min(Math.max(0, body.rounds), ammo.cap);
  }
  const weapons = [...sheet.weapons];
  weapons[index] = { ...weapon, ammo };
  const comp = weapon.recoilComp ?? 0;
  return {
    sheet: { ...sheet, weapons },
    play: { ...play, recoil: { ...play.recoil, [weapon.name]: recoil } },
    weapon: weapon.name,
    ammo,
    recoil,
    recoilComp: comp,
    modifier: recoilModifier(comp, recoil),
  };
}

export interface RecoilChange {
  play: PlayState;
  weapon: string;
  recoil: number;
  recoilComp: number;
  modifier: number;
}

export function applyRecoilOp(sheet: SheetV1, play: PlayState, body: RecoilInput): RecoilChange {
  const weapon = sheet.weapons[findWeapon(sheet, body.weapon)]!;
  const current = play.recoil[weapon.name] ?? 0;
  const next = body.op === 'reset' ? 0 : body.op === 'set' ? body.amount : current + body.amount;
  const comp = weapon.recoilComp ?? 0;
  return {
    play: { ...play, recoil: { ...play.recoil, [weapon.name]: next } },
    weapon: weapon.name,
    recoil: next,
    recoilComp: comp,
    modifier: recoilModifier(comp, next),
  };
}

// ---------------------------------------------------------------------------
// Sustained spells (−2 each unless focus/quickening exempt, FR8.2)
// ---------------------------------------------------------------------------

export function applySustainedOp(play: PlayState, body: SustainedInput): PlayState {
  let sustained = [...play.sustained];
  switch (body.op) {
    case 'add': {
      const name = body.name ?? 'Sustained effect';
      const id = body.id ?? `${slug(name) || 'spell'}.${Math.random().toString(16).slice(2, 10)}`;
      if (!sustained.some((s) => s.id === id)) {
        sustained.push({ id, name, exempt: body.exempt ?? false });
      }
      break;
    }
    case 'remove':
      if (!body.id) throw httpError(400, 'bad_request', 'id is required to remove');
      sustained = sustained.filter((s) => s.id !== body.id);
      break;
    case 'toggle':
      if (!body.id) throw httpError(400, 'bad_request', 'id is required to toggle');
      sustained = sustained.map((s) =>
        s.id === body.id ? { ...s, exempt: body.exempt ?? !s.exempt } : s,
      );
      break;
    default:
      sustained = [];
  }
  return { ...play, sustained };
}
