/**
 * The fog's edge beyond the materials (P6, sightlines): the two thresholds
 * the map stage reads the players' fog mask at, and whose carried lights
 * light the scene for a viewer.
 *
 * The cover (`cover.ts`) hides what stands on a square by that square's own
 * fog, fragment by fragment: a wall, a lamp's fixture, a figure in a hidden
 * room is simply not drawn. What no material draws is decided on the CPU,
 * from the same bytes (`masks.ts` `CoverMasks.coveredAt`): which figures a
 * player's pointer takes, which plates hang over heads, which labels show,
 * and which of the tokens' carried lights shine (`lightTokens`). It lives
 * here, apart from the stage, so it can be asked in node without a renderer.
 *
 * ## Light at the fog's edge
 *
 * Light is not seen where it is made but where it lands: a lamp in a hidden
 * room lights whatever floor its light reaches, and that floor may be
 * revealed. The map treats its two kinds of lamp apart.
 *   - The SCENE'S OWN lights (a painted lamp, a neon sign, the GM's lights)
 *     are part of the map, and the map is not the secret. They light the
 *     scene for everyone, fog or not, so a hidden room's light still falls
 *     through its open door onto the revealed corridor outside it, the way
 *     Roll20 shows the edge of a light whose room it will not show. The lamp
 *     itself is not shown: its fixture stands in the room and is hidden with
 *     it, and High's halo is hidden by the square its lamp hangs over
 *     (`cover.ts`, the sprite's patch). On ground shown dimmed as remembered
 *     they light as they always do, and are drawn dimmed with the room.
 *   - A TOKEN'S carried light (a guard's flashlight, a spirit's glow) is not
 *     the map: it says where he stands and which way he faces. It goes where
 *     its token goes. The server sends a player, the TV or an observer no
 *     token outside the party's LIVE sight but the runners themselves; this
 *     is the second guard, for what the server does send (another player's
 *     runner on ground shown as remembered, a copy a moment behind the fog).
 *     So a token on remembered ground lights nothing, as on hidden ground.
 * And the walls in between: a hidden room's walls still cast their shadows
 * (`cover.ts`, Shadows), so at Medium and High a lamp of its that casts
 * shadows stays inside it, as the bake keeps every lamp inside at Low (the
 * rules' walls cut every lamp's area), rather than spilling through them
 * onto revealed floor.
 */
import type { Token } from '@safehouse/contracts';
import type { StageSceneState } from '../types.js';

/**
 * The fog's two thresholds, read off the players' fog mask
 * (`CoverMasks.coveredAt` in 'fog' mode). The mask is 0 on LIVE ground, the
 * explored opacity (`EXPLORED_ALPHA`, 0.62) on ground shown dimmed as
 * remembered, and 1 on ground the table cannot see (P6); between them only
 * the soft rim of an edge, about a px wide.
 *
 * NOT LIVE, from this much cover up: nobody stands there as far as the table
 * knows. A player's pointer does not take a figure there, no plate hangs
 * over one, and a token there lights nothing with the light it carries
 * (`lightTokens`). The server withholds every token but the runners from such
 * ground anyway; this is the second guard, and the rule for the runners it
 * does send (another player's runner in a remembered room is drawn dimmed,
 * and is not picked, named or lit). Low enough that remembered ground is
 * well past it.
 */
export const NOT_LIVE_AT = 0.3;

/**
 * HIDDEN, from this much cover up: the map itself is not shown there. Map
 * labels (a pin's name, which stays on remembered ground with its pin) hide,
 * and the pointer's ray passes through what stands there, which is not
 * drawn. High enough that remembered ground, drawn dimmed, is well short of
 * it; ground under the whole fog is at 1.
 */
export const HIDDEN_AT = 0.9;

/**
 * Whether `token` is hidden from the table, by its own flag or by a hidden
 * layer: the GM's alone (the server never sends one to anyone else).
 */
export function isHidden(token: Token, state: StageSceneState): boolean {
  return Boolean(token.hidden) || (state.hiddenLayerTokenIds?.has(token.id) ?? false);
}

/**
 * The tokens whose carried lights the runtime lights the scene with: the
 * ones on this floor and the ones seen below it (their lights shine up
 * through the open squares). Figures are the stage's own, so this list only
 * lights.
 *
 * The GM gets every one: the GM sees through the fog, hidden tokens and all.
 * (Looking "as the party", the GM's tokens are already cut to what the table
 * is sent, `hydration.ts` `tokensForTable`, and their lights go with them.)
 *
 * Everyone else gets only the lights of tokens they could see. A hidden
 * token's light is the GM's alone, as the token is. And a token standing on
 * ground that is not LIVE for the table (`NOT_LIVE_AT`: hidden, or shown
 * dimmed as remembered) carries its light nowhere for them. Baked on Low, a
 * real lamp on Medium and High, it would light the revealed rooms round it
 * and say where the guard with the flashlight stands and which way he
 * faces, which the 2D map (whose light-map wash was the GM's alone) never
 * did. The one exception is a runner the viewer may move: their own runner
 * lights their way, fog or not, as it still answers their pointer. (With
 * sightlines on it never needs the exception: a runner always sees the
 * square it stands on, so that square is live.)
 *
 * `fogAt` is how covered a token's square is by the fog alone, 0 … 1
 * (`CoverMasks.coveredAt(token, 'fog')`), read at the token's own point, the
 * square centre the map snaps it to. Tokens with no light, or one switched
 * off, are kept as they are: they light nothing either way, and keeping
 * them keeps the list the same object when nothing needs filtering.
 */
export function lightTokens(state: StageSceneState, fogAt: (token: Token) => number): readonly Token[] {
  const below = state.belowTokens ?? [];
  const all = below.length === 0 ? state.tokens : [...state.tokens, ...below.map((b) => b.token)];
  if (state.role === 'gm') return all;
  const lit = (t: Token): boolean =>
    !isHidden(t, state) && (state.draggableIds.has(t.id) || !(t.light && t.light.on !== false) || fogAt(t) < NOT_LIVE_AT);
  return all.every(lit) ? all : all.filter(lit);
}
