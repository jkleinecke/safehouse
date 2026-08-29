/**
 * The scripted inference box (FR12.13's wire contract, spoken by
 * `src/fixer/mock-llm.ts` over real HTTP + SSE).
 *
 * Four conversations, each a tool call (or four) followed by an answer
 * assembled from what the tools actually returned — which is the whole point: a
 * canned string could not name the live hidden-token count, the contact typed
 * on a phone ten minutes ago, or the in-game date, so the assertions prove the
 * catalog ran against live state rather than against the prompt.
 *
 * The layout turn is the other half of D13: the model emits nothing but bounded
 * integers (rooms as rectangles in grid squares), and the SERVER compiles them
 * into geometry. Nothing here draws a wall.
 */
import type { MockChatRequest, MockTurn } from '../../src/fixer/mock-llm.js';

/** A GM-only name the driver injects so the recap trips the spoiler guard. */
export const recapContext = { gangerName: 'Ratchet — catwalk' };

const RECAP_MD = (ganger: string): string =>
  [
    'Pier 23 was dark, damp and already occupied. The crew came in through the roller door, opened',
    'the main floor a room at a time, and found the crate exactly where the fixer said it would be.',
    '',
    `It went loud anyway. Two of the Halo went down — ${ganger} among them — and the`,
    'lieutenant on the catwalk called the rest off rather than lose the pier over a box.',
    '',
    'The drone left intact. Nobody on either side stopped breathing, so the bonus stands.',
  ].join('\n');

/**
 * Four rectangles in whole grid squares. This is everything the model is
 * allowed to say about a map (FR12.11); walls, doors and fog regions are the
 * server's to compile from it.
 */
const BRANCH_OFFICE = {
  title: 'Renraku branch office',
  rooms: [
    { name: 'Lobby', kind: 'lobby', x: 0, y: 0, w: 14, h: 10 },
    { name: 'Security checkpoint', kind: 'checkpoint', x: 14, y: 0, w: 8, h: 10 },
    { name: 'Server room', kind: 'server_room', x: 22, y: 0, w: 10, h: 12 },
    { name: 'Exec office', kind: 'office', x: 0, y: 12, w: 12, h: 9 },
  ],
  doors: [
    { room: 'Lobby', wall: 'e', offset: 4, width: 2, open: true, to: 'Security checkpoint' },
    { room: 'Security checkpoint', wall: 'e', offset: 4, width: 1, to: 'Server room' },
    { room: 'Server room', wall: 's', offset: 4, width: 1, to: 'Service corridor' },
    { room: 'Exec office', wall: 'n', offset: 3, width: 1, to: 'Lobby' },
  ],
  notes: 'Checkpoint sits between the lobby and everything worth having. Exec office has no second exit.',
};

function json(raw: string | undefined): Record<string, unknown> {
  try {
    return JSON.parse(raw ?? '{}') as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Read the four state payloads back the way a model would skim them. */
function briefLine(results: string[]): string {
  const [codexRaw, contactsRaw, runsRaw, calendarRaw] = results.slice(-4);
  const codex = json(codexRaw)['hits'] as Array<{ title: string; gmOnly: boolean }> | undefined;
  const people = (json(contactsRaw)['characters'] ?? []) as Array<{
    name: string;
    contacts: Array<{ name: string; connection: number; loyalty: number }>;
  }>;
  const runs = (json(runsRaw)['runs'] ?? []) as Array<{ title: string; state: string }>;
  const calendar = json(calendarRaw);
  const events = (calendar['upcoming'] ?? calendar['events'] ?? []) as Array<{ title: string; date: string }>;
  const contact = people.flatMap((p) => p.contacts)[0];
  const pages = (codex ?? []).map((h) => `"${h.title}"${h.gmOnly ? ' (GM-only)' : ''}`).join(', ');
  return [
    `Codex: ${pages || 'nothing on file'}.`,
    contact
      ? `Contacts: ${contact.name} at Connection ${contact.connection}, Loyalty ${contact.loyalty} — the only name the crew actually has.`
      : 'Contacts: nobody on file.',
    runs.length > 0
      ? `Jobs: ${runs.map((r) => `${r.title} (${r.state})`).join('; ')}.`
      : 'Jobs: none.',
    `In-game date ${String(calendar['ingameDate'] ?? 'unknown')}${
      events[0] ? `; next beat "${events[0].title}", ${events[0].date}` : ''
    }.`,
  ].join(' ');
}

export function respond(req: MockChatRequest): MockTurn {
  const toolMessages = req.messages.filter((m) => m.role === 'tool');
  const ask = req.messages
    .filter((m) => m.role === 'user')
    .map((m) => String(m.content ?? ''))
    .join(' ');
  const wantsRecap = /recap/i.test(ask);
  const wantsBrief = /brief me on the state of the job/i.test(ask);
  const wantsLayout = /lay out the/i.test(ask);

  // --- first round: reach for tools ----------------------------------------
  if (toolMessages.length === 0) {
    if (wantsRecap) {
      return {
        toolCalls: [
          {
            name: 'draft_wiki_page',
            arguments: {
              title: 'Static on the Line — session recap',
              kind: 'run',
              playerFacing: true,
              tags: ['recap', 'docklands'],
              contentMd: RECAP_MD(recapContext.gangerName),
            },
          },
        ],
      };
    }
    if (wantsBrief) {
      return {
        toolCalls: [
          { name: 'search_codex', arguments: { query: 'rusted halo pier' } },
          { name: 'list_contacts', arguments: {} },
          { name: 'list_runs', arguments: {} },
          { name: 'get_calendar', arguments: {} },
        ],
      };
    }
    if (wantsLayout) {
      const sceneId = /scene ([0-9a-fA-F-]{36})/.exec(ask)?.[1];
      return {
        toolCalls: [
          {
            name: 'propose_geometry',
            arguments: { ...BRANCH_OFFICE, ...(sceneId ? { sceneId } : {}) },
          },
        ],
      };
    }
    return { toolCalls: [{ name: 'get_scene', arguments: {} }] };
  }

  // --- second round: answer from what came back ----------------------------
  const results = toolMessages.map((m) => String(m.content ?? ''));
  if (wantsRecap) {
    return {
      content:
        'Draft saved. It leans on a GM-only name, so the spoiler guard has flagged it — reveal or cut before you publish.',
    };
  }
  if (wantsBrief) return { content: briefLine(results) };
  if (wantsLayout) {
    const out = json(results[results.length - 1]);
    const counts = (out['counts'] ?? {}) as Record<string, number>;
    return {
      content:
        `Four rooms on the grid — ${counts['walls'] ?? '?'} walls, ${counts['doors'] ?? '?'} doors, ` +
        `${counts['fogRegions'] ?? '?'} named fog regions, all unrevealed. It is a draft: accept it and the Grid ` +
        'draws it, reject it and the scene never knew. The checkpoint is the only way through.',
    };
  }

  let hiddenCount = 0;
  try {
    const parsed = JSON.parse(results[results.length - 1] ?? '{}') as { tokens?: { hidden?: boolean }[] };
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
