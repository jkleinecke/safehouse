/**
 * The starter archetype library (FR10.1): sixteen shipped archetypes so a fresh
 * campaign opens the generator on a full dropdown instead of an empty one.
 *
 * These tests are the difference between a feature and a toy. They check the
 * data is contract-valid, that every rung of every ladder generates a PLAYABLE
 * body (limits, monitors, initiative, defence and soak all derive and land in
 * sane bands), that samples stay inside the declared curves, and — the part a
 * GM actually feels — that a street ganger is a speed bump while an elite is
 * genuinely dangerous to a starting team.
 */
import { describe, expect, it } from 'vitest';
import { GenTemplateSchema, SheetV1Schema, type NumRange, type SheetV1 } from '@safehouse/contracts';
import {
  STARTER_ARCHETYPES,
  STARTER_TIER_IDS,
  deriveCharacter,
  exchangeEstimate,
  generateGruntGroup,
  generateNpc,
  starterArchetype,
  starterCatalog,
  type StarterArchetype,
} from '../src/index.js';

/**
 * The role tags the server's tactical-hints lookup keys on (FR10.10). Mirrored
 * here on purpose: `@safehouse/rules` is pure and must not import the server.
 * Every shipped archetype must land on at least one of these, or its combatants
 * get no hint line when the GM turns the feature on.
 */
const HINT_ROLE_TAGS = new Set([
  'sniper', 'ganger', 'muscle', 'face', 'lieutenant', 'leader', 'mage', 'adept',
  'decker', 'technomancer', 'rigger', 'drone', 'spirit', 'security', 'medic', 'street',
]);

/** What a night in a cyberpunk city needs on the shelf before the GM writes anything. */
const REQUIRED_IDS = [
  'street-ganger', 'gang-lieutenant', 'door-heavy', 'wired-enforcer',
  'corp-guard', 'corp-close-protection', 'patrol-officer', 'legwork-investigator',
  'contract-shooter', 'street-doc', 'broker-face', 'combat-mage',
  'combat-adept', 'drone-rigger', 'grid-decker', 'bar-staff',
];

/**
 * An ORIGINAL reference profile for a starting team's hitter — our own numbers,
 * not a book character: attack 14, DV 9P, defence 11 (REA+INT), soak 15.
 */
const STARTING_RUNNER = { defensePool: 11, soakPool: 15 };

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
};
const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const mid = (r: NumRange): number => (r.min + r.max) / 2;

function tierOf(a: StarterArchetype, tierId: string) {
  const t = a.gen.tiers.find((x) => x.id === tierId);
  if (!t) throw new Error(`${a.id}: missing tier ${tierId}`);
  return t;
}

/** The best exchange this NPC can offer against a target — the GM's read of "what can it do to us". */
function bestExchange(sheet: SheetV1, target: { defensePool: number; soakPool: number }) {
  const pools = deriveCharacter(sheet).pools;
  let best = exchangeEstimate(0, target.defensePool, '0P', target.soakPool);
  for (const w of sheet.weapons) {
    const pool = pools[`weapon.${w.name}`]?.total ?? 0;
    const est = exchangeEstimate(pool, target.defensePool, w.dv ?? '0P', target.soakPool);
    if (est.boxesPerConnect > best.boxesPerConnect) best = est;
  }
  return best;
}

/** Highest weapon dice pool on the sheet. */
function bestAttackPool(sheet: SheetV1): number {
  const pools = deriveCharacter(sheet).pools;
  let best = 0;
  for (const w of sheet.weapons) best = Math.max(best, pools[`weapon.${w.name}`]?.total ?? 0);
  return best;
}

function npcAt(a: StarterArchetype, tierId: string, seed: number) {
  return generateNpc(a.gen, tierId, seed, { catalog: starterCatalog(a) });
}

// ---------------------------------------------------------------------------
// The library itself
// ---------------------------------------------------------------------------

describe('starter archetype library — shape', () => {
  it('ships the roles a GM needs to run a night, with unique ids and names', () => {
    expect(STARTER_ARCHETYPES.length).toBeGreaterThanOrEqual(12);
    expect(STARTER_ARCHETYPES.length).toBeLessThanOrEqual(16);

    const ids = STARTER_ARCHETYPES.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    const names = STARTER_ARCHETYPES.map((a) => a.name);
    expect(new Set(names).size).toBe(names.length);

    for (const id of REQUIRED_IDS) expect(starterArchetype(id), `missing archetype ${id}`).toBeDefined();
  });

  it('every archetype is contract-valid and carries a GM-facing summary', () => {
    for (const a of STARTER_ARCHETYPES) {
      expect(() => GenTemplateSchema.parse(a.gen), a.id).not.toThrow();
      expect(() => SheetV1Schema.partial().parse(a.statblock), a.id).not.toThrow();
      expect(a.summary.length, a.id).toBeGreaterThan(30);
      expect(a.name.length, a.id).toBeGreaterThan(3);
      expect(a.persona.traits?.length ?? 0, a.id).toBeGreaterThan(0);
    }
  });

  it('every archetype uses the shipped tier ladder, in order', () => {
    for (const a of STARTER_ARCHETYPES) {
      expect(a.gen.tiers.map((t) => t.id), a.id).toEqual([...STARTER_TIER_IDS]);
      const labels = a.gen.tiers.map((t) => t.label);
      expect(new Set(labels).size, `${a.id} reuses a rung label`).toBe(labels.length);
      for (const t of a.gen.tiers) {
        expect(Object.keys(t.skills).length, `${a.id}/${t.id} has no skills`).toBeGreaterThan(3);
        expect(Object.keys(t.metatypeWeights ?? {}).length, `${a.id}/${t.id}`).toBeGreaterThan(0);
        expect(t.loadout.length, `${a.id}/${t.id} has no loadout`).toBeGreaterThan(0);
      }
    }
  });

  it('every archetype carries a role tag the tactical-hints lookup keys on', () => {
    for (const a of STARTER_ARCHETYPES) {
      expect(a.gen.roleTags.length, a.id).toBeGreaterThan(0);
      const hit = a.gen.roleTags.some((t) => HINT_ROLE_TAGS.has(t));
      expect(hit, `${a.id} tags ${a.gen.roleTags.join('/')} match no hint role`).toBe(true);
    }
  });

  it('cites no page it has not verified — no gear record carries a ref', () => {
    for (const a of STARTER_ARCHETYPES) {
      const sb = a.statblock;
      for (const rec of [...(sb.weapons ?? []), ...(sb.armor ?? []), ...(sb.gear ?? []), ...(sb.spells ?? []), ...(sb.powers ?? [])]) {
        expect((rec as { ref?: unknown }).ref, `${a.id}: ${JSON.stringify(rec).slice(0, 40)}`).toBeUndefined();
      }
    }
  });

  it('the ladder climbs: PR, attributes and skills never go backwards a rung', () => {
    for (const a of STARTER_ARCHETYPES) {
      for (let i = 1; i < a.gen.tiers.length; i++) {
        const prev = a.gen.tiers[i - 1]!;
        const next = a.gen.tiers[i]!;
        const where = `${a.id}: ${prev.id} → ${next.id}`;
        expect(next.professionalRating.min, `${where} PR.min`).toBeGreaterThanOrEqual(prev.professionalRating.min);
        expect(next.professionalRating.max, `${where} PR.max`).toBeGreaterThanOrEqual(prev.professionalRating.max);

        const attrSum = (t: typeof prev): number =>
          Object.values(t.attributes).reduce((s, r) => s + mid(r), 0);
        expect(attrSum(next), `${where} attribute mass`).toBeGreaterThan(attrSum(prev));

        const skillSum = (t: typeof prev): number =>
          Object.values(t.skills).reduce((s, r) => s + mid(r), 0);
        expect(skillSum(next), `${where} skill mass`).toBeGreaterThan(skillSum(prev));
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

describe('starter archetypes — generation', () => {
  it('every archetype generates at every tier, cleanly and reproducibly', () => {
    for (const a of STARTER_ARCHETYPES) {
      for (const tierId of STARTER_TIER_IDS) {
        const npc = npcAt(a, tierId, 20760612);
        const again = npcAt(a, tierId, 20760612);
        expect(again, `${a.id}/${tierId} not reproducible`).toEqual(npc);
        expect(npc.corrections, `${a.id}/${tierId} needed clamping`).toEqual([]);
        expect(() => SheetV1Schema.parse(npc.sheet), `${a.id}/${tierId}`).not.toThrow();
        expect(npc.name.length).toBeGreaterThan(0);
        expect(npc.tierId).toBe(tierId);
      }
    }
  });

  it('every loadout option resolves against the archetype own records', () => {
    for (const a of STARTER_ARCHETYPES) {
      for (const tierId of STARTER_TIER_IDS) {
        for (let seed = 0; seed < 12; seed++) {
          const npc = npcAt(a, tierId, 9000 + seed);
          for (const g of npc.sheet.gear) {
            expect(g.note?.startsWith('slot: ') ?? false, `${a.id}/${tierId}: unresolved "${g.name}"`).toBe(false);
          }
          expect(npc.sheet.weapons.length, `${a.id}/${tierId} has no weapon`).toBeGreaterThan(0);
          expect(npc.sheet.armor.filter((r) => r.worn).length, `${a.id}/${tierId} wears no armor`).toBeGreaterThan(0);
          for (const w of npc.sheet.weapons) {
            expect(w.dv, `${a.id}: ${w.name} has no damage code`).toBeTruthy();
            expect(w.acc, `${a.id}: ${w.name} has no accuracy`).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it('stays inside the declared curves over 200 samples per archetype', () => {
    for (const a of STARTER_ARCHETYPES) {
      for (let i = 0; i < 200; i++) {
        const tierId = STARTER_TIER_IDS[i % STARTER_TIER_IDS.length] as string;
        const tier = tierOf(a, tierId);
        const npc = npcAt(a, tierId, 1_000_000 + i);
        const where = `${a.id}/${tierId}#${i}`;

        for (const [code, r] of Object.entries(tier.attributes)) {
          const got = (npc.sheet.attributes as unknown as Record<string, number>)[code];
          expect(got, `${where} attr ${code}`).toBeGreaterThanOrEqual(r.min);
          expect(got, `${where} attr ${code}`).toBeLessThanOrEqual(r.max);
        }
        for (const [id, r] of Object.entries(tier.skills)) {
          const got = npc.sheet.skills.find((s) => s.id === id)?.rating;
          expect(got, `${where} skill ${id} missing`).toBeDefined();
          expect(got as number, `${where} skill ${id}`).toBeGreaterThanOrEqual(r.min);
          expect(got as number, `${where} skill ${id}`).toBeLessThanOrEqual(r.max);
        }
        expect(npc.professionalRating, `${where} PR`).toBeGreaterThanOrEqual(tier.professionalRating.min);
        expect(npc.professionalRating, `${where} PR`).toBeLessThanOrEqual(tier.professionalRating.max);
        expect(Object.keys(tier.metatypeWeights ?? {}), `${where} metatype`).toContain(npc.metatype);
      }
    }
  });

  it('grunt groups share one statblock and carry distinct faces', () => {
    const halo = starterArchetype('street-ganger') as StarterArchetype;
    const group = generateGruntGroup(halo.gen, 'blooded', 4, 'alley-4', { catalog: starterCatalog(halo) });
    expect(group.members).toHaveLength(4);
    expect(new Set(group.members.map((m) => m.name)).size).toBe(4);
    for (const m of group.members) {
      expect(m.sheet.attributes).toEqual(group.statblock.attributes);
      expect(m.sheet.skills).toEqual(group.statblock.skills);
    }
  });

  it('awakened and resonant archetypes actually get their special attribute', () => {
    const mage = starterArchetype('combat-mage') as StarterArchetype;
    const decker = starterArchetype('grid-decker') as StarterArchetype;
    for (const tierId of STARTER_TIER_IDS) {
      const m = npcAt(mage, tierId, 4242);
      expect(m.sheet.attributes.mag, `mage/${tierId}`).toBeGreaterThan(0);
      expect(m.sheet.spells.length, `mage/${tierId}`).toBeGreaterThan(0);
      const spellPool = deriveCharacter(m.sheet).pools[`spell.${m.sheet.spells[0]!.name}`]?.total ?? 0;
      expect(spellPool, `mage/${tierId} spell pool`).toBeGreaterThanOrEqual(m.sheet.attributes.mag);

      const d = npcAt(decker, tierId, 4242);
      expect(d.sheet.attributes.res, `decker/${tierId}`).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Derivation: every rung is playable
// ---------------------------------------------------------------------------

describe('starter archetypes — derive cleanly and land in sane bands', () => {
  it('limits, monitors, initiative, defence and soak all compute at every rung', () => {
    for (const a of STARTER_ARCHETYPES) {
      const civilian = a.gen.roleTags.includes('civilian');
      for (const tierId of STARTER_TIER_IDS) {
        for (let seed = 0; seed < 24; seed++) {
          const npc = npcAt(a, tierId, 500_000 + seed);
          const d = deriveCharacter(npc.sheet);
          const where = `${a.id}/${tierId}#${seed}`;

          for (const kind of ['physical', 'mental', 'social'] as const) {
            const v = d.limits[kind].value;
            expect(v, `${where} limit.${kind}`).toBeGreaterThanOrEqual(1);
            expect(v, `${where} limit.${kind}`).toBeLessThanOrEqual(12);
          }

          expect(d.monitors.physical.value, `${where} physical monitor`).toBeGreaterThanOrEqual(9);
          expect(d.monitors.physical.value, `${where} physical monitor`).toBeLessThanOrEqual(14);
          expect(d.monitors.stun.value, `${where} stun monitor`).toBeGreaterThanOrEqual(9);
          expect(d.monitors.stun.value, `${where} stun monitor`).toBeLessThanOrEqual(14);
          expect(d.monitors.overflow.value, `${where} overflow`).toBe(npc.sheet.attributes.bod);
          expect(npc.monitors.physical, `${where} generator monitors agree`).toBe(d.monitors.physical.value);

          expect(d.initiative.physical.base.value, `${where} init base`).toBeGreaterThanOrEqual(4);
          expect(d.initiative.physical.base.value, `${where} init base`).toBeLessThanOrEqual(16);
          expect(d.initiative.physical.dice.value, `${where} init dice`).toBe(1);
          expect(d.initiative.astral.dice.value, `${where} astral dice`).toBe(2);

          const defense = d.pools['defense']?.total ?? 0;
          expect(defense, `${where} defense`).toBeGreaterThanOrEqual(4);
          expect(defense, `${where} defense`).toBeLessThanOrEqual(16);

          const soak = d.pools['soak']?.total ?? 0;
          expect(soak, `${where} soak`).toBeGreaterThanOrEqual(civilian ? 3 : 8);
          expect(soak, `${where} soak`).toBeLessThanOrEqual(24);

          expect(d.movement.walk.value, `${where} walk`).toBeGreaterThan(0);
          for (const skill of npc.sheet.skills) {
            const p = d.pools[`skill.${skill.id}`]?.total;
            expect(p, `${where} pool for ${skill.id}`).toBeDefined();
            expect(p as number, `${where} pool for ${skill.id}`).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it('the elite rung out-fights, out-soaks and out-lasts the street rung', () => {
    for (const a of STARTER_ARCHETYPES) {
      const sample = (tierId: string) => {
        const attack: number[] = [];
        const soak: number[] = [];
        const defense: number[] = [];
        for (let seed = 0; seed < 40; seed++) {
          const npc = npcAt(a, tierId, 700_000 + seed);
          const d = deriveCharacter(npc.sheet);
          attack.push(bestAttackPool(npc.sheet));
          soak.push(d.pools['soak']?.total ?? 0);
          defense.push(d.pools['defense']?.total ?? 0);
        }
        return { attack: median(attack), soak: median(soak), defense: median(defense) };
      };
      const lo = sample('street');
      const hi = sample('elite');
      expect(hi.attack, `${a.id} attack street ${lo.attack} → elite ${hi.attack}`).toBeGreaterThanOrEqual(lo.attack + 3);
      expect(hi.soak, `${a.id} soak`).toBeGreaterThan(lo.soak);
      expect(hi.defense, `${a.id} defense`).toBeGreaterThan(lo.defense);
    }
  });
});

// ---------------------------------------------------------------------------
// The table test: speed bump vs genuine threat
// ---------------------------------------------------------------------------

describe('starter archetypes — what they feel like across the table', () => {
  it('a street ganger is a speed bump against a starting runner', () => {
    const ganger = starterArchetype('street-ganger') as StarterArchetype;
    const boxes: number[] = [];
    for (let seed = 0; seed < 40; seed++) {
      const npc = npcAt(ganger, 'street', 800_000 + seed);
      const est = bestExchange(npc.sheet, STARTING_RUNNER);
      expect(est.connects, `seed ${seed}: ${est.summary}`).toBe(false);
      boxes.push(est.boxesPerConnect);
    }
    expect(mean(boxes)).toBe(0);
  });

  it('an elite fighter is genuinely dangerous to a starting runner', () => {
    const dangerous = ['corp-close-protection', 'wired-enforcer', 'contract-shooter', 'combat-adept'];
    for (const id of dangerous) {
      const a = starterArchetype(id) as StarterArchetype;
      const boxes: number[] = [];
      for (let seed = 0; seed < 40; seed++) {
        const npc = npcAt(a, 'elite', 810_000 + seed);
        const est = bestExchange(npc.sheet, STARTING_RUNNER);
        expect(est.connects, `${id} seed ${seed}: ${est.summary}`).toBe(true);
        expect(est.boxesPerConnect, `${id} seed ${seed}: ${est.summary}`).toBeGreaterThanOrEqual(2.5);
        boxes.push(est.boxesPerConnect);
      }
      expect(mean(boxes), `${id} mean boxes per connect`).toBeGreaterThanOrEqual(3);
    }
  });

  it('a corporate site response team escalates a lobby watch by a whole encounter', () => {
    const guard = starterArchetype('corp-guard') as StarterArchetype;
    const lobby = npcAt(guard, 'street', 12345);
    const response = npcAt(guard, 'elite', 12345);
    const lobbyEst = bestExchange(lobby.sheet, STARTING_RUNNER);
    const responseEst = bestExchange(response.sheet, STARTING_RUNNER);
    expect(responseEst.attackPool).toBeGreaterThan(lobbyEst.attackPool + 4);
    expect(responseEst.boxesPerConnect).toBeGreaterThan(lobbyEst.boxesPerConnect);
  });
});
