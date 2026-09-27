/**
 * A fog op, applied and told (FR9.13/9.14; P6).
 *
 * One path for every change the GM makes to a scene's fog, whoever asks for
 * it: the Fog panel and the Prep brush (REST and the socket's `fog.reveal`,
 * plugins/scenes.ts), and a Fixer draft the GM accepts (fixer/drafts.ts). It
 * used to live inside the scenes plugin alone, and the Fixer's drafts wrote
 * `scenes.fog` straight to the table with no event, no token diff and no
 * sight pass: a room the GM opened from the Fixer's suggestion was open on
 * the server and still black on every phone and the TV, and the guards in it
 * never arrived. Now both go through here, inside the caller's transaction
 * (`Hub.atomic`), so the write and everything the table hears about it
 * commit together.
 *
 * Two halves, because a draft reveals several regions at once and wants ONE
 * sight pass and ONE token diff for all of them:
 * - `tellFogOp` applies one op (`ScenesService.applyFogOp`) to the scene as
 *   it stands inside the transaction, and emits the op's own `fog.updated`
 *   events, player-safe (see below). It hands back the scene as it was
 *   before, for the pass.
 * - `runFogOp` is one op whole: `tellFogOp`, then the sight pass from the
 *   scene before (`recomputeSight`), which also runs the token diff, then
 *   the log line a reveal may ask for.
 *
 * What the events say (Principle 4): a *reveal* may carry the region polygon
 * (players now see it), `define`/unrevealed geometry stays GM-only, and
 * `hide` and `remove` carry an id with no geometry at all. Every public one
 * says whether the scene is fogged at all (`active`, as `sceneForViewer`
 * does); a `define` that fogs an open scene or redraws a revealed region also
 * tells the table, with nothing of an unrevealed region in it. The switch
 * (`enable`, `disable`) is public and says only that: `{op, active}`. A
 * reveal also says its fashion (`as`: live, or explored), so the TV files the
 * ground it opens as live or as remembered. The GM's brush is told whole
 * (`op: 'brush'`, the record every floor, as the sight is), after a stroke and
 * after any other op that moved it (a region revealed or hidden takes the
 * marks under it; the reset takes them all).
 *
 * Then the tokens. A fog op moves the edge of what the table may see, so
 * every token whose answer to `tokenConcealed` changed with it arrives
 * (`token.added`) or leaves (`token.removed`), exactly as a layer shown or
 * hidden does (`emitConcealmentChanges`). A guard in a room is sent to the
 * players when the room is revealed LIVE, and not a moment before: a room
 * revealed as explored shows them the room, dimmed, and nobody in it, and a
 * room dropped from live to explored takes its guards off their screens.
 *
 * The `scenes.fog` write and its events commit together. Fog is the sharpest
 * case of the half-commit in the whole app: a reveal that stored without
 * emitting leaves players still fogged out of a room the server now
 * considers open, and a `hide` that stored without emitting is worse — the
 * client keeps drawing geometry the server has taken back, which is a
 * Principle 4 leak the GM cannot see from their own screen.
 */
import { sceneFogOn, type FogRegion, type FogState, type Scene } from '@safehouse/contracts';
import { sameBrush } from '@safehouse/rules';
import type { EventTx } from '../hub.js';
import { ScenesService, serializeScene, type FogOpInput } from './scenes.js';
import { brushEventPayload, recomputeSight } from './sight.js';

/** A fog op as a caller asks for it: the op, and whether a reveal goes in the session log (FR9.14). */
export interface FogOpRequest extends FogOpInput {
  announce?: boolean | undefined;
}

/** One op applied and told (`tellFogOp`). */
export interface ToldFogOp {
  /** The scene as it was before the op, inside the transaction: where the sight pass diffs the tokens from. */
  before: Scene;
  /** The fog the op left (stored). */
  fog: FogState;
  /** The region the op was about, when it named or drew one. */
  region?: FogRegion;
}

/**
 * Apply one fog op to scene `sceneId` inside the caller's transaction, and
 * emit what the op itself tells the table (see the top of this file). No
 * sight pass and no token diff: the caller runs those once, after however
 * many ops it has (`runFogOp` for one).
 *
 * The scene is read through the transaction and locked, as the tile routes
 * do, rather than taken from a row the caller read before it opened. Two fog
 * ops in flight — the GM hiding one room and revealing the next in quick
 * succession — each merged into the fog as it stood before either, so the
 * second wrote the first's hidden room back open: no event said so, and the
 * players' next re-read had the room and its guards again. Locked, too: the
 * sight pass rewrites the same column after every move, and a fog op applied
 * to a copy read before a pass committed would write the party's memory back
 * as it was before that move.
 */
export async function tellFogOp(tx: EventTx, sceneId: string, op: FogOpInput): Promise<ToldFogOp> {
  const svc = new ScenesService(tx.db);
  const fresh = await svc.sceneRow(sceneId, { lock: true });
  // The scene as `applyFogOp` reads it, so the token diff compares against
  // the very state the op was applied to.
  const before = serializeScene(fresh);
  const wasOn = sceneFogOn(before);
  const { fog, region } = await svc.applyFogOp(fresh, op);
  const isDefine = op.op === 'define';
  const isSwitch = op.op === 'enable' || op.op === 'disable';
  const isForget = op.op === 'forget';
  const isBrush = op.op === 'brush';
  // A reveal says its fashion, always: a device folding the events (the TV)
  // files the region or shape under live or remembered by it, and moves a
  // region from one to the other when the GM changes her mind.
  const fashion = op.op === 'reveal' ? { as: op.as ?? 'live' } : {};
  // Whether the scene is fogged at all, as a player's copy says it
  // (`sceneForViewer`, `sceneFogOn`): a device folding the events (the TV)
  // keeps it true through a reset or the last reveal taken back, and turns it
  // over when the GM flips the switch. A scene with sightlines on stays
  // fogged whatever the switch says, and says so.
  const active = sceneFogOn({ fog, vision: before.vision });
  const after: Scene = { ...before, fog };
  await tx.emit({
    type: 'fog.updated',
    payload: isSwitch
      ? // The switch is one bit and says nothing else: no region, no id,
        // whatever else the body happened to carry.
        { sceneId, op: op.op, active }
      : isForget
        ? // Which floor was forgotten, and nothing else. The memory itself
          // follows in the sight pass's own event, whole.
          { sceneId, op: op.op, ...(op.level !== undefined ? { level: op.level } : {}), active }
        : isBrush
          ? // The brush's marks, every floor, whole (`brushEventPayload`),
            // and which floor the stroke was on: a device replaces its copy
            // with them rather than replaying strokes.
            brushEventPayload(sceneId, after, active, { level: op.level ?? 0 })
          : {
              sceneId,
              op: op.op,
              ...(op.regionId ? { regionId: op.regionId } : {}),
              // A region's shape and name go public only on its REVEAL, when
              // they become the players' to see. A `remove` used to carry the
              // region it took away, revealed or not, and that put a room the
              // table had never seen — its name, its outline — on every
              // player's socket at the moment it stopped mattering to the GM.
              ...(op.op === 'reveal' && region ? { region } : {}),
              ...(!isDefine && op.shape ? { shape: op.shape } : {}),
              ...fashion,
              ...(isDefine ? {} : { active }),
            },
    visibility: isDefine ? 'gm' : 'public',
  });
  // A `define` is the GM's, but two of them change what the table sees: one
  // that turns the fog on (the first region on a scene whose switch was
  // never flipped), and a revealed region redrawn, which moves ground the
  // players see — live, or dimmed as explored. The table hears that much,
  // and no more — the region itself only when it is a revealed one, whose
  // shape is already theirs — so the players' Grids fetch the scene again
  // and the TV folds it in.
  const revealedRegion =
    isDefine && region && (fog.revealed.includes(region.id) || (fog.exploredRegionIds ?? []).includes(region.id))
      ? region
      : undefined;
  if (isDefine && (wasOn !== active || revealedRegion)) {
    await tx.emit({
      type: 'fog.updated',
      payload: {
        sceneId,
        op: 'define',
        active,
        ...(revealedRegion ? { regionId: revealedRegion.id, region: revealedRegion } : {}),
      },
      visibility: 'public',
    });
  }
  // Any other op that moved the brush (a region revealed or hidden takes the
  // marks under it, the reset takes every one) tells the table the brush as
  // it now is, in the same shape a stroke does, after the op's own event.
  if (!isBrush && !sameBrush(before.fog.brush, fog.brush)) {
    await tx.emit({ type: 'fog.updated', payload: brushEventPayload(sceneId, after, active) });
  }
  return region ? { before, fog, region } : { before, fog };
}

/**
 * One fog op, whole, inside the caller's transaction: applied and told
 * (`tellFogOp`), then the sight pass with the scene before the op. The pass
 * refills the memory a `forget` wiped from what the runners still see (and
 * says so in one `op: 'sight'` event, only if the memory ends up different
 * from before), takes the brush's "fogged again" off any square a runner is
 * looking at, and runs the op's token diff, from the scene before to the
 * scene after, once. After the fog events, so a device folding events in
 * order has the new fog in hand when the tokens it uncovered arrive. On a
 * scene without sightlines the diff is all it does.
 */
export async function runFogOp(tx: EventTx, sceneId: string, op: FogOpRequest): Promise<{ fog: FogState }> {
  const told = await tellFogOp(tx, sceneId, op);
  const pass = await recomputeSight(tx, sceneId, { before: told.before });
  if (op.announce && op.op === 'reveal' && told.region) {
    await tx.emit({
      type: 'log.posted',
      payload: { kind: 'scene', sceneId, text: `Revealed: ${told.region.name}` },
    });
  }
  return { fog: pass.fog };
}
