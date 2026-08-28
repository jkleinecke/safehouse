import { describe, expect, it } from 'vitest';
import type { RangeTables, SceneEnvironment } from '@safehouse/contracts';
import { environment, rangeModifier } from '../src/index.js';

function scene(over: Partial<SceneEnvironment> = {}): SceneEnvironment {
  return { light: 0, visibility: 0, glare: 0, wind: 0, ...over };
}

describe('environment (FR9.11, §10.2)', () => {
  it('clear conditions emit no modifier', () => {
    expect(environment(scene())).toEqual([]);
  });

  it('maps single-axis tiers to −1 / −3 / −6', () => {
    expect(environment(scene({ light: 1 }))[0]?.value).toBe(-1);
    expect(environment(scene({ visibility: 2 }))[0]?.value).toBe(-3);
    expect(environment(scene({ wind: 3 }))[0]?.value).toBe(-6);
  });

  it('uses the single worst axis when levels differ', () => {
    const [m] = environment(scene({ light: 3, visibility: 1, glare: 1 }));
    expect(m?.value).toBe(-6);
  });

  it('escalates one tier when two axes share the worst level', () => {
    expect(environment(scene({ light: 1, glare: 1 }))[0]?.value).toBe(-3);
    expect(environment(scene({ light: 2, visibility: 2 }))[0]?.value).toBe(-6);
    expect(environment(scene({ light: 3, wind: 3 }))[0]?.value).toBe(-10);
  });

  it('caps at −10 even with every axis maxed', () => {
    const [m] = environment(scene({ light: 3, visibility: 3, glare: 3, wind: 3 }));
    expect(m?.value).toBe(-10);
  });

  it('emits a well-formed scene Modifier aimed at pool.all', () => {
    const [m] = environment(scene({ light: 2 }));
    expect(m).toMatchObject({
      source: { kind: 'scene' },
      target: 'pool.all',
      op: 'add',
      active: true,
    });
    expect(m?.note).toContain('light 2');
  });
});

describe('rangeModifier (FR9.9, §10.2)', () => {
  const tables: RangeTables = { assault_rifle: [25, 150, 350, 550], pistol: [5, 15, 30, 50] };

  it('short/medium/long/extreme map to 0/−1/−3/−6', () => {
    expect(rangeModifier(10, 'assault_rifle', tables)?.value).toBe(0);
    expect(rangeModifier(100, 'assault_rifle', tables)?.value).toBe(-1);
    expect(rangeModifier(300, 'assault_rifle', tables)?.value).toBe(-3);
    expect(rangeModifier(500, 'assault_rifle', tables)?.value).toBe(-6);
  });

  it('band edges are inclusive upper bounds', () => {
    expect(rangeModifier(25, 'assault_rifle', tables)?.value).toBe(0);
    expect(rangeModifier(26, 'assault_rifle', tables)?.value).toBe(-1);
    expect(rangeModifier(150, 'assault_rifle', tables)?.value).toBe(-1);
    expect(rangeModifier(151, 'assault_rifle', tables)?.value).toBe(-3);
    expect(rangeModifier(350, 'assault_rifle', tables)?.value).toBe(-3);
    expect(rangeModifier(351, 'assault_rifle', tables)?.value).toBe(-6);
    expect(rangeModifier(550, 'assault_rifle', tables)?.value).toBe(-6);
  });

  it('returns null beyond extreme, for unknown categories, and negative distances', () => {
    expect(rangeModifier(551, 'assault_rifle', tables)).toBeNull();
    expect(rangeModifier(10, 'sniper_rifle', tables)).toBeNull();
    expect(rangeModifier(-1, 'pistol', tables)).toBeNull();
  });

  it('emits a range Modifier aimed at pool.all with the category as ref', () => {
    const m = rangeModifier(20, 'pistol', tables);
    expect(m).toMatchObject({
      source: { kind: 'range', ref: 'pistol' },
      target: 'pool.all',
      op: 'add',
      value: -3,
      active: true,
    });
    expect(m?.note).toContain('long');
  });
});
