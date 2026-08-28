/**
 * View-model parsing for the session log (DESIGN.md FR2.9, §11).
 * The server owns the payload shapes; the log renders whatever arrives, so
 * every parser here is tolerant — missing fields degrade, they never throw.
 *
 * `roll.created` carries the persisted roll record: flat faces/hits/glitch with
 * the authoritative `request` (recomputed pool + provenance) nested inside, and
 * `actorName` for the log line. `{ roll: … }` and `{ request, result }` wrappers
 * are still accepted so an older stored event still renders.
 */
import type { ProvenanceEntry, Visibility, WsEvent } from '@safehouse/contracts';

// ---------------------------------------------------------------------------
// Tolerant field readers
// ---------------------------------------------------------------------------

export function rec(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function numArray(v: unknown): number[] {
  return Array.isArray(v) ? v.filter((n): n is number => typeof n === 'number') : [];
}

// ---------------------------------------------------------------------------
// Roll view
// ---------------------------------------------------------------------------

export type GlitchState = 'none' | 'glitch' | 'critical';

export interface RollView {
  eventId: number;
  ts: string;
  visibility: Visibility;
  /** Display name for whoever rolled. */
  actorName: string;
  actor: { characterId?: string; combatantId?: string; gm?: boolean };
  kind: string;
  /** Short label of what was rolled ("Perception", "Defense", "Free roll"). */
  label?: string;
  pool: number;
  breakdown: ProvenanceEntry[];
  limit?: { kind: string; value: number };
  edge?: string | null;
  /** meta.burnEdge — the loud one (FR2.3). */
  burnedEdge: boolean;
  /** meta.buyHits — no-roll bought hits (FR2.4). */
  bought: boolean;
  faces: number[];
  exploded: number[];
  hits: number;
  ones: number;
  glitch: GlitchState;
  limitedHits: number;
  meta: Record<string, unknown>;
}

function actorNameOf(
  actor: { characterId?: string; combatantId?: string; gm?: boolean },
  meta: Record<string, unknown>,
  record: Record<string, unknown>,
): string {
  return (
    str(record['actorName']) ??
    str(meta['actorName']) ??
    str(meta['name']) ??
    (actor.gm ? 'GM' : actor.characterId ? 'Runner' : actor.combatantId ? 'Combatant' : 'Table')
  );
}

/** Parse a `roll.created` event into a renderable roll, or null. */
export function parseRoll(event: WsEvent): RollView | null {
  if (event.type !== 'roll.created') return null;
  const outer = rec(event.payload);
  const record = 'roll' in outer ? rec(outer['roll']) : outer;
  const req = 'request' in record ? rec(record['request']) : record;
  const res = 'result' in record ? rec(record['result']) : record;

  const faces = numArray(res['faces']);
  const hits = num(res['hits']);
  if (hits === undefined && faces.length === 0 && num(rec(req['meta'])['boughtHits']) === undefined) {
    return null; // not a roll we can draw
  }

  const actorRaw = rec(record['actor'] ?? req['actor']);
  const actor = {
    characterId: str(actorRaw['characterId']),
    combatantId: str(actorRaw['combatantId']),
    gm: actorRaw['gm'] === true,
  };
  const meta = rec(req['meta'] ?? record['meta']);
  const limitRaw = rec(record['limit'] ?? req['limit']);
  const limitKind = str(limitRaw['kind']);
  const limitValue = num(limitRaw['value']);
  const breakdown = Array.isArray(req['breakdown'])
    ? (req['breakdown'] as unknown[])
        .map(rec)
        .map((b) => ({ label: str(b['label']) ?? '?', value: num(b['value']) ?? 0, source: str(b['source']) }))
    : [];
  const glitchRaw = str(record['glitch'] ?? res['glitch']);
  const glitch: GlitchState =
    glitchRaw === 'glitch' || glitchRaw === 'critical' ? glitchRaw : 'none';
  const effectiveHits = hits ?? num(meta['boughtHits']) ?? 0;

  return {
    eventId: event.id,
    ts: event.ts,
    visibility: event.visibility,
    actorName: actorNameOf(actor, meta, record),
    actor,
    kind: str(record['kind'] ?? req['kind']) ?? 'simple',
    label: str(meta['label']) ?? str(meta['title']) ?? str(meta['rack']),
    pool: num(req['pool']) ?? faces.length,
    breakdown,
    limit: limitKind && limitValue !== undefined ? { kind: limitKind, value: limitValue } : undefined,
    edge: str(record['edgeAction'] ?? req['edge']) ?? null,
    burnedEdge: meta['burnEdge'] === true,
    bought: meta['buyHits'] === true,
    faces,
    exploded: numArray(res['exploded']),
    hits: effectiveHits,
    ones: num(res['ones']) ?? faces.filter((f) => f === 1).length,
    glitch,
    limitedHits: num(res['limitedHits'] ?? record['limitedHits']) ?? effectiveHits,
    meta,
  };
}

// ---------------------------------------------------------------------------
// The interleaved session log (FR2.9)
// ---------------------------------------------------------------------------

export type LogItem =
  | { kind: 'roll'; id: number; ts: string; visibility: Visibility; roll: RollView }
  | {
      kind: 'damage';
      id: number;
      ts: string;
      visibility: Visibility;
      name: string;
      boxes?: number;
      monitor?: string;
      woundModifier?: number;
      note?: string;
    }
  | { kind: 'talk'; id: number; ts: string; visibility: Visibility; author: string; text: string }
  | { kind: 'marker'; id: number; ts: string; visibility: Visibility; text: string }
  | { kind: 'reveal'; id: number; ts: string; visibility: Visibility; text: string }
  | {
      kind: 'ledger';
      id: number;
      ts: string;
      visibility: Visibility;
      text: string;
      currency?: string;
      delta?: number;
    };

/** Map one persisted event to a log line; null → not a log-worthy event. */
export function toLogItem(event: WsEvent): LogItem | null {
  const base = { id: event.id, ts: event.ts, visibility: event.visibility };
  const payload = rec(event.payload);

  switch (event.type) {
    case 'roll.created': {
      const roll = parseRoll(event);
      return roll ? { kind: 'roll', ...base, roll } : null;
    }
    case 'log.posted': {
      const text = str(payload['text']) ?? str(payload['message']) ?? '';
      const postKind = str(payload['kind']);
      if (postKind === 'marker' || postKind === 'scene') {
        return { kind: 'marker', ...base, text: text || 'Scene marker' };
      }
      return {
        kind: 'talk',
        ...base,
        author: str(payload['authorName']) ?? str(payload['author']) ?? str(payload['userName']) ?? 'Table',
        text,
      };
    }
    case 'combatant.damaged': {
      const monitors = rec(payload['monitors']);
      const wm = rec(payload['woundModifier']);
      return {
        kind: 'damage',
        ...base,
        name: str(payload['name']) ?? str(payload['combatantName']) ?? 'Combatant',
        boxes: num(payload['boxes']),
        monitor: str(payload['monitor']) ?? str(payload['track']),
        woundModifier: num(payload['woundModifier']) ?? num(wm['after']) ?? num(rec(monitors)['woundModifier']),
        note: str(payload['note']),
      };
    }
    case 'scene.activated':
      return { kind: 'marker', ...base, text: `Scene: ${str(payload['name']) ?? str(payload['sceneName']) ?? 'changed'}` };
    case 'clock.advanced':
      return { kind: 'marker', ...base, text: `Clock → ${str(payload['ingameDate']) ?? str(payload['date']) ?? '…'}` };
    case 'handout.revealed':
      return { kind: 'reveal', ...base, text: str(payload['title']) ?? str(payload['name']) ?? 'Handout revealed' };
    case 'wiki.revealed':
      return { kind: 'reveal', ...base, text: str(payload['title']) ?? 'Codex page revealed' };
    case 'fog.updated': {
      if (payload['announce'] !== true) return null;
      const region = str(payload['regionName']) ?? str(payload['name']);
      return { kind: 'reveal', ...base, text: region ? `Area revealed: ${region}` : 'Area revealed' };
    }
    case 'ledger.changed': {
      const entry = 'entry' in payload ? rec(payload['entry']) : payload;
      const currency = str(entry['currency']);
      const delta = num(entry['delta']);
      const reason = str(entry['reason']) ?? '';
      if (currency === undefined && delta === undefined) return null;
      const sign = delta !== undefined && delta >= 0 ? '+' : '';
      return {
        kind: 'ledger',
        ...base,
        currency,
        delta,
        text: `${sign}${delta ?? '?'} ${currency ?? ''}${reason ? ` — ${reason}` : ''}`.trim(),
      };
    }
    default:
      return null; // token.*, encounter.updated, drawings … are not log lines
  }
}

/** Project the event buffer into log lines, oldest → newest. */
export function toLogItems(events: WsEvent[]): LogItem[] {
  const out: LogItem[] = [];
  for (const e of events) {
    const item = toLogItem(e);
    if (item) out.push(item);
  }
  return out;
}

/** Human label for an edge action chip. */
export function edgeLabel(edge: string): string {
  switch (edge) {
    case 'push_pre':
      return 'Push the Limit';
    case 'push_post':
      return 'Push the Limit (post)';
    case 'second_chance':
      return 'Second Chance';
    default:
      return edge.replace(/_/g, ' ');
  }
}
