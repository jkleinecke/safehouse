/**
 * The Fixer chat (FR12.1), on the AI SDK's `useChat`.
 *
 * The panel sends only the GM's new message — text, plus any files — and the
 * server holds the transcript and decides what the model is handed each turn
 * (server `fixer/chat/memory.ts`: a curated context, not the last N lines).
 * The reply streams back as UI message parts, drawn here as they arrive:
 * text, the model's thinking (folded away), a chip per tool call (FR12.17),
 * and — when the Fixer drafts a floor — the plan itself, with the button that
 * builds it. The "draft a floor" tab this replaced is gone: the chat is the
 * one place the GM asks, and it carries what the floor is for.
 *
 * Files: the paperclip, a paste, or a drop onto the panel. Each is uploaded
 * at once (GM-only, `POST /api/attachments`), so pressing send is quick, and
 * travels with the message as a `/files/<id>` link. Text files stay with the
 * chat for its whole life; images are shown to the model on the turn they
 * arrive and the next.
 *
 * The thread survives a reload: its id is kept for the tab, and reopening the
 * panel reloads it from the server exactly as it was drawn.
 */
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls, type FileUIPart, type UIMessage } from 'ai';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet } from '../../../api/client.js';
import Icon from '../../../components/Icon.js';
import { getToken } from '../../../api/session.js';
import { fileUrl } from '../../grid/api.js';
import { fmtLatency, fmtTokens } from '../common.js';
import { SectionTitle } from '../ui.js';
import { aiDisabledFrom, useCancelAi, useFixerModels, useFixerStatus } from './api.js';
import type { AiContext } from './aiContext.js';
import { useFloorEdits } from './floorEdits.js';

// ---------------------------------------------------------------------------
// Message shape
// ---------------------------------------------------------------------------

export interface FixerUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  latencyMs?: number;
}

interface FixerMetadata {
  conversationId?: string;
  usage?: FixerUsage;
  /** How full the model's window was for the turn — the input bar's ring and its panel. */
  context?: ContextStats;
}

/** What the server sends about a turn's context (server `ContextStats`, chat/turn.ts). */
interface ContextStats {
  usedTokens: number;
  windowTokens: number;
  promptBudget?: number;
  breakdown?: { system: number; brief: number; files: number; messages: number; tools: number; images: number };
  steps?: Array<{ inputTokens: number; outputTokens: number; finishReason: string; tools: string[] }>;
  folded: number;
  windowMessages?: number;
  dropped?: number;
  totalMessages?: number;
  charsPerToken?: number;
  model?: string;
}

/** A tool that asked the model on its own — its tokens are not the chat's. */
interface SubCall {
  tool: string;
  promptTokens: number;
  completionTokens: number;
  error?: string;
  latencyMs?: number;
}

interface FixerData {
  /** The live situation snapshot the model was handed (FR12.18). */
  snapshot: { text: string };
  /** A step the turn is taking that is not the answer — folding the brief. */
  status: { text: string };
  [key: string]: unknown;
}

export type FixerUIMessage = UIMessage<FixerMetadata, FixerData>;

type Part = FixerUIMessage['parts'][number];

/** The attachment id behind a `/files/<id>` link. */
function attachmentIdOf(url: string): string | null {
  const m = /\/files\/([0-9a-f-]{8,})/i.exec(url);
  return m ? m[1]! : null;
}

/** What went wrong, in a sentence — the server's envelope when it sent one. */
function errorSentence(err: Error | undefined): string | null {
  if (!err) return null;
  try {
    const body = JSON.parse(err.message) as { error?: { message?: string; code?: string } };
    if (body.error?.code === 'ai_cancelled') return 'Cancelled.';
    if (body.error?.message) return body.error.message;
  } catch {
    // not JSON
  }
  return err.message || 'Something went wrong.';
}

const THREAD_KEY = (campaignId: string) => `safehouse:fixer-thread:${campaignId}`;

function readThread(campaignId: string): string | undefined {
  try {
    return sessionStorage.getItem(THREAD_KEY(campaignId)) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeThread(campaignId: string, id: string | undefined): void {
  try {
    if (id) sessionStorage.setItem(THREAD_KEY(campaignId), id);
    else sessionStorage.removeItem(THREAD_KEY(campaignId));
  } catch {
    // storage blocked: the thread simply does not survive a reload
  }
}

// ---------------------------------------------------------------------------
// Parts
// ---------------------------------------------------------------------------

function ToolChip({ part }: { part: Part }) {
  const p = part as { type: string; toolName?: string; state: string; output?: unknown; errorText?: string };
  const name = p.type === 'dynamic-tool' ? (p.toolName ?? 'tool') : p.type.slice('tool-'.length);
  const failed =
    p.state === 'output-error' ||
    (p.state === 'output-available' && typeof p.output === 'object' && p.output !== null && 'error' in p.output);
  const running = p.state === 'input-streaming' || p.state === 'input-available';
  const tone = failed ? 'border-danger/50 text-danger' : running ? 'border-cyan-dim text-cyan animate-pulse' : 'border-edge text-dim';
  // A floor edit says what it did; the chip's tooltip carries it.
  const summary = (p.output as { summary?: unknown } | undefined)?.summary;
  const detail = failed
    ? (p.errorText ?? String((p.output as { error?: unknown }).error ?? 'failed'))
    : typeof summary === 'string'
      ? summary
      : undefined;
  return (
    <span className={`chip ${tone}`} title={detail ?? name}>
      {running ? '▮' : failed ? '✕' : '✓'} {name}
    </span>
  );
}

interface AskGmInput {
  question: string;
  options: Array<{ label: string; description?: string }>;
}

interface AskGmOutput {
  answer: string;
  chosen?: string;
}

/** The question the latest reply is waiting on, if any. */
function waitingQuestion(messages: readonly FixerUIMessage[]): { toolCallId: string; input: AskGmInput } | null {
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'assistant') return null;
  for (const part of last.parts) {
    const p = part as { type: string; state?: string; toolCallId?: string; input?: unknown };
    if (p.type === 'tool-ask_gm' && p.state === 'input-available' && p.toolCallId) {
      return { toolCallId: p.toolCallId, input: p.input as AskGmInput };
    }
  }
  return null;
}

/**
 * A question from the Fixer (`ask_gm`): its suggested answers, the one it
 * recommends first, and a box for anything else — the GM is never limited to
 * what the model thought of. Answered, it folds down to the question and the
 * answer given, so the thread reads as a conversation.
 */
function QuestionCard({
  input,
  output,
  waiting,
  onAnswer,
}: {
  input: AskGmInput;
  output?: AskGmOutput;
  waiting: boolean;
  onAnswer: (out: AskGmOutput) => void;
}) {
  const [own, setOwn] = useState('');
  if (!input?.question) return null;
  if (output) {
    return (
      <div className="rounded-md border border-edge px-3 py-2" data-testid="fixer-question-answered">
        <p className="text-sm text-dim">{input.question}</p>
        <p className="mt-1 text-sm text-ink">
          <Icon name="subdirectory_arrow_right" size={14} className="mr-1 text-faint" />
          {output.answer}
        </p>
      </div>
    );
  }
  const sendOwn = () => {
    const text = own.trim();
    if (!text) return;
    onAnswer({ answer: text });
  };
  return (
    <div className="rounded-md border border-cyan-dim/60 bg-deck px-3 py-2" data-testid="fixer-question">
      <p className="text-sm text-ink">{input.question}</p>
      <div className="mt-2 flex flex-col gap-1.5">
        {input.options.map((o, i) => (
          <button
            key={i}
            type="button"
            disabled={!waiting}
            onClick={() => onAnswer({ answer: o.label, chosen: o.label })}
            className={
              'rounded-md border px-2.5 py-1.5 text-left text-sm disabled:opacity-50 ' +
              (i === 0 ? 'border-cyan text-cyan hover:bg-raised' : 'border-edge text-ink hover:border-dim')
            }
            data-testid={`fixer-question-option-${i}`}
          >
            <span className="flex items-baseline gap-2">
              <span>{o.label}</span>
              {i === 0 && <span className="mono-label text-faint">recommended</span>}
            </span>
            {o.description && <span className="block text-xs text-dim">{o.description}</span>}
          </button>
        ))}
        {/* Always a way to say something the model did not offer. */}
        <div className="flex items-center gap-1.5 rounded-md border border-edge px-2.5 py-1 focus-within:border-cyan">
          <input
            className="w-full bg-transparent text-sm text-ink placeholder:text-faint focus:outline-none"
            placeholder="or type your own answer…"
            aria-label="Your own answer"
            value={own}
            disabled={!waiting}
            onChange={(e) => setOwn(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault();
                sendOwn();
              }
            }}
          />
          <button
            type="button"
            className="shrink-0 text-cyan hover:text-ink disabled:text-faint"
            disabled={!waiting || !own.trim()}
            onClick={sendOwn}
            title="Answer"
            aria-label="Answer"
          >
            <Icon name="arrow_circle_up" size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}

function FileChip({ part }: { part: FileUIPart }) {
  const id = attachmentIdOf(part.url);
  if (part.mediaType.startsWith('image/') && id) {
    return (
      <img
        src={fileUrl(id)}
        alt={part.filename ?? 'attached image'}
        className="max-h-40 max-w-full rounded border border-edge object-contain"
      />
    );
  }
  return <span className="chip text-dim">📄 {part.filename ?? part.mediaType}</span>;
}

function MessageView({
  message,
  streaming,
  onAnswer,
}: {
  message: FixerUIMessage;
  streaming: boolean;
  /** Answer a question on this message (`ask_gm`); absent while nothing can be sent. */
  onAnswer?: (toolCallId: string, out: AskGmOutput) => void;
}) {
  const mine = message.role === 'user';
  const chips: Part[] = [];
  const body: React.ReactNode[] = [];
  message.parts.forEach((part, i) => {
    if (part.type === 'text') {
      if (part.text.trim()) {
        body.push(
          <p key={i} className="whitespace-pre-wrap text-sm text-ink">
            {part.text}
          </p>,
        );
      }
    } else if (part.type === 'reasoning') {
      if (part.text.trim()) {
        body.push(
          <details key={i} className="text-xs text-faint">
            <summary className="mono-label cursor-pointer">thinking</summary>
            <p className="mt-1 whitespace-pre-wrap">{part.text}</p>
          </details>,
        );
      }
    } else if (part.type === 'file') {
      body.push(<FileChip key={i} part={part} />);
    } else if (part.type.startsWith('tool-') || part.type === 'dynamic-tool') {
      // A question is asked, not chipped.
      if (part.type === 'tool-ask_gm') {
        const q = part as { toolCallId: string; state: string; input?: unknown; output?: unknown };
        if (q.state === 'input-available' || q.state === 'output-available') {
          body.push(
            <QuestionCard
              key={i}
              input={q.input as AskGmInput}
              {...(q.state === 'output-available' ? { output: q.output as AskGmOutput } : {})}
              waiting={q.state === 'input-available' && Boolean(onAnswer)}
              onAnswer={(out) => onAnswer?.(q.toolCallId, out)}
            />,
          );
        }
        return;
      }
      chips.push(part);
    }
  });

  if (mine) {
    return (
      <div className="ml-auto max-w-[85%] space-y-1.5 rounded-md bg-raised px-3 py-2">
        <div className="mono-label text-faint">gm</div>
        {body}
      </div>
    );
  }
  return (
    <div className="max-w-[95%]">
      <div className="mono-label text-magenta">fixer</div>
      {chips.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {chips.map((c, i) => (
            <ToolChip key={i} part={c} />
          ))}
        </div>
      )}
      <div className="mt-1 space-y-1.5">
        {body}
        {streaming && <span className="animate-pulse text-cyan">▮</span>}
      </div>
    </div>
  );
}

/** What each effort is called on the bar. */
const EFFORT_LABEL: Record<string, string> = {
  default: 'Default',
  off: 'Off',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
};

/** The bar's picks — effort, model — kept per browser and campaign. */
const PICK_KEY = (kind: 'effort' | 'model', campaignId: string) => `safehouse:fixer-${kind}:${campaignId}`;

function readPick(kind: 'effort' | 'model', campaignId: string): string | undefined {
  try {
    return localStorage.getItem(PICK_KEY(kind, campaignId)) ?? undefined;
  } catch {
    return undefined;
  }
}

function writePick(kind: 'effort' | 'model', campaignId: string, value: string): void {
  try {
    localStorage.setItem(PICK_KEY(kind, campaignId), value);
  } catch {
    // storage blocked: the pick lasts until the page reloads
  }
}

/** A setting on the input bar — its value, and a menu opening upward to change it. */
function BarMenu({
  label,
  heading,
  title,
  options,
  current,
  onPick,
  testId,
  className,
}: {
  label: string;
  heading: string;
  title: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  current: string;
  onPick: (value: string) => void;
  testId: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const away = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
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
    <div ref={boxRef} className={`relative min-w-0 ${className ?? ''}`}>
      <button
        type="button"
        className="flex max-w-full items-center gap-0.5 hover:text-ink"
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        data-testid={testId}
      >
        <span className="truncate">{label}</span>
        <Icon name="keyboard_arrow_down" size={14} className="shrink-0" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute bottom-full right-0 z-30 mb-1 max-h-72 min-w-32 max-w-80 overflow-y-auto rounded-lg border border-edge bg-panel py-1 shadow-lg"
          data-testid={`${testId}-menu`}
        >
          <div className="mono-label px-3 py-1 text-faint">{heading}</div>
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="menuitemradio"
              aria-checked={o.value === current}
              className="flex w-full items-center gap-2 px-3 py-1 text-left text-sm text-ink hover:bg-raised"
              title={o.label}
              onClick={() => {
                onPick(o.value);
                setOpen(false);
              }}
            >
              <span className="w-4 shrink-0 text-cyan">{o.value === current ? <Icon name="check" size={14} /> : null}</span>
              <span className="truncate">{o.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const effortOption = (v: string) => ({ value: v, label: EFFORT_LABEL[v] ?? v.charAt(0).toUpperCase() + v.slice(1) });

/**
 * What the effort menu offers: the levels the model's server says its
 * template takes, when it says (an empty list is "none — only on or off"),
 * else the API's own.
 */
function effortOptions(levels: readonly string[] | undefined) {
  const shown = levels ?? ['low', 'medium', 'high'];
  return ['default', 'off', ...shown.filter((l) => l !== 'off' && l !== 'default')].map(effortOption);
}

const n = (v: number | undefined) => (v === undefined ? '—' : v.toLocaleString('en-US'));

function Row({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-dim">{label}</span>
      {note && <span className="text-faint">{note}</span>}
      <span className={`ml-auto tabular-nums ${tone ?? 'text-ink'}`}>{value}</span>
    </div>
  );
}

/**
 * How full the model's window was on the last turn, as a ring — and, on
 * hover, everything behind that number.
 *
 * The ring is the estimate the server built the turn to; the panel breaks it
 * down by layer, sets it against what the model itself counted on each step,
 * and lists any tool that asked the model on its own (a drafted floor is a
 * whole separate call, with its own prompt, which never shows in the chat's
 * context at all — the one a "cut off" error is usually about).
 */
function ContextRing({
  fill,
  last,
  total,
  subCalls,
}: {
  fill?: ContextStats;
  last?: FixerUsage;
  total: FixerUsage;
  subCalls: SubCall[];
}) {
  const [open, setOpen] = useState(false);
  const share = fill && fill.windowTokens > 0 ? Math.min(1, fill.usedTokens / fill.windowTokens) : 0;
  const r = 7;
  const circumference = 2 * Math.PI * r;
  const tone = share >= 0.7 ? 'text-warn' : 'text-cyan';
  const b = fill?.breakdown;
  const steps = fill?.steps ?? [];
  const firstCounted = steps[0]?.inputTokens;

  return (
    <span
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <button
        type="button"
        className={`block ${tone}`}
        aria-label={fill ? `Context ${Math.round(share * 100)}% full — details` : 'Context details'}
        aria-expanded={open}
        data-testid="fixer-context-ring"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden className="-rotate-90">
          <circle cx="9" cy="9" r={r} fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
          <circle
            cx="9"
            cy="9"
            r={r}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray={`${share * circumference} ${circumference}`}
          />
        </svg>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Context details"
          data-testid="fixer-context-panel"
          className="absolute bottom-full right-0 z-30 mb-2 w-80 space-y-2 rounded-lg border border-edge bg-panel p-3 text-xs shadow-lg"
        >
          {!fill ? (
            <p className="text-dim">No turn yet. Send a message and this shows how much of the model&apos;s window it used.</p>
          ) : (
            <>
              <div className="flex items-baseline gap-2">
                <span className="mono-label text-cyan">context</span>
                <span className="truncate text-faint">{fill.model}</span>
                <span className={`ml-auto tabular-nums ${tone}`}>{Math.round(share * 100)}%</span>
              </div>

              {/* The window, the budget line, and where this turn filled to. */}
              <div className="relative h-2 overflow-hidden rounded bg-raised" aria-hidden>
                <div className={`h-full ${share >= 0.7 ? 'bg-warn' : 'bg-cyan'}`} style={{ width: `${share * 100}%` }} />
                {fill.promptBudget !== undefined && (
                  <div
                    className="absolute top-0 h-full w-px bg-ink"
                    style={{ left: `${(fill.promptBudget / fill.windowTokens) * 100}%` }}
                  />
                )}
              </div>
              <div className="space-y-0.5">
                <Row label="Window" value={n(fill.windowTokens)} />
                {fill.promptBudget !== undefined && (
                  <Row
                    label="For the prompt"
                    value={n(fill.promptBudget)}
                    note={`${n(fill.windowTokens - fill.promptBudget)} kept for the answer`}
                  />
                )}
              </div>

              {b && (
                <div className="space-y-0.5 border-t border-edge pt-2">
                  <div className="mono-label text-faint">this turn, estimated</div>
                  <Row label="System & situation" value={n(b.system)} />
                  {b.brief > 0 && <Row label="Session brief" value={n(b.brief)} />}
                  {b.files > 0 && <Row label="Attached files" value={n(b.files)} />}
                  <Row
                    label="Conversation"
                    note={fill.windowMessages !== undefined ? `${fill.windowMessages} messages` : undefined}
                    value={n(b.messages)}
                  />
                  <Row label="Tool definitions" value={n(b.tools)} />
                  {b.images > 0 && <Row label="Images" value={n(b.images)} />}
                  <Row label="Total" value={n(fill.usedTokens)} tone={tone} />
                </div>
              )}

              {steps.length > 0 && (
                <div className="space-y-0.5 border-t border-edge pt-2">
                  <div className="mono-label text-faint">counted by the model</div>
                  {steps.map((st, i) => (
                    <Row
                      key={i}
                      label={`Step ${i + 1}`}
                      note={st.tools.length > 0 ? st.tools.join(', ') : st.finishReason === 'length' ? 'cut off' : undefined}
                      value={`${n(st.inputTokens)} in · ${n(st.outputTokens)} out`}
                      tone={st.finishReason === 'length' ? 'text-danger' : undefined}
                    />
                  ))}
                  {firstCounted !== undefined && firstCounted > 0 && (
                    <p className="text-faint">
                      estimate was {Math.round((fill.usedTokens / firstCounted) * 100)}% of the first step&apos;s count
                    </p>
                  )}
                </div>
              )}

              {subCalls.length > 0 && (
                <div className="space-y-0.5 border-t border-edge pt-2">
                  <div className="mono-label text-faint">tools that asked the model themselves</div>
                  {subCalls.map((c, i) => (
                    <div key={i}>
                      <Row
                        label={c.tool}
                        value={`${n(c.promptTokens)} in · ${n(c.completionTokens)} out`}
                        tone={c.error ? 'text-danger' : undefined}
                      />
                      {c.error && <p className="text-danger">{c.error}</p>}
                    </div>
                  ))}
                  <p className="text-faint">A separate request, with its own prompt — not part of the chat&apos;s context.</p>
                </div>
              )}

              <div className="space-y-0.5 border-t border-edge pt-2">
                <Row
                  label="Folded into the brief"
                  value={`${n(fill.folded)} of ${n(fill.totalMessages)}`}
                  note="messages"
                />
                {(fill.dropped ?? 0) > 0 && (
                  <Row label="Left out this turn" value={n(fill.dropped)} note="didn't fit" tone="text-warn" />
                )}
                {fill.charsPerToken !== undefined && (
                  <Row label="Characters per token" value={fill.charsPerToken.toFixed(2)} note="measured" />
                )}
                <Row label="Last turn" value={`${fmtTokens(last?.totalTokens)} tok · ${fmtLatency(last?.latencyMs)}`} />
                <Row label="Thread" value={`${fmtTokens(total.totalTokens)} tok`} />
              </div>
            </>
          )}
        </div>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

interface Pending {
  key: string;
  name: string;
  mediaType: string;
  part?: FileUIPart;
  error?: string;
}

/** The GM's upload, as a handout the Fixer can read — never shown to players. */
async function uploadForChat(campaignId: string, file: File): Promise<FileUIPart> {
  const form = new FormData();
  // Fields before the file: the server reads them as the file part arrives.
  form.append('kind', 'handout');
  form.append('visibility', 'gm');
  form.append('file', file, file.name);
  const token = getToken();
  const res = await fetch(`/api/attachments?campaign=${encodeURIComponent(campaignId)}`, {
    method: 'POST',
    body: form,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`upload failed (${res.status})`);
  const { attachment } = (await res.json()) as { attachment: { id: string; mime: string } };
  return {
    type: 'file',
    url: `/files/${attachment.id}`,
    mediaType: file.type || attachment.mime || 'application/octet-stream',
    filename: file.name,
  };
}

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

export interface FixerChatProps {
  campaignId: string;
  /** Unused since the fast slot went away; kept so callers need not change. */
  sessionLive?: boolean;
  /** Compact layout for the dock; the full page gives it more room. */
  dense?: boolean;
  /** Grow to the container's height (the drawer) instead of capping the transcript. */
  fill?: boolean;
  /** What the GM is looking at — stamped on every message (aiContext.ts). */
  context?: AiContext;
  /**
   * A chip's text, handed in from the dock: it lands in the box, and goes
   * at once when `send` is set. `nonce` changes per click so the same chip
   * can be used twice.
   */
  seed?: { text: string; send: boolean; nonce: number } | null;
}

export default function FixerChat({ campaignId, dense, fill, context, seed }: FixerChatProps) {
  const status = useFixerStatus();
  const cancel = useCancelAi(campaignId);
  const [conversationId, setConversationId] = useState<string | undefined>(() => readThread(campaignId));
  // The bar's effort pick, kept per browser; absent means the saved setting.
  const [effortPick, setEffortPick] = useState<string | undefined>(() => readPick('effort', campaignId));
  const effort = effortPick ?? status.data?.effort ?? 'default';
  // The model: the GM's pick, while the server still serves it; else the saved one.
  const served = useFixerModels(campaignId, Boolean(status.data?.enabled));
  const [modelPick, setModelPick] = useState<string | undefined>(() => readPick('model', campaignId));
  const savedModel = status.data?.models?.primary;
  const modelChoice =
    modelPick && (served.data === undefined || served.data.models.some((m) => m.id === modelPick)) ? modelPick : undefined;
  const model = modelChoice ?? savedModel;
  const effortSupport = status.data?.effortSupport ?? 'none';
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<Pending[]>([]);
  const [dragging, setDragging] = useState(false);
  const scroller = useRef<HTMLDivElement | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const box = useRef<HTMLTextAreaElement | null>(null);

  // The box grows with what is typed, so the whole message is in view; past
  // a dozen lines or so it scrolls instead of pushing the chat off screen.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  // The transport reads these at send time, so it never needs rebuilding.
  const live = useRef({ campaignId, conversationId, context, effortPick, modelChoice });
  live.current = { campaignId, conversationId, context, effortPick, modelChoice };

  const transport = useMemo(
    () =>
      new DefaultChatTransport<FixerUIMessage>({
        api: '/api/fixer/chat/stream',
        headers: (): Record<string, string> => {
          const token = getToken();
          return token ? { Authorization: `Bearer ${token}` } : {};
        },
        // Only what is new goes: the server holds the transcript. That is the
        // GM's message — or, when the reply stopped at a question, just the
        // answer, which the server fills into the question it has stored.
        prepareSendMessagesRequest: ({ messages }) => {
          const last = messages[messages.length - 1];
          const common = {
            campaignId: live.current.campaignId,
            ...(live.current.conversationId ? { conversationId: live.current.conversationId } : {}),
            ...(live.current.context ? { context: live.current.context } : {}),
            ...(live.current.effortPick ? { effort: live.current.effortPick } : {}),
            ...(live.current.modelChoice ? { model: live.current.modelChoice } : {}),
          };
          if (last?.role === 'assistant') {
            const answered = [...last.parts].reverse().find(
              (p) => p.type === 'tool-ask_gm' && (p as { state?: string }).state === 'output-available',
            ) as { toolCallId: string; output: AskGmOutput } | undefined;
            if (answered) {
              return {
                body: {
                  ...common,
                  answer: {
                    toolCallId: answered.toolCallId,
                    answer: answered.output.answer,
                    ...(answered.output.chosen ? { chosen: answered.output.chosen } : {}),
                  },
                },
              };
            }
          }
          return { body: { ...common, message: last } };
        },
      }),
    [],
  );

  const chat = useChat<FixerUIMessage>({
    transport,
    // An answered question carries the same reply on, without a send button.
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    onData: (part) => {
      if (part.type === 'data-snapshot') setSnapshot((part.data as { text: string }).text);
      if (part.type === 'data-status') setWorking((part.data as { text: string }).text);
    },
    onFinish: ({ message }) => {
      setWorking(null);
      const id = message.metadata?.conversationId;
      if (id) {
        setConversationId(id);
        writeThread(campaignId, id);
      }
    },
    onError: () => setWorking(null),
  });
  const { messages, sendMessage, status: chatStatus, setMessages, stop, error, addToolOutput } = chat;
  const busy = chatStatus === 'submitted' || chatStatus === 'streaming';
  const question = busy ? null : waitingQuestion(messages);
  const answer = (toolCallId: string, out: AskGmOutput) => {
    void addToolOutput({ tool: 'ask_gm', toolCallId, output: out } as never);
  };

  // A thread kept for this tab comes back as it was drawn — and what came
  // back is history: its floor edits were painted (or undone) the first time.
  const reopened = useRef(false);
  const historic = useRef(new Set<string>());
  useEffect(() => {
    if (reopened.current || !conversationId || messages.length > 0) return;
    reopened.current = true;
    apiGet<{ messages: FixerUIMessage[] }>(`/api/fixer/chat/${conversationId}`)
      .then((thread) => {
        for (const m of thread.messages) historic.current.add(m.id);
        setMessages(thread.messages);
      })
      .catch(() => {
        // Gone (another campaign, deleted): start fresh.
        setConversationId(undefined);
        writeThread(campaignId, undefined);
      });
  }, [conversationId, messages.length, setMessages, campaignId]);

  // The Fixer's floor edits go onto the map as they arrive.
  useFloorEdits(messages, historic.current, busy);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const disabled = aiDisabledFrom(status.data, status.error);

  const attach = (files: FileList | File[] | null) => {
    if (!files) return;
    for (const file of Array.from(files)) {
      const key = `${file.name}-${file.size}-${Date.now()}-${Math.random()}`;
      setPending((p) => [...p, { key, name: file.name, mediaType: file.type }]);
      uploadForChat(campaignId, file)
        .then((part) => setPending((p) => p.map((x) => (x.key === key ? { ...x, part } : x))))
        .catch((err: unknown) =>
          setPending((p) => p.map((x) => (x.key === key ? { ...x, error: err instanceof Error ? err.message : 'upload failed' } : x))),
        );
    }
  };

  const uploading = pending.some((p) => !p.part && !p.error);

  const submit = (text?: unknown) => {
    const message = (typeof text === 'string' ? text : draft).trim();
    const files = pending.flatMap((p) => (p.part ? [p.part] : []));
    if ((!message && files.length === 0) || disabled || busy || uploading) return;
    // A question is waiting: what the GM typed is their answer to it.
    if (question && message) {
      setDraft('');
      answer(question.toolCallId, { answer: message });
      return;
    }
    setDraft('');
    setPending([]);
    setWorking(null);
    void sendMessage({ text: message || 'Here are some files.', ...(files.length > 0 ? { files } : {}) });
  };

  // A chip from the dock: into the box, or straight out the door.
  const seedNonce = seed?.nonce;
  useEffect(() => {
    if (!seed || seedNonce === undefined) return;
    if (seed.send) submit(seed.text);
    else setDraft(seed.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedNonce]);

  const usage = useMemo(() => {
    const turns = messages.flatMap((m) => (m.role === 'assistant' && m.metadata?.usage ? [m.metadata.usage] : []));
    const total = turns.reduce<FixerUsage>((acc, u) => ({ totalTokens: (acc.totalTokens ?? 0) + (u.totalTokens ?? 0) }), {
      totalTokens: 0,
    });
    const fills = messages.flatMap((m) => (m.role === 'assistant' && m.metadata?.context ? [m.metadata.context] : []));
    // Tools on the latest answer that asked the model on their own.
    const lastAnswer = [...messages].reverse().find((m) => m.role === 'assistant');
    const subCalls: SubCall[] = (lastAnswer?.parts ?? []).flatMap((part) => {
      if (!part.type.startsWith('tool-')) return [];
      const out = (part as { output?: unknown }).output as
        | { usage?: { promptTokens?: number; completionTokens?: number; latencyMs?: number }; error?: string }
        | undefined;
      if (!out?.usage) return [];
      return [
        {
          tool: part.type.slice('tool-'.length),
          promptTokens: out.usage.promptTokens ?? 0,
          completionTokens: out.usage.completionTokens ?? 0,
          ...(out.error ? { error: out.error } : {}),
          ...(out.usage.latencyMs !== undefined ? { latencyMs: out.usage.latencyMs } : {}),
        },
      ];
    });
    return { last: turns[turns.length - 1], total, fill: fills[fills.length - 1], subCalls };
  }, [messages]);

  if (disabled) {
    return (
      <div className="panel p-5">
        <SectionTitle>The Fixer is offline</SectionTitle>
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
          <p className="mono-label mt-2 text-faint">configured model: {status.data.models.primary}</p>
        )}
      </div>
    );
  }

  const lastId = messages[messages.length - 1]?.id;
  const errorLine = errorSentence(error);

  return (
    <div
      className={`panel flex min-h-0 flex-1 flex-col p-4 ${dragging ? 'ring-2 ring-cyan' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        if (e.dataTransfer.files.length === 0) return;
        e.preventDefault();
        setDragging(false);
        attach(e.dataTransfer.files);
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <SectionTitle>The Fixer</SectionTitle>
        <button
          className="btn ml-auto px-2 py-1"
          onClick={() => {
            if (busy) return;
            setMessages([]);
            setSnapshot(null);
            setPending([]);
            setConversationId(undefined);
            writeThread(campaignId, undefined);
          }}
          disabled={busy}
          title="New thread — the Fixer forgets this one's brief and files"
          aria-label="New thread"
          data-testid="fixer-new-thread"
        >
          <Icon name="add_comment" size={18} />
        </button>
      </div>

      {snapshot && (
        <div className="mt-2 rounded-md border border-cyan-dim/50 bg-deck px-3 py-2" title="Rebuilt every turn">
          <span className="mono-label text-cyan">situation</span>
          <p className="mt-0.5 whitespace-pre-wrap text-xs text-dim">{snapshot}</p>
        </div>
      )}

      <div
        ref={scroller}
        className={`mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1 ${fill ? '' : dense ? 'max-h-80' : 'max-h-[60vh]'}`}
      >
        {messages.map((m) => (
          <MessageView
            key={m.id}
            message={m}
            streaming={busy && m.id === lastId && m.role === 'assistant'}
            {...(question ? { onAnswer: answer } : {})}
          />
        ))}
        {errorLine && (
          <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
            {errorLine}
          </div>
        )}
      </div>

      {/*
        The input, the way a chat app draws one: a single box with the send —
        or, while the Fixer works, the stop — inside it; files waiting above
        it; and a slim bar beneath: attach on the left, and on the right which
        model answers, how hard it thinks, and how full its window is.
      */}
      <div className="mt-3 rounded-xl border border-edge bg-deck focus-within:border-cyan">
        {pending.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-2.5 pt-2" data-testid="fixer-attachments">
            {pending.map((p) => (
              <span
                key={p.key}
                className={`chip ${p.error ? 'border-danger/50 text-danger' : p.part ? 'text-dim' : 'animate-pulse text-cyan'}`}
                title={p.error ?? p.mediaType}
              >
                <Icon name={p.mediaType.startsWith('image/') ? 'image' : 'description'} size={14} />
                {p.name}
                <button
                  type="button"
                  className="ml-1 text-faint hover:text-danger"
                  aria-label={`Remove ${p.name}`}
                  title={`Remove ${p.name}`}
                  onClick={() => setPending((all) => all.filter((x) => x.key !== p.key))}
                >
                  <Icon name="close" size={14} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2 px-3 py-2">
          <textarea
            ref={box}
            className="max-h-72 min-h-[1.5rem] w-full resize-none overflow-y-auto bg-transparent text-sm text-ink placeholder:text-faint focus:outline-none"
            rows={dense ? 1 : 2}
            value={draft}
            placeholder={
              working ??
              (busy
                ? 'the Fixer is thinking…'
                : question
                  ? 'Answer the question above — or type your own answer here'
                  : 'Ask the Fixer — or have it lay out this floor')
            }
            aria-label="Message the Fixer"
            onChange={(e) => setDraft(e.target.value)}
            onPaste={(e) => {
              if (e.clipboardData.files.length > 0) {
                e.preventDefault();
                attach(e.clipboardData.files);
              }
            }}
            onKeyDown={(e) => {
              // Enter sends; Shift+Enter is a new line — as every chat does.
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
          />
          {busy ? (
            <button
              type="button"
              className="shrink-0 text-ink hover:text-danger"
              onClick={() => {
                void stop();
                cancel.mutate();
              }}
              disabled={cancel.isPending}
              data-testid="fixer-cancel"
              title="Stop the Fixer"
              aria-label="Stop"
            >
              <Icon name="stop_circle" size={20} />
            </button>
          ) : (
            <button
              type="button"
              className="shrink-0 text-cyan hover:text-ink disabled:text-faint"
              onClick={submit}
              disabled={uploading || (!draft.trim() && pending.every((p) => !p.part))}
              data-testid="fixer-send"
              title={uploading ? 'Waiting for the upload' : 'Send (Enter)'}
              aria-label="Send"
            >
              <Icon name={uploading ? 'hourglass_top' : 'arrow_circle_up'} size={20} />
            </button>
          )}
        </div>
      </div>
      <div className="mt-1.5 flex items-center gap-3 px-1 text-xs text-dim">
        <input
          ref={fileInput}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            attach(e.target.files);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          className="text-dim hover:text-ink"
          title="Attach files — text or images; you can also paste or drop them"
          aria-label="Attach files"
          onClick={() => fileInput.current?.click()}
          data-testid="fixer-attach"
        >
          <Icon name="add" size={18} />
        </button>
        {working && busy && <span className="mono-label truncate text-faint">{working}</span>}
        <span className="ml-auto flex items-center gap-3">
          {model &&
            ((served.data?.models.length ?? 0) > 1 ? (
              <BarMenu
                className="max-w-48 text-ink"
                label={model}
                heading="Model"
                title="The model answering"
                options={served.data!.models.map((m) => ({ value: m.id, label: m.id }))}
                current={model}
                onPick={(m) => {
                  setModelPick(m);
                  writePick('model', campaignId, m);
                }}
                testId="fixer-model"
              />
            ) : (
              <span className="max-w-40 truncate text-ink" title="The model answering">
                {model}
              </span>
            ))}
          {effortSupport !== 'none' && (
            <BarMenu
              label={EFFORT_LABEL[effort] ?? effort}
              heading="Thinking"
              title="Thinking effort"
              options={effortOptions(served.data?.models.find((m) => m.id === model)?.efforts)}
              current={effort}
              onPick={(e) => {
                setEffortPick(e);
                writePick('effort', campaignId, e);
              }}
              testId="fixer-effort"
            />
          )}
          <ContextRing fill={usage.fill} last={usage.last} total={usage.total} subCalls={usage.subCalls} />
        </span>
      </div>
    </div>
  );
}
