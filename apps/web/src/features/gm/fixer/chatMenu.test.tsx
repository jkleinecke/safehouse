/**
 * The saved-chats menu: each row says what the chat was, when it was last
 * used and how long it is, marks the one on screen and the one the Fixer is
 * answering in; the socket tells every panel which chat was deleted, and
 * which chat a run is answering in.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { useLiveStore } from '../../../live/store.js';
import type { ChatSummary } from './api.js';
import { ChatRows, usedAgo } from './ChatMenu.js';
import { linesOf } from './NpcVoice.js';

const NOW = Date.parse('2026-09-28T20:00:00.000Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const chat = (id: string, over: Partial<ChatSummary> = {}): ChatSummary => ({
  id,
  kind: 'fixer',
  npcRef: null,
  title: `chat ${id}`,
  messageCount: 4,
  createdAt: ago(86_400_000),
  updatedAt: ago(5 * 60_000),
  running: false,
  ...over,
});

describe('usedAgo', () => {
  it('says how long since, coarsely', () => {
    expect(usedAgo(ago(20_000), NOW)).toBe('just now');
    expect(usedAgo(ago(5 * 60_000), NOW)).toBe('5m ago');
    expect(usedAgo(ago(3 * 3_600_000), NOW)).toBe('3h ago');
    expect(usedAgo(ago(2 * 86_400_000), NOW)).toBe('2d ago');
    expect(usedAgo('not a date', NOW)).toBe('');
  });
});

describe('the rows', () => {
  const render = (locked?: string) =>
    renderToStaticMarkup(
      <ChatRows
        chats={[chat('a'), chat('b', { running: true, messageCount: 1, title: '' })]}
        currentId="a"
        locked={locked}
        now={NOW}
        onOpen={() => undefined}
        onDelete={() => undefined}
      />,
    );

  it('marks the chat on screen and the one being answered, with a delete on each', () => {
    const html = render();
    expect(html).toContain('data-current="yes"');
    expect(html).toContain('aria-current="true"');
    expect(html).toContain('chat a');
    expect(html).toContain('5m ago · 4 messages');
    expect(html).toContain('1 message');
    expect(html).toContain('· answering');
    expect(html).toContain('Untitled');
    expect(html.match(/data-testid="chat-delete"/g)).toHaveLength(2);
  });

  it('while locked, only the chat on screen can be pressed', () => {
    const openButtons = (html: string) =>
      html
        .split('data-testid="chat-row"')
        .slice(1)
        .map((row) => /<button[^>]*>/.exec(row)![0]);
    expect(openButtons(render()).map((b) => b.includes('disabled=""'))).toEqual([false, false]);
    const locked = openButtons(render('Wait for the answer, or stop it'));
    expect(locked.map((b) => b.includes('disabled=""'))).toEqual([false, true]);
    expect(locked[1]).toContain('title="Wait for the answer, or stop it"');
  });
});

describe('an NPC chat reopened', () => {
  it('keeps the GM and NPC lines, and nothing else', () => {
    expect(
      linesOf([
        { role: 'system', content: 'persona' },
        { role: 'user', content: 'Who runs the pier?' },
        { role: 'assistant', content: 'Depends who asks.' },
        { role: 'assistant', content: null },
        { role: 'tool', content: '{}' },
      ]).map((l) => [l.who, l.text]),
    ).toEqual([
      ['gm', 'Who runs the pier?'],
      ['npc', 'Depends who asks.'],
    ]);
  });
});

describe('the socket', () => {
  beforeEach(() => useLiveStore.getState().reset());

  it('carries the chat a run is answering in', () => {
    useLiveStore.getState().handleEphemeral({
      type: 'ai.activity',
      payload: { state: 'busy', runId: 'r1', kind: 'chat', label: 'answering', since: ago(0), conversationId: 'c9' },
      ephemeral: true,
    });
    expect(useLiveStore.getState().aiActivity?.conversationId).toBe('c9');
  });

  it('numbers each deleted chat, so a panel showing it hears every one', () => {
    const s = useLiveStore.getState();
    s.handleEphemeral({ type: 'fixer.conversation', payload: { id: 'c1', deleted: true }, ephemeral: true });
    s.handleEphemeral({ type: 'fixer.conversation', payload: { id: 'c1', deleted: true }, ephemeral: true });
    expect(useLiveStore.getState().chatDeleted).toEqual({ id: 'c1', seq: 2 });
    expect(useLiveStore.getState().fixerStream).toHaveLength(0);
  });
});
