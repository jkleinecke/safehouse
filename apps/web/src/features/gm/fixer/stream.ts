/**
 * Pure reducer over the live store's `fixer.*` ephemeral chunk buffer
 * (FR12.1): streamed deltas → assistant messages, tool-call chips, situation
 * snapshot, and a tokens/latency usage tally (FR12.16).
 *
 * INTEGRATION: payload shapes assumed from DESIGN.md M12 — align with the
 * server fixer plugin's ephemeral emissions:
 *   fixer.delta    { conversationId?, delta | text | content }
 *   fixer.tool     { name | tool, status?: 'start'|'end'|'error', detail? }
 *   fixer.snapshot { text | summary }   (FR12.18 situation snapshot)
 *   fixer.done     { usage?: { promptTokens?, completionTokens?, totalTokens?, latencyMs? } }
 *   fixer.error    { code?, message? }
 */
import type { FixerChunk } from '../../../live/store.js';

export interface ToolChip {
  name: string;
  status: 'running' | 'done' | 'error';
  detail?: string;
}

export interface FixerUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  latencyMs?: number;
}

export interface FixerAssistantMessage {
  role: 'assistant';
  text: string;
  /** Chips for tool calls made while producing this message. */
  chips: ToolChip[];
  done: boolean;
  usage?: FixerUsage;
  /** ts of the first chunk of this message (for chronological merge). */
  ts: number;
}

export interface FixerView {
  messages: FixerAssistantMessage[];
  /** True while a message is mid-stream. */
  streaming: boolean;
  /** Latest situation snapshot text, when the server sent one (FR12.18). */
  snapshot?: string;
  error?: string;
  /** Usage of the most recent completed turn. */
  lastUsage?: FixerUsage;
  /** Summed usage across all completed turns in the buffer. */
  totalUsage: FixerUsage;
}

function rec(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function parseUsage(payload: Record<string, unknown>): FixerUsage | undefined {
  const u = rec(payload['usage']);
  const usage: FixerUsage = {};
  const prompt = num(u['promptTokens']) ?? num(u['prompt_tokens']);
  const completion = num(u['completionTokens']) ?? num(u['completion_tokens']);
  const total = num(u['totalTokens']) ?? num(u['total_tokens']);
  const latency =
    num(u['latencyMs']) ?? num(u['latency_ms']) ?? num(payload['latencyMs']) ?? num(payload['latency_ms']);
  if (prompt !== undefined) usage.promptTokens = prompt;
  if (completion !== undefined) usage.completionTokens = completion;
  if (total !== undefined) usage.totalTokens = total;
  else if (prompt !== undefined || completion !== undefined)
    usage.totalTokens = (prompt ?? 0) + (completion ?? 0);
  if (latency !== undefined) usage.latencyMs = latency;
  return Object.keys(usage).length > 0 ? usage : undefined;
}

function addUsage(into: FixerUsage, u: FixerUsage): void {
  if (u.promptTokens !== undefined) into.promptTokens = (into.promptTokens ?? 0) + u.promptTokens;
  if (u.completionTokens !== undefined)
    into.completionTokens = (into.completionTokens ?? 0) + u.completionTokens;
  if (u.totalTokens !== undefined) into.totalTokens = (into.totalTokens ?? 0) + u.totalTokens;
  if (u.latencyMs !== undefined) into.latencyMs = u.latencyMs; // last, not summed
}

/** Fold the store's fixer chunk buffer into a renderable view. */
export function reduceFixerStream(chunks: readonly FixerChunk[]): FixerView {
  const messages: FixerAssistantMessage[] = [];
  let current: FixerAssistantMessage | null = null;
  let snapshot: string | undefined;
  let error: string | undefined;
  let lastUsage: FixerUsage | undefined;
  const totalUsage: FixerUsage = {};

  // Plain function (not a closure over `current`) so control-flow narrowing
  // stays sound: every mutation of `current` happens in this scope.
  const open = (prev: FixerAssistantMessage | null, ts: number): FixerAssistantMessage => {
    if (prev && !prev.done) return prev;
    const msg: FixerAssistantMessage = { role: 'assistant', text: '', chips: [], done: false, ts };
    messages.push(msg);
    return msg;
  };

  for (const chunk of chunks) {
    const payload = rec(chunk.payload);
    switch (chunk.type) {
      case 'fixer.delta': {
        const delta = str(payload['delta']) ?? str(payload['text']) ?? str(payload['content']) ?? '';
        const msg = open(current, chunk.ts);
        current = msg;
        msg.text += delta;
        break;
      }
      case 'fixer.tool':
      case 'fixer.tool_call': {
        const msg = open(current, chunk.ts);
        current = msg;
        const name = str(payload['name']) ?? str(payload['tool']) ?? 'tool';
        const status = str(payload['status']);
        const detail = str(payload['detail']) ?? str(payload['summary']);
        const mapped: ToolChip['status'] =
          status === 'error' ? 'error' : status === 'start' || status === 'running' ? 'running' : 'done';
        const prior = msg.chips.find((c) => c.name === name && c.status === 'running');
        if (prior && mapped !== 'running') {
          prior.status = mapped;
          if (detail) prior.detail = detail;
        } else {
          const chip: ToolChip = { name, status: mapped };
          if (detail) chip.detail = detail;
          msg.chips.push(chip);
        }
        break;
      }
      case 'fixer.snapshot': {
        snapshot = str(payload['text']) ?? str(payload['summary']) ?? snapshot;
        break;
      }
      case 'fixer.done': {
        const msg = open(current, chunk.ts);
        msg.done = true;
        const usage = parseUsage(payload);
        if (usage) {
          msg.usage = usage;
          lastUsage = usage;
          addUsage(totalUsage, usage);
        }
        current = null;
        break;
      }
      case 'fixer.error': {
        error = str(payload['message']) ?? str(payload['code']) ?? 'Fixer error';
        if (current) {
          current.done = true;
          current = null;
        }
        break;
      }
      default:
        break; // unknown fixer.* — ignore, forward-compatible
    }
  }

  return {
    messages,
    streaming: current !== null,
    ...(snapshot !== undefined ? { snapshot } : {}),
    ...(error !== undefined ? { error } : {}),
    ...(lastUsage !== undefined ? { lastUsage } : {}),
    totalUsage,
  };
}
