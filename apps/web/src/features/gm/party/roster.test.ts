/**
 * The party roster's arithmetic, with no React and no network.
 *
 * What must not regress:
 *
 *   1. one REST body — the list route's `characterDto` — is enough to build a
 *      complete row (LIVE-1: no WebSocket may be required to see the party);
 *   2. applying damage moves the monitor AND the wound modifier it implies;
 *   3. karma/nuyen only ever move as ledger entries (FR3.6);
 *   4. a row never claims a locally-derived pool is the server's (Principle 3);
 *   5. who holds a sheet is read from REST, and presence only refines it.
 */
import { describe, expect, it } from 'vitest';
import type { SheetV1 } from '@safehouse/contracts';
import { SheetV1Schema } from '@safehouse/contracts';
import { deriveCharacter } from '@safehouse/rules';
import {
  awardBody,
  awardIsValid,
  deviceFor,
  formatNuyen,
  isReachable,
  nextFilled,
  normalizeDerived,
  normalizeMember,
  partyTotals,
  signed,
  sortMembers,
  tokenFor,
  vitalsFor,
  withAward,
  withDamage,
  type PartyMember,
} from './roster.js';

function sheet(over: Partial<Record<string, unknown>> = {}): SheetV1 {
  return SheetV1Schema.parse({
    v: 1,
    identity: { alias: 'Torque', metatype: 'ork' },
    attributes: {
      bod: 6,
      agi: 4,
      rea: 4,
      str: 6,
      wil: 4,
      log: 2,
      int: 4,
      cha: 3,
      edg: { max: 3, current: 2 },
      ess: 5,
      mag: 0,
      res: 0,
    },
    skills: [{ id: 'perception', rating: 3, attr: 'int' }],
    armor: [{ name: 'Lined coat', rating: 9, worn: true }],
    ...over,
  });
}

/** Exactly what `GET /api/campaigns/:id/characters` puts on the wire. */
function dto(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'char-torque',
    campaignId: 'camp-1',
    ownerUserId: 'user-torque',
    name: 'Torque',
    status: 'active',
    sheetVersion: 2,
    sheet: sheet(),
    play: { monitors: { physical: 0, stun: 0, overflow: 0 }, edgeBurned: 0, recoil: {}, sustained: [] },
    balances: { karma: 14, nuyen: 5200, pending: { karma: 19, nuyen: 5200 } },
    hasChummerBlob: true,
    createdAt: '2076-05-01T00:00:00.000Z',
    updatedAt: '2076-05-12T00:00:00.000Z',
    ...over,
  };
}

describe('one REST body is a complete roster row', () => {
  const member = normalizeMember(dto());

  it('reads identity, owner and the ledger balances off the wire', () => {
    expect(member).toMatchObject({
      id: 'char-torque',
      alias: 'Torque',
      metatype: 'ork',
      ownerUserId: 'user-torque',
      status: 'active',
    });
    // FR3.6 — balances are ledger sums, and the projection including pending
    // entries rides along so the GM can see what settling would do.
    expect(member.balances.karma).toBe(14);
    expect(member.balances.pending.karma).toBe(19);
  });

  it('takes filled boxes and burned Edge from play state, not the sheet', () => {
    const hurt = normalizeMember(
      dto({ play: { monitors: { physical: 4, stun: 2, overflow: 0 }, edgeBurned: 1 } }),
    );
    expect(hurt.wounds).toEqual({ physical: 4, stun: 2, overflow: 0 });
    expect(hurt.edge).toEqual({ max: 3, current: 2, burned: 1 });
  });

  it('still renders a row when the stored sheet will not validate', () => {
    const broken = normalizeMember(dto({ sheet: { v: 1, identity: {} } }));
    expect(broken.sheet).toBeNull();
    expect(broken.name).toBe('Torque');
    expect(vitalsFor(broken, null).physical).toEqual({ max: 0, filled: 0 });
  });

  it('sorts by alias so the list does not reshuffle between refetches', () => {
    const rows: PartyMember[] = [
      normalizeMember(dto({ id: 'c', sheet: sheet({ identity: { alias: 'Whisper' } }) })),
      normalizeMember(dto({ id: 'a', sheet: sheet({ identity: { alias: 'Sparrow' } }) })),
      normalizeMember(dto({ id: 'b', sheet: sheet({ identity: { alias: 'Torque' } }) })),
    ];
    expect(sortMembers(rows).map((m) => m.alias)).toEqual(['Sparrow', 'Torque', 'Whisper']);
  });
});

describe('the numbers a GM asks for', () => {
  const member = normalizeMember(dto());

  it('derives monitors, pools and initiative from the sheet alone', () => {
    const v = vitalsFor(member, null);
    // 8 + ceil(BOD/2) = 8 + 3 physical; 8 + ceil(WIL/2) = 8 + 2 stun.
    expect(v.physical.max).toBe(11);
    expect(v.stun.max).toBe(10);
    expect(v.pools.defense).toBe(8); // REA 4 + INT 4
    expect(v.pools.soak).toBe(15); // BOD 6 + armor 9
    expect(v.pools.perception).toBe(7); // INT 4 + rating 3
    expect(v.initiative).toEqual({ base: 8, dice: 1 });
    expect(v.edge).toEqual({ max: 3, current: 2, burned: 0 });
  });

  it('flags a locally-derived row rather than passing it off as the server’s', () => {
    expect(vitalsFor(member, null).authoritative).toBe(false);
  });

  it('prefers the server’s derived view, scene environment and all', () => {
    const body = {
      characterId: 'char-torque',
      name: 'Torque',
      derived: deriveCharacter(member.sheet as SheetV1, {
        situational: [
          {
            id: 'env.scene',
            source: { kind: 'scene' },
            target: 'pool.all',
            op: 'add',
            value: -2,
            active: true,
            note: 'environment: light 2 → dark (-2)',
          },
        ],
        wounds: { physical: 0, stun: 0 },
      }),
      monitors: {
        physical: { max: 11, filled: 0 },
        stun: { max: 10, filled: 0 },
        overflow: { max: 6, filled: 0 },
      },
      wounds: { physical: 0, stun: 0, overflow: 0 },
      edge: { max: 3, current: 1, burned: 1 },
      situational: [],
      activeSceneId: 'scene-1',
      sustained: [],
      recoil: {},
      ammo: {},
      overrides: [],
    };
    const snapshot = normalizeDerived(body);
    expect(snapshot).not.toBeNull();
    const v = vitalsFor(member, snapshot);
    expect(v.authoritative).toBe(true);
    // The scene the GM set is inside the pool, which is the whole reason the
    // roster asks the server rather than trusting its own arithmetic.
    expect(v.pools.defense).toBe(6);
    expect(v.pools.perception).toBe(5);
    // Soak is exempt from pool.all (§10.2 damage resistance).
    expect(v.pools.soak).toBe(15);
    expect(v.edge).toEqual({ max: 3, current: 1, burned: 1 });
  });

  it('refuses a body it cannot read instead of inventing zeroes', () => {
    expect(normalizeDerived(null)).toBeNull();
    expect(normalizeDerived({ derived: { nonsense: true } })).toBeNull();
  });
});

describe('a damage apply moves the monitor and the wound modifier', () => {
  const member = normalizeMember(dto());

  it('starts with a clean track and no penalty', () => {
    const v = vitalsFor(member, null);
    expect(v.physical.filled).toBe(0);
    expect(v.woundModifier).toBe(0);
  });

  it('three boxes of physical is −1 to every pool', () => {
    const before = vitalsFor(member, null);
    const hurt = withDamage(member, before, { monitor: 'physical', boxes: 3, op: 'damage' });
    const after = vitalsFor(hurt, null);
    expect(after.physical.filled).toBe(3);
    expect(after.woundModifier).toBe(-1);
    // The penalty is not decorative: it is inside the pools the GM reads.
    expect(after.pools.defense).toBe(before.pools.defense! - 1);
    expect(after.pools.perception).toBe(before.pools.perception! - 1);
    // Soak never takes the wound modifier.
    expect(after.pools.soak).toBe(before.pools.soak);
  });

  it('stacks stun on top of physical, one step per three boxes', () => {
    let m = member;
    m = withDamage(m, vitalsFor(m, null), { monitor: 'physical', boxes: 3, op: 'damage' });
    m = withDamage(m, vitalsFor(m, null), { monitor: 'stun', boxes: 3, op: 'damage' });
    expect(vitalsFor(m, null).woundModifier).toBe(-2);
  });

  it('heals back down and the penalty goes with it', () => {
    let m = withDamage(member, vitalsFor(member, null), {
      monitor: 'physical',
      boxes: 6,
      op: 'damage',
    });
    expect(vitalsFor(m, null).woundModifier).toBe(-2);
    m = withDamage(m, vitalsFor(m, null), { monitor: 'physical', boxes: 4, op: 'heal' });
    expect(vitalsFor(m, null).physical.filled).toBe(2);
    expect(vitalsFor(m, null).woundModifier).toBe(0);
  });

  it('never runs off either end of the track', () => {
    expect(nextFilled(0, 10, 'heal', 3)).toBe(0);
    expect(nextFilled(9, 10, 'damage', 5)).toBe(10);
  });
});

describe('karma and nuyen move only as ledger entries (FR3.6)', () => {
  const member = normalizeMember(dto());

  it('builds an append-only entry, never a new balance', () => {
    expect(awardBody({ currency: 'karma', delta: 5, reason: 'tonight’s session' })).toEqual({
      currency: 'karma',
      delta: 5,
      reason: 'tonight’s session',
    });
    // A deduction is the same call with a negative delta — there is no "set".
    expect(awardBody({ currency: 'nuyen', delta: -1500, reason: 'Doc Wagon' }).delta).toBe(-1500);
  });

  it('always carries a reason, because the ledger is read back later', () => {
    expect(awardBody({ currency: 'karma', delta: 3, reason: '   ' }).reason).toBe('GM adjustment');
  });

  it('refuses a no-op', () => {
    expect(awardIsValid({ currency: 'karma', delta: 0, reason: 'x' })).toBe(false);
    expect(awardIsValid({ currency: 'karma', delta: -2, reason: 'x' })).toBe(true);
  });

  it('moves the balance the GM is looking at while the write is in flight', () => {
    const richer = withAward(member, { currency: 'karma', delta: 5, reason: 'session' });
    expect(richer.balances.karma).toBe(19);
    expect(richer.balances.nuyen).toBe(5200);
    const poorer = withAward(richer, { currency: 'nuyen', delta: -1200, reason: 'street doc' });
    expect(poorer.balances.nuyen).toBe(4000);
    expect(poorer.balances.karma).toBe(19);
  });
});

describe('who is holding this sheet, and are they here', () => {
  const member = normalizeMember(dto());

  it('is unclaimed when nothing owns it — the state that hides the Sheet tab', () => {
    const orphan = normalizeMember(dto({ ownerUserId: null }));
    expect(deviceFor(orphan, [], {}).state).toBe('unclaimed');
    expect(isReachable('unclaimed')).toBe(false);
  });

  it('does not report "paired" for an owner whose device row is gone', () => {
    expect(deviceFor(member, [], {}).state).toBe('no-device');
    expect(isReachable('no-device')).toBe(false);
    expect(isReachable('online')).toBe(true);
    expect(isReachable('paired')).toBe(true);
  });

  it('reads paired from REST alone, with no presence event ever having arrived', () => {
    const link = deviceFor(
      member,
      [{ id: 'dev-1', userId: 'user-torque', label: "Torque's phone", role: 'player' }],
      undefined,
    );
    expect(link).toMatchObject({ state: 'paired', label: "Torque's phone", deviceId: 'dev-1' });
  });

  it('presence only refines that into online', () => {
    const devices = [{ id: 'dev-1', userId: 'user-torque', userName: 'Ana', role: 'player' }];
    expect(deviceFor(member, devices, { 'user-torque': { state: 'online' } }).state).toBe('online');
    expect(deviceFor(member, devices, { 'user-torque': { state: 'offline' } }).state).toBe('paired');
    // Falls back to the player's name when the device carries no label.
    expect(deviceFor(member, devices, {}).label).toBe('Ana');
  });

  it('says revoked rather than online for a phone that walked out', () => {
    const link = deviceFor(
      member,
      [{ id: 'dev-1', userId: 'user-torque', label: 'old phone', revokedAt: '2076-05-11T00:00:00Z' }],
      { 'user-torque': { state: 'online' } },
    );
    expect(link.state).toBe('revoked');
  });
});

describe('finding a runner on the map', () => {
  const member = normalizeMember(dto());

  it('matches the character token, never an NPC standing next to it', () => {
    const tokens = [
      { id: 't-npc', sceneId: 's1', source: 'npc_template', sourceId: 'char-torque', name: 'Ganger', x: 1, y: 1 },
      { id: 't-pc', sceneId: 's1', source: 'character', sourceId: 'char-torque', name: 'Torque', x: 3, y: 9 },
    ];
    expect(tokenFor(member, tokens)?.id).toBe('t-pc');
    expect(tokenFor(member, [])).toBeNull();
    expect(tokenFor(member, undefined)).toBeNull();
  });
});

describe('roster totals and formatting', () => {
  it('counts the wounded and the unclaimed', () => {
    const a = normalizeMember(dto({ id: 'a' }));
    const b = normalizeMember(
      dto({ id: 'b', ownerUserId: null, play: { monitors: { physical: 2, stun: 0 } } }),
    );
    expect(partyTotals([a, b])).toEqual({
      count: 2,
      karma: 28,
      nuyen: 10400,
      wounded: 1,
      unclaimed: 1,
    });
  });

  it('never prints a bare minus or an unsigned penalty', () => {
    expect(signed(-1)).toBe('-1');
    expect(signed(2)).toBe('+2');
    expect(formatNuyen(5200)).toBe('5,200¥');
  });
});
