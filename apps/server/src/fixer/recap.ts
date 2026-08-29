/**
 * Recap material (FR12.12) — the deterministic half of "the session writes its
 * own recap".
 *
 * The split is D13's, applied to prose: **the log owns the facts, the model
 * owns the sentences.** This module reads what actually happened — rolls,
 * damage, reveals, awards, scene markers — straight out of `rolls`,
 * `ledger_entries` and `ws_events`, and never asks the model for a number. The
 * `draft_recap` tool hands the model's paragraphs to `assembleRecap`, which
 * staples the two together into one markdown body.
 *
 * Two rules keep the recap safe to publish (FR6.3 makes it the players' only
 * between-session window, so it leaves the laptop):
 *
 * 1. The **facts section is built from PUBLIC rows only**. A roll made behind
 *    the screen, a GM-only reveal, a hidden combatant going down: none of them
 *    can reach the assembled body, because they are filtered out here rather
 *    than trusted to the model's discretion. The GM-only tallies still come
 *    back in the digest so the Fixer can *tell the GM* what it left out.
 * 2. Whatever the model wrote is still run through the FR12.19 spoiler guard by
 *    the caller — prose is where a GM-only name actually leaks.
 *
 * Nothing here writes. The caller stores the result as an `ai_generations`
 * draft (Principle 8).
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  characters,
  gameSessions,
  ledgerEntries,
  recentEvents,
  rolls,
  type Db,
} from '@safehouse/db';
import { httpError } from '../services/auth.js';

/**
 * How far back down the event log a recap looks.
 *
 * INTEGRATION: this is a *recency* window, not a session boundary. `ws_events`
 * carries no `session_id` and `game_sessions` records no start timestamp, so
 * "the events of this session" is not expressible in SQL today — `rolls` and
 * `ledger_entries` are session-scoped and are read that way below, but the
 * markers (scenes, reveals, casualties) are the last N table events. That is
 * right for the normal case (a recap is written at the end of the night it
 * describes) and wrong for a recap written a week later. The fix is one column,
 * `ws_events.session_id`, filled from `activeSessionId` in `Hub.emit`.
 */
export const RECAP_EVENT_LIMIT = 100;

export type SessionRow = typeof gameSessions.$inferSelect;

// ---------------------------------------------------------------------------
// Session resolution
// ---------------------------------------------------------------------------

/**
 * The session a recap is about: the one named, else the live one, else the
 * most recently created. A campaign with no sessions at all is an error the
 * model can act on ("start a session first") rather than an empty draft.
 */
export async function recapSessionRow(
  db: Db,
  campaignId: string,
  sessionId?: string,
): Promise<SessionRow> {
  if (sessionId) {
    const row = (
      await db.select().from(gameSessions).where(eq(gameSessions.id, sessionId)).limit(1)
    )[0];
    if (!row || row.campaignId !== campaignId) {
      throw httpError(404, 'not_found', 'unknown session');
    }
    return row;
  }
  const live = (
    await db
      .select()
      .from(gameSessions)
      .where(and(eq(gameSessions.campaignId, campaignId), eq(gameSessions.state, 'live')))
      .orderBy(desc(gameSessions.id))
      .limit(1)
  )[0];
  if (live) return live;
  const latest = (
    await db
      .select()
      .from(gameSessions)
      .where(eq(gameSessions.campaignId, campaignId))
      .orderBy(desc(gameSessions.id))
      .limit(1)
  )[0];
  if (!latest) {
    throw httpError(404, 'not_found', 'this campaign has no sessions yet — nothing to recap');
  }
  return latest;
}

// ---------------------------------------------------------------------------
// The digest
// ---------------------------------------------------------------------------

export interface RecapAward {
  character: string;
  currency: 'karma' | 'nuyen';
  delta: number;
  reason: string;
  /** Pending awards are proposals; the recap says so rather than promising. */
  state: string;
}

export interface RecapDigest {
  sessionId: string;
  date: string | null;
  state: string;
  attendance: string[];
  /** Public rolls only — the tallies the recap is allowed to print. */
  rolls: { total: number; best: number; glitches: number; criticals: number };
  /** Combatants seen going down in a PUBLIC damage event. */
  down: string[];
  /** Named regions and codex pages revealed to the table. */
  reveals: string[];
  /** Scenes activated, in the order the table saw them. */
  sceneMarkers: string[];
  /** Table-talk / GM log posts that were public. */
  logPosts: string[];
  awards: RecapAward[];
  /** Read counts, so the Fixer can say how much log it actually saw. */
  events: { read: number; public: number; gmOnly: number };
  /** Rolls that stayed behind the screen — counted, never quoted. */
  hiddenRolls: number;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function pushUnique(list: string[], value: string): void {
  if (value.length > 0 && !list.includes(value)) list.push(value);
}

/**
 * Everything the recap is entitled to state, read live. Public-only for the
 * facts; the GM-only counts are reported as counts so the Fixer can warn the
 * GM that the log has more in it than the recap may say.
 */
export async function recapDigest(
  db: Db,
  campaignId: string,
  session: SessionRow,
): Promise<RecapDigest> {
  // --- rolls: the session's own rows, public ones only ---------------------
  const sessionRolls = await db
    .select({ hits: rolls.limitedHits, raw: rolls.hits, glitch: rolls.glitch, visibility: rolls.visibility })
    .from(rolls)
    .where(and(eq(rolls.campaignId, campaignId), eq(rolls.sessionId, session.id)))
    .limit(1000);
  const publicRolls = sessionRolls.filter((r) => r.visibility === 'public');
  const rollStats = {
    total: publicRolls.length,
    best: publicRolls.reduce((m, r) => Math.max(m, r.hits ?? r.raw ?? 0), 0),
    glitches: publicRolls.filter((r) => r.glitch === 'glitch').length,
    criticals: publicRolls.filter((r) => r.glitch === 'critical').length,
  };

  // --- awards: ledger rows booked against this session ----------------------
  const entries = await db
    .select()
    .from(ledgerEntries)
    .where(eq(ledgerEntries.sessionId, session.id))
    .orderBy(desc(ledgerEntries.createdAt))
    .limit(100);
  const names = new Map<string, string>();
  if (entries.length > 0) {
    const rows = await db
      .select({ id: characters.id, name: characters.name })
      .from(characters)
      .where(inArray(characters.id, [...new Set(entries.map((e) => e.characterId))]));
    for (const row of rows) names.set(row.id, row.name);
  }
  const awards: RecapAward[] = entries
    .filter((e) => e.state !== 'rejected')
    .map((e) => ({
      character: names.get(e.characterId) ?? 'unknown',
      currency: e.currency,
      delta: e.delta,
      reason: e.reason,
      state: e.state,
    }));

  // --- the event log: markers, reveals, casualties ---------------------------
  const events = await recentEvents(db, campaignId, RECAP_EVENT_LIMIT);
  const down: string[] = [];
  const reveals: string[] = [];
  const sceneMarkers: string[] = [];
  const logPosts: string[] = [];
  let publicEvents = 0;
  let gmOnlyEvents = 0;

  // Oldest first: the table experienced the session in that order and so
  // should the recap's scene list.
  for (const row of [...events].reverse()) {
    if (row.visibility !== 'public') {
      gmOnlyEvents += 1;
      continue;
    }
    publicEvents += 1;
    const payload = record(row.payload);
    switch (row.type) {
      case 'combatant.damaged': {
        if (payload['undo'] === true) break;
        if (text(payload['condition']) === 'down') pushUnique(down, text(payload['name']));
        break;
      }
      case 'scene.activated': {
        pushUnique(sceneMarkers, text(payload['name']) || text(record(payload['scene'])['name']));
        break;
      }
      case 'fog.updated': {
        const regionNames = payload['regionNames'];
        if (Array.isArray(regionNames)) {
          for (const name of regionNames) pushUnique(reveals, text(name));
        }
        pushUnique(reveals, text(payload['regionName']));
        break;
      }
      case 'wiki.revealed':
      case 'handout.revealed': {
        pushUnique(reveals, text(payload['title']) || text(payload['label']));
        break;
      }
      case 'log.posted': {
        const body = text(payload['text']) || text(payload['message']) || text(payload['note']);
        if (body.length > 0 && logPosts.length < 12) logPosts.push(body.slice(0, 240));
        break;
      }
      default:
        break;
    }
  }

  return {
    sessionId: session.id,
    date: session.date,
    state: session.state,
    attendance: session.attendance,
    rolls: rollStats,
    down,
    reveals,
    sceneMarkers,
    logPosts,
    awards,
    events: { read: events.length, public: publicEvents, gmOnly: gmOnlyEvents },
    hiddenRolls: sessionRolls.length - publicRolls.length,
  };
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

export interface RecapMoment {
  title: string;
  text: string;
}

export interface RecapContribution {
  who: string;
  what: string;
}

/** The model's half: paragraphs, never numbers. */
export interface RecapProse {
  headline: string;
  moments: RecapMoment[];
  whoDidWhat: RecapContribution[];
  cliffhanger: string;
}

function moneyLine(award: RecapAward): string {
  const sign = award.delta >= 0 ? '+' : '';
  const unit = award.currency === 'karma' ? 'karma' : 'nuyen';
  const pending = award.state === 'pending' ? ' *(pending the GM’s confirmation)*' : '';
  const why = award.reason.trim().length > 0 ? ` — ${award.reason.trim()}` : '';
  return `- **${award.character}** ${sign}${award.delta} ${unit}${why}${pending}`;
}

/**
 * The model's prose plus the log's facts, in the order the GM reads them:
 * what happened, the moments, who did what, what the dice said, the awards,
 * the cliffhanger. Every fact line comes from `digest`, which is public-only.
 */
export function assembleRecap(title: string, prose: RecapProse, digest: RecapDigest): string {
  const out: string[] = [`# ${title}`, ''];
  if (prose.headline.trim().length > 0) out.push(prose.headline.trim(), '');

  if (digest.sceneMarkers.length > 0) {
    out.push(`*Where it went:* ${digest.sceneMarkers.join(' → ')}`, '');
  }

  if (prose.moments.length > 0) {
    out.push('## Headline moments', '');
    for (const moment of prose.moments) {
      const heading = moment.title.trim();
      const body = moment.text.trim();
      out.push(heading.length > 0 ? `- **${heading}** — ${body}` : `- ${body}`);
    }
    out.push('');
  }

  if (prose.whoDidWhat.length > 0) {
    out.push('## Who did what', '');
    for (const line of prose.whoDidWhat) {
      out.push(`- **${line.who.trim()}** — ${line.what.trim()}`);
    }
    out.push('');
  }

  const facts: string[] = [];
  if (digest.rolls.total > 0) {
    facts.push(`- ${digest.rolls.total} rolls at the table; best result ${digest.rolls.best} hits`);
  }
  if (digest.rolls.glitches > 0) {
    facts.push(`- ${digest.rolls.glitches} glitch${digest.rolls.glitches === 1 ? '' : 'es'}`);
  }
  if (digest.rolls.criticals > 0) {
    facts.push(
      `- ${digest.rolls.criticals} critical glitch${digest.rolls.criticals === 1 ? '' : 'es'}`,
    );
  }
  if (digest.down.length > 0) facts.push(`- Went down: ${digest.down.join(', ')}`);
  if (digest.reveals.length > 0) facts.push(`- Revealed: ${digest.reveals.join(', ')}`);
  if (facts.length > 0) {
    out.push('## What the log says', '', ...facts, '');
  }

  if (digest.awards.length > 0) {
    out.push('## Awards', '', ...digest.awards.map(moneyLine), '');
  }

  if (prose.cliffhanger.trim().length > 0) {
    out.push('## Next time', '', prose.cliffhanger.trim(), '');
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
