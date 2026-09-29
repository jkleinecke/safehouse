/**
 * Files the GM attaches to the Fixer chat — the disk side.
 *
 * A file is uploaded once through the ordinary attachment store (GM-only,
 * `POST /api/attachments`), and a chat message carries only its
 * `/files/<id>` URL. Here that URL becomes something the model can use:
 *
 * - a TEXT file is read once, when it is first seen, and kept in the
 *   conversation's memory — small ones ride along whole every turn, big ones
 *   are searched with `read_attachment` (memory.ts);
 * - an IMAGE is read from disk each time it is sent, as a data URL, and only
 *   on the turns it is meant to be seen — images are expensive on a local
 *   vision model, and a picture re-sent every turn would eat the window.
 *
 * Everything is scoped to the campaign: a file id from another campaign is
 * treated as missing.
 */
import { readFile, rm } from 'node:fs/promises';
import type { UIMessage } from 'ai';
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import {
  aiConversations,
  aiGenerations,
  attachments,
  audioTracks,
  books,
  builds,
  characters,
  gameSessions,
  npcTemplates,
  runs,
  scenes,
  tokens,
  wikiPages,
  wikiRevisions,
  wsEvents,
  type Db,
} from '@safehouse/db';
import { ScenesService } from '../../services/scenes.js';
import { UUID_RE } from '../conversations.js';
import { attachmentIdOf, estimateTokens, readMemory, type AttachedFile, type ConversationMemory } from './memory.js';

/** More text than this is cut when a file is read in — a novel is not a handout. */
const MAX_TEXT_CHARS = 400_000;
/** Largest image sent to the model, in bytes. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|ya?ml|xml|html?|log|ini|toml)$/i;

function kindOf(mediaType: string, name: string): AttachedFile['kind'] {
  if (mediaType.startsWith('image/')) return 'image';
  if (mediaType.startsWith('text/') || /json|xml|yaml|csv|markdown/.test(mediaType) || TEXT_EXT.test(name)) {
    return 'text';
  }
  return 'other';
}

async function readAttachment(db: Db, campaignId: string, id: string): Promise<Buffer | null> {
  const svc = new ScenesService(db);
  const row = await svc.attachment(id).catch(() => null);
  if (!row || row.campaignId !== campaignId) return null;
  return readFile(svc.attachmentPath(row)).catch(() => null);
}

/**
 * Record the files on a new GM message in the conversation's memory. Text
 * is read now, once; an image is only noted — its bytes are read when it is
 * sent. A file already known is left as it was.
 */
export async function registerAttachments(
  db: Db,
  campaignId: string,
  message: UIMessage,
  memory: ConversationMemory,
): Promise<ConversationMemory> {
  let files = memory.files;
  for (const part of message.parts) {
    if (part.type !== 'file') continue;
    const id = attachmentIdOf(part.url);
    if (!id || files[id]) continue;
    const name = part.filename ?? id;
    const kind = kindOf(part.mediaType, name);
    const entry: AttachedFile = { id, name, mediaType: part.mediaType, kind };
    if (kind === 'text') {
      const bytes = await readAttachment(db, campaignId, id);
      if (bytes) {
        const text = bytes.toString('utf8').slice(0, MAX_TEXT_CHARS);
        entry.text = text;
        entry.tokens = estimateTokens(text.length, memory.charsPerToken);
      }
    }
    files = { ...files, [id]: entry };
  }
  return files === memory.files ? memory : { ...memory, files };
}

/** An attached image as a data URL, or null when it is gone, too big, or not this campaign's. */
export async function imageDataUrl(db: Db, campaignId: string, id: string, mediaType: string): Promise<string | null> {
  const bytes = await readAttachment(db, campaignId, id);
  if (!bytes || bytes.length > MAX_IMAGE_BYTES) return null;
  return `data:${mediaType};base64,${bytes.toString('base64')}`;
}

/** The files a chat carries: those its memory registered and those on the GM's own messages. */
export function chatFileIds(messages: unknown, memory: unknown): string[] {
  const ids = new Set(Object.keys(readMemory(memory).files));
  for (const m of Array.isArray(messages) ? messages : []) {
    const msg = m as { role?: unknown; parts?: unknown } | null;
    if (msg?.role !== 'user' || !Array.isArray(msg.parts)) continue;
    for (const p of msg.parts as Array<{ type?: unknown; url?: unknown } | null>) {
      const id = p?.type === 'file' && typeof p.url === 'string' ? attachmentIdOf(p.url) : null;
      if (id) ids.add(id);
    }
  }
  return [...ids].filter((id) => UUID_RE.test(id));
}

/**
 * Is the file named anywhere else in the campaign? Whole rows are searched
 * as text, so a link in any column or JSON field counts — a scene's map, a
 * token's art, a wiki handout, a sheet's portrait, another chat.
 */
async function fileInUse(db: Db, campaignId: string, id: string): Promise<boolean> {
  const named = (table: PgTable): SQL => sql`${table}::text like ${`%${id}%`}`;
  const ownScenes = db.select({ id: scenes.id }).from(scenes).where(eq(scenes.campaignId, campaignId));
  const ownPages = db.select({ id: wikiPages.id }).from(wikiPages).where(eq(wikiPages.campaignId, campaignId));
  const checks: Array<() => Promise<unknown[]>> = [
    () => db.select({ id: books.id }).from(books).where(eq(books.attachmentId, id)).limit(1),
    () => db.select({ id: audioTracks.id }).from(audioTracks).where(eq(audioTracks.attachmentId, id)).limit(1),
    () => db.select({ id: tokens.id }).from(tokens).where(and(inArray(tokens.sceneId, ownScenes), named(tokens))).limit(1),
    () =>
      db
        .select({ seq: wikiRevisions.seq })
        .from(wikiRevisions)
        .where(and(inArray(wikiRevisions.wikiPageId, ownPages), named(wikiRevisions)))
        .limit(1),
    // Shown to the table once, even if hidden again: the table's feed still names it.
    () =>
      db
        .select({ id: wsEvents.id })
        .from(wsEvents)
        .where(
          and(
            eq(wsEvents.campaignId, campaignId),
            eq(wsEvents.type, 'handout.revealed'),
            sql`${wsEvents.payload}->>'attachmentId' = ${id}`,
          ),
        )
        .limit(1),
  ];
  for (const table of [aiConversations, scenes, wikiPages, characters, builds, npcTemplates, aiGenerations, runs, gameSessions]) {
    checks.push(() =>
      db.select({ one: sql`1` }).from(table).where(and(eq(table.campaignId, campaignId), named(table))).limit(1),
    );
  }
  for (const check of checks) if ((await check()).length > 0) return true;
  return false;
}

/**
 * Clear a deleted chat's files: the chat's own uploads (GM-only handouts of
 * this campaign) that nothing else names. Row first, then the bytes, so a failed
 * unlink leaves a stray file rather than a row pointing at nothing.
 */
export async function removeChatFiles(db: Db, campaignId: string, ids: readonly string[]): Promise<string[]> {
  const svc = new ScenesService(db);
  const removed: string[] = [];
  for (const id of ids) {
    const row = await svc.attachment(id).catch(() => null);
    // A handout revealed to the players is theirs too (their handouts list): kept.
    if (!row || row.campaignId !== campaignId || row.kind !== 'handout' || row.visibility !== 'gm') continue;
    if (await fileInUse(db, campaignId, id)) continue;
    await db.delete(attachments).where(eq(attachments.id, id));
    await rm(svc.attachmentPath(row), { force: true }).catch(() => undefined);
    removed.push(id);
  }
  return removed;
}

/**
 * The parts of a text file that answer `query`: paragraphs scored by how
 * many of the query's words they contain, best first, joined until `limit`
 * characters. No query, or nothing matching, reads from `offset`.
 */
export function searchText(text: string, query: string | undefined, offset = 0, limit = 6_000): string {
  const words = (query ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2);
  if (words.length > 0) {
    const paragraphs = text.split(/\n\s*\n/);
    const scored = paragraphs
      .map((p, i) => {
        const lower = p.toLowerCase();
        return { i, p, score: words.reduce((n, w) => n + (lower.includes(w) ? 1 : 0), 0) };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.i - b.i);
    if (scored.length > 0) {
      const out: string[] = [];
      let used = 0;
      for (const { p } of scored) {
        if (used + p.length > limit && out.length > 0) break;
        out.push(p.slice(0, limit));
        used += p.length;
      }
      return out.join('\n\n…\n\n');
    }
  }
  const start = Math.max(0, Math.min(offset, text.length));
  const slice = text.slice(start, start + limit);
  const more = start + limit < text.length ? `\n\n[… ${text.length - start - limit} more characters; read on with offset ${start + limit}]` : '';
  return slice + more;
}
