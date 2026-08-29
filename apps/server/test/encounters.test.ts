/**
 * Encounters + combat copilot suite (M4 FR4.1–4.10, FR10.7–10.9).
 *
 * Covers the contract-critical behaviours:
 *  1. the full FR4.3 pass loop driven over the API;
 *  2. resolve-chain → commit puts real boxes on the defender, and the wound
 *     modifier shows up in that defender's NEXT quick-roll pool (the −1);
 *  3. a grunt group at half strength fires the FR10.9 morale suggestion;
 *  4. the player encounter view never carries a GM-hidden combatant (FR4.9);
 *  5. an encounter staged from a scene keeps AUGMENTED initiative (FR9.10);
 *  6. rolling initiative starts turn 1 / pass 1 (FR4.3);
 *  7. Professional Rating rides on hand-added NPCs and moves morale (FR4.6);
 *  8. every die the copilot throws is on the record, inside the live session
 *     (G5/FR2.1/FR6.1) — quick-rolls AND the three pools of a chain.
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

/**
 * The same runner with a reflex trigger: +1 REA and one extra initiative die.
 * Reading `attributes.rea + attributes.int` off the sheet gives 9 and 1d6;
 * asking the engine gives 10 and 2d6. Original cyberware, original name.
 */
function wiredSheet(alias: string): SheetV1 {
  return sheetFor(alias, {
    augments: [
      {
        name: 'Reflex trigger, first grade',
        essence: 2,
        mods: [
          {
            id: 'reflex.rea',
            source: { kind: 'cyberware', ref: 'reflex trigger' },
            target: 'attr.rea',
            op: 'add',
            value: 1,
            active: true,
          },
          {
            id: 'reflex.dice',
            source: { kind: 'cyberware', ref: 'reflex trigger' },
            target: 'initiative.dice',
            op: 'add',
            value: 1,
            active: true,
          },
        ],
      },
    ],
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

describe('initiative starts the clock (FR4.3)', () => {
  it('rolling initiative on a fresh encounter sets turn 1 / pass 1', async () => {
    const id = await newEncounter('Cargo lift');
    const before = await gmJson('GET', `/api/encounters/${id}`);
    expect(before['encounter'].turn).toBe(0);
    expect(before['encounter'].pass).toBe(0);

    await gmJson('POST', `/api/encounters/${id}/combatants`, {
      source: 'manual',
      name: 'Runner',
      initBase: 9,
      initDice: 1,
      monitors: MONITORS,
    });
    const rolled = await gmJson('POST', `/api/encounters/${id}/roll-initiative`);
    expect(rolled['encounter'].turn).toBe(1);
    expect(rolled['encounter'].pass).toBe(1);

    // …and the tracker reads the same numbers back from the hydrate call.
    const view = await gmJson('GET', `/api/encounters/${id}`);
    expect(view['encounter'].turn).toBe(1);
    expect(view['encounter'].pass).toBe(1);
    // Documented mirrors so a client never has to guess where they live.
    expect(view['turn']).toBe(1);
    expect(view['pass']).toBe(1);
    expect(view['state']).toBe(view['encounter'].state);

    // A re-roll mid-turn does NOT rewind or advance the counters.
    await gmJson('POST', `/api/encounters/${id}/new-turn`);
    const reRolled = await gmJson('POST', `/api/encounters/${id}/roll-initiative`);
    expect(reRolled['encounter'].turn).toBe(2);
    expect(reRolled['encounter'].pass).toBe(1);
  });
});

describe('staged encounters keep augmented initiative (FR9.10 / FR4.2)', () => {
  it('derives the initiative line through the engine, not off the raw sheet', async () => {
    const scene = (
      await gmJson('POST', `/api/campaigns/${campaignId}/scenes`, { name: 'Sub-level parking' })
    )['scene'];
    const [wired] = await harness.db
      .insert(characters)
      .values({ campaignId, name: 'Volt', sheet: wiredSheet('Volt') })
      .returning();
    const [plain] = await harness.db
      .insert(characters)
      .values({ campaignId, name: 'Cinder', sheet: sheetFor('Cinder') })
      .returning();
    for (const c of [wired!, plain!]) {
      await gmJson('POST', `/api/scenes/${scene.id}/tokens`, {
        source: 'character',
        sourceId: c.id,
        name: c.name,
        x: 2,
        y: 2,
      });
    }

    const staged = await gmJson('POST', `/api/scenes/${scene.id}/stage-encounter`, {
      name: 'Parking ambush',
    });
    expect(staged['combatantIds']).toHaveLength(2);

    const view = await gmJson('GET', `/api/encounters/${staged['encounterId']}`);
    const rows = view['combatants'] as Array<{
      id: string;
      name: string;
      initBase: number;
      initDice: number;
      monitors: { physical: { max: number } };
    }>;
    const voltRow = rows.find((c) => c.name === 'Volt')!;
    const cinderRow = rows.find((c) => c.name === 'Cinder')!;
    // REA 5 (+1 cyber) + INT 4 = 10, and the extra initiative die survived.
    expect(voltRow.initBase).toBe(10);
    expect(voltRow.initDice).toBe(2);
    // The unaugmented runner is unchanged: REA 5 + INT 4, one die.
    expect(cinderRow.initBase).toBe(9);
    expect(cinderRow.initDice).toBe(1);
    expect(voltRow.monitors.physical.max).toBe(10);

    const rolled = await gmJson('POST', `/api/encounters/${staged['encounterId']}/roll-initiative`);
    const details = rolled['details'] as Array<{ combatantId: string; rolls: number[]; score: number }>;
    const voltDetail = details.find((d) => d.combatantId === voltRow.id)!;
    expect(voltDetail.rolls).toHaveLength(2);
    expect(voltDetail.score).toBeGreaterThanOrEqual(12);
    expect(voltDetail.score).toBeLessThanOrEqual(22);
    expect(details.find((d) => d.combatantId === cinderRow.id)!.rolls).toHaveLength(1);
    // Staging + rolling also starts the clock (FR4.3).
    expect(rolled['encounter'].turn).toBe(1);
    expect(rolled['encounter'].pass).toBe(1);
  });
});

describe('one authority per scene modifier (FR9.11 / Principle 3)', () => {
  it('does not apply the environment twice when the client re-sends it', async () => {
    const scene = (
      await gmJson('POST', `/api/campaigns/${campaignId}/scenes`, {
        name: 'Flooded stairwell',
        environment: { light: 2 },
      })
    )['scene'];
    const id = (
      await gmJson('POST', `/api/campaigns/${campaignId}/encounters`, {
        name: 'Stairwell contact',
        sceneId: scene.id,
      })
    )['encounter'].id as string;
    const combatant = (
      await gmJson('POST', `/api/encounters/${id}/combatants`, {
        source: 'generated',
        name: 'Waders',
        sheet: sheetFor('Waders'),
      })
    )['combatant'];

    const rack = await gmJson('GET', `/api/combatants/${combatant.id}/quick-rolls`);
    const defense = (rack['entries'] as Array<{ key: string; pool: number }>).find(
      (e) => e.key === 'defense',
    )!;
    // REA 5 + INT 4 − 3 (a single axis at level 2 ⇒ the −3 tier), server-derived.
    expect(defense.pool).toBe(6);
    const chip = (rack['sceneModifiers'] as Array<{ label: string; value: number }>)[0]!;
    expect(chip.value).toBe(-3);

    const rolled = await gmJson('POST', `/api/combatants/${combatant.id}/quick-roll`, {
      key: 'defense',
      extra: [{ label: chip.label, value: chip.value, source: 'scene' }],
    });
    expect(rolled['request'].pool).toBe(6);
    expect(rolled['result'].faces).toHaveLength(6);
    const sceneLines = (rolled['request'].breakdown as Array<{ source?: string }>).filter(
      (e) => e.source === 'scene',
    );
    expect(sceneLines).toHaveLength(1);
    expect(rolled['request'].meta.droppedSceneChips).toBe(1);

    // A GM's own situational chip still stacks — only `scene` is collapsed.
    const withChip = await gmJson('POST', `/api/combatants/${combatant.id}/quick-roll`, {
      key: 'defense',
      extra: [{ label: 'prone', value: -2, source: 'situational' }],
    });
    expect(withChip['request'].pool).toBe(4);
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

describe('professional rating on hand-added rows (FR4.6 / FR10.9)', () => {
  /** Knock the row's physical monitor out and hand back the morale report. */
  async function dropAndCheck(encounterId: string, combatantId: string) {
    const hit = await gmJson('POST', `/api/encounters/${encounterId}/damage`, {
      targetId: combatantId,
      boxes: 10,
      track: 'physical',
    });
    return hit['morale'] as { threshold: number; pressure: number; suggestion: string } | null;
  }

  it('stores PR on any NPC row and measures morale against it', async () => {
    const veteranId = await newEncounter('Skybridge — veterans');
    const veteran = (
      await gmJson('POST', `/api/encounters/${veteranId}/combatants`, {
        source: 'generated',
        name: 'Corp sergeant',
        monitors: MONITORS,
        professionalRating: 4,
      })
    )['combatant'];
    expect(veteran.copilot.generator.professionalRating).toBe(4);

    const amateurId = await newEncounter('Skybridge — amateurs');
    const amateur = (
      await gmJson('POST', `/api/encounters/${amateurId}/combatants`, {
        source: 'generated',
        name: 'Street lookout',
        monitors: MONITORS,
      })
    )['combatant'];
    expect(amateur.copilot.generator.professionalRating).toBe(0);

    // Identical pressure (first casualty + half strength = 4), opposite calls.
    const veteranMorale = await dropAndCheck(veteranId, veteran.id);
    const amateurMorale = await dropAndCheck(amateurId, amateur.id);
    expect(veteranMorale?.pressure).toBe(4);
    expect(veteranMorale?.threshold).toBe(4);
    expect(veteranMorale?.suggestion).toBe('fight_on');
    expect(amateurMorale?.pressure).toBe(4);
    expect(amateurMorale?.threshold).toBe(0);
    expect(amateurMorale?.suggestion).toBe('cut_and_run');
  });

  it('takes PR for a grunt group from either spelling, and lets the GM fix it', async () => {
    const id = await newEncounter('Loading ramp');
    const squad = (
      await gmJson('POST', `/api/encounters/${id}/combatants`, {
        source: 'grunt_group',
        name: 'Ramp crew',
        monitors: MONITORS,
        professionalRating: 2,
        grunt: { size: 4 },
      })
    )['combatant'];
    expect(squad.grunt.professionalRating).toBe(2);
    expect(squad.copilot.generator.professionalRating).toBe(2);

    const patched = (
      await gmJson('PATCH', `/api/combatants/${squad.id}`, { professionalRating: 5 })
    )['combatant'];
    expect(patched.grunt.professionalRating).toBe(5);
    expect(patched.copilot.generator.professionalRating).toBe(5);
  });

  it('never stamps a PR onto a linked PC row', async () => {
    const id = await newEncounter('Safe corridor');
    const [character] = await harness.db
      .insert(characters)
      .values({ campaignId, name: 'Meridian', sheet: sheetFor('Meridian') })
      .returning();
    const pc = (
      await gmJson('POST', `/api/encounters/${id}/combatants`, {
        source: 'character',
        sourceId: character!.id,
        professionalRating: 6,
      })
    )['combatant'];
    expect(pc.copilot.generator).toBeUndefined();
  });
});

describe('the copilot writes to the record (G5 / FR2.1 / FR6.1)', () => {
  it('persists chain dice and stamps the live session onto every copilot roll', async () => {
    const session = (
      await gmJson('POST', `/api/campaigns/${campaignId}/sessions/start`, { date: '2081-04-02' })
    )['session'];
    const id = await newEncounter('Sub-basement exchange');

    const [character] = await harness.db
      .insert(characters)
      .values({ campaignId, name: 'Rivet', sheet: sheetFor('Rivet') })
      .returning();
    const defender = (
      await gmJson('POST', `/api/encounters/${id}/combatants`, {
        source: 'character',
        sourceId: character!.id,
      })
    )['combatant'];
    const attacker = (
      await gmJson('POST', `/api/encounters/${id}/combatants`, {
        source: 'generated',
        name: 'Breaker',
        sheet: sheetFor('Breaker'),
        professionalRating: 3,
      })
    )['combatant'];

    const chain = await gmJson('POST', `/api/encounters/${id}/resolve-chain`, {
      attackerId: attacker.id,
      defenderId: defender.id,
      weaponId: 'snub pistol',
    });
    expect(chain['committed']).toBe(false);
    expect(chain['chainId']).toBeTruthy();
    const chainRolls = chain['rolls'] as Array<{ step: string; rollId: string }>;
    // Attack and defence always; soak only when the shot connected.
    expect(chainRolls.map((r) => r.step).slice(0, 2)).toEqual(['attack', 'defense']);
    expect(chainRolls.length).toBe(chain['suggested'] === null ? 2 : 3);

    const quick = await gmJson('POST', `/api/combatants/${defender.id}/quick-roll`, {
      key: 'defense',
    });
    const mine = [...chainRolls.map((r) => r.rollId), quick['rollId'] as string];

    // Every one of them is a real row, in this session, at gm visibility for
    // the chain (behind-the-screen dice never become public, FR2.7).
    const page = await gmJson('GET', `/api/campaigns/${campaignId}/rolls?limit=200`);
    const byId = new Map(
      (page['rolls'] as Array<Record<string, any>>).map((r) => [r['id'] as string, r]),
    );
    for (const rollId of mine) {
      const row = byId.get(rollId);
      expect(row, `roll ${rollId} is missing from the log`).toBeDefined();
      expect(row!['sessionId']).toBe(session.id);
    }
    for (const { rollId, step } of chainRolls) {
      const row = byId.get(rollId)!;
      expect(row['visibility']).toBe('gm');
      expect(row['request'].meta.chainId).toBe(chain['chainId']);
      expect(row['request'].meta.step).toBe(step);
      expect(row['faces'].length).toBe(row['request'].pool);
    }

    // …so the session query and the housekeeping summary both count them.
    const scoped = await gmJson(
      'GET',
      `/api/campaigns/${campaignId}/rolls?limit=200&session=${session.id}`,
    );
    const scopedIds = new Set((scoped['rolls'] as Array<{ id: string }>).map((r) => r.id));
    for (const rollId of mine) expect(scopedIds.has(rollId)).toBe(true);
    const house = await gmJson('GET', `/api/sessions/${session.id}/housekeeping`);
    expect(house['housekeeping'].rolls.total).toBeGreaterThanOrEqual(mine.length);

    // Principle 4: a player's log never carries the GM-side chain dice.
    const player = await joinAs(app, campaignId, gmToken, 'player', 'Nyx');
    const playerPage = (
      await call('GET', `/api/campaigns/${campaignId}/rolls?limit=200`, player.token)
    ).json() as Record<string, any>;
    const playerIds = new Set((playerPage['rolls'] as Array<{ id: string }>).map((r) => r.id));
    for (const { rollId } of chainRolls) expect(playerIds.has(rollId)).toBe(false);

    await gmJson('POST', `/api/sessions/${session.id}/end`);
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

  /**
   * The table TV puts the acting glow and the coarse condition bar on a token
   * (FR4.10/FR9.20). Without `tokenId` on the filtered view it had to match on
   * display name — which two gangers called "Ganger" break instantly.
   *
   * This adds no secret: a row only reaches this list because it is public or
   * the viewer's own, and that token is already on the socket. A GM-hidden
   * combatant is dropped whole, token id included.
   */
  it('carries the token id on visible rows, and none for a hidden one', async () => {
    const id = await newEncounter('Catwalk');
    const player = await joinAs(app, campaignId, gmToken, 'player', 'Kestrel');
    const scene = (await gmJson('POST', `/api/campaigns/${campaignId}/scenes`, { name: 'Catwalk' }))[
      'scene'
    ];
    const token = (
      await gmJson('POST', `/api/scenes/${scene.id}/tokens`, {
        source: 'prop',
        name: 'Drone',
        x: 2,
        y: 2,
      })
    )['token'];
    const visible = (
      await gmJson('POST', `/api/encounters/${id}/combatants`, {
        source: 'generated',
        name: 'Drone',
        visibility: 'public',
        tokenId: token.id,
        monitors: MONITORS,
        sheet: sheetFor('Drone'),
      })
    )['combatant'];
    const hiddenToken = (
      await gmJson('POST', `/api/scenes/${scene.id}/tokens`, {
        source: 'prop',
        name: 'Sniper nest',
        x: 30,
        y: 30,
        hidden: true,
      })
    )['token'];
    await gmJson('POST', `/api/encounters/${id}/combatants`, {
      source: 'generated',
      name: 'Sniper',
      visibility: 'gm',
      tokenId: hiddenToken.id,
      monitors: MONITORS,
      sheet: sheetFor('Sniper'),
    });

    const res = await call('GET', `/api/encounters/${id}`, player.token);
    const view = res.json() as Record<string, any>;
    const row = view['combatants'].find((c: { id: string }) => c.id === visible.id);
    expect(row.tokenId).toBe(token.id);
    expect(res.body).not.toContain(hiddenToken.id);
    expect(res.body).not.toContain('Sniper');
  });
});
