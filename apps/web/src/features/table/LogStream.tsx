/**
 * The session log (FR2.9): rolls, damage, reveals, scene markers, ledger
 * callouts, and table talk — interleaved, append-only, auto-scrolling.
 * Table-talk input docked at the bottom (players + GM, §13).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveStore } from '../../live/store.js';
import { postTableTalk } from './commands.js';
import RollCard from './RollCard.js';
import type { LogItem } from './views.js';
import { toLogItems } from './views.js';

function timeOf(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function LogLine({ item }: { item: LogItem }) {
  switch (item.kind) {
    case 'roll':
      return <RollCard roll={item.roll} />;
    case 'damage':
      return (
        <div className="sh-log-enter flex items-baseline gap-2 px-1 text-sm">
          <span className="text-danger">✚</span>
          <span>
            <span className="font-semibold">{item.name}</span>
            {item.boxes !== undefined && (
              <>
                {' '}takes <span className="font-label text-danger">{item.boxes}</span>
                {item.monitor ? ` ${item.monitor}` : ''} box{item.boxes === 1 ? '' : 'es'}
              </>
            )}
            {item.woundModifier !== undefined && item.woundModifier !== 0 && (
              <span className="mono-label ml-2 text-warn">wounds {item.woundModifier}</span>
            )}
            {item.note && <span className="text-dim"> — {item.note}</span>}
          </span>
          <span className="mono-label ml-auto shrink-0 text-faint">{timeOf(item.ts)}</span>
        </div>
      );
    case 'talk':
      return (
        <div className="sh-log-enter flex items-baseline gap-2 px-1 text-sm">
          <span className="shrink-0 font-semibold text-dim">{item.author}:</span>
          <span className="min-w-0 break-words">{item.text}</span>
          <span className="mono-label ml-auto shrink-0 text-faint">{timeOf(item.ts)}</span>
        </div>
      );
    case 'marker':
      return (
        <div className="sh-log-enter my-1 flex items-center gap-3">
          <div className="h-px flex-1 bg-edge" />
          <span className="mono-label text-cyan">{item.text}</span>
          <div className="h-px flex-1 bg-edge" />
        </div>
      );
    case 'reveal':
      return (
        <div className="sh-log-enter my-1 flex items-center gap-3">
          <div className="h-px flex-1 bg-magenta-dim/50" />
          <span className="mono-label text-magenta">◈ {item.text}</span>
          <div className="h-px flex-1 bg-magenta-dim/50" />
        </div>
      );
    case 'ledger':
      return (
        <div className="sh-log-enter flex items-baseline gap-2 px-1 text-sm">
          <span className={item.delta !== undefined && item.delta < 0 ? 'text-warn' : 'text-ok'}>¥</span>
          <span className="text-dim">{item.text}</span>
          <span className="mono-label ml-auto shrink-0 text-faint">{timeOf(item.ts)}</span>
        </div>
      );
  }
}

export default function LogStream({ campaignId }: { campaignId: string }) {
  const events = useLiveStore((s) => s.events);
  const items = useMemo(() => toLogItems(events), [events]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  // Stay pinned to the newest line unless the user scrolled up to read back.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [items.length]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const submit = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await postTableTalk(campaignId, text);
      setDraft('');
    } catch {
      // keep the draft so nothing typed is lost; the log shows nothing new
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="Session log">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3"
      >
        {items.length === 0 && (
          <p className="mt-8 text-center text-sm text-faint">
            The log is empty — rolls, damage, and table talk land here.
          </p>
        )}
        {items.map((item) => (
          <LogLine key={item.id} item={item} />
        ))}
      </div>

      <form
        className="flex gap-2 border-t border-edge p-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Table talk…"
          maxLength={500}
          className="min-w-0 flex-1 rounded-md border border-edge bg-deck px-3 py-2 text-sm outline-none placeholder:text-faint focus:border-cyan-dim"
        />
        <button type="submit" className="btn" disabled={sending || draft.trim() === ''}>
          Send
        </button>
      </form>
    </section>
  );
}
