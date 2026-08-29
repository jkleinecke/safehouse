/**
 * The magic and Matrix corners of the FR12.17 read surface.
 *
 * Both are honest about their edges. Sustaining is real live state — it comes
 * off each character's play record and carries the dice penalty the table is
 * eating right now (FR8.2) — but bound spirits and their services have no
 * tracker (FR8.3), and Overwatch scores and marks are run by hand (M7). Those
 * come back as `tracked: false` with a note rather than a zero, because a model
 * that reads "0 spirits" will happily tell the GM the mage has none.
 *
 * Split out of `state-codex.ts` to keep both files small; read-only, like
 * everything else in the catalog.
 */
import { eq } from 'drizzle-orm';
import { SheetV1Schema } from '@safehouse/contracts';
import { characters, matrixHosts, type Db } from '@safehouse/db';
import { splitStoredSheet } from '../services/characters.js';

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
    foci: Array<{ name: string; rating: number | null }>;
  }>;
  spirits: { tracked: false; note: string };
}

/** Foci are gear the GM typed; match by name rather than inventing a column. */
const FOCUS_HINT = /\bfocus(?:es)?\b/i;

export async function getMagicState(db: Db, campaignId: string): Promise<MagicState> {
  const rows = await db.select().from(characters).where(eq(characters.campaignId, campaignId));
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
    if (sheet.spells.length === 0 && sheet.powers.length === 0 && sustained.length === 0) continue;
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
      foci: sheet.gear
        .filter((g) => FOCUS_HINT.test(g.name))
        .map((g) => ({ name: g.name, rating: g.rating ?? null })),
    });
  }
  return {
    characters: out,
    spirits: {
      tracked: false,
      note: 'Bound spirits and their services have no tracker yet (FR8.3) — ask the GM rather than assuming zero.',
    },
  };
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
