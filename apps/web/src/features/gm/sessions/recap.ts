/**
 * Recap helpers (FR6.3) — pure, no DOM. The session log is already in the
 * client's live buffer, so the recap editor can offer the headline events
 * (big rolls, downed combatants, karma awards, reveals) as a starting
 * skeleton the GM edits before publishing. With the app offline to players
 * between sessions, the recap is their only window into the campaign.
 */
import type { WsEvent } from '@safehouse/contracts';

export type HeadlineKind = 'roll' | 'damage' | 'ledger' | 'scene' | 'reveal' | 'clock';

export interface Headline {
  kind: HeadlineKind;
  text: string;
  /** ISO timestamp from the event. */
  ts: string;
  /** Source event id — lets the editor drop one line and keep the rest. */
  eventId: number;
}

/** Hits at or above this count are worth a line in the recap. */
export const BIG_ROLL_HITS = 5;

function rec(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}
function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function actorName(payload: Record<string, unknown>): string {
  return (
    str(payload['actorName']) ??
    str(payload['characterName']) ??
    str(payload['name']) ??
    str(rec(payload['actor'])['name']) ??
    'someone'
  );
}

/** One event → a recap line, or null when it is not headline material. */
export function headlineOf(event: WsEvent): Headline | null {
  const payload = rec(event.payload);
  const base = { ts: event.ts, eventId: event.id };

  switch (event.type) {
    case 'roll.created': {
      const result = rec(payload['result']);
      const hits = num(result['hits']) ?? num(payload['hits']);
      const glitch = str(result['glitch']) ?? str(payload['glitch']) ?? 'none';
      if (hits === undefined) return null;
      const label = str(payload['label']) ?? str(rec(payload['request'])['label']);
      if (glitch === 'critical') {
        return { ...base, kind: 'roll', text: `${actorName(payload)} critically glitched${label ? ` on ${label}` : ''}.` };
      }
      if (glitch === 'glitch') {
        return { ...base, kind: 'roll', text: `${actorName(payload)} glitched${label ? ` on ${label}` : ''}.` };
      }
      if (hits >= BIG_ROLL_HITS) {
        return {
          ...base,
          kind: 'roll',
          text: `${actorName(payload)} rolled ${hits} hits${label ? ` on ${label}` : ''}.`,
        };
      }
      return null;
    }
    case 'combatant.damaged': {
      const name = str(payload['combatantName']) ?? str(payload['name']) ?? 'a combatant';
      const boxes = num(payload['boxes']);
      const monitor = str(payload['monitor']) ?? 'physical';
      const down = payload['down'] === true;
      if (down) return { ...base, kind: 'damage', text: `${name} went down.` };
      if (boxes === undefined || boxes <= 0) return null;
      return { ...base, kind: 'damage', text: `${name} took ${boxes} ${monitor} box${boxes === 1 ? '' : 'es'}.` };
    }
    case 'ledger.changed': {
      const delta = num(payload['delta']);
      const state = str(payload['state']);
      if (delta === undefined || delta === 0) return null;
      if (state && state !== 'approved') return null;
      const who = str(payload['characterName']) ?? str(payload['characterId']) ?? 'the team';
      const currency = str(payload['currency']) ?? 'karma';
      const reason = str(payload['reason']);
      const sign = delta > 0 ? '+' : '';
      return {
        ...base,
        kind: 'ledger',
        text: `${who} ${sign}${delta} ${currency}${reason ? ` — ${reason}` : ''}.`,
      };
    }
    case 'scene.activated': {
      const name = str(payload['name']) ?? str(rec(payload['scene'])['name']);
      if (!name) return null;
      return { ...base, kind: 'scene', text: `Scene: ${name}.` };
    }
    case 'handout.revealed':
    case 'wiki.revealed': {
      const title = str(payload['title']) ?? str(payload['name']) ?? 'something';
      return { ...base, kind: 'reveal', text: `Revealed to the table: ${title}.` };
    }
    case 'clock.advanced': {
      const date = str(payload['ingameDate']) ?? str(payload['date']);
      if (!date) return null;
      return { ...base, kind: 'clock', text: `In-game date advanced to ${date}.` };
    }
    default:
      return null;
  }
}

/** Headline events in chronological order, most recent `limit` kept. */
export function headlineEvents(events: readonly WsEvent[], limit = 12): Headline[] {
  const out: Headline[] = [];
  for (const event of events) {
    const line = headlineOf(event);
    if (line) out.push(line);
  }
  out.sort((a, b) => a.eventId - b.eventId);
  return limit > 0 && out.length > limit ? out.slice(out.length - limit) : out;
}

export interface RecapSkeletonInput {
  /** Real-world session date. */
  date: string;
  /** Sixth World date (FR5.7). */
  ingameDate?: string;
  attendance: readonly string[];
  headlines: readonly Headline[];
}

/** A Markdown starting point the GM edits — never published unedited. */
export function recapSkeleton(input: RecapSkeletonInput): string {
  const lines: string[] = [];
  lines.push(`# Session — ${input.date}`);
  if (input.ingameDate) lines.push(`*In-game: ${input.ingameDate}*`);
  if (input.attendance.length > 0) lines.push(`*Present: ${input.attendance.join(', ')}*`);
  lines.push('');
  lines.push('## Headlines');
  if (input.headlines.length === 0) {
    lines.push('- (nothing in the log yet)');
  } else {
    for (const h of input.headlines) lines.push(`- ${h.text}`);
  }
  lines.push('');
  lines.push('## What happened');
  lines.push('');
  lines.push('## Where it left off');
  lines.push('');
  return lines.join('\n');
}

/** Attendance toggle used by the roster checkboxes. */
export function toggleAttendee(list: readonly string[], name: string): string[] {
  return list.includes(name) ? list.filter((n) => n !== name) : [...list, name];
}
