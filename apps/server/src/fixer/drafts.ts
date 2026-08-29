/**
 * `ai_generations` — Principle 8's paper trail (FR12.15).
 *
 * EVERY write the Fixer proposes lands here as a `draft` first: nothing the
 * model produces reaches a played entity until the GM taps accept. Accepting
 * applies the draft, marks the entity AI-assisted, and stamps the generation
 * with what it became; rejecting just closes it. Reads (the FR12.17 catalog)
 * are free and leave no rows.
 *
 * The spoiler guard (FR12.19) runs over player-facing prose before the GM
 * publishes it, flagging GM-only names the draft leaned on.
 */
import { and, desc, eq } from 'drizzle-orm';
import { FogStateSchema, PersonaSchema, SceneGeometrySchema } from '@safehouse/contracts';
import {
  aiGenerations,
  gameSessions,
  npcTemplates,
  scenes,
  tokens,
  wikiPages,
  type Db,
} from '@safehouse/db';
import { httpError } from '../services/auth.js';
import { gmOnlyNames } from './state.js';
import type { LlmUsage } from './llm.js';

export type GenerationRow = typeof aiGenerations.$inferSelect;

/** Draft kinds this module knows how to apply on accept. */
export const DRAFT_KINDS = [
  'npc',
  'wiki_page',
  'fog_reveal',
  'token_label',
  'geometry',
  'recap',
] as const;
export type DraftKind = (typeof DRAFT_KINDS)[number];

export interface DraftDto {
  id: string;
  campaignId: string;
  kind: string;
  target: unknown;
  prompt: string;
  model: string | null;
  output: unknown;
  status: 'draft' | 'accepted' | 'rejected';
  usage: unknown;
  createdAt: string;
}

export function serializeDraft(row: GenerationRow): DraftDto {
  return {
    id: row.id,
    campaignId: row.campaignId,
    kind: row.kind,
    target: row.target ?? null,
    prompt: row.prompt,
    model: row.model,
    output: row.output,
    status: row.status,
    usage: row.usage ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface CreateDraftInput {
  campaignId: string;
  kind: string;
  prompt: string;
  output: Record<string, unknown>;
  model?: string | null;
  target?: Record<string, unknown> | null;
  usage?: LlmUsage | null;
}

/** Insert one draft. The only way AI output enters the database. */
export async function createDraft(db: Db, input: CreateDraftInput): Promise<GenerationRow> {
  const row = (
    await db
      .insert(aiGenerations)
      .values({
        campaignId: input.campaignId,
        kind: input.kind,
        prompt: input.prompt,
        output: input.output,
        model: input.model ?? null,
        target: input.target ?? null,
        usage: input.usage ?? null,
        status: 'draft',
      })
      .returning()
  )[0];
  if (!row) throw httpError(500, 'internal', 'draft insert returned no row');
  return row;
}

export async function listDrafts(
  db: Db,
  campaignId: string,
  opts: { status?: 'draft' | 'accepted' | 'rejected'; kind?: string; limit?: number } = {},
): Promise<DraftDto[]> {
  const conditions = [eq(aiGenerations.campaignId, campaignId)];
  if (opts.status) conditions.push(eq(aiGenerations.status, opts.status));
  if (opts.kind) conditions.push(eq(aiGenerations.kind, opts.kind));
  const rows = await db
    .select()
    .from(aiGenerations)
    .where(and(...conditions))
    .orderBy(desc(aiGenerations.createdAt))
    .limit(Math.min(Math.max(opts.limit ?? 50, 1), 200));
  return rows.map(serializeDraft);
}

export async function getDraft(db: Db, id: string): Promise<GenerationRow> {
  const row = (await db.select().from(aiGenerations).where(eq(aiGenerations.id, id)).limit(1))[0];
  if (!row) throw httpError(404, 'not_found', 'unknown generation');
  return row;
}

function output(row: GenerationRow): Record<string, unknown> {
  return typeof row.output === 'object' && row.output !== null
    ? (row.output as Record<string, unknown>)
    : {};
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

// ---------------------------------------------------------------------------
// Accept / reject
// ---------------------------------------------------------------------------

export interface AppliedRef {
  table: string;
  id: string;
  note?: string;
}

export interface AcceptResult {
  generation: DraftDto;
  applied: AppliedRef;
}

/**
 * Apply a draft and mark provenance. The generation row records what it
 * became (`target`), and the created entity carries an `aiProvenance` stamp —
 * so "who wrote this?" is answerable months later (FR12.15).
 */
export async function acceptDraft(
  db: Db,
  campaignId: string,
  id: string,
): Promise<AcceptResult> {
  const row = await getDraft(db, id);
  if (row.campaignId !== campaignId) throw httpError(403, 'forbidden', 'generation belongs to another campaign');
  if (row.status !== 'draft') {
    throw httpError(409, 'already_resolved', `generation is already ${row.status}`);
  }
  const applied = await applyDraft(db, row);
  const updated = (
    await db
      .update(aiGenerations)
      .set({ status: 'accepted', target: { table: applied.table, id: applied.id } })
      .where(eq(aiGenerations.id, row.id))
      .returning()
  )[0];
  if (!updated) throw httpError(500, 'internal', 'accept update returned no row');
  return { generation: serializeDraft(updated), applied };
}

export async function rejectDraft(db: Db, campaignId: string, id: string): Promise<DraftDto> {
  const row = await getDraft(db, id);
  if (row.campaignId !== campaignId) throw httpError(403, 'forbidden', 'generation belongs to another campaign');
  if (row.status !== 'draft') {
    throw httpError(409, 'already_resolved', `generation is already ${row.status}`);
  }
  const updated = (
    await db
      .update(aiGenerations)
      .set({ status: 'rejected' })
      .where(eq(aiGenerations.id, row.id))
      .returning()
  )[0];
  if (!updated) throw httpError(500, 'internal', 'reject update returned no row');
  return serializeDraft(updated);
}

async function applyDraft(db: Db, row: GenerationRow): Promise<AppliedRef> {
  switch (row.kind) {
    case 'npc':
      return applyNpcDraft(db, row);
    case 'wiki_page':
      return applyWikiDraft(db, row);
    case 'fog_reveal':
      return applyFogDraft(db, row);
    case 'token_label':
      return applyTokenLabelDraft(db, row);
    case 'geometry':
      return applyGeometryDraft(db, row);
    case 'recap':
      return applyRecapDraft(db, row);
    default:
      throw httpError(
        400,
        'not_appliable',
        `generation kind "${row.kind}" has no applier — reject it or apply it by hand`,
      );
  }
}

/** NPC draft → an `npc_templates` row (stats from the engine, fiction from AI). */
async function applyNpcDraft(db: Db, row: GenerationRow): Promise<AppliedRef> {
  const out = output(row);
  const name = str(out['name'], 'Unnamed NPC');
  const statblock = (out['statblock'] ?? out['sheet'] ?? {}) as Record<string, unknown>;
  const personaParsed = PersonaSchema.safeParse(out['persona'] ?? {});
  const persona: Record<string, unknown> = personaParsed.success ? { ...personaParsed.data } : {};
  persona['aiProvenance'] = {
    generationId: row.id,
    model: row.model,
    acceptedAt: new Date().toISOString(),
  };
  const gen = (out['gen'] ?? {}) as Record<string, unknown>;
  const created = (
    await db
      .insert(npcTemplates)
      .values({
        campaignId: row.campaignId,
        name,
        statblock,
        gen,
        persona,
      })
      .returning()
  )[0];
  if (!created) throw httpError(500, 'internal', 'npc_template insert returned no row');
  return { table: 'npc_templates', id: created.id, note: `created NPC template "${name}"` };
}

/** Codex draft → a GM-visibility `wiki_pages` row for the GM to reveal later. */
async function applyWikiDraft(db: Db, row: GenerationRow): Promise<AppliedRef> {
  const out = output(row);
  const title = str(out['title'], 'Untitled page');
  const contentMd = str(out['contentMd']);
  const tagsRaw = out['tags'];
  const tags = Array.isArray(tagsRaw) ? tagsRaw.filter((t): t is string => typeof t === 'string') : [];
  const created = (
    await db
      .insert(wikiPages)
      .values({
        campaignId: row.campaignId,
        kind: str(out['kind'], 'page'),
        title,
        contentMd,
        tags,
        visibility: 'gm',
        sections: [],
      })
      .returning()
  )[0];
  if (!created) throw httpError(500, 'internal', 'wiki_page insert returned no row');
  return { table: 'wiki_pages', id: created.id, note: `created codex page "${title}" (GM-only)` };
}

/** Fog suggestion → the named regions actually go revealed on the scene. */
async function applyFogDraft(db: Db, row: GenerationRow): Promise<AppliedRef> {
  const out = output(row);
  const sceneId = str(out['sceneId']);
  const regionIds = Array.isArray(out['regionIds'])
    ? (out['regionIds'] as unknown[]).filter((r): r is string => typeof r === 'string')
    : [];
  if (sceneId.length === 0) throw httpError(400, 'bad_request', 'fog draft carries no sceneId');
  const scene = (await db.select().from(scenes).where(eq(scenes.id, sceneId)).limit(1))[0];
  if (!scene || scene.campaignId !== row.campaignId) {
    throw httpError(404, 'not_found', 'fog draft points at an unknown scene');
  }
  const fog = FogStateSchema.parse(scene.fog ?? {});
  const known = new Set(fog.regions.map((r) => r.id));
  const revealed = new Set(fog.revealed);
  for (const id of regionIds) if (known.has(id)) revealed.add(id);
  const next = { ...fog, revealed: [...revealed] };
  await db.update(scenes).set({ fog: next }).where(eq(scenes.id, scene.id));
  return {
    table: 'scenes',
    id: scene.id,
    note: `revealed ${regionIds.length} fog region(s) on "${scene.name}"`,
  };
}

/**
 * Recap draft (FR12.12) → `game_sessions.recap_md`, the *draft* field the GM
 * edits. Accepting a recap publishes nothing: FR6.3's Discord post is a
 * separate, explicit GM action against the same column, so the AI's output
 * still stops one tap short of the players (Principle 8).
 */
async function applyRecapDraft(db: Db, row: GenerationRow): Promise<AppliedRef> {
  const out = output(row);
  const sessionId = str(out['sessionId']);
  if (sessionId.length === 0) throw httpError(400, 'bad_request', 'recap draft carries no sessionId');
  const session = (
    await db.select().from(gameSessions).where(eq(gameSessions.id, sessionId)).limit(1)
  )[0];
  if (!session || session.campaignId !== row.campaignId) {
    throw httpError(404, 'not_found', 'recap draft points at an unknown session');
  }
  const recapMd = str(out['recapMd']);
  if (recapMd.trim().length === 0) {
    throw httpError(400, 'bad_request', 'recap draft carries no markdown');
  }
  await db.update(gameSessions).set({ recapMd }).where(eq(gameSessions.id, session.id));
  return {
    table: 'game_sessions',
    id: session.id,
    note: `wrote the recap draft onto session ${session.date ?? session.id} — publish is still a separate GM action`,
  };
}

/** A draft's scene, checked against the draft's own campaign. */
async function draftScene(db: Db, row: GenerationRow, what: string) {
  const sceneId = str(output(row)['sceneId']);
  if (sceneId.length === 0) throw httpError(400, 'bad_request', `${what} carries no sceneId`);
  const scene = (await db.select().from(scenes).where(eq(scenes.id, sceneId)).limit(1))[0];
  if (!scene || scene.campaignId !== row.campaignId) {
    throw httpError(404, 'not_found', `${what} points at an unknown scene`);
  }
  return scene;
}

/** Token labels (FR12.9) → the tokens that actually change name get renamed. */
async function applyTokenLabelDraft(db: Db, row: GenerationRow): Promise<AppliedRef> {
  const scene = await draftScene(db, row, 'token label draft');
  const raw = output(row)['labels'];
  const labels = Array.isArray(raw) ? raw.map((l) => asRecord(l)) : [];
  const onScene = new Set(
    (await db.select({ id: tokens.id }).from(tokens).where(eq(tokens.sceneId, scene.id))).map(
      (t) => t.id,
    ),
  );
  let renamed = 0;
  for (const label of labels) {
    const tokenId = str(label['tokenId']);
    const to = str(label['to']);
    const from = str(label['from']);
    if (tokenId.length === 0 || to.length === 0 || to === from) continue;
    if (!onScene.has(tokenId)) continue;
    await db.update(tokens).set({ name: to }).where(eq(tokens.id, tokenId));
    renamed += 1;
  }
  return {
    table: 'tokens',
    id: scene.id,
    note: `renamed ${renamed} token(s) on "${scene.name}"`,
  };
}

/**
 * Layout copilot (FR12.11) → walls/doors/zones onto the scene, plus the named
 * fog regions, which arrive UNREVEALED: drawing a room is not showing it.
 */
async function applyGeometryDraft(db: Db, row: GenerationRow): Promise<AppliedRef> {
  const scene = await draftScene(db, row, 'geometry draft');
  const out = output(row);
  const proposed = SceneGeometrySchema.parse(out['geometry'] ?? {});
  const merge = str(out['mode'], 'merge') !== 'replace';
  const existing = merge
    ? SceneGeometrySchema.parse(scene.geometry ?? {})
    : SceneGeometrySchema.parse({});
  const geometry = {
    walls: [...existing.walls, ...proposed.walls],
    doors: [...existing.doors, ...proposed.doors],
    zones: [...existing.zones, ...proposed.zones],
    pins: existing.pins,
  };
  const fog = FogStateSchema.parse(scene.fog ?? {});
  const known = new Set(fog.regions.map((r) => r.id));
  const incoming = FogStateSchema.parse({ regions: out['fogRegions'] ?? [] }).regions.filter(
    (region) => !known.has(region.id),
  );
  await db
    .update(scenes)
    .set({ geometry, fog: { ...fog, regions: [...fog.regions, ...incoming] } })
    .where(eq(scenes.id, scene.id));
  return {
    table: 'scenes',
    id: scene.id,
    note:
      `${merge ? 'added' : 'replaced with'} ${proposed.walls.length} wall(s), ` +
      `${proposed.doors.length} door(s), ${proposed.zones.length} zone(s) and ` +
      `${incoming.length} unrevealed fog region(s) on "${scene.name}"`,
  };
}

function asRecord(raw: unknown): Record<string, unknown> {
  return typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
}

// ---------------------------------------------------------------------------
// Spoiler guard (FR12.19)
// ---------------------------------------------------------------------------

export interface SpoilerFlag {
  name: string;
  why: string;
}

/**
 * Player-facing prose gets checked against GM-only names (hidden tokens,
 * gm-visibility combatants, non-public codex titles): the Fixer can see
 * everything, and players mustn't until the GM says so.
 */
export async function spoilerScan(
  db: Db,
  campaignId: string,
  text: string,
): Promise<SpoilerFlag[]> {
  if (text.trim().length === 0) return [];
  const haystack = text.toLowerCase();
  const flags: SpoilerFlag[] = [];
  for (const name of await gmOnlyNames(db, campaignId)) {
    if (haystack.includes(name.toLowerCase())) {
      flags.push({ name, why: 'GM-only in this campaign — reveal or cut before publishing' });
    }
  }
  return flags;
}
