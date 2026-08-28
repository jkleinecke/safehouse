/**
 * Live campaign-state readers behind the Fixer's tool catalog (FR12.17).
 *
 * Never raw table rows: every read returns the engine-derived view the table
 * actually plays with — pools with provenance, current monitors, wound
 * modifiers applied — queried live at call time, so mid-combat "who's hurt
 * worst?" reflects this pass, not the last save. These functions are also the
 * substrate for the situation snapshot (FR12.18).
 *
 * All of it is the GM's own surface (only the GM can talk to the Fixer, §13),
 * so hidden tokens and gm-visibility combatants are included — filtered on the
 * way out to players by the hub, never here.
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { DerivedCharacter, SceneEnvironment, SheetV1 } from '@safehouse/contracts';
import { deriveCharacter } from '@safehouse/rules';
import {
  characters,
  combatants,
  encounters,
  ledgerEntries,
  ledgerBalance,
  npcTemplates,
  recentEvents,
  scenes,
  searchBookPages,
  tokens,
  wikiPages,
  type Db,
} from '@safehouse/db';
import { serializeScene, serializeToken } from '../services/scenes.js';
import { httpError } from '../services/auth.js';
import {
  NO_WOUNDS,
  activeSceneRow,
  effectNames,
  liveEncounterRow,
  monitorsOf,
  sheetOf,
  woundsOf,
  type Wounds,
} from './state-core.js';

export * from './state-core.js';

// ---------------------------------------------------------------------------
// Characters (live: wounds from the running encounter feed the derivation)
// ---------------------------------------------------------------------------

/** Wounds per characterId, taken from the live encounter's combatant rows. */
export async function liveWounds(db: Db, campaignId: string): Promise<Map<string, Wounds>> {
  const encounter = await liveEncounterRow(db, campaignId);
  const out = new Map<string, Wounds>();
  if (!encounter) return out;
  const rows = await db
    .select()
    .from(combatants)
    .where(and(eq(combatants.encounterId, encounter.id), eq(combatants.source, 'character')));
  for (const row of rows) {
    if (row.sourceId) out.set(row.sourceId, woundsOf(row.monitors));
  }
  return out;
}

export interface CharacterSummary {
  id: string;
  name: string;
  alias: string;
  metatype: string;
  ownerUserId: string | null;
  status: string;
  wounds: Wounds;
  monitors: { physical: number; stun: number; overflow: number };
  edge: { max: number; current: number };
  woundModifier: number;
}

export interface CharacterState extends CharacterSummary {
  /** Full deriveCharacter output — pools/limits/initiative with provenance. */
  derived: DerivedCharacter;
  conditions: string[];
  balances: { karma: number; nuyen: number };
}

function summarize(
  id: string,
  name: string,
  ownerUserId: string | null,
  status: string,
  sheet: SheetV1,
  wounds: Wounds,
  derived: DerivedCharacter,
): CharacterSummary {
  return {
    id,
    name,
    alias: sheet.identity.alias,
    metatype: sheet.identity.metatype,
    ownerUserId,
    status,
    wounds,
    monitors: {
      physical: derived.monitors.physical.value,
      stun: derived.monitors.stun.value,
      overflow: derived.monitors.overflow.value,
    },
    edge: { max: sheet.attributes.edg.max, current: sheet.attributes.edg.current },
    woundModifier: derived.woundModifier?.value ?? 0,
  };
}

export async function listCharactersState(db: Db, campaignId: string): Promise<CharacterSummary[]> {
  const rows = await db.select().from(characters).where(eq(characters.campaignId, campaignId));
  const wounds = await liveWounds(db, campaignId);
  const out: CharacterSummary[] = [];
  for (const row of rows) {
    const sheet = sheetOf(row.sheet);
    if (!sheet) continue;
    const w = wounds.get(row.id) ?? { ...NO_WOUNDS };
    const derived = deriveCharacter(sheet, { wounds: w });
    out.push(summarize(row.id, row.name, row.ownerUserId, row.status, sheet, w, derived));
  }
  return out;
}

export async function getCharacterState(
  db: Db,
  campaignId: string,
  characterId: string,
): Promise<CharacterState> {
  const row = (
    await db.select().from(characters).where(eq(characters.id, characterId)).limit(1)
  )[0];
  if (!row || row.campaignId !== campaignId) throw httpError(404, 'not_found', 'unknown character');
  const sheet = sheetOf(row.sheet);
  if (!sheet) throw httpError(422, 'bad_sheet', `character "${row.name}" has an unreadable sheet`);
  const wounds = (await liveWounds(db, campaignId)).get(row.id) ?? { ...NO_WOUNDS };
  const derived = deriveCharacter(sheet, { wounds });
  const encounter = await liveEncounterRow(db, campaignId);
  let conditions: string[] = [];
  if (encounter) {
    const combatant = (
      await db
        .select()
        .from(combatants)
        .where(and(eq(combatants.encounterId, encounter.id), eq(combatants.sourceId, row.id)))
        .limit(1)
    )[0];
    if (combatant) conditions = effectNames(combatant.effects);
  }
  return {
    ...summarize(row.id, row.name, row.ownerUserId, row.status, sheet, wounds, derived),
    derived,
    conditions,
    balances: await ledgerBalance(db, row.id),
  };
}

// ---------------------------------------------------------------------------
// Ledger (FR3.6 — who owes whom)
// ---------------------------------------------------------------------------

export interface LedgerState {
  characters: Array<{
    characterId: string;
    name: string;
    balances: { karma: number; nuyen: number };
    pending: { karma: number; nuyen: number };
    entries: Array<{
      id: string;
      currency: 'karma' | 'nuyen';
      delta: number;
      reason: string;
      state: string;
      createdAt: string;
    }>;
  }>;
}

export async function getLedgerState(
  db: Db,
  campaignId: string,
  opts: { characterId?: string; limit?: number } = {},
): Promise<LedgerState> {
  const rows = await db.select().from(characters).where(eq(characters.campaignId, campaignId));
  const wanted = opts.characterId ? rows.filter((r) => r.id === opts.characterId) : rows;
  if (opts.characterId && wanted.length === 0) {
    throw httpError(404, 'not_found', 'unknown character');
  }
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  const out: LedgerState['characters'] = [];
  for (const row of wanted) {
    const entries = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.characterId, row.id))
      .orderBy(desc(ledgerEntries.createdAt))
      .limit(limit);
    const approved = await ledgerBalance(db, row.id);
    const withPending = await ledgerBalance(db, row.id, { includePending: true });
    out.push({
      characterId: row.id,
      name: row.name,
      balances: approved,
      pending: {
        karma: withPending.karma - approved.karma,
        nuyen: withPending.nuyen - approved.nuyen,
      },
      entries: entries.map((e) => ({
        id: e.id,
        currency: e.currency,
        delta: e.delta,
        reason: e.reason,
        state: e.state,
        createdAt: e.createdAt.toISOString(),
      })),
    });
  }
  return { characters: out };
}

// ---------------------------------------------------------------------------
// Encounter (live order / pass / monitors)
// ---------------------------------------------------------------------------

export interface EncounterCombatantState {
  id: string;
  name: string;
  source: string;
  initScore: number;
  initBase: number;
  initKind: string;
  actedThisPass: boolean;
  visibility: string;
  monitors: { physical: { max: number; filled: number }; stun: { max: number; filled: number } } | null;
  /** Filled physical + stun boxes — the "hurt worst" sort key. */
  damageTaken: number;
  conditions: string[];
  hidden: boolean;
}

export interface EncounterState {
  id: string;
  name: string;
  state: string;
  turn: number;
  pass: number;
  sceneId: string | null;
  /** Highest initiative score that has not acted this pass. */
  upNext: { id: string; name: string; initScore: number } | null;
  order: EncounterCombatantState[];
  down: string[];
}

export async function getEncounterState(
  db: Db,
  campaignId: string,
  encounterId?: string,
): Promise<EncounterState> {
  const row = encounterId
    ? (await db.select().from(encounters).where(eq(encounters.id, encounterId)).limit(1))[0]
    : ((await liveEncounterRow(db, campaignId)) ??
      (
        await db
          .select()
          .from(encounters)
          .where(eq(encounters.campaignId, campaignId))
          .orderBy(desc(encounters.createdAt))
          .limit(1)
      )[0]);
  if (!row || row.campaignId !== campaignId) {
    throw httpError(404, 'not_found', 'no encounter to read');
  }
  const rows = await db.select().from(combatants).where(eq(combatants.encounterId, row.id));
  const order: EncounterCombatantState[] = rows
    .map((c) => {
      const monitors = monitorsOf(c.monitors);
      const physical = monitors?.physical ?? { max: 0, filled: 0 };
      const stun = monitors?.stun ?? { max: 0, filled: 0 };
      return {
        id: c.id,
        name: c.name,
        source: c.source,
        initScore: c.initScore,
        initBase: c.initBase,
        initKind: c.initKind,
        actedThisPass: c.actedThisPass,
        visibility: c.visibility,
        monitors: monitors ? { physical, stun } : null,
        damageTaken: physical.filled + stun.filled,
        conditions: effectNames(c.effects),
        hidden: c.visibility !== 'public',
      };
    })
    .sort((a, b) => b.initScore - a.initScore || a.name.localeCompare(b.name));
  const upNextRow = order.find((c) => !c.actedThisPass);
  return {
    id: row.id,
    name: row.name,
    state: row.state,
    turn: row.turn,
    pass: row.pass,
    sceneId: row.sceneId,
    upNext: upNextRow
      ? { id: upNextRow.id, name: upNextRow.name, initScore: upNextRow.initScore }
      : null,
    order,
    down: order
      .filter((c) => c.monitors !== null && c.monitors.physical.filled >= c.monitors.physical.max)
      .map((c) => c.name),
  };
}

// ---------------------------------------------------------------------------
// Scene (GM surface: environment, geometry, tokens including hidden ones)
// ---------------------------------------------------------------------------

export interface SceneState {
  id: string;
  name: string;
  state: string;
  environment: SceneEnvironment;
  grid: unknown;
  fog: { regions: Array<{ id: string; name: string; revealed: boolean }>; revealedShapes: number };
  tokens: Array<{
    id: string;
    name: string;
    source: string;
    sourceId: string | null;
    x: number;
    y: number;
    hidden: boolean;
  }>;
  notes?: string;
}

export async function getSceneState(
  db: Db,
  campaignId: string,
  sceneId?: string,
): Promise<SceneState> {
  const row = sceneId
    ? (await db.select().from(scenes).where(eq(scenes.id, sceneId)).limit(1))[0]
    : await activeSceneRow(db, campaignId);
  if (!row || row.campaignId !== campaignId) throw httpError(404, 'not_found', 'no scene to read');
  const scene = serializeScene(row);
  const tokenRows = await db.select().from(tokens).where(eq(tokens.sceneId, row.id));
  const revealed = new Set(scene.fog.revealed);
  return {
    id: scene.id,
    name: scene.name,
    state: scene.state,
    environment: scene.environment,
    grid: scene.grid,
    fog: {
      regions: scene.fog.regions.map((r) => ({
        id: r.id,
        name: r.name,
        revealed: revealed.has(r.id),
      })),
      revealedShapes: scene.fog.revealedShapes.length,
    },
    tokens: tokenRows.map((t) => {
      const token = serializeToken(t);
      return {
        id: token.id,
        name: token.name,
        source: token.source,
        sourceId: token.sourceId,
        x: token.x,
        y: token.y,
        hidden: token.hidden,
      };
    }),
    ...(scene.notes !== undefined ? { notes: scene.notes } : {}),
  };
}

// ---------------------------------------------------------------------------
// NPCs (statblock + persona)
// ---------------------------------------------------------------------------

export async function listNpcsState(db: Db, campaignId: string) {
  const rows = await db.select().from(npcTemplates).where(eq(npcTemplates.campaignId, campaignId));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    roleTags: readRoleTags(row.gen),
    hasPersona: Object.keys((row.persona ?? {}) as Record<string, unknown>).length > 0,
    pageRef: row.pageRef ?? null,
  }));
}

function readRoleTags(gen: unknown): string[] {
  if (typeof gen !== 'object' || gen === null) return [];
  const tags = (gen as Record<string, unknown>)['roleTags'];
  return Array.isArray(tags) ? tags.filter((t): t is string => typeof t === 'string') : [];
}

export async function getNpcState(db: Db, campaignId: string, npcId: string) {
  const row = (
    await db.select().from(npcTemplates).where(eq(npcTemplates.id, npcId)).limit(1)
  )[0];
  if (!row || row.campaignId !== campaignId) throw httpError(404, 'not_found', 'unknown npc');
  return {
    id: row.id,
    name: row.name,
    roleTags: readRoleTags(row.gen),
    statblock: row.statblock,
    persona: row.persona,
    pageRef: row.pageRef ?? null,
  };
}

// ---------------------------------------------------------------------------
// Session log + book retrieval
// ---------------------------------------------------------------------------

const LOG_PAYLOAD_CHARS = 400;

export async function getSessionLogState(db: Db, campaignId: string, limit = 30) {
  const rows = await recentEvents(db, campaignId, Math.min(Math.max(limit, 1), 100));
  return rows.map((row) => {
    const json = JSON.stringify(row.payload ?? null);
    return {
      id: row.id,
      type: row.type,
      ts: row.createdAt.toISOString(),
      visibility: row.visibility,
      payload: json.length > LOG_PAYLOAD_CHARS ? `${json.slice(0, LOG_PAYLOAD_CHARS)}…` : json,
    };
  });
}

/**
 * Rules retrieval (FR12.14/FR12.2). The citation is OURS, not the model's:
 * every hit carries the `{ book, page }` the passage actually came from, and
 * the caller renders those as ref chips regardless of what the model writes.
 */
export async function searchBooksState(
  db: Db,
  query: string,
  opts: { bookCode?: string; limit?: number } = {},
) {
  const hits = await searchBookPages(db, query, {
    ...(opts.bookCode !== undefined ? { bookCode: opts.bookCode } : {}),
    limit: Math.min(Math.max(opts.limit ?? 5, 1), 10),
  });
  return {
    query,
    hits: hits.map((hit) => ({
      ref: { book: hit.bookCode, page: hit.printedPage },
      snippet: hit.snippet,
      rank: Number(hit.rank.toFixed(4)),
    })),
    /** Cite ONLY these — provenance comes from retrieval, never from memory. */
    provenance: hits.map((hit) => ({ book: hit.bookCode, page: hit.printedPage })),
  };
}

/** GM-only names the spoiler guard (FR12.19) watches for in player-facing prose. */
export async function gmOnlyNames(db: Db, campaignId: string): Promise<string[]> {
  const names = new Set<string>();
  const pages = await db
    .select({ title: wikiPages.title, visibility: wikiPages.visibility })
    .from(wikiPages)
    .where(eq(wikiPages.campaignId, campaignId));
  for (const page of pages) {
    if (page.visibility !== 'public') names.add(page.title);
  }
  const sceneRows = await db
    .select({ id: scenes.id })
    .from(scenes)
    .where(eq(scenes.campaignId, campaignId));
  const sceneIds = sceneRows.map((s) => s.id);
  if (sceneIds.length > 0) {
    const hidden = await db
      .select({ name: tokens.name, hidden: tokens.hidden })
      .from(tokens)
      .where(inArray(tokens.sceneId, sceneIds));
    for (const token of hidden) if (token.hidden) names.add(token.name);
  }
  const encounterRows = await db
    .select({ id: encounters.id })
    .from(encounters)
    .where(eq(encounters.campaignId, campaignId));
  const encounterIds = encounterRows.map((e) => e.id);
  if (encounterIds.length > 0) {
    const hiddenCombatants = await db
      .select({ name: combatants.name, visibility: combatants.visibility })
      .from(combatants)
      .where(inArray(combatants.encounterId, encounterIds));
    for (const c of hiddenCombatants) if (c.visibility !== 'public') names.add(c.name);
  }
  return [...names].filter((n) => n.trim().length >= 3);
}
