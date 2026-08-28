/**
 * Fixture builders for the M12 (Fixer) suites: a small campaign with two PCs,
 * a live fight with real monitor state, an active scene with a hidden token
 * and a named fog region, and one NPC archetype template the generator can
 * roll from. Everything here is original content (G6/§14).
 */
import { SheetV1Schema, type SheetV1 } from '@safehouse/contracts';
import {
  characters,
  combatants,
  encounters,
  npcTemplates,
  scenes,
  tokens,
  wikiPages,
  type Db,
} from '@safehouse/db';

export function makeSheet(alias: string, overrides: Partial<Record<string, number>> = {}): SheetV1 {
  return SheetV1Schema.parse({
    v: 1,
    identity: { alias, metatype: 'human' },
    attributes: {
      bod: overrides['bod'] ?? 4,
      agi: overrides['agi'] ?? 5,
      rea: overrides['rea'] ?? 4,
      str: overrides['str'] ?? 3,
      wil: overrides['wil'] ?? 4,
      log: overrides['log'] ?? 3,
      int: overrides['int'] ?? 4,
      cha: overrides['cha'] ?? 3,
      edg: { max: 4, current: overrides['edge'] ?? 2 },
    },
    skills: [
      { id: 'firearms.pistols', rating: 5, attr: 'agi' },
      { id: 'perception', rating: 3, attr: 'int' },
    ],
  });
}

function monitors(physicalFilled: number, stunFilled: number) {
  return {
    physical: { max: 10, filled: physicalFilled },
    stun: { max: 10, filled: stunFilled },
    overflow: { max: 4, filled: 0 },
  };
}

export interface FixerFixture {
  staticId: string;
  kestrelId: string;
  encounterId: string;
  sceneId: string;
  templateId: string;
  hiddenTokenName: string;
  fogRegionId: string;
}

/** Two PCs (Static is badly hurt), a live encounter, an active scene, a template. */
export async function seedFixerFixture(db: Db, campaignId: string): Promise<FixerFixture> {
  const staticRow = (
    await db
      .insert(characters)
      .values({ campaignId, name: 'Static', sheet: makeSheet('Static') })
      .returning()
  )[0]!;
  const kestrelRow = (
    await db
      .insert(characters)
      .values({ campaignId, name: 'Kestrel', sheet: makeSheet('Kestrel', { bod: 3, wil: 5 }) })
      .returning()
  )[0]!;

  const scene = (
    await db
      .insert(scenes)
      .values({
        campaignId,
        name: 'Rooftop, Redmond',
        state: 'active',
        grid: { unitM: 1, cols: 20, rows: 20, offset: { x: 0, y: 0 } },
        // Severity tiers 0..3 (the engine maps them to -1/-3/-6/-10).
        environment: { light: 2, visibility: 1, glare: 0, wind: 1, note: 'sheeting rain' },
        geometry: { walls: [], doors: [], zones: [], pins: [] },
        fog: {
          regions: [
            {
              id: 'region-stairwell',
              name: 'stairwell',
              polygon: [
                { x: 0, y: 0 },
                { x: 4, y: 0 },
                { x: 4, y: 4 },
              ],
            },
          ],
          revealed: [],
          revealedShapes: [],
        },
      })
      .returning()
  )[0]!;

  const hiddenTokenName = 'Watcher on the water tower';
  await db.insert(tokens).values([
    { sceneId: scene.id, source: 'character', sourceId: staticRow.id, name: 'Static', x: 2, y: 3 },
    { sceneId: scene.id, source: 'prop', name: hiddenTokenName, x: 9, y: 1, hidden: true },
  ]);

  const encounter = (
    await db
      .insert(encounters)
      .values({
        campaignId,
        sceneId: scene.id,
        name: 'Rooftop ambush',
        state: 'live',
        turn: 2,
        pass: 1,
      })
      .returning()
  )[0]!;

  await db.insert(combatants).values([
    {
      encounterId: encounter.id,
      source: 'character',
      sourceId: staticRow.id,
      name: 'Static',
      initBase: 8,
      initScore: 17,
      monitors: monitors(7, 1),
      actedThisPass: true,
      visibility: 'public',
    },
    {
      encounterId: encounter.id,
      source: 'character',
      sourceId: kestrelRow.id,
      name: 'Kestrel',
      initBase: 9,
      initScore: 14,
      monitors: monitors(0, 2),
      visibility: 'public',
    },
    {
      encounterId: encounter.id,
      source: 'manual',
      name: 'Ganger with the shotgun',
      initBase: 6,
      initScore: 11,
      monitors: monitors(2, 0),
      visibility: 'gm',
    },
  ]);

  const template = (
    await db
      .insert(npcTemplates)
      .values({
        campaignId,
        name: 'Street enforcer',
        statblock: {},
        gen: {
          roleTags: ['muscle'],
          tiers: [
            {
              id: 'street',
              label: 'Street',
              attributes: {
                bod: { min: 4, max: 5 },
                agi: { min: 3, max: 4 },
                rea: { min: 3, max: 4 },
                str: { min: 4, max: 5 },
                wil: { min: 3, max: 3 },
                log: { min: 2, max: 3 },
                int: { min: 3, max: 3 },
                cha: { min: 2, max: 3 },
              },
              skills: { 'firearms.pistols': { min: 3, max: 4 } },
              professionalRating: { min: 1, max: 2 },
              metatypeWeights: { human: 3, ork: 1 },
              loadout: [],
              spells: [],
              augments: [],
            },
          ],
        },
        persona: {},
      })
      .returning()
  )[0]!;

  await db.insert(wikiPages).values({
    campaignId,
    title: 'Mister Kavanagh',
    contentMd: 'The Johnson is not who he says he is.',
    visibility: 'gm',
    tags: ['johnson'],
  });

  return {
    staticId: staticRow.id,
    kestrelId: kestrelRow.id,
    encounterId: encounter.id,
    sceneId: scene.id,
    templateId: template.id,
    hiddenTokenName,
    fogRegionId: 'region-stairwell',
  };
}

/** Point the server at a mock inference box for one test. */
export function enableAi(baseUrl: string): void {
  process.env.LLM_BASE_URL = baseUrl;
  process.env.LLM_MODEL_PRIMARY = 'mock-primary';
  process.env.LLM_MODEL_FAST = 'mock-fast';
}

export function disableAi(): void {
  delete process.env.LLM_BASE_URL;
  delete process.env.LLM_MODEL_PRIMARY;
  delete process.env.LLM_MODEL_FAST;
}
