/**
 * The world one E2E run plays in — arranged once, read by every spec.
 *
 * Playwright's global setup runs in the main process and the specs run in
 * workers, so the arrangement is handed over as a JSON file whose path travels
 * in `SAFEHOUSE_E2E_WORLD`. Nothing here talks to a browser.
 */
import { readFileSync } from 'node:fs';

/** A device session exactly as the app stores one (FR1.1). */
export interface DeviceSession {
  token: string;
  role: 'gm' | 'player' | 'observer' | 'display';
  campaignId: string;
}

export interface World {
  baseUrl: string;
  campaignId: string;
  campaignName: string;

  /** The GM's own device, minted by the bootstrap route inside `seed:demo`. */
  gm: DeviceSession;
  /** A player device that OWNS the sheet named by `playerAlias`. */
  player: DeviceSession;
  playerAlias: string;
  playerCharacterId: string;

  /** alias → character id, for every PC in the demo campaign. */
  characters: Record<string, string>;

  sceneId: string;
  sceneName: string;
  /** The active scene's environment note, so a spec can prove it is dim. */
  sceneLight: number;

  encounterId: string;
  encounterName: string;
  stagedCombatants: number;
  /** Public combatant names a player/TV is entitled to see. */
  publicCombatants: string[];
  /** GM-layer token names that must never reach a player's DOM (FR9.7). */
  hiddenTokenNames: string[];

  /** A GM-only log line that must never reach a player's DOM (FR2.7). */
  gmOnlyLogText: string;
  /** A public log line, to prove the player IS receiving the log at all. */
  publicLogText: string;

  /** The roll persisted BEFORE any page mounts — the LIVE-1 hydration probe. */
  seededRoll: {
    id: string;
    pool: number;
    label: string;
    actorName: string;
  };

  /** Reusable invite codes minted for the specs (maxUses is unlimited). */
  codes: {
    display: string;
    player: string;
  };
}

export const WORLD_ENV = 'SAFEHOUSE_E2E_WORLD';

export function readWorld(): World {
  const path = process.env[WORLD_ENV];
  if (!path) {
    throw new Error(
      `${WORLD_ENV} is not set — the E2E global setup did not run. Use \`pnpm --filter @safehouse/web e2e\`.`,
    );
  }
  return JSON.parse(readFileSync(path, 'utf8')) as World;
}
