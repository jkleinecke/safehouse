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

/**
 * The recap the model writes: **prose only.** Every number in the published
 * recap — the roll tally, who went down, what was revealed, the awards — is
 * added by the server from the session log (`fixer/recap.ts`), so the model is
 * given no opportunity to invent one (D13). The GM-only name is deliberate: it
 * is what the FR12.19 spoiler guard has to catch before this reaches Discord.
 */
const RECAP_PROSE = (ganger: string) => ({
  title: 'Static on the Line — session recap',
  headline: [
    'Pier 23 was dark, damp and already occupied. The crew came in through the roller door, opened the',
    'main floor a room at a time, and found the crate exactly where the fixer said it would be.',
  ].join(' '),
  moments: [
    {
      title: 'The roller door',
      text: 'Three runners, one unlit shed, and a gang that had not been told anyone was coming.',
    },
    {
      title: 'It went loud',
      text: `Two of the Halo stopped getting up — ${ganger} among them — and the aisle filled with fire.`,
    },
    {
      title: 'The voice on the catwalk',
      text: 'The lieutenant called the rest off rather than lose the pier over a box.',
    },
  ],
  whoDidWhat: [
    { who: 'Torque', what: 'Opened the exchange and finished it, and took a burst doing it.' },
    { who: 'Whisper', what: 'Put a spike through the pallet rows and paid the Drain for it.' },
    { who: 'Sparrow', what: 'Crossed four metres of wet concrete without appearing to hurry.' },
  ],
  cliffhanger:
    'The crate is out, the drone is intact, and somebody on that pier now knows exactly who carried it.',
});

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

/**
 * A text-only box, faithfully impolite about it.
 *
 * `fixer/vision-probe.ts` decides whether map vision exists by sending a real
 * image content part and reading the status back: a server whose model has no
 * projector rejects the request outright, and that refusal IS the answer. This
 * mock has no vision, so it refuses — which is what makes the FR12.11
 * capability flag testable at all. (Throwing here is how `mock-llm.ts` renders
 * a non-2xx; nothing about the refusal is faked at the HTTP layer.)
 */
function refuseImages(req: MockChatRequest): void {
  const hasImage = req.messages.some((m) => {
    // On the wire a multimodal message's `content` is an array of parts; the
    // typed `ChatMessage` only ever builds the text form, hence the widening.
    const parts: unknown = m.content;
    return (
      Array.isArray(parts) &&
      parts.some((part) => (part as { type?: string } | null)?.type === 'image_url')
    );
  });
  if (hasImage) {
    throw new Error('this model has no vision projector loaded: image content is not supported');
  }
}

export function respond(req: MockChatRequest): MockTurn {
  refuseImages(req);
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
          { name: 'get_session_log', arguments: { limit: 60 } },
          { name: 'draft_recap', arguments: RECAP_PROSE(recapContext.gangerName) },
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
    // Read back what `draft_recap` returned, so the sentence the GM sees is the
    // server's verdict rather than the model's optimism about its own prose.
    const out = json(results[results.length - 1]);
    const flags = (out['spoilerFlags'] ?? []) as Array<{ name: string }>;
    const facts = (out['facts'] ?? {}) as Record<string, unknown>;
    return {
      content:
        `Draft saved against session ${String(out['sessionId'] ?? '?')} — ` +
        `${String(facts['publicRolls'] ?? '?')} public rolls and ` +
        `${Array.isArray(facts['down']) ? (facts['down'] as unknown[]).length : '?'} down, ` +
        'all counted off the log rather than out of my head. ' +
        (flags.length > 0
          ? `It names GM-only material — ${flags.map((f) => f.name).join(', ')} — so reveal or cut before you publish.`
          : 'Nothing GM-only in it.'),
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
