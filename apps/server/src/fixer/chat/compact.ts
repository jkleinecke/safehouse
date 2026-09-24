/**
 * Folding: the oldest half of the unfolded transcript goes into the session
 * brief, so the chat can run all evening inside a local model's window.
 *
 * The brief is rewritten, not appended to — a fact the GM changed their mind
 * about must not survive as two contradicting bullets. It is structured
 * (Decisions / Facts / Files / Open) because a model reading its own notes
 * back finds a heading faster than a paragraph, and ids are kept verbatim
 * because the tools need them.
 *
 * The fold runs on the fast slot with thinking off: it is bookkeeping, and a
 * reasoning model left to think spends its whole output budget deciding how
 * to summarise before it writes a word.
 */
import { generateText, type LanguageModel, type UIMessage } from 'ai';
import { asScript, foldPoint, type ConversationMemory } from './memory.js';

const BRIEF_WORDS = 350;
const FOLD_TIMEOUT = { firstChunkMs: 180_000, chunkMs: 90_000 } as const;

export const FOLD_INSTRUCTIONS = [
  "You keep the running brief of a game master's chat with their Shadowrun copilot, the Fixer.",
  'You are given the brief so far and a stretch of the chat it does not yet cover. Rewrite the brief so it covers both.',
  '',
  'Keep: decisions the GM made; facts established about the campaign, scenes, floors, NPCs and runners — with any [ids] exactly as written; what each attached file is and what mattered in it; questions or requests still open.',
  'Drop: greetings, thanks, restated rules text, and anything a later message superseded — the brief says what is true now, not how it got there.',
  '',
  `Write terse bullet points under these headings, leaving out any that are empty: Decisions, Facts, Files, Open. At most ${BRIEF_WORDS} words. Output only the brief.`,
].join('\n');

export interface FoldResult {
  memory: ConversationMemory;
  /** How many messages were folded this time; 0 when there was nothing to fold. */
  folded: number;
}

/**
 * Fold once, if there is enough unfolded transcript to be worth it. A model
 * that fails or answers with nothing leaves the memory as it was — the next
 * turn tries again, and in the meantime `buildContext` keeps the request
 * inside the window by leaving the oldest turns out of it.
 */
export async function fold(
  model: LanguageModel,
  messages: readonly UIMessage[],
  memory: ConversationMemory,
  opts: { abortSignal?: AbortSignal; providerOptions?: Record<string, Record<string, unknown>> } = {},
): Promise<FoldResult> {
  const end = foldPoint(messages, memory);
  if (end === null) return { memory, folded: 0 };
  const stretch = messages.slice(memory.foldedCount, end);
  const prompt = [
    'BRIEF SO FAR:',
    memory.brief.trim() || '(empty — this is the first fold)',
    '',
    'CHAT TO FOLD IN:',
    asScript(stretch),
  ].join('\n');
  try {
    const result = await generateText({
      model,
      instructions: FOLD_INSTRUCTIONS,
      prompt,
      temperature: 0.2,
      timeout: FOLD_TIMEOUT,
      ...(opts.abortSignal ? { abortSignal: opts.abortSignal } : {}),
      ...(opts.providerOptions ? { providerOptions: opts.providerOptions as never } : {}),
    });
    const brief = result.text.trim();
    if (brief.length === 0) return { memory, folded: 0 };
    return { memory: { ...memory, brief, foldedCount: end }, folded: end - memory.foldedCount };
  } catch {
    return { memory, folded: 0 };
  }
}
