/**
 * Token identification (FR12.9) — "who is this?"
 *
 * Grunt numbering and NPC matching are bookkeeping, not fiction, so they are
 * done deterministically here rather than asked of a model: four tokens all
 * called "Ganger with the shotgun" become #1..#4 in a stable reading order, and
 * every token gets a one-line description built from the live encounter row it
 * belongs to (boxes filled, initiative, status effects) — the numbers the table
 * is playing with this pass, never remembered ones.
 *
 * This runs on the GM's surface, so hidden tokens are described too. The
 * proposed *labels* are a different matter: a rename lands on the table, and
 * player-visible tokens carry their name to every socket — so the caller
 * spoiler-scans the visible labels before saving, and nothing is renamed until
 * the GM accepts the draft (Principle 8).
 */
import { eq, inArray } from 'drizzle-orm';
import {
  characters,
  combatants,
  encounters,
  npcTemplates,
  scenes,
  tokens,
  type Db,
} from '@safehouse/db';
import { httpError } from '../services/auth.js';
import { activeSceneRow, effectNames, monitorsOf } from './state-core.js';

export type MatchKind = 'character' | 'combatant' | 'npc_template' | 'prop';

export interface TokenIdentification {
  tokenId: string;
  currentName: string;
  /** Proposed name; equal to `currentName` when nothing needs changing. */
  label: string;
  changed: boolean;
  hidden: boolean;
  /** The "who's this?" line for hover / disambiguation mid-fight. */
  description: string;
  match: { kind: MatchKind; id: string | null; name: string | null } | null;
  /** high = matched by id, medium = matched by name, low = nothing to match. */
  confidence: 'high' | 'medium' | 'low';
  /** Group number when several tokens share a base name (grunt numbering). */
  ordinal: number | null;
}

export interface TokenIdentificationState {
  sceneId: string;
  sceneName: string;
  tokens: TokenIdentification[];
  /** Labels that would change, i.e. what an accepted draft would rename. */
  renames: number;
}

const TRAILING_ORDINAL = /\s*(?:#\s*\d+|\(\s*\d+\s*\))\s*$/;

/** "Ganger with the shotgun #3" → "Ganger with the shotgun". */
export function baseName(name: string): string {
  return name.replace(TRAILING_ORDINAL, '').trim() || name.trim();
}

function monitorPhrase(raw: unknown): string | null {
  const monitors = monitorsOf(raw);
  if (!monitors) return null;
  return `${monitors.physical.filled}/${monitors.physical.max}P ${monitors.stun.filled}/${monitors.stun.max}S`;
}

/**
 * Read every token on a scene and work out what each one is. Read-only: it
 * never writes a row, and the returned labels are proposals.
 */
export async function identifyTokensState(
  db: Db,
  campaignId: string,
  opts: { sceneId?: string } = {},
): Promise<TokenIdentificationState> {
  const scene = opts.sceneId
    ? (await db.select().from(scenes).where(eq(scenes.id, opts.sceneId)).limit(1))[0]
    : await activeSceneRow(db, campaignId);
  if (!scene || scene.campaignId !== campaignId) {
    throw httpError(404, 'not_found', 'no scene to read');
  }
  const tokenRows = (await db.select().from(tokens).where(eq(tokens.sceneId, scene.id))).sort(
    (a, b) => a.y - b.y || a.x - b.x || a.name.localeCompare(b.name),
  );

  // Everything a token could be pointing at, fetched once.
  const characterRows = await db
    .select()
    .from(characters)
    .where(eq(characters.campaignId, campaignId));
  const templateRows = await db
    .select()
    .from(npcTemplates)
    .where(eq(npcTemplates.campaignId, campaignId));
  const encounterIds = (
    await db
      .select({ id: encounters.id })
      .from(encounters)
      .where(eq(encounters.campaignId, campaignId))
  ).map((r) => r.id);
  const combatantRows =
    encounterIds.length === 0
      ? []
      : await db.select().from(combatants).where(inArray(combatants.encounterId, encounterIds));

  const characterById = new Map(characterRows.map((c) => [c.id, c]));
  const templateById = new Map(templateRows.map((t) => [t.id, t]));
  const combatantById = new Map(combatantRows.map((c) => [c.id, c]));
  const combatantBySourceId = new Map(
    combatantRows.filter((c) => c.sourceId !== null).map((c) => [c.sourceId!, c]),
  );
  const combatantByName = new Map(combatantRows.map((c) => [baseName(c.name).toLowerCase(), c]));

  // Grunt numbering: only groups with more than one member get numbers.
  const groupCounts = new Map<string, number>();
  for (const token of tokenRows) {
    const key = baseName(token.name).toLowerCase();
    groupCounts.set(key, (groupCounts.get(key) ?? 0) + 1);
  }
  const groupSeen = new Map<string, number>();

  const out: TokenIdentification[] = [];
  for (const token of tokenRows) {
    const base = baseName(token.name);
    const key = base.toLowerCase();
    const size = groupCounts.get(key) ?? 1;
    let ordinal: number | null = null;
    if (size > 1) {
      ordinal = (groupSeen.get(key) ?? 0) + 1;
      groupSeen.set(key, ordinal);
    }
    const label = ordinal === null ? base : `${base} #${ordinal}`;

    let match: TokenIdentification['match'] = null;
    let confidence: TokenIdentification['confidence'] = 'low';
    const facts: string[] = [];

    const character = token.sourceId ? characterById.get(token.sourceId) : undefined;
    const template = token.sourceId ? templateById.get(token.sourceId) : undefined;
    const combatant =
      (token.source === 'combatant' && token.sourceId
        ? combatantById.get(token.sourceId)
        : undefined) ??
      (token.sourceId ? combatantBySourceId.get(token.sourceId) : undefined) ??
      combatantByName.get(key);

    if (character) {
      match = { kind: 'character', id: character.id, name: character.name };
      confidence = 'high';
      facts.push('player character');
    } else if (template) {
      match = { kind: 'npc_template', id: template.id, name: template.name };
      confidence = 'high';
      facts.push(`NPC from the "${template.name}" template`);
    } else if (combatant) {
      match = { kind: 'combatant', id: combatant.id, name: combatant.name };
      confidence = token.sourceId ? 'high' : 'medium';
      facts.push(combatant.source === 'manual' ? 'hand-added combatant' : `${combatant.source} combatant`);
    } else {
      match = { kind: 'prop', id: null, name: null };
      facts.push(token.source === 'prop' ? 'scenery / prop, no combatant row' : 'no matching record');
    }

    if (combatant) {
      const boxes = monitorPhrase(combatant.monitors);
      if (boxes) facts.push(boxes);
      facts.push(`init ${combatant.initScore}`);
      const effects = effectNames(combatant.effects);
      if (effects.length > 0) facts.push(effects.join(', '));
      if (combatant.visibility !== 'public') facts.push('GM-only in the tracker');
    }
    if (token.hidden) facts.push('hidden from players');
    facts.push(`at ${token.x},${token.y}`);

    out.push({
      tokenId: token.id,
      currentName: token.name,
      label,
      changed: label !== token.name,
      hidden: token.hidden,
      description: `${label} — ${facts.join('; ')}`,
      match,
      confidence,
      ordinal,
    });
  }

  return {
    sceneId: scene.id,
    sceneName: scene.name,
    tokens: out,
    renames: out.filter((t) => t.changed).length,
  };
}
