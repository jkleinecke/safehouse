/**
 * The magic and Matrix corners of the FR12.17 read surface.
 *
 * Both are honest about their edges. Sustaining is real live state — it comes
 * off each character's play record and carries the dice penalty the table is
 * eating right now (FR8.2) — and since the FR8.3 spirit tracker landed, so are
 * spirits, their Force and their remaining services: the honest answer there is
 * a number, not a disclaimer. Overwatch scores and marks are still run by hand
 * (M7) and come back as `tracked: false` with a note rather than a zero,
 * because a model that reads "0" will happily tell the GM there is none.
 *
 * Split out of `state-codex.ts` to keep both files small; read-only, like
 * everything else in the catalog.
 */
import { eq } from 'drizzle-orm';
import { SheetV1Schema } from '@safehouse/contracts';
import { characters, matrixHosts, type Db } from '@safehouse/db';
import { splitStoredSheet } from '../services/characters.js';
import { getMagicTracker, type MagicTracker } from '../services/magic-foci.js';

export interface MagicState {
  characters: Array<{
    characterId: string;
    name: string;
    spells: Array<{ name: string; category: string | null; drain: string | null }>;
    powers: Array<{ name: string; rating: number | null }>;
    /** Live sustaining, from play state — the −2s the table is eating now. */
    sustained: Array<{ id: string; name: string; exempt: boolean }>;
    /** Total sustaining dice penalty right now (FR8.2, −2 each, exemptions free). */
    sustainingPenalty: number;
    /**
     * The tracked focus rack first (FR8.4 — real toggles, with the two gates
     * the pipeline reads), then any gear the GM typed that *looks* like a focus
     * but was never registered, marked `tracked: false` so the model can tell
     * "switched off" from "never entered".
     */
    foci: Array<{
      name: string;
      rating: number | null;
      bonded: boolean | null;
      active: boolean | null;
      tracked: boolean;
    }>;
    /** Reagent drams on hand (FR8.4). */
    reagents: number;
  }>;
  /** FR8.3: bound and unbound spirits with Force and services remaining. */
  spirits: { tracked: true; list: MagicTracker['spirits'] };
}

/** Gear the GM typed that reads like a focus but is not in the rack. */
const FOCUS_HINT = /\bfocus(?:es)?\b/i;

export async function getMagicState(db: Db, campaignId: string): Promise<MagicState> {
  const [rows, tracker] = await Promise.all([
    db.select().from(characters).where(eq(characters.campaignId, campaignId)),
    getMagicTracker(db, campaignId),
  ]);
  const dramsOf = new Map(tracker.reagents.map((r) => [r.characterId, r.drams]));
  const out: MagicState['characters'] = [];
  for (const row of rows) {
    let sheet;
    let play;
    try {
      ({ sheet, play } = splitStoredSheet(row.sheet));
    } catch {
      continue;
    }
    const sustained = play.sustained.map((s) => ({ id: s.id, name: s.name, exempt: s.exempt }));
    const tracked = tracker.foci.filter((f) => f.characterId === row.id);
    const trackedNames = new Set(tracked.map((f) => f.name.toLowerCase()));
    const spirits = tracker.spirits.filter((s) => s.characterId === row.id);
    if (
      sheet.spells.length === 0 &&
      sheet.powers.length === 0 &&
      sustained.length === 0 &&
      tracked.length === 0 &&
      spirits.length === 0
    ) {
      continue;
    }
    out.push({
      characterId: row.id,
      name: row.name,
      spells: sheet.spells.map((s) => ({
        name: s.name,
        category: s.category ?? null,
        drain: s.drain ?? null,
      })),
      powers: sheet.powers.map((p) => ({ name: p.name, rating: p.rating ?? null })),
      sustained,
      sustainingPenalty: sustained.filter((s) => !s.exempt).length * -2,
      foci: [
        ...tracked.map((f) => ({
          name: f.name,
          rating: f.force,
          bonded: f.bonded,
          active: f.active,
          tracked: true,
        })),
        ...sheet.gear
          .filter((g) => FOCUS_HINT.test(g.name) && !trackedNames.has(g.name.toLowerCase()))
          .map((g) => ({
            name: g.name,
            rating: g.rating ?? null,
            bonded: null,
            active: null,
            tracked: false,
          })),
      ],
      reagents: dramsOf.get(row.id) ?? 0,
    });
  }
  return { characters: out, spirits: { tracked: true, list: tracker.spirits } };
}

export interface MatrixState {
  characters: Array<{
    characterId: string;
    name: string;
    deck: { name: string; asdf: number[]; programs: string[] } | null;
    complexForms: Array<{ name: string; target: string | null; fading: string | null }>;
  }>;
  hosts: Array<{ id: string; name: string; rating: number; asdf: unknown; icRoster: unknown }>;
  overwatch: { tracked: false; note: string };
  marks: { tracked: false; note: string };
}

export async function getMatrixState(db: Db, campaignId: string): Promise<MatrixState> {
  const [characterRows, hostRows] = await Promise.all([
    db.select().from(characters).where(eq(characters.campaignId, campaignId)),
    db.select().from(matrixHosts).where(eq(matrixHosts.campaignId, campaignId)),
  ]);
  const out: MatrixState['characters'] = [];
  for (const row of characterRows) {
    const parsed = SheetV1Schema.safeParse(row.sheet);
    if (!parsed.success) continue;
    const deck = parsed.data.matrix.deck;
    if (!deck && parsed.data.complexForms.length === 0) continue;
    out.push({
      characterId: row.id,
      name: row.name,
      deck: deck ? { name: deck.name, asdf: [...deck.asdf], programs: deck.programs } : null,
      complexForms: parsed.data.complexForms.map((f) => ({
        name: f.name,
        target: f.target ?? null,
        fading: f.fading ?? null,
      })),
    });
  }
  const note =
    'The Matrix toolkit (M7) is not built: the GM runs Overwatch and marks by hand, so this is unknown, not zero.';
  return {
    characters: out,
    hosts: hostRows.map((h) => ({
      id: h.id,
      name: h.name,
      rating: h.rating,
      asdf: h.asdf,
      icRoster: h.icRoster,
    })),
    overwatch: { tracked: false, note },
    marks: { tracked: false, note },
  };
}
