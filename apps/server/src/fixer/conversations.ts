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
import { desc, eq } from 'drizzle-orm';
import { aiConversations, type Db } from '@safehouse/db';
import { httpError } from '../services/auth.js';
import type { ChatMessage } from './llm.js';

/** History replayed into each turn (older turns stay in the db, unsent). */
export const HISTORY_WINDOW = 40;

export interface ConversationHandle {
  id: string;
  kind: 'fixer' | 'npc';
  npcRef: string | null;
  messages: ChatMessage[];
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
    return { id: row.id, kind: row.kind, npcRef: row.npcRef, messages: readMessages(row.messages) };
  }
  const created = (
    await db
      .insert(aiConversations)
      .values({ campaignId, kind: opts.kind, npcRef: opts.npcRef ?? null, messages: [] })
      .returning()
  )[0];
  if (!created) throw httpError(500, 'internal', 'conversation insert returned no row');
  return { id: created.id, kind: created.kind, npcRef: created.npcRef, messages: [] };
}

export async function saveConversation(db: Db, id: string, messages: ChatMessage[]): Promise<void> {
  await db.update(aiConversations).set({ messages }).where(eq(aiConversations.id, id));
}

export interface ConversationSummary {
  id: string;
  kind: 'fixer' | 'npc';
  npcRef: string | null;
  messageCount: number;
  title: string;
  createdAt: string;
}

export async function listConversations(
  db: Db,
  campaignId: string,
  limit = 25,
): Promise<ConversationSummary[]> {
  const rows = await db
    .select()
    .from(aiConversations)
    .where(eq(aiConversations.campaignId, campaignId))
    .orderBy(desc(aiConversations.createdAt))
    .limit(Math.min(Math.max(limit, 1), 100));
  return rows.map((row) => {
    const messages = readMessages(row.messages);
    const firstUser = messages.find((m) => m.role === 'user');
    return {
      id: row.id,
      kind: row.kind,
      npcRef: row.npcRef,
      messageCount: messages.length,
      title: (firstUser?.content ?? '').slice(0, 120),
      createdAt: row.createdAt.toISOString(),
    };
  });
}
