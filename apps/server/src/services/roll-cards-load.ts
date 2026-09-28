/**
 * Who a roll card is for: a runner's sheet, a tracker row, or a map token,
 * read into the pure builder's `CardBody` (roll-cards.ts).
 */
import { and, eq } from 'drizzle-orm';
import {
  GridSchema,
  SceneEnvironmentSchema,
  type CardActorRef,
  type Modifier,
  type SheetV1,
} from '@safehouse/contracts';
import { environment } from '@safehouse/rules';
import { combatants, encounters, npcTemplates, scenes, tokens, type Db } from '@safehouse/db';
import { httpError } from './auth.js';
import { activeSceneModifiers, liveWounds, loadCharacter, type CharacterRecord } from './characters.js';
import { parseCopilot, serializeCombatant, type CombatantRow } from './encounters-model.js';
import { magicSituationalFor } from './magic-derive.js';
import { rolledBodyFor } from './scenes.js';
import type { CardBody, CardScene, TokenAt } from './roll-cards.js';

type SceneRow = typeof scenes.$inferSelect;
type TokenRow = typeof tokens.$inferSelect;

export interface LoadedActor {
  body: CardBody;
  campaignId: string;
  /** The runner behind the actor: whose player may roll for it. */
  characterId: string | null;
  scene: CardScene | null;
  /** Kept from the table: a GM-only row or a hidden token. */
  hidden: boolean;
}

function sceneOf(row: SceneRow): CardScene {
  const env = SceneEnvironmentSchema.safeParse(row.environment ?? {});
  return { id: row.id, mods: env.success ? environment(env.data) : [] };
}

function tokenAtOf(token: TokenRow, scene: SceneRow): TokenAt {
  const grid = GridSchema.safeParse(scene.grid);
  return { sceneId: token.sceneId, x: token.x, y: token.y, unitM: grid.success ? grid.data.unitM : 1 };
}

async function sceneRow(db: Db, id: string): Promise<SceneRow | undefined> {
  return (await db.select().from(scenes).where(eq(scenes.id, id)).limit(1))[0];
}

async function tokenWithScene(db: Db, id: string) {
  return (
    await db
      .select({ token: tokens, scene: scenes })
      .from(tokens)
      .innerJoin(scenes, eq(tokens.sceneId, scenes.id))
      .where(eq(tokens.id, id))
      .limit(1)
  )[0];
}

async function combatantRow(db: Db, id: string): Promise<CombatantRow | undefined> {
  return (await db.select().from(combatants).where(eq(combatants.id, id)).limit(1))[0];
}

/** The sheet side of a runner: foci shape the pools, sustaining is an offer. */
async function characterParts(db: Db, rec: CharacterRecord) {
  const magic = await magicSituationalFor(db, rec.campaignId, rec.id, rec.play.sustained);
  // `sustain.<id>` is magic-derive's id for a −2 line.
  const sustaining = magic.filter((m) => m.id.startsWith('sustain.')).length;
  return {
    sheet: rec.sheet,
    mods: magic.filter((m) => !m.id.startsWith('sustain.')),
    sustaining,
    recoilFired: rec.play.recoil,
  };
}

async function fromCombatant(
  db: Db,
  ref: CardActorRef,
  row: CombatantRow,
  rec?: CharacterRecord | null,
  at?: TokenAt,
): Promise<LoadedActor> {
  const c = serializeCombatant(row);
  const encounter = (await db.select().from(encounters).where(eq(encounters.id, c.encounterId)).limit(1))[0];
  if (!encounter) throw httpError(404, 'not_found', 'unknown encounter');
  const character = rec ?? (c.source === 'character' && c.sourceId ? await loadCharacter(db, c.sourceId) : null);
  const copilot = parseCopilot(row.copilot);
  const parts = character ? await characterParts(db, character) : { sheet: copilot.sheet ?? null };
  // In a fight, the fight's own scene sets the environment.
  const sceneFound = encounter.sceneId ? await sceneRow(db, encounter.sceneId) : undefined;
  let token = at;
  let pose: string | undefined;
  if (c.tokenId) {
    const t = await tokenWithScene(db, c.tokenId);
    if (t) {
      token ??= tokenAtOf(t.token, t.scene);
      pose = t.token.pose;
    }
  }
  const effectMods: Modifier[] = c.effects.flatMap((e) => e.mods.filter((m) => m.active));
  return {
    body: {
      ...parts,
      actor: { kind: ref.kind, id: ref.id, name: c.name },
      mods: [...('mods' in parts ? parts.mods : []), ...effectMods],
      wounds: { physical: c.monitors.physical.filled, stun: c.monitors.stun.filled },
      secret: c.source !== 'character' || c.visibility !== 'public',
      initScore: c.initScore,
      delayedAction: copilot.delayedAction === true,
      prone: pose === 'prone' || c.effects.some((e) => /prone/i.test(e.name)),
      ...(token ? { token } : {}),
    },
    campaignId: encounter.campaignId,
    characterId: character?.id ?? null,
    scene: sceneFound ? sceneOf(sceneFound) : null,
    hidden: c.visibility !== 'public',
  };
}

async function fromCharacter(
  db: Db,
  ref: CardActorRef,
  rec: CharacterRecord,
  place?: { token: TokenRow; scene: SceneRow },
): Promise<LoadedActor> {
  const wounds = await liveWounds(db, rec);
  const at = place ? tokenAtOf(place.token, place.scene) : undefined;
  if (wounds.combatantId) {
    const row = await combatantRow(db, wounds.combatantId);
    // Mid-fight the tracker row is authoritative.
    if (row) return fromCombatant(db, ref, row, rec, at);
  }
  let scene: CardScene | null = place ? sceneOf(place.scene) : null;
  let token = at;
  if (!place) {
    const active = await activeSceneModifiers(db, rec.campaignId);
    if (active.sceneId) {
      scene = { id: active.sceneId, mods: active.mods };
      const own = (
        await db
          .select({ token: tokens, scene: scenes })
          .from(tokens)
          .innerJoin(scenes, eq(tokens.sceneId, scenes.id))
          .where(and(eq(tokens.sceneId, active.sceneId), eq(tokens.source, 'character'), eq(tokens.sourceId, rec.id)))
          .limit(1)
      )[0];
      if (own) token = tokenAtOf(own.token, own.scene);
    }
  }
  return {
    body: {
      ...(await characterParts(db, rec)),
      actor: { kind: ref.kind, id: ref.id, name: rec.name },
      wounds: { physical: wounds.physical, stun: wounds.stun },
      secret: false,
      prone: place?.token.pose === 'prone',
      ...(token ? { token } : {}),
    },
    campaignId: rec.campaignId,
    characterId: rec.id,
    scene,
    hidden: false,
  };
}

async function fromToken(db: Db, ref: CardActorRef): Promise<LoadedActor> {
  const found = await tokenWithScene(db, ref.id);
  if (!found) throw httpError(404, 'not_found', 'unknown token');
  const { token, scene } = found;
  const at = tokenAtOf(token, scene);
  // A token in a running fight is its tracker row, wounds and all.
  const live = (
    await db
      .select({ row: combatants })
      .from(combatants)
      .innerJoin(encounters, eq(combatants.encounterId, encounters.id))
      .where(and(eq(combatants.tokenId, token.id), eq(encounters.state, 'live')))
      .limit(1)
  )[0];
  if (live) return fromCombatant(db, ref, live.row, undefined, at);

  if (token.source === 'character' && token.sourceId) {
    const rec = await loadCharacter(db, token.sourceId);
    if (rec) return fromCharacter(db, ref, rec, { token, scene });
  }
  if (token.source === 'combatant' && token.sourceId) {
    const row = await combatantRow(db, token.sourceId);
    if (row) return fromCombatant(db, ref, row, undefined, at);
  }
  let sheet: SheetV1 | null = null;
  if (token.source === 'npc_template' && token.sourceId) {
    const template = (await db.select().from(npcTemplates).where(eq(npcTemplates.id, token.sourceId)).limit(1))[0];
    // Seeded by the token id, so this is the body staging would give it.
    const rolled = rolledBodyFor(template, token.id);
    sheet = rolled ? (parseCopilot(rolled.copilot).sheet ?? null) : null;
  }
  return {
    body: {
      actor: { kind: ref.kind, id: ref.id, name: token.name },
      sheet,
      wounds: null,
      secret: true,
      prone: token.pose === 'prone',
      token: at,
    },
    campaignId: scene.campaignId,
    characterId: null,
    scene: sceneOf(scene),
    hidden: token.hidden,
  };
}

export async function loadActor(db: Db, ref: CardActorRef): Promise<LoadedActor> {
  switch (ref.kind) {
    case 'character': {
      const rec = await loadCharacter(db, ref.id);
      if (!rec) throw httpError(404, 'not_found', 'unknown character');
      return fromCharacter(db, ref, rec);
    }
    case 'combatant': {
      const row = await combatantRow(db, ref.id);
      if (!row) throw httpError(404, 'not_found', 'unknown combatant');
      return fromCombatant(db, ref, row);
    }
    case 'token':
      return fromToken(db, ref);
  }
}
