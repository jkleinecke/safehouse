/**
 * The build stamp (`/healthz`, the boot log, the page footer): an image
 * answers from its environment, a checkout from git, and nothing else can
 * make the server fail to boot.
 */
import { describe, expect, it } from 'vitest';
import { buildInfoFrom, gitVersion } from '../src/version.js';

describe('buildInfoFrom', () => {
  it('trusts the stamp an image was built with', () => {
    expect(
      buildInfoFrom({ SAFEHOUSE_VERSION: 'abc1234', SAFEHOUSE_BUILT_AT: '2026-09-07T10:00:00Z' }, () => 'zzz9999'),
    ).toEqual({ version: 'abc1234', builtAt: '2026-09-07T10:00:00Z', source: 'image' });
  });

  it('keeps a stamp with no build time honest rather than inventing one', () => {
    expect(buildInfoFrom({ SAFEHOUSE_VERSION: 'abc1234' }, () => null).builtAt).toBeNull();
  });

  it('asks git when there is no stamp — a checkout has no build time', () => {
    expect(buildInfoFrom({}, () => 'abc1234-dirty')).toEqual({
      version: 'abc1234-dirty',
      builtAt: null,
      source: 'checkout',
    });
    // A blank stamp is no stamp: compose passes `${SAFEHOUSE_VERSION:-}` through.
    expect(buildInfoFrom({ SAFEHOUSE_VERSION: '   ' }, () => 'abc1234').source).toBe('checkout');
  });

  it('is `dev` with neither, and never throws', () => {
    expect(buildInfoFrom({}, () => null)).toEqual({ version: 'dev', builtAt: null, source: 'unknown' });
  });
});

describe('gitVersion', () => {
  it('names this checkout as a short commit, dirty-flagged or not', () => {
    // The suite runs inside the repository, so git has an answer here.
    expect(gitVersion()).toMatch(/^[0-9a-f]{7,}(-dirty)?$/);
  });

  it('is null outside a repository instead of failing the boot', () => {
    // A directory that exists and is not a git checkout — the image case.
    expect(gitVersion(process.platform === 'win32' ? 'C:\\' : '/')).toBeNull();
  });
});
