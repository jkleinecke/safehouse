/**
 * The "new chat" button, with a small menu: New at the top, then the saved
 * chats last used first — click one to open it, × twice to delete it, More
 * for older ones. The server keeps every chat (fixer/conversations.ts); the
 * Fixer chat and the NPC voice each list their own.
 */
import { useEffect, useRef, useState } from 'react';
import Icon from '../../../components/Icon.js';
import ConfirmButton from '../../grid/gm/ConfirmButton.js';
import { isChatRunning, useCancelAi, useChats, useDeleteChat, type ChatFilter, type ChatSummary } from './api.js';

/** "just now", "5m ago", "3h ago", "2d ago", then the date. */
export function usedAgo(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (!Number.isFinite(s)) return '';
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d < 30 ? `${d}d ago` : new Date(iso).toLocaleDateString();
}

export interface ChatRowsProps {
  chats: readonly ChatSummary[];
  /** The chat on screen, marked. */
  currentId: string | undefined;
  /** Why another chat cannot be opened right now, if it cannot. */
  locked?: string | undefined;
  now: number;
  onOpen: (chat: ChatSummary) => void;
  onDelete: (chat: ChatSummary) => void;
  /** The chat whose delete is in flight. */
  deleting?: string | undefined;
}

/** The saved chats, one row each: title, when last used, how long, and the delete. */
export function ChatRows({ chats, currentId, locked, now, onOpen, onDelete, deleting }: ChatRowsProps) {
  return (
    <>
      {chats.map((c) => {
        const current = c.id === currentId;
        return (
          <div
            key={c.id}
            className="flex items-center gap-1 pr-2 hover:bg-raised"
            data-testid="chat-row"
            data-current={current ? 'yes' : 'no'}
          >
            <button
              type="button"
              className="flex min-w-0 flex-1 items-start gap-2 py-1.5 pl-3 text-left disabled:opacity-50"
              aria-current={current ? 'true' : undefined}
              disabled={Boolean(locked) && !current}
              title={current ? 'On screen' : (locked ?? `Open — ${c.title || 'untitled'}`)}
              onClick={() => onOpen(c)}
            >
              <span className="mt-0.5 w-4 shrink-0 text-cyan">{current ? <Icon name="check" size={14} /> : null}</span>
              <span className="min-w-0">
                <span className="block truncate text-sm text-ink">{c.title || 'Untitled'}</span>
                <span className="mono-label block text-faint">
                  {usedAgo(c.updatedAt, now)} · {c.messageCount} {c.messageCount === 1 ? 'message' : 'messages'}
                  {c.running && <span className="text-cyan"> · answering</span>}
                </span>
              </span>
            </button>
            <ConfirmButton
              label="×"
              confirmLabel="Delete?"
              title="Delete this chat and the files uploaded into it"
              className="shrink-0 rounded border border-transparent px-1.5 py-0.5 text-sm leading-none opacity-70 hover:opacity-100"
              disabled={deleting === c.id}
              onConfirm={() => onDelete(c)}
              testId="chat-delete"
            />
          </div>
        );
      })}
    </>
  );
}

export interface ChatMenuProps {
  campaignId: string;
  filter: ChatFilter;
  currentId: string | undefined;
  /** Why New and Open are off right now (an answer is being written), if they are. */
  locked?: string | undefined;
  /** New's tooltip. */
  newTitle: string;
  onNew: () => void;
  onOpen: (chat: ChatSummary) => void;
  /** A chat is gone — the panel starts fresh if it was the one on screen. */
  onDeleted: (id: string) => void;
  testId: string;
}

export default function ChatMenu(props: ChatMenuProps) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  return (
    <div ref={box} className="relative ml-auto">
      <button
        type="button"
        className="btn px-2 py-1"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Chats"
        title="New chat, or open an earlier one"
        onClick={() => setOpen((o) => !o)}
        data-testid={props.testId}
      >
        <Icon name="add_comment" size={18} />
      </button>
      {open && <ChatMenuPanel {...props} close={() => setOpen(false)} />}
    </div>
  );
}

/** The open menu; mounted only while open, so the list is fetched fresh each time. */
function ChatMenuPanel({
  campaignId,
  filter,
  currentId,
  locked,
  newTitle,
  onNew,
  onOpen,
  onDeleted,
  testId,
  close,
}: ChatMenuProps & { close: () => void }) {
  const chats = useChats(campaignId, filter);
  const del = useDeleteChat(campaignId);
  const cancel = useCancelAi(campaignId);
  const [now] = useState(() => Date.now());
  const rows = chats.data?.pages.flatMap((page) => page.conversations) ?? [];

  return (
    <div
      role="dialog"
      aria-label="Chats"
      className="absolute right-0 top-full z-30 mt-1 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-edge bg-panel py-1 shadow-lg"
      data-testid={`${testId}-menu`}
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-cyan hover:bg-raised disabled:opacity-50"
        disabled={Boolean(locked)}
        title={locked ?? newTitle}
        onClick={() => {
          onNew();
          close();
        }}
        data-testid={`${testId}-new`}
      >
        <Icon name="add" size={16} />
        New
      </button>
      <div className="my-1 border-t border-edge" />
      <div className="max-h-72 overflow-y-auto">
        <ChatRows
          chats={rows}
          currentId={currentId}
          locked={locked}
          now={now}
          onOpen={(c) => {
            if (c.id !== currentId) onOpen(c);
            close();
          }}
          onDelete={(c) => del.mutate(c.id, { onSuccess: () => onDeleted(c.id) })}
          deleting={del.isPending ? del.variables : undefined}
        />
        {chats.isPending && <p className="mono-label animate-pulse px-3 py-1 text-faint">loading</p>}
        {chats.isSuccess && rows.length === 0 && <p className="px-3 py-1 text-xs text-faint">No saved chats yet.</p>}
        {chats.hasNextPage && (
          <button
            type="button"
            className="w-full px-3 py-1 text-left text-xs text-dim hover:bg-raised hover:text-ink disabled:opacity-50"
            onClick={() => void chats.fetchNextPage()}
            disabled={chats.isFetchingNextPage}
            title="Older chats"
            data-testid={`${testId}-more`}
          >
            {chats.isFetchingNextPage ? 'loading…' : 'More'}
          </button>
        )}
      </div>
      {chats.isError && <p className="px-3 py-1 text-xs text-danger">Could not load the chats.</p>}
      {del.error &&
        (isChatRunning(del.error) ? (
          // The server will not delete a chat mid-answer: stop it, then press × again.
          <p className="flex items-center gap-2 px-3 py-1 text-xs text-warn">
            <span>Still answering in that chat. Stop it, then delete.</span>
            <button
              type="button"
              className="btn px-2 py-0 text-danger"
              onClick={() => cancel.mutate(undefined, { onSuccess: () => del.reset() })}
              disabled={cancel.isPending}
              title="Stop the Fixer"
            >
              Stop
            </button>
          </p>
        ) : (
          <p className="px-3 py-1 text-xs text-danger">{del.error.message}</p>
        ))}
    </div>
  );
}
