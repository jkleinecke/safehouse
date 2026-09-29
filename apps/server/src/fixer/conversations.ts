/**
 * `ai_conversations` — per-campaign Fixer chat history and NPC transcripts
 * (FR12.1, FR12.6).
 *
 * The stored transcript is the OpenAI message list from the first GM message
 * on: user turns, assistant turns (tool calls included) and tool results, so a
 * follow-up question sees what the earlier round actually read. The system
 * prompt and the situation snapshot are NEVER stored — they are rebuilt every
 * turn so a live snapshot can never go stale (FR12.18).
 */
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { aiConversations, type Db } from '@safehouse/db';
import { httpError } from '../services/auth.js';
import { currentRun } from './activity.js';
import type { ChatMessage } from './llm.js';

/** A uuid-shaped id; anything else is "not found" rather than a Postgres cast error. */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** History replayed into each turn (older turns stay in the db, unsent). */
export const HISTORY_WINDOW = 40;

export interface ConversationHandle {
  id: string;
  kind: 'fixer' | 'npc';
  npcRef: string | null;
  messages: ChatMessage[];
  /** The Fixer chat's curated memory (fixer/chat/memory.ts); `{}` for anything else. */
  memory: unknown;
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (typeof value !== 'object' || value === null) return false;
  const role = (value as { role?: unknown }).role;
  return role === 'user' || role === 'assistant' || role === 'tool' || role === 'system';
}

export function readMessages(raw: unknown): ChatMessage[] {
  return Array.isArray(raw) ? raw.filter(isChatMessage) : [];
}

/** Window the history, dropping leading orphan tool results. */
export function trimHistory(messages: ChatMessage[]): ChatMessage[] {
  const window = messages.slice(-HISTORY_WINDOW);
  let start = 0;
  while (start < window.length && window[start]?.role === 'tool') start += 1;
  return window.slice(start);
}

/** Load an existing conversation, or open a new one. */
export async function loadConversation(
  db: Db,
  campaignId: string,
  opts: { kind: 'fixer' | 'npc'; conversationId?: string; npcRef?: string },
): Promise<ConversationHandle> {
  if (opts.conversationId) {
    if (!UUID_RE.test(opts.conversationId)) throw httpError(404, 'not_found', 'unknown conversation');
    const row = (
      await db
        .select()
        .from(aiConversations)
        .where(eq(aiConversations.id, opts.conversationId))
        .limit(1)
    )[0];
    if (!row || row.campaignId !== campaignId) {
      throw httpError(404, 'not_found', 'unknown conversation');
    }
    return { id: row.id, kind: row.kind, npcRef: row.npcRef, messages: readMessages(row.messages), memory: row.memory };
  }
  const created = (
    await db
      .insert(aiConversations)
      .values({ campaignId, kind: opts.kind, npcRef: opts.npcRef ?? null, messages: [] })
      .returning()
  )[0];
  if (!created) throw httpError(500, 'internal', 'conversation insert returned no row');
  return { id: created.id, kind: created.kind, npcRef: created.npcRef, messages: [], memory: {} };
}

export async function saveConversation(db: Db, id: string, messages: ChatMessage[]): Promise<void> {
  await db.update(aiConversations).set({ messages, updatedAt: new Date() }).where(eq(aiConversations.id, id));
}

/**
 * The Fixer chat's save: the whole transcript as UI messages (the SDK's own
 * format, which the chat panel reloads as-is) and its curated memory.
 * `messages` alone when the memory has not changed.
 */
export async function saveChat(db: Db, id: string, messages: unknown[], memory?: unknown): Promise<void> {
  const updatedAt = new Date();
  await db
    .update(aiConversations)
    .set(memory === undefined ? { messages, updatedAt } : { messages, memory, updatedAt })
    .where(eq(aiConversations.id, id));
}

/** Just the memory — calibration after a turn, without re-writing the transcript. */
export async function saveMemory(db: Db, id: string, memory: unknown): Promise<void> {
  await db.update(aiConversations).set({ memory, updatedAt: new Date() }).where(eq(aiConversations.id, id));
}

/**
 * The first thing the GM said, for a conversation's title — from either
 * shape: a Chat Completions message's `content`, or a UI message's text parts.
 */
function firstUserText(raw: unknown): string {
  if (!Array.isArray(raw)) return '';
  for (const m of raw) {
    if (typeof m !== 'object' || m === null || (m as { role?: unknown }).role !== 'user') continue;
    const content = (m as { content?: unknown }).content;
    if (typeof content === 'string') return content;
    const parts = (m as { parts?: unknown }).parts;
    if (Array.isArray(parts)) {
      const text = parts
        .filter((p): p is { type: 'text'; text: string } => (p as { type?: unknown }).type === 'text')
        .map((p) => p.text)
        .join(' ');
      if (text) return text;
    }
  }
  return '';
}

export interface ConversationSummary {
  id: string;
  kind: 'fixer' | 'npc';
  npcRef: string | null;
  messageCount: number;
  title: string;
  createdAt: string;
  /** Last save; the list is newest first by this. */
  updatedAt: string;
  /** The Fixer is answering in this chat right now. */
  running: boolean;
}

export interface ConversationPage {
  conversations: ConversationSummary[];
  /** Hand back as `cursor` for the next page; null on the last one. */
  nextCursor: string | null;
}

export interface ListConversationsOptions {
  kind?: 'fixer' | 'npc' | undefined;
  npcRef?: string | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
}

/** A save time to the microsecond, as Postgres keeps it — a JS Date would round it off. */
const CURSOR_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

function encodeCursor(at: string, id: string): string {
  return Buffer.from(JSON.stringify([at, id])).toString('base64url');
}

function decodeCursor(cursor: string): { at: string; id: string } {
  try {
    const [at, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown[];
    if (typeof at === 'string' && CURSOR_AT.test(at) && typeof id === 'string' && UUID_RE.test(id)) return { at, id };
  } catch {
    // falls through to the 400
  }
  throw httpError(400, 'bad_request', 'invalid cursor');
}

/**
 * A page of the campaign's chats, last saved first. Keyset paging on
 * (updated_at, id), so a chat saved mid-browse moves to the top rather than
 * shifting the page under the reader. Only the first few GM messages leave
 * the database, for the title — a transcript can run to megabytes.
 */
export async function listConversations(
  db: Db,
  campaignId: string,
  opts: ListConversationsOptions = {},
): Promise<ConversationPage> {
  const limit = Math.min(Math.max(Math.floor(opts.limit ?? 25), 1), 100);
  // An empty chat is a thread that never got its first answer started — not worth a line.
  const where: SQL[] = [eq(aiConversations.campaignId, campaignId), sql`${aiConversations.messages} <> '[]'::jsonb`];
  if (opts.kind) where.push(eq(aiConversations.kind, opts.kind));
  if (opts.npcRef) where.push(eq(aiConversations.npcRef, opts.npcRef));
  if (opts.cursor) {
    const { at, id } = decodeCursor(opts.cursor);
    where.push(sql`(${aiConversations.updatedAt}, ${aiConversations.id}) < (${at}::timestamptz, ${id}::uuid)`);
  }
  const messages = aiConversations.messages;
  const rows = await db
    .select({
      id: aiConversations.id,
      kind: aiConversations.kind,
      npcRef: aiConversations.npcRef,
      createdAt: aiConversations.createdAt,
      updatedAt: aiConversations.updatedAt,
      at: sql<string>`to_char(${aiConversations.updatedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      count: sql<number>`case when jsonb_typeof(${messages}) = 'array' then jsonb_array_length(${messages}) else 0 end`,
      firstUsers: sql<unknown>`case when jsonb_typeof(${messages}) = 'array' then (
        select jsonb_agg(u.value) from (
          select e.value from jsonb_array_elements(${messages}) e where e.value->>'role' = 'user' limit 3
        ) u
      ) end`,
    })
    .from(aiConversations)
    .where(and(...where))
    .orderBy(desc(aiConversations.updatedAt), desc(aiConversations.id))
    .limit(limit + 1);
  const running = currentRun(campaignId)?.conversationId;
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    conversations: page.map((row) => ({
      id: row.id,
      kind: row.kind,
      npcRef: row.npcRef,
      messageCount: Number(row.count),
      title: firstUserText(row.firstUsers).slice(0, 120),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      running: row.id === running,
    })),
    nextCursor: rows.length > limit && last ? encodeCursor(last.at, last.id) : null,
  };
}

/**
 * Remove one of this campaign's conversations — another campaign's, or an
 * unknown id, is a 404. Hands back what it held, so its files can be cleared.
 */
export async function deleteConversation(
  db: Db,
  campaignId: string,
  id: string,
): Promise<{ messages: unknown; memory: unknown }> {
  if (!UUID_RE.test(id)) throw httpError(404, 'not_found', 'unknown conversation');
  const row = (
    await db
      .delete(aiConversations)
      .where(and(eq(aiConversations.id, id), eq(aiConversations.campaignId, campaignId)))
      .returning({ messages: aiConversations.messages, memory: aiConversations.memory })
  )[0];
  if (!row) throw httpError(404, 'not_found', 'unknown conversation');
  return row;
}
