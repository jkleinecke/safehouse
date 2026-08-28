/**
 * THREAT READOUT math (FR10.5/10.6) — pure, client-side, recomputed live as
 * levers move. Everything here is an ESTIMATE (hits ≈ pool ÷ 3) and the UI
 * labels it as such; SR5 has no CR and we don't pretend otherwise.
 */
import type { SheetV1 } from '@safehouse/contracts';
import { deriveCharacter, exchangeEstimate, type ExchangeEstimate } from '@safehouse/rules';

/** One combat-relevant profile: a PC or one opposition statblock. */
export interface SideProfile {
  name: string;
  /** 'party' | 'opposition' — labeling only. */
  side: 'party' | 'opposition';
  /** Best attack pool and the weapon it came from. */
  attackPool: number;
  attackLabel: string;
  /** Damage code of that attack, e.g. '8P' (defaults '0S' when unarmed/unknown). */
  dv: string;
  defensePool: number;
  soakPool: number;
  physicalBoxes: number;
  /** Estimated initiative score: base + dice × 3.5. */
  initEst: number;
  /** Estimated initiative passes from initEst (score − 10 per pass, min 1). */
  passesEst: number;
  /** Bodies this profile represents (grunt group size; 1 otherwise). */
  bodies: number;
}

/** Estimated passes for an initiative score: acts while score > 0, −10 each pass. */
export function estPasses(initScore: number): number {
  if (initScore <= 0) return 1;
  return Math.max(1, Math.ceil(initScore / 10));
}

/**
 * Build a profile from a SheetV1 via the shared rules engine — the same
 * derivation the table plays with (pools carry provenance server-side; here we
 * only need totals).
 */
export function profileFromSheet(
  name: string,
  side: 'party' | 'opposition',
  sheet: SheetV1,
  opts?: { bodies?: number },
): SideProfile {
  const derived = deriveCharacter(sheet);

  let attackPool = 0;
  let attackLabel = 'unarmed';
  let dv = '0S';
  for (const weapon of sheet.weapons) {
    const pool = derived.pools[`weapon.${weapon.name}`];
    if (pool && pool.total > attackPool) {
      attackPool = pool.total;
      attackLabel = weapon.name;
      dv = weapon.dv ?? '0S';
    }
  }
  if (attackPool === 0) {
    // No weapons — fall back to the biggest skill pool as a stand-in.
    for (const [key, pool] of Object.entries(derived.pools)) {
      if (key.startsWith('skill.') && pool.total > attackPool) {
        attackPool = pool.total;
        attackLabel = key.slice('skill.'.length);
      }
    }
  }

  const initBase = derived.initiative.physical.base.value;
  const initDice = derived.initiative.physical.dice.value;
  const initEst = initBase + initDice * 3.5;

  return {
    name,
    side,
    attackPool,
    attackLabel,
    dv,
    defensePool: derived.pools['defense']?.total ?? 0,
    soakPool: derived.pools['soak']?.total ?? 0,
    physicalBoxes: derived.monitors.physical.value,
    initEst,
    passesEst: estPasses(initEst),
    bodies: Math.max(1, opts?.bodies ?? 1),
  };
}

/** One direction of the table: attacker's expected exchange into defender. */
export interface ReadoutRow {
  attacker: SideProfile;
  defender: SideProfile;
  est: ExchangeEstimate;
  /** Estimated connects to fill the defender's physical monitor (null = never). */
  connectsToDrop: number | null;
}

/** Cross product, one direction: every attacker vs every defender. */
export function readoutRows(
  attackers: readonly SideProfile[],
  defenders: readonly SideProfile[],
): ReadoutRow[] {
  const rows: ReadoutRow[] = [];
  for (const attacker of attackers) {
    for (const defender of defenders) {
      const est = exchangeEstimate(
        attacker.attackPool,
        defender.defensePool,
        attacker.dv,
        defender.soakPool,
      );
      const connectsToDrop =
        est.boxesPerConnect > 0 ? Math.ceil(defender.physicalBoxes / est.boxesPerConnect) : null;
      rows.push({ attacker, defender, est, connectsToDrop });
    }
  }
  return rows;
}

/** Action-economy comparison (FR10.5): bodies × est. passes per side. */
export interface ActionEconomy {
  bodies: number;
  /** Sum over profiles of bodies × passesEst — expected actions per combat turn. */
  actionsPerTurn: number;
  /** Highest estimated initiative score on the side (who likely goes first). */
  topInit: number;
}

export function actionEconomy(profiles: readonly SideProfile[]): ActionEconomy {
  let bodies = 0;
  let actions = 0;
  let topInit = 0;
  for (const p of profiles) {
    bodies += p.bodies;
    actions += p.bodies * p.passesEst;
    if (p.initEst > topInit) topInit = p.initEst;
  }
  return { bodies, actionsPerTurn: actions, topInit };
}
