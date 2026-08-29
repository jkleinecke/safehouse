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

  /**
   * The one book in the library (M11). The PDF is manufactured by
   * `fixtures/pdf.ts` and registered through the real `seed:books` path, so the
   * code and offset are the seeder's own guess for the core rulebook, not
   * values the fixture asserted into existence.
   */
  book: {
    /** `SR5`. */
    code: string;
    title: string;
    /** The printed page the reader spec opens: 426. */
    printedPage: number;
    /** What the server resolved it to — 431, if the offset is the measured +5. */
    pdfPage: number;
    pageOffset: number;
    /** Pages in the file, so a clamp can be told apart from a jump. */
    pageCount: number;
    /** Bytes on disk — the denominator for "streamed, not downloaded". */
    bytes: number;
    /** A shared codex page whose prose autolinks `SR5 p.426` into a chip. */
    refPageId: string;
    refPageTitle: string;
  };

  /**
   * The generator-backed NPC that is UP, and therefore the one row FR10.10
   * puts a tactical hint on. GM-visibility: a player's tracker has neither the
   * row nor the hint.
   */
  hint: {
    combatantId: string;
    name: string;
  };

  /** Reusable invite codes minted for the specs (maxUses is unlimited). */
  codes: {
    display: string;
    player: string;
  };
}

/**
 * The sentence on the codex ref page that ends in `SR5 p.426`.
 *
 * Shared between the arrangement that writes it and the spec that clicks the
 * chip inside it, because the page has TWO chips for the same ref: the one
 * FR11.4 autolinked out of the prose, and the one the sidebar renders from the
 * page's structured `refs`. The reader spec is about the first.
 */
export const REF_PROSE = 'but the table still wants the page:';

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
