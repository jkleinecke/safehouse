/**
 * Tactical hints (FR10.10) — "optional and off by default".
 *
 * On the acting NPC's turn the GM can get one line of the kind a co-GM would
 * mutter: *sniper — hold the angle, take the biggest threat first*. That is the
 * whole feature. Three properties are load-bearing and are enforced here rather
 * than trusted to the caller:
 *
 * 1. **A hint is text and only text.** Nothing in this module rolls, moves,
 *    targets, spends Edge or writes a row. `TacticalHint` has no id, no verb
 *    and no handle on anything — there is deliberately nothing to "apply". The
 *    FR is explicit: never automation; no hint ever acts by itself.
 * 2. **Off unless the campaign turns it on.** `campaigns.settings.tacticalHints`
 *    must be exactly `true`. An absent, null or truthy-ish value is off, so a
 *    campaign that has never heard of the feature never sees it.
 * 3. **GM-only.** The one caller is the GM-scoped quick-roll rack. A hint names
 *    what the opposition is about to do; a player reading it is the same leak
 *    as reading the GM's notes (Principle 4).
 *
 * The lines are our own writing (G6/§14): they are ordinary tactical common
 * sense phrased for a Shadowrun table, not text from any book. The role
 * vocabulary is the FR10.1 one the template editor already offers, plus the
 * tags the shipped opposition happens to use.
 */
import { eq } from 'drizzle-orm';
import { jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import type { Db } from '@safehouse/db';
import { campaignSettings } from './discord.js';
import { readRoleTags } from './codex.js';
import { conditionOf, parseCopilot, type Condition } from './encounters-model.js';
import type { CombatantMonitors } from '@safehouse/contracts';

/** Minimal view of `npc_templates` — the hint needs a name and its role tags. */
const hintTemplates = pgTable('npc_templates', {
  id: uuid('id').primaryKey(),
  campaignId: uuid('campaign_id').notNull(),
  name: text('name').notNull(),
  gen: jsonb('gen').notNull(),
});

interface RoleLines {
  /** The default line for this role. */
  steady: string;
  /** Used instead once the combatant is bloodied or worse. */
  hurt?: string;
}

/**
 * Role tag → one-liner. Ordered by how often the tag turns up at this table;
 * the first tag on the template that appears here wins, so a template tagged
 * `['ganger', 'muscle']` gets the ganger line, which is the more specific read.
 */
export const ROLE_HINTS: Readonly<Record<string, RoleLines>> = {
  sniper: {
    steady: 'hold the angle and take the biggest threat first — a close shot is not worth the position',
    hurt: 'the position is blown; fall back to a new sightline before shooting again',
  },
  ganger: {
    steady: 'mob the nearest target — numbers are the only edge this crew has',
    hurt: 'gangers are brave in a group and nowhere else; look for the door',
  },
  muscle: {
    steady: 'close the distance and stay in their face — nobody lines up a shot on a moving problem',
    hurt: 'trade ground for time: cover first, then swing',
  },
  face: {
    steady: 'talk while the others move — stall, misdirect, buy the team a pass',
    hurt: 'stop negotiating and get behind someone who can take the hit',
  },
  lieutenant: {
    steady: 'give one order, then fight — this squad is worth more organised than brave',
    hurt: 'pull the line back and let the grunts screen; a dead leader ends the fight early',
  },
  leader: {
    steady: 'give one order, then fight — this squad is worth more organised than brave',
    hurt: 'pull the line back and let the grunts screen; a dead leader ends the fight early',
  },
  mage: {
    steady: 'spend the pass on the fight you can end, and keep something back to counterspell',
    hurt: 'drop the sustained spell before it drops you',
  },
  adept: {
    steady: 'one target, everything at once — you win exchanges, not firefights',
    hurt: 'break line of sight and pick a different exchange',
  },
  decker: {
    steady: 'stay out of the firing lane; the fight worth winning is in the host',
    hurt: 'jack out or go cold — a hurt decker in hot VR is a casualty waiting for a roll',
  },
  technomancer: {
    steady: 'stay out of the firing lane; the fight worth winning is on the grid',
    hurt: 'drop the complex form and get behind something solid',
  },
  rigger: {
    steady: 'let the drone take the shots and keep the meat body behind cover',
    hurt: 'jump out, drive out — the drone is replaceable and you are not',
  },
  drone: {
    steady: 'no self-preservation instinct: fly it into the angle nobody is covering',
  },
  spirit: {
    steady: 'materialise where it costs them a pass to answer, and remember the services are finite',
  },
  security: {
    steady: 'hold the choke point and call it in — corp security wins by not losing ground',
    hurt: 'fall back to the next door and make them come through it',
  },
  medic: {
    steady: 'the one who can still fight matters more than the one who is down',
    hurt: 'stabilise yourself first; a downed medic loses the whole squad',
  },
  street: {
    steady: 'nearest cover, nearest target — no plan survives contact anyway',
    hurt: 'this is not their fight any more; look for the exit',
  },
};

/** What the hint takes into account. Facts only — no advice comes in. */
export interface HintContext {
  condition: Condition;
}

export interface TacticalHint {
  /** The tag the line came from — so the GM can see why they got it. */
  roleTag: string;
  text: string;
  /** Provenance, in the Principle 3 spirit: where this line came from. */
  why: string;
  /** Restated on the wire so no client can mistake this for an action. */
  advisoryOnly: true;
}

/**
 * The line for an acting combatant, or `null` when no tag on the template has
 * one. Deterministic: same tags and same condition, same line — a hint that
 * shuffled itself would be noise, and the GM re-reads the tracker constantly.
 */
export function tacticalHint(roleTags: string[], ctx: HintContext): TacticalHint | null {
  if (ctx.condition === 'down') return null;
  const hurt = ctx.condition === 'bloodied';
  for (const raw of roleTags) {
    const tag = raw.trim().toLowerCase();
    const lines = ROLE_HINTS[tag];
    if (!lines) continue;
    const text = hurt ? (lines.hurt ?? lines.steady) : lines.steady;
    return {
      roleTag: tag,
      text,
      why: hurt
        ? `role tag "${tag}", and this one is bloodied`
        : `role tag "${tag}"`,
      advisoryOnly: true,
    };
  }
  return null;
}

/** FR10.10's default: off. Only an explicit `true` turns hints on. */
export function hintsEnabled(settings: Record<string, unknown> | null | undefined): boolean {
  return settings?.['tacticalHints'] === true;
}

/**
 * The hint for one live combatant, end to end: campaign flag → the template it
 * was generated from → that template's role tags → one line. Returns `null` for
 * every reason it might not apply (flag off, hand-added combatant, template
 * deleted, no matching tag, already down) so the caller can spread it into a
 * payload and stop thinking about it.
 */
export async function hintForCombatant(
  db: Db,
  campaignId: string,
  combatant: { copilot?: Record<string, unknown>; monitors: CombatantMonitors },
): Promise<TacticalHint | null> {
  if (!hintsEnabled(await campaignSettings(db, campaignId))) return null;
  const copilot = parseCopilot(combatant.copilot);
  const templateId = copilot.generator?.['templateId'];
  if (typeof templateId !== 'string' || templateId.length === 0) return null;
  const row = (
    await db.select().from(hintTemplates).where(eq(hintTemplates.id, templateId)).limit(1)
  )[0];
  if (!row || row.campaignId !== campaignId) return null;
  return tacticalHint(readRoleTags(row.gen), { condition: conditionOf(combatant.monitors) });
}
