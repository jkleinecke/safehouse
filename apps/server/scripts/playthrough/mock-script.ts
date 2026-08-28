/**
 * The scripted inference box (FR12.13's wire contract, spoken by
 * `src/fixer/mock-llm.ts` over real HTTP + SSE).
 *
 * Two conversations, each a tool call followed by an answer assembled from what
 * the tool actually returned — which is the whole point: a canned string could
 * not name the live hidden-token count, so the assertion proves the catalog ran
 * against live state rather than against the prompt.
 */
import type { MockChatRequest, MockTurn } from '../../src/fixer/mock-llm.js';

/** A GM-only name the driver injects so the recap trips the spoiler guard. */
export const recapContext = { gangerName: 'Ratchet — catwalk' };
export function respond(req: MockChatRequest): MockTurn {
  const toolMessages = req.messages.filter((m) => m.role === 'tool');
  const ask = req.messages.filter((m) => m.role === 'user').map((m) => String(m.content ?? '')).join(' ');
  const wantsRecap = /recap/i.test(ask);

  if (toolMessages.length === 0) {
    return wantsRecap
      ? {
          toolCalls: [
            {
              name: 'draft_wiki_page',
              arguments: {
                title: 'Static on the Line — session recap',
                kind: 'run',
                playerFacing: true,
                tags: ['recap', 'docklands'],
                contentMd: [
                  'Pier 23 was dark, damp and already occupied. The crew came in through the roller door, opened',
                  'the main floor a room at a time, and found the crate exactly where the fixer said it would be.',
                  '',
                  `It went loud anyway. Two of the Halo went down — ${recapContext.gangerName} among them — and the`,
                  'lieutenant on the catwalk called the rest off rather than lose the pier over a box.',
                  '',
                  'The drone left intact. Nobody on either side stopped breathing, so the bonus stands.',
                ].join('\n'),
              },
            },
          ],
        }
      : { toolCalls: [{ name: 'get_scene', arguments: {} }] };
  }

  const payload = String(toolMessages[toolMessages.length - 1]?.content ?? '');
  if (wantsRecap) {
    return {
      content:
        'Draft saved. It leans on a GM-only name, so the spoiler guard has flagged it — reveal or cut before you publish.',
    };
  }
  let hiddenCount = 0;
  try {
    const parsed = JSON.parse(payload) as { tokens?: { hidden?: boolean }[] };
    hiddenCount = (parsed.tokens ?? []).filter((t) => t.hidden).length;
  } catch {
    hiddenCount = -1;
  }
  return {
    content:
      `Four bodies and a lieutenant, ${hiddenCount} still hidden on your side of the fog. The one on the catwalk ` +
      'is the one to worry about: she has the only working keycard and the best angle on the whole floor. ' +
      'The rest are cover-to-cover. Nothing here is rated above blooded.',
  };
}

