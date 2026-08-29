/**
 * The magic toolkit's server half (M8): the spirit tracker (FR8.3), a spirit
 * joining an encounter as a Force-derived combatant, the spirit-sustaining
 * exemption (FR8.2), bonded foci as toggled modifier sources and the reagent
 * counter (FR8.4).
 *
 * Every character and spirit here is original content (§14) — the "offsets"
 * are numbers a GM would type off their own book, not a shipped table.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { desc, eq } from 'drizzle-orm';
import { wsEvents } from '@safehouse/db';
import {
  bootstrapCampaign,
  joinAs,
  makeTestApp,
  type BootstrapResult,
  type JoinResult,
  type TestApp,
} from './core-helpers.js';

let t: TestApp;
let boot: BootstrapResult;
let player: JoinResult;
let mageId: string;
let encounterId: string;
let spiritId: string;

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

const MAGE_SHEET = {
  v: 1,
  identity: { alias: 'Static', metatype: 'human', portraitId: null },
  attributes: {
    bod: 3, agi: 3, rea: 4, str: 2, wil: 5, log: 4, int: 5, cha: 4,
    edg: { max: 3, current: 3 }, ess: 6, mag: 6, res: 0,
  },
  skills: [
    { id: 'spellcasting', rating: 6, attr: 'mag' },
    { id: 'perception', rating: 3, attr: 'int' },
  ],
  spells: [{ name: 'Static’s own wall' }],
};

/** The Force-6 spirit the summoner keeps calling on. */
const SPIRIT = {
  spiritType: 'wind',
  name: 'Nine-Tenths',
  force: 6,
  services: 3,
  attributeOffsets: { bod: -2, agi: 3, rea: 4, str: -3 },
  skills: [{ id: 'unarmed combat', attr: 'agi' }],
  initiativeDice: 2,
};

async function magicState(token: string) {
  const res = await t.app.inject({
    method: 'GET',
    url: `/api/campaigns/${boot.campaignId}/magic`,
    headers: auth(token),
  });
  expect(res.statusCode).toBe(200);
  return res.json() as {
    spirits: Array<Record<string, unknown>>;
    foci: Array<Record<string, unknown>>;
    reagents: Record<string, number>;
    scope: string;
  };
}

async function magicDerived(token = player.token) {
  const res = await t.app.inject({
    method: 'GET',
    url: `/api/characters/${mageId}/magic/derived`,
    headers: auth(token),
  });
  expect(res.statusCode).toBe(200);
  return res.json() as {
    derived: { pools: Record<string, { total: number; breakdown: Array<{ label: string; value: number; source: string }> }> };
    focusModifiers: Array<Record<string, unknown>>;
    sustaining: { penalty: number; selfSustained: number; lines: Array<Record<string, unknown>> };
    reagents: number;
    spirits: Array<Record<string, unknown>>;
    foci: Array<Record<string, unknown>>;
  };
}

const spellPool = (view: Awaited<ReturnType<typeof magicDerived>>) =>
  view.derived.pools['skill.spellcasting']!.total;

beforeAll(async () => {
  t = await makeTestApp('magic');
  boot = await bootstrapCampaign(t.app, 'Ash & Static');
  player = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Static');

  const created = await t.app.inject({
    method: 'POST',
    url: '/api/characters',
    headers: auth(boot.gmToken),
    payload: {
      campaignId: boot.campaignId,
      name: 'Static',
      ownerUserId: player.user.id,
      sheet: MAGE_SHEET,
    },
  });
  if (created.statusCode !== 201) throw new Error(`character create failed: ${created.body}`);
  mageId = (created.json() as { character: { id: string } }).character.id;

  const enc = await t.app.inject({
    method: 'POST',
    url: `/api/campaigns/${boot.campaignId}/encounters`,
    headers: auth(boot.gmToken),
    payload: { name: 'Rooftop' },
  });
  if (enc.statusCode !== 201) throw new Error(`encounter create failed: ${enc.body}`);
  encounterId = (enc.json() as { encounter: { id: string } }).encounter.id;
}, 120_000);

afterAll(async () => {
  await t.close();
}, 60_000);

// ---------------------------------------------------------------------------
// Spirits (FR8.3)
// ---------------------------------------------------------------------------

describe('spirit tracker (FR8.3)', () => {
  it('summons a spirit for its summoner, with Force-derived stats attached', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/campaigns/${boot.campaignId}/magic/spirits`,
      headers: auth(player.token),
      payload: { ...SPIRIT, characterId: mageId },
    });
    expect(res.statusCode).toBe(201);
    const out = res.json() as {
      spirit: { id: string; force: number; services: number; servicesInitial: number; bound: boolean; status: string };
      derived: { initiative: { physical: { base: { value: number }; dice: { value: number } } }; monitors: { physical: { value: number }; stun: { value: number } } };
    };
    spiritId = out.spirit.id;
    expect(out.spirit).toMatchObject({ force: 6, services: 3, servicesInitial: 3, status: 'summoned' });
    // REA (6+4) + INT (6) = 16 on 2d6; monitors 8+⌈BOD/2⌉ with BOD 4.
    expect(out.derived.initiative.physical.base.value).toBe(16);
    expect(out.derived.initiative.physical.dice.value).toBe(2);
    expect(out.derived.monitors.physical.value).toBe(10);
    expect(out.derived.monitors.stun.value).toBe(11);
  });

  it('shows up in the campaign tracker with services remaining', async () => {
    const state = await magicState(player.token);
    expect(state.spirits).toHaveLength(1);
    expect(state.spirits[0]).toMatchObject({ id: spiritId, name: 'Nine-Tenths', services: 3 });
  });

  it('spends a service with one tap and logs it', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/campaigns/${boot.campaignId}/magic/spirits/${spiritId}/services`,
      headers: auth(player.token),
      payload: { op: 'spend', reason: 'scouted the roof' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ spent: 1, remaining: 2, shortfall: 0, exhausted: false });

    const rows = await t.db
      .select()
      .from(wsEvents)
      .where(eq(wsEvents.type, 'magic.updated'))
      .orderBy(desc(wsEvents.id))
      .limit(1);
    expect(rows).toHaveLength(1);
    const payload = rows[0]!.payload as { op: string; spent: number; reason: string };
    expect(payload.op).toBe('spirit.service.spend');
    expect(payload.spent).toBe(1);
    expect(payload.reason).toBe('scouted the roof');
  });

  it('floors the counter at zero and reports the shortfall', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/campaigns/${boot.campaignId}/magic/spirits/${spiritId}/services`,
      headers: auth(player.token),
      payload: { op: 'spend', count: 5 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ spent: 2, remaining: 0, shortfall: 3, exhausted: true });

    // And again on an empty spirit — still zero, never negative.
    const again = await t.app.inject({
      method: 'POST',
      url: `/api/campaigns/${boot.campaignId}/magic/spirits/${spiritId}/services`,
      headers: auth(player.token),
      payload: { op: 'spend', count: 2 },
    });
    expect(again.json()).toMatchObject({ spent: 0, remaining: 0, shortfall: 2 });
    expect((await magicState(player.token)).spirits[0]!['services']).toBe(0);
  });

  it('binds and re-stocks services through the GM patch + grant path', async () => {
    const bound = await t.app.inject({
      method: 'PATCH',
      url: `/api/campaigns/${boot.campaignId}/magic/spirits/${spiritId}`,
      headers: auth(boot.gmToken),
      payload: { bound: true },
    });
    expect(bound.statusCode).toBe(200);
    expect((bound.json() as { spirit: { bound: boolean } }).spirit.bound).toBe(true);

    const granted = await t.app.inject({
      method: 'POST',
      url: `/api/campaigns/${boot.campaignId}/magic/spirits/${spiritId}/services`,
      headers: auth(boot.gmToken),
      payload: { op: 'grant', count: 4 },
    });
    expect(granted.json()).toMatchObject({ remaining: 4 });
  });

  it('re-derives when the GM changes Force (Principle 2)', async () => {
    const res = await t.app.inject({
      method: 'PATCH',
      url: `/api/campaigns/${boot.campaignId}/magic/spirits/${spiritId}`,
      headers: auth(boot.gmToken),
      payload: { force: 8 },
    });
    const out = res.json() as { derived: { initiative: { physical: { base: { value: number } } } } };
    // REA (8+4) + INT (8) = 20.
    expect(out.derived.initiative.physical.base.value).toBe(20);
    await t.app.inject({
      method: 'PATCH',
      url: `/api/campaigns/${boot.campaignId}/magic/spirits/${spiritId}`,
      headers: auth(boot.gmToken),
      payload: { force: 6 },
    });
  });
});

// ---------------------------------------------------------------------------
// A spirit in the fight (FR8.3 → M4)
// ---------------------------------------------------------------------------

describe('a spirit joins an encounter as a combatant', () => {
  it('lands on the tracker with Force-derived initiative, dice and monitors', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/campaigns/${boot.campaignId}/magic/spirits/${spiritId}/join`,
      headers: auth(boot.gmToken),
      payload: { encounterId },
    });
    expect(res.statusCode).toBe(201);
    const out = res.json() as {
      spirit: { combatantId: string; encounterId: string };
      combatant: {
        id: string;
        name: string;
        initBase: number;
        initDice: number;
        initKind: string;
        monitors: { physical: { max: number }; stun: { max: number }; overflow: { max: number } };
        visibility: string;
      };
    };
    expect(out.combatant.name).toBe('Nine-Tenths');
    expect(out.combatant.initBase).toBe(16);
    expect(out.combatant.initDice).toBe(2);
    expect(out.combatant.initKind).toBe('physical');
    expect(out.combatant.monitors.physical.max).toBe(10);
    expect(out.combatant.monitors.stun.max).toBe(11);
    expect(out.combatant.monitors.overflow.max).toBe(4);
    // A summoned spirit is public — the table can see the thing it called up.
    expect(out.combatant.visibility).toBe('public');
    expect(out.spirit.combatantId).toBe(out.combatant.id);
    expect(out.spirit.encounterId).toBe(encounterId);
  });

  it('is a real row on the encounter, with the engine’s pools behind it', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/encounters/${encounterId}`,
      headers: auth(boot.gmToken),
    });
    expect(res.statusCode).toBe(200);
    const view = res.json() as {
      combatants: Array<{ name: string; initBase: number; copilot: { sheet?: { attributes: Record<string, unknown> } } }>;
    };
    const row = view.combatants.find((c) => c.name === 'Nine-Tenths');
    expect(row).toBeDefined();
    expect(row!.initBase).toBe(16);
    // The snapshot really is a SheetV1: Force 6 with the GM's offsets applied.
    expect(row!.copilot.sheet?.attributes).toMatchObject({ bod: 4, agi: 9, rea: 10, str: 3, mag: 6 });
  });

  it('refuses to put a dismissed spirit in a fight', async () => {
    const second = await t.app.inject({
      method: 'POST',
      url: `/api/campaigns/${boot.campaignId}/magic/spirits`,
      headers: auth(boot.gmToken),
      payload: { ...SPIRIT, name: 'Gone', characterId: mageId },
    });
    const goneId = (second.json() as { spirit: { id: string } }).spirit.id;
    await t.app.inject({
      method: 'POST',
      url: `/api/campaigns/${boot.campaignId}/magic/spirits/${goneId}/dismiss`,
      headers: auth(boot.gmToken),
    });
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/campaigns/${boot.campaignId}/magic/spirits/${goneId}/join`,
      headers: auth(boot.gmToken),
      payload: { encounterId },
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe('spirit_dismissed');
  });
});

// ---------------------------------------------------------------------------
// Spirit-sustaining exemption (FR8.2 × FR8.3)
// ---------------------------------------------------------------------------

describe('a spirit sustaining for the caster (FR8.2)', () => {
  let sustainedId: string;

  it('starts with the caster eating the −2', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/characters/${mageId}/sustained`,
      headers: auth(player.token),
      payload: { op: 'add', name: 'Static’s own wall' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { sustained: Array<{ id: string; exempt: boolean }> };
    sustainedId = body.sustained[0]!.id;
    expect(body.sustained[0]!.exempt).toBe(false);

    const view = await magicDerived();
    expect(view.sustaining.penalty).toBe(-2);
    expect(view.sustaining.selfSustained).toBe(1);
    expect(spellPool(view)).toBe(10); // MAG 6 + rating 6 − 2
  });

  it('lifts the −2 when a spirit takes the spell, and says who is holding it', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/campaigns/${boot.campaignId}/magic/spirits/${spiritId}/sustain`,
      headers: auth(player.token),
      payload: { sustainedId },
    });
    expect(res.statusCode).toBe(200);
    const out = res.json() as {
      spirit: { sustainingSpellId: string };
      derived: { sustaining: { penalty: number; lines: Array<{ exemptBy: string | null; spiritName: string | null }> } };
    };
    expect(out.spirit.sustainingSpellId).toBe(sustainedId);
    expect(out.derived.sustaining.penalty).toBe(0);
    expect(out.derived.sustaining.lines[0]).toMatchObject({
      exemptBy: 'spirit',
      spiritName: 'Nine-Tenths',
    });

    // And the character's OWN derived view agrees — same `exempt` toggle FR8.2
    // already used for foci and quickenings, so nothing had to learn a new rule.
    const own = await t.app.inject({
      method: 'GET',
      url: `/api/characters/${mageId}/derived`,
      headers: auth(player.token),
    });
    const derived = own.json() as {
      sustained: Array<{ exempt: boolean }>;
      derived: { pools: Record<string, { total: number }> };
    };
    expect(derived.sustained[0]!.exempt).toBe(true);
    expect(derived.derived.pools['skill.spellcasting']!.total).toBe(12);
    expect(spellPool(await magicDerived())).toBe(12);
  });

  it('hands the spell back when the spirit is released', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/campaigns/${boot.campaignId}/magic/spirits/${spiritId}/sustain`,
      headers: auth(player.token),
      payload: { sustainedId: null },
    });
    expect(res.statusCode).toBe(200);
    const view = await magicDerived();
    expect(view.sustaining.penalty).toBe(-2);
    expect(spellPool(view)).toBe(10);
  });

  it('hands it back on dismissal too', async () => {
    await t.app.inject({
      method: 'POST',
      url: `/api/campaigns/${boot.campaignId}/magic/spirits/${spiritId}/sustain`,
      headers: auth(player.token),
      payload: { sustainedId },
    });
    expect((await magicDerived()).sustaining.penalty).toBe(0);

    const res = await t.app.inject({
      method: 'POST',
      url: `/api/campaigns/${boot.campaignId}/magic/spirits/${spiritId}/dismiss`,
      headers: auth(player.token),
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { spirit: { status: string } }).spirit.status).toBe('dismissed');
    const view = await magicDerived();
    expect(view.sustaining.penalty).toBe(-2);
    expect(spellPool(view)).toBe(10);
  });

  it('releases the spell when the GM dismisses it through a plain PATCH too', async () => {
    const summoned = await t.app.inject({
      method: 'POST',
      url: `/api/campaigns/${boot.campaignId}/magic/spirits`,
      headers: auth(player.token),
      payload: { ...SPIRIT, name: 'Understudy', characterId: mageId },
    });
    const id = (summoned.json() as { spirit: { id: string } }).spirit.id;
    await t.app.inject({
      method: 'POST',
      url: `/api/campaigns/${boot.campaignId}/magic/spirits/${id}/sustain`,
      headers: auth(player.token),
      payload: { sustainedId },
    });
    expect((await magicDerived()).sustaining.penalty).toBe(0);

    const res = await t.app.inject({
      method: 'PATCH',
      url: `/api/campaigns/${boot.campaignId}/magic/spirits/${id}`,
      headers: auth(boot.gmToken),
      payload: { status: 'dismissed', note: 'sent home' },
    });
    expect(res.statusCode).toBe(200);
    const spirit = (res.json() as { spirit: { status: string; note: string; sustainingSpellId: string | null } }).spirit;
    expect(spirit).toMatchObject({ status: 'dismissed', note: 'sent home', sustainingSpellId: null });
    // The caster picks the −2 straight back up, on both derive paths.
    expect((await magicDerived()).sustaining.penalty).toBe(-2);
    const own = await t.app.inject({
      method: 'GET',
      url: `/api/characters/${mageId}/derived`,
      headers: auth(player.token),
    });
    expect((own.json() as { sustained: Array<{ exempt: boolean }> }).sustained[0]!.exempt).toBe(false);
  });

  it('refuses to sustain a spell the caster is not holding', async () => {
    const summoned = await t.app.inject({
      method: 'POST',
      url: `/api/campaigns/${boot.campaignId}/magic/spirits`,
      headers: auth(player.token),
      payload: { ...SPIRIT, name: 'Second Wind', characterId: mageId },
    });
    const id = (summoned.json() as { spirit: { id: string } }).spirit.id;
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/campaigns/${boot.campaignId}/magic/spirits/${id}/sustain`,
      headers: auth(player.token),
      payload: { sustainedId: 'no-such-spell' },
    });
    expect(res.statusCode).toBe(404);
    // Clear the caster's own sustaining so later suites start from zero.
    await t.app.inject({
      method: 'POST',
      url: `/api/characters/${mageId}/sustained`,
      headers: auth(player.token),
      payload: { op: 'clear' },
    });
    expect((await magicDerived()).sustaining.penalty).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Foci (FR8.4)
// ---------------------------------------------------------------------------

describe('bonded foci as toggled modifier sources (FR8.4)', () => {
  let focusId: string;

  it('adds a bonded focus that is not switched on — the pool does not move', async () => {
    const before = spellPool(await magicDerived());
    expect(before).toBe(12);
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/characters/${mageId}/foci`,
      headers: auth(player.token),
      payload: {
        name: 'Riverstone',
        kind: 'power focus',
        force: 3,
        bonded: true,
        active: false,
        targets: ['pool.skill.spellcasting'],
      },
    });
    expect(res.statusCode).toBe(201);
    const out = res.json() as {
      focus: { id: string; bonded: boolean; active: boolean };
      derived: { derived: { pools: Record<string, { total: number }> }; focusModifiers: unknown[] };
    };
    focusId = out.focus.id;
    expect(out.derived.focusModifiers).toHaveLength(0);
    expect(out.derived.derived.pools['skill.spellcasting']!.total).toBe(12);
  });

  it('changes the derived pool the moment it is toggled on, with provenance', async () => {
    const res = await t.app.inject({
      method: 'PATCH',
      url: `/api/characters/${mageId}/foci/${focusId}`,
      headers: auth(player.token),
      payload: { active: true },
    });
    expect(res.statusCode).toBe(200);
    const view = await magicDerived();
    expect(spellPool(view)).toBe(15);
    const pool = view.derived.pools['skill.spellcasting']!;
    const line = pool.breakdown.find((b) => b.source === 'power' && b.value === 3);
    expect(line).toBeDefined();
    expect(line!.label).toContain('Riverstone');
    // The receipt still sums exactly to the total (Principle 3).
    expect(pool.breakdown.reduce((s, b) => s + b.value, 0)).toBe(pool.total);
    expect(view.focusModifiers).toHaveLength(1);
  });

  it('goes inert the moment it is unbonded, however switched-on it looks', async () => {
    await t.app.inject({
      method: 'PATCH',
      url: `/api/characters/${mageId}/foci/${focusId}`,
      headers: auth(player.token),
      payload: { bonded: false },
    });
    const view = await magicDerived();
    expect(spellPool(view)).toBe(12);
    expect(view.foci[0]).toMatchObject({ bonded: false, active: true });
    expect(view.focusModifiers).toHaveLength(0);
  });

  it('stacks a second live focus and removes cleanly', async () => {
    await t.app.inject({
      method: 'PATCH',
      url: `/api/characters/${mageId}/foci/${focusId}`,
      headers: auth(player.token),
      payload: { bonded: true },
    });
    const second = await t.app.inject({
      method: 'POST',
      url: `/api/characters/${mageId}/foci`,
      headers: auth(player.token),
      payload: {
        name: 'Cold iron band',
        force: 2,
        bonded: true,
        active: true,
        sourceKind: 'spell',
        targets: ['pool.skill.spellcasting'],
      },
    });
    const secondId = (second.json() as { focus: { id: string } }).focus.id;
    expect(spellPool(await magicDerived())).toBe(17);

    const removed = await t.app.inject({
      method: 'DELETE',
      url: `/api/characters/${mageId}/foci/${secondId}`,
      headers: auth(player.token),
    });
    expect(removed.statusCode).toBe(200);
    expect(spellPool(await magicDerived())).toBe(15);
  });

  it('moves the plain derived view and a real roll too, not just the Magic tab', async () => {
    // The seam this closes: `/derived` and the roll path used to compose
    // `situational` from the scene plus sustaining only, so a live focus moved
    // the Magic tab's number and neither of the other two. One composer now
    // answers all three (services/magic-derive.ts).
    const plain = await t.app.inject({
      method: 'GET',
      url: `/api/characters/${mageId}/derived`,
      headers: auth(player.token),
    });
    expect(plain.statusCode).toBe(200);
    const view = plain.json() as {
      derived: { pools: Record<string, { total: number; breakdown: Array<{ label: string; value: number; source: string }> }> };
      situational: Array<{ id: string; source: { kind: string }; note?: string }>;
    };
    expect(view.derived.pools['skill.spellcasting']!.total).toBe(spellPool(await magicDerived()));
    expect(view.derived.pools['skill.spellcasting']!.total).toBe(15);
    // Provenance, not just the total (Principle 3).
    const receipt = view.derived.pools['skill.spellcasting']!.breakdown.find((b) =>
      b.label.includes('Riverstone'),
    );
    expect(receipt).toMatchObject({ value: 3, source: 'power' });
    expect(view.situational.some((m) => m.id.includes(focusId))).toBe(true);

    // …and the server's authoritative recompute agrees, so the dice actually
    // rolled reflect the focus the mage switched on (FR2.6).
    const rolled = await t.app.inject({
      method: 'POST',
      url: '/api/rolls',
      headers: auth(player.token),
      payload: {
        kind: 'simple',
        pool: 1,
        breakdown: [{ label: 'client guess', value: 1 }],
        actor: { characterId: mageId },
        meta: { poolRef: 'skill.spellcasting' },
      },
    });
    expect(rolled.statusCode).toBe(201);
    const roll = (rolled.json() as { roll: Record<string, unknown> }).roll;
    const request = roll['request'] as {
      pool: number;
      breakdown: Array<{ label: string; value: number }>;
    };
    expect(request.pool).toBe(15);
    expect((roll['faces'] as number[]).length).toBe(15);
    expect(request.breakdown.some((b) => b.label.includes('Riverstone'))).toBe(true);
  });

  it('is the owner’s or the GM’s to touch, nobody else’s', async () => {
    const other = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Rivet');
    const res = await t.app.inject({
      method: 'PATCH',
      url: `/api/characters/${mageId}/foci/${focusId}`,
      headers: auth(other.token),
      payload: { active: false },
    });
    expect(res.statusCode).toBe(403);
    // Reading the rack is fine for a table-mate; writing is not.
    const read = await t.app.inject({
      method: 'GET',
      url: `/api/characters/${mageId}/foci`,
      headers: auth(other.token),
    });
    expect(read.statusCode).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Reagents (FR8.4)
// ---------------------------------------------------------------------------

describe('reagent counter (FR8.4)', () => {
  it('restocks, spends, and reports the count', async () => {
    const stocked = await t.app.inject({
      method: 'POST',
      url: `/api/characters/${mageId}/reagents`,
      headers: auth(player.token),
      payload: { op: 'restock', amount: 20 },
    });
    expect(stocked.statusCode).toBe(200);
    expect(stocked.json()).toMatchObject({ before: 0, after: 20, shortfall: 0 });

    const spent = await t.app.inject({
      method: 'POST',
      url: `/api/characters/${mageId}/reagents`,
      headers: auth(player.token),
      payload: { op: 'spend', amount: 6 },
    });
    expect(spent.json()).toMatchObject({ before: 20, after: 14 });
    expect((await magicDerived()).reagents).toBe(14);
  });

  it('cannot go negative', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/characters/${mageId}/reagents`,
      headers: auth(player.token),
      payload: { op: 'spend', amount: 99 },
    });
    expect(res.json()).toMatchObject({ before: 14, after: 0, shortfall: 85 });

    const again = await t.app.inject({
      method: 'POST',
      url: `/api/characters/${mageId}/reagents`,
      headers: auth(player.token),
      payload: { op: 'spend', amount: 5 },
    });
    expect(again.json()).toMatchObject({ before: 0, after: 0, shortfall: 5 });
    expect((await magicState(player.token)).reagents[mageId]).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Principle 4: hidden state filtered SERVER-SIDE
// ---------------------------------------------------------------------------

describe('GM-side spirits never reach a player (Principle 4)', () => {
  let hiddenId: string;

  it('summons an unowned spirit as the GM', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/campaigns/${boot.campaignId}/magic/spirits`,
      headers: auth(boot.gmToken),
      payload: { spiritType: 'something in the vents', force: 9, services: 2 },
    });
    expect(res.statusCode).toBe(201);
    hiddenId = (res.json() as { spirit: { id: string; characterId: string | null } }).spirit.id;
  });

  it('is absent from the player’s tracker but present in the GM’s', async () => {
    const asPlayer = await magicState(player.token);
    const asGm = await magicState(boot.gmToken);
    expect(asPlayer.spirits.some((s) => s['id'] === hiddenId)).toBe(false);
    expect(asGm.spirits.some((s) => s['id'] === hiddenId)).toBe(true);
    expect(asPlayer.scope).toBe('player');
  });

  it('404s rather than 403s for a player — its existence is not confirmed', async () => {
    for (const url of [
      `/api/campaigns/${boot.campaignId}/magic/spirits/${hiddenId}/derived`,
      `/api/campaigns/${boot.campaignId}/magic/spirits/${hiddenId}/services`,
    ]) {
      const res = await t.app.inject({
        method: url.endsWith('derived') ? 'GET' : 'POST',
        url,
        headers: auth(player.token),
        payload: { op: 'spend' },
      });
      expect(res.statusCode).toBe(404);
    }
  });

  it('refuses a player summoning a spirit with no owner', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/campaigns/${boot.campaignId}/magic/spirits`,
      headers: auth(player.token),
      payload: { spiritType: 'ambition', force: 4 },
    });
    expect(res.statusCode).toBe(403);
  });

  it('refuses a device asking about a campaign it is not bound to', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: '/api/campaigns/00000000-0000-0000-0000-000000000000/magic',
      headers: auth(boot.gmToken),
    });
    expect(res.statusCode).toBe(403);
  });

  it('refuses an unauthenticated read outright', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/campaigns/${boot.campaignId}/magic`,
    });
    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// The Fixer's read surface
// ---------------------------------------------------------------------------

describe('GET /api/campaigns/:id/magic/tracker (FR12.17 shape)', () => {
  it('reports spirits, foci and reagents as tracked facts, named', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/campaigns/${boot.campaignId}/magic/tracker`,
      headers: auth(boot.gmToken),
    });
    expect(res.statusCode).toBe(200);
    const out = res.json() as {
      spirits: Array<{ name: string; force: number; services: number; characterName: string | null }>;
      foci: Array<{ name: string; characterName: string | null; bonded: boolean }>;
      reagents: Array<{ characterName: string | null; drams: number }>;
    };
    const nineTenths = out.spirits.find((s) => s.name === 'Nine-Tenths');
    expect(nineTenths).toMatchObject({ force: 6, characterName: 'Static' });
    expect(out.foci.find((f) => f.name === 'Riverstone')).toMatchObject({
      characterName: 'Static',
      bonded: true,
    });
    expect(out.reagents.find((r) => r.characterName === 'Static')?.drams).toBe(0);
  });

  it('is the GM’s alone', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/campaigns/${boot.campaignId}/magic/tracker`,
      headers: auth(player.token),
    });
    expect(res.statusCode).toBe(403);
  });
});
