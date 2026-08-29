/**
 * The rules the Magic tab plays by (FR8.2–FR8.4), tested without a DOM.
 *
 * What is worth pinning here is not the markup but the promises:
 *
 *  - a focus toggle MOVES a derived number and shows up in its provenance,
 *    because a toggle that only changes a colour is the side-spreadsheet with
 *    extra steps (Principle 3);
 *  - counters floor at zero on the optimistic side exactly as they do on the
 *    authoritative one, so the two can never disagree about a shortfall;
 *  - an event refines a hydrated view and is never mistaken for one (LIVE-1).
 */
import { describe, expect, it } from 'vitest';
import type { Modifier, SheetV1, WsEvent } from '@safehouse/contracts';
import { SheetV1Schema } from '@safehouse/contracts';
import {
  affectedPools,
  exemptionPhrase,
  focusContributes,
  focusEntriesIn,
  focusTargets,
  focusToggleLabel,
  prettyTarget,
  previewWithFoci,
  releaseSteps,
  reagentsAfterRestock,
  reagentsAfterSpend,
  setFocusActive,
  setFocusBonded,
  situationalWithoutFoci,
  spendServiceLabel,
  spendServiceLocal,
  spiritIsInFight,
  sustainedRows,
  sustainingPenaltyOf,
} from './lib.js';
import { emptyMagicView, normalizeMagicView, type FocusRow, type MagicView, type SpiritRow } from './types.js';

// ---------------------------------------------------------------------------
// Fixtures — original fiction only (G6)
// ---------------------------------------------------------------------------

function makeSheet(): SheetV1 {
  return SheetV1Schema.parse({
    v: 1,
    identity: { alias: 'Marisol Quen', metatype: 'elf' },
    attributes: {
      bod: 3,
      agi: 3,
      rea: 4,
      str: 2,
      wil: 5,
      log: 4,
      int: 5,
      cha: 5,
      edg: { max: 3, current: 3 },
      ess: 6,
      mag: 5,
      res: 0,
    },
    skills: [
      { id: 'spellcasting', rating: 5, attr: 'mag' },
      { id: 'perception', rating: 2, attr: 'int' },
    ],
    spells: [{ name: 'Pale Lantern', drain: 'F-3' }],
  } satisfies Record<string, unknown>);
}

const SHEET = makeSheet();
const NO_WOUNDS = { physical: 0, stun: 0 };

const DIM_SCENE: Modifier = {
  id: 'env.scene',
  source: { kind: 'scene' },
  target: 'pool.all',
  op: 'add',
  value: -1,
  active: true,
  note: 'environment: light 1 → light (-1)',
};

function focus(over: Partial<FocusRow> = {}): FocusRow {
  return {
    id: 'focus-1',
    characterId: 'char-1',
    name: 'Copper Wren',
    kind: 'power focus',
    force: 3,
    bonded: true,
    active: false,
    sourceKind: 'power',
    targets: ['pool.skill.spellcasting'],
    mods: [],
    note: '',
    ...over,
  };
}

function spirit(over: Partial<SpiritRow> = {}): SpiritRow {
  return {
    id: 'spirit-1',
    characterId: 'char-1',
    name: 'Ash-Wing',
    spiritType: 'air',
    force: 4,
    bound: true,
    services: 3,
    servicesInitial: 5,
    status: 'summoned',
    sustainingSpellId: null,
    combatantId: null,
    encounterId: null,
    note: '',
    ...over,
  };
}

function view(over: Partial<MagicView> = {}): MagicView {
  return { ...emptyMagicView('char-1'), ...over };
}

// ---------------------------------------------------------------------------

describe('a bonded focus is a real modifier source (FR8.4)', () => {
  const situational = [DIM_SCENE];

  function poolWith(foci: FocusRow[]) {
    const derived = previewWithFoci({ sheet: SHEET, situational, foci, wounds: NO_WOUNDS });
    return derived.pools['skill.spellcasting'];
  }

  it('moves the derived pool the moment it is switched on', () => {
    const off = poolWith([focus({ active: false })]);
    const on = poolWith([focus({ active: true })]);
    // MAG 5 + rating 5 − scene 1 = 9; the Force-3 focus makes it 12.
    expect(off?.total).toBe(9);
    expect(on?.total).toBe(12);
  });

  it('names itself in that pool’s provenance (Principle 3)', () => {
    const on = poolWith([focus({ active: true })]);
    const line = on?.breakdown.find((e) => e.label.includes('Copper Wren'));
    expect(line).toBeDefined();
    expect(line?.value).toBe(3);
    expect(line?.source).toBe('power');
    // And the breakdown still sums to the number on the row.
    expect(on?.breakdown.reduce((sum, e) => sum + e.value, 0)).toBe(on?.total);
  });

  it('leaves the scene modifier alone — the focus is added, nothing is lost', () => {
    const on = poolWith([focus({ active: true })]);
    expect(on?.breakdown.some((e) => e.source === 'scene')).toBe(true);
  });

  it('contributes nothing at all while it is unbonded, however switched-on it looks', () => {
    expect(poolWith([focus({ bonded: false, active: true })])?.total).toBe(9);
    expect(focusContributes(focus({ bonded: false, active: true }))).toBe(false);
  });

  it('switches off when it is unbonded, so the rack cannot lie', () => {
    const [next] = setFocusBonded([focus({ active: true })], 'focus-1', false);
    expect(next).toMatchObject({ bonded: false, active: false });
  });

  it('re-derives from the same modifier list without double-counting itself', () => {
    const first = previewWithFoci({
      sheet: SHEET,
      situational,
      foci: [focus({ active: true })],
      wounds: NO_WOUNDS,
    });
    // Feed the result's own modifier list back in: foci are stripped by id, so
    // the second pass produces the same number rather than 15.
    const withFocusMods = [...situational, { ...DIM_SCENE, id: 'focus.focus-1.0' }];
    expect(situationalWithoutFoci(withFocusMods)).toHaveLength(1);
    const second = previewWithFoci({
      sheet: SHEET,
      situational: withFocusMods,
      foci: [focus({ active: true })],
      wounds: NO_WOUNDS,
    });
    expect(second.pools['skill.spellcasting']?.total).toBe(first.pools['skill.spellcasting']?.total);
  });

  it('finds the focus line for a pool when asked directly', () => {
    const on = previewWithFoci({
      sheet: SHEET,
      situational,
      foci: [focus({ active: true })],
      wounds: NO_WOUNDS,
    });
    expect(focusEntriesIn(on.pools['skill.spellcasting'], [focus({ active: true })])).toHaveLength(1);
    expect(focusEntriesIn(on.pools['skill.perception'], [focus({ active: true })])).toHaveLength(0);
  });
});

describe('which pools the rack is showing', () => {
  const derived = previewWithFoci({
    sheet: SHEET,
    situational: [],
    foci: [focus({ active: false })],
    wounds: NO_WOUNDS,
  });

  it('lists a bonded focus’s pools whether or not it is switched on', () => {
    const off = affectedPools([focus({ active: false })], derived);
    expect(off.map((p) => p.key)).toEqual(['skill.spellcasting']);
    expect(off[0]?.label).toBe('spellcasting');
  });

  it('ignores an unbonded focus entirely', () => {
    expect(affectedPools([focus({ bonded: false, active: true })], derived)).toEqual([]);
  });

  it('expands pool.all but caps it so a phone still renders', () => {
    const all = affectedPools([focus({ targets: ['pool.all'] })], derived, 2);
    expect(all).toHaveLength(2);
    // Damage resistance is exempt from pool.all (see derive-pools).
    expect(affectedPools([focus({ targets: ['pool.all'] })], derived, 99).map((p) => p.key)).not.toContain(
      'soak',
    );
  });

  it('prefers explicit modifiers over the generic target list', () => {
    const explicit = focus({
      targets: ['pool.all'],
      mods: [
        {
          id: 'm1',
          source: { kind: 'power' },
          target: 'limit.astral',
          op: 'add',
          value: 2,
          active: true,
        },
      ],
    });
    expect(focusTargets(explicit)).toEqual(['limit.astral']);
    expect(prettyTarget('limit.astral')).toBe('astral limit');
    expect(prettyTarget('pool.all')).toBe('every pool');
    expect(prettyTarget('attr.mag')).toBe('MAG');
  });

  it('says what activating the toggle will do', () => {
    expect(focusToggleLabel(focus({ active: false }))).toContain('activate to switch on');
    expect(focusToggleLabel(focus({ active: true }))).toContain('activate to switch off');
    expect(focusToggleLabel(focus({ bonded: false }))).toContain('not bonded');
  });

  it('does not fabricate pools when nothing has been derived yet', () => {
    expect(affectedPools([focus()], null)).toEqual([]);
  });
});

describe('spirit services floor at zero (FR8.3)', () => {
  it('spends one and reports what is left', () => {
    const out = spendServiceLocal([spirit()], 'spirit-1');
    expect(out.spent).toBe(1);
    expect(out.remaining).toBe(2);
    expect(out.shortfall).toBe(0);
    expect(out.spirits[0]?.services).toBe(2);
    // The "3 of 5" denominator does not move when a service is spent.
    expect(out.spirits[0]?.servicesInitial).toBe(5);
  });

  it('never borrows: asking for more than remain is a shortfall, not a negative', () => {
    const out = spendServiceLocal([spirit({ services: 1 })], 'spirit-1', 3);
    expect(out.spent).toBe(1);
    expect(out.remaining).toBe(0);
    expect(out.shortfall).toBe(2);
    expect(out.spirits[0]?.services).toBe(0);
  });

  it('leaves the list alone when the spirit is not there', () => {
    const out = spendServiceLocal([spirit()], 'nobody');
    expect(out.spirits[0]?.services).toBe(3);
    expect(out.spent).toBe(0);
  });

  it('says what the tap costs, and says when there is nothing to spend', () => {
    expect(spendServiceLabel(spirit())).toBe('Spend a service from Ash-Wing, 3 left');
    expect(spendServiceLabel(spirit({ services: 0 }))).toBe('Ash-Wing has no services left');
  });

  it('knows when a spirit is already standing in the current fight', () => {
    const placed = spirit({ combatantId: 'cmb-3', encounterId: 'enc-1' });
    expect(spiritIsInFight(placed, 'enc-1')).toBe(true);
    // A row from last week's fight is not in this one.
    expect(spiritIsInFight(placed, 'enc-2')).toBe(false);
    expect(spiritIsInFight(spirit(), 'enc-1')).toBe(false);
  });
});

describe('reagents cannot go below zero (FR8.4)', () => {
  it('spends what is there and reports the rest as short', () => {
    expect(reagentsAfterSpend(10, 4)).toEqual({ after: 6, shortfall: 0 });
    expect(reagentsAfterSpend(2, 5)).toEqual({ after: 0, shortfall: 3 });
    expect(reagentsAfterSpend(0, 1)).toEqual({ after: 0, shortfall: 1 });
  });

  it('restocks without inventing a shortfall', () => {
    expect(reagentsAfterRestock(0, 12)).toEqual({ after: 12, shortfall: 0 });
    expect(reagentsAfterRestock(3, -5)).toEqual({ after: 3, shortfall: 0 });
  });
});

describe('who is holding the spell up (FR8.2 × FR8.3)', () => {
  const held: MagicView = view({
    sustaining: {
      lines: [
        {
          id: 'spell.pale-lantern',
          name: 'Pale Lantern',
          exempt: true,
          exemptBy: 'spirit',
          spiritId: 'spirit-1',
          spiritName: 'Ash-Wing',
          penalty: 0,
        },
        {
          id: 'spell.hush',
          name: 'Hush',
          exempt: false,
          exemptBy: null,
          spiritId: null,
          spiritName: null,
          penalty: -2,
        },
      ],
      penalty: -2,
      selfSustained: 1,
    },
  });

  it('says which spells are free and why', () => {
    const rows = sustainedRows(held, SHEET);
    expect(rows.map((r) => r.name)).toEqual(['Pale Lantern', 'Hush']);
    expect(exemptionPhrase(rows[0]!)).toBe('held by Ash-Wing — no −2');
    expect(exemptionPhrase(rows[1]!)).toBe('−2 to your pools');
  });

  it('charges the caster only for the ones nobody else is carrying', () => {
    expect(sustainingPenaltyOf(sustainedRows(held, SHEET))).toBe(-2);
  });

  it('takes the spell off the spirit before deleting the entry', () => {
    const rows = sustainedRows(held, SHEET);
    expect(releaseSteps(rows[0]!)).toEqual([
      { op: 'take_back', spiritId: 'spirit-1', sustainedId: 'spell.pale-lantern' },
      { op: 'remove', id: 'spell.pale-lantern' },
    ]);
    // Nobody else is holding this one, so it just goes.
    expect(releaseSteps(rows[1]!)).toEqual([{ op: 'remove', id: 'spell.hush' }]);
  });

  it('releases an old sheet-carried sustain through the sheet', () => {
    expect(
      releaseSteps({
        id: 'Pale Lantern',
        name: 'Pale Lantern',
        exempt: false,
        exemptBy: null,
        spiritId: null,
        spiritName: null,
        penalty: -2,
        origin: 'sheet',
      }),
    ).toEqual([{ op: 'sheet_toggle', name: 'Pale Lantern' }]);
  });

  it('names a focus or quickening when that is what is carrying it', () => {
    const byFocus = sustainedRows(
      view({
        sustaining: {
          lines: [
            {
              id: 's1',
              name: 'Pale Lantern',
              exempt: true,
              exemptBy: 'focus_or_quickening',
              spiritId: null,
              spiritName: null,
              penalty: 0,
            },
          ],
          penalty: 0,
          selfSustained: 0,
        },
      }),
      SHEET,
    );
    expect(exemptionPhrase(byFocus[0]!)).toContain('focus or quickening');
  });

  it('still shows a sustain recorded the old way, so no −2 goes invisible', () => {
    const legacySheet: SheetV1 = {
      ...SHEET,
      overrides: [
        {
          id: 'sustain.Pale Lantern',
          source: { kind: 'spell', ref: 'Pale Lantern' },
          target: 'pool.all',
          op: 'add',
          value: -2,
          active: true,
          note: 'sustaining Pale Lantern',
        },
      ],
    };
    // The server already tracks this one, so it is not listed twice…
    expect(sustainedRows(held, legacySheet)).toHaveLength(2);
    // …but with nothing tracked it is the only thing keeping the −2 visible.
    const alone = sustainedRows(view(), legacySheet);
    expect(alone).toHaveLength(1);
    expect(alone[0]).toMatchObject({ origin: 'sheet', name: 'Pale Lantern', penalty: -2 });
  });
});

describe('reading the tracker off the wire', () => {
  it('takes the server’s whole answer', () => {
    const parsed = normalizeMagicView(
      {
        characterId: 'char-1',
        name: 'Marisol Quen',
        derived: { pools: {}, limits: {} },
        situational: [DIM_SCENE],
        focusModifiers: [],
        foci: [focus()],
        spirits: [spirit()],
        sustaining: { lines: [], penalty: 0, selfSustained: 0 },
        reagents: 12,
        activeSceneId: 'scene-2',
      },
      'char-1',
    );
    expect(parsed.spirits[0]?.name).toBe('Ash-Wing');
    expect(parsed.foci[0]?.targets).toEqual(['pool.skill.spellcasting']);
    expect(parsed.reagents).toBe(12);
    expect(parsed.activeSceneId).toBe('scene-2');
  });

  it('degrades a body it cannot read to an empty rack, never to a throw', () => {
    expect(normalizeMagicView(null, 'char-1')).toMatchObject({ spirits: [], foci: [], reagents: 0 });
    expect(normalizeMagicView({ spirits: [{ nope: true }], reagents: -4 }, 'char-1')).toMatchObject({
      spirits: [],
      reagents: 0,
    });
  });
});
