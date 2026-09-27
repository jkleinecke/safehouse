/**
 * Movement: where a runner's token may go, and which doors it can reach.
 *
 * Pure grid-space rules, like vision. The server asks them before it stores
 * a player's move or opens a door for them, and the canvas asks the same
 * ones while the player drags and before it offers a door, so the map and
 * the server cannot disagree about where the walls are or who is next to
 * which door.
 */
export * from './walk.js';
export * from './reach.js';
