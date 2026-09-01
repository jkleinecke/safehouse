/**
 * The starter library's data layer — pure reading and pure selection.
 *
 * The reader is deliberately shape-tolerant (the same posture as
 * `normalizeNpcResponse` in api.ts): an envelope mismatch must never reach a
 * GM as "there is no library". The selectors decide what reads as already
 * installed, which is the only thing standing between the browser and a GM
 * cheerfully installing four copies of the same archetype.
 *
 * Fixtures are ORIGINAL CONTENT written for this test — §14 forbids book stat
 * blocks and book archetype names, not starter content.
 */
import { describe, expect, it } from 'vitest';
import type { GenTemplate, NpcTemplate } from '@safehouse/contracts';
import { ApiError } from '../../../api/client.js';
import { copyName, draftFor, duplicateDraft } from './drafts.js';
import {
  archetypeLibraryPath,
  installStartersPath,
  installedStarterKeys,
  libraryUnavailable,
  missingStarterKeys,
  normalizeCatalog,
  normalizeInstalled,
  slugify,
  tierLadder,
} from './starters.js';

const CAMP = 'camp-1';
const r = (min: number, max: number) => ({ min, max });

function gen(): GenTemplate {
  const tier = (id: string, label: string, lo: number, hi: number) => ({
    id,
    label,
    attributes: { bod: r(lo, hi), agi: r(lo, hi), rea: r(lo, hi), str: r(lo, hi) },
    skills: { automatics: r(lo, hi) },
    professionalRating: r(lo - 1, lo),
    metatypeWeights: { human: 3, ork: 2 },
    loadout: [],
    spells: [],
    augments: [],
  });
  return {
    roleTags: ['muscle', 'ganger'],
    tiers: [tier('street', 'Street', 2, 3), tier('pro', 'Pro', 4, 5)],
  };
}

const RIPPERS: NpcTemplate = { id: 'tpl-rip', campaignId: CAMP, name: 'Ripper crew', gen: gen() };

const CATALOG_PAYLOAD = {
  archetypes: [
    {
      key: 'ripper-crew',
      name: 'Ripper crew',
      summary: 'Street muscle in numbers — the first fight of a run gone loud.',
      roleTags: ['muscle', 'ganger'],
      tiers: [
        { id: 'street', label: 'Street' },
        { id: 'pro', label: 'Pro' },
      ],
    },
    {
      // Deliberately the other shape: an NpcTemplate-ish entry with `gen`.
      name: 'Wire ghost',
      description: 'A quiet infiltrator for the half of a run that is not a fight.',
      gen: { roleTags: ['decker'], tiers: [{ id: 'street', label: 'Street' }] },
    },
  ],
};

describe('the catalog, whatever shape it arrives in', () => {
  /**
   * The route lands in the same round as this screen, from another agent. The
   * reader tolerates the plausible envelopes for the same reason
   * `normalizeNpcResponse` does: a wrapper mismatch should not read to the GM
   * as "there is no library".
   */
  it('reads an envelope, a bare array, and an entry that describes itself via gen', () => {
    const wrapped = normalizeCatalog(CATALOG_PAYLOAD);
    expect(wrapped.map((a) => a.name)).toEqual(['Ripper crew', 'Wire ghost']);
    expect(wrapped[0]?.tiers.map((t) => t.label)).toEqual(['Street', 'Pro']);
    // The gen-shaped entry still yields role tags, a summary and a ladder.
    expect(wrapped[1]?.roleTags).toEqual(['decker']);
    expect(wrapped[1]?.summary).toContain('infiltrator');
    expect(wrapped[1]?.key).toBe('wire-ghost');

    expect(normalizeCatalog(CATALOG_PAYLOAD.archetypes)).toHaveLength(2);
    expect(normalizeCatalog({ starters: CATALOG_PAYLOAD.archetypes })).toHaveLength(2);
    expect(normalizeCatalog({ library: { templates: CATALOG_PAYLOAD.archetypes } })).toHaveLength(2);
    // The envelope the server actually sends.
    expect(normalizeCatalog({ entries: CATALOG_PAYLOAD.archetypes })).toHaveLength(2);
  });

  it('drops junk instead of rendering a nameless row', () => {
    expect(normalizeCatalog(undefined)).toEqual([]);
    expect(normalizeCatalog({ archetypes: [null, 7, {}, { name: '' }] })).toEqual([]);
    // Two entries claiming one key is a catalog bug; the first wins.
    expect(normalizeCatalog([{ name: 'A', key: 'k' }, { name: 'B', key: 'k' }])).toHaveLength(1);
  });

  it('reads the installed copies back out of any of the usual envelopes', () => {
    expect(normalizeInstalled({ templates: [RIPPERS] })).toHaveLength(1);
    expect(normalizeInstalled({ installed: [RIPPERS] })).toHaveLength(1);
    expect(normalizeInstalled([RIPPERS])).toHaveLength(1);
    expect(normalizeInstalled({ ok: true })).toEqual([]);
  });

  it('slugs a missing key off the name', () => {
    expect(slugify('Ripper crew')).toBe('ripper-crew');
    expect(slugify('  Wire—Ghost 2 ')).toBe('wire-ghost-2');
  });
});

/**
 * The exact wire shape of `GET /api/campaigns/:id/archetype-library`, copied
 * from `toEntries` in `apps/server/src/services/archetypes.ts`. This is the
 * contract test: if the server's entry shape drifts, this fails here rather
 * than showing a GM sixteen archetypes that all claim to be uninstalled.
 */
const SERVER_LIBRARY = {
  entries: [
    {
      id: 'ripper-crew',
      name: 'Ripper crew',
      summary: 'Street muscle in numbers — the first fight of a run gone loud.',
      roleTags: ['muscle', 'ganger'],
      tiers: [
        { id: 'street', label: 'Street' },
        { id: 'pro', label: 'Pro' },
      ],
      installed: true,
      templateId: 'tpl-rip',
      installedAs: 'The Rippers, but mine',
    },
    {
      id: 'wire-ghost',
      name: 'Wire ghost',
      summary: 'A quiet infiltrator for the half of a run that is not a fight.',
      roleTags: ['decker'],
      tiers: [{ id: 'street', label: 'Street' }],
      installed: false,
      templateId: null,
      installedAs: null,
    },
  ],
  installedCount: 1,
  availableCount: 1,
};

describe('the server contract', () => {
  it('addresses the campaign-scoped routes the generator plugin serves', () => {
    expect(archetypeLibraryPath(CAMP)).toBe('/api/campaigns/camp-1/archetype-library');
    expect(installStartersPath(CAMP)).toBe('/api/campaigns/camp-1/archetype-library/install');
  });

  it('reads `entries`, carrying the id, the installed flag and the row it became', () => {
    const catalog = normalizeCatalog(SERVER_LIBRARY);
    expect(catalog.map((a) => a.key)).toEqual(['ripper-crew', 'wire-ghost']);
    expect(catalog[0]?.installed).toBe(true);
    expect(catalog[0]?.templateId).toBe('tpl-rip');
    expect(catalog[0]?.installedAs).toBe('The Rippers, but mine');
    // Nulls are absences, not values — they must not become templateId: "null".
    expect(catalog[1]?.installed).toBe(false);
    expect(catalog[1]?.templateId).toBeUndefined();
    expect(catalog[1]?.installedAs).toBeUndefined();
  });

  /**
   * The whole point of the server flag. The GM renamed their copy; matching on
   * the name would offer them a second one, and "install all" would duplicate
   * every archetype they had ever personalised.
   */
  it('believes the server over the name when the GM has renamed their copy', () => {
    const catalog = normalizeCatalog(SERVER_LIBRARY);
    const mine = [{ name: 'The Rippers, but mine' }];
    expect([...installedStarterKeys(catalog, mine)]).toEqual(['ripper-crew']);
    expect(missingStarterKeys(catalog, mine)).toEqual(['wire-ghost']);
  });

  /** An entry the server calls uninstalled stays offerable even on a name clash. */
  it('believes the server over a coincidental name match', () => {
    const catalog = normalizeCatalog(SERVER_LIBRARY);
    // A hand-authored template that happens to be called "Wire ghost".
    expect(missingStarterKeys(catalog, [{ name: 'Wire ghost' }])).toEqual(['wire-ghost']);
  });

  it('reads the rows the install call actually created out of `installed`', () => {
    expect(
      normalizeInstalled({ installed: [RIPPERS], alreadyInstalled: ['wire-ghost'], entries: [] }),
    ).toHaveLength(1);
    // A repeat install legitimately creates nothing.
    expect(
      normalizeInstalled({ installed: [], alreadyInstalled: ['ripper-crew'], entries: [] }),
    ).toEqual([]);
  });
});

describe('what this campaign already has', () => {
  const catalog = normalizeCatalog(CATALOG_PAYLOAD);

  it('marks an entry installed by name, ignoring case and stray spacing', () => {
    const mine = [{ name: '  ripper CREW ' }];
    expect([...installedStarterKeys(catalog, mine)]).toEqual(['ripper-crew']);
    expect(missingStarterKeys(catalog, mine)).toEqual(['wire-ghost']);
  });

  it('treats a renamed copy as gone, so re-installing gives a fresh one', () => {
    // Deliberate: an installed archetype is ordinary GM data. Once renamed it
    // is theirs, and the library stops claiming to own it.
    expect(installedStarterKeys(catalog, [{ name: 'The Rippers, but mine' }]).size).toBe(0);
    expect(missingStarterKeys(catalog, undefined)).toEqual(['ripper-crew', 'wire-ghost']);
  });

  it('shows the ladder as a ladder', () => {
    expect(tierLadder(catalog[0]!)).toBe('Street → Pro');
    expect(tierLadder({ tiers: [] })).toBe('');
  });

  it('treats a server with no library route as an older build, not an error', () => {
    expect(libraryUnavailable(new ApiError(404, 'not_found', 'nope'))).toBe(true);
    expect(libraryUnavailable(new ApiError(501, 'not_implemented', 'nope'))).toBe(true);
    expect(libraryUnavailable(new ApiError(500, 'boom', 'nope'))).toBe(false);
    expect(libraryUnavailable(new Error('offline'))).toBe(false);
  });
});



describe('forking an installed archetype', () => {
  it('drops the id so saving creates rather than overwrites', () => {
    const fork = duplicateDraft(RIPPERS, [RIPPERS]);
    expect(fork.id).toBeUndefined();
    expect(fork.name).toBe('Ripper crew (copy)');
    // Editing in place keeps the id — that is the PATCH path.
    expect(draftFor(RIPPERS).id).toBe('tpl-rip');
  });

  it('deep-copies the tiers so tuning the fork never edits the original', () => {
    const fork = duplicateDraft(RIPPERS, []);
    fork.gen!.tiers[0]!.professionalRating.max = 99;
    fork.gen!.roleTags.push('boss');
    expect(RIPPERS.gen!.tiers[0]!.professionalRating.max).not.toBe(99);
    expect(RIPPERS.gen!.roleTags).toEqual(['muscle', 'ganger']);
  });

  it('numbers repeated copies instead of stacking identical names', () => {
    const one = { name: 'Ripper crew' };
    expect(copyName('Ripper crew', [one])).toBe('Ripper crew (copy)');
    expect(copyName('Ripper crew', [one, { name: 'Ripper crew (copy)' }])).toBe(
      'Ripper crew (copy 2)',
    );
  });

  it('gives an archetype with no gen block a tier to edit rather than a blank form', () => {
    const bare = draftFor({ id: 'x', name: 'Promoted body' } as NpcTemplate);
    expect(bare.gen?.tiers).toHaveLength(1);
    expect(bare.gen?.tiers[0]?.attributes['bod']).toEqual({ min: 2, max: 4 });
  });
});
