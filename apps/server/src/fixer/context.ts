/**
 * What the GM is looking at (UX proposal 4.2 — one assistant, everywhere).
 *
 * The dock follows the GM across every screen, so a message like "draft this
 * floor" or "what does he know" has a referent the model cannot see: the
 * scene on the canvas, the token under the cursor, the codex page, the sheet.
 * The web stamps that on each chat message and the server turns it into one
 * line of the situation snapshot, ids included so the tools can be called
 * with them straight away.
 *
 * Labels come from the client on purpose: this is GM-only advisory text for
 * the model, the names are the ones on the GM's own screen, and resolving
 * six ids per turn would cost more than it protects. Every field is short
 * and optional; an empty context adds nothing.
 */
import { z } from 'zod';

const label = z.string().trim().min(1).max(120);
const id = z.string().trim().min(1).max(64);

export const AiContextSchema = z.object({
  /** The SPA route, for the model's orientation ("map", "codex", "sheet", "sessions", …). */
  screen: z.enum(['map', 'codex', 'sheet', 'sessions', 'scenes', 'runs', 'generator', 'party', 'table', 'other']).optional(),
  sceneId: id.optional(),
  sceneName: label.optional(),
  /** Whether the scene on screen is the live one or a staged one. */
  sceneLive: z.boolean().optional(),
  level: z.number().int().min(0).max(40).optional(),
  levelName: label.optional(),
  selectedTokenId: id.optional(),
  selectedTokenName: label.optional(),
  /** The token's source, so "speak as them" knows an NPC from a runner. */
  selectedTokenSource: z.enum(['character', 'combatant', 'npc_template', 'prop']).optional(),
  pageId: id.optional(),
  pageTitle: label.optional(),
  characterId: id.optional(),
  characterName: label.optional(),
  npcId: id.optional(),
  npcName: label.optional(),
  encounterId: id.optional(),
});
export type AiContext = z.infer<typeof AiContextSchema>;

const SCREEN_WORDS: Record<NonNullable<AiContext['screen']>, string> = {
  map: 'the Map',
  codex: 'the Codex',
  sheet: 'a character sheet',
  sessions: 'the Sessions screen',
  scenes: 'the Scene manager',
  runs: 'the Runs board',
  generator: 'the NPC generator',
  party: 'the Party screen',
  table: 'the Table',
  other: 'the GM console',
};

/**
 * One line for the snapshot, or null when the context says nothing. Written
 * for the model: plain words, ids in brackets so `get_scene`, `get_page` and
 * `get_npc` can be called without a search first.
 */
export function whereTheGmIs(ctx: AiContext | undefined): string | null {
  if (!ctx) return null;
  const parts: string[] = [];
  if (ctx.screen) parts.push(`on ${SCREEN_WORDS[ctx.screen]}`);
  if (ctx.sceneName || ctx.sceneId) {
    const name = ctx.sceneName ?? 'a scene';
    const live = ctx.sceneLive === undefined ? '' : ctx.sceneLive ? ', the live one' : ', staged, not on the table';
    const floor = ctx.levelName ? ` — floor "${ctx.levelName}"` : ctx.level !== undefined && ctx.level > 0 ? ` — floor ${ctx.level}` : '';
    parts.push(`looking at scene "${name}"${ctx.sceneId ? ` [${ctx.sceneId}]` : ''}${live}${floor}`);
  }
  if (ctx.selectedTokenName || ctx.selectedTokenId) {
    const what =
      ctx.selectedTokenSource === 'npc_template'
        ? 'an NPC token'
        : ctx.selectedTokenSource === 'character'
          ? 'a runner'
          : ctx.selectedTokenSource === 'prop'
            ? 'a prop'
            : 'a token';
    parts.push(`with ${what} selected: ${ctx.selectedTokenName ?? 'unnamed'}${ctx.selectedTokenId ? ` [${ctx.selectedTokenId}]` : ''}`);
  }
  if (ctx.pageTitle || ctx.pageId) {
    parts.push(`reading the codex page "${ctx.pageTitle ?? 'untitled'}"${ctx.pageId ? ` [${ctx.pageId}]` : ''}`);
  }
  if (ctx.characterName || ctx.characterId) {
    parts.push(`on the sheet of ${ctx.characterName ?? 'a character'}${ctx.characterId ? ` [${ctx.characterId}]` : ''}`);
  }
  if (ctx.npcName || ctx.npcId) {
    parts.push(`with NPC ${ctx.npcName ?? 'unnamed'}${ctx.npcId ? ` [${ctx.npcId}]` : ''} in hand`);
  }
  if (ctx.encounterId) parts.push(`running encounter [${ctx.encounterId}]`);
  if (parts.length === 0) return null;
  return `WHERE THE GM IS: ${parts.join('; ')}. "This", "here" and "them" in the GM's message mean these unless they say otherwise.`;
}

/** The snapshot plus the where-line, or whichever exists, or null. */
export function joinSnapshot(snapshot: string | null, where: string | null): string | null {
  if (snapshot && where) return `${snapshot}\n${where}`;
  return snapshot ?? where;
}
