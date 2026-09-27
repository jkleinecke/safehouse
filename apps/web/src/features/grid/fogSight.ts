/**
 * The party's sight as a device folds it from the event stream (sightlines,
 * P6). Pure: no React, no three, no DOM.
 *
 * The server works the party's sight out after every committed change and
 * tells the table in one public `fog.updated {op: 'sight', cols, rows,
 * levels, active}`: the WHOLE record, every floor's `live` and `explored`
 * bitsets, never a delta. So a device that has the event in hand has
 * everything it needs, and does not have to read the scene again to redraw
 * its cover: the TV folds it into the snapshot it keeps
 * (`tv/sceneState.ts`), and a Grid writes it into the scene it holds
 * (`api.ts` `useGridLiveSync`). A runner's step then costs a phone no round
 * trip for the scene, only the sight stamp (`stage3d/masks.ts`).
 *
 * The GM's `forget` is told in two events: `{op: 'forget', level?}` first,
 * then, only if the stored record ended up different, the pass's own `sight`
 * event with the result. `forgetSight` is what the server does in between,
 * so a device folding the first event alone is already right.
 *
 * The GM's reveal brush travels the same way (`fog.updated {op: 'brush',
 * cols, rows, levels}`, the whole record, `brushOfEvent`), after a stroke and
 * after anything else that moved it.
 */
import { FogBrushSchema, FogSightSchema, type FogBrush, type FogSight, type FogState } from '@safehouse/contracts';

/**
 * The sight an `op: 'sight'` event carries: `{ sight }`, where `sight` is
 * undefined when the event says the record is gone (no floor at all, which
 * is how the server says it when sightlines went off with no memory left),
 * or null when the payload cannot be read as a sight record, in which case
 * the device should read the scene again rather than guess.
 *
 * Read through the contract's own schema (`FogSightSchema`), so a crafted
 * or damaged payload is refused whole: a grid past `FOG_SIGHT_MAX_SIDE`, a
 * floor key that is not a floor, a bitset that is not base64.
 */
export function sightOfEvent(payload: Record<string, unknown>): { sight: FogSight | undefined } | null {
  // The schema fills in a missing `levels` as none, which would read an
  // event that says nothing as one that says the memory is gone.
  const levels = payload['levels'];
  if (typeof levels !== 'object' || levels === null || Array.isArray(levels)) return null;
  const parsed = FogSightSchema.safeParse({ cols: payload['cols'], rows: payload['rows'], levels });
  if (!parsed.success) return null;
  return { sight: Object.keys(parsed.data.levels).length === 0 ? undefined : parsed.data };
}

/**
 * The GM's brush an `op: 'brush'` event carries (`FogBrushSchema`): `{ brush }`,
 * undefined when the event says there is none left (`levels: {}`), or null
 * when the payload cannot be read as a brush record, in which case the device
 * should read the scene again rather than guess. Refused whole on anything
 * the schema refuses, as the sight is.
 */
export function brushOfEvent(payload: Record<string, unknown>): { brush: FogBrush | undefined } | null {
  const levels = payload['levels'];
  if (typeof levels !== 'object' || levels === null || Array.isArray(levels)) return null;
  const parsed = FogBrushSchema.safeParse({ cols: payload['cols'], rows: payload['rows'], levels });
  if (!parsed.success) return null;
  return { brush: Object.keys(parsed.data.levels).length === 0 ? undefined : parsed.data };
}

/**
 * The party's memory after the GM's `forget` of floor `level` (every floor
 * when `level` is undefined), as the server leaves it: the memory is wiped,
 * and the sight pass that runs straight after fills it again with what the
 * runners still see, so each forgotten floor's `explored` becomes its
 * `live`. The rooms they have left go dark; the one they stand in stays.
 * With sightlines off, `live` is empty and the floor forgets everything.
 *
 * Returns `sight` itself when nothing changes (no record, or no such floor).
 */
export function forgetSight(sight: FogSight | undefined, level: number | undefined): FogSight | undefined {
  if (sight === undefined) return sight;
  let changed = false;
  const levels: FogSight['levels'] = {};
  for (const [key, floor] of Object.entries(sight.levels)) {
    if ((level === undefined || key === String(level)) && floor.explored !== floor.live) {
      levels[key] = { live: floor.live, explored: floor.live };
      changed = true;
    } else {
      levels[key] = floor;
    }
  }
  return changed ? { ...sight, levels } : sight;
}

/**
 * `fog` with the party's sight replaced by `sight` (taken away when it is
 * undefined), and, on a copy that says whether the scene is fogged at all
 * (`active`: a player's, the TV's), that word taken from the event too. The
 * GM's copy carries no `active` (its switch and the scene's sightlines say
 * it), and is not given one: `sceneFogOn` would read it first.
 */
export function withSight(fog: FogState, sight: FogSight | undefined, active: unknown): FogState {
  const next: FogState = { ...fog };
  if (sight === undefined) delete next.sight;
  else next.sight = sight;
  if (fog.active !== undefined && typeof active === 'boolean') next.active = active;
  return next;
}
