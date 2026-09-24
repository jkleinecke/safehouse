/**
 * What the Fixer is handed each turn — a curated context, not the last N
 * messages.
 *
 * A local model reads a few tens of thousands of tokens at most, and a GM's
 * prep session runs for hours. "Replay the last 40 messages" dropped the
 * first hour on the floor the moment it scrolled out, and spent most of what
 * it kept on tool output nobody would read twice. So the context is built in
 * layers, highest priority first, against a token budget:
 *
 *   1. instructions — the system prompt, the live snapshot, where the GM is;
 *   2. the SESSION BRIEF — everything older, folded into a short structured
 *      summary (decisions, facts with their ids, files, open threads);
 *   3. ATTACHED FILES — small text files whole; big ones by name, searched
 *      with `read_attachment` when the model needs them;
 *   4. the recent turns, verbatim — the unfolded tail of the transcript;
 *   5. old tool calls collapse to one-line receipts. Tool output is the
 *      biggest thing in a transcript and almost never needed twice; the last
 *      couple of turns keep theirs whole, because "and the other one?" is
 *      about what was just read.
 *
 * When the tail grows past the budget's soft line, its oldest half is folded
 * into the brief (compact.ts). Nothing is ever deleted: the whole transcript
 * stays in the database, and `recall_conversation` reads it back on demand.
 *
 * Pure, apart from the image loader it is handed — so the arithmetic can be
 * tested without a model or a disk.
 */
import { convertToModelMessages, type ModelMessage, type ToolSet, type UIMessage } from 'ai';
import type { ChatMessage } from '../llm.js';

// ---------------------------------------------------------------------------
// The stored memory
// ---------------------------------------------------------------------------

export interface AttachedFile {
  id: string;
  name: string;
  mediaType: string;
  kind: 'text' | 'image' | 'other';
  /** A text file's content (capped), read once when it was attached. */
  text?: string;
  /** Estimated size, for deciding whether it rides along whole. */
  tokens?: number;
}

export interface ConversationMemory {
  version: 1;
  /** Everything folded so far, as a structured brief. Empty until the first fold. */
  brief: string;
  /** How many transcript messages, from the start, the brief now covers. */
  foldedCount: number;
  /** Files the GM attached, keyed by attachment id. */
  files: Record<string, AttachedFile>;
  /** Characters per token, calibrated against the box's own counts. */
  charsPerToken: number;
}

export const EMPTY_MEMORY: ConversationMemory = {
  version: 1,
  brief: '',
  foldedCount: 0,
  files: {},
  charsPerToken: 3.5,
};

/** Whatever is in the column, as a memory — a new or older row reads as empty. */
export function readMemory(raw: unknown): ConversationMemory {
  if (typeof raw !== 'object' || raw === null) return { ...EMPTY_MEMORY, files: {} };
  const r = raw as Partial<ConversationMemory>;
  return {
    version: 1,
    brief: typeof r.brief === 'string' ? r.brief : '',
    foldedCount: typeof r.foldedCount === 'number' && r.foldedCount >= 0 ? Math.floor(r.foldedCount) : 0,
    files: typeof r.files === 'object' && r.files !== null ? r.files : {},
    charsPerToken:
      typeof r.charsPerToken === 'number' && r.charsPerToken > 1 && r.charsPerToken < 8 ? r.charsPerToken : 3.5,
  };
}

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

/** Share of the window kept free for the answer. */
const OUTPUT_SHARE = 0.2;
const OUTPUT_MAX = 8_192;
/** A text file this small rides along whole every turn. */
export const INLINE_FILE_TOKENS = 1_500;
/** Turns (counted by GM messages) that keep their full tool output. */
const FULL_TOOL_TURNS = 2;
/** Turns that re-send their images; older ones are named, not shown. */
const IMAGE_TURNS = 2;
/** What an image costs, roughly, on a local vision model. */
const IMAGE_TOKENS = 1_200;
/** Fold when the prompt passes this share of the budget… */
export const SOFT_LINE = 0.7;
/** …and fold BEFORE answering when it passes this one. */
export const HARD_LINE = 0.95;
const RECEIPT_CHARS = 240;

export interface Budget {
  /** The model's whole window. */
  window: number;
  /** What the prompt may use: the window, less room for the answer. */
  prompt: number;
}

export function budgetFor(windowTokens: number): Budget {
  const reserve = Math.min(OUTPUT_MAX, Math.floor(windowTokens * OUTPUT_SHARE));
  return { window: windowTokens, prompt: windowTokens - reserve };
}

export function estimateTokens(chars: number, charsPerToken: number): number {
  return Math.ceil(chars / charsPerToken);
}

/**
 * Move the chars-per-token ratio toward what the box actually counted, a
 * little at a time — one odd turn (a big JSON result, a page of names)
 * should not swing every later estimate.
 */
export function calibrate(memory: ConversationMemory, sentChars: number, countedTokens: number | undefined): ConversationMemory {
  if (!countedTokens || countedTokens < 200 || sentChars < 500) return memory;
  const observed = sentChars / countedTokens;
  if (!(observed > 1 && observed < 8)) return memory;
  return { ...memory, charsPerToken: memory.charsPerToken * 0.7 + observed * 0.3 };
}

// ---------------------------------------------------------------------------
// Transcript helpers
// ---------------------------------------------------------------------------

type Part = UIMessage['parts'][number];

function isToolPart(part: Part): part is Part & { toolCallId: string; state: string } {
  return part.type.startsWith('tool-') || part.type === 'dynamic-tool';
}

function toolNameOf(part: Part): string {
  if (part.type === 'dynamic-tool') return (part as { toolName: string }).toolName;
  return part.type.slice('tool-'.length);
}

/** One line for a tool call the model no longer needs in full. */
export function receipt(part: Part): string {
  const p = part as { input?: unknown; output?: unknown; errorText?: string; state: string };
  const args = p.input === undefined ? '' : JSON.stringify(p.input).slice(0, 80);
  const outcome =
    p.state === 'output-error'
      ? `error: ${p.errorText ?? 'failed'}`
      : p.output === undefined
        ? 'no result'
        : JSON.stringify(p.output).slice(0, RECEIPT_CHARS);
  return `[earlier: ${toolNameOf(part)}(${args}) → ${outcome}${outcome.length >= RECEIPT_CHARS ? '…' : ''}]`;
}

/** Plain text of a message, tool calls as receipts — for folding and for recall. */
export function messageText(message: UIMessage): string {
  const out: string[] = [];
  for (const part of message.parts) {
    if (part.type === 'text') out.push(part.text);
    else if (part.type === 'file') out.push(`[file: ${part.filename ?? part.mediaType}]`);
    else if (isToolPart(part)) out.push(receipt(part));
  }
  return out.join('\n').trim();
}

/** The transcript as a script — "GM: …", "Fixer: …" — for the summariser. */
export function asScript(messages: readonly UIMessage[]): string {
  return messages
    .map((m) => `${m.role === 'user' ? 'GM' : m.role === 'assistant' ? 'Fixer' : 'System'}: ${messageText(m)}`)
    .filter((line) => !/^\w+: $/.test(line))
    .join('\n\n');
}

/**
 * An older conversation, stored as Chat Completions messages before the chat
 * moved onto the SDK, read as UI messages. Only the words survive: its tool
 * calls were answered against tools that may have changed shape since, and
 * a half-typed replay of them would only confuse the model.
 */
export function fromLegacy(raw: readonly unknown[]): UIMessage[] {
  const out: UIMessage[] = [];
  raw.forEach((m, i) => {
    const msg = m as Partial<ChatMessage> & { parts?: unknown };
    if (Array.isArray(msg.parts) && (msg.role === 'user' || msg.role === 'assistant' || msg.role === 'system')) {
      out.push(m as UIMessage); // already a UI message
      return;
    }
    if ((msg.role === 'user' || msg.role === 'assistant') && typeof msg.content === 'string' && msg.content.trim()) {
      out.push({ id: `legacy-${i}`, role: msg.role, parts: [{ type: 'text', text: msg.content }] });
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
// Building one turn's context
// ---------------------------------------------------------------------------

export interface ContextInput {
  /** The whole transcript, the new GM message last. */
  messages: UIMessage[];
  memory: ConversationMemory;
  budget: Budget;
  /** System prompt, snapshot, where the GM is — already joined. */
  instructions: string;
  /** The tool set, so tool parts convert the way the tools say they should. */
  tools: ToolSet;
  /** Characters the tool definitions add to every request. */
  toolChars: number;
  /** Whether this model reads images at all. */
  vision: boolean;
  /** The bytes of an attached image, as a data URL, or null when it is gone. */
  loadImage: (attachmentId: string) => Promise<string | null>;
}

export interface BuiltContext {
  instructions: string;
  messages: ModelMessage[];
  /** The estimate this turn was built to — compared with the box's count afterwards. */
  estimatedTokens: number;
  /** Characters actually sent, for calibration. */
  sentChars: number;
  /** Over the soft line: fold after this turn. */
  shouldFold: boolean;
  /** Messages dropped unfolded because even folding could not make room. */
  dropped: number;
  /** Messages sent word for word this turn — the unfolded tail, less any dropped. */
  windowMessages: number;
  /** The estimate, by layer, in tokens — what the GM's context panel shows. */
  breakdown: ContextBreakdown;
}

export interface ContextBreakdown {
  /** System prompt, live snapshot, where the GM is. */
  system: number;
  brief: number;
  files: number;
  /** The verbatim tail, tool calls and receipts included. */
  messages: number;
  /** The tool definitions every request carries. */
  tools: number;
  images: number;
}

/** The attachment id behind a `/files/<id>` URL, or null for anything else. */
export function attachmentIdOf(url: string): string | null {
  const m = /\/files\/([0-9a-f-]{8,})/i.exec(url);
  return m ? m[1]! : null;
}

function briefBlock(memory: ConversationMemory): string {
  if (!memory.brief.trim()) return '';
  return [
    'SESSION BRIEF (what this chat has settled so far — older turns are folded into it; trust it over your guesses, and call recall_conversation for exact earlier wording):',
    memory.brief.trim(),
  ].join('\n');
}

function filesBlock(memory: ConversationMemory): string {
  const files = Object.values(memory.files);
  if (files.length === 0) return '';
  const lines = ['ATTACHED FILES (the GM gave you these; they stay attached for the whole chat):'];
  for (const f of files) {
    if (f.kind === 'text' && f.text && (f.tokens ?? Infinity) <= INLINE_FILE_TOKENS) {
      lines.push(`--- ${f.name} ---`, f.text, `--- end of ${f.name} ---`);
    } else if (f.kind === 'text') {
      lines.push(`- ${f.name}: ${f.tokens ?? '?'} tokens — too long to carry; search it with read_attachment.`);
    } else if (f.kind === 'image') {
      lines.push(`- ${f.name}: an image. It is shown to you on the turn it was attached and the next one.`);
    } else {
      lines.push(`- ${f.name} (${f.mediaType}): a file you cannot read directly.`);
    }
  }
  return lines.join('\n');
}

/** Index of each message's GM turn, counted back from the end (the newest is 0). */
function turnAges(messages: readonly UIMessage[]): number[] {
  const ages = new Array<number>(messages.length).fill(0);
  let age = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    ages[i] = age;
    if (messages[i]!.role === 'user') age += 1;
  }
  return ages;
}

/**
 * The window of the transcript the model sees verbatim, prepared for the
 * wire: old tool calls as receipts, images inside their window as data,
 * text files as a pointer to where their content lives.
 */
async function prepareWindow(
  window: readonly UIMessage[],
  input: ContextInput,
): Promise<{ messages: UIMessage[]; images: number }> {
  const ages = turnAges(window);
  let images = 0;
  const out: UIMessage[] = [];
  for (let i = 0; i < window.length; i += 1) {
    const message = window[i]!;
    const age = ages[i]!;
    const parts: Part[] = [];
    for (const part of message.parts) {
      if (part.type === 'reasoning' || part.type === 'step-start' || part.type.startsWith('data-')) continue;
      if (isToolPart(part)) {
        // Recent tool calls stay whole; older ones become a line of text.
        if (age < FULL_TOOL_TURNS) parts.push(part);
        else parts.push({ type: 'text', text: receipt(part) });
        continue;
      }
      if (part.type === 'file') {
        const id = attachmentIdOf(part.url);
        const name = part.filename ?? part.mediaType;
        if (part.mediaType.startsWith('image/') && id && input.vision && age < IMAGE_TURNS) {
          const data = await input.loadImage(id);
          if (data) {
            parts.push({ ...part, url: data });
            images += 1;
            continue;
          }
        }
        const note = part.mediaType.startsWith('image/')
          ? input.vision
            ? `[image attached earlier: ${name}]`
            : `[image attached: ${name} — this model cannot see images; ask the GM to describe it]`
          : `[attached file: ${name} — see ATTACHED FILES]`;
        parts.push({ type: 'text', text: note });
        continue;
      }
      parts.push(part);
    }
    if (parts.length > 0) out.push({ ...message, parts });
  }
  return { messages: out, images };
}

/**
 * One turn's context, built to the budget.
 *
 * The unfolded tail goes in whole when it fits. When it does not — the
 * pre-turn fold should have made room, but a single huge paste can defeat
 * it — the oldest messages of the tail are left out of THIS request only.
 * They stay in the transcript, and `dropped` says how many, so the caller
 * can fold them properly next time.
 */
export async function buildContext(input: ContextInput): Promise<BuiltContext> {
  const cpt = input.memory.charsPerToken;
  const brief = briefBlock(input.memory);
  const files = filesBlock(input.memory);
  const instructions = [input.instructions, brief, files].filter((s) => s.length > 0).join('\n\n');
  const fixedChars = instructions.length + input.toolChars;

  let tail = input.messages.slice(Math.min(input.memory.foldedCount, Math.max(0, input.messages.length - 1)));
  let dropped = 0;
  for (;;) {
    const { messages, images } = await prepareWindow(tail, input);
    const model = await convertToModelMessages(messages, { tools: input.tools, ignoreIncompleteToolCalls: true });
    const messageChars = JSON.stringify(model).length;
    const sentChars = fixedChars + messageChars;
    const estimatedTokens = estimateTokens(sentChars, cpt) + images * IMAGE_TOKENS;
    // Always keep at least the new message; never cut a lone tail.
    if (estimatedTokens <= input.budget.prompt || tail.length <= 1) {
      return {
        instructions,
        messages: model,
        estimatedTokens,
        sentChars,
        shouldFold: estimatedTokens > input.budget.prompt * SOFT_LINE,
        dropped,
        windowMessages: tail.length,
        breakdown: {
          system: estimateTokens(input.instructions.length, cpt),
          brief: estimateTokens(brief.length, cpt),
          files: estimateTokens(files.length, cpt),
          messages: estimateTokens(messageChars, cpt),
          tools: estimateTokens(input.toolChars, cpt),
          images: images * IMAGE_TOKENS,
        },
      };
    }
    // Drop from the front, a GM turn at a time, so a tool call and its answer
    // are never split across the cut.
    let cut = 1;
    while (cut < tail.length - 1 && tail[cut]!.role !== 'user') cut += 1;
    tail = tail.slice(cut);
    dropped += cut;
  }
}

/**
 * Where to fold to: the oldest half of the unfolded tail, ending just
 * before a GM message so a turn is never split. Null when the tail is too
 * short to be worth folding.
 */
export function foldPoint(messages: readonly UIMessage[], memory: ConversationMemory): number | null {
  const start = memory.foldedCount;
  const tail = messages.length - start;
  if (tail < 6) return null;
  let end = start + Math.floor(tail / 2);
  while (end < messages.length - 2 && messages[end]!.role !== 'user') end += 1;
  return end > start ? end : null;
}
