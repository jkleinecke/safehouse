/**
 * The Fixer's dock stays clear of the bottom bars (FR12.1): above the phone's
 * bottom navigation everywhere, above the builder's pools bar too on its
 * walkthrough, and in the plain corner once neither shows.
 */
import { describe, expect, it } from 'vitest';
import { dockPlacement, isBuildWalkthrough } from './dockPlacement.js';

describe('dockPlacement', () => {
  it('knows the walkthrough from the builds list', () => {
    expect(isBuildWalkthrough('/c/c1/build/0b8d7c1e')).toBe(true);
    expect(isBuildWalkthrough('/c/c1/build')).toBe(false);
    expect(isBuildWalkthrough('/c/c1/gm')).toBe(false);
  });

  it('lifts the dock over the bottom navigation on a phone, and over the pools bar on the builder', () => {
    const plain = dockPlacement('/c/c1/gm');
    expect(plain).toContain('bottom-[calc(4rem+env(safe-area-inset-bottom))]');
    expect(plain).toContain('md:bottom-4');
    const builder = dockPlacement('/c/c1/build/0b8d7c1e');
    expect(builder).toContain('bottom-[calc(7.5rem+env(safe-area-inset-bottom))]');
    expect(builder).toContain('md:bottom-[4.5rem]');
    expect(builder).toContain('lg:bottom-4');
  });
});
