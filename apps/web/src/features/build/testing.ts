/**
 * Fixtures for the builder's node tests — invented runners only (DESIGN.md
 * §14: no book characters, no book names).
 *
 * Builds are made the way the app makes them — `emptyBuild` at the
 * campaign's settings, a concept card applied with `applyConcept` — so a test
 * asserting on the rail or the strip is asserting on what the engine really
 * answers, not on numbers typed into a fixture. Not imported by app code.
 */
import { ChargenSettingsSchema, type CharacterBuild, type ChargenSettings } from '@safehouse/contracts';
import { applyConcept, conceptPreset, emptyBuild } from '@safehouse/rules';
import type { CatalogueHit } from '../sheet/catalogue/toSheet.js';
import { analyseBuild, type BuildAnalysis } from './analysis.js';
import type { BuildRecord } from './api.js';

export const CAMPAIGN = 'c1';
export const BUILD_ID = '0b8d7c1e-5f7a-4c41-9d33-2a6c0e1f4b21';
export const PLAYER_ID = 'u-player';

export const SETTINGS: ChargenSettings = ChargenSettingsSchema.parse({});

/** A blank draft for an invented runner. */
export function blankBuild(alias = 'Kestrel Vane'): CharacterBuild {
  return emptyBuild(SETTINGS, { alias });
}

/** A draft with a concept card applied — every pool filled the way the card suggests. */
export function conceptBuild(conceptId = 'muscle', alias = 'Kestrel Vane'): CharacterBuild {
  const preset = conceptPreset(conceptId);
  if (!preset) throw new Error(`no concept ${conceptId}`);
  return applyConcept(blankBuild(alias), preset, SETTINGS);
}

/** A build row as the server would send it. */
export function recordOf(build: CharacterBuild, over: Partial<BuildRecord> = {}): BuildRecord {
  return {
    id: BUILD_ID,
    campaignId: CAMPAIGN,
    ownerUserId: PLAYER_ID,
    state: build.state,
    build,
    notes: build.notes,
    createdAt: '2026-09-14T10:00:00.000Z',
    updatedAt: '2026-09-14T10:00:00.000Z',
    characterId: null,
    ...over,
  };
}

export function analysisOf(build: CharacterBuild, settings: ChargenSettings = SETTINGS): BuildAnalysis {
  return analyseBuild(build, settings);
}

/**
 * A catalogue row as the search route sends it — an invented one: every name
 * and number a test gives it is ours, never a book's (§14).
 */
export function catalogueHit(over: Partial<CatalogueHit> = {}): CatalogueHit {
  const bookCode = over.bookCode ?? 'SR5';
  const printedPage = over.printedPage ?? 400;
  return {
    id: 'hit-1',
    bookId: 'book-1',
    bookCode,
    printedPage,
    kind: 'gear',
    category: '',
    name: 'Invented Thing',
    stats: {},
    avail: null,
    cost: null,
    costText: null,
    title: 'Core',
    pdfPage: printedPage + 5,
    ref: { book: bookCode, page: printedPage },
    readUrl: `/read/${bookCode}?p=${printedPage}`,
    ...over,
  };
}
