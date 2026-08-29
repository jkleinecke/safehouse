/**
 * `magic.updated` frames (§11) — the refinement half of LIVE-1.
 *
 * Two jobs, both pure:
 *
 *  - **Reconcile.** `applyMagicEvent` folds one frame into an ALREADY-HYDRATED
 *    view. It never builds one: a service count that arrived over the socket is
 *    a correction to a number the tab read over REST, not a substitute for
 *    reading it. Anything the frame says about another character is ignored
 *    rather than merged.
 *  - **Narrate.** `magicLogText` turns the same payloads into the lines the
 *    table reads, so "spend a service" leaves a trace with a number in it
 *    instead of a silent decrement someone will argue about later.
 *
 * Ops that move a pool (a focus, a spirit taking a spell or being dismissed)
 * report `rederive`, because only the server can say what the pools are now.
 */
import type { WsEvent } from '@safehouse/contracts';
import { replaceSpirit } from './lib.js';
import { normalizeFocus, normalizeSpirit, type MagicView } from './types.js';

function rec(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
}

/** Ops whose effect on the pools only the server can compute (foci, sustaining). */
const REDERIVE_OPS = new Set([
  'focus.added',
  'focus.updated',
  'focus.removed',
  'spirit.sustaining',
  'spirit.dismissed',
]);

export interface MagicEventEffect {
  view: MagicView;
  /** True when the pools moved and the authoritative view must be re-read. */
  rederive: boolean;
  changed: boolean;
}

export function applyMagicEvent(view: MagicView, event: WsEvent): MagicEventEffect {
  const unchanged: MagicEventEffect = { view, rederive: false, changed: false };
  if (event.type !== 'magic.updated') return unchanged;
  const payload = rec(event.payload);
  const op = typeof payload['op'] === 'string' ? payload['op'] : '';
  const rederive = REDERIVE_OPS.has(op);

  if (op.startsWith('spirit.')) {
    const spirit = normalizeSpirit(payload['spirit']);
    if (!spirit || spirit.characterId !== view.characterId) return unchanged;
    return {
      view: { ...view, spirits: replaceSpirit(view.spirits, spirit) },
      rederive,
      changed: true,
    };
  }

  if (op === 'focus.removed') {
    const focusId = typeof payload['focusId'] === 'string' ? payload['focusId'] : null;
    if (!focusId || !view.foci.some((f) => f.id === focusId)) return unchanged;
    return {
      view: { ...view, foci: view.foci.filter((f) => f.id !== focusId) },
      rederive,
      changed: true,
    };
  }

  if (op.startsWith('focus.')) {
    const focus = normalizeFocus(payload['focus']);
    if (!focus || focus.characterId !== view.characterId) return unchanged;
    const foci = view.foci.some((f) => f.id === focus.id)
      ? view.foci.map((f) => (f.id === focus.id ? focus : f))
      : [...view.foci, focus];
    return { view: { ...view, foci }, rederive, changed: true };
  }

  if (op.startsWith('reagents.')) {
    if (payload['characterId'] !== view.characterId) return unchanged;
    const after = payload['after'];
    if (typeof after !== 'number') return unchanged;
    return {
      view: { ...view, reagents: Math.max(0, Math.trunc(after)) },
      rederive: false,
      changed: true,
    };
  }

  return unchanged;
}

// ---------------------------------------------------------------------------
// The log line the table reads
// ---------------------------------------------------------------------------

export interface MagicLogLine {
  id: string;
  text: string;
  ts: string;
}

function spiritName(payload: Record<string, unknown>): string {
  const name = rec(payload['spirit'])['name'];
  return typeof name === 'string' ? name : 'A spirit';
}

export function magicLogText(payload: Record<string, unknown>): string | null {
  const op = typeof payload['op'] === 'string' ? payload['op'] : '';
  const who = spiritName(payload);
  const remaining = typeof payload['remaining'] === 'number' ? payload['remaining'] : null;
  const reason =
    typeof payload['reason'] === 'string' && payload['reason'] ? ` — ${payload['reason']}` : '';
  switch (op) {
    case 'spirit.summoned': {
      const spirit = rec(payload['spirit']);
      return `${who} summoned at Force ${spirit['force'] ?? '?'}${spirit['bound'] === true ? ', bound' : ''}`;
    }
    case 'spirit.service.spend': {
      const spent = typeof payload['spent'] === 'number' ? payload['spent'] : 1;
      const short = typeof payload['shortfall'] === 'number' ? payload['shortfall'] : 0;
      const tail = short > 0 ? ` (${short} more than it owed)` : '';
      return `${who}: ${spent} service spent, ${remaining ?? 0} left${tail}${reason}`;
    }
    case 'spirit.service.grant':
      return `${who}: services granted, ${remaining ?? 0} owed${reason}`;
    case 'spirit.service.set':
      return `${who}: services set to ${remaining ?? 0}${reason}`;
    case 'spirit.dismissed':
      return `${who} dismissed`;
    case 'spirit.joined':
      return `${who} joined the fight`;
    case 'spirit.sustaining':
      return rec(payload['spirit'])['sustainingSpellId']
        ? `${who} took over a sustained spell`
        : `${who} let go of the spell it was holding`;
    case 'spirit.updated':
      return `${who} updated`;
    case 'focus.added':
      return `${rec(payload['focus'])['name'] ?? 'A focus'} added to the rack`;
    case 'focus.updated': {
      const focus = rec(payload['focus']);
      const state = focus['bonded'] !== true ? 'unbonded' : focus['active'] === true ? 'on' : 'off';
      return `${focus['name'] ?? 'A focus'} switched ${state}`;
    }
    case 'focus.removed':
      return 'A focus left the rack';
    case 'reagents.spend':
      return `Reagents spent: ${payload['before'] ?? '?'} → ${payload['after'] ?? '?'} drams`;
    case 'reagents.restock':
      return `Reagents restocked: ${payload['before'] ?? '?'} → ${payload['after'] ?? '?'} drams`;
    case 'reagents.set':
      return `Reagents set to ${payload['after'] ?? '?'} drams`;
    default:
      return null;
  }
}

/**
 * The last few magic lines out of the campaign log, newest last. The events
 * come from the live store, which is BACKFILLED over REST on mount — this is a
 * view of the log, not a substitute for hydrating one (LIVE-1).
 */
export function magicLogLines(events: readonly WsEvent[], limit = 5): MagicLogLine[] {
  const out: MagicLogLine[] = [];
  for (const event of events) {
    if (event.type !== 'magic.updated') continue;
    const text = magicLogText(rec(event.payload));
    if (text) out.push({ id: String(event.id), text, ts: event.ts });
  }
  return out.slice(-Math.max(0, limit));
}
