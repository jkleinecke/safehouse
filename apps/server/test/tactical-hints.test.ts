/**
 * Tactical hints (FR10.10).
 *
 * The FR gives the feature three constraints and they are all negative, so
 * that is what this file mostly asserts: **off by default**, **GM-only**, and
 * **never automation**. The positive case — a sniper's line showing up beside
 * the quick-roll rack on the acting NPC's row — is one test; the rest is proof
 * that the feature stays out of the way of a table that never asked for it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { combatants, encounters } from '@safehouse/db';
import {
  bootstrapCampaign,
  joinAs,
  makeTestApp,
  type BootstrapResult,
  type JoinResult,
  type TestApp,
} from './core-helpers.js';
import { makeSheet, seedFixerFixture, type FixerFixture } from './fixer-helpers.js';
import { ROLE_HINTS, hintsEnabled, tacticalHint } from '../src/services/tactical-hints.js';

let t: TestApp;
let boot: BootstrapResult;
let player: JoinResult;
let fx: FixerFixture;
let sniperCombatantId = '';
let handRolledCombatantId = '';

function gm(url: string, payload?: Record<string, unknown>, method: 'GET' | 'POST' | 'PATCH' = 'GET') {
  return t.app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${boot.gmToken}` },
    ...(payload !== undefined ? { payload } : {}),
  });
}

function setHints(on: boolean) {
  return gm(`/api/campaigns/${boot.campaignId}`, { settings: { tacticalHints: on } }, 'PATCH');
}

const MONITORS = {
  physical: { max: 10, filled: 0 },
  stun: { max: 10, filled: 0 },
  overflow: { max: 4, filled: 0 },
};

beforeAll(async () => {
  t = await makeTestApp('tactical-hints');
  boot = await bootstrapCampaign(t.app, 'Neon Rain');
  player = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Kestrel');
  fx = await seedFixerFixture(t.db, boot.campaignId);

  // Give the fixture template a role tag the hint table knows.
  const encounter = (
    await t.db
      .insert(encounters)
      .values({ campaignId: boot.campaignId, name: 'Warehouse standoff', state: 'live' })
      .returning()
  )[0]!;

  const sheet = makeSheet('Rooftop shooter');
  const rows = await t.db
    .insert(combatants)
    .values([
      {
        encounterId: encounter.id,
        source: 'npc_template',
        sourceId: fx.templateId,
        name: 'Rooftop shooter',
        initBase: 9,
        initScore: 18,
        monitors: MONITORS,
        visibility: 'gm',
        copilot: { sheet, initDice: 2, generator: { templateId: fx.templateId, tierId: 'street' } },
      },
      {
        // Typed straight into the tracker: no template, so no role tags.
        encounterId: encounter.id,
        source: 'manual',
        name: 'Nervous fixer',
        initBase: 6,
        initScore: 10,
        monitors: MONITORS,
        visibility: 'gm',
        copilot: { sheet },
      },
    ])
    .returning();
  sniperCombatantId = rows[0]!.id;
  handRolledCombatantId = rows[1]!.id;
}, 120_000);

afterAll(async () => {
  await t.close();
});

// ---------------------------------------------------------------------------
// The lookup table
// ---------------------------------------------------------------------------

describe('the lookup table (pure)', () => {
  it('answers on the first tag it recognises, in the template’s own order', () => {
    const hint = tacticalHint(['docklands', 'ganger', 'muscle'], { condition: 'unharmed' });
    expect(hint?.roleTag).toBe('ganger');
    expect(hint?.text).toBe(ROLE_HINTS['ganger']!.steady);
    expect(hint?.why).toContain('ganger');
  });

  it('switches to the hurt line once a combatant is bloodied', () => {
    const steady = tacticalHint(['sniper'], { condition: 'unharmed' });
    const hurt = tacticalHint(['sniper'], { condition: 'bloodied' });
    expect(steady?.text).toBe(ROLE_HINTS['sniper']!.steady);
    expect(hurt?.text).toBe(ROLE_HINTS['sniper']!.hurt);
    expect(hurt?.why).toContain('bloodied');
  });

  it('is silent for a downed combatant and for tags it has no line for', () => {
    expect(tacticalHint(['sniper'], { condition: 'down' })).toBeNull();
    expect(tacticalHint(['docklands', 'seattle'], { condition: 'unharmed' })).toBeNull();
    expect(tacticalHint([], { condition: 'unharmed' })).toBeNull();
  });

  it('is deterministic — the same row reads the same line every time', () => {
    const a = tacticalHint(['muscle'], { condition: 'unharmed' });
    const b = tacticalHint(['muscle'], { condition: 'unharmed' });
    expect(a?.text).toBe(b?.text);
  });

  it('carries no verb: a hint is text and marks itself advisory', () => {
    const hint = tacticalHint(['sniper'], { condition: 'unharmed' })!;
    expect(Object.keys(hint).sort()).toEqual(['advisoryOnly', 'roleTag', 'text', 'why']);
    expect(hint.advisoryOnly).toBe(true);
  });

  it('is off unless the campaign says exactly true', () => {
    expect(hintsEnabled(undefined)).toBe(false);
    expect(hintsEnabled({})).toBe(false);
    expect(hintsEnabled({ tacticalHints: false })).toBe(false);
    expect(hintsEnabled({ tacticalHints: 'yes' })).toBe(false);
    expect(hintsEnabled({ tacticalHints: 1 })).toBe(false);
    expect(hintsEnabled({ tacticalHints: true })).toBe(true);
  });

  it('ships original one-liners only — no stat blocks, no book phrasing', () => {
    for (const [tag, lines] of Object.entries(ROLE_HINTS)) {
      for (const line of [lines.steady, lines.hurt].filter((l): l is string => l !== undefined)) {
        expect(line.length, tag).toBeGreaterThan(20);
        expect(line.length, tag).toBeLessThan(140);
        // A hint never quotes a rule or a number at the GM.
        expect(line, tag).not.toMatch(/\bp\.\s?\d+|\bSR5\b|\d+\s?(dice|DV|AP)\b/i);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// In the tracker payload
// ---------------------------------------------------------------------------

describe('on the acting NPC’s row', () => {
  it('is absent by default', async () => {
    const res = await gm(`/api/combatants/${sniperCombatantId}/quick-rolls`);
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body['entries']).toBeDefined();
    expect(body['hint']).toBeUndefined();
  });

  it('appears once the campaign turns it on, tagged with where it came from', async () => {
    expect((await setHints(true)).statusCode).toBeLessThan(300);
    const res = await gm(`/api/combatants/${sniperCombatantId}/quick-rolls`);
    expect(res.statusCode).toBe(200);
    const hint = (res.json() as { hint?: Record<string, unknown> }).hint;
    expect(hint).toBeDefined();
    expect(hint!['roleTag']).toBe('muscle'); // the fixture template's tag
    expect(hint!['advisoryOnly']).toBe(true);
    expect(String(hint!['text']).length).toBeGreaterThan(0);
  });

  it('stays silent for a combatant the GM typed in by hand', async () => {
    const res = await gm(`/api/combatants/${handRolledCombatantId}/quick-rolls`);
    expect(res.statusCode).toBe(200);
    expect((res.json() as Record<string, unknown>)['hint']).toBeUndefined();
  });

  it('is never visible to a player — the rack itself is GM-only', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/combatants/${sniperCombatantId}/quick-rolls`,
      headers: { authorization: `Bearer ${player.token}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.body).not.toContain('hint');
  });

  it('goes away again when the campaign turns it off', async () => {
    expect((await setHints(false)).statusCode).toBeLessThan(300);
    const res = await gm(`/api/combatants/${sniperCombatantId}/quick-rolls`);
    expect((res.json() as Record<string, unknown>)['hint']).toBeUndefined();
  });
});
