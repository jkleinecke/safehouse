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
import { readFile } from 'node:fs/promises';
import type { UIMessage } from 'ai';
import type { Db } from '@safehouse/db';
import { ScenesService } from '../../services/scenes.js';
import { attachmentIdOf, estimateTokens, type AttachedFile, type ConversationMemory } from './memory.js';

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
