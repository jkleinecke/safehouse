/**
 * Scenes to files and back (`SceneFile` in contracts).
 *
 * Export reads the scene as the GM sees it — hidden tokens, every fog
 * region, the GM's notes — and packs the files it draws on inside, so the
 * one download is the whole scene. Import unpacks those files as new
 * attachments of the campaign it lands in, gives the scene and its tokens
 * new ids, and points everything that referred to the old ids at the new
 * ones: the background maps, token art, pin handouts, the audio, and the
 * token layers' members.
 *
 * Links that only mean something in the campaign they came from — a token's
 * runner, NPC template or combatant, a pin's wiki page — survive only an
 * import back into that campaign, and only while what they point at is still
 * there. Anywhere else the token keeps its name, look and art, and the pin
 * its label.
 */
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { and, eq } from 'drizzle-orm';
import {
  SCENE_FILE_FORMAT,
  SCENE_FILE_VERSION,
  type SceneFile,
  type SceneFileAttachment,
  type Scene,
} from '@safehouse/contracts';
import { characters, combatants, npcTemplates, scenes, type Db } from '@safehouse/db';
import { httpError } from './auth.js';
import { ScenesService, type TokenCreateInput } from './scenes.js';

/** Every attachment id a scene or its tokens draw on. */
function referencedFiles(scene: Scene, tokens: ReadonlyArray<{ artRef?: string | null }>): Set<string> {
  const ids = new Set<string>(scene.mapAttachmentIds);
  for (const t of tokens) if (t.artRef) ids.add(t.artRef);
  for (const pin of scene.geometry.pins ?? []) if (pin.attachmentId) ids.add(pin.attachmentId);
  if (scene.audioRef) ids.add(scene.audioRef);
  return ids;
}

export async function exportScene(db: Db, sceneId: string): Promise<SceneFile> {
  const svc = new ScenesService(db);
  const row = await svc.sceneRow(sceneId);
  const { scene, tokens } = await svc.composedScene(row, true);
  const files: Record<string, SceneFileAttachment> = {};
  for (const id of referencedFiles(scene, tokens)) {
    const att = await svc.attachment(id).catch(() => null);
    // A file of another campaign is not this scene's to hand out.
    if (!att || (att.campaignId !== null && att.campaignId !== row.campaignId)) continue;
    const bytes = await readFile(svc.attachmentPath(att)).catch(() => null);
    if (!bytes) continue;
    files[id] = { kind: att.kind, visibility: att.visibility, mime: att.mime, data: bytes.toString('base64') };
  }
  const { id: _id, campaignId: _campaign, state: _state, ...body } = scene;
  return {
    format: SCENE_FILE_FORMAT,
    version: SCENE_FILE_VERSION,
    exportedAt: new Date().toISOString(),
    sourceCampaignId: row.campaignId,
    scene: body,
    tokens: tokens.map(({ sceneId: _scene, ...t }) => t),
    files,
  };
}

/** Does the thing a token stood for still exist in this campaign? */
async function sourceExists(db: Db, campaignId: string, source: string, id: string): Promise<boolean> {
  if (source === 'character') {
    const r = await db.select({ id: characters.id }).from(characters).where(and(eq(characters.id, id), eq(characters.campaignId, campaignId))).limit(1);
    return r.length > 0;
  }
  if (source === 'npc_template') {
    const r = await db.select({ id: npcTemplates.id }).from(npcTemplates).where(and(eq(npcTemplates.id, id), eq(npcTemplates.campaignId, campaignId))).limit(1);
    return r.length > 0;
  }
  if (source === 'combatant') {
    const r = await db.select({ id: combatants.id }).from(combatants).where(eq(combatants.id, id)).limit(1);
    return r.length > 0;
  }
  return false;
}

/**
 * Put the files a scene file carries into this campaign's store. Outside the
 * scene's transaction on purpose: they are bytes on disk, and each is checked
 * against its declared type on the way in (`saveAttachment`'s sniff).
 */
export async function unpackFiles(db: Db, campaignId: string, file: SceneFile): Promise<Map<string, string>> {
  const svc = new ScenesService(db);
  const ids = new Map<string, string>();
  for (const [oldId, f] of Object.entries(file.files)) {
    const bytes = Buffer.from(f.data, 'base64');
    if (bytes.length === 0) continue;
    const row = await svc.saveAttachment({
      campaignId,
      kind: f.kind,
      visibility: f.visibility,
      mime: f.mime,
      file: Readable.from(bytes),
    });
    ids.set(oldId, row.id);
  }
  return ids;
}

/** Build the scene and its tokens from a file, with new ids throughout. Returns the new scene. */
export async function importScene(db: Db, campaignId: string, file: SceneFile, fileIds: Map<string, string>): Promise<Scene> {
  const svc = new ScenesService(db);
  const sameCampaign = file.sourceCampaignId === campaignId;
  const newFile = (id: string | null | undefined): string | undefined => (id ? fileIds.get(id) : undefined);
  const src = file.scene;

  // A second copy of a scene already here says so in its name.
  const existing = await svc.listScenes(campaignId, { activeOnly: false });
  const taken = new Set(existing.map((s) => s.name));
  let name = src.name;
  if (taken.has(name)) {
    name = `${src.name} (imported)`;
    for (let n = 2; taken.has(name); n += 1) name = `${src.name} (imported ${n})`;
  }

  const pins = (src.geometry.pins ?? []).map((pin) => {
    const { wikiPageId, attachmentId, ...rest } = pin;
    const att = newFile(attachmentId);
    return { ...rest, ...(sameCampaign && wikiPageId ? { wikiPageId } : {}), ...(att ? { attachmentId: att } : {}) };
  });

  const created = await svc.createScene(campaignId, {
    name: name.slice(0, 200),
    grid: src.grid as unknown as Record<string, unknown>,
    environment: src.environment as unknown as Record<string, unknown>,
    geometry: { ...src.geometry, pins },
    ...(src.tiles ? { tiles: src.tiles } : {}),
    fog: src.fog,
    mapAttachmentIds: src.mapAttachmentIds.map((id) => fileIds.get(id)).filter((id): id is string => id !== undefined),
    ...(src.notes !== undefined ? { notes: src.notes } : {}),
  });
  const row = await svc.sceneRow(created.id);

  // The tokens, new ids, their links kept only where they still mean something.
  const tokenIds = new Map<string, string>();
  for (const t of file.tokens) {
    let sourceId: string | null = null;
    if (sameCampaign && t.sourceId && (await sourceExists(db, campaignId, t.source, t.sourceId))) sourceId = t.sourceId;
    const input: TokenCreateInput = {
      source: t.source,
      sourceId,
      name: t.name,
      x: t.x,
      y: t.y,
      level: t.level,
      size: t.size,
      rotation: t.rotation,
      artRef: newFile(t.artRef) ?? null,
      hidden: t.hidden,
      barsVisibility: t.barsVisibility,
      aura: t.aura ?? null,
      ...(t.pose ? { pose: t.pose } : {}),
      look: t.look ?? null,
    };
    const made = await svc.createToken(row, input);
    tokenIds.set(t.id, made.id);
  }

  const tokenLayers = src.tokenLayers?.map((layer) => ({
    ...layer,
    tokenIds: layer.tokenIds.map((id) => tokenIds.get(id)).filter((id): id is string => id !== undefined),
  }));
  const { scene } = await svc.updateScene(row, {
    levels: src.levels,
    vision: src.vision,
    ...(tokenLayers ? { tokenLayers } : {}),
  });
  const audio = newFile(src.audioRef);
  if (audio) {
    await db.update(scenes).set({ audioRef: audio }).where(eq(scenes.id, scene.id));
    return { ...scene, audioRef: audio };
  }
  return scene;
}

/** A scene file's `format` and `version`, checked before the rest is read, for a useful refusal. */
export function checkSceneFileHeader(body: unknown): void {
  const head = (typeof body === 'object' && body !== null ? body : {}) as { format?: unknown; version?: unknown };
  if (head.format !== SCENE_FILE_FORMAT) throw httpError(400, 'not_a_scene_file', 'that file is not a Safehouse scene');
  if (head.version !== SCENE_FILE_VERSION) {
    throw httpError(400, 'scene_file_version', `this scene file is version ${String(head.version)}; this Safehouse reads version ${SCENE_FILE_VERSION}`);
  }
}
