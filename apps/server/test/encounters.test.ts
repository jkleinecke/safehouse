/**
 * Encounters + combat copilot suite (M4 FR4.1–4.10, FR10.7–10.9).
 *
 * Covers the four contract-critical behaviours:
 *  1. the full FR4.3 pass loop driven over the API;
 *  2. resolve-chain → commit puts real boxes on the defender, and the wound
 *     modifier shows up in that defender's NEXT quick-roll pool (the −1);
 *  3. a grunt group at half strength fires the FR10.9 morale suggestion;
 *  4. the player encounter view never carries a GM-hidden combatant (FR4.9).
 *
 * All fiction here is original (G6/§14): no book stat blocks, no book text.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { SheetV1Schema, type SheetV1 } from '@safehouse/contracts';
import { characters, eventsSince } from '@safehouse/db';
import { bootstrapCampaign, joinAs, makeTestApp, type TestApp } from './core-helpers.js';

const MONITORS = {
  physical: { max: 10, filled: 0 },
  stun: { max: 10, filled: 0 },
  overflow: { max: 4, filled: 0 },
};

/** An original, hand-rolled sheet — never book content. */
function sheetFor(alias: string, over: Partial<Record<string, unknown>> = {}): SheetV1 {
  return SheetV1Schema.parse({
    v: 1,
    identity: { alias },
    attributes: {
      bod: 4,
      agi: 4,
      rea: 5,
      str: 3,
      wil: 4,
      log: 3,
      int: 4,
      cha: 3,
      edg: { max: 3, current: 3 },
      ess: 6,
    },
    skills: [
      { id: 'pistols', rating: 4, attr: 'agi' },
      { id: 'perception', rating: 3, attr: 'int' },
    ],
    armor: [{ name: 'patched longcoat', rating: 9, worn: true }],
    weapons: [
      {
        name: 'snub pistol',
        skillId: 'pistols',
        acc: 6,
        dv: '7P',
        ap: 0,
        modes: ['SA'],
        recoilComp: 1,
      },
    ],
    ...over,
  });
}

let harness: TestApp;
let app: FastifyInstance;
let campaignId: string;
let gmToken: string;

async function call(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  token: string,
  payload?: unknown,
) {
  return app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${token}` },
    ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
  });
}

async function gmJson<T = Record<string, any>>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload?: unknown,
): Promise<T> {
  const res = await call(method, url, gmToken, payload);
  if (res.statusCode >= 400) throw new Error(`${method} ${url} → ${res.statusCode} ${res.body}`);
  return res.json() as T;
}

async function newEncounter(name: string): Promise<string> {
  const body = await gmJson(`POST`, `/api/campaigns/${campaignId}/encounters`, { name });
  return body['encounter'].id as string;
}

// Generous hook timeouts: the whole server suite boots ~20 PGlite instances in
// parallel workers, and first-migration on a cold Windows temp dir is slow.
beforeAll(async () => {
  harness = await makeTestApp('encounters');
  app = harness.app;
  const boot = await bootstrapCampaign(app, 'Rain on the Docks');
  campaignId = boot.campaignId;
  gmToken = boot.gmToken;
}, 120_000);

afterAll(async () => {
  await harness.close();
}, 60_000);

describe('encounters CRUD (FR4.1)', () => {
  it('creates, lists, patches and deletes an encounter', async () => {
    const id = await newEncounter('Loading bay');
    const list = await gmJson('GET', `/api/campaigns/${campaignId}/encounters`);
    expect(list['encounters'].some((e: { id: string }) => e.id === id)).toBe(true);

    const patched = await gmJson('PATCH', `/api/encounters/${id}`, { state: 'live', name: 'Bay 4' });
    expect(patched['encounter'].state).toBe('live');
    expect(patched['encounter'].name).toBe('Bay 4');

    const del = await call('DELETE', `/api/encounters/${id}`, gmToken);
    expect(del.statusCode).toBe(200);
    const gone = await call('GET', `/api/encounters/${id}`, gmToken);
    expect(gone.statusCode).toBe(404);
  });

  it('refuses mutations from a player device (§13)', async () => {
    const id = await newEncounter('Guard post');
    const player = await joinAs(app, campaignId, gmToken, 'player', 'Kite');
    const res = await call('POST', `/api/encounters/${id}/combatants`, player.token, {
      source: 'manual',
      name: 'Nobody',
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('turn engine — the full FR4.3 pass loop', () => {
  it('acts in score order, drops 10 per pass, and re-rolls on a new turn', async () => {
    const id = await newEncounter('Stairwell');
    const fast = (
      await gmJson('POST', `/api/encounters/${id}/combatants`, {
        source: 'manual',
        name: 'Quick',
        initBase: 10,
        initDice: 1,
        initScore: 20,
        visibility: 'public',
        monitors: MONITORS,
      })
    )['combatant'];
    const slow = (
      await gmJson('POST', `/api/encounters/${id}/combatants`, {
        source: 'manual',
        name: 'Slow',
        initBase: 10,
        initDice: 1,
        initScore: 12,
        visibility: 'public',
        monitors: MONITORS,
      })
    )['combatant'];

    // Pass 1: highest score acts first, then the other, then nobody.
    let step = await gmJson('POST', `/api/encounters/${id}/next-actor`);
    expect(step['acted'].id).toBe(fast.id);
    expect(step['active'].id).toBe(slow.id);
    step = await gmJson('POST', `/api/encounters/${id}/next-actor`);
    expect(step['acted'].id).toBe(slow.id);
    expect(step['active']).toBeNull();

    // End of pass: every score −10, acted cleared, someone is still above 0.
    let pass = await gmJson('POST', `/api/encounters/${id}/end-pass`);
    expect(pass['anyActive']).toBe(true);
    expect(pass['encounter'].pass).toBe(1);
    const scores = Object.fromEntries(
      (pass['combatants'] as Array<{ id: string; initScore: number; actedThisPass: boolean }>).map(
        (c) => [c.id, c],
      ),
    );
    expect(scores[fast.id]?.initScore).toBe(10);
    expect(scores[slow.id]?.initScore).toBe(2);
    expect(scores[fast.id]?.actedThisPass).toBe(false);

    // Pass 2 runs the same way; afterwards nobody is left above 0.
    await gmJson('POST', `/api/encounters/${id}/next-actor`);
    await gmJson('POST', `/api/encounters/${id}/next-actor`);
    pass = await gmJson('POST', `/api/encounters/${id}/end-pass`);
    expect(pass['anyActive']).toBe(false);
    expect(pass['encounter'].pass).toBe(2);
    for (const c of pass['combatants'] as Array<{ initScore: number }>) {
      expect(c.initScore).toBe(0);
    }

    // New turn: everyone re-rolls (base 10 + 1d6 ⇒ 11..16), pass resets to 1.
    const turn = await gmJson('POST', `/api/encounters/${id}/new-turn`);
    expect(turn['encounter'].turn).toBe(1);
    expect(turn['encounter'].pass).toBe(1);
    for (const c of turn['combatants'] as Array<{ initScore: number }>) {
      expect(c.initScore).toBeGreaterThanOrEqual(11);
      expect(c.initScore).toBeLessThanOrEqual(16);
    }
  });

  it('deducts an interrupt cost immediately (FR4.4)', async () => {
    const id = await newEncounter('Catwalk');
    const c = (
      await gmJson('POST', `/api/encounters/${id}/combatants`, {
        source: 'manual',
        name: 'Dodger',
        initScore: 20,
        initBase: 10,
        monitors: MONITORS,
      })
    )['combatant'];
    const out = await gmJson('POST', `/api/combatants/${c.id}/interrupt`, {
      actionId: 'full_defense',
    });
    expect(out['action'].cost).toBe(10);
    expect(out['combatant'].initScore).toBe(10);
  });
});

describe('damage, undo and status effects (FR4.5 / FR4.7)', () => {
  it('fills the monitor, shifts the score, and undoes in one tap', async () => {
    const id = await newEncounter('Server room');
    const c = (
      await gmJson('POST', `/api/encounters/${id}/combatants`, {
        source: 'manual',
        name: 'Bagman',
        initScore: 14,
        initBase: 8,
        monitors: MONITORS,
      })
    )['combatant'];

    const hit = await gmJson('POST', `/api/encounters/${id}/damage`, {
      targetId: c.id,
      boxes: 3,
      track: 'physical',
    });
    expect(hit['combatant'].monitors.physical.filled).toBe(3);
    expect(hit['result'].woundModifier.after).toBe(-1);
    expect(hit['combatant'].initScore).toBe(13); // wound modifier propagated

    const undone = await gmJson('POST', `/api/encounters/${id}/damage/undo`, { combatantId: c.id });
    expect(undone['combatant'].monitors.physical.filled).toBe(0);
    expect(undone['combatant'].initScore).toBe(14);

    // Nothing left to undo.
    const again = await call('POST', `/api/encounters/${id}/damage/undo`, gmToken, {
      combatantId: c.id,
    });
    expect(again.statusCode).toBe(409);
  });

  it('applies damage from an opposed roll result', async () => {
    const id = await newEncounter('Loading dock');
    const c = (
      await gmJson('POST', `/api/encounters/${id}/combatants`, {
        source: 'manual',
        name: 'Lookout',
        monitors: MONITORS,
      })
    )['combatant'];
    const out = await gmJson('POST', `/api/encounters/${id}/damage/from-roll`, {
      targetId: c.id,
      baseDv: 7,
      netHits: 2,
      soakHits: 5,
    });
    expect(out['modifiedDv']).toBe(9);
    expect(out['boxes']).toBe(4);
    expect(out['combatant'].monitors.physical.filled).toBe(4);
  });

  it('attaches and detaches a status effect', async () => {
    const id = await newEncounter('Rooftop');
    const c = (
      await gmJson('POST', `/api/encounters/${id}/combatants`, {
        source: 'manual',
        name: 'Spotter',
        monitors: MONITORS,
      })
    )['combatant'];
    const attached = await gmJson('POST', `/api/combatants/${c.id}/effects`, {
      id: 'prone',
      name: 'Prone',
      mods: [
        {
          id: 'prone.pool',
          source: { kind: 'status' },
          target: 'pool.all',
          op: 'add',
          value: -2,
          active: true,
        },
      ],
      duration: { kind: 'manual' },
    });
    expect(attached['combatant'].effects).toHaveLength(1);
    const detached = await gmJson('DELETE', `/api/combatants/${c.id}/effects/prone`);
    expect(detached['combatant'].effects).toHaveLength(0);
  });
});

describe('combat copilot (FR10.7–10.8)', () => {
  it('resolve-chain → commit lands boxes whose wound shows in the next quick-roll', async () => {
    const id = await newEncounter('Alley exchange');

    // Defender: a PC linked to its LIVE sheet row.
    const [character] = await harness.db
      .insert(characters)
      .values({ campaignId, name: 'Halcyon', sheet: sheetFor('Halcyon') })
      .returning();
    const defender = (
      await gmJson('POST', `/api/encounters/${id}/combatants`, {
        source: 'character',
        sourceId: character!.id,
      })
    )['combatant'];

    // Attacker: a generated NPC carrying its own sheet.
    const attacker = (
      await gmJson('POST', `/api/encounters/${id}/combatants`, {
        source: 'generated',
        name: 'Wrecker',
        sheet: sheetFor('Wrecker'),
      })
    )['combatant'];

    // The rack honours wounds and scene mods automatically (FR10.7).
    const before = await gmJson('GET', `/api/combatants/${defender.id}/quick-rolls`);
    const defenseBefore = (before['entries'] as Array<{ key: string; pool: number }>).find(
      (e) => e.key === 'defense',
    )!;
    expect(defenseBefore.pool).toBe(9); // REA 5 + INT 4
    expect(before['woundModifier']).toBe(0);
    const attackRow = (before['entries'] as Array<{ key: string }>).find((e) =>
      e.key.startsWith('attack:'),
    );
    expect(attackRow).toBeDefined();

    // Every step comes back as an overridable card; nothing is persisted yet.
    const chain = await gmJson('POST', `/api/encounters/${id}/resolve-chain`, {
      attackerId: attacker.id,
      defenderId: defender.id,
      weaponId: 'snub pistol',
    });
    expect(chain['committed']).toBe(false);
    const steps = (chain['cards'] as Array<{ step: string; overridable: boolean }>).map(
      (c) => c.step,
    );
    expect(steps.slice(0, 2)).toEqual(['attack', 'defense']);
    expect((chain['cards'] as Array<{ overridable: boolean }>).every((c) => c.overridable)).toBe(
      true,
    );
    const stillClean = await gmJson('GET', `/api/encounters/${id}`);
    expect(
      (stillClean['combatants'] as Array<{ id: string; monitors: { physical: { filled: number } } }>)
        .find((c) => c.id === defender.id)!
        .monitors.physical.filled,
    ).toBe(0);

    // The GM commits the final numbers (Principle 2: overridable before commit).
    const committed = await gmJson('POST', `/api/encounters/${id}/resolve-chain/commit`, {
      defenderId: defender.id,
      boxes: 3,
      track: 'physical',
    });
    expect(committed['committed']).toBe(true);
    expect(committed['combatant'].monitors.physical.filled).toBe(3);

    // …and the wound is already in the defender's NEXT quick-roll pool.
    const after = await gmJson('GET', `/api/combatants/${defender.id}/quick-rolls`);
    expect(after['woundModifier']).toBe(-1);
    const defenseAfter = (after['entries'] as Array<{ key: string; pool: number }>).find(
      (e) => e.key === 'defense',
    )!;
    expect(defenseAfter.pool).toBe(defenseBefore.pool - 1);
    const soakAfter = (after['entries'] as Array<{ key: string; pool: number }>).find(
      (e) => e.key === 'soak',
    )!;
    expect(soakAfter.pool).toBe(13); // BOD 4 + armor 9 — soak is wound-exempt

    // A quick roll rolls the rack pool and lands in the log.
    const rolled = await gmJson('POST', `/api/combatants/${defender.id}/quick-roll`, {
      key: 'defense',
    });
    expect(rolled['request'].pool).toBe(defenseAfter.pool);
    expect(rolled['result'].faces).toHaveLength(defenseAfter.pool);
    expect(rolled['rollId']).toBeTruthy();
  });
});

describe('morale (FR10.9)', () => {
  it('fires a GM-only suggestion when a grunt group hits half strength', async () => {
    const id = await newEncounter('Warehouse sweep');
    const squad = (
      await gmJson('POST', `/api/encounters/${id}/combatants`, {
        source: 'grunt_group',
        name: 'Dock crew',
        monitors: MONITORS,
        grunt: { size: 2, professionalRating: 1 },
      })
    )['combatant'];
    expect(squad.grunt.members).toHaveLength(2);

    const before = await eventsSince(harness.db, campaignId, 0, 5000);
    const hit = await gmJson('POST', `/api/encounters/${id}/damage`, {
      targetId: squad.id,
      boxes: 10,
      track: 'physical',
      memberIndex: 0,
    });
    expect(hit['gruntMember'].down).toBe(true);
    expect(hit['morale']).not.toBeNull();
    expect(hit['morale'].reasons).toContain('at half strength');
    expect(hit['morale'].suggestion).toBe('cut_and_run');

    const after = await eventsSince(harness.db, campaignId, 0, 5000);
    const posted = after
      .slice(before.length)
      .filter((e) => e.type === 'log.posted')
      .filter((e) => (e.payload as { kind?: string }).kind === 'morale');
    expect(posted).toHaveLength(1);
    expect(posted[0]!.visibility).toBe('gm');
  });
});

describe('player encounter view (FR4.9)', () => {
  it('shows turn order and own monitors but never a GM-hidden combatant', async () => {
    const id = await newEncounter('Chokepoint');
    const player = await joinAs(app, campaignId, gmToken, 'player', 'Ferro');
    const [character] = await harness.db
      .insert(characters)
      .values({
        campaignId,
        name: 'Ferro',
        ownerUserId: player.user.id,
        sheet: sheetFor('Ferro'),
      })
      .returning();
    const pc = (
      await gmJson('POST', `/api/encounters/${id}/combatants`, {
        source: 'character',
        sourceId: character!.id,
        initScore: 15,
      })
    )['combatant'];
    const ambusher = (
      await gmJson('POST', `/api/encounters/${id}/combatants`, {
        source: 'generated',
        name: 'Silent gun',
        visibility: 'gm',
        initScore: 22,
        monitors: MONITORS,
        sheet: sheetFor('Silent gun'),
      })
    )['combatant'];

    const gmView = await gmJson('GET', `/api/encounters/${id}`);
    expect(gmView['scope']).toBe('gm');
    expect(gmView['combatants']).toHaveLength(2);
    expect(gmView['activeCombatantId']).toBe(ambusher.id);

    const res = await call('GET', `/api/encounters/${id}`, player.token);
    expect(res.statusCode).toBe(200);
    const view = res.json() as Record<string, any>;
    expect(view['scope']).toBe('player');
    expect(view['combatants']).toHaveLength(1);
    expect(view['combatants'][0].id).toBe(pc.id);
    expect(view['combatants'][0].own).toBe(true);
    expect(view['combatants'][0].monitors).toBeDefined();
    expect(view['turnOrder']).toEqual([pc.id]);
    // Principle 4: the hidden row is not in the payload at all, not even its id.
    expect(res.body).not.toContain(ambusher.id);
    expect(res.body).not.toContain('Silent gun');
  });

  it('hides another player-visible combatant\'s exact boxes', async () => {
    const id = await newEncounter('Ramp');
    const player = await joinAs(app, campaignId, gmToken, 'player', 'Wisp');
    const mook = (
      await gmJson('POST', `/api/encounters/${id}/combatants`, {
        source: 'generated',
        name: 'Bouncer',
        visibility: 'public',
        monitors: MONITORS,
        sheet: sheetFor('Bouncer'),
      })
    )['combatant'];
    await gmJson('POST', `/api/encounters/${id}/damage`, {
      targetId: mook.id,
      boxes: 6,
      track: 'physical',
    });
    const view = (await call('GET', `/api/encounters/${id}`, player.token)).json() as Record<
      string,
      any
    >;
    const row = view['combatants'].find((c: { id: string }) => c.id === mook.id);
    expect(row.own).toBe(false);
    expect(row.monitors).toBeUndefined();
    expect(row.condition).toBe('wounded');
  });
});
