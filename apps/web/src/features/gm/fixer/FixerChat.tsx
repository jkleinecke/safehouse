/**
 * The Fixer chat (FR12.1): GM-only, streaming. Deltas arrive as `fixer.*`
 * ephemerals on the campaign socket and fold into the transcript here;
 * tool calls render as activity chips (FR12.17), the live-session situation
 * snapshot as its own chip (FR12.18), and tokens/latency as a usage meter
 * (FR12.16). No LLM configured → the panel says so and stays quiet (NG7).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveStore } from '../../../live/store.js';
import { fmtLatency, fmtTokens } from '../common.js';
import { ErrorNote, SectionTitle, Spinner } from '../ui.js';
import { aiDisabledFrom, isAiCancelled, useCancelAi, useFixerSend, useFixerStatus } from './api.js';
import { reduceFixerStream, type FixerUsage, type ToolChip } from './stream.js';

const SUGGESTIONS = [
  'Who on the team is hurt worst right now?',
  'Three complications for tonight, escalating.',
  'What does the team actually know about the Johnson?',
];

function ToolChipView({ chip }: { chip: ToolChip }) {
  const tone =
    chip.status === 'error'
      ? 'border-danger/50 text-danger'
      : chip.status === 'running'
        ? 'border-cyan-dim text-cyan animate-pulse'
        : 'border-edge text-dim';
  return (
    <span className={`chip ${tone}`} title={chip.detail ?? chip.name}>
      {chip.status === 'running' ? '▮' : chip.status === 'error' ? '✕' : '✓'} {chip.name}
      {chip.detail && <span className="normal-case text-faint">{chip.detail}</span>}
    </span>
  );
}

function UsageMeter({ last, total }: { last?: FixerUsage; total: FixerUsage }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-edge pt-2">
      <span className="mono-label text-faint">usage</span>
      <span className="chip text-dim" title="Tokens in the most recent turn">
        {fmtTokens(last?.totalTokens)} tok
      </span>
      <span className="chip text-dim" title="Latency of the most recent turn">
        {fmtLatency(last?.latencyMs)}
      </span>
      <span className="mono-label ml-auto text-faint">
        session total {fmtTokens(total.totalTokens)} tok
      </span>
    </div>
  );
}

export interface FixerChatProps {
  campaignId: string;
  /** Live session → default to the fast slot so inference never starves the table. */
  sessionLive?: boolean;
  /** Compact layout for the dock; the full page gives it more room. */
  dense?: boolean;
}

export default function FixerChat({ campaignId, sessionLive, dense }: FixerChatProps) {
  const chunks = useLiveStore((s) => s.fixerStream);
  const clearStream = useLiveStore((s) => s.clearFixerStream);
  const send = useFixerSend();
  const status = useFixerStatus();
  const cancel = useCancelAi(campaignId);

  const [draft, setDraft] = useState('');
  const [slot, setSlot] = useState<'primary' | 'fast'>(sessionLive ? 'fast' : 'primary');
  const [sent, setSent] = useState<{ text: string; ts: number }[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const scroller = useRef<HTMLDivElement | null>(null);

  const view = useMemo(() => reduceFixerStream(chunks), [chunks]);
  const disabled = aiDisabledFrom(status.data, status.error, send.error);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chunks.length, sent.length]);

  const submit = () => {
    const message = draft.trim();
    if (!message || disabled) return;
    setSent((s) => [...s, { text: message, ts: Date.now() }]);
    setDraft('');
    send.mutate(
      { campaignId, message, slot, ...(conversationId ? { conversationId } : {}) },
      { onSuccess: (ack) => ack.conversationId && setConversationId(ack.conversationId) },
    );
  };

  if (disabled) {
    return (
      <div className="panel p-5">
        <SectionTitle hint="NG7 — the app plays fine without it">The Fixer is offline</SectionTitle>
        <p className="mt-2 text-sm text-dim">
          Nothing is chosen yet. Pick a provider under{' '}
          <Link className="text-cyan underline" to={`/c/${campaignId}/gm/ai`}>
            AI
          </Link>{' '}
          — a box on your own machine, or Anthropic, OpenAI, xAI — and the panel comes back on the
          next message. <code className="text-cyan">LLM_BASE_URL</code> in{' '}
          <code className="text-cyan">.env</code> only sets the default until then.
        </p>
        {status.data?.models && (
          <p className="mono-label mt-2 text-faint">
            configured models: {status.data.models.primary} / {status.data.models.fast}
          </p>
        )}
      </div>
    );
  }

  // Interleave the GM's own lines with the streamed assistant turns by time.
  const timeline: Array<
    | { kind: 'user'; text: string; ts: number }
    | { kind: 'assistant'; index: number; ts: number }
  > = [
    ...sent.map((m) => ({ kind: 'user' as const, text: m.text, ts: m.ts })),
    ...view.messages.map((m, index) => ({ kind: 'assistant' as const, index, ts: m.ts })),
  ].sort((a, b) => a.ts - b.ts);

  return (
    <div className="panel flex min-h-0 flex-1 flex-col p-4">
      <div className="flex flex-wrap items-center gap-2">
        <SectionTitle hint="GM-only — players never talk to it">The Fixer</SectionTitle>
        <span className="chip text-faint" title="Model slot">
          {slot}
        </span>
        <button
          className="chip cursor-pointer text-dim hover:text-cyan"
          onClick={() => setSlot(slot === 'primary' ? 'fast' : 'primary')}
        >
          use {slot === 'primary' ? 'fast' : 'primary'}
        </button>
        <button
          className="btn ml-auto px-2.5 py-1"
          onClick={() => {
            clearStream();
            setSent([]);
            setConversationId(undefined);
          }}
          title="Clear the transcript buffer (history lives server-side)"
        >
          new thread
        </button>
      </div>

      {view.snapshot && (
        <div
          className="mt-2 rounded-md border border-cyan-dim/50 bg-deck px-3 py-2"
          title="Auto-prefixed while a session is live"
        >
          <span className="mono-label text-cyan">situation</span>
          <p className="mt-0.5 text-xs text-dim">{view.snapshot}</p>
        </div>
      )}

      <div
        ref={scroller}
        className={`mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1 ${dense ? 'max-h-80' : 'max-h-[60vh]'}`}
      >
        {timeline.length === 0 && (
          <div className="space-y-2">
            <p className="text-sm text-dim">
              Ask about the rules in your own books, the campaign's own state, or tonight's plan.
              Everything it writes lands as a draft you approve.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  className="chip cursor-pointer normal-case text-faint hover:text-cyan"
                  onClick={() => setDraft(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {timeline.map((item, i) =>
          item.kind === 'user' ? (
            <div key={`u${i}`} className="ml-auto max-w-[85%] rounded-md bg-raised px-3 py-2">
              <div className="mono-label text-faint">gm</div>
              <p className="whitespace-pre-wrap text-sm text-ink">{item.text}</p>
            </div>
          ) : (
            <div key={`a${i}`} className="max-w-[95%]">
              <div className="mono-label text-magenta">fixer</div>
              {view.messages[item.index]!.chips.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {view.messages[item.index]!.chips.map((chip, j) => (
                    <ToolChipView key={j} chip={chip} />
                  ))}
                </div>
              )}
              <p className="mt-1 whitespace-pre-wrap text-sm text-ink">
                {view.messages[item.index]!.text}
                {!view.messages[item.index]!.done && <span className="animate-pulse text-cyan">▮</span>}
              </p>
            </div>
          ),
        )}

        {view.error && (
          <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
            {view.error}
          </div>
        )}
      </div>

      <div className="mt-3 flex items-end gap-2">
        <textarea
          className="min-h-[2.5rem] w-full resize-y rounded-md border border-edge bg-deck px-2.5 py-1.5 text-sm text-ink placeholder:text-faint focus:border-cyan focus:outline-none"
          rows={dense ? 2 : 3}
          value={draft}
          placeholder="ask the Fixer…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button className="btn btn-accent shrink-0 px-3 py-2" onClick={submit} disabled={send.isPending}>
          {send.isPending ? 'sending…' : 'send'}
        </button>
      </div>
      <p className="mono-label mt-1 text-faint">ctrl+enter sends</p>
      {(view.streaming || send.isPending) && (
        <div className="mt-1 flex flex-wrap items-center gap-2" data-testid="fixer-working">
          <Spinner label="the Fixer is thinking" />
          <button
            type="button"
            className="btn px-2.5 py-0.5 text-danger"
            onClick={() => cancel.mutate()}
            disabled={cancel.isPending}
            data-testid="fixer-cancel"
          >
            cancel
          </button>
        </div>
      )}
      {isAiCancelled(send.error) ? (
        <p className="mt-2 text-xs text-warn">Cancelled — nothing from that turn was kept.</p>
      ) : (
        <ErrorNote error={send.error} />
      )}

      <div className="mt-2">
        <UsageMeter last={view.lastUsage} total={view.totalUsage} />
      </div>
    </div>
  );
}
