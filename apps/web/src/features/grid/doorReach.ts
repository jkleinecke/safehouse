/**
 * Which doors the map offers its viewer: the GM's rule for players' hands
 * on doors, on the map's side of the socket.
 *
 * THE RULE (the GM, 2026-09-27): "a player can open or close a door only
 * when their runner is standing next to it; the GM can from anywhere." The
 * server refuses a player's door op when no runner of theirs stands next to
 * the door (`doorRefusal`, services/doors.ts), but a door that offers itself
 * from across the map and then says no would be a poor way to learn the
 * rule. So the map asks the same rules the server does (`reachesDoor`,
 * rules movement/reach.ts) before it offers a player a door: a click on a
 * door out of reach says why and sends nothing, and the context menu of one
 * leaves the door's verbs out. What "next to" means lives in the rules, once,
 * so the map and the server cannot disagree about it: a painted door from
 * its own square and the eight round it, on its own floor; a traced door
 * from any square whose middle is within one square of its line.
 *
 * The GM is never asked. A player is asked about the runner they play (the
 * character this device is for, `myCharacterId`) wherever it stands on this
 * scene. Anyone else (an observer, the table's display) has no runner, and
 * no door is theirs to work.
 */
import type { Role, Scene, Token } from '@safehouse/contracts';
import { doorPlaceOf, reachesDoor } from '@safehouse/rules';

/**
 * What a player is told when their runner is too far from a door. The server
 * sends the same words (`door_out_of_reach`); they are kept here too, so the
 * notice reads the same whether the map or the server said no.
 */
export const DOOR_REACH_NOTICE = 'Your runner needs to be next to that door';

/** A door, as a door op names it: a traced one by id, a painted one by cell and floor. */
export type DoorRef = { doorId: string } | { cell: string; level: number };

export interface DoorReachInput {
  /** Who is asking. Only the GM works a door from anywhere. */
  role: Role;
  /** The scene the door is on: its traced doors, for where a traced door runs. */
  scene: Pick<Scene, 'geometry'>;
  /** The tokens on the scene, as this screen has them. */
  tokens: readonly Pick<Token, 'source' | 'sourceId' | 'x' | 'y' | 'level' | 'size'>[];
  /** The character this device plays, or null. */
  myCharacterId: string | null;
  door: DoorRef;
}

/**
 * May this viewer open or shut this door from where their runner stands?
 * The GM, always. A player, when a token of the character they play stands
 * next to the door (`reachesDoor`). Anyone else, never. A traced door this
 * scene does not have is next to nobody.
 */
export function canWorkDoor(input: DoorReachInput): boolean {
  const { role, scene, tokens, myCharacterId, door } = input;
  if (role === 'gm') return true;
  if (role !== 'player' || myCharacterId === null) return false;
  const place = doorPlaceOf(scene, door);
  if (place === null) return false;
  return tokens.some((t) => t.source === 'character' && t.sourceId === myCharacterId && reachesDoor(t, place));
}
