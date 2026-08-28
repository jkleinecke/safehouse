import { describe, expect, it } from 'vitest';
import type { LedgerEntry, SheetV1, SheetWeapon, WsEvent } from '@safehouse/contracts';
import { SheetV1Schema } from '@safehouse/contracts';
import { deriveCharacter } from '@safehouse/rules';
import {
  ammoAfterShots,
  bulletsForMode,
  chipEntries,
  chipSum,
  clampFill,
  clampPool,
  clearOverride,
  drainHitsFromEvents,
  drainValue,
  edgeAfter,
  findOverride,
  formatNuyen,
  hasOverrideEntry,
  isPowerActive,
  isSustained,
  ledgerBalances,
  monitorTapTarget,
  readerHref,
  recoilPenalty,
  setPowerActive,
  signed,
  sustainedSpells,
  toggleSustain,
  upsertOverride,
  withWeaponAmmo,
  type RollChip,
} from './lib.js';

/** Original fiction only — no book content anywhere (G6). */
function makeSheet(): SheetV1 {
  return SheetV1Schema.parse({
    v: 1,
    identity: { alias: 'Ash Meridian', metatype: 'elf' },
    attributes: {
      bod: 4,
      agi: 5,
      rea: 4,
      str: 3,
      wil: 5,
      log: 3,
      int: 4,
      cha: 6,
      edg: { max: 4, current: 3 },
      ess: 6,
      mag: 5,
      res: 0,
    },
    skills: [
      { id: 'spellcasting', rating: 6, attr: 'mag' },
      { id: 'perception', rating: 3, attr: 'int', spec: 'visual' },
    ],
    spells: [{ name: 'Lantern Glare', drain: 'F-3' }],
    powers: [
      {
        name: 'Steady Hand',
        mods: [
          {
            id: 'steady.1',
            source: { kind: 'power' },
            target: 'limit.physical',
            op: 'add',
            value: 1,
            active: true,
          },
        ],
      },
    ],
    weapons: [
      {
        name: 'Sparrow SMG',
        skillId: 'automatics',
        modes: ['SA', 'BF', 'FA'],
        recoilComp: 2,
        ammo: { cap: 32, current: 32 },
      },
    ],
    gear: [{ name: 'Grapple line', qty: 1 }],
  } satisfies Record<string, unknown>);
}

describe('condition monitors (FR3.4)', () => {
  it('taps deeper to damage and taps the edge box to heal one', () => {
    expect(monitorTapTarget(0, 2)).toBe(3); // tap the 3rd box → 3 filled
    expect(monitorTapTarget(3, 2)).toBe(2); // tap the last filled box → heal 1
    expect(monitorTapTarget(3, 5)).toBe(6);
  });

  it('clamps fills into the monitor', () => {
    expect(clampFill(-4, 10)).toBe(0);
    expect(clampFill(14, 10)).toBe(10);
    expect(clampFill(3.7, 10)).toBe(3);
    expect(clampFill(5, -2)).toBe(0);
  });
});

describe('edge (FR2.3)', () => {
  it('spends, regains, and burns', () => {
    const edge = { max: 4, current: 3 };
    expect(edgeAfter(edge, 'spend')).toEqual({ max: 4, current: 2 });
    expect(edgeAfter(edge, 'regain')).toEqual({ max: 4, current: 4 });
    expect(edgeAfter(edge, 'burn')).toEqual({ max: 3, current: 2 });
  });

  it('never goes below zero or above max', () => {
    expect(edgeAfter({ max: 4, current: 0 }, 'spend')).toEqual({ max: 4, current: 0 });
    expect(edgeAfter({ max: 4, current: 4 }, 'regain')).toEqual({ max: 4, current: 4 });
    expect(edgeAfter({ max: 0, current: 0 }, 'burn')).toEqual({ max: 0, current: 0 });
  });

  it('burning below the new max pulls current down with it', () => {
    expect(edgeAfter({ max: 3, current: 3 }, 'burn')).toEqual({ max: 2, current: 2 });
  });
});

describe('overrides (Principle 2)', () => {
  it('upserts, finds and clears an override for a target', () => {
    const sheet = makeSheet();
    const withOne = upsertOverride(sheet, 'pool.skill.perception', 11, 'GM says so');
    const found = findOverride(withOne, 'pool.skill.perception');
    expect(found?.value).toBe(11);
    expect(found?.op).toBe('set');
    expect(found?.source.kind).toBe('override');
    expect(found?.note).toBe('GM says so');

    const replaced = upsertOverride(withOne, 'pool.skill.perception', 9);
    expect(replaced.overrides.filter((m) => m.target === 'pool.skill.perception')).toHaveLength(1);
    expect(findOverride(replaced, 'pool.skill.perception')?.value).toBe(9);

    expect(findOverride(clearOverride(replaced, 'pool.skill.perception'), 'pool.skill.perception'))
      .toBeUndefined();
    expect(sheet.overrides).toHaveLength(0); // input untouched
  });

  it('an overridden value actually reaches the rules engine and is flagged', () => {
    const sheet = upsertOverride(makeSheet(), 'pool.skill.perception', 11);
    const derived = deriveCharacter(sheet);
    const pool = derived.pools['skill.perception'];
    expect(pool?.total).toBe(11);
    expect(hasOverrideEntry(pool?.breakdown ?? [])).toBe(true);
  });

  it('reports no override flag on an untouched breakdown', () => {
    const derived = deriveCharacter(makeSheet());
    expect(hasOverrideEntry(derived.pools['skill.perception']?.breakdown ?? [])).toBe(false);
  });
});

describe('sustained spells (FR8.2)', () => {
  it('toggles a −2 pool.all modifier on and off', () => {
    const sheet = makeSheet();
    expect(isSustained(sheet, 'Lantern Glare')).toBe(false);

    const sustaining = toggleSustain(sheet, 'Lantern Glare');
    expect(isSustained(sustaining, 'Lantern Glare')).toBe(true);
    expect(sustainedSpells(sustaining)).toEqual(['Lantern Glare']);

    const mod = sustaining.overrides.find((m) => m.id === 'sustain.Lantern Glare');
    expect(mod?.target).toBe('pool.all');
    expect(mod?.value).toBe(-2);

    expect(isSustained(toggleSustain(sustaining, 'Lantern Glare'), 'Lantern Glare')).toBe(false);
  });

  it('drags every pool down by 2 in the engine, soak excepted', () => {
    const base = deriveCharacter(makeSheet());
    const sustained = deriveCharacter(toggleSustain(makeSheet(), 'Lantern Glare'));
    expect(sustained.pools['skill.perception']?.total).toBe(
      (base.pools['skill.perception']?.total ?? 0) - 2,
    );
    expect(sustained.pools['soak']?.total).toBe(base.pools['soak']?.total);
  });
});

describe('adept powers (FR8.5)', () => {
  it('toggles every modifier a power carries', () => {
    const sheet = makeSheet();
    const power = sheet.powers[0];
    expect(power && isPowerActive(power)).toBe(true);

    const off = setPowerActive(sheet, 'Steady Hand', false);
    const offPower = off.powers[0];
    expect(offPower && isPowerActive(offPower)).toBe(false);
    expect(deriveCharacter(off).limits.physical.value).toBe(
      deriveCharacter(sheet).limits.physical.value - 1,
    );
  });

  it('treats a power with no modifiers as passive, not active', () => {
    expect(isPowerActive({ mods: [] })).toBe(false);
  });
});

describe('weapons: recoil + ammo (FR3.4)', () => {
  it('maps fire modes to rounds spent', () => {
    expect(bulletsForMode('SS')).toBe(1);
    expect(bulletsForMode('sa')).toBe(1);
    expect(bulletsForMode('BF')).toBe(3);
    expect(bulletsForMode('fa')).toBe(6);
    expect(bulletsForMode('weird')).toBe(1);
  });

  it('is progressive: the first round is free, then comp absorbs the rest', () => {
    expect(recoilPenalty(0, 1, 2)).toBe(0); // single shot, nothing to compensate
    expect(recoilPenalty(0, 3, 2)).toBe(0); // 3 rounds − 1 free − 2 comp
    expect(recoilPenalty(0, 6, 2)).toBe(-3);
    expect(recoilPenalty(3, 3, 2)).toBe(-3); // second burst this turn stacks
    expect(recoilPenalty(0, 1, 0)).toBe(0);
  });

  it('decrements and reloads ammo without going negative', () => {
    const sheet = makeSheet();
    const weapon = sheet.weapons[0] as SheetWeapon;
    expect(ammoAfterShots(weapon, 6).ammo?.current).toBe(26);
    expect(ammoAfterShots({ ...weapon, ammo: { cap: 32, current: 2 } }, 6).ammo?.current).toBe(0);

    const spent = withWeaponAmmo(sheet, 'Sparrow SMG', 5);
    expect(spent.weapons[0]?.ammo?.current).toBe(5);
    expect(withWeaponAmmo(spent, 'Sparrow SMG', 99).weapons[0]?.ammo?.current).toBe(32);
  });

  it('leaves an ammo-less weapon alone', () => {
    const melee: SheetWeapon = { name: 'Baton', skillId: 'clubs', ap: 0, modes: [] };
    expect(ammoAfterShots(melee, 3)).toEqual(melee);
  });
});

describe('drain codes (FR8.1)', () => {
  it('resolves F-relative codes against the chosen Force, minimum 2', () => {
    expect(drainValue('F-3', 6)).toBe(3);
    expect(drainValue('F+2', 4)).toBe(6);
    expect(drainValue('F', 5)).toBe(5);
    expect(drainValue('f-3', 4)).toBe(2); // floor at 2
    expect(drainValue(' F -1 ', 9)).toBe(8);
  });

  it('passes plain numbers through and rejects gibberish', () => {
    expect(drainValue('4', 6)).toBe(4);
    expect(drainValue('1', 6)).toBe(2);
    expect(drainValue('DV squared', 6)).toBeNull();
    expect(drainValue(undefined, 6)).toBeNull();
  });
});

describe('drain hit pickup from the log', () => {
  const event = (id: number, payload: unknown): WsEvent => ({
    id,
    type: 'roll.created',
    payload,
    visibility: 'public',
    ts: '2076-05-12T20:00:00.000Z',
  });

  it('reads hits off the newest matching roll event', () => {
    const events: WsEvent[] = [
      event(1, { request: { meta: { drainFor: 'Lantern Glare' } }, result: { hits: 1 } }),
      event(2, { request: { meta: { drainFor: 'Other Spell' } }, result: { hits: 5 } }),
      event(3, { request: { meta: { drainFor: 'Lantern Glare' } }, result: { hits: 3 } }),
    ];
    expect(drainHitsFromEvents(events, 'Lantern Glare')).toBe(3);
  });

  it('tolerates a flat payload shape and reports nothing when absent', () => {
    expect(drainHitsFromEvents([event(1, { meta: { drainFor: 'X' }, hits: 2 })], 'X')).toBe(2);
    expect(drainHitsFromEvents([], 'X')).toBeNull();
    expect(drainHitsFromEvents([event(1, { meta: { drainFor: 'Y' } })], 'X')).toBeNull();
  });
});

describe('ledger (FR3.6)', () => {
  const entry = (over: Partial<LedgerEntry>): LedgerEntry => ({
    id: 'e1',
    characterId: 'c1',
    currency: 'nuyen',
    delta: 0,
    reason: 'test',
    state: 'approved',
    ...over,
  });

  it('sums approved and pending separately per currency', () => {
    const balances = ledgerBalances([
      entry({ id: '1', currency: 'nuyen', delta: 12_000 }),
      entry({ id: '2', currency: 'nuyen', delta: -2_500, state: 'pending' }),
      entry({ id: '3', currency: 'karma', delta: 7 }),
      entry({ id: '4', currency: 'karma', delta: -5, state: 'rejected' }),
    ]);
    expect(balances.nuyen).toEqual({ approved: 12_000, pending: -2_500 });
    expect(balances.karma).toEqual({ approved: 7, pending: 0 });
  });

  it('starts at zero with no entries', () => {
    expect(ledgerBalances([])).toEqual({
      karma: { approved: 0, pending: 0 },
      nuyen: { approved: 0, pending: 0 },
    });
  });
});

describe('roll chips + formatting', () => {
  const chips: RollChip[] = [
    { id: 'a', label: 'darkness', value: -3, active: true, source: 'scene' },
    { id: 'b', label: 'spec: visual', value: 2, active: false, source: 'situational' },
    { id: 'c', label: 'zeroed', value: 0, active: true, source: 'situational' },
  ];

  it('sums only the armed chips', () => {
    expect(chipSum(chips)).toBe(-3);
    expect(chipSum(chips.map((c) => ({ ...c, active: true })))).toBe(-1);
  });

  it('emits provenance for armed, non-zero chips only', () => {
    expect(chipEntries(chips)).toEqual([{ label: 'darkness', value: -3, source: 'scene' }]);
  });

  it('formats signed numbers, nuyen and reader links', () => {
    expect(signed(3)).toBe('+3');
    expect(signed(0)).toBe('+0');
    expect(signed(-2)).toBe('-2');
    expect(formatNuyen(12_500)).toBe('12,500¥');
    expect(readerHref({ book: 'SR5', page: 174 })).toBe('/read/SR5?p=174');
    expect(clampPool(-4)).toBe(0);
    expect(clampPool(7.9)).toBe(7);
  });
});
