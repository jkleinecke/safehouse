import { describe, expect, it } from 'vitest';
import {
  ModifierSchema,
  RollRequestSchema,
  RollResultSchema,
  VisibilitySchema,
  RoleSchema,
} from '../src/index.js';

describe('RollRequestSchema', () => {
  it('round-trips a full request', () => {
    const input = {
      kind: 'opposed',
      pool: 11,
      breakdown: [
        { label: 'INT', value: 4 },
        { label: 'Perception', value: 3 },
        { label: 'Vigilance', value: 2, source: 'quality' },
        { label: 'dim light', value: -1, source: 'scene' },
      ],
      limit: { kind: 'mental', value: 6 },
      edge: 'push_pre',
      visibility: 'gm_owner',
      actor: { characterId: 'chr_1' },
      meta: { opposedRollId: 'roll_9' },
    };
    const once = RollRequestSchema.parse(input);
    expect(RollRequestSchema.parse(once)).toEqual(once);
    expect(once.limit?.kind).toBe('mental');
  });

  it('applies defaults (kind simple, public, empty breakdown)', () => {
    const req = RollRequestSchema.parse({ pool: 8 });
    expect(req.kind).toBe('simple');
    expect(req.visibility).toBe('public');
    expect(req.breakdown).toEqual([]);
    expect(req.actor).toEqual({});
  });

  it('accepts edge: null and rejects unknown edge actions', () => {
    expect(RollRequestSchema.parse({ pool: 5, edge: null }).edge).toBeNull();
    expect(RollRequestSchema.safeParse({ pool: 5, edge: 'blitz' }).success).toBe(false);
  });

  it('rejects negative pools', () => {
    expect(RollRequestSchema.safeParse({ pool: -1 }).success).toBe(false);
  });
});

describe('RollResultSchema', () => {
  it('round-trips a result with explosions', () => {
    const input = {
      faces: [6, 6, 5, 3, 1, 1, 1],
      hits: 3,
      ones: 3,
      glitch: 'none',
      limitedHits: 3,
      exploded: [6, 2],
    };
    const once = RollResultSchema.parse(input);
    expect(RollResultSchema.parse(once)).toEqual(once);
  });

  it('rejects faces outside 1..6', () => {
    expect(
      RollResultSchema.safeParse({ faces: [7], hits: 0, ones: 0, glitch: 'none', limitedHits: 0 })
        .success,
    ).toBe(false);
  });

  it('rejects unknown glitch states', () => {
    expect(
      RollResultSchema.safeParse({ faces: [1], hits: 0, ones: 1, glitch: 'oops', limitedHits: 0 })
        .success,
    ).toBe(false);
  });
});

describe('Modifier / Visibility / Role', () => {
  it('round-trips a modifier', () => {
    const mod = ModifierSchema.parse({
      id: 'm1',
      source: { kind: 'scene', ref: 'scene_2' },
      target: 'pool.all',
      op: 'add',
      value: -3,
      active: true,
      note: 'heavy rain',
    });
    expect(ModifierSchema.parse(mod)).toEqual(mod);
  });

  it('rejects unknown source kinds and ops', () => {
    expect(
      ModifierSchema.safeParse({
        id: 'm2',
        source: { kind: 'vibes' },
        target: 'pool.all',
        op: 'add',
        value: 1,
        active: true,
      }).success,
    ).toBe(false);
    expect(
      ModifierSchema.safeParse({
        id: 'm3',
        source: { kind: 'wound' },
        target: 'pool.all',
        op: 'mul',
        value: 2,
        active: true,
      }).success,
    ).toBe(false);
  });

  it('enumerates visibility and roles exactly', () => {
    expect(VisibilitySchema.options).toEqual(['public', 'gm', 'gm_owner']);
    expect(RoleSchema.options).toEqual(['gm', 'player', 'observer', 'display']);
  });
});
